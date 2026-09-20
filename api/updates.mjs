import { getLatestUpdates } from "../scripts/updates-core.mjs";
import { readUpdateArchive } from "../scripts/update-archive.mjs";
import { dailyResearchItemTarget } from "../scripts/research-policy.mjs";

export default async function handler(request, response) {
  try {
    const limit = Number(request.query.limit || dailyResearchItemTarget);
    const archive = await readUpdateArchive();
    const shouldRefresh = request.query.refresh === "1" || !archive.items.length;
    const latest = shouldRefresh
      ? await getLatestUpdates({ limit })
      : {
        fetchedAt: new Date().toISOString(),
        sourceCount: 0,
        okSourceCount: 0,
        failedSources: [],
        limit,
        items: [],
        groups: [],
      };
    response.status(200).json({
      ...latest,
      latestItems: latest.items,
      items: archive.items.length ? archive.items : latest.items,
      archive,
    });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
