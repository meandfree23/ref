import fs from "node:fs";
import path from "node:path";
import { enrichWithContentInsight } from "./content-insight-core.mjs";
import {
  isDegradedKoreanTranslation,
  localizeResearchFocus,
  makeRoleAwareKoreanFallback,
  translateToKorean,
} from "./korean-translation-core.mjs";
import { getHistoryReserveCandidates } from "./history-reserve-core.mjs";
import { canonicalCurationUrl } from "./curation-policy.mjs";

const sourcesPath = path.resolve("data/cinema-sources.json");
const requestTimeoutMs = 8000;

const qualityTerms = [
  "interview",
  "criticism",
  "review",
  "essay",
  "filmmaking",
  "director",
  "cinema",
  "auteur",
  "craft",
  "archive",
  "retrospective",
  "podcast",
  "history",
  "screenplay",
  "image",
  "art",
];

const lowSignalPatterns = [
  /\btrailer\b/i,
  /\bbox office\b/i,
  /\bwhere to watch\b/i,
  /\bcoupon\b/i,
  /\bpromo\b/i,
  /\bticket\b/i,
  /\bcast\b/i,
  /\bcelebrity\b/i,
  /\bstreaming schedule\b/i,
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
        accept: "application/rss+xml, application/xml, text/xml, text/html, */*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ko;q=0.8",
        "user-agent": "Mozilla/5.0 ReferenceSelectorCinema/0.1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function cleanSummary(summary = "", title = "") {
  const cleaned = decodeEntities(summary)
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.toLowerCase() === title.toLowerCase()) return "";
  return cleaned;
}

async function fetchPageImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    const html = await fetchText(url);
    const image = getMetaContent(html, "og:image")
      || getMetaContent(html, "twitter:image")
      || getMetaContent(html, "twitter:image:src")
      || getFirstImageUrl(html);
    return image ? new URL(image, url).href : "";
  } catch {
    return "";
  }
}

function parseFeed(xml, source, feedUrl) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match) => {
      const block = match[0];
      const title = getTag(block, "title");
      const url = getTag(block, "link") || getTag(block, "guid");
      const originalDate = normalizeDate(getTag(block, "pubDate") || getTag(block, "dc:date"));
      const summary = stripHtml(getTag(block, "description") || getTag(block, "content:encoded")).slice(0, 340);
      const image = getFirstImageUrl(block);
      return {
        id: `${source.id}-${url}`,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        field: source.field,
        focus: source.focus,
        feedUrl,
        title,
        articleTitle: title,
        url,
        originalDate,
        summary,
        image,
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
      // Keep trying the remaining feeds for this source.
    }
  }
  return items.length ? { ok: true, source: source.name, items } : { ok: false, source: source.name, items: [] };
}

function scoreItem(item) {
  const text = `${item.title} ${item.summary} ${item.url}`.toLowerCase();
  const qualityHits = qualityTerms.filter((term) => text.includes(term));
  const lowHits = lowSignalPatterns.filter((pattern) => pattern.test(text));
  return qualityHits.length * 8 - lowHits.length * 24 + (item.image ? 8 : 0);
}

function isEditorialCinema(item) {
  const text = `${item.title} ${item.summary} ${item.url}`;
  return !lowSignalPatterns.some((pattern) => pattern.test(text));
}

function dedupe(items) {
  return Array.from(new Map(items.map((item) => [item.url, item])).values());
}

async function enrichItem(item, scrapedAt) {
  const articleImage = item.image || await fetchPageImage(item.url);
  const summary = cleanSummary(item.summary, item.title);
  let [titleKo, summaryKo] = await Promise.all([
    translateToKorean(item.title),
    translateToKorean(summary || item.summary || item.title),
  ]);
  const usedLocalFallback = isDegradedKoreanTranslation(titleKo)
    || isDegradedKoreanTranslation(summaryKo);
  if (isDegradedKoreanTranslation(titleKo)) {
    titleKo = makeRoleAwareKoreanFallback({ ...item, summary }, { role: "cinema", kind: "title" });
  }
  if (isDegradedKoreanTranslation(summaryKo)) {
    summaryKo = makeRoleAwareKoreanFallback({ ...item, summary }, { role: "cinema", kind: "summary" });
  }
  const focusKo = localizeResearchFocus(item.focus || "");
  return enrichWithContentInsight({
    ...item,
    summary,
    date: scrapedAt,
    dateLabel: new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(scrapedAt)),
    originalDate: item.originalDate || null,
    image: articleImage,
    imageKind: articleImage ? "article" : "",
    imageLabel: articleImage ? "원문 이미지" : "",
    imageSourceName: articleImage ? item.sourceName : "",
    imageSourceUrl: articleImage ? item.url : "",
    titleKo,
    summaryKo,
    focusKo,
    translationMode: usedLocalFallback ? "local-role-analysis" : "remote-translation",
    code: "영화가 이미지, 시간, 몸, 철학, 사회 감각을 하나의 예술 언어로 조직하는 방식을 확인합니다.",
    insight: summaryKo || summary || "본문 확인이 필요한 영화 리서치 후보입니다.",
    creativeUse: "연출, 편집, 사운드, 미장센, 서사 구조, 비평 언어를 창작 레퍼런스로 전환합니다.",
    globalSignal: `${item.sourceName}에서 수집된 영화 비평/인터뷰 후보`,
    cinemaQualityScore: scoreItem(item),
  }, { role: "cinema" });
}

export function enrichCinemaItems(items = [], { scrapedAt = new Date().toISOString() } = {}) {
  return Promise.all(items.map((item) => enrichItem(item, scrapedAt)));
}

export function readCinemaSources() {
  return JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
}

export async function getLatestCinemaUpdates({ limit = 30, enrich = true, excludeItems = [] } = {}) {
  const startedAt = Date.now();
  const scrapedAt = new Date().toISOString();
  const data = readCinemaSources();
  const results = await Promise.all(data.sources.map(fetchSource));
  const excludedUrls = new Set(excludeItems.flatMap((item) => [item?.url, item?.googleNewsUrl])
    .filter(Boolean)
    .map(canonicalCurationUrl));
  const historyReserve = getHistoryReserveCandidates("cinema", {
    limit: Math.max(limit * 2, 300),
    excludeItems,
  });
  const candidates = dedupe([...results.flatMap((result) => result.items), ...historyReserve])
    .filter((item) => !excludedUrls.has(canonicalCurationUrl(item.url)))
    .filter(isEditorialCinema)
    .sort((a, b) => {
      const scoreDiff = scoreItem(b) - scoreItem(a);
      if (scoreDiff) return scoreDiff;
      const aTime = a.originalDate ? new Date(a.originalDate).getTime() : 0;
      const bTime = b.originalDate ? new Date(b.originalDate).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);
  const items = enrich ? await enrichCinemaItems(candidates, { scrapedAt }) : candidates;

  return {
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    sourceCount: data.sources.length,
    okSourceCount: results.filter((result) => result.ok).length,
    failedSources: results.filter((result) => !result.ok).map((result) => result.source),
    limit,
    items,
  };
}
