import { getLatestKoreanCodeUpdates, readKoreanCodeSeed } from "../scripts/korean-code-core.mjs";
import { readKoreanCodeArchive } from "../scripts/update-archive.mjs";

export default async function handler(request, response) {
  try {
    const limit = Number(request.query.limit || 30);
    const archive = await readKoreanCodeArchive();
    const shouldRefresh = request.query.refresh === "1" || !archive.items.length;
    const latest = shouldRefresh
      ? await getLatestKoreanCodeUpdates({ limit })
      : {
        fetchedAt: new Date().toISOString(),
        sourceCount: 0,
        okSourceCount: 0,
        failedSources: [],
        limit,
        items: [],
      };
    const seed = readKoreanCodeSeed();
    const items = archive.items.length ? archive.items : latest.items.length ? latest.items : seed.items;
    const archiveMeta = archive.items.length
      ? archive
      : latest.items.length
        ? {
          enabled: archive.enabled,
          itemCount: latest.items.length,
          dateCount: 1,
          dates: [new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })],
          items: latest.items,
        }
      : {
        enabled: archive.enabled,
        itemCount: seed.items.length,
        dateCount: 1,
        dates: [seed.updatedAt],
        items: seed.items,
      };

    response.status(200).json({
      ...latest,
      latestItems: latest.items,
      items,
      archive: archiveMeta,
      criteria: seed.scrapCriteria,
    });
  } catch (error) {
    try {
      const seed = readKoreanCodeSeed();
      const archive = await readKoreanCodeArchive();
      response.status(200).json({
        fetchedAt: new Date().toISOString(),
        sourceCount: 0,
        okSourceCount: 0,
        failedSources: [],
        latestItems: [],
        items: archive.items.length ? archive.items : seed.items,
        archive: archive.items.length ? archive : {
          enabled: archive.enabled,
          itemCount: seed.items.length,
          dateCount: 1,
          dates: [seed.updatedAt],
          items: seed.items,
        },
        criteria: seed.scrapCriteria,
        warning: error.message,
      });
    } catch (fallbackError) {
      response.status(500).json({ ok: false, error: fallbackError.message });
    }
  }
}
