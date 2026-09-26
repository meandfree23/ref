// Removes duplicate references (same canonical URL) across dates in each archive,
// keeping the earliest archived copy. Safe to run any time; writes only when needed.
import fs from "node:fs";
import path from "node:path";
import { canonicalCurationUrl } from "./curation-policy.mjs";

const files = ["update-archive", "korean-code-archive", "cinema-archive"];
const report = {};
for (const name of files) {
  const file = path.resolve(`data/archives/${name}.json`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const byUrl = new Map();
  for (const item of payload.items) {
    const key = canonicalCurationUrl(item.url);
    const existing = byUrl.get(key);
    if (!existing) { byUrl.set(key, item); continue; }
    // keep the earliest copy, but carry over a deep reading if only the later one has it
    const [keep, drop] = new Date(existing.date || 0) <= new Date(item.date || 0) ? [existing, item] : [item, existing];
    if (!keep.deep && drop.deep) keep.deep = drop.deep;
    byUrl.set(key, keep);
  }
  const removed = payload.items.length - byUrl.size;
  report[name] = { before: payload.items.length, removed };
  if (removed > 0) {
    const items = [...byUrl.values()].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...payload, items }));
    fs.renameSync(`${file}.tmp`, file);
  }
}
console.log(JSON.stringify(report));
