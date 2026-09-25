import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { curationStats } from "./curation-policy.mjs";
import { referenceLensCoverage } from "./reference-lenses.mjs";

const discoveryReportPath = path.resolve("data/discovery-report.json");
const socialReportPath = path.resolve("data/social-discovery-report.json");
import { readLegacyArchivePayload } from "./legacy-archive-payload.mjs";
const lifeStatePath = path.resolve("data/life-state.json");
const offspringPath = path.resolve("data/life-offspring.json");

function runNodeScript(script) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });
  return {
    script,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readStaticArchive() {
  return readLegacyArchivePayload();
}

function fieldCounts(items = []) {
  const counts = {};
  for (const item of items) {
    const field = item.field || "unknown";
    counts[field] = (counts[field] || 0) + 1;
  }
  return counts;
}

function weakestFields(counts = {}, minimum = 5) {
  return Object.entries(counts)
    .filter(([, count]) => count < minimum)
    .sort((a, b) => a[1] - b[1])
    .map(([field, count]) => ({ field, count, target: minimum }));
}

function promoteCandidates(report) {
  return (report?.tabs || []).flatMap((tab) => (tab.candidates || [])
    .filter((candidate) => candidate.recommendation === "promote")
    .map((candidate) => ({
      kind: "source",
      tab: tab.tab,
      id: candidate.id,
      name: candidate.name,
      feedUrl: candidate.feedUrl,
      novel: candidate.novel,
      score: candidate.score,
      reason: "high novelty source candidate",
    })));
}

function socialWatchCandidates(report) {
  return (report?.routes || [])
    .filter((route) => ["watch", "sample"].includes(route.recommendation))
    .map((route) => ({
      kind: "social-route",
      tab: route.tab,
      id: route.id,
      platform: route.platform,
      query: route.query,
      novel: route.novel,
      sample: (route.sample || []).slice(0, 3).map((item) => ({
        title: item.title,
        url: item.url,
        score: item.score,
      })),
      reason: "live social signal worth repeated observation",
    }));
}

function makeMutationCandidates({ weakKoreanFields, weakUpdateLenses, sourceCandidates, socialCandidates }) {
  const mutations = [];
  for (const weak of weakKoreanFields) {
    if (weak.field === "디자인/광고") {
      mutations.push({
        kind: "query-mutation",
        tab: "koreanCode",
        field: "디자인/광고",
        id: "mutation-korean-design-advertising-studio",
        query: "Korean creative studio branding identity campaign interview",
        reason: "Korean Code design/advertising remains under target",
      });
      mutations.push({
        kind: "query-mutation",
        tab: "koreanCode",
        field: "디자인/광고",
        id: "mutation-korean-graphic-design-global",
        query: "Korean graphic designer identity exhibition global profile",
        reason: "Need more creator-led Korean graphic design references",
      });
    }
  }
  const videoPracticeQueries = {
    "moving-image-language": "director cinematographer visual language lighting camera movement breakdown",
    "exhibition-space": "moving image exhibition projection installation spatial experience curator interview",
    "brand-advertising": "advertising film director campaign craft brand film case study",
    "short-film-story": "short film director interview screenplay visual storytelling production",
    "production-craft": "film production making of VFX edit sound design workflow",
    "strategy-planning": "creative strategy audience insight campaign planning effectiveness case study",
  };
  for (const weak of weakUpdateLenses) {
    const query = videoPracticeQueries[weak.field];
    if (!query) continue;
    mutations.push({
      kind: "query-mutation",
      tab: "updates",
      field: weak.field,
      id: `mutation-video-practice-${weak.field}`,
      query,
      reason: `Video practice reference lens remains under target (${weak.count}/${weak.target})`,
    });
  }
  for (const candidate of sourceCandidates.slice(0, 4)) {
    mutations.push({
      kind: "promotion-review",
      tab: candidate.tab,
      id: candidate.id,
      feedUrl: candidate.feedUrl,
      reason: candidate.reason,
    });
  }
  for (const candidate of socialCandidates.slice(0, 5)) {
    mutations.push({
      kind: "social-watch-review",
      tab: candidate.tab,
      id: candidate.id,
      platform: candidate.platform,
      query: candidate.query,
      reason: candidate.reason,
    });
  }
  return mutations;
}

const runDiscovery = process.env.LIFE_SKIP_DISCOVERY !== "1";
const runs = runDiscovery
  ? [
    runNodeScript("scripts/discovery-agent.mjs"),
    runNodeScript("scripts/social-discovery-agent.mjs"),
  ]
  : [];

const archive = readStaticArchive();
const discoveryReport = readJson(discoveryReportPath, { tabs: [] });
const socialReport = readJson(socialReportPath, { routes: [] });
const updates = archive.items || [];
const koreanCode = archive.koreanCode?.items || [];
const cinema = archive.cinema?.items || [];
const sourceCandidates = promoteCandidates(discoveryReport);
const socialCandidates = socialWatchCandidates(socialReport);
const koreanFields = fieldCounts(koreanCode);
const weakKoreanFields = weakestFields(koreanFields);
const updateLenses = referenceLensCoverage(updates);
const weakUpdateLenses = weakestFields(updateLenses, 15);
const mutations = makeMutationCandidates({
  weakKoreanFields,
  weakUpdateLenses,
  sourceCandidates,
  socialCandidates,
});

const health = {
  generatedAt: new Date().toISOString(),
  mode: process.env.LIFE_APPLY === "1" ? "apply-enabled" : "proposal-only",
  archive: {
    updates: {
      dates: archive.archive?.dateCount || 0,
      referenceLenses: updateLenses,
      weakLenses: weakUpdateLenses,
      ...curationStats(updates),
    },
    koreanCode: {
      dates: archive.koreanCode?.archive?.dateCount || 0,
      fields: koreanFields,
      weakFields: weakKoreanFields,
      ...curationStats(koreanCode),
    },
    cinema: {
      dates: archive.cinema?.archive?.dateCount || 0,
      ...curationStats(cinema),
    },
  },
  immuneSystem: {
    duplicateUrls: curationStats([...updates, ...koreanCode, ...cinema]).duplicates,
    lowKoreanDesignAdvertising: (koreanFields["디자인/광고"] || 0) < 5,
    autoPromotion: false,
  },
  discovery: {
    runs,
    sourcePromotions: sourceCandidates,
    socialWatch: socialCandidates,
  },
  reproduction: {
    mutations,
    nextTick: [
      "Review promotion-review candidates before editing source lists.",
      "Keep social routes as watch-only until repeated quality is confirmed.",
      "Prioritize Korean Code design/advertising mutations.",
    ],
  },
};

fs.writeFileSync(lifeStatePath, `${JSON.stringify(health, null, 2)}\n`, "utf8");
fs.writeFileSync(offspringPath, `${JSON.stringify({
  generatedAt: health.generatedAt,
  mode: health.mode,
  candidates: mutations,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  state: lifeStatePath,
  offspring: offspringPath,
  mode: health.mode,
  immuneSystem: health.immuneSystem,
  mutations: mutations.length,
  sourcePromotions: sourceCandidates.length,
  socialWatch: socialCandidates.length,
}, null, 2));
