import fs from "node:fs";
import path from "node:path";
import { getLatestUpdates, localizeUpdateItems } from "./updates-core.mjs";
import { selectNovelItems } from "./curation-policy.mjs";
import { archiveUpdates, readUpdateArchive } from "./update-archive.mjs";
import { itemsForKstDate, kstDateKeyToIso, todayKstKey } from "./research-policy.mjs";
import { enrichWithContentInsight } from "./content-insight-core.mjs";

const target = 15;
const bookmarkMaximum = 5;
const today = todayKstKey();
const before = await readUpdateArchive();
const historicalItems = before.items.filter((item) => !itemsForKstDate([item], today).length);
const latest = await getLatestUpdates({ limit: 360, enrich: false });
const policy = { maxPerSource: 3, semanticThreshold: 0.82 };

function pickLayer(layer, count, seedItems = []) {
  return selectNovelItems(
    latest.items.filter((item) => item.sourceLayer === layer),
    historicalItems,
    count,
    { ...policy, seedItems },
  );
}

const bookmarkUp = pickLayer("bookmark-up", bookmarkMaximum);
const editorialTarget = target - bookmarkUp.length;
const editorial = pickLayer("editorial", editorialTarget, bookmarkUp);
if (editorial.length !== editorialTarget) {
  throw new Error(`Not enough novel items for ${today}: editorial=${editorial.length}/${editorialTarget}, bookmark-up=${bookmarkUp.length}`);
}

const ordered = [];
for (let index = 0; ordered.length < target; index += 1) {
  ordered.push(...editorial.slice(index * 2, index * 2 + 2));
  if (bookmarkUp[index]) ordered.push(bookmarkUp[index]);
}
if (process.env.REBUILD_PREVIEW === "1") {
  console.log(JSON.stringify({
    ok: true,
    today,
    preview: ordered.slice(0, target).map((item) => ({
      sourceLayer: item.sourceLayer,
      sourceName: item.sourceName,
      title: item.title,
      summary: item.summary,
      url: item.url,
    })),
  }, null, 2));
  process.exit(0);
}
const manualTranslationPath = process.env.REBUILD_TRANSLATIONS
  ? path.resolve(process.env.REBUILD_TRANSLATIONS)
  : "";
let localized;
if (manualTranslationPath) {
  const translations = JSON.parse(fs.readFileSync(manualTranslationPath, "utf8"));
  const translationByUrl = new Map((translations.items || []).map((item) => [item.url, item]));
  localized = ordered.slice(0, target).map((item) => {
    const translation = translationByUrl.get(item.url);
    if (!translation?.titleKo || !translation?.summaryKo) {
      throw new Error(`Manual translation missing for ${item.url}`);
    }
    return enrichWithContentInsight({
      ...item,
      titleKo: translation.titleKo,
      summaryKo: translation.summaryKo,
      focusKo: translation.focusKo || "동시대 창작 문화와 제작 방식",
    }, { role: "updates" });
  });
} else {
  localized = await localizeUpdateItems(ordered.slice(0, target));
}
const selected = selectNovelItems(localized, historicalItems, target, policy);
if (selected.length !== target) {
  throw new Error(`Localized curation did not retain ${target} novel items: ${selected.length}`);
}

await archiveUpdates(selected, {
  collectionDate: kstDateKeyToIso(today),
  maxItemsPerSnapshot: target,
  mergeExistingSnapshot: false,
  useCollectionDate: true,
});

const after = await readUpdateArchive();
const todayItems = itemsForKstDate(after.items, today);
const sourceLayers = todayItems.reduce((counts, item) => {
  const key = item.sourceLayer || "unknown";
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
if (
  todayItems.length !== target
  || sourceLayers.editorial !== editorialTarget
  || (sourceLayers["bookmark-up"] || 0) !== bookmarkUp.length
) {
  throw new Error(`Rebuilt archive failed composition check: ${JSON.stringify({ count: todayItems.length, sourceLayers })}`);
}

console.log(JSON.stringify({
  ok: true,
  today,
  count: todayItems.length,
  sourceLayers,
  sources: [...new Set(todayItems.map((item) => item.sourceName))],
  items: todayItems.map((item) => ({
    sourceLayer: item.sourceLayer,
    sourceName: item.sourceName,
    title: item.titleKo || item.title,
    url: item.url,
  })),
}, null, 2));
