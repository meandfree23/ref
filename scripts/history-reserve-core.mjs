import { readBookmarkHistoryIndex } from "./bookmark-history-core.mjs";
import { canonicalCurationUrl } from "./curation-policy.mjs";

const lowSignalPatterns = [
  /\b(?:coupon|promo code|discount|sale|tickets?|box office|where to watch)\b/i,
  /\b(?:login|sign in|newsletter|privacy policy|terms of use)\b/i,
];

const rolePatterns = {
  updates: /\b(?:design|creative|art|artist|architecture|brand|advertis|campaign|film|cinema|photograph|fashion|animation|motion|typograph|exhibition|installation|interactive|music video|short film|visual|director|studio)\b|디자인|창작|미술|예술|건축|브랜드|광고|캠페인|영화|사진|패션|애니메이션|전시|영상|감독/iu,
  koreanCode: /\b(?:korea|korean|seoul|busan|jeju|hanok|k[- ]?pop)\b|한국|서울|부산|제주|한옥|케이팝/iu,
  cinema: /\b(?:film|cinema|movie|filmmak|director|cinemat|screenplay|short film|animation|motion picture|moving image)\b|영화|시네마|영상|감독|촬영|각본|애니메이션/iu,
};

const fieldByFolder = {
  "작가": "미술/창작자",
  design: "디자인/광고",
  blog: "문화/비평",
  magazine: "문화/매거진",
  up: "개인 큐레이션",
};

const focusByRole = {
  updates: "creative method, visual language, production craft, culture and strategy",
  koreanCode: "Korean creative practice, cultural code and global translation",
  cinema: "film language, directing, cinematography, criticism and moving-image craft",
};

const lensesByRole = {
  updates: ["culture-signal", "production-craft", "strategy-planning"],
  koreanCode: ["culture-signal", "production-craft"],
  cinema: ["moving-image-language", "short-film-story", "production-craft"],
};

function usefulHistoryItem(item = {}, role) {
  const title = String(item.title || "").trim();
  const summary = String(item.description || "").trim();
  const text = `${title} ${summary} ${item.url || ""}`;
  if (!item.url || title.length < 8 || !rolePatterns[role]?.test(text)) return false;
  if (lowSignalPatterns.some((pattern) => pattern.test(text))) return false;
  return summary.length >= 40 || Boolean(item.image) || item.kind === "video";
}

export function getHistoryReserveCandidates(role, { limit = 2000, excludeItems = [] } = {}) {
  const excluded = new Set(excludeItems.flatMap((item) => [item?.url, item?.googleNewsUrl])
    .filter(Boolean)
    .map(canonicalCurationUrl));
  return readBookmarkHistoryIndex().items
    .filter((item) => usefulHistoryItem(item, role))
    .filter((item) => !excluded.has(canonicalCurationUrl(item.url)))
    .map((item) => {
      const title = String(item.title || "").trim();
      const date = item.publishedAt || item.modifiedAt || item.indexedAt;
      return {
        id: `history-reserve-${role}-${item.id}`,
        sourceId: `bookmark-history:${item.host}`,
        sourceName: item.host,
        sourceUrl: item.sourceBookmarkUrl,
        sourceLayer: item.sourceFolder === "up" ? "bookmark-up" : "bookmark-history",
        sourceFolder: item.sourceFolder,
        field: fieldByFolder[item.sourceFolder] || "창작/문화",
        focus: focusByRole[role],
        referenceLenses: lensesByRole[role],
        title,
        articleTitle: title,
        url: item.url,
        date,
        originalDate: date,
        summary: String(item.description || "").trim(),
        image: item.image || "",
        kind: item.kind || "web",
        trustReason: "사용자가 선별한 Chrome 북마크 출처의 공개 아카이브에서 발견했습니다.",
      };
    })
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, limit);
}
