const lensDefinitions = [
  {
    id: "moving-image-language",
    labelKo: "영상 언어",
    useKo: "카메라, 조명, 색, 미장센과 편집의 선택을 살핍니다.",
    patterns: [
      /cinematograph/i, /camera (?:work|movement|lens)/i, /film lighting/i, /colour|color grad(?:e|ing)/i, /mise[- ]en[- ]sc[eè]ne/i,
      /production design/i, /editing/i, /title sequence/i, /visual language/i, /image[- ]making/i,
    ],
  },
  {
    id: "exhibition-space",
    labelKo: "전시·공간",
    useKo: "영상과 관객, 스크린, 공간이 만나는 방식을 살핍니다.",
    patterns: [
      /exhibition/i, /museum/i, /gallery/i, /installation/i, /immersive/i, /projection/i,
      /spatial/i, /pavilion/i, /scenograph/i, /public art/i, /experience design/i,
    ],
  },
  {
    id: "brand-advertising",
    labelKo: "광고·브랜드",
    useKo: "브랜드의 메시지를 영상 아이디어와 캠페인으로 번역하는 법을 살핍니다.",
    patterns: [
      /campaign/i, /commercial/i, /advertis/i, /brand film/i, /branded/i, /creative director/i,
      /brand identity/i, /visual identity/i, /client brief/i, /creative agency/i, /product film/i,
    ],
  },
  {
    id: "short-film-story",
    labelKo: "숏필름·서사",
    useKo: "짧은 러닝타임 안에서 인물, 구조, 감정을 설계하는 법을 살핍니다.",
    patterns: [
      /short film/i, /filmmaker/i, /director interview/i, /directorial/i, /narrative/i,
      /screenplay/i, /storytelling/i, /documentary/i, /music video/i,
    ],
  },
  {
    id: "production-craft",
    labelKo: "제작 기술",
    useKo: "실제 제작 과정과 도구, 협업 방식, 후반 작업의 판단을 살핍니다.",
    patterns: [
      /behind the scenes/i, /making of/i, /\bvfx\b/i, /animation/i, /motion design/i,
      /post[- ]production/i, /sound design/i, /virtual production/i, /practical effects/i,
      /production process/i, /workflow/i,
    ],
  },
  {
    id: "strategy-planning",
    labelKo: "마케팅·기획",
    useKo: "타깃, 인사이트, 포지셔닝, 매체와 성과의 연결을 살핍니다.",
    patterns: [
      /strategy/i, /audience/i, /marketing/i, /consumer/i, /insight/i, /creative brief/i,
      /pitching/i, /effectiveness/i, /media plan/i, /launch/i, /positioning/i, /case study/i,
    ],
  },
  {
    id: "culture-signal",
    labelKo: "문화 신호",
    useKo: "동시대의 취향, 태도, 장르와 커뮤니티 변화를 살핍니다.",
    patterns: [
      /culture/i, /trend/i, /youth/i, /fashion/i, /music/i, /community/i, /social media/i,
      /subculture/i, /cultural identity/i, /behavio[u]?r/i,
    ],
  },
];

const fallbackLens = lensDefinitions.at(-1);

export function classifyReferenceLens(item = {}) {
  const haystack = [
    item.title,
    item.summary,
    item.sourceName,
  ].filter(Boolean).join(" ");

  const ranked = lensDefinitions
    .map((lens, index) => ({
      lens,
      index,
      score: lens.patterns.reduce((score, pattern) => score + (pattern.test(haystack) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const preferredIds = Array.isArray(item.referenceLenses) ? item.referenceLenses : [];
  const preferred = preferredIds
    .map((id) => lensDefinitions.find((lens) => lens.id === id))
    .filter(Boolean);
  const selected = ranked[0]?.score > 0 ? ranked[0].lens : preferred[0] || fallbackLens;

  return {
    ...item,
    referenceLens: selected.id,
    referenceLensKo: selected.labelKo,
    referenceUseKo: selected.useKo,
  };
}

export function selectBalancedReferences(items = [], limit = 15, { maxPerSource = 3 } = {}) {
  const queues = new Map(lensDefinitions.map((lens) => [lens.id, []]));
  for (const item of items.map(classifyReferenceLens)) {
    const queue = queues.get(item.referenceLens) || queues.get(fallbackLens.id);
    queue.push(item);
  }

  const selected = [];
  const selectedUrls = new Set();
  const sourceCounts = new Map();
  const take = (item, sourceLimit) => {
    if (!item?.url || selectedUrls.has(item.url)) return false;
    const source = item.sourceId || item.sourceName || "unknown";
    if ((sourceCounts.get(source) || 0) >= sourceLimit) return false;
    selected.push(item);
    selectedUrls.add(item.url);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    return true;
  };

  while (selected.length < limit) {
    let progressed = false;
    for (const lens of lensDefinitions) {
      const queue = queues.get(lens.id);
      while (queue.length) {
        const item = queue.shift();
        if (take(item, maxPerSource)) {
          progressed = true;
          break;
        }
      }
      if (selected.length >= limit) break;
    }
    if (!progressed) break;
  }

  for (const item of items.map(classifyReferenceLens)) {
    if (selected.length >= limit) break;
    take(item, Number.POSITIVE_INFINITY);
  }
  return selected;
}

export function referenceLensCoverage(items = []) {
  const counts = Object.fromEntries(lensDefinitions.map((lens) => [lens.id, 0]));
  for (const item of items.map(classifyReferenceLens)) {
    counts[item.referenceLens] = (counts[item.referenceLens] || 0) + 1;
  }
  return counts;
}

export const referenceLenses = lensDefinitions.map(({ patterns, ...lens }) => lens);
