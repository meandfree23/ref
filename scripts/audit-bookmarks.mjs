import fs from "node:fs";
import path from "node:path";
import { readBookmarkDataset } from "./bookmarks-core.mjs";
import { getSourceProfile } from "./curation-core.mjs";
import { readVerifiedSources } from "./sources-core.mjs";
import { readUpdateSources } from "./updates-core.mjs";
import { readCinemaSources } from "./cinema-core.mjs";

const outputPath = path.resolve("data/bookmark-audit.json");
const live = process.argv.includes("--live");
const requestTimeoutMs = 8000;
const concurrency = 12;

function hostname(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function webkitTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return new Date(number / 1000 - 11644473600000).toISOString();
}

function isSourceLevelUrl(url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments.length <= 1 && !parsed.search;
}

function monthsAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (30.44 * 24 * 60 * 60 * 1000));
}

function trustedHostSet() {
  const verified = readVerifiedSources().items.map((item) => item.url);
  const updates = readUpdateSources().sources.map((source) => source.url);
  const cinema = readCinemaSources().sources.map((source) => source.url);
  return new Set([...verified, ...updates, ...cinema].map(hostname));
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 ReferenceSelectorBookmarkAudit/1.0",
      },
    });
    await response.body?.cancel().catch(() => {});
    return {
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      elapsedMs: Date.now() - startedAt,
      state: response.ok ? "reachable" : [401, 403, 429].includes(response.status) ? "restricted" : "error",
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      finalUrl: url,
      elapsedMs: Date.now() - startedAt,
      state: error?.name === "AbortError" ? "timeout" : "network-error",
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapConcurrent(items, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const dataset = readBookmarkDataset();
const trustedHosts = trustedHostSet();
const baseItems = dataset.items.map((item) => {
  const profile = getSourceProfile(item);
  const addedAt = webkitTimestamp(item.added);
  const trusted = trustedHosts.has(item.host);
  const sourceLevel = isSourceLevelUrl(item.url);
  return {
    ...item,
    addedAt,
    addedMonthsAgo: monthsAgo(addedAt),
    sourceLevel,
    trusted,
    sourceRole: profile.role,
    sourceWeight: profile.weight,
    priorityTier: trusted ? "A" : profile.weight >= 1.15 && sourceLevel ? "B" : "C",
  };
});

const items = live
  ? await mapConcurrent(baseItems, async (item) => ({ ...item, health: await checkUrl(item.url) }))
  : baseItems;

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

const health = live ? countBy(items, (item) => item.health.state) : {};
const report = {
  generatedAt: new Date().toISOString(),
  live,
  source: dataset.source,
  bookmarkGeneratedAt: dataset.generatedAt,
  summary: {
    items: items.length,
    uniqueHosts: new Set(items.map((item) => item.host)).size,
    sourceLevel: items.filter((item) => item.sourceLevel).length,
    documentLevel: items.filter((item) => !item.sourceLevel).length,
    trusted: items.filter((item) => item.trusted).length,
    priorityTiers: countBy(items, (item) => item.priorityTier),
    folders: countBy(items, (item) => item.sourceFolder),
    roles: countBy(items, (item) => item.sourceRole),
    health,
  },
  oldestAddedAt: items.map((item) => item.addedAt).filter(Boolean).sort()[0] || null,
  newestAddedAt: items.map((item) => item.addedAt).filter(Boolean).sort().at(-1) || null,
  topHosts: Object.entries(countBy(items, (item) => item.host))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([host, count]) => ({ host, count })),
  issues: live ? items
    .filter((item) => item.health.state !== "reachable")
    .map((item) => ({
      title: item.title,
      url: item.url,
      folder: item.sourceFolder,
      state: item.health.state,
      status: item.health.status,
    })) : [],
  items,
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, ...report.summary, issues: report.issues.length }, null, 2));
