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
  // Use archivedToday (existing-plus-added total for today), not addedToday:
  // once the first pass already wrote some of today's items to disk, a retry
  // with nothing left to add for an already-satisfied tab correctly reports
  // addedToday=0 even though that tab (e.g. cinema reaching its full 15) has
  // real, valid content sitting in the archive right now.
  const tabs = [report, report.koreanCode, report.cinema];
  const hasAnyPublishableContent = tabs.some((tab) => (tab?.archivedToday ?? 0) > 0);
  if (!recoveryMode || !hasAnyPublishableContent) {
    throw new Error("Daily static archive did not reach the target for every tab.");
  }
  console.error(
    "Recovery pass still under target after retry; publishing partial results "
    + "instead of discarding today's real progress.",
  );
}

console.log(JSON.stringify(report, null, 2));
