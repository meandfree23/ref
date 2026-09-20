import fs from "node:fs";
import {
  archiveCinemaUpdates,
  archiveKoreanCodeUpdates,
  archiveUpdates,
} from "./update-archive.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Vercel injects the archive token in deployed environments.
}

function archiveItemsFrom(file) {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  return payload.archive?.items || payload.items || [];
}

const updatesFile = process.env.MIGRATE_UPDATES_FILE || "/tmp/ref-20260807-updates.json";
const koreanCodeFile = process.env.MIGRATE_KOREAN_FILE || "/tmp/ref-20260807-korean.json";
const cinemaFile = process.env.MIGRATE_CINEMA_FILE || "/tmp/ref-20260807-cinema.json";

const updatesItems = archiveItemsFrom(updatesFile);
const koreanCodeItems = archiveItemsFrom(koreanCodeFile);
const cinemaItems = archiveItemsFrom(cinemaFile);

const commonOptions = {
  mergeExistingSnapshot: false,
  maxItemsPerSnapshot: 0,
  useCollectionDate: false,
};

const [updates, koreanCode, cinema] = await Promise.all([
  archiveUpdates(updatesItems, commonOptions),
  archiveKoreanCodeUpdates(koreanCodeItems, commonOptions),
  archiveCinemaUpdates(cinemaItems, commonOptions),
]);

console.log(JSON.stringify({
  ok: true,
  updates: { items: updates.itemCount, dates: updates.dateCount },
  koreanCode: { items: koreanCode.itemCount, dates: koreanCode.dateCount },
  cinema: { items: cinema.itemCount, dates: cinema.dateCount },
}, null, 2));
