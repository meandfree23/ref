import fs from "node:fs";
import path from "node:path";
import { enrichWithContentInsight } from "./content-insight-core.mjs";
import { readBookmarkHistoryIndex, writeBookmarkHistoryIndex } from "./bookmark-history-core.mjs";

const archiveFiles = [
  ["data/archives/update-archive.json", "updates"],
  ["data/archives/korean-code-archive.json", "korean-code"],
  ["data/archives/cinema-archive.json", "cinema"],
];

function writeJsonAtomic(file, payload) {
  const destination = path.resolve(file);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`);
  fs.renameSync(temporary, destination);
}

const report = {};
for (const [file, role] of archiveFiles) {
  const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  payload.items = (payload.items || []).map((item) => enrichWithContentInsight({
    ...item,
    ...(item.imageKind === "page-preview" ? {
      image: "",
      imageKind: "",
      imageLabel: "",
      imageSourceName: "",
      imageSourceUrl: "",
    } : {}),
  }, { role }));
  writeJsonAtomic(file, payload);
  report[file] = payload.items.length;
}

const history = readBookmarkHistoryIndex();
history.items = history.items.map((item) => enrichWithContentInsight(item, { role: "history" }));
const savedHistory = writeBookmarkHistoryIndex(history);
report["data/bookmark-history-index.json"] = savedHistory.itemCount;

console.log(JSON.stringify({ ok: true, engine: "role-aware-rules", report }, null, 2));
