import { archiveCinemaUpdates, archiveKoreanCodeUpdates, archiveUpdates, readCinemaArchive, readKoreanCodeArchive, readUpdateArchive } from "./update-archive.mjs";
import { getLatestCinemaUpdates } from "./cinema-core.mjs";
import { getLatestKoreanCodeUpdates } from "./korean-code-core.mjs";
import { getLatestUpdates } from "./updates-core.mjs";
import { canonicalCurationUrl } from "./curation-policy.mjs";
import { dailyResearchItemTarget, kstDateKeyToIso, todayKstKey } from "./research-policy.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Vercel injects the Blob token in deployed environments.
}

function dateRange(startKey, endKey) {
  const dates = [];
  const cursor = new Date(`${startKey}T00:00:00Z`);
  const end = new Date(`${endKey}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function firstDate(archive, fallback) {
  const dates = [...(archive.dates || [])].sort();
  return dates[0] || fallback;
}

function countItemsByDate(archive) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const counts = new Map();
  for (const item of archive.items || []) {
    const date = new Date(item.date || item.archivedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = formatter.format(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function fillMissingDates({ name, readArchive, fetchItems, archiveItems, startKey, target }) {
  const before = await readArchive();
  const allDates = dateRange(startKey, todayKstKey());
  const counts = countItemsByDate(before);
  const force = process.env.FORCE_BACKFILL === "1";
  const onlyMissingDates = process.env.ONLY_MISSING_DATES === "1";
  const underfilled = allDates
    .map((date) => ({
      date,
      existing: force ? 0 : (counts.get(date) || 0),
    }))
    .filter((entry) => !onlyMissingDates || entry.existing === 0)
    .map((entry) => ({ ...entry, missing: target - entry.existing }))
    .filter((entry) => entry.missing > 0);

  if (!underfilled.length) {
    return {
      name,
      startKey,
      target,
      complete: true,
      attemptedDates: 0,
      datesFilled: 0,
      filledDates: [],
      remaining: [],
      archiveBefore: { items: before.itemCount, dates: before.dateCount },
      archiveAfter: { items: before.itemCount, dates: before.dateCount, dateKeys: before.dates },
    };
  }

  const totalMissing = underfilled.reduce((sum, entry) => sum + entry.missing, 0);
  const latest = await fetchItems({
    limit: Math.max(target, totalMissing),
    excludeItems: before.items || [],
  });
  const candidates = latest.items || [];
  const usedUrls = new Set();
  for (const item of before.items || []) {
    if (item.url) usedUrls.add(canonicalCurationUrl(item.url));
    if (item.googleNewsUrl) usedUrls.add(canonicalCurationUrl(item.googleNewsUrl));
  }
  let cursor = 0;
  let archivedTotal = 0;
  for (const { date, missing } of underfilled) {
    const items = [];
    while (items.length < missing && cursor < candidates.length) {
      const candidate = candidates[cursor];
      cursor += 1;
      const candidateKeys = [candidate?.url, candidate?.googleNewsUrl]
        .filter(Boolean)
        .map(canonicalCurationUrl);
      if (!candidateKeys.length || candidateKeys.some((key) => usedUrls.has(key))) continue;
      candidateKeys.forEach((key) => usedUrls.add(key));
      items.push(candidate);
    }
    if (!items.length) continue;
    archivedTotal += items.length;
    await archiveItems(items, {
      collectionDate: kstDateKeyToIso(date),
      maxItemsPerSnapshot: target,
      mergeExistingSnapshot: !force,
      useCollectionDate: true,
    });
  }

  const after = await readArchive();
  const afterCounts = countItemsByDate(after);
  const filledDates = underfilled
    .filter(({ date }) => (afterCounts.get(date) || 0) >= target)
    .map(({ date }) => date);
  const remaining = allDates
    .map((date) => ({ date, count: afterCounts.get(date) || 0 }))
    .filter(({ count }) => onlyMissingDates ? count === 0 : count < target)
    .map(({ date, count }) => ({ date, count, missing: target - count }));
  return {
    name,
    startKey,
    target,
    forced: force,
    onlyMissingDates,
    complete: onlyMissingDates
      ? remaining.every(({ count }) => count > 0)
      : remaining.length === 0,
    attemptedDates: underfilled.length,
    datesFilled: filledDates.length,
    requestedItems: totalMissing,
    filledDates,
    remaining,
    fetchedItems: latest.items.length,
    archivedTotal,
    archiveBefore: { items: before.itemCount, dates: before.dateCount },
    archiveAfter: { items: after.itemCount, dates: after.dateCount, dateKeys: after.dates },
  };
}

const target = Number(process.env.DAILY_RESEARCH_TARGET || dailyResearchItemTarget);
const selectedTabs = new Set((process.env.BACKFILL_TABS || "updates,koreanCode,cinema")
  .split(",")
  .map((tab) => tab.trim())
  .filter(Boolean));
const updatesBefore = await readUpdateArchive();
const koreanBefore = await readKoreanCodeArchive();
const cinemaBefore = await readCinemaArchive();
const fallbackStart = todayKstKey();

const startKey = process.env.BACKFILL_START_DATE
  || [firstDate(koreanBefore, fallbackStart), firstDate(cinemaBefore, fallbackStart)].sort()[0]
  || fallbackStart;

const results = [];
if (selectedTabs.has("updates")) {
  results.push(await fillMissingDates({
    name: "updates",
    readArchive: readUpdateArchive,
    fetchItems: ({ limit, excludeItems }) => getLatestUpdates({
      limit: Math.max(80, limit),
      excludeItems,
    }),
    archiveItems: archiveUpdates,
    startKey: process.env.BACKFILL_UPDATES_START_DATE || firstDate(updatesBefore, startKey),
    target,
  }));
}
if (selectedTabs.has("koreanCode")) {
  results.push(await fillMissingDates({
    name: "koreanCode",
    readArchive: readKoreanCodeArchive,
    fetchItems: ({ limit, excludeItems }) => getLatestKoreanCodeUpdates({
      limit: Math.max(500, limit),
      excludeItems,
    }),
    archiveItems: archiveKoreanCodeUpdates,
    startKey,
    target,
  }));
}
if (selectedTabs.has("cinema")) {
  results.push(await fillMissingDates({
    name: "cinema",
    readArchive: readCinemaArchive,
    fetchItems: ({ limit, excludeItems }) => getLatestCinemaUpdates({
      limit: Math.max(500, limit),
      excludeItems,
    }),
    archiveItems: archiveCinemaUpdates,
    startKey,
    target,
  }));
}

console.log(JSON.stringify({
  ok: results.every((result) => result.complete),
  target,
  selectedTabs: [...selectedTabs],
  startKey,
  today: todayKstKey(),
  results,
}, null, 2));
