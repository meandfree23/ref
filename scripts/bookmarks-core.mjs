import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const chromeBookmarksPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "Default",
  "Bookmarks",
);

const storedBookmarksPath = path.resolve("data/bookmarks.json");
const targetFolders = new Set(["up", "작가", "design", "blog", "magazine"]);

const blockedUrlPatterns = [
  /adobelogin\.com/i,
  /accounts\.google\.com/i,
  /\/authorize\//i,
  /access_token=/i,
  /id_token=/i,
  /callback=/i,
  /login/i,
  /signin/i,
  /auth/i,
];

function isSearchResultUrl(parsed) {
  const host = parsed.hostname.replace(/^www\./, "");
  return ["google.com", "bing.com", "search.naver.com"].includes(host) &&
    parsed.pathname.includes("search");
}

export function isUsableUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (isSearchResultUrl(parsed)) return false;
    if (blockedUrlPatterns.some((pattern) => pattern.test(url))) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeItem(node, trail, sourceFolder) {
  const parsed = new URL(node.url);
  const host = parsed.hostname.replace(/^www\./, "");
  const lower = `${node.name} ${node.url} ${trail.join(" ")}`.toLowerCase();
  const kind = lower.includes("youtube") || lower.includes("vimeo") || lower.includes("video")
    ? "video"
    : lower.includes("image") || lower.includes("photo") || lower.includes("gallery") || lower.includes("behance")
      ? "image"
      : "web";

  return {
    id: `${sourceFolder}-${node.id || `${node.name}-${node.url}`}`.replace(/\s+/g, "-"),
    title: node.name || host,
    url: node.url,
    host,
    kind,
    sourceFolder,
    path: trail.join(" / "),
    added: node.date_added || null,
  };
}

function collectFolder(folderNode, trail, sourceFolder, items) {
  for (const child of folderNode.children || []) {
    if (child.type === "url" && isUsableUrl(child.url)) {
      items.push(normalizeItem(child, trail, sourceFolder));
    }
    if (child.type === "folder") {
      collectFolder(child, [...trail, child.name], sourceFolder, items);
    }
  }
}

function walk(node, trail, matches) {
  if (!node) return;
  const currentTrail = node.type === "folder" ? [...trail, node.name].filter(Boolean) : trail;

  if (node.type === "folder" && targetFolders.has(node.name)) {
    collectFolder(node, currentTrail, node.name, matches);
  }

  for (const child of node.children || []) {
    walk(child, currentTrail, matches);
  }
}

export function readBookmarkDataset() {
  if (!fs.existsSync(chromeBookmarksPath) && fs.existsSync(storedBookmarksPath)) {
    return JSON.parse(fs.readFileSync(storedBookmarksPath, "utf8"));
  }

  const raw = fs.readFileSync(chromeBookmarksPath, "utf8");
  const bookmarks = JSON.parse(raw);
  const items = [];

  for (const root of Object.values(bookmarks.roots || {})) {
    walk(root, [], items);
  }

  const deduped = Array.from(
    new Map(items.map((item) => [item.url, item])).values(),
  ).sort((a, b) => a.title.localeCompare(b.title, "ko"));

  return {
    generatedAt: new Date().toISOString(),
    source: "Chrome Default profile Bookmarks",
    folders: Array.from(targetFolders),
    count: deduped.length,
    items: deduped,
  };
}
