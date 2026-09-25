// Persistent curator memory: taste profile, per-source quality learned from
// deep readings, pipeline health log and editorial decisions.
import fs from "node:fs";
import path from "node:path";

const memoryPath = path.resolve("data/curator-memory.json");
const healthLogLimit = 90;

export function readCuratorMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryPath, "utf8"));
  } catch {
    return { version: 1, taste_profile: {}, source_quality: {}, pipeline_health_log: [], editorial_decisions: [], open_questions: [] };
  }
}

export function writeCuratorMemory(memory) {
  memory.updatedAt = new Date().toISOString();
  fs.writeFileSync(`${memoryPath}.tmp`, `${JSON.stringify(memory, null, 2)}\n`);
  fs.renameSync(`${memoryPath}.tmp`, memoryPath);
}

export function sourceKeyOf(item = {}) {
  return String(item.sourceName || item.sourceId || "unknown").trim();
}

/** Recompute source quality from every item that has a deep reading. */
export function rebuildSourceQuality(memory, archives = []) {
  const stats = {};
  for (const item of archives.flatMap((archive) => archive.items || [])) {
    if (!item.deep) continue;
    const key = sourceKeyOf(item);
    const entry = stats[key] ||= { seen: 0, kept: 0, sharpSum: 0, lastSeen: null };
    entry.seen += 1;
    if (item.deep.keep) entry.kept += 1;
    entry.sharpSum += item.deep.sharpness || 0;
    const date = item.date || item.archivedAt;
    if (!entry.lastSeen || date > entry.lastSeen) entry.lastSeen = date;
  }
  memory.source_quality = Object.fromEntries(Object.entries(stats)
    .map(([key, entry]) => {
      const keepRate = entry.seen ? entry.kept / entry.seen : 0;
      const avgSharpness = entry.seen ? entry.sharpSum / entry.seen : 0;
      const status = entry.seen >= 8 && keepRate < 0.2 && avgSharpness < 4.5
        ? "demoted"
        : entry.seen >= 6 && keepRate >= 0.6
          ? "trusted"
          : "watch";
      return [key, {
        seen: entry.seen,
        kept: entry.kept,
        keepRate: Number(keepRate.toFixed(2)),
        avgSharpness: Number(avgSharpness.toFixed(1)),
        lastSeen: entry.lastSeen,
        status,
      }];
    })
    .sort((a, b) => b[1].seen - a[1].seen));
  return memory.source_quality;
}

export function recordDeepResults(memory, results = []) {
  // Full recompute happens in the exporter; here we only keep a running tally
  // so a crash between agents still leaves a useful trace.
  memory.last_deep_run = {
    at: new Date().toISOString(),
    read: results.length,
    kept: results.filter(({ item }) => item.deep?.keep).length,
  };
}

export function appendHealthLog(memory, entry) {
  memory.pipeline_health_log = [
    { at: new Date().toISOString(), ...entry },
    ...(memory.pipeline_health_log || []),
  ].slice(0, healthLogLimit);
}

export function demotedSources(memory = readCuratorMemory()) {
  return new Set(Object.entries(memory.source_quality || {})
    .filter(([, entry]) => entry.status === "demoted")
    .map(([key]) => key.toLowerCase()));
}
