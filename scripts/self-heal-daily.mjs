import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { todayKstKey } from "./research-policy.mjs";

const root = process.cwd();
const statePath = path.resolve("data/recovery-state.json");
const historyPath = path.resolve("data/recovery-history.json");
const snapshotDirectory = path.resolve("data/.recovery-snapshot");
const protectedFiles = [
  "data/archives/update-archive.json",
  "data/archives/korean-code-archive.json",
  "data/archives/cinema-archive.json",
  "data/bookmark-history-index.json",
  "public/static-updates.js",
];

function run(id, command, args = [], options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 15 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    id,
    ok: result.status === 0,
    status: result.status,
    elapsedMs: Date.now() - startedAt,
    output: `${result.stdout || ""}\n${result.stderr || ""}\n${result.error?.message || ""}`.trim().slice(-12000),
  };
}

function snapshot() {
  fs.rmSync(snapshotDirectory, { recursive: true, force: true });
  for (const file of protectedFiles) {
    const source = path.resolve(file);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(snapshotDirectory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function restore() {
  for (const file of protectedFiles) {
    const source = path.join(snapshotDirectory, file);
    if (!fs.existsSync(source)) continue;
    const destination = path.resolve(file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

function classify(output = "") {
  const rules = [
    ["daily-timeout", /ETIMEDOUT|timed out|spawnSync .* timeout/i],
    ["daily-underfilled", /did not reach the target|today count is not 15/i],
    ["creative-quality", /creative selection policy|four-part creative insight/i],
    ["insight-contract", /repeated insight|role-mismatched|without content insight/i],
    ["korean-image-assets", /related fallback images|image ratio too low|page-preview/i],
    ["localization-degraded", /degraded translations|translation leakage|without Korean titleKo|without Korean summaryKo|\b429\b/i],
    ["canonical-duplicates", /duplicate curation URLs|semantic title duplicates|duplicate URLs/i],
  ];
  return rules.find(([, pattern]) => pattern.test(output))?.[0] || "unknown";
}

function readArchiveDebt(target = 15) {
  try {
    const text = fs.readFileSync(path.resolve("public/static-updates.js"), "utf8");
    const match = text.match(/window\.__STATIC_UPDATE_ARCHIVE__ = ([\s\S]*);\s*$/);
    if (!match) return null;
    const payload = JSON.parse(match[1]);
    const tabs = {
      updates: payload.items || [],
      koreanCode: payload.koreanCode?.items || [],
      cinema: payload.cinema?.items || [],
    };
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return Object.fromEntries(Object.entries(tabs).map(([name, items]) => {
      const counts = new Map();
      for (const item of items) {
        const value = item.date || item.archivedAt;
        if (!value) continue;
        const key = formatter.format(new Date(value));
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const today = todayKstKey();
      const first = [...counts.keys()].sort()[0] || today;
      const cursor = new Date(`${first}T00:00:00Z`);
      const end = new Date(`${today}T00:00:00Z`);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        if (!counts.has(key)) counts.set(key, 0);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const underfilled = [...counts.entries()]
        .filter(([, count]) => count < target)
        .map(([date, count]) => ({ date, count, missing: target - count }))
        .sort((a, b) => b.date.localeCompare(a.date));
      return [name, { underfilledCount: underfilled.length, dates: underfilled }];
    }));
  } catch {
    return null;
  }
}

function writeReport(report) {
  fs.writeFileSync(statePath, `${JSON.stringify(report, null, 2)}\n`);
  let history = [];
  try { history = JSON.parse(fs.readFileSync(historyPath, "utf8")).events || []; } catch {}
  const compact = (event) => ({
    ...event,
    steps: (event.steps || []).map((step) => {
      const output = String(step.output || "");
      return {
        id: step.id,
        ok: step.ok,
        status: step.status,
        elapsedMs: step.elapsedMs,
        outputFingerprint: output
          ? createHash("sha256").update(output).digest("hex").slice(0, 12)
          : null,
        outputTail: output.slice(-800),
      };
    }),
  });
  history.push(compact(report));
  fs.writeFileSync(historyPath, `${JSON.stringify({
    version: 1,
    events: history.slice(-100).map(compact),
  }, null, 2)}\n`);
}

const report = {
  id: `recovery-${Date.now()}`,
  startedAt: new Date().toISOString(),
  today: todayKstKey(),
  status: "running",
  knownIncident: null,
  restored: false,
  steps: [],
};

snapshot();
const history = run("bookmark-history", "npm", [
  "run", "index:bookmark-history", "--", "--source-limit=10", "--per-source=100", "--sitemap-limit=10",
]);
report.steps.push(history);
const historyFallback = !history.ok
  && classify(history.output) === "daily-timeout"
  && fs.existsSync(path.resolve("data/bookmark-history-index.json"));
if (historyFallback) {
  report.steps.push({
    id: "bookmark-history-timeout-fallback",
    ok: true,
    status: 0,
    elapsedMs: 0,
    output: "Reused the last verified bookmark history index after a bounded indexing timeout.",
  });
}
let update = (history.ok || historyFallback)
  ? run("daily-update", process.execPath, ["scripts/update-daily-static.mjs"], { timeout: 12 * 60 * 1000 })
  : history;
report.steps.push(update);
if (!update.ok) {
  report.knownIncident = classify(update.output);
  if (report.knownIncident === "daily-underfilled") {
    update = run("daily-update-retry", process.execPath, ["scripts/update-daily-static.mjs"], {
      env: { DAILY_RECOVERY_MODE: "1" }, timeout: 12 * 60 * 1000,
    });
    report.steps.push(update);
  }
}

if (report.steps.at(-1).ok) report.steps.push(run("export", "npm", ["run", "export:archive"]));
let verify = report.steps.at(-1).ok ? run("verify", "npm", ["run", "verify"]) : report.steps.at(-1);
if (verify.id === "verify") report.steps.push(verify);

if (!verify.ok) {
  report.knownIncident = classify(verify.output);
  if (report.knownIncident === "insight-contract") {
    report.steps.push(run("repair-insights", "npm", ["run", "enrich:insights"]));
    report.steps.push(run("export-after-insights", "npm", ["run", "export:archive"]));
    verify = run("verify-after-insights", "npm", ["run", "verify"]);
    report.steps.push(verify);
  } else if (report.knownIncident === "korean-image-assets") {
    report.steps.push(run("repair-korean-images", "npm", ["run", "repair:korean-images"], {
      env: { REPAIR_DATE: report.today },
    }));
    report.steps.push(run("export-after-images", "npm", ["run", "export:archive"]));
    verify = run("verify-after-images", "npm", ["run", "verify"]);
    report.steps.push(verify);
  } else if (["creative-quality", "localization-degraded"].includes(report.knownIncident)) {
    report.steps.push(run("repair-today-curation", process.execPath, ["scripts/update-daily-static.mjs"], {
      env: { DAILY_RECOVERY_MODE: "1" }, timeout: 8 * 60 * 1000,
    }));
    report.steps.push(run("export-after-curation", "npm", ["run", "export:archive"]));
    verify = run("verify-after-curation", "npm", ["run", "verify"]);
    report.steps.push(verify);
  } else if (report.knownIncident === "canonical-duplicates") {
    report.steps.push(run("repair-bookmark-history", "npm", ["run", "repair:bookmark-history"]));
    report.steps.push(run("export-after-deduplication", "npm", ["run", "export:archive"]));
    verify = run("verify-after-deduplication", "npm", ["run", "verify"]);
    report.steps.push(verify);
  }
}

if (verify.ok) {
  report.status = "verified";
  fs.rmSync(snapshotDirectory, { recursive: true, force: true });
} else {
  restore();
  report.restored = true;
  report.status = report.knownIncident === "unknown" ? "blocked-unknown" : "deferred-known";
}
report.finishedAt = new Date().toISOString();
report.archiveDebt = readArchiveDebt();
writeReport(report);

console.log(JSON.stringify({
  ok: report.status === "verified",
  status: report.status,
  today: report.today,
  knownIncident: report.knownIncident,
  restored: report.restored,
  archiveDebt: report.archiveDebt,
  steps: report.steps.map(({ id, ok, status, elapsedMs }) => ({ id, ok, status, elapsedMs })),
  state: statePath,
  history: historyPath,
}, null, 2));

if (report.status !== "verified") process.exitCode = 1;
