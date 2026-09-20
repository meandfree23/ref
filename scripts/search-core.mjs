import { readSourceDataset } from "./sources-core.mjs";
import { deriveContentInsight } from "./content-insight-core.mjs";
import {
  analyzeIntent,
  buildRecommendation,
  getSourceProfile,
  profileBoost,
  summarizeNetwork,
} from "./curation-core.mjs";

const maxConcurrent = 16;
const requestTimeoutMs = 5000;
const maxResults = 48;
const visualSourceLimit = 32;
const lowSignalPatterns = [
  /\bcoupon\b/i,
  /\bcoupons\b/i,
  /\bpromo code\b/i,
  /\bdiscount code\b/i,
  /\bdiscount codes\b/i,
  /\bdeals?\b/i,
  /\bsale\b/i,
  /\b\d+%\s*off\b/i,
  /promo-code/i,
  /coupon-code/i,
  /discount-code/i,
  /utm_(source|medium|campaign)=.*coupon/i,
];

const conceptLexicon = new Map([
  ["네이티브", ["native", "app", "ios", "android", "mobile", "swift", "kotlin", "react native", "flutter"]],
  ["코딩", ["code", "coding", "development", "developer", "programming", "interaction", "prototype"]],
  ["자연어", ["natural language", "plain language", "prompt", "ai", "검색", "질문"]],
  ["일상언어", ["plain language", "natural language", "conversation", "chat", "prompt"]],
  ["레퍼런스", ["reference", "inspiration", "case study", "portfolio", "gallery"]],
  ["이미지", ["image", "photo", "photography", "visual", "picture", "gallery"]],
  ["영상", ["video", "film", "motion", "youtube", "vimeo", "reel"]],
  ["작가", ["artist", "photographer", "designer", "director", "creator", "portfolio"]],
  ["브랜드", ["brand", "branding", "campaign", "identity", "advertising"]],
  ["패션", ["fashion", "editorial", "lookbook", "style", "model"]],
  ["공간", ["space", "architecture", "interior", "exhibition", "installation"]],
  ["광고", ["advertising", "campaign", "commercial", "marketing", "adage"]],
  ["웹사이트", ["website", "web design", "landing page", "ux", "ui"]],
  ["인사이트", ["insight", "trend", "analysis", "interview", "article", "story"]],
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function expandQuery(query) {
  const rawTokens = tokenize(query);
  const terms = new Set(rawTokens);
  const lowered = query.toLowerCase();

  for (const [key, expansions] of conceptLexicon) {
    if (lowered.includes(key) || expansions.some((term) => lowered.includes(term))) {
      terms.add(key);
      expansions.forEach((term) => tokenize(term).forEach((token) => terms.add(token)));
    }
  }

  return Array.from(terms);
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html) {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function absoluteUrl(value, base) {
  if (!value) return null;
  try {
    return new URL(decodeEntities(value), base).href;
  } catch {
    return null;
  }
}

function isUsefulMedia(url) {
  if (!url || url.startsWith("data:")) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (["facebook.com", "ct.pinterest.com", "scorecardresearch.com"].includes(host)) return false;
    if (parsed.pathname.includes("pixel") || parsed.pathname.includes("tracking")) return false;
    return true;
  } catch {
    return false;
  }
}

function firstMatch(html, pattern) {
  const match = html.match(pattern);
  return match ? decodeEntities(match[1]) : "";
}

function collectMatches(html, pattern, base, limit = 8) {
  const matches = [];
  for (const match of html.matchAll(pattern)) {
    const resolved = absoluteUrl(match[1], base);
    if (resolved && !matches.includes(resolved)) matches.push(resolved);
    if (matches.length >= limit) break;
  }
  return matches;
}

function extractPage(html, bookmark) {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    bookmark.title;
  const description = firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const ogImage = firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const ogVideo = firstMatch(html, /<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/i);
  const images = [
    absoluteUrl(ogImage, bookmark.url),
    ...collectMatches(html, /<img[^>]+src=["']([^"']+)["']/gi, bookmark.url, 12),
  ].filter(isUsefulMedia);
  const videos = [
    absoluteUrl(ogVideo, bookmark.url),
    ...collectMatches(html, /<video[^>]+src=["']([^"']+)["']/gi, bookmark.url, 5),
    ...collectMatches(html, /<iframe[^>]+src=["']([^"']*(?:youtube|vimeo)[^"']*)["']/gi, bookmark.url, 5),
  ].filter(isUsefulMedia);
  const text = stripHtml(html).slice(0, 30000);

  return {
    ...bookmark,
    title: title || bookmark.title,
    description,
    text,
    image: images[0] || null,
    images: Array.from(new Set(images)).slice(0, 8),
    videos: Array.from(new Set(videos)).slice(0, 5),
    fetchedAt: new Date().toISOString(),
  };
}

function bestSnippet(text, terms) {
  const lower = text.toLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((pos) => pos >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, index - 90);
  return `${start > 0 ? "..." : ""}${text.slice(start, start + 260)}${start + 260 < text.length ? "..." : ""}`;
}

function layerBoost(page) {
  if (page.sourceLayer === "core") return 18;
  if (page.sourceLayer === "history") return 10;
  if (page.sourceLayer === "verified") return 8;
  return 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function uniqueCount(parts) {
  return new Set(parts.flat().filter(Boolean).map((term) => term.toLowerCase())).size;
}

function lowSignalPenalty(page) {
  const haystack = `${page.title} ${page.description || ""} ${page.url} ${page.text || ""}`;
  const hits = lowSignalPatterns.filter((pattern) => pattern.test(haystack));
  return {
    hits: hits.length,
    penalty: Math.min(24, hits.length * 8),
  };
}

function evaluateResearchQuality(page, scoreParts, intent, baseScore) {
  const matchedTerms = uniqueCount([
    scoreParts.titleHits,
    scoreParts.descriptionHits,
    scoreParts.bookmarkHits,
    scoreParts.textHits,
  ]);
  const insightStrengths = ["insight", "trend", "culture", "story", "campaign", "editorial", "technology", "future"];
  const visualStrengths = ["image", "visual", "photography", "film", "motion", "video", "gallery", "portfolio"];
  const profileStrengths = page.sourceProfile?.strengths || [];
  const axisCoverage = (intent.axes || []).filter((axis) =>
    (axis.preferredStrengths || []).some((strength) => profileStrengths.includes(strength))).length;
  const lowSignal = lowSignalPenalty(page);
  const requiredAxisCoverage = Math.min(2, Math.max(1, intent.axes?.length || 1));
  const missingAxisPenalty = Math.max(0, requiredAxisCoverage - axisCoverage) * 14;
  const totalPenalty = lowSignal.penalty + missingAxisPenalty;

  const trust = clamp(
    (page.sourceLayer === "core" ? 34 : page.sourceLayer === "verified" ? 26 : page.sourceLayer === "history" ? 22 : 12)
      + (page.trustReason ? 4 : 0)
      + Math.round(((page.sourceProfile?.weight || 1) - 1) * 20),
    0,
    40,
  );
  const relevance = clamp(
    matchedTerms * 7
      + scoreParts.titleHits.length * 5
      + scoreParts.descriptionHits.length * 3
      + scoreParts.profileMatches.length * 5
      + (baseScore > 45 ? 8 : baseScore > 25 ? 4 : 0),
    0,
    35,
  );
  const visual = clamp(
    (page.images?.length ? 12 : 0)
      + (page.videos?.length ? 12 : 0)
      + (["image", "video"].includes(page.kind) ? 5 : 0)
      + profileStrengths.filter((strength) => visualStrengths.includes(strength)).length * 2,
    0,
    25,
  );
  const insight = clamp(
    profileStrengths.filter((strength) => insightStrengths.includes(strength)).length * 3
      + Math.max(0, axisCoverage - 1) * 6
      + scoreParts.profileMatches.length * 4
      + (page.sourceCategory?.includes("culture") ? 5 : 0),
    0,
    25,
  );
  const originality = clamp(
    (page.url ? 8 : 0)
      + (page.host ? 4 : 0)
      + (page.image ? 5 : 0)
      + (page.videos?.length ? 4 : 0)
      + (page.sourceLayer === "core" ? 5 : 0),
    0,
    25,
  );
  const total = clamp(Math.round(
    trust * 0.75
      + relevance
      + visual * 0.85
      + insight * 0.7
      + originality * 0.55
      - totalPenalty,
  ), 0, 100);

  return {
    total,
    trust,
    relevance,
    visual,
    insight,
    originality,
    penalty: totalPenalty,
    lowSignalHits: lowSignal.hits,
    missingAxisPenalty,
    axisCoverage,
    label: total >= 78 ? "High-confidence reference" : total >= 58 ? "Useful reference" : "Needs review",
  };
}

function scorePage(page, terms, query, intent) {
  const fields = {
    title: `${page.title} ${page.title}`,
    description: page.description || "",
    bookmark: `${page.host} ${page.path} ${page.sourceFolder} ${page.kind}`,
    text: page.text,
  };
  const haystack = Object.values(fields).join(" ").toLowerCase();
  const queryTokens = tokenize(query);
  let score = 0;
  const scoreParts = {
    titleHits: [],
    descriptionHits: [],
    bookmarkHits: [],
    textHits: [],
    profileMatches: [],
  };

  for (const term of terms) {
    const lower = term.toLowerCase();
    if (fields.title.toLowerCase().includes(lower)) {
      score += 12;
      scoreParts.titleHits.push(term);
    }
    if (fields.description.toLowerCase().includes(lower)) {
      score += 8;
      scoreParts.descriptionHits.push(term);
    }
    if (fields.bookmark.toLowerCase().includes(lower)) {
      score += 5;
      scoreParts.bookmarkHits.push(term);
    }
    if (fields.text.toLowerCase().includes(lower)) {
      score += 3;
      scoreParts.textHits.push(term);
    }
  }

  if (queryTokens.length && queryTokens.every((term) => haystack.includes(term))) score += 18;
  if (page.images.length) score += 2;
  if (page.videos.length) score += 2;
  const boost = profileBoost(page.sourceProfile, intent);
  score += boost.boost;
  score += layerBoost(page);
  scoreParts.profileMatches = boost.matched;
  const quality = evaluateResearchQuality(page, scoreParts, intent, score);
  score += Math.round(quality.total * 0.45) + quality.axisCoverage * 8 - quality.penalty;
  return { score, scoreParts, quality };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 ReferenceSelector/0.1",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool(items, worker) {
  const results = [];
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await worker(current));
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, run));
  return results;
}

function quickPageFromBookmark(bookmark) {
  const sourceProfile = getSourceProfile(bookmark);
  const text = [
    bookmark.title,
    bookmark.url,
    bookmark.host,
    bookmark.path,
    bookmark.sourceFolder,
    bookmark.sourceCategory,
    bookmark.kind,
    sourceProfile.role,
    ...(sourceProfile.uses || []),
    ...(sourceProfile.strengths || []),
  ].filter(Boolean).join(" ");

  return {
    ...bookmark,
    sourceProfile,
    description: bookmark.description || "",
    text,
    images: [],
    videos: [],
    fetchedAt: new Date().toISOString(),
  };
}

function resultFromPage(page, terms, query, intent, searchedLive = false) {
  const { score, scoreParts, quality } = scorePage(page, terms, query, intent);
  const curation = buildRecommendation(page, scoreParts, intent, quality);
  if (score <= 0 || quality.total < 18) return null;

  return {
    score,
    result: {
      id: page.id,
      title: page.title,
      url: page.url,
      host: page.host,
      kind: page.videos?.length ? "video" : page.images?.length ? "image" : page.kind,
      sourceFolder: page.sourceFolder,
      path: page.path,
      description: page.description || (searchedLive ? "" : "저장된 북마크 인덱스를 기준으로 먼저 찾았습니다."),
      snippet: bestSnippet(page.text || page.description || page.title, terms),
      image: page.image || null,
      images: page.images || [],
      videos: page.videos || [],
      score,
      curation,
      researchQuality: quality,
      sourceLayer: page.sourceLayer,
      sourceCategory: page.sourceCategory,
      region: page.region,
      trustReason: page.trustReason,
      contentInsight: deriveContentInsight(page, { query, role: "search" }),
      fetchedAt: page.fetchedAt,
    },
  };
}

function quickSearch(query, dataset, terms, intent, startedAt, scope) {
  const pages = dataset.items.map(quickPageFromBookmark);
  const results = pages
    .map((page) => resultFromPage(page, terms, query, intent, false))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((page) => page.result);

  return {
    query,
    terms,
    intent,
    network: summarizeNetwork(results),
    searchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    scanned: pages.length,
    failed: 0,
    totalBookmarks: dataset.counts.total,
    counts: dataset.counts,
    scope,
    mode: "quick",
    results,
  };
}

async function searchBookmarks(bookmarks, terms, query, intent) {
  return mapPool(bookmarks, async (bookmark) => {
    const sourceProfile = getSourceProfile(bookmark);
    try {
      const html = await fetchWithTimeout(bookmark.url);
      const page = { ...extractPage(html, bookmark), sourceProfile };
      const scored = resultFromPage(page, terms, query, intent, true);
      return {
        ok: true,
        score: scored?.score || 0,
        result: scored?.result || null,
      };
    } catch (error) {
      const fallbackText = `${bookmark.title} ${bookmark.url} ${bookmark.host} ${bookmark.path}`;
      const fallbackPage = { ...bookmark, sourceProfile, description: "", text: fallbackText, images: [], videos: [] };
      const { score, scoreParts, quality } = scorePage(fallbackPage, terms, query, intent);
      const curation = buildRecommendation(fallbackPage, scoreParts, intent, quality);
      return {
        ok: false,
        score,
        error: error.message,
        result: score > 0 && quality.total >= 18 ? {
          ...bookmark,
          description: "현재 페이지 본문을 읽지 못해 북마크 정보만 사용했습니다.",
          snippet: fallbackText,
          images: [],
          videos: [],
          score,
          curation,
          researchQuality: quality,
          sourceLayer: fallbackPage.sourceLayer,
          sourceCategory: fallbackPage.sourceCategory,
          region: fallbackPage.region,
          trustReason: fallbackPage.trustReason,
          contentInsight: deriveContentInsight(fallbackPage, { query, role: "search" }),
          fetchedAt: new Date().toISOString(),
        } : null,
      };
    }
  });
}

export async function liveSearch(query, options = {}) {
  const startedAt = Date.now();
  const scope = options.scope === "core" ? "core" : "expanded";
  const dataset = readSourceDataset(scope);
  const terms = expandQuery(query);
  const intent = analyzeIntent(query, tokenize(query));

  if (!query.trim()) {
    return {
      query,
      terms,
      intent,
      searchedAt: new Date().toISOString(),
      scanned: 0,
      failed: 0,
      totalBookmarks: dataset.counts.total,
      counts: dataset.counts,
      scope,
      mode: ["live", "visual"].includes(options.mode) ? options.mode : "quick",
      results: [],
    };
  }

  if (!["live", "visual"].includes(options.mode)) {
    return quickSearch(query, dataset, terms, intent, startedAt, scope);
  }

  const quick = quickSearch(query, dataset, terms, intent, startedAt, scope);
  const visualIds = new Set(quick.results.slice(0, visualSourceLimit).map((result) => result.id));
  const sourceItems = options.mode === "visual"
    ? dataset.items.filter((item) => visualIds.has(item.id))
    : dataset.items;
  const pages = await searchBookmarks(sourceItems, terms, query, intent);

  const enriched = pages
    .filter((page) => page.result && page.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((page) => page.result);
  const results = options.mode === "visual"
    ? quick.results.map((result) => enriched.find((item) => item.id === result.id) || result)
    : enriched;

  return {
    query,
    terms,
    intent,
    network: summarizeNetwork(results),
    searchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    scanned: pages.length,
    failed: pages.filter((page) => !page.ok).length,
    totalBookmarks: dataset.counts.total,
    counts: dataset.counts,
    scope,
    mode: options.mode,
    results,
  };
}
