import fs from "node:fs";
import path from "node:path";
import { selectBalancedReferences } from "./reference-lenses.mjs";
import { enrichWithContentInsight } from "./content-insight-core.mjs";
import {
  hasCompleteKoreanLocalization,
  isDegradedKoreanTranslation,
  localizeResearchFocus,
  makeRoleAwareKoreanFallback,
  translateToKorean,
} from "./korean-translation-core.mjs";
import { readBookmarkHistoryIndex } from "./bookmark-history-core.mjs";
import { getHistoryReserveCandidates } from "./history-reserve-core.mjs";
import { canonicalCurationUrl } from "./curation-policy.mjs";
import { isBlockedItem, resolveGoogleNewsSourceItems } from "./source-policy.mjs";
import { cleanFeedText } from "./article-text.mjs";

const updateSourcesPath = path.resolve("data/update-sources.json");
const requestTimeoutMs = 8000;
const lowSignalPatterns = [
  /\bcoupon\b/i,
  /\bcoupons\b/i,
  /\bpromo code\b/i,
  /\bdiscount code\b/i,
  /\bdiscount codes\b/i,
  /\bdeals?\b/i,
  /\bsave\b/i,
  /\bsitewide\b/i,
  /\bpercent off\b/i,
  /\b\d+%\s*off\b/i,
  /promo-code/i,
  /coupon-code/i,
  /discount-code/i,
  /\bsales?\b/i,
  /labor day/i,
  /black friday/i,
];

const nonCreativeNewsPatterns = [
  /\b(?:candidate|voters?|election|electoral|political|politician|senator|congress|parliament|minister|ministry|prime minister|governor|mayor)\b/i,
  /\b(?:lawsuit|indict|verdict|court ruling|tariffs?|sanctions?|inflation|interest rates?)\b/i,
  /\bappoints?\b.*\b(?:ceo|chief|president)\b/i,
  /\bnamed?\b.*\b(?:ceo|chief|president)\b/i,
  /\bsteps? down\b/i,
  /\blawsuit\b/i,
  /\bearnings\b/i,
  /\b(?:grant|fellowship)\b.*\b(?:applications?|apply|opened?|deadline)\b/i,
  /\b(?:applications?|apply|opened?|deadline)\b.*\b(?:grant|fellowship)\b/i,
  /\bopen call\b/i,
  /\btickets? (?:on )?sale\b/i,
  /\b(?:revenue|earnings|valuation|stock price|market cap)\b/i,
  /\b(?:conference|session|summit)\b.*\b(?:presents?|september|october|november|december|tickets?)\b/i,
  /\blifetime achievement award\b/i,
  /\bgradwatch\b/i,
];

const perspectiveTerms = [
  "interview", "analysis", "essay", "critique", "insight", "rethinks", "reimagines",
  "explores", "challenges", "new approach", "creative strategy", "design principle",
  "visual language", "cultural shift", "future of", "behind the scenes",
];

const transferableTerms = [
  "campaign", "commercial", "brand", "film", "animation", "cinematography", "directing",
  "editing", "sound", "vfx", "motion", "storytelling", "design", "typography", "photography",
  "installation", "exhibition", "architecture", "production", "workflow", "audience", "marketing",
  "strategy", "case study", "making of", "process",
];

const evidenceTerms = [
  "how", "why", "process", "method", "approach", "case study", "behind", "making of",
  "interview", "conversation", "explains", "reveals", "according to", "director", "designer",
  "studio", "creative director",
];

// Concrete creative artifacts keep general politics, business and celebrity news
// from passing merely because they contain words such as "campaign" or "strategy".
const creativeArtifactTerms = [
  "visual identity", "brand identity", "branding", "graphic design", "design system",
  "architecture", "interior", "typography", "typeface", "photography", "photographer",
  "film", "cinema", "animation", "cinematography", "vfx", "motion design", "music video",
  "short film", "commercial", "advertising", "advertisement", "installation", "exhibition",
  "artwork", "artist", "production design", "sound design", "editing", "poster", "packaging",
  "website", "interactive", "webgl", "three.js", "fashion", "set design", "motion",
  "illustration", "editorial design", "editorial", "ui", "ux", "annual report", "digital art",
  "sound-reactive", "portfolio",
];

// A case study can carry a useful point of view through visible making decisions
// even when its feed description never calls itself an interview or analysis.
const craftDecisionTerms = [
  "uses", "using", "combines", "mixes", "built", "builds", "constructed", "crafted",
  "designed", "transforms", "reframes", "features", "custom", "modular", "system",
  "grid", "layout", "palette", "material", "lighting", "camera", "lens", "sound",
  "composition", "sequence", "texture", "screenprint", "projection", "interaction",
  "webgl", "three.js", "typeface", "typography",
];

// v2: the deep reader judges substance, so this gate only removes noise.
export const creativeUpdateMinimumScore = 35;
const hardRejectReasons = new Set(["commercial-noise", "announcement-news", "insufficient-evidence"]);

function countTerms(text, terms) {
  return terms.filter((term) => text.includes(term)).length;
}

function daysSince(value) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - time) / 86400000);
}

function creativePillar(item = {}) {
  const lens = item.referenceLens || item.referenceLenses?.[0] || "";
  if (["moving-image-language", "exhibition-space"].includes(lens)) return "visual-language";
  if (["short-film-story", "production-craft"].includes(lens)) return "production-method";
  if (["brand-advertising", "strategy-planning"].includes(lens)) return "brand-planning";
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  if (/idea|concept|rethink|reimagin|approach|principle/.test(text)) return "idea-concept";
  return "culture-context";
}

export function evaluateCreativeUpdate(item = {}) {
  const title = String(item.title || "").trim();
  const summary = String(item.summary || "").trim();
  const text = `${title} ${summary} ${item.url || ""}`.toLowerCase();
  const rejectedBy = [
    ...lowSignalPatterns.filter((pattern) => pattern.test(text)).map(() => "commercial-noise"),
    ...nonCreativeNewsPatterns.filter((pattern) => pattern.test(text)).map(() => "announcement-news"),
  ];
  const perspectiveHits = countTerms(text, perspectiveTerms);
  const transferableHits = countTerms(text, transferableTerms);
  const evidenceHits = countTerms(text, evidenceTerms);
  const creativeArtifactHits = countTerms(text, creativeArtifactTerms);
  const craftDecisionHits = countTerms(text, craftDecisionTerms);
  const documentedCraftCase = summary.length >= 90
    && craftDecisionHits >= 1
    && evidenceHits >= 1
    && transferableHits >= 2;
  const age = daysSince(item.originalDate || item.date);
  const scores = {
    perspective: Math.min(30, perspectiveHits * 7 + craftDecisionHits * 4 + (perspectiveHits || craftDecisionHits ? 2 : 0)),
    transferability: Math.min(25, transferableHits * 4 + (transferableHits ? 5 : 0)),
    evidence: Math.min(20, (summary.length >= 90 ? 8 : summary.length >= 60 ? 4 : 0) + evidenceHits * 4 + (item.image ? 4 : 0)),
    contemporaneity: age <= 14 ? 15 : age <= 45 ? 11 : age <= 180 ? 6 : 2,
    trust: item.sourceLayer === "bookmark-up" ? 8 : 10,
  };
  const score = Object.values(scores).reduce((sum, value) => sum + value, 0);
  if (summary.length < 60 && evidenceHits === 0) rejectedBy.push("insufficient-evidence");
  if (transferableHits === 0) rejectedBy.push("not-transferable");
  if (creativeArtifactHits === 0) rejectedBy.push("outside-creative-practice");
  if (perspectiveHits === 0 && craftDecisionHits < 2 && !documentedCraftCase) {
    rejectedBy.push("no-creative-point-of-view");
  }
  const hardRejects = rejectedBy.filter((reason) => hardRejectReasons.has(reason));
  return {
    version: "creative-update-v1",
    score,
    minimumScore: creativeUpdateMinimumScore,
    eligible: hardRejects.length === 0 && score >= creativeUpdateMinimumScore,
    softFlags: rejectedBy.filter((reason) => !hardRejectReasons.has(reason)),
    pillar: creativePillar(item),
    scores,
    signals: {
      perspectiveHits,
      transferableHits,
      evidenceHits,
      creativeArtifactHits,
      craftDecisionHits,
      documentedCraftCase,
    },
    rejectedBy: [...new Set(rejectedBy)],
  };
}

export function isValidCreativeUpdate(item = {}) {
  return Boolean(
    item.creativeSelection?.version === "creative-update-v1"
    && item.creativeSelection.eligible
    && item.creativeSelection.score >= creativeUpdateMinimumScore
    && item.contentInsight?.role === "updates"
    && item.contentInsight.whatIsNew
    && item.contentInsight.whyItMatters
    && item.contentInsight.creativePrinciple
    && item.contentInsight.applicationQuestion
    && hasCompleteKoreanLocalization(item)
  );
}

function withCreativeSelection(item) {
  return { ...item, creativeSelection: evaluateCreativeUpdate(item) };
}

function decodeEntities(text = "") {
  let decoded = text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  decoded = decoded
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)));
  return decoded;
}

function stripHtml(text = "") {
  return decodeEntities(text.replace(/<[^>]*>/g, " "));
}

function getTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function getAtomLink(block) {
  const alternate = block.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i);
  const first = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return decodeEntities((alternate || first || [])[1] || "");
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

function getWpFeaturedImage(post) {
  const media = post?._embedded?.["wp:featuredmedia"]?.[0];
  return media?.media_details?.sizes?.medium_large?.source_url
    || media?.media_details?.sizes?.large?.source_url
    || media?.media_details?.sizes?.full?.source_url
    || media?.source_url
    || "";
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
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ko;q=0.8",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ReferenceSelectorUpdates/0.1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function localizeItem(item) {
  let [titleKo, summaryKo] = await Promise.all([
    translateToKorean(item.title),
    translateToKorean(item.summary || ""),
  ]);
  const usedLocalFallback = isDegradedKoreanTranslation(titleKo)
    || isDegradedKoreanTranslation(summaryKo);
  if (isDegradedKoreanTranslation(titleKo)) {
    titleKo = makeRoleAwareKoreanFallback(item, { role: "updates", kind: "title" });
  }
  if (isDegradedKoreanTranslation(summaryKo)) {
    summaryKo = makeRoleAwareKoreanFallback(item, { role: "updates", kind: "summary" });
  }
  const focusKo = localizeResearchFocus(item.focus || "");
  return enrichWithContentInsight({
    ...item,
    titleKo,
    summaryKo,
    focusKo,
    translationMode: usedLocalFallback ? "local-role-analysis" : "remote-translation",
  }, { role: "updates" });
}

export function localizeUpdateItems(items = []) {
  return Promise.all(items.map(localizeItem));
}

function parseFeed(xml, source, feedUrl) {
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const block = match[0];
    const title = getTag(block, "title");
    const link = getTag(block, "link") || getTag(block, "guid");
    const date = normalizeDate(getTag(block, "pubDate") || getTag(block, "dc:date"));
    const summary = cleanFeedText(stripHtml(getTag(block, "description") || getTag(block, "content:encoded"))).slice(0, 280);
    const image = getFirstImageUrl(block);
    const publisherName = getTag(block, "source");
    return { title, url: link, date, summary, image, publisherName };
  });

  const atomItems = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => {
    const block = match[0];
    const title = getTag(block, "title");
    const link = getAtomLink(block) || getTag(block, "id");
    const date = normalizeDate(getTag(block, "updated") || getTag(block, "published"));
    const summary = cleanFeedText(stripHtml(getTag(block, "summary") || getTag(block, "content"))).slice(0, 280);
    const image = getFirstImageUrl(block);
    return { title, url: link, date, summary, image };
  });

  return [...rssItems, ...atomItems]
    .filter((item) => item.title && item.url)
    .map((item) => ({
      id: `${source.id}-${item.url}`,
      sourceId: source.id,
      sourceName: item.publisherName || source.name,
      sourceUrl: source.url,
      focus: source.focus,
      referenceLenses: source.referenceLenses || [],
      sourceLayer: "editorial",
      feedUrl,
      title: item.title,
      url: new URL(item.url, source.url).href,
      date: item.date,
      dateLabel: item.date ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(item.date)) : "날짜 미확인",
      summary: item.summary,
      image: item.image || "",
    }));
}

function parseWordPressPosts(posts, source, jsonUrl) {
  if (!Array.isArray(posts)) return [];
  return posts
    .map((post) => {
      const title = stripHtml(post?.title?.rendered || "");
      const url = post?.link || post?.guid?.rendered || "";
      const date = normalizeDate(post?.date_gmt ? `${post.date_gmt}Z` : post?.date);
      const summary = stripHtml(post?.excerpt?.rendered || post?.content?.rendered || "").slice(0, 280);
      const image = getWpFeaturedImage(post);
      return { title, url, date, summary, image };
    })
    .filter((item) => item.title && item.url)
    .map((item) => ({
      id: `${source.id}-${item.url}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      focus: source.focus,
      referenceLenses: source.referenceLenses || [],
      sourceLayer: "editorial",
      feedUrl: jsonUrl,
      title: item.title,
      url: new URL(item.url, source.url).href,
      date: item.date,
      dateLabel: item.date ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(item.date)) : "날짜 미확인",
      summary: item.summary,
      image: item.image || "",
    }));
}

async function fetchSourceUpdates(source) {
  const feedUrls = source.feedUrls || [];
  for (const feedUrl of feedUrls) {
    try {
      const xml = await fetchText(feedUrl);
      const items = parseFeed(xml, source, feedUrl);
      if (items.length) return { ok: true, source: source.name, items };
    } catch {
      // Try the next declared feed URL.
    }
  }
  const jsonUrls = source.jsonUrls || [];
  for (const jsonUrl of jsonUrls) {
    try {
      const raw = await fetchText(jsonUrl);
      const items = parseWordPressPosts(JSON.parse(raw), source, jsonUrl);
      if (items.length) return { ok: true, source: source.name, items };
    } catch {
      // Try the next declared JSON URL.
    }
  }
  return { ok: false, source: source.name, items: [] };
}

function dedupe(items) {
  return Array.from(new Map(items.map((item) => [item.url, item])).values());
}

function isEditorialUpdate(item) {
  const haystack = `${item.title} ${item.summary} ${item.url}`;
  return !lowSignalPatterns.some((pattern) => pattern.test(haystack));
}

function isUsefulUpBookmarkItem(item) {
  const date = item.publishedAt || item.modifiedAt;
  const title = String(item.title || "").trim();
  const description = String(item.description || "").trim();
  if (!date || !title || title.length < 8) return false;
  if (title.toLowerCase() === String(item.host || "").toLowerCase()) return false;
  if (description.length < 60 && !item.image && item.kind !== "video") return false;
  return isEditorialUpdate({ ...item, summary: description });
}

export function getUpBookmarkUpdateCandidates({ limit = 100 } = {}) {
  const history = readBookmarkHistoryIndex();
  const editorialHosts = new Set(readUpdateSources().sources.map((source) => new URL(source.url).hostname.replace(/^www\./, "")));
  return history.items
    .filter((item) => item.sourceFolder === "up")
    .filter((item) => !editorialHosts.has(String(item.host || "").replace(/^www\./, "")))
    .filter(isUsefulUpBookmarkItem)
    .map((item) => {
      const date = item.publishedAt || item.modifiedAt;
      return {
        id: `bookmark-up-${item.id}`,
        sourceId: `bookmark-up:${item.host}`,
        sourceName: item.host,
        sourceUrl: item.sourceBookmarkUrl,
        sourceLayer: "bookmark-up",
        sourceFolder: "up",
        focus: "user-curated visual culture, film, design, advertising and creative research",
        referenceLenses: [],
        title: decodeEntities(item.title),
        url: item.url,
        date,
        originalDate: date,
        dateLabel: new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(new Date(date)),
        summary: stripHtml(item.description || ""),
        image: item.image || "",
        kind: item.kind || "web",
        trustReason: "Chrome 북마크 up 폴더에서 사용자가 직접 선별한 출처입니다.",
      };
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

function interleaveResearchLayers(editorialItems, bookmarkItems, limit) {
  const selected = [];
  let editorialIndex = 0;
  let bookmarkIndex = 0;
  while (selected.length < limit && (editorialIndex < editorialItems.length || bookmarkIndex < bookmarkItems.length)) {
    for (let count = 0; count < 2 && editorialIndex < editorialItems.length && selected.length < limit; count += 1) {
      selected.push(editorialItems[editorialIndex]);
      editorialIndex += 1;
    }
    if (bookmarkIndex < bookmarkItems.length && selected.length < limit) {
      selected.push(bookmarkItems[bookmarkIndex]);
      bookmarkIndex += 1;
    }
  }
  return selected;
}

export function readUpdateSources() {
  return JSON.parse(fs.readFileSync(updateSourcesPath, "utf8"));
}

export async function getLatestUpdates({ limit = 15, enrich = true, excludeItems = [] } = {}) {
  const startedAt = Date.now();
  const data = readUpdateSources();
  const results = await Promise.all(data.sources.map(fetchSourceUpdates));
  const excludedUrls = new Set(excludeItems.flatMap((item) => [item?.url, item?.googleNewsUrl])
    .filter(Boolean)
    .map(canonicalCurationUrl));
  const resolvedItems = await resolveGoogleNewsSourceItems(results.flatMap((result) => result.items), data.sources, { perSource: 12 });
  const editorialCandidates = dedupe(resolvedItems)
    .filter((item) => !excludedUrls.has(canonicalCurationUrl(item.url)))
    .filter((item) => !isBlockedItem(item))
    .filter(isEditorialUpdate)
    .map(withCreativeSelection)
    .filter((item) => item.creativeSelection.eligible)
    .sort((a, b) => {
      const scoreDiff = b.creativeSelection.score - a.creativeSelection.score;
      if (scoreDiff) return scoreDiff;
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      return bTime - aTime;
    });
  const bookmarkQuota = Math.min(Math.max(1, Math.floor(limit / 3)), limit);
  const upCandidates = getUpBookmarkUpdateCandidates({ limit: Math.max(bookmarkQuota * 20, 100) });
  const historyReserve = getHistoryReserveCandidates("updates", {
    limit: Math.max(limit * 4, 300),
    excludeItems,
  });
  const bookmarkCandidates = dedupe([...upCandidates, ...historyReserve])
    .filter((item) => !excludedUrls.has(canonicalCurationUrl(item.url)))
    .filter((item) => !isBlockedItem(item))
    .map(withCreativeSelection)
    .filter((item) => item.creativeSelection.eligible)
    .sort((a, b) => b.creativeSelection.score - a.creativeSelection.score);
  const editorialSelected = selectBalancedReferences(editorialCandidates, limit);
  // The up-folder history is intentionally deeper than a live RSS page. Keep
  // diversity, but allow two strong cases per trusted host so a quiet news day
  // does not leave the daily edition underfilled.
  const bookmarkSelected = selectBalancedReferences(bookmarkCandidates, bookmarkQuota, { maxPerSource: 2 });
  const selected = interleaveResearchLayers(editorialSelected, bookmarkSelected, limit);
  const items = enrich ? await localizeUpdateItems(selected) : selected;

  const groups = [];
  for (const item of items) {
    const label = item.dateLabel;
    let group = groups.find((entry) => entry.dateLabel === label);
    if (!group) {
      group = { dateLabel: label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  return {
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    sourceCount: data.sources.length,
    okSourceCount: results.filter((result) => result.ok).length,
    failedSources: results.filter((result) => !result.ok).map((result) => result.source),
    sourceLayers: {
      editorial: selected.filter((item) => item.sourceLayer === "editorial").length,
      bookmarkUp: selected.filter((item) => item.sourceLayer === "bookmark-up").length,
    },
    limit,
    items,
    groups,
  };
}
