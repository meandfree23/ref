// Removes duplicate references across dates AND across the three tabs.
// "Duplicate" = shares any identity key (exact URL, locale/section URL variant, or the
// same original-language title on the same site); see reference-identity.mjs.
// Keeps the earliest archived copy (ties: the copy with a deep reading, then the more
// specific tab), carries a deep reading over if only the dropped copy had one.
// Safe to run any time; writes only when needed. Writes data/dedupe-report.json so the
// publish guard can tell intentional removals from data loss.
import fs from "node:fs";
import path from "node:path";
import { referenceIdentityKeys } from "./reference-identity.mjs";

const tabs = [
  { name: "update-archive", tab: "updates", priority: 0 },
  { name: "korean-code-archive", tab: "korean-code", priority: 1 },
  { name: "cinema-archive", tab: "cinema", priority: 1 },
];

const entries = [];
const payloads = {};
for (const spec of tabs) {
  const file = path.resolve(`data/archives/${spec.name}.json`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  payloads[spec.name] = { file, payload };
  payload.items.forEach((item) => entries.push({ spec, item }));
}

const time = (item) => {
  const value = new Date(item.date || item.archivedAt || 0).getTime();
  return Number.isNaN(value) ? 0 : value;
};
// earliest first; ties -> has deep reading -> more specific tab
entries.sort((a, b) => time(a.item) - time(b.item)
  || Number(Boolean(b.item.deep)) - Number(Boolean(a.item.deep))
  || b.spec.priority - a.spec.priority);

const owner = new Map();
const drop = new Set();
const examples = [];
for (const entry of entries) {
  const keys = referenceIdentityKeys(entry.item);
  const keeper = keys.map((key) => owner.get(key)).find(Boolean);
  if (keeper) {
    drop.add(entry.item);
    if (!keeper.item.deep && entry.item.deep) keeper.item.deep = entry.item.deep;
    if (examples.length < 40) {
      examples.push({
        removed: `${entry.spec.tab}@${String(entry.item.date).slice(0, 10)} ${entry.item.url}`,
        kept: `${keeper.spec.tab}@${String(keeper.item.date).slice(0, 10)} ${keeper.item.url}`,
      });
    }
    // also claim this copy's keys, so further variants resolve to the same keeper
    keys.forEach((key) => { if (!owner.has(key)) owner.set(key, keeper); });
    continue;
  }
  keys.forEach((key) => owner.set(key, entry));
}

const removedByTab = {};
for (const spec of tabs) {
  const { file, payload } = payloads[spec.name];
  const before = payload.items.length;
  const items = payload.items.filter((item) => !drop.has(item));
  removedByTab[spec.tab] = before - items.length;
  if (items.length !== before) {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...payload, items }));
    fs.renameSync(`${file}.tmp`, file);
  }
}

// Several dedupe passes can happen in one workflow run; accumulate their counts so the
// publish guard sees every intentional removal of this run.
const reportFile = path.resolve("data/dedupe-report.json");
const runId = process.env.GITHUB_RUN_ID || "local";
let previous = null;
try { previous = JSON.parse(fs.readFileSync(reportFile, "utf8")); } catch { /* first pass */ }
const totals = { ...removedByTab };
if (previous?.runId === runId) {
  for (const [tab, count] of Object.entries(previous.removedByTab || {})) totals[tab] = (totals[tab] || 0) + count;
}
const report = {
  runId,
  runAt: new Date().toISOString(),
  removedByTab: totals,
  removed: Object.values(totals).reduce((sum, count) => sum + count, 0),
  examples: [...examples, ...(previous?.runId === runId ? previous.examples || [] : [])].slice(0, 40),
};
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ removedByTab, removed: drop.size, examples: examples.slice(0, 10) }, null, 2));
