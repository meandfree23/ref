import fs from "node:fs";
import path from "node:path";
import { readBookmarkDataset } from "./bookmarks-core.mjs";
import { normalizeHistoryUrl, readBookmarkHistoryIndex } from "./bookmark-history-core.mjs";

const verifiedPath = path.resolve("data/verified-sources.json");

function hostFor(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function kindForSource(source) {
  if (["motion"].includes(source.category)) return "video";
  if (["visual-reference", "typography", "brand", "fashion-culture"].includes(source.category)) return "image";
  return "web";
}

function normalizeVerifiedSource(source) {
  const host = hostFor(source.url);
  return {
    id: source.id,
    title: source.name,
    url: source.url,
    host,
    kind: kindForSource(source),
    sourceFolder: "verified",
    sourceLayer: "verified",
    sourceCategory: source.category,
    region: source.region,
    path: `Verified / ${source.category}`,
    trustReason: source.trustReason,
    added: null,
  };
}

export function readVerifiedSources() {
  const raw = fs.readFileSync(verifiedPath, "utf8");
  const data = JSON.parse(raw);
  return {
    ...data,
    items: data.sources.map(normalizeVerifiedSource),
  };
}

export function readSourceDataset(scope = "core") {
  const core = readBookmarkDataset();
  const categoryByFolder = {
    "작가": "artist",
    design: "design",
    blog: "blog",
    magazine: "culture-magazine",
    up: "reference",
  };
  const coreItems = core.items.map((item) => ({
    ...item,
    sourceLayer: "core",
    sourceCategory: categoryByFolder[item.sourceFolder] || "reference",
    region: "personal",
    trustReason: "User-curated Chrome bookmark source.",
  }));
  const verified = readVerifiedSources();
  const history = readBookmarkHistoryIndex();
  const includeVerified = scope === "expanded";
  const primaryUrls = new Set([
    ...coreItems.map((item) => normalizeHistoryUrl(item.url)),
    ...(includeVerified ? verified.items.map((item) => normalizeHistoryUrl(item.url)) : []),
  ]);
  const historyItems = history.items.filter((item) => !primaryUrls.has(normalizeHistoryUrl(item.url)));
  const items = includeVerified
    ? [...coreItems, ...historyItems, ...verified.items]
    : [...coreItems, ...historyItems];

  return {
    generatedAt: new Date().toISOString(),
    scope,
    source: includeVerified
      ? "Chrome core bookmarks + bookmark history + verified external sources"
      : "Chrome core bookmarks + bookmark history",
    folders: core.folders,
    counts: {
      core: coreItems.length,
      history: historyItems.length,
      verified: includeVerified ? verified.items.length : 0,
      availableVerified: verified.items.length,
      total: items.length,
    },
    items,
  };
}
