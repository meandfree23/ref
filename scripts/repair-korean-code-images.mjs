import { repairKoreanCodeArticleAssets } from "./korean-code-core.mjs";
import { kstDateKeyToIso } from "./research-policy.mjs";
import { archiveKoreanCodeUpdates, readKoreanCodeArchive } from "./update-archive.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // The repair can still report local archive availability without credentials.
}

function dateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

const archive = await readKoreanCodeArchive();
if (!archive.enabled) throw new Error("Korean Code archive is not available");
const targetDate = String(process.env.REPAIR_DATE || "").trim();

const groups = new Map();
for (const item of archive.items) {
  const key = dateKey(item.date || item.archivedAt);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(item);
}

const reports = [];
for (const [key, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  if (targetDate && key !== targetDate) continue;
  const repaired = await repairKoreanCodeArticleAssets(items);
  const withImages = repaired.filter((item) => item.image).length;
  await archiveKoreanCodeUpdates(repaired, {
    collectionDate: kstDateKeyToIso(key),
    maxItemsPerSnapshot: 15,
    mergeExistingSnapshot: false,
    useCollectionDate: true,
  });
  reports.push({ date: key, items: repaired.length, withImages });
}

const after = await readKoreanCodeArchive();
console.log(JSON.stringify({
  ok: true,
  before: { items: archive.itemCount, dates: archive.dateCount },
  after: { items: after.itemCount, dates: after.dateCount },
  images: after.items.filter((item) => item.image).length,
  reports,
}, null, 2));
