// Fetch an article page and extract readable body text plus og metadata.
// Deliberately dependency-free: paragraph harvesting inside <article>/<main>
// is enough to ground an LLM reading, and failures fall back to RSS summaries.
import googleNewsUrlDecoder from "google-news-url-decoder";

const { GoogleDecoder } = googleNewsUrlDecoder;
const requestTimeoutMs = 12000;
const blockedPagePattern = /sorry, you have been blocked|performing security verification|why have i been blocked|cf-chl-|enable javascript and cookies|access denied/i;

const entityMap = { amp: "&", quot: "\"", "#39": "'", apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: "\"", ldquo: "\"", hellip: "...", mdash: "-", ndash: "-" };

export function decodeEntities(text = "") {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z0-9#]+);/gi, (match, name) => entityMap[name.toLowerCase()] ?? match);
}

export function stripTags(html = "") {
  return decodeEntities(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// RSS boilerplate that leaked into summaries ("The post X appeared first on Y").
export function cleanFeedText(text = "") {
  return String(text)
    .replace(/The post .{0,200}? appeared first on .{0,80}?\.?$/i, "")
    .replace(/.{0,120}\| .{0,60} 에 처음 등장했습니다\.?/g, "")
    .replace(/.{0,80}에 처음 등장했습니다\.?/g, "")
    .replace(/appeared first on [^.]{0,80}\.?/gi, "")
    .replace(/\[(?:Watch|Read more|Read More|자세히 읽기|더 읽기|보기|…|\.\.\.)\]/g, "")
    .replace(/\s*(?:Continue reading|Read more)\s*(?:\.{3}|…)?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"));
  const second = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"));
  return decodeEntities((first || second || [])[1] || "").trim();
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ko;q=0.8",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (type && !/html|xml/i.test(type)) throw new Error(`non-html ${type}`);
    return { html: await response.text(), finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

let decoder = null;
export async function resolvePublisherUrl(url = "") {
  try {
    if (new URL(url).hostname !== "news.google.com") return url;
    decoder ||= new GoogleDecoder();
    const result = await decoder.decode(url);
    if (result?.status && /^https?:\/\//.test(result.decoded_url || "")) return result.decoded_url;
  } catch {
    // fall through
  }
  return url;
}

function harvestParagraphs(html) {
  const scopes = [
    html.match(/<article\b[\s\S]*?<\/article>/i)?.[0],
    html.match(/<main\b[\s\S]*?<\/main>/i)?.[0],
    html,
  ].filter(Boolean);
  for (const scope of scopes) {
    const paragraphs = [...scope.matchAll(/<(p|h2|h3|blockquote|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((match) => stripTags(match[2]))
      .filter((text) => text.length >= 45)
      .filter((text) => !/cookie|subscribe|newsletter|sign up|all rights reserved|privacy policy|advertisement/i.test(text));
    const unique = [...new Set(paragraphs)];
    const joined = unique.join("\n");
    if (joined.length >= 400) return joined;
  }
  return "";
}

/**
 * Returns { url, text, description, image, ok, reason }.
 * `text` is capped so a single article cannot blow the prompt budget.
 */
export async function fetchArticle(url, { maxChars = 6000 } = {}) {
  const resolved = await resolvePublisherUrl(url);
  try {
    const { html, finalUrl } = await fetchHtml(resolved);
    if (blockedPagePattern.test(html.slice(0, 20000))) {
      return { url: resolved, text: "", description: "", image: "", ok: false, reason: "blocked" };
    }
    const description = cleanFeedText(metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description"));
    const imageRaw = metaContent(html, "og:image") || metaContent(html, "twitter:image");
    let image = "";
    try { image = imageRaw ? new URL(imageRaw, finalUrl).href : ""; } catch { image = ""; }
    const text = cleanFeedText(harvestParagraphs(html)).slice(0, maxChars);
    return { url: finalUrl, text, description, image, ok: text.length >= 400, reason: text.length >= 400 ? "ok" : "thin" };
  } catch (error) {
    return { url: resolved, text: "", description: "", image: "", ok: false, reason: error.name === "AbortError" ? "timeout" : error.message };
  }
}
