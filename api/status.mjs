import { readSourceDataset } from "../scripts/sources-core.mjs";

export default function handler(request, response) {
  const dataset = readSourceDataset("expanded");
  response.status(200).json({
    ok: true,
    bookmarkCount: dataset.counts.core,
    verifiedCount: dataset.counts.availableVerified,
    totalSourceCount: dataset.counts.total,
    folders: dataset.folders,
    updatedAt: dataset.generatedAt,
  });
}
