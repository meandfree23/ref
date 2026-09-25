// Brief-based semantic reference search.
//   GET  /api/brief?q=...&layers=archive,history&n=36   -> ranked references
//   POST /api/brief  { q, results:[{id,t,s,st,c,ax}] }             -> AI board composition
import fs from "node:fs";
import path from "node:path";
import { craftAxes } from "../scripts/insight-taxonomy.mjs";
import { embedTexts, generateJson, hasGeminiKey, setRequestBudget } from "../scripts/llm-core.mjs";

const indexDir = path.resolve("data/search");
const tokenize = (text = "") => String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
const scale = 400;
let cache = null;

function loadIndex() {
  if (cache) return cache;
  const manifest = JSON.parse(fs.readFileSync(path.join(indexDir, "manifest.json"), "utf8"));
  const shards = manifest.shards.map(({ name }) => {
    const meta = JSON.parse(fs.readFileSync(path.join(indexDir, `${name}.json`), "utf8"));
    const buffer = fs.readFileSync(path.join(indexDir, `${name}.bin`));
    // docs are ordered: vectorised first (matching .bin), then lexical-only.
    const docs = meta.docs.map((doc) => ({ ...doc, hay: ` ${tokenize(`${doc.meta.t} ${doc.meta.sn || ""} ${doc.meta.st || ""} ${doc.meta.s || ""} ${doc.meta.f || ""}`).join(" ")} ` }));
    return { name, docs, vectorised: meta.vectorised ?? meta.docs.length, vectors: new Int8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
  });
  cache = { manifest, shards };
  return cache;
}

function rank(queryVector, queryTokens, layers, limit) {
  const { shards, manifest } = loadIndex();
  const dims = manifest.dimensions;
  const scored = [];
  for (const shard of shards) {
    for (let index = 0; index < shard.docs.length; index += 1) {
      const doc = shard.docs[index];
      const layer = doc.meta.l === "bookmark" ? "history" : doc.meta.l;
      if (!layers.has(layer)) continue;
      const hasVector = queryVector && index < shard.vectorised;
      let score = 0;
      if (hasVector) {
        const offset = index * dims;
        let dot = 0;
        for (let dim = 0; dim < dims; dim += 1) dot += queryVector[dim] * shard.vectors[offset + dim];
        score = dot / scale;
      }
      let lexical = 0;
      for (const token of queryTokens) if (doc.hay.includes(token)) lexical += 1;
      if (!hasVector) {
        // Lexical-only docs: comparable scale to a moderate semantic hit when several tokens match.
        if (lexical === 0) continue;
        score = 0.35 + Math.min(4, lexical) * 0.08;
      } else {
        score += Math.min(3, lexical) * 0.02;
      }
      if (doc.meta.l === "archive") {
        if (doc.meta.k) score += 0.03;
        if (doc.meta.sh) score += doc.meta.sh * 0.003;
      }
      scored.push({ id: doc.id, score, ...doc.meta });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const perSource = new Map();
  const results = [];
  for (const item of scored) {
    const key = item.s || item.u;
    const count = perSource.get(key) || 0;
    if (count >= 3) continue;
    perSource.set(key, count + 1);
    results.push({ ...item, score: Number(item.score.toFixed(4)) });
    if (results.length >= limit) break;
  }
  return results;
}

const composeSchema = {
  type: "OBJECT",
  properties: {
    read: { type: "STRING" },
    boards: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          axis: { type: "STRING", enum: craftAxes },
          title: { type: "STRING" },
          why: { type: "STRING" },
          ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["axis", "title", "why", "ids"],
      },
    },
    gaps: { type: "STRING" },
    next: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["read", "boards", "gaps", "next"],
};

async function compose(query, results) {
  setRequestBudget(3);
  const lines = results.slice(0, 30).map((item) => `[${item.id}] ${item.t} | ${item.s}${item.c ? ` | ${item.c}` : ""}${item.st ? ` | 가져갈 점: ${item.st}` : ""}${item.sn ? ` | ${item.sn}` : ""}`);
  const system = [
    "너는 한국 광고 영상 감독의 레퍼런스 리서처다. 브리프를 읽고 검색 결과를 연출 축별 레퍼런스 보드로 묶는다.",
    "규칙: 목록에 있는 id만 쓴다. 보드는 3~5개, 보드마다 2~6개 id. why는 이 묶음이 브리프에 맞는 이유를 구체적으로 한 문장(일반론 금지).",
    "read: 브리프를 연출 언어로 번역한 해석 1~2문장. gaps: 결과에 빠진 관점 한 문장. next: 더 좁혀 볼 검색어 3개(짧은 한국어).",
  ].join("\n");
  const prompt = `브리프: ${query}\n\n검색 결과:\n${lines.join("\n")}`;
  const { data, model } = await generateJson({ prompt, system, schema: composeSchema, timeoutMs: 24000, attemptsPerModel: 1, maxOutputTokens: 3000 });
  const valid = new Set(results.map((item) => item.id));
  return {
    model,
    read: data.read,
    gaps: data.gaps,
    next: (data.next || []).slice(0, 3),
    boards: (data.boards || [])
      .map((board) => ({ ...board, ids: (board.ids || []).filter((id) => valid.has(id)) }))
      .filter((board) => board.ids.length >= 2),
  };
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(request, response) {
  const started = Date.now();
  try {
    if (request.method === "POST") {
      const body = await readBody(request);
      const query = String(body.q || "").slice(0, 400);
      if (!query || !Array.isArray(body.results) || !body.results.length) {
        response.status(400).json({ ok: false, error: "q and results are required" });
        return;
      }
      if (!hasGeminiKey()) {
        response.status(200).json({ ok: false, error: "AI 해설을 쓰려면 서버에 GEMINI_API_KEY가 필요합니다." });
        return;
      }
      const board = await compose(query, body.results);
      response.status(200).json({ ok: true, took: Date.now() - started, ...board });
      return;
    }
    const query = String(request.query.q || "").trim().slice(0, 400);
    if (!query) {
      response.status(400).json({ ok: false, error: "q is required" });
      return;
    }
    const layers = new Set(String(request.query.layers || "archive,history").split(","));
    const limit = Math.min(60, Number(request.query.n || 36));
    let queryVector = null;
    let mode = "lexical";
    if (hasGeminiKey()) {
      try {
        [queryVector] = await embedTexts([query], { taskType: "RETRIEVAL_QUERY" });
        mode = "semantic";
      } catch {
        queryVector = null;
      }
    }
    const results = rank(queryVector, tokenize(query), layers, limit);
    response.setHeader("cache-control", "s-maxage=3600, stale-while-revalidate=86400");
    response.status(200).json({ ok: true, query, mode, took: Date.now() - started, count: results.length, results });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
