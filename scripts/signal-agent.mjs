// Signal agent: reads the last N days of deep readings across all three tabs
// and writes evidence-backed hypotheses about what is shifting.
//   node scripts/signal-agent.mjs [--days=14]
import fs from "node:fs";
import path from "node:path";
import { generateJson, hasGeminiKey, llmUsage, setRequestBudget } from "./llm-core.mjs";
import { tabs } from "./insight-taxonomy.mjs";
import { appendHealthLog, readCuratorMemory, writeCuratorMemory } from "./curator-memory.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const windowDays = Number(args.days ?? 14);
const outputPath = path.resolve("data/signals.json");
const kstKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(value));

const schema = {
  type: "OBJECT",
  properties: {
    hypotheses: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          thesis: { type: "STRING" },
          evidenceIds: { type: "ARRAY", items: { type: "STRING" } },
          momentum: { type: "STRING", enum: ["새로 등장", "확산 중", "굳어지는 중"] },
          implication: { type: "STRING" },
          counter: { type: "STRING" },
          watch: { type: "STRING" },
        },
        required: ["title", "thesis", "evidenceIds", "momentum", "implication", "counter", "watch"],
      },
    },
    clusters: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { label: { type: "STRING" }, ids: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["label", "ids"],
      },
    },
  },
  required: ["hypotheses", "clusters"],
};

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch {
    return { history: [] };
  }
}

async function main() {
  if (!hasGeminiKey()) {
    console.log(JSON.stringify({ ok: false, skipped: "GEMINI_API_KEY missing" }));
    return;
  }
  setRequestBudget(6);
  const memory = readCuratorMemory();
  const since = kstKey(Date.now() - (windowDays - 1) * 86400000);
  const pool = [];
  for (const tab of Object.values(tabs)) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(tab.archive), "utf8"));
    for (const item of payload.items) {
      if (!item.deep || item.deep.sharpness < 5) continue;
      const day = kstKey(item.date || item.archivedAt);
      if (day < since) continue;
      pool.push({ tab: tab.key, day, item });
    }
  }
  pool.sort((a, b) => b.item.deep.sharpness - a.item.deep.sharpness);
  const selected = pool.slice(0, 180);
  if (selected.length < 12) {
    console.log(JSON.stringify({ ok: false, skipped: `only ${selected.length} readings in window` }));
    return;
  }
  const byId = new Map(selected.map((entry) => [entry.item.archiveId, entry]));
  const lines = selected.map(({ tab, day, item }) => [
    `[${item.archiveId}]`,
    day,
    tab,
    item.sourceName,
    `| ${item.deep.titleKo}`,
    `| 신호: ${item.deep.signals.join(", ")}`,
    `| 새로움: ${item.deep.novelty.slice(0, 120)}`,
  ].join(" "));
  const previous = readPrevious();
  const previousTitles = (previous.hypotheses || []).map((hypothesis) => hypothesis.title);

  const system = [
    "너는 광고 영상 감독을 위한 트렌드 리서처다. 개별 기사 요약이 아니라 여러 자료에 걸친 흐름을 가설로 세운다.",
    `독자: ${memory.reader}. 관심: ${(memory.taste_profile?.core_interests || []).join(" / ")}.`,
    "규칙: 각 가설은 서로 다른 출처 2곳 이상, 자료 3개 이상을 evidenceIds로 인용해야 한다. 목록에 있는 id만 쓴다.",
    "가설 제목은 20자 안팎의 단정한 한국어 명제. 예: '광고가 다큐의 손떨림을 빌려온다'.",
    "thesis는 무엇이 어떻게 바뀌는지 2~3문장. implication은 광고 연출/기획에서 지금 할 수 있는 선택 하나. counter는 이 가설이 틀릴 수 있는 이유. watch는 다음 2주 동안 이 가설을 확인할 구체적 신호.",
    "일반론('AI가 중요해진다', '경험이 중요하다') 금지. 자료에 있는 구체 사례를 thesis에 1~2개 이름으로 언급한다.",
    "clusters: 반복되는 소재 묶음 6~10개. label은 짧은 한국어 명사구, ids는 해당 자료 id.",
  ].join("\n");
  const prompt = [
    `최근 ${windowDays}일 동안 판독한 자료 ${selected.length}개다. 3~5개의 가설을 세워라.`,
    previousTitles.length ? `지난 판독의 가설(이어지면 momentum에 반영, 같은 말 반복 금지): ${previousTitles.join(" / ")}` : "",
    "",
    lines.join("\n"),
  ].filter(Boolean).join("\n");

  const { data, model } = await generateJson({ prompt, system, schema, maxOutputTokens: 8192, timeoutMs: 150000, temperature: 0.5 });
  const validIds = (ids = []) => [...new Set(ids.map((id) => String(id).replace(/[[\]]/g, "").trim()).filter((id) => byId.has(id)))];
  const hypotheses = (data.hypotheses || []).map((hypothesis) => {
    const evidenceIds = validIds(hypothesis.evidenceIds);
    const sources = new Set(evidenceIds.map((id) => byId.get(id).item.sourceName));
    const days = evidenceIds.map((id) => byId.get(id).day).sort();
    return {
      ...hypothesis,
      evidenceIds,
      sourceCount: sources.size,
      firstSeen: days[0] || null,
      lastSeen: days.at(-1) || null,
      tabs: [...new Set(evidenceIds.map((id) => byId.get(id).tab))],
    };
  }).filter((hypothesis) => hypothesis.evidenceIds.length >= 3 && hypothesis.sourceCount >= 2);
  const clusters = (data.clusters || [])
    .map((cluster) => ({ label: String(cluster.label).trim(), ids: validIds(cluster.ids) }))
    .filter((cluster) => cluster.label && cluster.ids.length >= 2)
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, 10);

  const today = kstKey(Date.now());
  const history = [
    { date: today, titles: hypotheses.map((hypothesis) => hypothesis.title) },
    ...(previous.history || []).filter((entry) => entry.date !== today),
  ].slice(0, 30);
  const payload = {
    generatedAt: new Date().toISOString(),
    model,
    windowDays,
    since,
    readingCount: selected.length,
    hypotheses,
    clusters,
    history,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  appendHealthLog(memory, { agent: "signal", hypotheses: hypotheses.length, clusters: clusters.length, readings: selected.length, requests: llmUsage().requests });
  writeCuratorMemory(memory);
  console.log(JSON.stringify({ ok: true, hypotheses: hypotheses.map((hypothesis) => `${hypothesis.title} (${hypothesis.evidenceIds.length})`), clusters: clusters.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
