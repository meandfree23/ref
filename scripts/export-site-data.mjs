// Exports compact, lazily-loadable JSON for the static front end.
// Replaces the old 7MB public/static-updates.js bundle.
import fs from "node:fs";
import path from "node:path";
import { cleanFeedText } from "./article-text.mjs";
import { legacyCategory, tabs } from "./insight-taxonomy.mjs";
import { readCuratorMemory, rebuildSourceQuality, writeCuratorMemory } from "./curator-memory.mjs";

const outDir = path.resolve("public/data");
fs.mkdirSync(outDir, { recursive: true });
const recentDays = 21;
const kstKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(value));

const templateSummary = /이 글은 .*영역에서|원문 제목의 구체적 대상|동시대 크리에이티브 변화를 보여주는 사례|에서 스크랩한 .*관련 기사/;

function compact(item, tab) {
  const deep = item.deep || null;
  const day = kstKey(item.date || item.archivedAt);
  const original = item.originalDate || null;
  const ageAtArchive = original ? (new Date(item.date || item.archivedAt) - new Date(original)) / 86400000 : 0;
  const legacySummary = cleanFeedText(item.summaryKo || "");
  const out = {
    id: item.archiveId,
    tab,
    day,
    at: item.date || item.archivedAt || null,
    t: deep?.titleKo || item.titleKo || item.articleTitle || item.title,
    ot: item.articleTitle || item.title,
    u: item.url,
    img: ["related", "page-preview"].includes(item.imageKind) ? "" : (item.image || ""),
    s: item.sourceName || "",
    od: original,
    sum: deep?.summaryKo || (templateSummary.test(legacySummary) ? cleanFeedText(item.summary || "").slice(0, 240) : legacySummary),
    cat: deep?.category || legacyCategory(item),
  };
  if (ageAtArchive > 365) out.old = true;
  if (deep) {
    Object.assign(out, {
      k: deep.keep ? 1 : 0,
      sh: deep.sharpness,
      g: deep.grounding,
      nov: deep.novelty,
      mech: deep.mechanism,
      ev: deep.evidence || "",
      stl: deep.steal,
      lim: deep.limit,
      ax: deep.axes,
      sig: deep.signals,
      why: deep.reason,
    });
    if (deep.timeless) out.tl = 1;
  }
  return out;
}

function writeJson(name, payload) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(payload));
}

const memory = readCuratorMemory();
const archives = {};
const meta = { generatedAt: new Date().toISOString(), tabs: {} };
const allCompact = [];

for (const tab of Object.values(tabs)) {
  const payload = JSON.parse(fs.readFileSync(path.resolve(tab.archive), "utf8"));
  archives[tab.key] = payload;
  const items = payload.items.map((item) => compact(item, tab.key));
  const originalTime = (item) => new Date(item.od || `${item.day}T00:00:00+09:00`).getTime() || 0;
  items.sort((a, b) => (b.day.localeCompare(a.day)) || (originalTime(b) - originalTime(a)) || ((b.sh || 0) - (a.sh || 0)));
  allCompact.push(...items);
  const dates = [...new Set(items.map((item) => item.day))].sort().reverse();
  const recentSet = new Set(dates.slice(0, recentDays));
  writeJson(`${tab.key}-recent.json`, { generatedAt: meta.generatedAt, tab: tab.key, dates: dates.slice(0, recentDays), items: items.filter((item) => recentSet.has(item.day)) });
  writeJson(`${tab.key}-all.json`, { generatedAt: meta.generatedAt, tab: tab.key, dates, items });
  const read = items.filter((item) => item.sh);
  const dayCounts = {};
  for (const item of items) if (dates.slice(0, 14).includes(item.day)) dayCounts[item.day] = (dayCounts[item.day] || 0) + 1;
  meta.tabs[tab.key] = {
    dayCounts,
    label: tab.label,
    itemCount: items.length,
    dateCount: dates.length,
    latest: dates[0] || null,
    dates,
    readCount: read.length,
    keepCount: read.filter((item) => item.k).length,
  };
}

// Today's picks: sharpest kept readings from the last 3 archive days, diverse by source.
const latestDays = [...new Set(allCompact.map((item) => item.day))].sort().reverse().slice(0, 3);
const picks = [];
const perSource = new Map();
for (const item of allCompact
  .filter((entry) => latestDays.includes(entry.day) && entry.k)
  .sort((a, b) => (b.sh - a.sh) || b.day.localeCompare(a.day))) {
  const count = perSource.get(item.s) || 0;
  if (count >= 2) continue;
  perSource.set(item.s, count + 1);
  picks.push(item);
  if (picks.length >= 12) break;
}
writeJson("today.json", { generatedAt: meta.generatedAt, days: latestDays, items: picks });

// Signals with resolved evidence cards.
try {
  const signals = JSON.parse(fs.readFileSync(path.resolve("data/signals.json"), "utf8"));
  const byId = new Map(allCompact.map((item) => [item.id, item]));
  const card = (id) => {
    const item = byId.get(id);
    return item ? { id, tab: item.tab, t: item.t, u: item.u, s: item.s, img: item.img, day: item.day, stl: item.stl || "" } : null;
  };
  writeJson("signals.json", {
    ...signals,
    hypotheses: (signals.hypotheses || []).map((hypothesis) => ({ ...hypothesis, evidence: hypothesis.evidenceIds.map(card).filter(Boolean) })),
    clusters: (signals.clusters || []).map((cluster) => ({ ...cluster, evidence: cluster.ids.map(card).filter(Boolean).slice(0, 8) })),
  });
} catch {
  writeJson("signals.json", { generatedAt: null, hypotheses: [], clusters: [], history: [] });
}

// Curator memory: recompute source quality from all readings, publish a digest.
const quality = rebuildSourceQuality(memory, Object.values(archives));
writeCuratorMemory(memory);
const qualityRows = Object.entries(quality).map(([name, entry]) => ({ name, ...entry }));
writeJson("curator.json", {
  generatedAt: meta.generatedAt,
  reader: memory.reader,
  taste: memory.taste_profile,
  sources: {
    trusted: qualityRows.filter((row) => row.status === "trusted").sort((a, b) => b.avgSharpness - a.avgSharpness).slice(0, 15),
    demoted: qualityRows.filter((row) => row.status === "demoted").slice(0, 15),
    counts: {
      trusted: qualityRows.filter((row) => row.status === "trusted").length,
      watch: qualityRows.filter((row) => row.status === "watch").length,
      demoted: qualityRows.filter((row) => row.status === "demoted").length,
    },
  },
  health: (memory.pipeline_health_log || []).slice(0, 12),
  decisions: (memory.editorial_decisions || []).slice(-8).reverse(),
  openQuestions: memory.open_questions || [],
});

const sourceFiles = ["update-sources", "korean-code-sources", "cinema-sources"].map((name) => JSON.parse(fs.readFileSync(path.resolve(`data/${name}.json`), "utf8")));
meta.sourceCount = sourceFiles.reduce((sum, file) => sum + (file.sources || file.queries || []).length, 0);
try {
  meta.search = JSON.parse(fs.readFileSync(path.resolve("data/search/manifest.json"), "utf8"));
} catch {
  meta.search = null;
}
meta.readProgress = {
  read: allCompact.filter((item) => item.sh).length,
  total: allCompact.length,
};
writeJson("meta.json", meta);

console.log(JSON.stringify({
  tabs: Object.fromEntries(Object.entries(meta.tabs).map(([key, value]) => [key, { items: value.itemCount, dates: value.dateCount, latest: value.latest, read: value.readCount, keep: value.keepCount }])),
  picks: picks.length,
  readProgress: meta.readProgress,
  sizes: fs.readdirSync(outDir).map((name) => `${name}:${Math.round(fs.statSync(path.join(outDir, name)).size / 1024)}KB`),
}, null, 2));
