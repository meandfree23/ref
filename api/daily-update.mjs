import { runDailyUpdate } from "../scripts/daily-update-core.mjs";
import { dailyResearchItemTarget } from "../scripts/research-policy.mjs";

export default async function handler(request, response) {
  try {
    const target = Number(request.query.target || dailyResearchItemTarget);
    const limit = Number(request.query.limit || Math.max(80, target));
    response.status(200).json(await runDailyUpdate({ target, limit }));
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
