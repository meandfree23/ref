import { runDailyUpdate } from "./daily-update-core.mjs";
import { dailyResearchItemTarget } from "./research-policy.mjs";

const target = Number(process.env.DAILY_RESEARCH_TARGET || dailyResearchItemTarget);
const limit = Number(process.env.DAILY_RESEARCH_LIMIT || Math.max(80, target));
const report = await runDailyUpdate({ target, limit });

if (!report.allTabsComplete) {
  console.error(JSON.stringify(report, null, 2));
  throw new Error("Daily static archive did not reach the target for every tab.");
}

console.log(JSON.stringify(report, null, 2));
