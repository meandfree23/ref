import fs from "node:fs";
import path from "node:path";
import { readBookmarkDataset } from "./bookmarks-core.mjs";
import { historyId, normalizeHistoryUrl, readBookmarkHistoryIndex, writeBookmarkHistoryIndex } from "./bookmark-history-core.mjs";
import { enrichWithContentInsight } from "./content-insight-core.mjs";

const timeoutMs = Number(process.env.HISTORY_TIMEOUT_MS || 10000);
const sourceBudgetMs = Number(process.env.HISTORY_SOURCE_BUDGET_MS || 45000);
const userAgent = "Mozilla/5.0 ReferenceSelectorHistory/1.0";
const categoryByFolder = { "작가": "artist", design: "design", blog: "blog", magazine: "culture-magazine", up: "reference" };
const folderPriority = { up: 0, "작가": 1, design: 2, magazine: 3, blog: 4 };
const blockedPathPatterns = [
  /\/(?:wp-admin|wp-login|login|signin|account|cart|checkout)(?:\/|$)/i,
  /\/(?:tag|tags|category|categories|author|search)(?:\/|$)/i,
  /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mov|mp3|woff2?|ttf|css|js)$/i,
];

function argument(name, fallback) {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

const sourceLimit = process.argv.includes("--all") ? Number.POSITIVE_INFINITY : Number(argument("source-limit", 20));
const perSourceLimit = Number(argument("per-source", 250));
const sitemapLimit = Number(argument("sitemap-limit", 12));
const requestedHost = argument("host", "").replace(/^www\./, "");
const retryEmpty = process.argv.includes("--retry-empty");

function decodeEntities(text = "") {
  return text.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function stripHtml(text = "") {
  return decodeEntities(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function dateOrNull(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function titleFromUrl(value) {
  const url = new URL(value);
  return (decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || url.hostname)
    .replace(/\.(?:html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()) || url.hostname;
}

function sameSite(url, host) {
  const candidate = new URL(url).hostname.replace(/^www\./, "");
  return candidate === host || candidate.endsWith(`.${host}`) || host.endsWith(`.${candidate}`);
}

function usableHistoricalUrl(value, host) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || !sameSite(url.href, host)) return false;
    if (blockedPathPatterns.some((pattern) => pattern.test(url.pathname))) return false;
    return !url.searchParams.has("s") && !url.searchParams.has("q");
  } catch {
    return false;
  }
}

async function fetchText(url, accept = "application/xml,text/xml,text/html,*/*;q=0.7") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept, "user-agent": userAgent } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { text: await response.text(), finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

function parseSitemap(xml) {
  const sitemapIndex = /<sitemapindex\b/i.test(xml);
  const blocks = sitemapIndex
    ? [...xml.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi)].map((match) => match[0])
    : [...xml.matchAll(/<url\b[\s\S]*?<\/url>/gi)].map((match) => match[0]);
  const entries = blocks.map((block) => ({
    url: decodeEntities(block.match(/<loc[^>]*>([\s\S]*?)<\/loc>/i)?.[1]?.trim() || ""),
    modifiedAt: dateOrNull(block.match(/<lastmod[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim()),
  })).filter((entry) => entry.url);
  return { sitemapIndex, entries };
}

function parseFeed(xml) {
  const blocks = [
    ...[...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]),
    ...[...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]),
  ];
  return blocks.map((block) => {
    const linkText = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]
      || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1]
      || block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || "";
    return {
      url: stripHtml(linkText),
      title: stripHtml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
      publishedAt: dateOrNull(block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i)?.[1]),
      description: stripHtml(block.match(/<(?:description|summary)[^>]*>([\s\S]*?)<\/(?:description|summary)>/i)?.[1] || "").slice(0, 360),
      image: decodeEntities(block.match(/<(?:enclosure|media:content|media:thumbnail)[^>]+url=["']([^"']+)["']/i)?.[1] || ""),
    };
  }).filter((entry) => entry.url);
}

function readAuditPriorities() {
  const auditPath = path.resolve("data/bookmark-audit.json");
  if (!fs.existsSync(auditPath)) return new Map();
  try {
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    return new Map((audit.items || []).map((item) => [item.url, item]));
  } catch {
    return new Map();
  }
}

function buildSources(bookmarks, historyIndex) {
  const audit = readAuditPriorities();
  const grouped = new Map();
  for (const bookmark of bookmarks.items) {
    const url = new URL(bookmark.url);
    const host = url.hostname.replace(/^www\./, "");
    if (requestedHost && host !== requestedHost) continue;
    const auditItem = audit.get(bookmark.url) || {};
    const candidate = {
      ...bookmark,
      host,
      origin: url.origin,
      priorityTier: auditItem.priorityTier || "C",
      sourceLevel: Boolean(auditItem.sourceLevel) || url.pathname === "/",
    };
    const current = grouped.get(host);
    const rank = (item) => `${item.priorityTier}${item.sourceLevel ? 0 : 1}${folderPriority[item.sourceFolder] ?? 9}`;
    if (!current || rank(candidate) < rank(current)) grouped.set(host, candidate);
  }
  const candidates = [...grouped.values()].filter((source) => {
    if (!retryEmpty) return true;
    return ["empty", "error"].includes(historyIndex.sources?.[source.host]?.status);
  });
  return candidates.sort((a, b) => {
    const aChecked = historyIndex.sources?.[a.host]?.checkedAt || "";
    const bChecked = historyIndex.sources?.[b.host]?.checkedAt || "";
    if (!aChecked && bChecked) return -1;
    if (aChecked && !bChecked) return 1;
    if (aChecked && bChecked && aChecked !== bChecked) return aChecked.localeCompare(bChecked);
    const tier = a.priorityTier.localeCompare(b.priorityTier);
    if (tier) return tier;
    if (a.sourceLevel !== b.sourceLevel) return a.sourceLevel ? -1 : 1;
    const folder = (folderPriority[a.sourceFolder] ?? 9) - (folderPriority[b.sourceFolder] ?? 9);
    if (folder) return folder;
    return a.host.localeCompare(b.host);
  }).slice(0, sourceLimit);
}

async function discoverSource(source, knownUrls) {
  const deadline = Date.now() + sourceBudgetMs;
  const errors = [];
  const entries = new Map();
  const sitemapQueue = [];
  const feedCandidates = new Set([`${source.origin}/feed/`, `${source.origin}/feed`, `${source.origin}/rss`, `${source.origin}/rss.xml`, `${source.origin}/atom.xml`]);

  const [robotsResult, homeResult] = await Promise.allSettled([
    fetchText(`${source.origin}/robots.txt`, "text/plain,*/*;q=0.5"),
    fetchText(source.origin, "text/html,*/*;q=0.5"),
  ]);
  if (robotsResult.status === "fulfilled") {
    const robots = robotsResult.value;
    for (const match of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) sitemapQueue.push(match[1]);
  } else {
    errors.push(`robots: ${robotsResult.reason.message}`);
  }
  sitemapQueue.push(`${source.origin}/sitemap.xml`, `${source.origin}/sitemap_index.xml`);

  if (homeResult.status === "fulfilled") {
    const home = homeResult.value;
    for (const match of home.text.matchAll(/<link[^>]+type=["']application\/(?:rss\+xml|atom\+xml)["'][^>]+href=["']([^"']+)["']/gi)) {
      feedCandidates.add(new URL(decodeEntities(match[1]), source.origin).href);
    }
  } else {
    errors.push(`home: ${homeResult.reason.message}`);
  }

  const feedUrls = [...feedCandidates];
  const feedResults = await Promise.allSettled(feedUrls.map((feedUrl) => fetchText(feedUrl)));
  for (let index = 0; index < feedResults.length; index += 1) {
    const result = feedResults[index];
    if (result.status !== "fulfilled") continue;
    const feedEntries = parseFeed(result.value.text);
    if (!feedEntries.length) continue;
    const feedUrl = feedUrls[index];
    for (const entry of feedEntries) {
      const url = normalizeHistoryUrl(new URL(entry.url, source.origin).href);
      if (usableHistoricalUrl(url, source.host) && !knownUrls.has(url)) {
        entries.set(url, { ...entry, url, discoveryMethod: "feed", discoveryUrl: feedUrl });
      }
    }
    break;
  }

  const visitedSitemaps = new Set();
  while (sitemapQueue.length && visitedSitemaps.size < sitemapLimit && entries.size < perSourceLimit) {
    if (Date.now() >= deadline) {
      errors.push(`source budget exceeded after ${sourceBudgetMs}ms`);
      break;
    }
    const sitemapUrl = sitemapQueue.shift();
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);
    try {
      const parsed = parseSitemap((await fetchText(sitemapUrl)).text);
      if (parsed.sitemapIndex) {
        for (const entry of parsed.entries.slice(0, sitemapLimit * 2)) sitemapQueue.push(entry.url);
        continue;
      }
      for (const entry of parsed.entries) {
        const url = normalizeHistoryUrl(entry.url);
        if (!usableHistoricalUrl(url, source.host) || knownUrls.has(url)) continue;
        const existing = entries.get(url) || {};
        entries.set(url, { ...entry, ...existing, url, discoveryMethod: existing.discoveryMethod || "sitemap", discoveryUrl: existing.discoveryUrl || sitemapUrl });
        if (entries.size >= perSourceLimit) break;
      }
    } catch (error) {
      errors.push(`sitemap ${sitemapUrl}: ${error.message}`);
    }
  }

  const indexedAt = new Date().toISOString();
  return {
    items: [...entries.values()].slice(0, perSourceLimit).map((entry) => enrichWithContentInsight({
      id: historyId(entry.url),
      title: entry.title || titleFromUrl(entry.url),
      url: entry.url,
      host: source.host,
      kind: /(?:video|film|motion|youtube|vimeo)/i.test(`${entry.url} ${entry.title || ""}`) ? "video" : "web",
      sourceFolder: source.sourceFolder,
      sourceLayer: "history",
      sourceCategory: categoryByFolder[source.sourceFolder] || "reference",
      region: "personal",
      path: `${source.path} / 과거 아카이브`,
      trustReason: "Public archive item discovered from a user-bookmarked source.",
      sourceBookmarkUrl: source.url,
      description: entry.description || "",
      image: entry.image || "",
      publishedAt: entry.publishedAt || null,
      modifiedAt: entry.modifiedAt || null,
      discoveryMethod: entry.discoveryMethod,
      discoveryUrl: entry.discoveryUrl,
      indexedAt,
    }, { role: "history" })),
    errors,
    sitemapCount: visitedSitemaps.size,
  };
}

const index = readBookmarkHistoryIndex();
const bookmarks = readBookmarkDataset();
const sources = buildSources(bookmarks, index);
const directUrls = new Set(bookmarks.items.map((item) => normalizeHistoryUrl(item.url)));
const itemMap = new Map(index.items.map((item) => [normalizeHistoryUrl(item.url), item]));
const report = [];

for (const source of sources) {
  const startedAt = Date.now();
  try {
    const discovered = await discoverSource(source, new Set([...directUrls, ...itemMap.keys()]));
    let added = 0;
    for (const item of discovered.items) {
      if (directUrls.has(item.url)) continue;
      if (!itemMap.has(item.url)) added += 1;
      itemMap.set(item.url, { ...itemMap.get(item.url), ...item });
    }
    index.sources[source.host] = {
      host: source.host,
      sourceBookmarkUrl: source.url,
      sourceFolder: source.sourceFolder,
      priorityTier: source.priorityTier,
      checkedAt: new Date().toISOString(),
      status: discovered.items.length ? "indexed" : "empty",
      discovered: discovered.items.length,
      added,
      sitemapCount: discovered.sitemapCount,
      errors: discovered.errors.slice(0, 8),
    };
    report.push({ host: source.host, discovered: discovered.items.length, added, elapsedMs: Date.now() - startedAt });
  } catch (error) {
    index.sources[source.host] = {
      host: source.host,
      sourceBookmarkUrl: source.url,
      sourceFolder: source.sourceFolder,
      priorityTier: source.priorityTier,
      checkedAt: new Date().toISOString(),
      status: "error",
      discovered: 0,
      added: 0,
      errors: [error.message],
    };
    report.push({ host: source.host, discovered: 0, added: 0, error: error.message, elapsedMs: Date.now() - startedAt });
  }
  index.items = [...itemMap.values()];
  writeBookmarkHistoryIndex(index);
}

const saved = writeBookmarkHistoryIndex({ ...index, items: [...itemMap.values()] });
console.log(JSON.stringify({
  ok: true,
  requestedSources: sources.length,
  indexedSources: saved.sourceCount,
  indexedItems: saved.itemCount,
  added: report.reduce((sum, item) => sum + item.added, 0),
  report,
}, null, 2));
