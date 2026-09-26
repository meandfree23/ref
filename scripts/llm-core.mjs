// Free-tier Gemini client shared by the insight, signal and search agents.
// Every call degrades gracefully: model fallback chain, retry on 429/5xx,
// per-model pacing under free-tier RPM and a hard per-run request budget.

const apiBase = "https://generativelanguage.googleapis.com/v1beta";

export const textModels = (process.env.GEMINI_TEXT_MODELS
  || "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.1-flash-lite-preview")
  .split(",").map((model) => model.trim()).filter(Boolean);
export const embeddingModel = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
export const embeddingDimensions = 256;

const minIntervalMs = Number(process.env.GEMINI_MIN_INTERVAL_MS || 4300); // 15 RPM free tier
const lastStart = new Map();
const disabledModels = new Set();
let requestBudget = Number(process.env.LLM_BUDGET || 400);
let requestsUsed = 0;
const usage = { requests: 0, failures: 0, byModel: {} };

export function hasGeminiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function setRequestBudget(value) {
  // Budget is relative to now, so long-lived processes (serverless warm
  // instances, dev server) get a fresh allowance per call site.
  requestBudget = requestsUsed + Number(value);
}

export function remainingBudget() {
  return Math.max(0, requestBudget - requestsUsed);
}

export function llmUsage() {
  return { ...usage, budget: requestBudget, used: requestsUsed };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pace(model) {
  // Reserve the slot synchronously so parallel workers do not all start at once.
  const now = Date.now();
  const previous = lastStart.get(model) || 0;
  const startAt = Math.max(now, previous + minIntervalMs);
  lastStart.set(model, startAt);
  if (startAt > now) await sleep(startAt - now);
}

// Embedding quota is 1K requests/day per free project. Extra free-tier keys can be
// listed in GEMINI_EMBED_KEYS (comma separated) to rotate when one is exhausted.
function embeddingKeys() {
  const extra = (process.env.GEMINI_EMBED_KEYS || "").split(",").map((key) => key.trim()).filter(Boolean);
  return [...new Set([process.env.GEMINI_API_KEY, ...extra].filter(Boolean))];
}

async function postJson(url, body, timeoutMs, apiKey = process.env.GEMINI_API_KEY) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep raw text */ }
    return { status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function extractText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.filter((part) => !part.thought).map((part) => part.text || "").join("");
}

function parseJsonLoose(text = "") {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("model returned non-JSON output");
  }
}

/**
 * Generate schema-constrained JSON. Returns { data, model } or throws after
 * the whole fallback chain fails.
 */
export async function generateJson({
  prompt,
  system = "",
  schema,
  temperature = 0.4,
  maxOutputTokens = 4096,
  timeoutMs = 90000,
  models = textModels,
  attemptsPerModel = 2,
}) {
  if (!hasGeminiKey()) throw new Error("GEMINI_API_KEY is not set");
  const errors = [];
  for (const model of models) {
    if (disabledModels.has(model)) continue;
    for (let attempt = 0; attempt < attemptsPerModel; attempt += 1) {
      if (remainingBudget() <= 0) throw new Error("LLM request budget exhausted");
      await pace(model);
      requestsUsed += 1;
      usage.requests += 1;
      usage.byModel[model] = (usage.byModel[model] || 0) + 1;
      const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          responseMimeType: "application/json",
          ...(schema ? { responseSchema: schema } : {}),
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      try {
        const result = await postJson(`${apiBase}/models/${model}:generateContent`, body, timeoutMs);
        if (result.status === 200) {
          const text = extractText(result.json);
          const finish = result.json?.candidates?.[0]?.finishReason;
          if (!text) throw new Error(`empty response (${finish || "no candidate"})`);
          return { data: parseJsonLoose(text), model };
        }
        const message = result.json?.error?.message || result.text.slice(0, 200);
        const details = JSON.stringify(result.json?.error?.details || []);
        errors.push(`${model} ${result.status}: ${message}`);
        if (result.status === 404 || result.status === 400) {
          disabledModels.add(model);
          break;
        }
        if (result.status === 429 && (/per day|PerDay|daily/i.test(message) || /PerDay/i.test(details))) {
          disabledModels.add(model);
          break;
        }
        await sleep(result.status === 429 ? 20000 : 4000 * (attempt + 1));
      } catch (error) {
        errors.push(`${model}: ${error.name === "AbortError" ? "timeout" : error.message}`);
        await sleep(3000);
      }
    }
  }
  usage.failures += 1;
  throw new Error(`all models failed: ${errors.slice(-4).join(" | ")}`);
}

/**
 * Embed texts. Free tier: 100 requests/minute and 1,000/day per project, and
 * every item in a batch counts as one request. We send 50 per call, round-robin
 * across the available keys, honour retryDelay on per-minute 429s and move on
 * when a key reports its daily quota.
 */
export async function embedTexts(texts = [], { taskType = "RETRIEVAL_DOCUMENT", batchSize = 50 } = {}) {
  if (!hasGeminiKey()) throw new Error("GEMINI_API_KEY is not set");
  const vectors = [];
  const keys = embeddingKeys();
  const exhausted = new Set();
  const nextAllowed = new Map(); // key -> timestamp when it may be used again
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const slice = texts.slice(offset, offset + batchSize);
    const body = {
      requests: slice.map((text) => ({
        model: `models/${embeddingModel}`,
        content: { parts: [{ text: String(text || " ").slice(0, 6000) }] },
        taskType,
        outputDimensionality: embeddingDimensions,
      })),
    };
    let lastError = "";
    let done = false;
    for (let attempt = 0; attempt < 12 && !done; attempt += 1) {
      const available = keys.filter((key) => !exhausted.has(key));
      if (!available.length) break;
      // Pick the key that is allowed soonest.
      const apiKey = available.sort((a, b) => (nextAllowed.get(a) || 0) - (nextAllowed.get(b) || 0))[0];
      const wait = (nextAllowed.get(apiKey) || 0) - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 65000));
      const result = await postJson(`${apiBase}/models/${embeddingModel}:batchEmbedContents`, body, 60000, apiKey)
        .catch((error) => ({ status: 0, text: error.message }));
      if (result.status === 200 && result.json?.embeddings?.length === slice.length) {
        for (const embedding of result.json.embeddings) vectors.push(normalise(embedding.values));
        // Budget the per-minute window: after a full batch, rest this key.
        nextAllowed.set(apiKey, Date.now() + Math.ceil(slice.length / 100 * 62000));
        done = true;
        continue;
      }
      const message = result.json?.error?.message || result.text || "";
      lastError = `${result.status} ${message.slice(0, 160)}`;
      if (result.status === 429) {
        const details = JSON.stringify(result.json?.error?.details || []);
        const retry = Number((details.match(/"retryDelay":"(\d+)s"/) || [])[1] || 60);
        if (/PerDay|per day|daily/i.test(details) || !/PerMinute/i.test(details)) {
          exhausted.add(apiKey);
        } else {
          nextAllowed.set(apiKey, Date.now() + (retry + 2) * 1000);
        }
        continue;
      }
      await sleep(3000 * (attempt + 1));
    }
    if (!done) {
      const error = new Error(`embedding failed at ${offset}: ${lastError}`);
      error.partial = vectors;
      throw error;
    }
  }
  return vectors;
}

export function normalise(values) {
  const vector = Float32Array.from(values);
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  return vector;
}

/** Run async tasks with a fixed worker count, preserving result order. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: error.message };
      }
    }
  });
  await Promise.all(runners);
  return results;
}
