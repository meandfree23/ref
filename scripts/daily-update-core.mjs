import { getLatestUpdates, isValidCreativeUpdate, localizeUpdateItems } from "./updates-core.mjs";
import { enrichKoreanCodeItems, getLatestKoreanCodeUpdates, readKoreanCodeSeed } from "./korean-code-core.mjs";
import { enrichCinemaItems, getLatestCinemaUpdates } from "./cinema-core.mjs";
import { hasCompleteKoreanLocalization } from "./korean-translation-core.mjs";
import { selectNovelItems } from "./curation-policy.mjs";
import { dailyResearchItemTarget, itemsForKstDate, todayKstKey } from "./research-policy.mjs";
import {
  archiveCinemaUpdates,
  archiveKoreanCodeUpdates,
  archiveUpdates,
  readCinemaArchive,
  readKoreanCodeArchive,
  readUpdateArchive,
} from "./update-archive.mjs";

function emptyLatest(limit) {
  return {
    fetchedAt: new Date().toISOString(),
    sourceCount: 0,
    okSourceCount: 0,
    failedSources: [],
    limit,
    items: [],
  };
}

async function updateTab({
  before,
  target,
  limit,
  fetchLatest,
  prepareItems = async (items) => items,
  archiveItems,
  archiveOptions,
  today,
  isValidExisting = () => true,
  curationPolicy = {},
}) {
  const validToday = itemsForKstDate(before.items, today).filter(isValidExisting);
  // A recovery retry must be allowed to reuse or replace candidates collected
  // earlier today. Only dates before today count as archive history here.
  const historicalItems = before.items.filter(
    (item) => itemsForKstDate([item], today).length === 0,
  );
  const existingToday = selectNovelItems(validToday, [], target, curationPolicy);
  const remaining = Math.max(0, target - existingToday.length);
  if (!remaining) {
    return {
      latest: emptyLatest(limit),
      additions: [],
      archive: before,
      existingToday,
      todayItems: existingToday,
      candidateCount: 0,
      preparedCount: 0,
      skipped: true,
    };
  }

  const latest = await fetchLatest(limit, historicalItems);
  // Localization and metadata repair can make two distinct feed entries resolve to
  // the same canonical title. Prepare a small reserve, then run the same curation
  // policy again on the final user-facing records before archiving.
  // A retry often starts with 14 valid items. Keep a full-size reserve even when
  // only one item is missing, because localization can collapse several raw
  // candidates into the same final Korean title.
  const reserveSize = Math.min(
    latest.items.length,
    Math.max(remaining * 4, target * 4),
  );
  const candidates = selectNovelItems(latest.items, historicalItems, reserveSize, {
    ...curationPolicy,
    seedItems: existingToday,
  });
  const prepared = [];
  let additions = [];
  const batchSize = Math.max(remaining, Math.min(target, 20));
  for (let offset = 0; offset < candidates.length && additions.length < remaining; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    prepared.push(...(await prepareItems(batch)).filter(isValidExisting));
    additions = selectNovelItems(prepared, historicalItems, remaining, {
      ...curationPolicy,
      seedItems: existingToday,
    });
  }
  const todayItems = [...existingToday, ...additions].slice(0, target);
  const archive = additions.length
    ? await archiveItems(todayItems, archiveOptions)
    : before;

  return {
    latest,
    additions,
    archive,
    existingToday,
    todayItems,
    candidateCount: candidates.length,
    preparedCount: prepared.length,
    skipped: false,
  };
}

function tabReport(result, before) {
  return {
    sourceCount: result.latest.sourceCount,
    okSourceCount: result.latest.okSourceCount,
    failedSources: result.latest.failedSources,
    recoveredFromFeeds: result.latest.items.length,
    candidateCount: result.candidateCount,
    preparedCount: result.preparedCount,
    existingToday: result.existingToday.length,
    addedToday: result.additions.length,
    archivedToday: result.todayItems.length,
    skipped: result.skipped,
    archiveBefore: {
      items: before.itemCount,
      dates: before.dateCount,
    },
    archiveAfter: {
      items: result.archive.itemCount,
      dates: result.archive.dateCount,
      dateKeys: result.archive.dates,
    },
    newlyRecovered: Math.max(0, result.archive.itemCount - before.itemCount),
  };
}

export async function runDailyUpdate({ target = dailyResearchItemTarget, limit = Math.max(80, target) } = {}) {
  const today = todayKstKey();
  const recoveryMode = process.env.DAILY_RECOVERY_MODE === "1";
  const candidateLimit = Math.max(limit, target * 20);
  const [before, koreanBefore, cinemaBefore] = await Promise.all([
    readUpdateArchive(),
    readKoreanCodeArchive(),
    readCinemaArchive(),
  ]);
  const archiveOptions = {
    maxItemsPerSnapshot: target,
    mergeExistingSnapshot: false,
    useCollectionDate: true,
  };
  const tabPolicies = {
    // Prefer broad source diversity. The higher fallback is used only when the
    // strict pass cannot reach 15, most commonly during feed outages.
    updates: { maxPerSource: 3, fallbackMaxPerSource: 6, semanticThreshold: 0.82 },
    koreanCode: { maxPerSource: 3, fallbackMaxPerSource: 7, semanticThreshold: 0.78 },
    cinema: { maxPerSource: 4, fallbackMaxPerSource: 10, semanticThreshold: 0.82 },
  };

  const updates = await updateTab({
    before,
    target,
    limit: candidateLimit,
    fetchLatest: (fetchLimit, excludeItems) => getLatestUpdates({
      limit: fetchLimit,
      enrich: false,
      excludeItems,
    }),
    prepareItems: localizeUpdateItems,
    archiveItems: archiveUpdates,
    archiveOptions,
    today,
    isValidExisting: isValidCreativeUpdate,
    curationPolicy: tabPolicies.updates,
  });
  const koreanCode = await updateTab({
    before: koreanBefore,
    target,
    limit: candidateLimit * 2,
    fetchLatest: async (fetchLimit, excludeItems) => {
      const latest = await getLatestKoreanCodeUpdates({
        limit: fetchLimit,
        enrich: false,
        minimumScore: recoveryMode ? 20 : 24,
        excludeItems,
      });
      const verifiedFallbacks = readKoreanCodeSeed().items.map((item) => ({
        ...item,
        summary: item.summary || [item.insight, item.code].filter(Boolean).join(" "),
      }));
      return { ...latest, items: [...latest.items, ...verifiedFallbacks] };
    },
    prepareItems: enrichKoreanCodeItems,
    archiveItems: archiveKoreanCodeUpdates,
    archiveOptions,
    today,
    isValidExisting: hasCompleteKoreanLocalization,
    curationPolicy: tabPolicies.koreanCode,
  });
  const cinema = await updateTab({
    before: cinemaBefore,
    target,
    limit: candidateLimit * 2,
    fetchLatest: (fetchLimit, excludeItems) => getLatestCinemaUpdates({
      limit: fetchLimit,
      enrich: false,
      excludeItems,
    }),
    prepareItems: enrichCinemaItems,
    archiveItems: archiveCinemaUpdates,
    archiveOptions,
    today,
    isValidExisting: hasCompleteKoreanLocalization,
    curationPolicy: tabPolicies.cinema,
  });

  const updateReport = tabReport(updates, before);
  return {
    ok: true,
    cron: true,
    today,
    fetchedAt: updates.latest.fetchedAt,
    limit,
    target,
    ...updateReport,
    allTabsComplete: [updates, koreanCode, cinema].every((result) => result.todayItems.length >= target),
    koreanCode: tabReport(koreanCode, koreanBefore),
    cinema: tabReport(cinema, cinemaBefore),
  };
}
