import fs from "node:fs";
import path from "node:path";
import { readCinemaArchive, readKoreanCodeArchive, readUpdateArchive } from "./update-archive.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Vercel injects the Blob token in deployed environments.
}

const seedsPath = path.resolve("data/discovery-seeds.json");
const reportPath = path.resolve("data/discovery-report.json");
const requestHeaders = {
  "user-agent": "Mozilla/5.0 ReferenceSelectorDiscovery/0.1",
  accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.8",
};

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripHtml(value = "") {
  return decodeEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripHtml(match[1]) : "";
}

function getLink(block) {
  const rssLink = getTag(block, "link");
  if (rssLink) return rssLink;
  const atom = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return atom ? decodeEntities(atom[1]) : "";
}

function parseFeed(xml, seed) {
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const entryBlocks = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  return [...itemBlocks, ...entryBlocks]
    .map((block) => {
      const url = getLink(block) || getTag(block, "guid") || getTag(block, "id");
      return {
        sourceId: seed.id,
        sourceName: seed.name,
        sourceUrl: seed.feedUrl,
        field: seed.field,
        focus: seed.focus,
        title: getTag(block, "title"),
        url,
        summary: getTag(block, "description") || getTag(block, "summary") || getTag(block, "content"),
      };
    })
    .filter((item) => item.title && item.url);
}

async function fetchSeed(seed) {
  try {
    const response = await fetch(seed.feedUrl, { headers: requestHeaders });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const items = parseFeed(xml, seed);
    return { ok: true, seed, items };
  } catch (error) {
    return { ok: false, seed, items: [], error: error.message };
  }
}

function scoreCandidate(result, archivedUrls) {
  const seen = new Set();
  const uniqueItems = [];
  const novelItems = [];
  for (const item of result.items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    uniqueItems.push(item);
    if (!archivedUrls.has(item.url)) novelItems.push(item);
  }
  const noveltyRatio = uniqueItems.length ? novelItems.length / uniqueItems.length : 0;
  const score = Math.round(novelItems.length * 10 + noveltyRatio * 40 + (result.ok ? 10 : -20));
  return {
    id: result.seed.id,
    name: result.seed.name,
    field: result.seed.field,
    focus: result.seed.focus,
    feedUrl: result.seed.feedUrl,
    ok: result.ok,
    error: result.error || "",
    fetched: result.items.length,
    unique: uniqueItems.length,
    novel: novelItems.length,
    noveltyRatio: Number(noveltyRatio.toFixed(2)),
    score,
    recommendation: score >= 80 ? "promote" : score >= 35 ? "watch" : "reject",
    sample: novelItems.slice(0, 5).map((item) => ({
      title: item.title,
      url: item.url,
    })),
  };
}

async function scoreTab(tab, seeds, archive) {
  const archivedUrls = new Set((archive.items || []).map((item) => item.url).filter(Boolean));
  const results = await Promise.all(seeds.map(fetchSeed));
  const candidates = results
    .map((result) => scoreCandidate(result, archivedUrls))
    .sort((a, b) => b.score - a.score);
  return {
    tab,
    archive: {
      items: archive.itemCount,
      dates: archive.dateCount,
      uniqueUrls: archivedUrls.size,
    },
    candidates,
  };
}

const seeds = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
const report = {
  generatedAt: new Date().toISOString(),
  criteria: {
    promote: "High novelty and reliable feed response. Candidate can be reviewed for source promotion.",
    watch: "Potentially useful but needs repeated checks or narrower query tuning.",
    reject: "Low novelty, failed feed, or too little useful material.",
  },
  tabs: [
    await scoreTab("updates", seeds.tabs.updates || [], await readUpdateArchive()),
    await scoreTab("koreanCode", seeds.tabs.koreanCode || [], await readKoreanCodeArchive()),
    await scoreTab("cinema", seeds.tabs.cinema || [], await readCinemaArchive()),
  ],
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  output: reportPath,
  tabs: report.tabs.map((tab) => ({
    tab: tab.tab,
    archive: tab.archive,
    promote: tab.candidates.filter((candidate) => candidate.recommendation === "promote").length,
    watch: tab.candidates.filter((candidate) => candidate.recommendation === "watch").length,
    reject: tab.candidates.filter((candidate) => candidate.recommendation === "reject").length,
    best: tab.candidates.slice(0, 3).map((candidate) => ({
      id: candidate.id,
      score: candidate.score,
      novel: candidate.novel,
      recommendation: candidate.recommendation,
    })),
  })),
}, null, 2));
