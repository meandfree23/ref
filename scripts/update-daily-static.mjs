import { runDailyUpdate } from "./daily-update-core.mjs";
import { dailyResearchItemTarget } from "./research-policy.mjs";

const target = Number(process.env.DAILY_RESEARCH_TARGET || dailyResearchItemTarget);
const limit = Number(process.env.DAILY_RESEARCH_LIMIT || Math.max(80, target));
const recoveryMode = process.env.DAILY_RECOVERY_MODE === "1";
const report = await runDailyUpdate({ target, limit });

if (!report.allTabsComplete) {
  console.error(JSON.stringify(report, null, 2));
  // A source pool can run dry on any given day: dedup against the full archive
  // shrinks the fresh-item supply as the archive grows, independent of any bug.
  // The recovery retry (DAILY_RECOVERY_MODE=1) is our best-effort second pass
  // with loosened thresholds. If it still falls short of the per-tab target,
  // publish whatever genuinely new items were actually found today instead of
  // discarding real progress and leaving the date missing entirely. The first
  // (non-recovery) pass still throws so self-heal knows to trigger that retry.
  const tabs = [report, report.koreanCode, report.cinema];
  const hasAnyNewContent = tabs.some((tab) => (tab?.addedToday ?? 0) > 0);
  if (!recoveryMode || !hasAnyNewContent) {
    throw new Error("Daily static archive did not reach the target for every tab.");
  }
  console.error(
    "Recovery pass still under target after retry; publishing partial results "
    + "instead of discarding today's real progress.",
  );
}

console.log(JSON.stringify(report, null, 2));
