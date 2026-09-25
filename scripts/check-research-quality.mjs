import fs from "node:fs";
import path from "node:path";
import { referenceLensCoverage } from "./reference-lenses.mjs";
import { readBookmarkHistoryIndex } from "./bookmark-history-core.mjs";
import { canonicalCurationUrl, semanticCurationStats } from "./curation-policy.mjs";
import { todayKstKey } from "./research-policy.mjs";
import { isDegradedKoreanTranslation } from "./korean-translation-core.mjs";
import { evaluateCreativeUpdate } from "./updates-core.mjs";

import { readLegacyArchivePayload } from "./legacy-archive-payload.mjs";
const recoveryPlaybookPath = path.resolve("data/recovery-playbook.json");

function readStaticArchive() {
  return readLegacyArchivePayload();
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item?.[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function countMatching(items, predicate) {
  return items.filter(predicate).length;
}

function dateKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function countByDate(items) {
  const counts = {};
  for (const item of items) {
    const key = dateKey(item.date || item.archivedAt);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countUniqueUrls(items) {
  return new Set(items.map((item) => canonicalCurationUrl(item.url))).size;
}

function hasKoreanText(value = "") {
  return /[가-힣]/.test(value);
}

function hasDegradedTranslation(item) {
  return [item?.titleKo, item?.summaryKo, item?.focusKo]
    .some((value) => String(value || "").includes("번역을 불러오지 못해 원문을 보존합니다"));
}

function hasTranslationLeak(item) {
  return [item?.titleKo, item?.summaryKo, item?.focusKo]
    .some((value) => value && isDegradedKoreanTranslation(value));
}

function hasContentInsight(item) {
  return Boolean(
    item?.contentInsight?.version === "role-analysis-v2"
    && item.contentInsight.tone === "friendly-sharp-v1"
    && item.contentInsight.role
    && item.contentInsight.insight
    && item.contentInsight.creativeUse,
  );
}

function latestDateItems(items, counts) {
  const latest = Object.keys(counts).sort().reverse()[0];
  return items.filter((item) => dateKey(item.date || item.archivedAt) === latest);
}

function duplicateInsightCount(items) {
  const values = items.map((item) => item.contentInsight?.insight).filter(Boolean);
  return values.length - new Set(values).size;
}

function assertQuality(condition, message, failures) {
  if (!condition) failures.push(message);
}

const payload = readStaticArchive();
const recoveryPlaybook = JSON.parse(fs.readFileSync(recoveryPlaybookPath, "utf8"));
const bookmarkHistory = readBookmarkHistoryIndex();
const failures = [];
const warnings = [];
const dailyTarget = 15;
const today = todayKstKey();
const updates = payload.items || [];
const koreanCode = payload.koreanCode?.items || [];
const cinema = payload.cinema?.items || [];
const updateDateCounts = countByDate(updates);
const koreanDateCounts = countByDate(koreanCode);
const cinemaDateCounts = countByDate(cinema);
const koreanFields = countBy(koreanCode, "field");
const koreanImageCount = countMatching(koreanCode, (item) => Boolean(item.image));
const cinemaImageCount = countMatching(cinema, (item) => Boolean(item.image));
const updateLensCoverage = referenceLensCoverage(updates);
const updateSourceLayers = countBy(updates, "sourceLayer");
const historyItems = bookmarkHistory.items || [];
const latestUpdateStats = semanticCurationStats(latestDateItems(updates, updateDateCounts));
const latestUpdates = latestDateItems(updates, updateDateCounts);
const latestKoreanCode = latestDateItems(koreanCode, koreanDateCounts);
const latestCinema = latestDateItems(cinema, cinemaDateCounts);
const latestKoreanStats = semanticCurationStats(latestDateItems(koreanCode, koreanDateCounts));
const latestCinemaStats = semanticCurationStats(latestDateItems(cinema, cinemaDateCounts));
const recoveryIncidentIds = (recoveryPlaybook.incidents || []).map((incident) => incident.id);
const creativeCaseFixture = evaluateCreativeUpdate({
  title: "Studio builds modular visual identity using custom typography and a grid system",
  summary: "The designers combine a custom typeface, restrained palette and modular layout to transform one identity across packaging, posters and an interactive website.",
  image: "https://example.com/case.jpg",
  date: new Date().toISOString(),
  sourceLayer: "bookmark-up",
});
const generalNewsFixture = evaluateCreativeUpdate({
  title: "Candidate reveals a new campaign strategy in a political interview",
  summary: "The candidate explains why the campaign will change its approach and how the organization plans to respond to voters during the election season.",
  date: new Date().toISOString(),
  sourceLayer: "editorial",
});

assertQuality(recoveryPlaybook.version === 1, "recovery playbook version is invalid", failures);
assertQuality(recoveryIncidentIds.length >= 6, "recovery playbook has too few known incidents", failures);
assertQuality(
  new Set(recoveryIncidentIds).size === recoveryIncidentIds.length,
  "recovery playbook has duplicate incident IDs",
  failures,
);
assertQuality(
  (recoveryPlaybook.incidents || []).every((incident) => (
    incident.id
    && Array.isArray(incident.signals) && incident.signals.length
    && Array.isArray(incident.actions) && incident.actions.length
    && incident.onFailure
  )),
  "recovery playbook contains an incomplete incident contract",
  failures,
);
assertQuality(creativeCaseFixture.eligible, "creative case-study fixture is incorrectly rejected", failures);
assertQuality(!generalNewsFixture.eligible, "general news fixture incorrectly passes creative selection", failures);

assertQuality(
  bookmarkHistory.sourceCount === Object.keys(bookmarkHistory.sources || {}).length,
  "bookmark history source count does not match its source registry",
  failures,
);
assertQuality(countUniqueUrls(historyItems) === historyItems.length, "bookmark history has duplicate URLs", failures);
assertQuality(historyItems.every(hasContentInsight), "bookmark history has items without content insight", failures);
assertQuality(
  historyItems.every((item) => item.id && item.title && item.url && item.host && item.sourceBookmarkUrl),
  "bookmark history has items with missing source metadata",
  failures,
);
assertQuality(
  historyItems.every((item) => item.sourceLayer === "history"),
  "bookmark history contains an invalid source layer",
  failures,
);

assertQuality(updates.length >= 100, `updates item count too low: ${updates.length}`, failures);
assertQuality((payload.archive?.dateCount || 0) >= 1, "updates archive has no dates", failures);
assertQuality(countUniqueUrls(updates) === updates.length, "updates has duplicate curation URLs", failures);
assertQuality(updates.every(hasContentInsight), "updates has items without content insight", failures);
assertQuality(updates.every((item) => item.contentInsight?.role === "updates"), "updates has role-mismatched insights", failures);
if ((updateDateCounts[today] || 0) !== dailyTarget) {
  warnings.push(`updates today count is not 15 (feed supply may be thin today): ${updateDateCounts[today] || 0}`);
}
assertQuality((updateDateCounts[today] || 0) <= dailyTarget, `updates today count exceeds 15: ${updateDateCounts[today] || 0}`, failures);
assertQuality(!updates.some(hasDegradedTranslation), "updates contains degraded translations", failures);
assertQuality(!latestUpdates.some(hasTranslationLeak), "latest updates contains translation leakage", failures);
assertQuality(
  updates.filter((item) => item.sourceLayer === "bookmark-up").every((item) => item.sourceFolder === "up" && item.trustReason),
  "updates contains invalid bookmark-up research items",
  failures,
);
assertQuality(duplicateInsightCount(updates) === 0, "updates has repeated insight text", failures);
assertQuality(latestUpdateStats.nearDuplicatePairs === 0, "latest updates has semantic title duplicates", failures);
assertQuality(
  latestUpdates.every((item) => (
    item.creativeSelection?.version === "creative-update-v1"
    && item.creativeSelection.eligible
    && item.creativeSelection.score >= item.creativeSelection.minimumScore
  )),
  "latest updates contains items that failed the creative selection policy",
  failures,
);
assertQuality(
  latestUpdates.every((item) => (
    item.contentInsight?.whatIsNew
    && item.contentInsight?.whyItMatters
    && item.contentInsight?.creativePrinciple
    && item.contentInsight?.applicationQuestion
  )),
  "latest updates is missing the four-part creative insight",
  failures,
);
assertQuality(
  Object.values(updateDateCounts).every((count) => count <= dailyTarget),
  "updates has dates that contain more than 15 items",
  failures,
);
if (Object.values(updateLensCoverage).filter((count) => count > 0).length < 5) {
  warnings.push(`updates reference lens diversity is low: ${JSON.stringify(updateLensCoverage)}`);
}

const koreanExpectedCount = Math.min(60, (payload.koreanCode?.archive?.dateCount || 0) * dailyTarget);
assertQuality(koreanCode.length >= Math.min(15, koreanExpectedCount), `Korean Code item count too low: ${koreanCode.length}`, failures);
assertQuality(countUniqueUrls(koreanCode) === koreanCode.length, "Korean Code has duplicate curation URLs", failures);
assertQuality(koreanCode.every(hasContentInsight), "Korean Code has items without content insight", failures);
assertQuality(koreanCode.every((item) => item.contentInsight?.role === "korean-code"), "Korean Code has role-mismatched insights", failures);
if ((koreanDateCounts[today] || 0) !== dailyTarget) {
  warnings.push(`Korean Code today count is not 15 (feed supply may be thin today): ${koreanDateCounts[today] || 0}`);
}
assertQuality((koreanDateCounts[today] || 0) <= dailyTarget, `Korean Code today count exceeds 15: ${koreanDateCounts[today] || 0}`, failures);
assertQuality(!koreanCode.some(hasDegradedTranslation), "Korean Code contains degraded translations", failures);
assertQuality(!latestKoreanCode.some(hasTranslationLeak), "latest Korean Code contains translation leakage", failures);
assertQuality(duplicateInsightCount(koreanCode) === 0, "Korean Code has repeated insight text", failures);
assertQuality(latestKoreanStats.nearDuplicatePairs === 0, "latest Korean Code has semantic title duplicates", failures);
assertQuality(
  Object.values(koreanDateCounts).every((count) => count <= dailyTarget),
  "Korean Code has dates that contain more than 15 items",
  failures,
);
assertQuality(Object.keys(koreanFields).length >= 5, `Korean Code field diversity too low: ${Object.keys(koreanFields).length}`, failures);
assertQuality(
  koreanCode.every((item) => hasKoreanText(item.titleKo || "")),
  "Korean Code has items without Korean titleKo",
  failures,
);
assertQuality(
  koreanCode.every((item) => hasKoreanText(item.summaryKo || "")),
  "Korean Code has items without Korean summaryKo",
  failures,
);
assertQuality(
  koreanCode.every((item) => item.imageKind !== "related"),
  "Korean Code contains related fallback images",
  failures,
);
assertQuality(
  koreanCode.length ? koreanImageCount / koreanCode.length >= 0.5 : false,
  `Korean Code image ratio too low: ${koreanImageCount}/${koreanCode.length}`,
  failures,
);
assertQuality(
  koreanCode.every((item) => !(item.summaryKo || "").includes("실제 기사 안에서")),
  "Korean Code still exposes internal research instruction text",
  failures,
);

if ((koreanFields["디자인/광고"] || 0) < 5) {
  warnings.push(`Korean Code 디자인/광고 count is still low: ${koreanFields["디자인/광고"] || 0}`);
}

const cinemaExpectedCount = Math.min(60, (payload.cinema?.archive?.dateCount || 0) * dailyTarget);
assertQuality(cinema.length >= Math.min(15, cinemaExpectedCount), `Cinema item count too low: ${cinema.length}`, failures);
assertQuality(countUniqueUrls(cinema) === cinema.length, "Cinema has duplicate curation URLs", failures);
assertQuality(cinema.every(hasContentInsight), "Cinema has items without content insight", failures);
assertQuality(cinema.every((item) => item.contentInsight?.role === "cinema"), "Cinema has role-mismatched insights", failures);
if ((cinemaDateCounts[today] || 0) !== dailyTarget) {
  warnings.push(`Cinema today count is not 15 (feed supply may be thin today): ${cinemaDateCounts[today] || 0}`);
}
assertQuality((cinemaDateCounts[today] || 0) <= dailyTarget, `Cinema today count exceeds 15: ${cinemaDateCounts[today] || 0}`, failures);
assertQuality(!cinema.some(hasDegradedTranslation), "Cinema contains degraded translations", failures);
assertQuality(!latestCinema.some(hasTranslationLeak), "latest Cinema contains translation leakage", failures);
assertQuality(duplicateInsightCount(cinema) === 0, "Cinema has repeated insight text", failures);
assertQuality(latestCinemaStats.nearDuplicatePairs === 0, "latest Cinema has semantic title duplicates", failures);
assertQuality(
  Object.values(cinemaDateCounts).every((count) => count <= dailyTarget),
  "Cinema has dates that contain more than 15 items",
  failures,
);
assertQuality(
  cinema.every((item) => hasKoreanText(item.titleKo || "")),
  "Cinema has items without Korean titleKo",
  failures,
);
assertQuality(
  cinema.every((item) => hasKoreanText(item.summaryKo || "")),
  "Cinema has items without Korean summaryKo",
  failures,
);
assertQuality(
  cinema.every((item) => item.imageKind !== "related"),
  "Cinema contains related fallback images",
  failures,
);
assertQuality(
  cinema.length ? cinemaImageCount / cinema.length >= 0.8 : false,
  `Cinema image ratio too low: ${cinemaImageCount}/${cinema.length}`,
  failures,
);

const report = {
  ok: failures.length === 0,
  updates: {
    items: updates.length,
    dates: payload.archive?.dateCount || 0,
    perDate: updateDateCounts,
    referenceLenses: updateLensCoverage,
    sourceLayers: updateSourceLayers,
    contentInsights: countMatching(updates, hasContentInsight),
    latestCuration: latestUpdateStats,
  },
  koreanCode: {
    items: koreanCode.length,
    dates: payload.koreanCode?.archive?.dateCount || 0,
    perDate: koreanDateCounts,
    fields: koreanFields,
    koreanTitles: countMatching(koreanCode, (item) => hasKoreanText(item.titleKo || "")),
    koreanSummaries: countMatching(koreanCode, (item) => hasKoreanText(item.summaryKo || "")),
    relatedImages: countMatching(koreanCode, (item) => item.imageKind === "related"),
    images: koreanImageCount,
    imageRatio: koreanCode.length ? Number((koreanImageCount / koreanCode.length).toFixed(2)) : 0,
    contentInsights: countMatching(koreanCode, hasContentInsight),
    latestCuration: latestKoreanStats,
  },
  cinema: {
    items: cinema.length,
    dates: payload.cinema?.archive?.dateCount || 0,
    perDate: cinemaDateCounts,
    images: cinemaImageCount,
    imageRatio: cinema.length ? Number((cinemaImageCount / cinema.length).toFixed(2)) : 0,
    koreanTitles: countMatching(cinema, (item) => hasKoreanText(item.titleKo || "")),
    koreanSummaries: countMatching(cinema, (item) => hasKoreanText(item.summaryKo || "")),
    relatedImages: countMatching(cinema, (item) => item.imageKind === "related"),
    contentInsights: countMatching(cinema, hasContentInsight),
    latestCuration: latestCinemaStats,
  },
  bookmarkHistory: {
    items: historyItems.length,
    sources: bookmarkHistory.sourceCount,
    indexedSources: Object.values(bookmarkHistory.sources || {}).filter((source) => source.status === "indexed").length,
    emptySources: Object.values(bookmarkHistory.sources || {}).filter((source) => source.status === "empty").length,
    duplicateUrls: historyItems.length - countUniqueUrls(historyItems),
    contentInsights: countMatching(historyItems, hasContentInsight),
  },
  warnings,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  process.exitCode = 1;
}
