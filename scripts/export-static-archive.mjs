import fs from "node:fs";
import path from "node:path";
import { readSourceDataset } from "./sources-core.mjs";
import { readCinemaArchive, readKoreanCodeArchive, readUpdateArchive } from "./update-archive.mjs";
import { readCinemaSources } from "./cinema-core.mjs";
import { readKoreanCodeSeed, readKoreanCodeSources } from "./korean-code-core.mjs";
import { readUpdateSources } from "./updates-core.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Vercel injects the Blob token in deployed environments.
}

const outputPath = path.resolve("public/static-updates.js");
const archive = await readUpdateArchive();
const koreanArchive = await readKoreanCodeArchive();
const cinemaArchive = await readCinemaArchive();
const updateSources = readUpdateSources();
const koreanCodeSources = readKoreanCodeSources();
const cinemaSources = readCinemaSources();
const koreanSeed = readKoreanCodeSeed();
const sourceDataset = readSourceDataset("expanded");

const payload = {
  generatedAt: new Date().toISOString(),
  sourceCount: updateSources.sources.length,
  okSourceCount: updateSources.sources.length,
  archive: {
    enabled: archive.enabled,
    itemCount: archive.itemCount,
    dateCount: archive.dateCount,
    dates: archive.dates,
  },
  status: {
    bookmarkCount: sourceDataset.counts.core,
    verifiedCount: sourceDataset.counts.availableVerified,
    totalSourceCount: sourceDataset.counts.total,
  },
  items: archive.items,
  koreanCode: {
    generatedAt: new Date().toISOString(),
    sourceCount: koreanCodeSources.queries.length,
    okSourceCount: koreanCodeSources.queries.length,
    criteria: koreanSeed.scrapCriteria,
    archive: koreanArchive.items.length
      ? {
        enabled: koreanArchive.enabled,
        itemCount: koreanArchive.itemCount,
        dateCount: koreanArchive.dateCount,
        dates: koreanArchive.dates,
      }
      : {
        enabled: koreanArchive.enabled,
        itemCount: koreanSeed.items.length,
        dateCount: 1,
        dates: [koreanSeed.updatedAt],
      },
    items: koreanArchive.items.length ? koreanArchive.items : koreanSeed.items,
  },
  cinema: {
    generatedAt: new Date().toISOString(),
    sourceCount: cinemaSources.sources.length,
    okSourceCount: cinemaSources.sources.length,
    archive: {
      enabled: cinemaArchive.enabled,
      itemCount: cinemaArchive.itemCount,
      dateCount: cinemaArchive.dateCount,
      dates: cinemaArchive.dates,
    },
    items: cinemaArchive.items,
  },
};

const file = `window.__STATIC_UPDATE_ARCHIVE__ = ${JSON.stringify(payload)};\n`;
fs.writeFileSync(outputPath, file, "utf8");

console.log(JSON.stringify({
  output: outputPath,
  items: payload.archive.itemCount,
  dates: payload.archive.dateCount,
  koreanCodeItems: payload.koreanCode.archive.itemCount,
  koreanCodeDates: payload.koreanCode.archive.dateCount,
  cinemaItems: payload.cinema.archive.itemCount,
  cinemaDates: payload.cinema.archive.dateCount,
  dateKeys: payload.archive.dates,
}, null, 2));
