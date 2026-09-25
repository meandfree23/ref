// Deep insight agent: reads each archived reference (full article text when
// possible) and writes a grounded, specific reading into `item.deep`.
//
//   node scripts/deep-insight-agent.mjs [--daily-budget=80] [--backfill-budget=100]
//        [--daily-days=3] [--batch=8] [--concurrency=4] [--only=daily|backfill]
//
// Daily mode: newest items, one call per item, grounded in fetched body text.
// Backfill mode: older items in batches, grounded in the stored RSS summary.
import fs from "node:fs";
import path from "node:path";
import { fetchArticle, cleanFeedText } from "./article-text.mjs";
import { generateJson, hasGeminiKey, llmUsage, mapLimit, remainingBudget, setRequestBudget, textModels } from "./llm-core.mjs";
import { categories, craftAxes, legacyCategory, tabs } from "./insight-taxonomy.mjs";
import { readCuratorMemory, recordDeepResults, appendHealthLog, writeCuratorMemory } from "./curator-memory.mjs";

export const deepVersion = "deep-v1";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const dailyBudget = Number(args["daily-budget"] ?? 80);
const backfillBudget = Number(args["backfill-budget"] ?? 100);
const dailyDays = Number(args["daily-days"] ?? 3);
const batchSize = Number(args.batch ?? 8);
const concurrency = Number(args.concurrency ?? 4);
const only = args.only || "";

const kstKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(value));

function readArchiveFile(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function writeArchiveFile(file, payload) {
  const destination = path.resolve(file);
  fs.writeFileSync(`${destination}.tmp`, JSON.stringify(payload));
  fs.renameSync(`${destination}.tmp`, destination);
}

const deepSchemaProperties = {
  keep: { type: "BOOLEAN" },
  sharpness: { type: "INTEGER" },
  reason: { type: "STRING" },
  titleKo: { type: "STRING" },
  summaryKo: { type: "STRING" },
  novelty: { type: "STRING" },
  mechanism: { type: "STRING" },
  evidence: { type: "STRING" },
  steal: { type: "STRING" },
  limit: { type: "STRING" },
  category: { type: "STRING", enum: categories },
  axes: { type: "ARRAY", items: { type: "STRING", enum: craftAxes } },
  signals: { type: "ARRAY", items: { type: "STRING" } },
  timeless: { type: "BOOLEAN" },
};
const requiredFields = ["keep", "sharpness", "reason", "titleKo", "summaryKo", "novelty", "mechanism", "steal", "limit", "category", "axes", "signals", "timeless"];

const singleSchema = { type: "OBJECT", properties: deepSchemaProperties, required: requiredFields };
const batchSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { id: { type: "STRING" }, ...deepSchemaProperties },
    required: ["id", ...requiredFields],
  },
};

function systemPrompt(memory) {
  const taste = memory.taste_profile || {};
  return [
    "너는 'Reference Selector'의 수석 리서처다.",
    `독자: ${memory.reader || "한국 광고 영상 감독"}.`,
    `독자의 관심: ${(taste.core_interests || []).join(" / ")}.`,
    `독자의 취향 온도: ${taste.taste_temperature || ""}`,
    "목표: 자료 하나에서 독자가 다음 촬영·기획에 실제로 써먹을 날카로운 관찰만 뽑는다.",
    "규칙:",
    "1) 제공된 본문/요약에 있는 사실만 쓴다. 없는 수치, 이름, 장면, 인용을 지어내지 않는다. 근거가 부족하면 짧게 쓰고 sharpness를 낮춘다.",
    "2) 누구에게나 해당하는 일반론은 실패다. 예: '리듬이 중요하다', '관객의 감정을 움직인다', '결과보다 과정을 보라', '정체성을 드러낸다'. 반드시 고유명사, 구체 장면, 구체 기법, 구체 결정으로 쓴다.",
    "3) novelty: 기존 관행과 비교해 무엇이 다른지 한두 문장. mechanism: 그 효과가 어떤 선택(카메라, 편집, 재료, 카피, 유통 등)으로 만들어지는지.",
    "4) steal: 광고 영상 현장이나 기획 회의에서 바로 실행할 수 있는 행동 하나. 명령형으로. 예: '제품 컷을 12프레임 이내로 끊고 사운드가 빠지는 순간에 배치한다'.",
    "5) limit: 이 방식이 통하지 않는 조건이나 반론 한 문장.",
    "6) evidence: 본문에서 핵심 근거가 되는 문장을 원문 언어 그대로 짧게 인용(200자 이내). 본문이 없으면 빈 문자열.",
    "7) signals: 여러 기사에 걸쳐 반복될 수 있는 동시대 흐름을 짧은 한국어 명사구 2~4개로(각 4~14자). 예: '핸드헬드 다큐 질감 광고', 'AI 프리비즈', '오프라인 청취 공간'. 너무 넓은 말('디자인', '브랜딩', '혁신') 금지.",
    "8) 인사/실적/소송/시상식 가십/행사 공지/공모 안내/제품 스펙 뉴스는 keep=false, sharpness 1~3.",
    "8-1) 작품 자체가 레퍼런스인 경우(영화 스틸 아카이브, 뮤직비디오, 광고 영상, 단편, 타이틀 시퀀스, 사진 시리즈)는 글이 짧아도 '시각 레퍼런스'로서 가치를 판단한다. 이때 steal은 그 작품에서 훔쳐 볼 시각 요소(빛의 방향, 렌즈, 색, 구도, 편집 호흡)를 구체적으로 지목한다. 요약만으로 알 수 없는 시각 요소는 추측하지 말고 '확인할 것'으로 표현한다.",
    "8-2) 영화 비평·인터뷰는 연출 선택(쇼트 구성, 편집, 연기 디렉팅, 사운드, 구조)을 구체적으로 짚고 있으면 keep. 줄거리와 호불호만 있으면 keep=false.",
    "9) 한국어로, 짧고 단정하게. 번역투('~을 제공합니다', '~라고 말합니다') 금지. 고유명사는 처음 한 번만 원어 병기.",
    "10) titleKo는 기사의 핵심을 담은 자연스러운 한국어 제목(45자 이내). summaryKo는 사실 요약 2문장(200자 이내). RSS 찌꺼기('The post…', '[Watch]') 제거.",
    "sharpness 기준: 9~10 이 자료 없이는 몰랐을 구체적 제작 원리나 전략 / 7~8 명확한 기법과 결정이 드러남 / 5~6 흥미롭지만 적용이 약함 / 1~4 뉴스·가십·일반론.",
    "timeless: 시의성과 무관하게 오래 참고할 레퍼런스면 true.",
  ].join("\n");
}

function itemHeader(item) {
  return [
    `출처: ${item.sourceName || ""}`,
    `원제목: ${item.articleTitle || item.title || ""}`,
    item.titleKo ? `기존 한글 제목: ${item.titleKo}` : "",
    `원문 날짜: ${item.originalDate || item.date || ""}`,
    `URL: ${item.url}`,
  ].filter(Boolean).join("\n");
}

const clip = (value, max) => {
  const text = cleanFeedText(String(value || "")).trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function normaliseDeep(raw = {}, item, meta) {
  const sharpness = Math.max(1, Math.min(10, Math.round(Number(raw.sharpness) || 1)));
  const category = categories.includes(raw.category) ? raw.category : legacyCategory(item);
  const axes = [...new Set((raw.axes || []).filter((axis) => craftAxes.includes(axis)))].slice(0, 4);
  const signals = [...new Set((raw.signals || [])
    .map((signal) => String(signal).replace(/[#"'`]/g, "").trim())
    .filter((signal) => signal.length >= 2 && signal.length <= 20))].slice(0, 4);
  return {
    v: deepVersion,
    at: new Date().toISOString(),
    model: meta.model,
    grounding: meta.grounding,
    keep: Boolean(raw.keep) && sharpness >= 6,
    sharpness,
    reason: clip(raw.reason, 120),
    titleKo: clip(raw.titleKo, 80),
    summaryKo: clip(raw.summaryKo, 260),
    novelty: clip(raw.novelty, 220),
    mechanism: clip(raw.mechanism, 240),
    evidence: meta.grounding === "fulltext" ? clip(raw.evidence, 240) : "",
    steal: clip(raw.steal, 200),
    limit: clip(raw.limit, 180),
    category,
    axes,
    signals,
    timeless: Boolean(raw.timeless),
  };
}

function needsDeep(item) {
  return !item.deep || item.deep.v !== deepVersion;
}

async function readSingle(entry, system) {
  const { item } = entry;
  const article = await fetchArticle(item.url);
  const grounding = article.ok ? "fulltext" : (article.description || item.summary) ? "summary" : "title";
  const body = article.ok
    ? article.text
    : [article.description, cleanFeedText(item.summary)].filter(Boolean).join("\n");
  const prompt = [
    itemHeader(item),
    `근거 수준: ${grounding === "fulltext" ? "원문 본문" : grounding === "summary" ? "요약만 있음 (evidence는 빈 문자열)" : "제목만 있음 (sharpness 5 이하)"}`,
    "---- 본문 ----",
    body || "(본문 없음)",
  ].join("\n");
  const { data, model } = await generateJson({ prompt, system, schema: singleSchema, models: rotate(entry.index) });
  if (article.image && !item.image) item.image = article.image;
  if (article.url && article.url !== item.url && /news\.google\.com/.test(item.url)) {
    item.googleNewsUrl ||= item.url;
    item.url = article.url;
  }
  return normaliseDeep(data, item, { model, grounding });
}

async function readBatch(entries, system, batchIndex) {
  const blocks = entries.map(({ item }, index) => [
    `### id: b${index}`,
    itemHeader(item),
    `요약: ${cleanFeedText(item.summary || "") || "(없음)"}`,
    item.summaryKo && !/이 글은 .*영역에서|원문 제목의 구체적 대상/.test(item.summaryKo) ? `기존 한글 요약: ${item.summaryKo}` : "",
  ].filter(Boolean).join("\n"));
  const prompt = [
    `다음 ${entries.length}개 자료 각각을 판독하라. 본문 없이 요약만 있으므로 evidence는 모두 빈 문자열로 둔다.`,
    "요약에 구체 근거가 없으면 일반론으로 채우지 말고 sharpness를 낮춘다.",
    "각 결과의 id는 입력의 id(b0, b1 …)를 그대로 쓴다.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
  const { data, model } = await generateJson({
    prompt,
    system,
    schema: batchSchema,
    maxOutputTokens: 8192,
    timeoutMs: 120000,
    models: rotate(batchIndex),
  });
  const byId = new Map((Array.isArray(data) ? data : []).map((row) => [String(row.id), row]));
  return entries.map(({ item }, index) => {
    const row = byId.get(`b${index}`);
    return row ? normaliseDeep(row, item, { model, grounding: "summary" }) : null;
  });
}

function rotate(index = 0) {
  const offset = index % textModels.length;
  return [...textModels.slice(offset), ...textModels.slice(0, offset)];
}

async function main() {
  if (!hasGeminiKey()) {
    console.log(JSON.stringify({ ok: false, skipped: "GEMINI_API_KEY missing" }));
    return;
  }
  setRequestBudget(dailyBudget + backfillBudget);
  const memory = readCuratorMemory();
  const system = systemPrompt(memory);
  const archives = Object.values(tabs).map((tab) => ({ tab, payload: readArchiveFile(tab.archive) }));
  const saveAll = () => archives.forEach(({ tab, payload }) => writeArchiveFile(tab.archive, payload));

  const now = Date.now();
  const dailyCutoff = kstKey(now - (dailyDays - 1) * 86400000);
  const all = archives.flatMap(({ tab, payload }) => payload.items.map((item) => ({ tab: tab.key, item })));
  const pending = all.filter(({ item }) => needsDeep(item));
  const daily = pending
    .filter(({ item }) => kstKey(item.date || item.archivedAt) >= dailyCutoff)
    .sort((a, b) => new Date(b.item.date || 0) - new Date(a.item.date || 0))
    .map((entry, index) => ({ ...entry, index }));
  const backlog = pending
    .filter(({ item }) => kstKey(item.date || item.archivedAt) < dailyCutoff)
    .sort((a, b) => new Date(b.item.date || 0) - new Date(a.item.date || 0));

  const report = { startedAt: new Date().toISOString(), daily: { candidates: daily.length, done: 0, failed: 0, fulltext: 0 }, backfill: { candidates: backlog.length, done: 0, failed: 0 } };
  const results = [];

  if (only !== "backfill" && daily.length) {
    const dailySlice = daily.slice(0, dailyBudget);
    let sinceSave = 0;
    await mapLimit(dailySlice, concurrency, async (entry) => {
      try {
        entry.item.deep = await readSingle(entry, system);
        results.push({ tab: entry.tab, item: entry.item });
        report.daily.done += 1;
        if (entry.item.deep.grounding === "fulltext") report.daily.fulltext += 1;
      } catch (error) {
        report.daily.failed += 1;
        report.lastError = error.message;
      }
      sinceSave += 1;
      if (sinceSave >= 10) { sinceSave = 0; saveAll(); }
    });
    saveAll();
  }

  if (only !== "daily" && backlog.length && remainingBudget() > 0) {
    const batches = [];
    for (let offset = 0; offset < backlog.length; offset += batchSize) batches.push(backlog.slice(offset, offset + batchSize));
    const allowed = batches.slice(0, Math.min(batches.length, remainingBudget(), backfillBudget));
    let sinceSave = 0;
    await mapLimit(allowed, concurrency, async (entries, batchIndex) => {
      try {
        const readings = await readBatch(entries, system, batchIndex);
        readings.forEach((deep, index) => {
          if (!deep) { report.backfill.failed += 1; return; }
          entries[index].item.deep = deep;
          results.push({ tab: entries[index].tab, item: entries[index].item });
          report.backfill.done += 1;
        });
      } catch (error) {
        report.backfill.failed += entries.length;
        report.lastError = error.message;
      }
      sinceSave += 1;
      if (sinceSave >= 5) { sinceSave = 0; saveAll(); }
    });
    saveAll();
  }

  const remaining = all.filter(({ item }) => needsDeep(item)).length;
  report.remainingWithoutDeep = remaining;
  report.usage = llmUsage();
  report.finishedAt = new Date().toISOString();
  recordDeepResults(memory, results);
  appendHealthLog(memory, {
    agent: "deep-insight",
    daily: report.daily,
    backfill: report.backfill,
    remaining,
    requests: report.usage.requests,
    failures: report.usage.failures,
    lastError: report.lastError || null,
  });
  writeCuratorMemory(memory);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
