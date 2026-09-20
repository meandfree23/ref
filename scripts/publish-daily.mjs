import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { canonicalCurationUrl } from "./curation-policy.mjs";
import { todayKstKey } from "./research-policy.mjs";

const root = process.cwd();
const recoveryStatePath = path.resolve("data/recovery-state.json");
const publicationStatePath = path.resolve("data/publication-state.json");
const publicationHistoryPath = path.resolve("data/publication-history.json");
const productionUrl = process.env.REFERENCE_SELECTOR_URL || "https://ref-smoky.vercel.app";
const target = 15;

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function commandResult(id, command, args, timeout = 10 * 60 * 1000, extraEnv = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return {
    id,
    ok: result.status === 0,
    status: result.status,
    elapsedMs: Date.now() - startedAt,
    outputTail: output.slice(-3000),
  };
}

function resolveVercelBinary() {
  const candidates = [
    process.env.VERCEL_BIN,
    "/Users/kk/.npm/_npx/69f9afb961c37556/node_modules/.bin/vercel",
    path.resolve("node_modules/.bin/vercel"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "vercel";
}

function dateKey(item = {}) {
  const value = item.date || item.archivedAt;
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`public API ${response.status}: ${url}`);
  return response.json();
}

async function verifyPublic() {
  const endpoints = {
    updates: "/api/updates?limit=15",
    koreanCode: "/api/korean-code?limit=15",
    cinema: "/api/cinema?limit=15",
  };
  const entries = await Promise.all(Object.entries(endpoints).map(async ([name, endpoint]) => {
    const payload = await fetchJson(`${productionUrl}${endpoint}`);
    const items = payload.items || [];
    const urls = items.map((item) => canonicalCurationUrl(item.url)).filter(Boolean);
    const today = todayKstKey();
    const summary = {
      topDate: items[0] ? dateKey(items[0]) : null,
      todayCount: items.filter((item) => dateKey(item) === today).length,
      itemCount: payload.archive?.itemCount ?? items.length,
      dateCount: payload.archive?.dateCount ?? 0,
      duplicateUrls: urls.length - new Set(urls).size,
    };
    summary.ok = summary.topDate === today
      && summary.todayCount === target
      && summary.duplicateUrls === 0;
    return [name, summary];
  }));
  const tabs = Object.fromEntries(entries);
  return { ok: Object.values(tabs).every((tab) => tab.ok), tabs };
}

async function verifyPublicWithPropagation() {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const result = await verifyPublic();
      if (result.ok) return { ...result, attempts: attempt };
      lastError = new Error(`public archive is stale: ${JSON.stringify(result.tabs)}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw lastError;
}

function fingerprint(value = "") {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function writeState(report) {
  fs.writeFileSync(publicationStatePath, `${JSON.stringify(report, null, 2)}\n`);
  let history = [];
  try { history = JSON.parse(fs.readFileSync(publicationHistoryPath, "utf8")).events || []; } catch {}
  history.push(report);
  fs.writeFileSync(publicationHistoryPath, `${JSON.stringify({
    version: 1,
    events: history.slice(-100),
  }, null, 2)}\n`);
}

const report = {
  id: `publication-${Date.now()}`,
  startedAt: new Date().toISOString(),
  today: todayKstKey(),
  status: "running",
  recovery: null,
  deployment: [],
  publicVerification: null,
  failureFingerprint: null,
};

try {
  const recoveryCommand = commandResult("recover", process.execPath, ["scripts/self-heal-daily.mjs"], 20 * 60 * 1000);
  let recoveryState = null;
  try { recoveryState = JSON.parse(fs.readFileSync(recoveryStatePath, "utf8")); } catch {}
  report.recovery = {
    command: recoveryCommand,
    status: recoveryState?.status || "missing-state",
    knownIncident: recoveryState?.knownIncident || null,
    restored: Boolean(recoveryState?.restored),
  };
  if (!recoveryCommand.ok || recoveryState?.status !== "verified") {
    throw new Error(`recovery not verified: ${recoveryState?.status || recoveryCommand.outputTail}`);
  }

  try {
    const existingPublic = await verifyPublic();
    if (existingPublic.ok) {
      report.publicVerification = { ...existingPublic, attempts: 1, deploymentSkipped: true };
      report.status = "published";
    }
  } catch {
    // A stale or temporarily unavailable public API proceeds to deployment.
  }

  if (report.status !== "published") {
    const vercel = resolveVercelBinary();
    const deployEnvironment = { NO_UPDATE_NOTIFIER: "1" };
    let deployment;
    const maximumDeploymentAttempts = 4;
    for (let attempt = 1; attempt <= maximumDeploymentAttempts; attempt += 1) {
      deployment = commandResult(
        attempt === 1 ? "deploy" : `deploy-transient-retry-${attempt - 1}`,
        vercel,
        ["deploy", "--prod"],
        10 * 60 * 1000,
        deployEnvironment,
      );
      report.deployment.push(deployment);
      if (deployment.ok) break;
      const transient = /not authorized|fetch failed|econnreset|etimedout/i.test(deployment.outputTail);
      if (!transient || attempt === maximumDeploymentAttempts) break;
      sleep(15000 * attempt);
    }
    if (!deployment.ok) throw new Error(`production deployment failed: ${deployment.outputTail}`);

    report.publicVerification = await verifyPublicWithPropagation();
    report.status = "published";
  }
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  report.failureFingerprint = fingerprint(error.message);
} finally {
  report.finishedAt = new Date().toISOString();
  writeState(report);
}

console.log(JSON.stringify(report, null, 2));
if (report.status !== "published") process.exitCode = 1;
