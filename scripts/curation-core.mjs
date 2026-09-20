const sourceProfiles = [
  {
    match: /mobbin\.com|lapa\.ninja|awwwards\.com|dribbble\.com|behance\.net|abduzeedo\.com|muz\.li|notefolio\.net/i,
    role: "UI / Web Reference",
    strengths: ["interface", "web", "app", "ux", "ui", "interaction", "layout", "prototype", "visual"],
    uses: ["interface structure", "interaction pattern", "layout direction"],
    weight: 1.25,
  },
  {
    match: /motionographer\.com|directorslibrary\.com|shots\.net|vimeo\.com|youtube\.com|film-grab\.com|frameset\.app|nytimes\.com\/column\/anatomy/i,
    role: "Motion / Film Reference",
    strengths: ["motion", "video", "film", "scene", "commercial", "director", "treatment", "reel"],
    uses: ["motion language", "film mood", "sequence reference"],
    weight: 1.2,
  },
  {
    match: /adweek\.com|adage\.com|creativereview\.co\.uk|ignant\.com|fubiz\.net|hypebeast\.kr/i,
    role: "Insight / Culture Source",
    strengths: ["insight", "trend", "campaign", "advertising", "culture", "article", "brand", "story"],
    uses: ["strategic insight", "campaign context", "culture signal"],
    weight: 1.15,
  },
  {
    match: /dezeen\.com|designboom\.com|restofworld\.org|wired\.com/i,
    role: "Culture / Technology Signal",
    strengths: ["insight", "trend", "culture", "technology", "future", "design", "article"],
    uses: ["zeitgeist signal", "technology context", "global discourse"],
    weight: 1.12,
  },
  {
    match: /nowness\.com|dazeddigital\.com|highsnobiety\.com|voguebusiness\.com/i,
    role: "Fashion / Youth Culture Signal",
    strengths: ["fashion", "youth", "culture", "identity", "film", "image", "trend", "editorial"],
    uses: ["culture signal", "identity mood", "fashion context"],
    weight: 1.12,
  },
  {
    match: /the-brandidentity\.com|searchsystem\.co|fontsinuse\.com|producthunt\.com/i,
    role: "Design / Product Signal",
    strengths: ["design", "brand", "typography", "product", "technology", "interface", "tool"],
    uses: ["design direction", "product signal", "visual system"],
    weight: 1.1,
  },
  {
    match: /opendoors\.gallery|levineleavitt\.com|brunodayan\.com|andrewhem\.com|cassbird\.com|danielsimon\.com|krijnvannoordwijk\.com|tistory\.com|blog\.naver\.com/i,
    role: "Artist / Image Source",
    strengths: ["artist", "photographer", "portfolio", "gallery", "image", "editorial", "portrait", "visual"],
    uses: ["visual tone", "artist direction", "image reference"],
    weight: 1.18,
  },
  {
    match: /magnific\.com|flim\.ai|cosmos\.so|elements\.envato\.com|coolors\.co|pixeden\.com|ls\.graphics/i,
    role: "Tool / Asset Source",
    strengths: ["asset", "tool", "ai", "image", "generator", "mockup", "color", "resource"],
    uses: ["asset sourcing", "production tool", "visual material"],
    weight: 1.05,
  },
];

const intentRules = [
  {
    id: "interface",
    label: "Interface / Product",
    terms: ["ui", "ux", "interface", "app", "mobile", "native", "ios", "android", "web", "웹", "앱", "네이티브", "인터랙션", "프로토타입"],
    preferredStrengths: ["interface", "web", "app", "ux", "ui", "interaction", "prototype"],
  },
  {
    id: "motion",
    label: "Motion / Video",
    terms: ["motion", "video", "film", "reel", "scene", "영상", "필름", "무드", "모션", "시퀀스"],
    preferredStrengths: ["motion", "video", "film", "scene", "commercial", "reel"],
  },
  {
    id: "campaign",
    label: "Campaign / Insight",
    terms: ["campaign", "brand", "advertising", "marketing", "insight", "trend", "광고", "브랜드", "캠페인", "인사이트", "트렌드"],
    preferredStrengths: ["campaign", "advertising", "brand", "insight", "trend", "culture", "story"],
  },
  {
    id: "culture",
    label: "Culture / Zeitgeist",
    terms: ["culture", "youth", "identity", "fashion", "zeitgeist", "subculture", "global", "문화", "시대정신", "정체성", "세대", "패션", "월드", "글로벌"],
    preferredStrengths: ["culture", "trend", "fashion", "youth", "identity", "insight", "editorial"],
  },
  {
    id: "artist",
    label: "Artist / Visual",
    terms: ["artist", "photographer", "image", "photo", "editorial", "portrait", "gallery", "작가", "이미지", "사진", "포트폴리오", "비주얼"],
    preferredStrengths: ["artist", "photographer", "portfolio", "gallery", "image", "visual", "editorial"],
  },
  {
    id: "tooling",
    label: "Tool / Asset",
    terms: ["tool", "asset", "mockup", "generator", "ai", "color", "템플릿", "도구", "에셋", "생성", "컬러"],
    preferredStrengths: ["asset", "tool", "ai", "generator", "mockup", "resource"],
  },
];

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

export function getSourceProfile(bookmark) {
  const target = `${bookmark.host} ${bookmark.url} ${bookmark.path} ${bookmark.title}`;
  const matched = sourceProfiles.find((profile) => profile.match.test(target));
  if (matched) return matched;
  if (bookmark.sourceFolder === "작가") {
    return {
      role: "Artist / Image Source",
      strengths: ["artist", "portfolio", "image", "visual"],
      uses: ["visual tone", "artist direction"],
      weight: 1,
    };
  }
  if (bookmark.sourceFolder === "design") {
    return {
      role: "Design / Asset Source",
      strengths: ["design", "image", "visual", "asset", "tool", "motion"],
      uses: ["visual sourcing", "design material", "production reference"],
      weight: 1,
    };
  }
  if (bookmark.sourceFolder === "blog") {
    return {
      role: "Blog / Personal Archive",
      strengths: ["article", "story", "photography", "artist", "context"],
      uses: ["context discovery", "artist context", "long-tail reference"],
      weight: 1,
    };
  }
  if (bookmark.sourceFolder === "magazine") {
    return {
      role: "Magazine / Culture Source",
      strengths: ["culture", "trend", "article", "design", "fashion", "image"],
      uses: ["culture signal", "editorial context", "trend scan"],
      weight: 1,
    };
  }
  return {
    role: "General Reference Source",
    strengths: ["reference", "article", "visual", "web"],
    uses: ["reference scan", "context discovery"],
    weight: 1,
  };
}

export function analyzeIntent(query, terms) {
  const text = `${query} ${terms.join(" ")}`.toLowerCase();
  const axes = intentRules
    .map((rule) => {
      const hits = rule.terms.filter((term) => text.includes(term.toLowerCase()));
      return {
        id: rule.id,
        label: rule.label,
        score: hits.length,
        hits,
        preferredStrengths: rule.preferredStrengths,
      };
    })
    .filter((axis) => axis.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    axes: axes.length ? axes : [{
      id: "broad",
      label: "Broad Reference",
      score: 1,
      hits: [],
      preferredStrengths: ["reference", "visual", "story", "web"],
    }],
    preferredStrengths: Array.from(new Set(axes.flatMap((axis) => axis.preferredStrengths))),
  };
}

export function profileBoost(profile, intent) {
  const preferred = new Set(intent.preferredStrengths);
  const matched = profile.strengths.filter((strength) => preferred.has(strength));
  return {
    matched,
    boost: Math.round(matched.length * 5 * profile.weight),
  };
}

export function buildRecommendation(page, scoreParts, intent, quality = null) {
  const axes = intent.axes.slice(0, 2).map((axis) => axis.label).join(", ");
  const reasons = [];
  const layerLabel = page.sourceLayer === "core"
    ? "내 북마크 검증 소스"
    : page.sourceLayer === "verified"
      ? "검증 외부 편집 소스"
      : "탐색 소스";

  if (scoreParts.profileMatches.length) {
    reasons.push(`${layerLabel}: ${scoreParts.profileMatches.slice(0, 3).join(", ")} 관점과 맞음`);
  } else {
    reasons.push(`${layerLabel}: ${page.sourceProfile.role}`);
  }
  if (quality) {
    reasons.push(`품질 ${quality.total}/100 · 신뢰 ${quality.trust} · 관련 ${quality.relevance} · 시각 ${quality.visual}`);
  }

  if (scoreParts.titleHits.length) reasons.push(`제목 직접 신호: ${scoreParts.titleHits.slice(0, 3).join(", ")}`);
  if (scoreParts.descriptionHits.length) reasons.push(`설명 직접 신호: ${scoreParts.descriptionHits.slice(0, 3).join(", ")}`);
  if (page.images?.length) reasons.push(`원본 이미지 후보 ${page.images.length}개`);
  if (page.videos?.length) reasons.push(`원본 영상 후보 ${page.videos.length}개`);
  if (quality?.penalty) reasons.push(`잡음 신호 감점 ${quality.penalty}`);

  return {
    intent: axes,
    role: page.sourceProfile.role,
    uses: page.sourceProfile.uses,
    qualityLabel: quality?.label || "",
    reasons: reasons.slice(0, 4),
  };
}

export function summarizeNetwork(results) {
  const roles = new Map();
  const axes = new Map();
  const layers = new Map();

  for (const result of results) {
    roles.set(result.curation.role, (roles.get(result.curation.role) || 0) + 1);
    const layer = result.sourceLayer === "verified" ? "Verified External" : "Core Bookmark";
    layers.set(layer, (layers.get(layer) || 0) + 1);
    for (const use of result.curation.uses || []) {
      axes.set(use, (axes.get(use) || 0) + 1);
    }
  }

  return {
    layers: Array.from(layers, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    roles: Array.from(roles, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    uses: Array.from(axes, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}
