// Source hygiene shared by the three collection cores:
//  - hard blocklist of gossip / awards-race / generic news domains
//  - sources the curator memory has demoted (low keep-rate over time)
//  - Google News items resolved to the publisher with og:description filled in
import { cleanFeedText, fetchArticle } from "./article-text.mjs";
import { demotedSources } from "./curator-memory.mjs";

const blockedHosts = [
  "goldderby.com", "awardswatch.com", "awardsdaily.com", "awardsradar.com", "horrorpress.net",
  "wideopencountry.com", "townandcountrymag.com", "yahoo.com", "sportskeeda.com", "broadwayworld.com",
  "realityblurred.com", "nightmareonfilmstreet.com", "thecurb.com.au", "netflixjunkie.com",
  "hellokpop.com", "kpopconcerts.com", "musicmundial.com", "gmanetwork.com", "en.koreaportal.com",
  "koreaportal.com", "nextshark.com", "ad-hoc-news.de", "animecorner.me", "thecitypaperbogota.com",
  "mancunion.com", "insessionfilm.com", "retail-bulletin.com", "timesofindia.indiatimes.com",
];
const blockedNames = [
  "gold derby", "awards watch", "awardswatch", "awardsdaily", "awards radar", "horror press",
  "wide open country", "town & country", "yahoo", "sportskeeda", "broadwayworld", "reality blurred",
  "nightmare on film street", "netflix junkie", "hellokpop", "kpopconcerts", "music mundial",
  "gma network", "nextshark", "anime corner", "the times of india",
];

function hostOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

let demotedCache = null;
function demoted() {
  demotedCache ||= demotedSources();
  return demotedCache;
}

const blockedPathPatterns = [/lbbonline\.com\/people\//i, /shots\.net\/news\/view\/[^/]*(?:joins|appoint|promot|hire|welcomes|roster)/i];

export function isBlockedItem(item = {}, { honourDemotion = true } = {}) {
  const host = hostOf(item.url);
  if (blockedPathPatterns.some((pattern) => pattern.test(String(item.url || "")))) return true;
  if (host && blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) return true;
  const name = String(item.sourceName || item.publisherName || "").toLowerCase().trim();
  if (name && blockedNames.some((blocked) => name === blocked || name.startsWith(`${blocked} `))) return true;
  if (honourDemotion && name && demoted().has(name)) return true;
  return false;
}

export function blockReason(item = {}) {
  if (!isBlockedItem(item)) return "";
  return demoted().has(String(item.sourceName || "").toLowerCase().trim()) ? "demoted-by-curator-memory" : "blocklist";
}

/**
 * For sources declared with `resolveGoogleNews: true`, decode the Google News
 * redirect to the publisher URL and fill summary/image from the article page,
 * so the rule-based gate and the deep reader get real text instead of a title.
 */
export async function resolveGoogleNewsSourceItems(items = [], sources = [], { perSource = 8 } = {}) {
  const flagged = new Map(sources.filter((source) => source.resolveGoogleNews).map((source) => [source.id, source]));
  if (!flagged.size) return items;
  const counts = new Map();
  const targets = items.filter((item) => {
    if (!flagged.has(item.sourceId) || hostOf(item.url) !== "news.google.com") return false;
    const count = counts.get(item.sourceId) || 0;
    if (count >= perSource) return false;
    counts.set(item.sourceId, count + 1);
    return true;
  });
  const resolved = new Map();
  const queue = [...targets];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const article = await fetchArticle(item.url, { maxChars: 1200 });
      if (hostOf(article.url) && hostOf(article.url) !== "news.google.com") resolved.set(item, article);
    }
  }));
  return items
    .filter((item) => !flagged.has(item.sourceId) || hostOf(item.url) !== "news.google.com" || resolved.has(item))
    .map((item) => {
      const article = resolved.get(item);
      if (!article) return item;
      const source = flagged.get(item.sourceId);
      const summary = cleanFeedText(article.description || article.text.slice(0, 400));
      return {
        ...item,
        googleNewsUrl: item.url,
        url: article.url,
        sourceName: source.publisherName || item.sourceName,
        title: String(item.title || "").replace(/\s+-\s+[^-]{2,60}$/, "").trim(),
        summary: summary.length > String(item.summary || "").length ? summary.slice(0, 420) : item.summary,
        image: item.image || article.image || "",
      };
    });
}
