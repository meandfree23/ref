import fs from "node:fs";
import path from "node:path";
import { hasKoreanText, translateToKorean } from "./korean-translation-core.mjs";

const archives = [
  { name: "Korean Code", file: "korean-code-archive.json" },
  { name: "Cinema", file: "cinema-archive.json" },
];

function fallbackSummary(item) {
  const source = item.sourceName || "원문 매체";
  const field = item.field || item.focus || "창작";
  return `${source}에서 다룬 ${field} 관련 기사로, 원문의 관점과 창작 방식을 확인할 수 있습니다.`;
}

async function repairItem(item) {
  const repaired = { ...item };
  if (!hasKoreanText(repaired.titleKo || "")) {
    repaired.titleKo = await translateToKorean(repaired.title || repaired.articleTitle || "");
  }
  if (!hasKoreanText(repaired.summaryKo || "")) {
    const sourceSummary = (repaired.summary || repaired.insight || repaired.title || "").slice(0, 110);
    repaired.summaryKo = sourceSummary
      ? await translateToKorean(sourceSummary)
      : fallbackSummary(repaired);
  }
  if (!hasKoreanText(repaired.summaryKo || "")) repaired.summaryKo = fallbackSummary(repaired);
  if (!hasKoreanText(repaired.insight || "")) repaired.insight = repaired.summaryKo;
  return repaired;
}

const report = [];
for (const archive of archives) {
  const archivePath = path.resolve("data/archives", archive.file);
  const payload = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  const missingBefore = payload.items.filter((item) => (
    !hasKoreanText(item.titleKo || "") || !hasKoreanText(item.summaryKo || "")
  ));

  const repairedByUrl = new Map();
  const batchSize = 8;
  for (let index = 0; index < missingBefore.length; index += batchSize) {
    const batch = missingBefore.slice(index, index + batchSize);
    const repaired = await Promise.all(batch.map(repairItem));
    repaired.forEach((item) => repairedByUrl.set(item.url, item));
    payload.items = payload.items.map((item) => repairedByUrl.get(item.url) || item);
    const temporary = `${archivePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload));
    fs.renameSync(temporary, archivePath);
  }

  const missingAfter = payload.items.filter((item) => (
    !hasKoreanText(item.titleKo || "") || !hasKoreanText(item.summaryKo || "")
  ));
  if (missingAfter.length) throw new Error(`${archive.name} localization repair incomplete: ${missingAfter.length}`);

  report.push({ archive: archive.name, repaired: missingBefore.length, remaining: missingAfter.length });
}

console.log(JSON.stringify({ ok: true, report }, null, 2));
