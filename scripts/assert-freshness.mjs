// Final contract of the daily workflow: today's date must exist in every tab of
// the exported site data. Earlier steps are deliberately fault-tolerant
// (continue-on-error), which used to mean a fully rolled-back day still ended in a
// green run and nobody was notified. This step turns a missing date into a red run
// (and GitHub's failure email) instead of a silent gap.
import fs from "node:fs";
import path from "node:path";
import { todayKstKey } from "./research-policy.mjs";

const today = todayKstKey();
const tabs = ["updates", "korean-code", "cinema"];
const target = 15;

let meta = null;
try {
  meta = JSON.parse(fs.readFileSync(path.resolve("public/data/meta.json"), "utf8"));
} catch (error) {
  console.log(`::error::public/data/meta.json is unreadable: ${error.message}`);
  process.exit(1);
}

let recovery = null;
try {
  recovery = JSON.parse(fs.readFileSync(path.resolve("data/recovery-state.json"), "utf8"));
} catch {}

const rows = tabs.map((tab) => {
  const info = meta.tabs?.[tab] || {};
  return { tab, latest: info.latest || null, today: info.dayCounts?.[today] || 0 };
});
const missing = rows.filter((row) => row.today === 0);
const short = rows.filter((row) => row.today > 0 && row.today < target);

console.log(JSON.stringify({
  today,
  rows,
  recovery: recovery && {
    status: recovery.status,
    knownIncident: recovery.knownIncident,
    quarantined: (recovery.quarantined || []).length,
    partiallyRestored: recovery.partiallyRestored || [],
  },
}, null, 2));

for (const row of short) {
  console.log(`::warning::${row.tab} has ${row.today}/${target} items for ${today}; the next run's backfill will top it up.`);
}
if (missing.length) {
  console.log(`::error::No items published for ${today} in: ${missing.map((row) => row.tab).join(", ")}. `
    + `Recovery status: ${recovery?.status || "unknown"} (${recovery?.knownIncident || "no incident"}). See data/recovery-state.json.`);
  process.exit(1);
}
