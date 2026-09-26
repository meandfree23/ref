// Publish guard: refuses to let a run commit broken or shrinking site data.
// Compares the freshly exported public/data against the last committed copy (git HEAD).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const failures = [];
const warnings = [];
const must = (condition, message) => { if (!condition) failures.push(message); };
const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const readHead = (file) => {
  try { return JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { return null; }
};

const required = ["meta.json", "today.json", "signals.json", "curator.json", "updates-recent.json", "korean-code-recent.json", "cinema-recent.json", "updates-all.json", "korean-code-all.json", "cinema-all.json"];
for (const name of required) {
  const file = `public/data/${name}`;
  must(fs.existsSync(file), `${file} missing`);
  if (fs.existsSync(file)) { try { readJson(file); } catch (error) { failures.push(`${file} is not valid JSON: ${error.message}`); } }
}
if (!failures.length) {
  const meta = readJson("public/data/meta.json");
  const previous = readHead("public/data/meta.json");
  must(meta.generatedAt && !Number.isNaN(new Date(meta.generatedAt).getTime()), "meta.generatedAt invalid");
  for (const [tab, info] of Object.entries(meta.tabs || {})) {
    must(info.itemCount >= 100, `${tab}: item count too low (${info.itemCount})`);
    must(Array.isArray(info.dates) && info.dates.length >= 1, `${tab}: no dates`);
    const before = previous?.tabs?.[tab];
    if (before) {
      must(info.itemCount >= before.itemCount * 0.97, `${tab}: item count dropped ${before.itemCount} -> ${info.itemCount}`);
      must(info.readCount >= before.readCount * 0.97, `${tab}: deep-read count dropped ${before.readCount} -> ${info.readCount}`);
      must(info.latest >= before.latest, `${tab}: latest date went backwards ${before.latest} -> ${info.latest}`);
    }
    const recent = readJson(`public/data/${tab}-recent.json`);
    const all = readJson(`public/data/${tab}-all.json`);
    must(recent.items.length > 0 && all.items.length === info.itemCount, `${tab}: exported item files inconsistent`);
    must(all.items.every((item) => item.id && item.t && item.u && item.day), `${tab}: items with missing id/title/url/day`);
    const perDay = {}; all.items.forEach((item) => { perDay[item.day] = (perDay[item.day] || 0) + 1; });
    must(Object.values(perDay).every((count) => count <= 15), `${tab}: a day has more than 15 items`);
    const seen = new Set(); must(all.items.every((item) => !seen.has(item.id) && seen.add(item.id)), `${tab}: duplicate ids`);
  }
  if (previous?.readProgress && meta.readProgress.read < previous.readProgress.read * 0.97) failures.push(`readProgress dropped ${previous.readProgress.read} -> ${meta.readProgress.read}`);
  const today = readJson("public/data/today.json");
  if (!today.items?.length) warnings.push("today.json has no picks");
  const signals = readJson("public/data/signals.json");
  if (!signals.hypotheses?.length) warnings.push("signals.json has no hypotheses");
  for (const archive of ["update", "korean-code", "cinema"]) {
    const file = `data/archives/${archive}-archive.json`;
    try { const payload = readJson(file); must(Array.isArray(payload.items) && payload.items.length >= 100, `${file}: too few items`); } catch (error) { failures.push(`${file}: ${error.message}`); }
  }
  const memory = readJson("data/curator-memory.json");
  must(Array.isArray(memory.pipeline_health_log), "curator memory malformed");
}
console.log(JSON.stringify({ ok: failures.length === 0, failures, warnings }, null, 2));
if (failures.length) process.exit(1);
