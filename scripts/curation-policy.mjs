const titleStopWords = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "with", "from", "by",
  "this", "that", "how", "why", "what", "new", "latest", "review", "interview", "article",
  "및", "와", "과", "의", "을", "를", "이", "가", "에", "에서", "위한", "관련", "기사", "리뷰", "인터뷰",
]);

function normalizeTitleTokens(item = {}) {
  return String(item.titleKo || item.articleTitle || item.title || "")
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.filter((token) => !titleStopWords.has(token)) || [];
}

export function canonicalCurationUrl(value = "") {
  try {
    const url = new URL(value);
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") || url.port === "80") url.port = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$|lang$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return String(value).trim();
  }
}

export function curationTitleKey(item = {}) {
  return String(item.titleKo || item.articleTitle || item.title || "")
    .toLowerCase()
    .replace(/\s*[-–—|]\s*(?:frieze|프리즈|dezeen|designboom|vogue|코리아타임스|the korea times|koreaherald\.com|frieze\.com)\s*$/iu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleSimilarity(left, right) {
  const a = new Set(normalizeTitleTokens(left));
  const b = new Set(normalizeTitleTokens(right));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  if (shared < 3) return 0;
  return shared / Math.min(a.size, b.size);
}

function sourceKey(item = {}) {
  return String(item.sourceName || item.sourceId || item.host || "unknown").toLowerCase();
}

export function selectNovelItems(candidates = [], archivedItems = [], limit = 15, options = {}) {
  const {
    maxPerSource = Number.POSITIVE_INFINITY,
    fallbackMaxPerSource = maxPerSource,
    semanticThreshold = 0.82,
    semanticArchiveWindow = 0,
    seedItems = [],
  } = options;
  const itemKeys = (item) => [item?.url, item?.googleNewsUrl].filter(Boolean).map(canonicalCurationUrl);
  const archivedUrls = new Set(archivedItems.flatMap(itemKeys));
  const archivedTitles = new Set(archivedItems.map(curationTitleKey).filter(Boolean));
  const selected = [];
  const selectedUrls = new Set(seedItems.flatMap(itemKeys));
  const selectedTitles = new Set(seedItems.map(curationTitleKey).filter(Boolean));
  const comparisonItems = [...seedItems, ...archivedItems.slice(0, semanticArchiveWindow)];
  const sourceCounts = new Map();
  for (const item of seedItems) {
    const key = sourceKey(item);
    sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
  }

  const collect = (allowedPerSource) => {
    for (const item of candidates) {
      const keys = itemKeys(item);
      const titleKey = curationTitleKey(item);
      if (!keys.length || keys.some((key) => archivedUrls.has(key) || selectedUrls.has(key))) continue;
      if (titleKey && (archivedTitles.has(titleKey) || selectedTitles.has(titleKey))) continue;
      const source = sourceKey(item);
      if ((sourceCounts.get(source) || 0) >= allowedPerSource) continue;
      if (comparisonItems.some((existing) => titleSimilarity(item, existing) >= semanticThreshold)) continue;
      selected.push(item);
      keys.forEach((key) => selectedUrls.add(key));
      if (titleKey) selectedTitles.add(titleKey);
      comparisonItems.push(item);
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
      if (selected.length >= limit) break;
    }
  };

  collect(maxPerSource);
  if (selected.length < limit && fallbackMaxPerSource > maxPerSource) {
    collect(fallbackMaxPerSource);
  }

  return selected;
}

export function semanticCurationStats(items = []) {
  let nearDuplicatePairs = 0;
  for (let index = 0; index < items.length; index += 1) {
    for (let compare = index + 1; compare < items.length; compare += 1) {
      if (titleSimilarity(items[index], items[compare]) >= 0.82) nearDuplicatePairs += 1;
    }
  }
  const sourceCounts = {};
  for (const item of items) {
    const key = sourceKey(item);
    sourceCounts[key] = (sourceCounts[key] || 0) + 1;
  }
  return {
    nearDuplicatePairs,
    sourceCounts,
    maxPerSource: Math.max(0, ...Object.values(sourceCounts)),
  };
}

export function curationStats(items = []) {
  const urls = new Set(items.map((item) => canonicalCurationUrl(item.url)).filter(Boolean));
  return {
    items: items.length,
    uniqueUrls: urls.size,
    duplicates: Math.max(0, items.length - urls.size),
  };
}
