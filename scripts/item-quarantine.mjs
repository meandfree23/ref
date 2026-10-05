// Item-level quarantine for the daily publish gate.
//
// Why this exists: the quality gate is archive-wide, and the old recovery answered
// ANY failure by restoring the whole pre-run snapshot. One defective item (a
// repeated insight sentence, one leaked translation, one duplicate URL) therefore
// erased all 45 new items and left the date empty, while the workflow stayed green.
// Each new incident type got its own bounded repair, but the next unknown type
// erased a day again.
//
// The rule now: an item-level defect costs that item, never the date.
//   1. Only items that are NEW in this run (not in the pre-run snapshot) can be
//      removed. Verified history is never touched.
//   2. The checks mirror the per-item assertions in check-research-quality.mjs.
//   3. Removed items are recorded so the backfill step can top the date back up.
import fs from "node:fs";
import path from "node:path";
import { canonicalCurationUrl } from "./curation-policy.mjs";
import { isDegradedKoreanTranslation } from "./korean-translation-core.mjs";

export const tabArchives = [
  { tab: "updates", role: "updates", file: "data/archives/update-archive.json", pattern: /^(latest )?updates\b/i },
  { tab: "korean-code", role: "korean-code", file: "data/archives/korean-code-archive.json", pattern: /korean code/i },
  { tab: "cinema", role: "cinema", file: "data/archives/cinema-archive.json", pattern: /cinema/i },
  { tab: "history", role: "history", file: "data/bookmark-history-index.json", pattern: /bookmark history/i },
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, payload) {
  const destination = path.resolve(file);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload));
  fs.renameSync(temporary, destination);
}

const hasKorean = (value = "") => /[가-힣]/.test(String(value));

function itemDefects(item, role) {
  const defects = [];
  const insight = item?.contentInsight;
  if (!(insight?.version === "role-analysis-v2" && insight.tone === "friendly-sharp-v1" && insight.role && insight.insight && insight.creativeUse)) {
    defects.push("missing-content-insight");
  } else if (insight.role !== role) {
    defects.push("role-mismatched-insight");
  }
  const localized = [item.titleKo, item.summaryKo, item.focusKo];
  if (localized.some((value) => String(value || "").includes("번역을 불러오지 못해 원문을 보존합니다"))) {
    defects.push("degraded-translation");
  }
  if (localized.some((value) => value && isDegradedKoreanTranslation(value))) defects.push("translation-leak");
  if (role !== "updates") {
    if (!hasKorean(item.titleKo || "")) defects.push("missing-korean-title");
    if (!hasKorean(item.summaryKo || "")) defects.push("missing-korean-summary");
  }
  if (role === "korean-code" && item.imageKind === "related") defects.push("related-fallback-image");
  if (role === "updates") {
    const selection = item.creativeSelection;
    if (!(selection?.version === "creative-update-v1" && selection.eligible && selection.score >= selection.minimumScore)) {
      defects.push("creative-selection-failed");
    }
    if (!(insight?.whatIsNew && insight?.whyItMatters && insight?.creativePrinciple && insight?.applicationQuestion)) {
      defects.push("missing-four-part-insight");
    }
  }
  return defects;
}

// Remove defective NEW items from every tab archive. `snapshotDirectory` holds the
// pre-run copies written by self-heal-daily.mjs (same relative paths).
export function quarantineNewItems({ snapshotDirectory, tabs = tabArchives.filter(({ tab }) => tab !== "history") } = {}) {
  // The bookmark history index has its own writer and repair path; it is only
  // ever handled by the per-tab restore tier, never edited here.
  const report = { removed: [], byTab: {} };
  for (const { tab, role, file } of tabs) {
    const current = readJson(file);
    if (!current?.items?.length) continue;
    const before = readJson(path.join(snapshotDirectory, file));
    const knownUrls = new Set((before?.items || []).map((item) => canonicalCurationUrl(item.url)));
    const isNew = (item) => !knownUrls.has(canonicalCurationUrl(item.url));

    // Repeated insight text and canonical URL collisions are judged against the
    // whole tab, but only the NEW member of a colliding pair is removed.
    const insightOwners = new Map();
    const urlOwners = new Map();
    for (const item of current.items) {
      if (isNew(item)) continue;
      if (item.contentInsight?.insight) insightOwners.set(item.contentInsight.insight, item);
      urlOwners.set(canonicalCurationUrl(item.url), item);
    }

    const kept = [];
    const removed = [];
    for (const item of current.items) {
      if (!isNew(item)) {
        kept.push(item);
        continue;
      }
      const defects = itemDefects(item, role);
      const insightText = item.contentInsight?.insight;
      if (insightText && insightOwners.has(insightText)) defects.push("repeated-insight");
      const url = canonicalCurationUrl(item.url);
      if (urlOwners.has(url)) defects.push("duplicate-url");
      if (defects.length) {
        removed.push({ tab, url: item.url, title: item.title || item.titleKo || "", defects });
        continue;
      }
      if (insightText) insightOwners.set(insightText, item);
      urlOwners.set(url, item);
      kept.push(item);
    }

    if (removed.length) {
      writeJsonAtomic(file, { ...current, items: kept });
    }
    report.byTab[tab] = { newItems: current.items.filter(isNew).length, removed: removed.length };
    report.removed.push(...removed);
  }
  return report;
}

// Map quality-gate failure messages to the tab archives they concern, so a
// failure the quarantine cannot explain only rolls back that tab.
export function failingTabs(failures = []) {
  const hits = new Set();
  for (const message of failures) {
    const match = tabArchives.find(({ pattern }) => pattern.test(message));
    hits.add(match ? match.tab : "global");
  }
  return [...hits];
}

export function parseGateFailures(output = "") {
  const match = String(output).match(/"failures":\s*(\[[\s\S]*?\])/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// CLI: node scripts/item-quarantine.mjs <snapshotDirectory>
// Used by the workflow's backfill step, whose snapshot holds data/archives/*.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const snapshotDirectory = process.argv[2];
  if (!snapshotDirectory) {
    console.error("usage: node scripts/item-quarantine.mjs <snapshotDirectory>");
    process.exit(2);
  }
  console.log(JSON.stringify(quarantineNewItems({ snapshotDirectory }), null, 2));
}
