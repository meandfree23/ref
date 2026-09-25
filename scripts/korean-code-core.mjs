import fs from "node:fs";
import path from "node:path";
import googleNewsUrlDecoder from "google-news-url-decoder";
import { enrichWithContentInsight } from "./content-insight-core.mjs";
import {
  isDegradedKoreanTranslation,
  localizeResearchFocus,
  makeRoleAwareKoreanFallback,
  translateToKorean,
} from "./korean-translation-core.mjs";
import { getHistoryReserveCandidates } from "./history-reserve-core.mjs";
import { canonicalCurationUrl } from "./curation-policy.mjs";
import { isBlockedItem } from "./source-policy.mjs";

// Google News search results older than this are almost always stale
// re-surfacings; user bookmarks are exempt because they are chosen on purpose.
const staleNewsDays = 540;
function isStaleNewsItem(item = {}) {
  if (item.sourceLayer === "bookmark-history" || item.sourceLayer === "bookmark-up") return false;
  const original = item.originalDate || item.date;
  if (!original) return false;
  const age = (Date.now() - new Date(original).getTime()) / 86400000;
  return Number.isFinite(age) && age > staleNewsDays;
}

const { GoogleDecoder } = googleNewsUrlDecoder;

const sourcesPath = path.resolve("data/korean-code-sources.json");
const seedPath = path.resolve("public/korean-code.js");
const requestTimeoutMs = 8000;

const qualityTerms = [
  "interview",
  "analysis",
  "artist",
  "director",
  "method",
  "practice",
  "studio",
  "exhibition",
  "review",
  "profile",
  "conversation",
  "behind",
  "process",
  "creator",
];

const trustedSignalTerms = [
  "bfi",
  "criterion",
  "mubi",
  "frieze",
  "artasiapacific",
  "ocula",
  "tate",
  "m+",
  "guggenheim",
  "dezeen",
  "designboom",
  "cannes lions",
  "korea joongang daily",
  "korean cultural center",
  "the korea society",
  "vogue",
  "wallpaper",
  "business of fashion",
  "monocle",
  "artforum",
  "metropolis",
];

const koreanTerms = [
  "korean",
  "korea",
  "seoul",
  "bong joon",
  "park chan",
  "koo bohnchang",
  "do ho suh",
  "lee bul",
  "haegue yang",
  "park seo-bo",
  "kim tschang",
  "minsuk cho",
  "hanok",
  "busan",
  "jeju",
  "k-fashion",
  "korean food",
  "korean literature",
  "korean game",
  "webtoon",
  "k-pop",
  "kpop",
];

const lowSignalPatterns = [
  /\bcoupon\b/i,
  /\bpromo\b/i,
  /\bticket\b/i,
  /\bwhere to watch\b/i,
  /\btrailer\b/i,
  /\bbox office\b/i,
  /\bcast\b/i,
  /\bcelebrity\b/i,
  /\banne hathaway\b/i,
  /\bfacebook\.com\b/i,
  /\bkoreaboo\b/i,
  /\bkpoppost\b/i,
  /\bimdb\b/i,
  /\bstarnewskorea\b/i,
  /\bchosunbiz\b/i,
  /\ballkpop\b/i,
  /\bsoompi\b/i,
  /\bshopping\b/i,
  /\bsale\b/i,
  /\bproducts? to know\b/i,
  /\bbest korean (?:skin|beauty|fashion)\b/i,
  /\bpage \d+\b/i,
  /^\s*\[photo\]/i,
];

function decodeEntities(text = "") {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(text = "") {
  return decodeEntities(text.replace(/<[^>]*>/g, " "));
}

function getTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function getFirstImageUrl(block) {
  const candidates = [
    block.match(/<enclosure[^>]+url=["']([^"']+)["']/i),
    block.match(/<media:content[^>]+url=["']([^"']+)["']/i),
    block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i),
    block.match(/<img[^>]+src=["']([^"']+)["']/i),
  ];

  for (const candidate of candidates) {
    if (candidate?.[1]) return decodeEntities(candidate[1]);
  }
  return "";
}

function getMetaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"));
  const contentFirst = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"));
  return decodeEntities((propertyFirst || contentFirst || [])[1] || "");
}

function isGoogleNewsUrl(url) {
  try {
    return new URL(url).hostname === "news.google.com";
  } catch {
    return false;
  }
}

function isUsableArticleImage(image = "") {
  if (!image) return false;
  try {
    const parsed = new URL(image);
    const path = parsed.pathname.toLowerCase();
    if (parsed.hostname === "lh3.googleusercontent.com") return false;
    if (parsed.hostname === "lh3.googleusercontent.com" && path.includes("-dr60l-")) return false;
    if (parsed.hostname === "lh3.googleusercontent.com" && parsed.searchParams.get("w") === "256") return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchPageMetadata(url) {
  if (!url || !/^https?:\/\//i.test(url) || isGoogleNewsUrl(url)) return { image: "", summary: "" };
  try {
    const html = await fetchText(url);
    if (/sorry, you have been blocked|performing security verification|why have i been blocked|cf-chl-/i.test(html)) {
      return { image: "", summary: "" };
    }
    const image = getMetaContent(html, "og:image")
      || getMetaContent(html, "twitter:image")
      || getMetaContent(html, "twitter:image:src")
      || getFirstImageUrl(html);
    const summary = getMetaContent(html, "og:description")
      || getMetaContent(html, "twitter:description")
      || getMetaContent(html, "description");
    const absoluteImage = image ? new URL(image, url).href : "";
    return {
      image: isUsableArticleImage(absoluteImage) ? absoluteImage : "",
      summary: stripHtml(summary).slice(0, 420),
    };
  } catch {
    return { image: "", summary: "" };
  }
}

function normalizeDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ko;q=0.8",
        "user-agent": "Mozilla/5.0 ReferenceSelectorKoreanCode/0.1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function cleanSummary(summary = "", title = "", sourceName = "") {
  let cleaned = decodeEntities(summary)
    .replace(/\s+/g, " ")
    .trim();
  const sourcePattern = sourceName ? new RegExp(`\\s+${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") : null;
  if (sourcePattern) cleaned = cleaned.replace(sourcePattern, "").trim();
  const titleCore = title.replace(/\s+-\s+[^-]+$/, "").trim();
  if (cleaned.toLowerCase() === title.toLowerCase()) return "";
  if (cleaned.toLowerCase() === titleCore.toLowerCase()) return "";
  return cleaned;
}

function isSameMeaning(a = "", b = "") {
  const normalize = (value) => value
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
  const left = normalize(a);
  const right = normalize(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function makeFallbackSummary(item, titleKo) {
  const field = item.field || "창작";
  const source = item.sourceName || "원문";
  return `${source}에서 스크랩한 ${field} 관련 기사로, 제목의 쟁점을 중심으로 한국적 소재와 국제적 맥락을 함께 확인할 수 있습니다.`;
}

function parseFeed(xml, source, feedUrl) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => {
      const block = match[0];
      const title = getTag(block, "title");
      const link = getTag(block, "link") || getTag(block, "guid");
      const date = normalizeDate(getTag(block, "pubDate") || getTag(block, "dc:date"));
      const summary = stripHtml(getTag(block, "description") || getTag(block, "content:encoded")).slice(0, 320);
      const image = getFirstImageUrl(block);
      const publisherName = getTag(block, "source");
      return {
        id: `${source.id}-${link}`,
        sourceId: source.id,
        sourceName: publisherName || source.name,
        curationSourceName: source.name,
        sourceUrl: source.url,
        field: source.field,
        focus: source.focus,
        feedUrl,
        title,
        articleTitle: title,
        url: link,
        date,
        summary,
        image,
        googleNewsUrl: isGoogleNewsUrl(link) ? link : "",
      };
    })
    .filter((item) => item.title && item.url);
}

async function fetchSource(source) {
  const items = [];
  for (const feedUrl of source.feedUrls || []) {
    try {
      const xml = await fetchText(feedUrl);
      items.push(...parseFeed(xml, source, feedUrl));
    } catch {
      // Keep trying other query feeds for this source.
    }
  }
  return items.length ? { ok: true, source: source.name, items } : { ok: false, source: source.name, items: [] };
}

function scoreItem(item) {
  const text = `${item.title} ${item.summary} ${item.url}`.toLowerCase();
  const qualityHits = qualityTerms.filter((term) => text.includes(term));
  const koreanHits = koreanTerms.filter((term) => text.includes(term));
  const trustedHits = trustedSignalTerms.filter((term) => text.includes(term));
  const lowHits = lowSignalPatterns.filter((pattern) => pattern.test(text));
  const bookmarkTrust = item.sourceLayer === "bookmark-history" || item.sourceLayer === "bookmark-up";
  const score = qualityHits.length * 8 + koreanHits.length * 10 + trustedHits.length * 14
    + (bookmarkTrust ? 14 : 0) - lowHits.length * 24;
  return { score, qualityHits, koreanHits, trustedHits, bookmarkTrust, lowHits };
}

async function enrichItem(item, scrapedAt) {
  const quality = scoreItem(item);
  const articleImage = isUsableArticleImage(item.image) ? item.image : "";
  const imageKind = articleImage ? (item.imageKind === "page-preview" ? "page-preview" : "article") : "";
  const summary = cleanSummary(item.summary, item.title, item.sourceName);
  let [titleKo, translatedSummary] = await Promise.all([
    translateToKorean(item.title),
    translateToKorean(summary),
  ]);
  const usedLocalFallback = isDegradedKoreanTranslation(titleKo)
    || isDegradedKoreanTranslation(translatedSummary);
  if (isDegradedKoreanTranslation(titleKo)) {
    titleKo = makeRoleAwareKoreanFallback({ ...item, summary }, { role: "korean-code", kind: "title" });
  }
  if (isDegradedKoreanTranslation(translatedSummary)) {
    translatedSummary = makeRoleAwareKoreanFallback({ ...item, summary }, { role: "korean-code", kind: "summary" });
  }
  const focusKo = localizeResearchFocus(item.focus || "");
  const summaryKo = translatedSummary && !isSameMeaning(translatedSummary, titleKo)
    ? translatedSummary
    : makeFallbackSummary(item, titleKo);
  return enrichWithContentInsight({
    ...item,
    summary,
    originalDate: item.originalDate || item.date || null,
    date: scrapedAt,
    dateLabel: new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(scrapedAt)),
    image: articleImage,
    imageKind,
    imageLabel: imageKind === "page-preview" ? "원문 페이지 미리보기" : (articleImage ? "원문 이미지" : ""),
    imageSourceName: articleImage ? item.sourceName : "",
    imageSourceUrl: articleImage ? item.url : "",
    titleKo,
    summaryKo,
    focusKo,
    translationMode: usedLocalFallback ? "local-role-analysis" : "remote-translation",
    code: "실제 기사 안에서 한국적 경험이 어떤 창작 방식으로 번역되는지 확인할 후보",
    insight: summaryKo || summary || "기사 본문 확인이 필요한 Korean Code 후보입니다.",
    creativeUse: "원문을 열어 창작자의 방법론, 비평적 해석, 한국성과 세계성의 결합 방식을 추출합니다.",
    mixCode: "한국적 소재/정서와 해외 매체, 시장, 장르, 기술 언어가 만나는 지점을 확인합니다.",
    globalSignal: `${item.sourceName} 쿼리에서 수집된 기사 후보`,
    koreanCodeQuality: {
      score: quality.score,
      qualityHits: quality.qualityHits,
      koreanHits: quality.koreanHits,
      trustedHits: quality.trustedHits,
      lowSignalHits: quality.lowHits.length,
    },
  }, { role: "korean-code" });
}

function isUsablePublisherUrl(url = "") {
  if (!url || !/^https?:\/\//i.test(url) || isGoogleNewsUrl(url)) return false;
  try {
    return !["google.com", "www.google.com"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function decodeGoogleNewsItems(items = []) {
  const googleUrls = [...new Set(items.map((item) => item.googleNewsUrl || item.url).filter(isGoogleNewsUrl))];
  if (!googleUrls.length) return items;

  const decoder = new GoogleDecoder();
  const decoded = [];
  const queue = [...googleUrls];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const sourceUrl = queue.shift();
      try {
        const result = await decoder.decode(sourceUrl);
        decoded.push({ ...result, source_url: sourceUrl });
      } catch {
        decoded.push({ status: false, source_url: sourceUrl });
      }
    }
  });
  await Promise.all(workers);

  if (!decoded.length) {
    return items;
  }
  const publisherUrls = new Map(decoded
    .filter((result) => result?.status && isUsablePublisherUrl(result.decoded_url))
    .map((result) => [result.source_url, result.decoded_url]));

  return items.map((item) => {
    const googleNewsUrl = item.googleNewsUrl || (isGoogleNewsUrl(item.url) ? item.url : "");
    const publisherUrl = publisherUrls.get(googleNewsUrl);
    return publisherUrl
      ? { ...item, googleNewsUrl, url: publisherUrl }
      : item;
  });
}

export async function repairKoreanCodeArticleAssets(items = []) {
  const resolved = await decodeGoogleNewsItems(items);
  return Promise.all(resolved.map(async (item) => {
    const feedImage = isUsableArticleImage(item.image) ? item.image : "";
    const feedSummary = cleanSummary(item.summary, item.title, item.sourceName);
    const page = (!feedImage || !feedSummary)
      ? await fetchPageMetadata(item.url)
      : { image: "", summary: "" };
    const articleImage = feedImage || page.image;
    const imageKind = articleImage ? "article" : "";
    return {
      ...item,
      summary: feedSummary || page.summary || "",
      image: articleImage,
      imageKind,
      imageLabel: articleImage ? "원문 이미지" : "",
      imageSourceName: articleImage ? item.sourceName : "",
      imageSourceUrl: articleImage ? item.url : "",
    };
  }));
}

export async function enrichKoreanCodeItems(items = [], { scrapedAt = new Date().toISOString() } = {}) {
  const withAssets = await repairKoreanCodeArticleAssets(items);
  return Promise.all(withAssets.map((item) => enrichItem(item, scrapedAt)));
}

function dedupe(items) {
  return Array.from(new Map(items.map((item) => [item.url, item])).values());
}

function selectBalancedItems(items, limit, key = "field") {
  const groups = new Map();
  for (const item of items) {
    const groupKey = item[key] || "기타";
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(item);
  }

  const selected = [];
  while (selected.length < limit && groups.size) {
    for (const [groupKey, groupItems] of [...groups]) {
      const next = groupItems.shift();
      if (next) selected.push(next);
      if (!groupItems.length) groups.delete(groupKey);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

export function readKoreanCodeSources() {
  return JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
}

export function readKoreanCodeSeed() {
  const text = fs.readFileSync(seedPath, "utf8");
  const match = text.match(/window\.__KOREAN_CODE_RESEARCH__ = ([\s\S]*);\s*$/);
  if (!match) return { items: [] };
  const seed = Function(`"use strict"; return (${match[1]});`)();
  return {
    ...seed,
    items: (seed.items || []).map((item) => ({
      ...item,
      sourceId: item.sourceId || "korean-code-seed",
      sourceName: item.sourceName || "Korean Code Seed",
      focus: item.focus || item.field || "Korean Code",
      date: item.date || seed.updatedAt,
      titleKo: item.titleKo || item.title,
      summaryKo: item.summaryKo || item.insight || item.summary,
    })),
  };
}

export async function getLatestKoreanCodeUpdates({
  limit = 30,
  enrich = true,
  minimumScore = 24,
  excludeItems = [],
} = {}) {
  const startedAt = Date.now();
  const scrapedAt = new Date().toISOString();
  const data = readKoreanCodeSources();
  const results = await Promise.all(data.queries.map(fetchSource));
  const excludedUrls = new Set(excludeItems.flatMap((item) => [item?.url, item?.googleNewsUrl])
    .filter(Boolean)
    .map(canonicalCurationUrl));
  const historyReserve = getHistoryReserveCandidates("koreanCode", {
    limit: Math.max(limit * 2, 300),
    excludeItems,
  });
  const rankedCandidates = dedupe([...results.flatMap((result) => result.items), ...historyReserve])
    .filter((item) => !excludedUrls.has(canonicalCurationUrl(item.url)))
    .filter((item) => !isBlockedItem(item))
    .filter((item) => !isStaleNewsItem(item))
    .map((item) => ({ item, quality: scoreItem(item) }))
    .filter(({ quality }) => quality.lowHits.length === 0)
    .filter(({ quality }) => quality.koreanHits.length > 0)
    .filter(({ quality }) => quality.qualityHits.length > 0 || quality.trustedHits.length > 0 || quality.bookmarkTrust)
    .filter(({ quality }) => quality.score >= minimumScore)
    .sort((a, b) => {
      if (b.quality.score !== a.quality.score) return b.quality.score - a.quality.score;
      const aTime = a.item.date ? new Date(a.item.date).getTime() : 0;
      const bTime = b.item.date ? new Date(b.item.date).getTime() : 0;
      return bTime - aTime;
    })
    .map(({ item }) => item);
  const candidates = selectBalancedItems(rankedCandidates, limit);
  const items = enrich ? await enrichKoreanCodeItems(candidates, { scrapedAt }) : candidates;

  return {
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    sourceCount: data.queries.length,
    okSourceCount: results.filter((result) => result.ok).length,
    failedSources: results.filter((result) => !result.ok).map((result) => result.source),
    limit,
    items,
  };
}
