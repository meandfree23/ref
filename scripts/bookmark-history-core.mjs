import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalCurationUrl } from "./curation-policy.mjs";

export const bookmarkHistoryPath = path.resolve("data/bookmark-history-index.json");

function emptyIndex() {
  return { version: 1, generatedAt: null, sourceCount: 0, itemCount: 0, sources: {}, items: [] };
}

export function normalizeHistoryUrl(value) {
  const normalized = canonicalCurationUrl(value);
  return /^https?:\/\//i.test(normalized) ? normalized : "";
}

export function historyId(url) {
  return `history-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 20)}`;
}

export function readBookmarkHistoryIndex() {
  if (!fs.existsSync(bookmarkHistoryPath)) return emptyIndex();
  try {
    const parsed = JSON.parse(fs.readFileSync(bookmarkHistoryPath, "utf8"));
    return { ...emptyIndex(), ...parsed, sources: parsed.sources || {}, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return emptyIndex();
  }
}

export function writeBookmarkHistoryIndex(index) {
  const items = Array.from(new Map((index.items || [])
    .map((item) => ({ ...item, url: normalizeHistoryUrl(item.url) }))
    .filter((item) => item.url)
    .map((item) => [item.url, item])).values())
    .sort((a, b) => String(b.modifiedAt || b.publishedAt || "").localeCompare(String(a.modifiedAt || a.publishedAt || "")) || a.url.localeCompare(b.url));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceCount: Object.keys(index.sources || {}).length,
    itemCount: items.length,
    sources: index.sources || {},
    items,
  };
  const temporaryPath = `${bookmarkHistoryPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temporaryPath, bookmarkHistoryPath);
  return payload;
}
