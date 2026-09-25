// Builds the semantic search index used by /api/brief.
// Layers: archive (3 tabs, sharded by month), bookmarks + history, instagram.
// Incremental: a doc is re-embedded only when its text hash changes.
//   node scripts/search-index-agent.mjs [--layers=archive,history,instagram] [--max=4000]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { embedTexts, embeddingDimensions, embeddingModel, hasGeminiKey } from "./llm-core.mjs";
import { legacyCategory, tabs } from "./insight-taxonomy.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const layers = (args.layers || "archive,history,instagram").split(",");
const maxNewEmbeddings = Number(args.max ?? 4000);
const indexDir = path.resolve("data/search");
fs.mkdirSync(indexDir, { recursive: true });

const hash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 12);
const kstMonth = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date(value || Date.now()));
const clean = (value = "", max = 400) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

function archiveDocs() {
  const docs = [];
  for (const tab of Object.values(tabs)) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(tab.archive), "utf8"));
    for (const item of payload.items) {
      const deep = item.deep || {};
      const title = deep.titleKo || item.titleKo || item.title;
      const text = [
        title,
        item.articleTitle || item.title,
        deep.summaryKo || item.summaryKo,
        deep.novelty,
        deep.mechanism,
        deep.steal,
        (deep.signals || []).join(", "),
        (deep.axes || []).join(", "),
        deep.category || legacyCategory(item),
        item.sourceName,
      ].filter(Boolean).join("\n");
      docs.push({
        id: `a:${item.archiveId}`,
        shard: `archive-${kstMonth(item.date || item.archivedAt)}`,
        text,
        meta: {
          l: "archive",
          tab: tab.key,
          t: clean(title, 140),
          u: item.url,
          img: ["related", "page-preview"].includes(item.imageKind) ? "" : item.image || "",
          s: item.sourceName || "",
          d: item.originalDate || item.date || null,
          c: deep.category || legacyCategory(item),
          ax: deep.axes || [],
          st: clean(deep.steal, 160),
          sh: deep.sharpness || null,
          k: deep.keep ?? null,
        },
      });
    }
  }
  return docs;
}

function historyDocs() {
  const docs = [];
  const seen = new Set();
  const bookmarks = JSON.parse(fs.readFileSync(path.resolve("data/bookmarks.json"), "utf8")).items || [];
  const history = JSON.parse(fs.readFileSync(path.resolve("data/bookmark-history-index.json"), "utf8")).items || [];
  for (const item of [...bookmarks, ...history]) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    const title = clean(item.title, 160);
    if (!title || title.length < 4) continue;
    const text = [title, clean(item.description, 500), item.host, item.path].filter(Boolean).join("\n");
    docs.push({
      id: `h:${hash(item.url)}`,
      shard: "history",
      text,
      meta: {
        l: item.sourceLayer === "history" ? "history" : "bookmark",
        t: title,
        u: item.url,
        img: item.image || "",
        s: item.host || "",
        d: item.publishedAt || null,
        f: item.sourceFolder || "",
        sn: clean(item.description, 160),
      },
    });
  }
  return docs;
}

function instagramDocs() {
  const file = path.resolve("data/instagram-saved.json");
  if (!fs.existsSync(file)) return [];
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  return (payload.items || []).filter((item) => item.code).map((item) => ({
    id: `i:${item.code}`,
    shard: "instagram",
    text: [`@${item.owner}`, clean(item.caption, 900), item.collections?.join(", ")].filter(Boolean).join("\n"),
    meta: {
      l: "instagram",
      t: clean(item.caption, 120) || `@${item.owner}`,
      u: `https://www.instagram.com/p/${item.code}/`,
      img: "",
      s: `@${item.owner}`,
      d: item.takenAt || null,
      f: (item.collections || []).join(", "),
      mt: item.mediaType || "",
    },
  }));
}

function readShard(name) {
  const metaFile = path.join(indexDir, `${name}.json`);
  const binFile = path.join(indexDir, `${name}.bin`);
  if (!fs.existsSync(metaFile) || !fs.existsSync(binFile)) return new Map();
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  const buffer = fs.readFileSync(binFile);
  const map = new Map();
  let cursor = 0;
  for (const doc of meta.docs) {
    if (!doc.vec) continue;
    const start = cursor * embeddingDimensions;
    cursor += 1;
    map.set(doc.id, { ...doc, vector: new Int8Array(buffer.buffer, buffer.byteOffset + start, embeddingDimensions).slice() });
  }
  return map;
}

function writeShard(name, docs) {
  // Vectorised docs first (their order matches the .bin), then lexical-only docs.
  const ordered = [...docs.filter((doc) => doc.vector), ...docs.filter((doc) => !doc.vector)];
  const vectorised = ordered.filter((doc) => doc.vector);
  const vectors = new Int8Array(vectorised.length * embeddingDimensions);
  vectorised.forEach((doc, index) => vectors.set(doc.vector, index * embeddingDimensions));
  fs.writeFileSync(path.join(indexDir, `${name}.bin`), Buffer.from(vectors.buffer));
  fs.writeFileSync(path.join(indexDir, `${name}.json`), JSON.stringify({
    model: embeddingModel,
    dimensions: embeddingDimensions,
    count: ordered.length,
    vectorised: vectorised.length,
    docs: ordered.map(({ vector, ...rest }) => ({ ...rest, vec: Boolean(vector) })),
  }));
  return { count: ordered.length, vectorised: vectorised.length };
}

function quantise(vector) {
  const out = new Int8Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    // Vectors are L2-normalised; components rarely exceed 0.5 in 256 dims.
    out[index] = Math.max(-127, Math.min(127, Math.round(vector[index] * 400)));
  }
  return out;
}

async function main() {
  if (!hasGeminiKey()) {
    console.log(JSON.stringify({ ok: false, skipped: "GEMINI_API_KEY missing" }));
    return;
  }
  const docs = [
    ...(layers.includes("archive") ? archiveDocs() : []),
    ...(layers.includes("history") ? historyDocs() : []),
    ...(layers.includes("instagram") ? instagramDocs() : []),
  ];
  const shards = new Map();
  for (const doc of docs) {
    if (!shards.has(doc.shard)) shards.set(doc.shard, []);
    shards.get(doc.shard).push({ ...doc, h: hash(doc.text) });
  }
  let budget = maxNewEmbeddings;
  const report = { shards: {}, embedded: 0, reused: 0, lexicalOnly: 0, embedError: null };
  // Archive shards first (most valuable), newest month first.
  const ordered = [...shards.entries()].sort(([a], [b]) => {
    const rank = (name) => (name.startsWith("archive-") ? 0 : name === "history" ? 1 : 2);
    return rank(a) - rank(b) || b.localeCompare(a);
  });
  for (const [name, shardDocs] of ordered) {
    const existing = readShard(name);
    const todo = shardDocs.filter((doc) => existing.get(doc.id)?.h !== doc.h);
    const now = report.embedError ? [] : todo.slice(0, budget);
    if (now.length) {
      try {
        const vectors = await embedTexts(now.map((doc) => doc.text), { batchSize: 100 });
        now.forEach((doc, index) => { doc.vector = quantise(vectors[index]); });
        budget -= now.length;
      } catch (error) {
        // Quota exhausted mid-way: keep whatever we got, defer the rest to tomorrow.
        (error.partial || []).forEach((vector, index) => { now[index].vector = quantise(vector); });
        budget -= (error.partial || []).length;
        report.embedError = error.message.slice(0, 160);
      }
    }
    const ready = shardDocs.map((doc) => {
      if (doc.vector) return doc;
      const previous = existing.get(doc.id);
      if (previous && previous.h === doc.h) return { ...doc, vector: previous.vector };
      return doc; // lexical-only until embedded
    }).map(({ text, shard, ...rest }) => rest);
    const written = writeShard(name, ready);
    const freshlyEmbedded = now.filter((doc) => doc.vector).length;
    report.embedded += freshlyEmbedded;
    report.reused += written.vectorised - freshlyEmbedded;
    report.lexicalOnly += written.count - written.vectorised;
    report.shards[name] = written;
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    model: embeddingModel,
    dimensions: embeddingDimensions,
    shards: Object.entries(report.shards).map(([name, value]) => ({ name, count: value.count, vectorised: value.vectorised })),
  };
  fs.writeFileSync(path.join(indexDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
