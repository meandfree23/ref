import { liveSearch } from "../scripts/search-core.mjs";

export default async function handler(request, response) {
  try {
    const query = request.query.q || "";
    const scope = request.query.scope || "expanded";
    const mode = ["live", "visual"].includes(request.query.mode) ? request.query.mode : "quick";
    const payload = await liveSearch(query, { scope, mode });
    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
