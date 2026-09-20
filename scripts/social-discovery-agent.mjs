import fs from "node:fs";
import path from "node:path";
import { readCinemaArchive, readKoreanCodeArchive, readUpdateArchive } from "./update-archive.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Optional local environment.
}

const seedsPath = path.resolve("data/social-discovery-seeds.json");
const reportPath = path.resolve("data/social-discovery-report.json");
const headers = {
  "user-agent": "Mozilla/5.0 ReferenceSelectorSocialDiscovery/0.1",
  accept: "application/json",
};

function stripHtml(value = "") {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function archivedUrlSet(archives) {
  return new Set(Object.values(archives).flatMap((archive) => archive.items || []).map((item) => item.url).filter(Boolean));
}

function normalizeCandidate(seed, item) {
  return {
    id: `${seed.id}:${item.url}`,
    platform: seed.platform,
    tab: seed.tab,
    field: seed.field,
    sourceName: item.sourceName || seed.platform,
    author: item.author || "",
    title: item.title || item.text?.slice(0, 100) || seed.query,
    text: item.text || item.summary || "",
    url: item.url,
    image: item.image || "",
    date: item.date || new Date().toISOString(),
    engagement: item.engagement || 0,
    focus: seed.focus,
  };
}

const lowSignalPatterns = [
  /\breposts appreciated\b/i,
  /\bcommissions?\b/i,
  /\bcomms\b/i,
  /\bartfight\b/i,
  /\baiart\b/i,
  /\baigirl\b/i,
  /\bfollowers?\b/i,
  /\bgiveaway\b/i,
  /\bnft\b/i,
];

function isExternalReference(item) {
  return item.url && !/^https:\/\/bsky\.app\/profile\//.test(item.url);
}

function isRelevantToTab(item) {
  const text = `${item.title} ${item.text}`.toLowerCase();
  if (lowSignalPatterns.some((pattern) => pattern.test(text))) return false;
  if (item.id.includes("bsky-motion-design")) {
    return /motion design|motion graphics|animation|animated|moving image/i.test(text);
  }
  if (item.id.includes("bsky-creative-trends")) {
    return /creative coding|open web|generative|interactive|interaction|visual programming|creative technology/i.test(text);
  }
  if (item.id.includes("bsky-korean-design") || item.id.includes("bsky-korean-branding")) {
    return /korea|korean|seoul|hangul|hanok|k-pop|kpop|busan|hallyu/i.test(text)
      && /branding|brand|graphic design|identity|campaign|typography|packaging|poster|fashion|architecture|artist|exhibition/i.test(text);
  }
  if (item.tab === "koreanCode") {
    return /korea|korean|seoul|hangul|hanok|k-pop|kpop|busan|hallyu|kimchi|pachinko/i.test(text);
  }
  if (item.tab === "cinema") {
    return /film|cinema|movie|director|auteur|oldboy|bong|park chan|pachinko|busan|criterion|festival/i.test(text);
  }
  return /design|creative|visual|motion|coding|interaction|typography|architecture|art|culture/i.test(text);
}

async function fetchBluesky(seed) {
  const url = new URL("https://api.bsky.app/xrpc/app.bsky.feed.searchPosts");
  url.searchParams.set("q", seed.query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("sort", "latest");
  url.searchParams.set("since", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Bluesky HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.posts || []).map((post) => {
    const external = post.embed?.external || post.record?.embed?.external || null;
    const image = external?.thumb || post.embed?.images?.[0]?.thumb || "";
    return normalizeCandidate(seed, {
      sourceName: "Bluesky",
      author: post.author?.handle,
      title: external?.title || post.record?.text?.slice(0, 100),
      text: post.record?.text || "",
      url: external?.uri || `https://bsky.app/profile/${post.author?.handle}/post/${post.uri?.split("/").pop()}`,
      image,
      date: post.record?.createdAt,
      engagement: (post.likeCount || 0) + (post.repostCount || 0) * 2 + (post.replyCount || 0),
    });
  });
}

async function fetchReddit(seed) {
  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
    return { skipped: true, reason: "Reddit OAuth credentials are not configured", items: [] };
  }
  const url = new URL(`https://www.reddit.com/r/${seed.subreddit}/search.json`);
  url.searchParams.set("q", seed.query);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "new");
  url.searchParams.set("t", "week");
  url.searchParams.set("limit", "50");
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Reddit HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.data?.children || []).map((entry) => {
    const post = entry.data || {};
    const permalink = post.permalink ? `https://www.reddit.com${post.permalink}` : post.url;
    return normalizeCandidate(seed, {
      sourceName: `r/${seed.subreddit}`,
      author: post.author,
      title: post.title,
      text: stripHtml(post.selftext || ""),
      url: permalink,
      image: post.thumbnail?.startsWith("http") ? post.thumbnail : "",
      date: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : "",
      engagement: (post.score || 0) + (post.num_comments || 0) * 2,
    });
  });
}

async function fetchYouTube(seed) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return { skipped: true, reason: "YOUTUBE_API_KEY is not configured", items: [] };
  }
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "date");
  url.searchParams.set("maxResults", "25");
  url.searchParams.set("q", seed.query);
  url.searchParams.set("key", key);
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);
  const payload = await response.json();
  return (payload.items || []).map((video) => normalizeCandidate(seed, {
    sourceName: "YouTube",
    author: video.snippet?.channelTitle,
    title: video.snippet?.title,
    text: video.snippet?.description,
    url: `https://www.youtube.com/watch?v=${video.id?.videoId}`,
    image: video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url || "",
    date: video.snippet?.publishedAt,
    engagement: 0,
  }));
}

async function fetchSocialSeed(seed) {
  try {
    if (seed.platform === "bluesky") return { ok: true, seed, items: await fetchBluesky(seed) };
    if (seed.platform === "reddit") {
      const result = await fetchReddit(seed);
      return { ok: !result.skipped, skipped: Boolean(result.skipped), reason: result.reason || "", seed, items: result.items || result };
    }
    if (seed.platform === "youtube") {
      const result = await fetchYouTube(seed);
      return { ok: !result.skipped, skipped: Boolean(result.skipped), reason: result.reason || "", seed, items: result.items || result };
    }
    return { ok: false, seed, items: [], error: `Unsupported platform: ${seed.platform}` };
  } catch (error) {
    return { ok: false, seed, items: [], error: error.message };
  }
}

function scoreItem(item, archivedUrls) {
  const text = `${item.title} ${item.text}`.toLowerCase();
  const hasCreatorSignal = /interview|studio|director|artist|designer|critic|analysis|essay|case study|behind/i.test(text);
  const hasVisualSignal = /image|visual|film|cinema|design|brand|campaign|photography|motion|art/i.test(text);
  const novelty = archivedUrls.has(item.url) ? 0 : 1;
  const externalBonus = isExternalReference(item) ? 25 : 0;
  const internalPenalty = isExternalReference(item) ? 0 : 15;
  return novelty * 40 + Math.min(30, item.engagement || 0) + externalBonus + (hasCreatorSignal ? 20 : 0) + (hasVisualSignal ? 10 : 0) - internalPenalty;
}

function scoreSeed(result, archivedUrls) {
  const seen = new Set();
  const candidates = [];
  for (const item of result.items || []) {
    if (!item.url || seen.has(item.url) || archivedUrls.has(item.url)) continue;
    if (!isRelevantToTab(item)) continue;
    if (!isExternalReference(item) && (item.engagement || 0) < 8) continue;
    seen.add(item.url);
    candidates.push({
      ...item,
      score: scoreItem(item, archivedUrls),
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const topScore = candidates[0]?.score || 0;
  const recommendation = result.skipped ? "needs_credentials" : topScore >= 70 || candidates.length >= 10 ? "watch" : candidates.length ? "sample" : "reject";
  return {
    id: result.seed.id,
    platform: result.seed.platform,
    tab: result.seed.tab,
    field: result.seed.field,
    query: result.seed.query,
    focus: result.seed.focus,
    ok: result.ok,
    skipped: Boolean(result.skipped),
    reason: result.reason || result.error || "",
    fetched: result.items?.length || 0,
    novel: candidates.length,
    recommendation,
    sample: candidates.slice(0, 8),
  };
}

const seeds = JSON.parse(fs.readFileSync(seedsPath, "utf8"));
const archives = {
  updates: await readUpdateArchive(),
  koreanCode: await readKoreanCodeArchive(),
  cinema: await readCinemaArchive(),
};
const archivedUrls = archivedUrlSet(archives);
const results = await Promise.all((seeds.queries || []).map(fetchSocialSeed));
const scored = results.map((result) => scoreSeed(result, archivedUrls));
const report = {
  generatedAt: new Date().toISOString(),
  criteria: {
    watch: "Novel social candidates with creator, visual, or discussion signals. Review before promotion.",
    sample: "Some novel material exists, but the route needs tuning or repeated observation.",
    needs_credentials: "Official API route exists but requires credentials before it can run.",
    reject: "No useful novel candidates were found in this run.",
  },
  archive: Object.fromEntries(Object.entries(archives).map(([tab, archive]) => [tab, {
    items: archive.itemCount,
    dates: archive.dateCount,
  }])),
  routes: scored.sort((a, b) => b.novel - a.novel || b.sample[0]?.score - a.sample[0]?.score),
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  output: reportPath,
  routes: report.routes.map((route) => ({
    id: route.id,
    platform: route.platform,
    tab: route.tab,
    fetched: route.fetched,
    novel: route.novel,
    recommendation: route.recommendation,
    reason: route.reason,
  })),
}, null, 2));
