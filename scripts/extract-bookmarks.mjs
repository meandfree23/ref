import path from "node:path";
import fs from "node:fs";
import { readBookmarkDataset } from "./bookmarks-core.mjs";

const args = new Set(process.argv.slice(2));
const outputPath = path.resolve("data/bookmarks.json");

const dataset = readBookmarkDataset();

if (args.has("--check")) {
  console.log(`bookmarks ok: ${dataset.count} items from ${dataset.folders.join(", ")}`);
} else {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`Wrote ${dataset.count} bookmarks to ${outputPath}`);
}
