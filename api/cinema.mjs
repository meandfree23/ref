import { getLatestCinemaUpdates } from "../scripts/cinema-core.mjs";
import { readCinemaArchive } from "../scripts/update-archive.mjs";

export default async function handler(request, response) {
  try {
    const limit = Number(request.query.limit || 30);
    const archive = await readCinemaArchive();
    const shouldRefresh = request.query.refresh === "1" || !archive.items.length;
    const latest = shouldRefresh
      ? await getLatestCinemaUpdates({ limit })
      : {
        fetchedAt: new Date().toISOString(),
        sourceCount: 0,
        okSourceCount: 0,
        failedSources: [],
        limit,
        items: [],
      };
    const items = archive.items.length ? archive.items : latest.items;
    const archiveMeta = archive.items.length
      ? archive
      : {
        enabled: archive.enabled,
        itemCount: latest.items.length,
        dateCount: latest.items.length ? 1 : 0,
        dates: latest.items.length ? [new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })] : [],
        items: latest.items,
      };

    response.status(200).json({
      ...latest,
      latestItems: latest.items,
      items,
      archive: archiveMeta,
    });
  } catch (error) {
    try {
      const archive = await readCinemaArchive();
      response.status(200).json({
        fetchedAt: new Date().toISOString(),
        sourceCount: 0,
        okSourceCount: 0,
        failedSources: [],
        latestItems: [],
        items: archive.items,
        archive,
        warning: error.message,
      });
    } catch (fallbackError) {
      response.status(500).json({ ok: false, error: fallbackError.message });
    }
  }
}
