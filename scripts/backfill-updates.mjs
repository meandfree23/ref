import { archiveUpdates, readUpdateArchive } from "./update-archive.mjs";
import { getLatestUpdates } from "./updates-core.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Vercel injects the Blob token in deployed environments.
}

const limit = Number(process.env.BACKFILL_LIMIT || 500);
const before = await readUpdateArchive();
const recovered = await getLatestUpdates({ limit });
const after = await archiveUpdates(recovered.items);

console.log(JSON.stringify({
  requestedLimit: limit,
  sourceCount: recovered.sourceCount,
  okSourceCount: recovered.okSourceCount,
  failedSources: recovered.failedSources,
  recoveredFromFeeds: recovered.items.length,
  archiveBefore: {
    items: before.itemCount,
    dates: before.dateCount,
  },
  archiveAfter: {
    items: after.itemCount,
    dates: after.dateCount,
    dateKeys: after.dates,
  },
  newlyRecovered: Math.max(0, after.itemCount - before.itemCount),
}, null, 2));
