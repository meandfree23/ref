import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalCurationUrl, curationTitleKey } from "./curation-policy.mjs";

const updateArchivePrefix = "update-archive/";
const koreanCodeArchivePrefix = "korean-code-archive/";
const cinemaArchivePrefix = "cinema-archive/";
const defaultMaxItemsPerDate = 15;
const archiveDirectory = path.resolve("data/archives");

function dateKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "date-unknown";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function compactArchivePath(prefix) {
  return path.join(archiveDirectory, `${prefix.replace(/\/$/, "")}.json`);
}

function stableItemId(item) {
  return createHash("sha256").update(item.url).digest("hex").slice(0, 20);
}

function normalizeItem(item, archivedAt, options = {}) {
  const normalized = {
    ...item,
    archiveId: item.archiveId || stableItemId(item),
    archivedAt: item.archivedAt || archivedAt,
  };
  if (options.useCollectionDate) {
    normalized.originalDate = item.originalDate || item.date || null;
    normalized.date = archivedAt;
  }
  return normalized;
}

function mergeItems(existing = [], incoming = [], options = {}) {
  const merged = new Map();
  const titles = new Set();
  for (const item of [...incoming, ...existing]) {
    const canonicalUrl = canonicalCurationUrl(item?.url);
    const titleKey = curationTitleKey(item);
    const key = options.keepDailyCopies
      ? `${dateKey(item.date || item.archivedAt)}:${canonicalUrl}`
      : canonicalUrl;
    if (!canonicalUrl || merged.has(key) || (titleKey && titles.has(titleKey))) continue;
    merged.set(key, item);
    if (titleKey) titles.add(titleKey);
  }
  return [...merged.values()].sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return bTime - aTime;
  });
}

function limitItemsPerDate(items = [], limit = defaultMaxItemsPerDate) {
  if (!limit) return items;
  const counts = new Map();
  return items.filter((item) => {
    const key = dateKey(item.date || item.archivedAt);
    const count = counts.get(key) || 0;
    if (count >= limit) return false;
    counts.set(key, count + 1);
    return true;
  });
}

export function canUseUpdateArchive() {
  return true;
}

function buildArchive(rawItems = [], options = {}) {
  const mergedItems = mergeItems([], rawItems, options);
  const items = limitItemsPerDate(mergedItems, options.maxItemsPerDate);
  const dates = [...new Set(items.map((item) => dateKey(item.date || item.archivedAt)))].sort().reverse();
  return {
    enabled: canUseUpdateArchive(),
    itemCount: items.length,
    dateCount: dates.length,
    dates,
    items,
  };
}

async function readCompactPayload(prefix) {
  try {
    return JSON.parse(fs.readFileSync(compactArchivePath(prefix), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { savedAt: null, items: [] };
    throw error;
  }
}

async function readArchive(prefix = updateArchivePrefix, options = {}) {
  const payload = await readCompactPayload(prefix);
  return buildArchive(payload.items || [], options);
}

async function archiveItems(items = [], prefix = updateArchivePrefix, options = {}) {
  if (!canUseUpdateArchive() || !items.length) return readArchive(prefix, options);
  if (process.env.VERCEL) {
    throw new Error("The deployed archive is read-only; run the scheduled local archive update.");
  }

  const archivedAt = options.collectionDate
    ? new Date(options.collectionDate).toISOString()
    : new Date().toISOString();
  const selectedItems = options.maxItemsPerSnapshot
    ? items.slice(0, options.maxItemsPerSnapshot)
    : items;
  const incoming = [];
  for (const rawItem of selectedItems) {
    if (!rawItem?.url) continue;
    incoming.push(normalizeItem(rawItem, archivedAt, options));
  }

  const existing = await readCompactPayload(prefix);
  const incomingDates = new Set(incoming.map((item) => dateKey(item.date || item.archivedAt)));
  const retained = options.mergeExistingSnapshot === false
    ? (existing.items || []).filter((item) => !incomingDates.has(dateKey(item.date || item.archivedAt)))
    : existing.items || [];
  const merged = limitItemsPerDate(mergeItems(retained, incoming, options), options.maxItemsPerDate);
  const payload = { savedAt: archivedAt, items: merged };
  fs.mkdirSync(archiveDirectory, { recursive: true });
  const destination = compactArchivePath(prefix);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload));
  fs.renameSync(temporary, destination);

  return buildArchive(merged, options);
}

export function readUpdateArchive() {
  return readArchive(updateArchivePrefix, { maxItemsPerDate: defaultMaxItemsPerDate });
}

export function archiveUpdates(items = [], options = {}) {
  return archiveItems(items, updateArchivePrefix, {
    maxItemsPerDate: defaultMaxItemsPerDate,
    ...options,
  });
}

export function readKoreanCodeArchive() {
  return readArchive(koreanCodeArchivePrefix, {
    latestPerDate: true,
    versionedOnly: true,
    maxItemsPerDate: defaultMaxItemsPerDate,
  });
}

export function archiveKoreanCodeUpdates(items = [], options = {}) {
  return archiveItems(items, koreanCodeArchivePrefix, {
    mergeExistingSnapshot: false,
    versionedSnapshot: true,
    latestPerDate: true,
    versionedOnly: true,
    maxItemsPerDate: defaultMaxItemsPerDate,
    ...options,
  });
}

export function readCinemaArchive() {
  return readArchive(cinemaArchivePrefix, {
    latestPerDate: true,
    versionedOnly: true,
    maxItemsPerDate: defaultMaxItemsPerDate,
  });
}

export function archiveCinemaUpdates(items = [], options = {}) {
  return archiveItems(items, cinemaArchivePrefix, {
    mergeExistingSnapshot: false,
    versionedSnapshot: true,
    latestPerDate: true,
    versionedOnly: true,
    maxItemsPerDate: defaultMaxItemsPerDate,
    ...options,
  });
}
