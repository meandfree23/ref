// Fixed taxonomy so 44 drifting labels collapse into one navigable vocabulary.

export const categories = [
  "영상·연출",
  "광고·브랜드",
  "디자인·타이포",
  "사진·이미지",
  "공간·전시",
  "미술·물성",
  "패션·뷰티",
  "기술·AI",
  "영화·비평",
  "문화·신호",
];

export const craftAxes = [
  "카메라",
  "조명·색",
  "편집·리듬",
  "사운드",
  "타이포·그래픽",
  "공간·미술",
  "캐스팅·연기",
  "스토리·구조",
  "카피·메시지",
  "기술·AI",
  "재료·물성",
  "브랜드 전략",
];

// Legacy field / lens labels -> taxonomy (used until an item gets a deep reading).
const legacyMap = [
  [/영상 언어|숏필름|영상\/콘텐츠|연출|타이틀|모션|영상문화|제작 기술|숏필름\/영상제작/, "영상·연출"],
  [/광고|브랜드|마케팅|기획/, "광고·브랜드"],
  [/디자인|그래픽|타이포/, "디자인·타이포"],
  [/사진/, "사진·이미지"],
  [/전시|공간|건축|인테리어/, "공간·전시"],
  [/미술|회화|조각|공예|창작자/, "미술·물성"],
  [/패션|뷰티/, "패션·뷰티"],
  [/기술|AI|디지털|게임/, "기술·AI"],
  [/영화|시네마|비평|독립영화/, "영화·비평"],
];

export function legacyCategory(item = {}) {
  const label = `${item.field || ""} ${item.referenceLensKo || ""} ${item.focusKo || ""}`;
  for (const [pattern, category] of legacyMap) if (pattern.test(label)) return category;
  return "문화·신호";
}

export const tabs = {
  updates: { key: "updates", label: "업데이트", archive: "data/archives/update-archive.json" },
  "korean-code": { key: "korean-code", label: "Korean Code", archive: "data/archives/korean-code-archive.json" },
  cinema: { key: "cinema", label: "Cinema", archive: "data/archives/cinema-archive.json" },
};
