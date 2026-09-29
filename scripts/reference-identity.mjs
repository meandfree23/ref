// Identity keys for "is this the same reference?" checks.
// Deliberately separate from canonicalCurationUrl (which the bookmark-history quality
// gate also uses): these keys are looser and only drive archive de-duplication.
//
// Two items are the same reference when they share ANY key:
//   u:  canonical URL (exact)
//   p:  host + path with a leading locale segment removed (/ko/, /fr/, /en-gb/ ...)
//   s:  host + final descriptive slug (same article filed under another section,
//       e.g. /inspiration/<slug> vs /work/<slug>, /article/<slug> vs /article/retail/<slug>)
//   t:  host + normalized original-language title (NOT the Korean translation, which
//       changes every time an item is re-translated)
import { canonicalCurationUrl } from "./curation-policy.mjs";

const LOCALE_SEGMENT = /^\/(?:ko|kr|en|fr|de|ja|jp|zh|cn|es|it|pt|nl)(?:[-_][a-z]{2,4})?(?=\/)/i;
const SLUG_LOCALE_PREFIX = /^(?:ph|hk|sg|my|id|th|kr|jp|uk|us|au|ca|in)-/i;

function parse(value = "") {
  try {
    // Reuse the canonical form so tracking params are dropped but real ids
    // (?idxno=, ?articleId=, ?news_id= ...) are kept and sorted.
    const url = new URL(canonicalCurationUrl(String(value).trim()));
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch { /* keep raw */ }
    return {
      host: url.hostname.toLowerCase().replace(/^(?:www\d?|m|amp)\./, ""),
      path: path.toLowerCase().replace(/\/amp\/?$/, "/").replace(/\/+$/, "") || "/",
      search: url.search,
    };
  } catch {
    return null;
  }
}

export function originalTitle(item = {}) {
  return String(item.articleTitle || item.title || "");
}

export function normalizeTitle(value = "", host = "") {
  const siteWord = host.split(".")[0];
  return String(value)
    .toLowerCase()
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/g, "'")
    .replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/u, (tail) => (tail.includes(siteWord) || /magazine|news|times|herald|\.com/.test(tail) ? "" : tail))
    .replace(/['’‘"“”`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function referenceIdentityKeys(item = {}) {
  const keys = new Set();
  const urls = [item.url, item.googleNewsUrl].filter(Boolean);
  for (const value of urls) keys.add(`u:${canonicalCurationUrl(value)}`);
  const parsed = parse(item.url);
  if (parsed && parsed.path !== "/") {
    const path = parsed.path.replace(LOCALE_SEGMENT, "");
    keys.add(`p:${parsed.host}${path}${parsed.search}`);
    const segments = path.split("/").filter(Boolean);
    const last = (segments.at(-1) || "").replace(/\.(?:html?|php|aspx?)$/, "");
    const slug = last.replace(SLUG_LOCALE_PREFIX, "");
    // Only descriptive slugs: at least 4 hyphenated words and 24+ chars, not a bare id.
    if (!parsed.search && slug.length >= 24 && slug.split("-").length >= 4 && !/^\d+$/.test(slug)) {
      keys.add(`s:${parsed.host}/${slug}`);
    }
  }
  const host = parsed?.host || String(item.sourceName || "").toLowerCase();
  const title = normalizeTitle(originalTitle(item), host);
  if (title.length >= 24 && title.split(" ").length >= 4) keys.add(`t:${host}|${title}`);
  return [...keys];
}

// Build a lookup of every identity key already used by the given items.
export function identityKeySet(items = []) {
  const set = new Set();
  for (const item of items) for (const key of referenceIdentityKeys(item)) set.add(key);
  return set;
}

export function sharesIdentity(item, keySet) {
  return referenceIdentityKeys(item).some((key) => keySet.has(key));
}
