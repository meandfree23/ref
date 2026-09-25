// Builds the payload shape the pre-v2 scripts expected from
// public/static-updates.js, straight from the archive JSON files.
import fs from "node:fs";
import path from "node:path";

function readItems(name) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(`data/archives/${name}-archive.json`), "utf8")).items || [];
  } catch {
    return [];
  }
}

export function readLegacyArchivePayload() {
  const items = readItems("update");
  const koreanCode = readItems("korean-code");
  const cinema = readItems("cinema");
  const dates = (list) => [...new Set(list.map((item) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(item.date || item.archivedAt))))].sort().reverse();
  return {
    generatedAt: new Date().toISOString(),
    archive: { enabled: true, itemCount: items.length, dateCount: dates(items).length, dates: dates(items) },
    items,
    koreanCode: { archive: { enabled: true, itemCount: koreanCode.length, dateCount: dates(koreanCode).length, dates: dates(koreanCode) }, items: koreanCode },
    cinema: { archive: { enabled: true, itemCount: cinema.length, dateCount: dates(cinema).length, dates: dates(cinema) }, items: cinema },
  };
}
