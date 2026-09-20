const topicProfiles = [
  {
    id: "moving-image",
    label: "영상 언어",
    terms: ["film", "video", "motion", "cinema", "movie", "director", "animation", "short film", "영화", "영상", "연출", "애니메이션"],
    insight: "장면 자체보다 움직임, 시간, 전환, 사운드가 하나의 감각으로 조직되는 방식을 볼 수 있습니다.",
    creativeUse: "숏필름과 전시 영상에서는 쇼트의 길이, 카메라 동선, 전환 지점, 사운드의 진입 시점을 분해해 적용할 수 있습니다.",
  },
  {
    id: "brand-strategy",
    label: "브랜드와 전략",
    terms: ["brand", "branding", "campaign", "advertising", "advertisement", "marketing", "consumer", "audience", "광고", "브랜드", "캠페인", "마케팅", "기획"],
    insight: "표현의 화려함보다 대상의 문제와 욕망을 어떤 한 문장과 행동으로 번역했는지가 핵심입니다.",
    creativeUse: "기획 단계에서 문제, 타깃의 긴장, 핵심 약속, 이를 증명하는 장면을 각각 한 줄로 분리해 볼 수 있습니다.",
  },
  {
    id: "space-exhibition",
    label: "공간과 전시",
    terms: ["architecture", "architect", "interior", "space", "spatial", "exhibition", "installation", "museum", "건축", "공간", "인테리어", "전시", "설치"],
    insight: "형태보다 관객의 이동, 빛, 재료, 스케일이 경험의 순서를 어떻게 만드는지에 주목할 자료입니다.",
    creativeUse: "전시 영상과 공간 연출에서는 진입, 머무름, 시선 전환, 퇴장의 네 구간으로 경험을 다시 설계할 수 있습니다.",
  },
  {
    id: "photography",
    label: "사진과 이미지",
    terms: ["photo", "photography", "photographer", "portrait", "camera", "image", "사진", "사진가", "이미지", "촬영", "카메라"],
    insight: "대상보다 프레이밍, 거리, 빛, 표면이 어떤 태도와 감정을 만드는지를 읽을 수 있습니다.",
    creativeUse: "촬영 전에 피사체와 카메라의 거리, 광원의 방향, 배경의 정보량, 반복할 프레임 규칙을 정하는 데 활용할 수 있습니다.",
  },
  {
    id: "music-sound",
    label: "음악과 사운드",
    terms: ["music", "musician", "song", "track", "album", "sound", "audio", "composer", "음악", "사운드", "노래", "트랙", "앨범", "작곡"],
    insight: "장르 이름보다 리듬, 음색, 반복, 침묵이 감정과 정체성을 만드는 방식을 들여다볼 수 있습니다.",
    creativeUse: "영상에서는 음악을 배경으로 붙이기보다 장면의 호흡, 반복 동작, 전환의 기준을 만드는 구조로 활용할 수 있습니다.",
  },
  {
    id: "art-material",
    label: "예술과 물성",
    terms: ["artist", "art", "painting", "sculpture", "gallery", "artwork", "craft", "material", "미술", "예술", "작가", "회화", "조각", "공예", "물성"],
    insight: "소재와 반복 행위가 개인의 경험이나 시대의 감각을 어떤 조형 언어로 바꾸는지 살펴볼 가치가 있습니다.",
    creativeUse: "작품의 소재, 제작 행위, 반복 규칙, 남겨진 흔적을 분리해 영상의 오브제와 행위 설계로 전환할 수 있습니다.",
  },
  {
    id: "design-system",
    label: "디자인 언어",
    terms: ["design", "graphic", "identity", "typography", "typeface", "poster", "logo", "website", "ui", "ux", "디자인", "그래픽", "타이포", "포스터", "로고", "웹사이트"],
    insight: "개별 장식보다 정보의 위계, 형태의 반복, 색과 타이포그래피의 규칙이 정체성을 만드는 방식이 중요합니다.",
    creativeUse: "키 비주얼을 만들 때 크기 위계, 반복 단위, 색 역할, 타이포그래피 규칙을 네 개의 제작 원칙으로 추출할 수 있습니다.",
  },
  {
    id: "fashion-culture",
    label: "패션과 스타일",
    terms: ["fashion", "style", "collection", "runway", "garment", "beauty", "패션", "스타일", "컬렉션", "런웨이", "의상", "뷰티"],
    insight: "의상 자체보다 실루엣, 몸의 움직임, 스타일링, 시대의 태도가 하나의 이미지 코드로 결합되는 지점이 핵심입니다.",
    creativeUse: "패션 영상에서는 실루엣, 동작, 공간, 음악 가운데 무엇을 주인공으로 둘지 먼저 결정하는 데 활용할 수 있습니다.",
  },
  {
    id: "technology-interaction",
    label: "기술과 인터랙션",
    terms: ["technology", "digital", "interactive", "interaction", "ai", "software", "interface", "game", "기술", "디지털", "인터랙션", "인공지능", "게임"],
    insight: "기술 자체보다 사용자의 행동과 피드백을 어떻게 새로운 경험의 규칙으로 바꾸는지가 중요합니다.",
    creativeUse: "인터랙티브 작업에서는 입력, 시스템의 반응, 시각·청각 피드백, 반복하고 싶은 보상을 순서대로 설계할 수 있습니다.",
  },
  {
    id: "culture-signal",
    label: "문화와 시대 감각",
    terms: ["culture", "society", "identity", "community", "generation", "trend", "future", "literature", "novel", "poet", "writer", "booker", "문화", "사회", "정체성", "세대", "트렌드", "시대", "문학", "소설", "시인", "문학상", "부커"],
    insight: "개별 사례 안에서 동시대 사람들이 무엇을 불편해하고 욕망하며 새롭게 받아들이는지 읽을 수 있습니다.",
    creativeUse: "리서치 노트에 관찰된 행동, 그 배경의 긴장, 새롭게 등장한 상징, 앞으로 확장될 가능성을 나누어 기록할 수 있습니다.",
  },
];

const methodProfiles = [
  {
    id: "interview",
    terms: ["interview", "conversation", "talks", "q&a", "인터뷰", "대화"],
    insight: "완성 결과보다 창작자가 무엇을 선택하고 포기했는지 판단 기준을 읽는 것이 유용합니다.",
  },
  {
    id: "process",
    terms: ["behind", "making", "process", "studio", "how", "craft", "production", "과정", "제작", "스튜디오", "메이킹"],
    insight: "결과를 만드는 순서와 제약 조건을 확인하면 반복 가능한 제작 원리로 전환할 수 있습니다.",
  },
  {
    id: "analysis",
    terms: ["analysis", "review", "critique", "essay", "research", "report", "best", "worst", "underrated", "different", "분석", "비평", "리뷰", "연구", "보고서", "최고", "최악", "저평가", "차이", "비교"],
    insight: "평가의 결론보다 작품을 해석하는 기준과 맥락을 추출해 다른 작업을 보는 렌즈로 쓰는 편이 좋습니다.",
  },
  {
    id: "case-study",
    terms: ["case study", "campaign", "project", "launch", "award", "사례", "프로젝트", "수상"],
    insight: "문제, 아이디어, 실행, 반응의 연결을 확인하면 기획과 결과 사이의 인과관계를 읽을 수 있습니다.",
  },
];

const lowValueSentencePatterns = [
  /cookie|privacy policy|terms of use|subscribe|newsletter|sign up|log in|all rights reserved/i,
  /쿠키|개인정보|이용약관|구독|로그인|회원가입|무단전재/i,
  /에서 스크랩한 .*관련 기사|제목의 쟁점을 중심으로|함께 확인할 수 있습니다|기사 후보|본문 확인이 필요한/i,
  /원문은 .*핵심 근거|원문 제목의 구체적 대상|이 글은 .*영역에서|동시대 크리에이티브 변화를 보여주는 사례|영화의 형식과 제작 판단을 살펴보는 사례/i,
];

const updateHighlights = {
  "moving-image": "움직임·편집·사운드를 하나의 리듬으로 묶은 방식이 핵심입니다.",
  "brand-strategy": "사람의 긴장을 하나의 약속과 행동으로 바꾼 아이디어가 핵심입니다.",
  "space-exhibition": "관객의 이동과 시선 순서로 메시지를 만든 공간 설계가 핵심입니다.",
  photography: "카메라의 거리와 빛으로 대상에 대한 태도를 만든 방식이 핵심입니다.",
  "music-sound": "반복·침묵·음색으로 장면의 감정선을 설계한 방식이 핵심입니다.",
  "art-material": "재료의 성질과 반복 행위 자체를 이야기로 바꾼 방식이 핵심입니다.",
  "design-system": "타이포·색·레이아웃을 여러 매체에서 반복되는 규칙으로 만든 점이 핵심입니다.",
  "fashion-culture": "실루엣과 몸의 태도를 동시대 취향의 이미지로 만든 방식이 핵심입니다.",
  "technology-interaction": "새 기술을 기능 자랑이 아니라 사람의 행동 변화로 연결한 점이 핵심입니다.",
  "culture-signal": "사람들이 새롭게 불편해하고 욕망하는 감각을 포착한 점이 핵심입니다.",
};

const roleLabels = {
  updates: "동시대 변화",
  "korean-code": "한국성과 세계성",
  cinema: "영화 언어",
  search: "검색 의도",
  history: "개인 아카이브",
};

const updateMeanings = {
  "moving-image": "장면의 정보보다 리듬·전환·사운드가 관객의 감정을 먼저 움직이기 때문입니다",
  "brand-strategy": "예쁜 표현보다 사람의 실제 긴장을 정확한 행동과 장면으로 바꾼 방식이 더 오래 남기 때문입니다",
  "space-exhibition": "형태보다 관객이 어디서 멈추고 무엇을 먼저 보는지가 경험의 의미를 결정하기 때문입니다",
  photography: "좋은 이미지의 차이는 장비보다 대상과 맺는 거리와 태도에서 생기기 때문입니다",
  "music-sound": "사운드는 배경이 아니라 편집의 속도와 감정의 방향을 정하는 뼈대이기 때문입니다",
  "art-material": "재료를 다루는 손과 시간의 흔적이 완성된 모양보다 더 강한 이야기를 만들기 때문입니다",
  "design-system": "한 번 멋진 결과보다 여러 화면에서 계속 살아남는 시각 규칙이 더 큰 힘을 갖기 때문입니다",
  "fashion-culture": "옷 자체보다 몸의 태도와 스타일링이 지금의 취향을 더 선명하게 보여주기 때문입니다",
  "technology-interaction": "기술의 가치는 기능 수가 아니라 사람의 행동을 얼마나 자연스럽게 바꾸는지에 있기 때문입니다",
  "culture-signal": "개인의 작은 선택이 세대와 커뮤니티가 공유하는 새로운 감각으로 번지고 있기 때문입니다",
};

const koreanCodeMeanings = {
  "moving-image": ["한국의 장소·몸·정서를 설명보다 리듬과 장면으로 체감시키는 방식", "지역적 경험을 보편적인 감정과 영화 문법으로 번역하는 과정"],
  "brand-strategy": ["한국 특유의 속도와 취향을 국제 시장이 이해할 수 있는 약속과 태도로 바꾸는 방식", "로컬 정체성을 장식이 아닌 브랜드의 판단 기준으로 만드는 과정"],
  "space-exhibition": ["도시의 밀도, 골목, 마당, 재료와 공동체 관계를 공간 경험으로 조직하는 방식", "한국의 생활 구조를 세계 관객이 이동하며 이해하는 공간 언어로 바꾸는 과정"],
  photography: ["정면성, 거리, 여백을 통해 개인의 기억과 사회의 시간을 동시에 남기는 방식", "한국의 구체적인 얼굴과 장소를 보편적인 기억의 이미지로 확장하는 과정"],
  "music-sound": ["말의 억양, 반복, 집단적 에너지를 새로운 리듬과 정체성으로 만드는 방식", "로컬한 청각 경험을 장르를 넘어 전달되는 감정 구조로 바꾸는 과정"],
  "art-material": ["반복 노동, 절제, 비움과 재료의 저항을 하나의 미학으로 축적하는 방식", "한국의 역사와 개인사를 국제 미술 언어 안에서 물성과 행위로 번역하는 과정"],
  "design-system": ["절제된 위계와 빠른 혼종화로 전통과 현재를 하나의 시각 규칙에 놓는 방식", "한국적 모티프를 표면 장식이 아니라 반복 가능한 디자인 원리로 바꾸는 과정"],
  "fashion-culture": ["절제된 실루엣과 서울의 거리 감각을 동시대적인 태도로 결합하는 방식", "로컬 스타일을 모방 가능한 유행이 아니라 독자적인 세계관으로 전달하는 과정"],
  "technology-interaction": ["높은 디지털 밀도와 빠른 사용 문화를 새로운 참여 규칙으로 만드는 방식", "한국의 사용 습관을 세계 이용자가 이해할 수 있는 인터랙션으로 번역하는 과정"],
  "culture-signal": ["집단성과 개인성, 속도와 정, 경쟁과 돌봄이 함께 존재하는 긴장을 창작 자원으로 쓰는 방식", "한국의 구체적인 사회 감각을 다른 문화권도 공감할 수 있는 갈등과 욕망으로 바꾸는 과정"],
};

const cinemaMeanings = {
  "moving-image": ["장면의 시간, 카메라의 위치, 전환과 사운드가 관객의 감정을 어떻게 통제하는가", "내용을 설명하기보다 관객이 시간을 체험하도록 만드는 연출 원리를 드러냅니다"],
  "brand-strategy": ["작품의 핵심 약속이 포스터·예고편·관객 기대와 실제 서사 사이에서 어떻게 유지되는가", "영화의 정체성과 관객 경험이 만나는 기획 구조를 드러냅니다"],
  "space-exhibition": ["로케이션과 미장센이 인물의 관계와 권력을 어떤 동선으로 보여주는가", "공간을 배경이 아니라 서사를 움직이는 힘으로 사용하는 방식을 드러냅니다"],
  photography: ["프레임의 거리, 렌즈, 빛과 표면이 인물을 어떤 윤리적 태도로 바라보게 하는가", "촬영 선택이 정보와 감정을 동시에 조직하는 방식을 드러냅니다"],
  "music-sound": ["대사 밖의 리듬, 침묵, 음색이 장면의 의미를 어떻게 바꾸는가", "사운드가 편집과 감정의 보이지 않는 구조로 작동하는 방식을 드러냅니다"],
  "art-material": ["배우의 몸, 소품, 질감과 반복 행위가 추상적인 주제를 어떻게 구체화하는가", "물성과 퍼포먼스가 영화의 사유를 눈앞의 사건으로 만드는 방식을 드러냅니다"],
  "design-system": ["색, 타이포그래피, 세트와 그래픽이 작품의 세계관을 얼마나 일관되게 유지하는가", "시각 규칙이 개별 쇼트를 넘어 영화 전체의 기억을 만드는 방식을 드러냅니다"],
  "fashion-culture": ["의상과 몸의 움직임이 인물의 계급, 욕망, 시대성을 어떻게 말하는가", "스타일링이 대사 없이 인물과 문화의 위치를 설명하는 방식을 드러냅니다"],
  "technology-interaction": ["기술적 제약과 도구 선택이 촬영·후반·관객 경험을 실제로 어떻게 바꾸는가", "도구의 기능보다 제작 판단과 협업 구조가 달라지는 지점을 드러냅니다"],
  "culture-signal": ["장르와 인물이 동시대 사회의 불안, 욕망, 관계 변화를 어떤 갈등으로 압축하는가", "영화가 시대의 감정을 이야기와 몸으로 기록하는 방식을 드러냅니다"],
};

const cinemaActions = {
  "moving-image": "쇼트 길이, 카메라 위치, 전환, 사운드 진입을 시간순으로 기록합니다",
  "brand-strategy": "작품의 약속, 관객의 기대, 실제 장면의 증거를 세 줄로 비교합니다",
  "space-exhibition": "인물의 진입·체류·충돌·퇴장을 공간 동선 위에 표시합니다",
  photography: "카메라 거리, 렌즈, 광원, 배경 정보량을 한 장면 단위로 분해합니다",
  "music-sound": "장면을 무음으로 본 뒤 대사·효과·음악·침묵의 역할을 다시 배치합니다",
  "art-material": "배우의 몸, 소품, 표면, 반복 행위가 주제를 구체화하는 순간을 찾습니다",
  "design-system": "색, 세트, 의상, 그래픽이 반복되는 규칙을 룩북 한 장으로 정리합니다",
  "fashion-culture": "의상 변화와 몸의 움직임이 인물의 욕망을 드러내는 지점을 표시합니다",
  "technology-interaction": "도구 선택이 촬영 속도, 협업, 후반 판단을 바꾼 지점을 제작표에 기록합니다",
  "culture-signal": "인물의 욕망, 사회적 긴장, 장르적 해결 방식이 만나는 장면을 한 문장으로 정의합니다",
};

const updateQuestions = {
  "moving-image": "이 아이디어를 설명 없이 전달하려면 쇼트의 길이, 카메라 위치, 전환, 사운드 중 무엇을 먼저 바꿔야 하는가?",
  "brand-strategy": "제품과 로고를 지워도 관객이 브랜드의 태도를 느낄 수 있는 장면은 무엇인가?",
  "space-exhibition": "관객의 진입, 체류, 시선 전환 가운데 어느 순간이 메시지를 가장 강하게 만드는가?",
  photography: "대상과 카메라의 거리, 빛, 배경 정보량 중 어떤 선택이 이미지의 태도를 결정하는가?",
  "music-sound": "음악을 제거했을 때도 장면의 리듬을 유지할 수 있는 동작과 소리는 무엇인가?",
  "art-material": "재료의 성질과 반복 행위 자체가 의미를 만드는 순간을 어떻게 촬영할 수 있는가?",
  "design-system": "이번 작업이 여러 화면과 매체에서도 유지되게 할 반복 규칙은 무엇인가?",
  "fashion-culture": "실루엣, 몸의 움직임, 공간, 음악 중 무엇을 주인공으로 두어야 하는가?",
  "technology-interaction": "새 기술이 기능을 과시하지 않고 관객의 행동을 실제로 바꾸는 지점은 어디인가?",
  "culture-signal": "이 사례에 나타난 동시대의 불편, 욕망, 새로운 행동을 어떤 장면으로 압축할 수 있는가?",
};

function updateInsightFields({ subject, evidence, topic, method }) {
  const meaning = updateMeanings[topic.id] || updateMeanings["culture-signal"];
  const principle = method?.id === "interview"
    ? "완성작보다 창작자가 무엇을 택하고 버렸는지 보세요."
    : method?.id === "process"
      ? "결과를 따라 하지 말고 제작 순서와 제약 하나를 가져오세요."
      : method?.id === "analysis"
        ? "좋고 나쁨의 결론보다 그렇게 판단한 기준을 가져오세요."
        : method?.id === "case-study"
          ? "문제에서 아이디어와 실행으로 넘어간 한 번의 결정을 찾으세요."
          : "겉모습보다 이 결과를 만든 반복 규칙 하나를 찾으세요.";
  return {
    whatIsNew: evidence && /[가-힣]/.test(evidence)
      ? compact(evidence, 145)
      : updateHighlights[topic.id] || updateHighlights["culture-signal"],
    whyItMatters: meaning,
    creativePrinciple: principle,
    applicationQuestion: updateQuestions[topic.id] || updateQuestions["culture-signal"],
  };
}

function cleanText(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTokens(value = "") {
  return cleanText(value).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function includesTerm(text, term) {
  const lowered = term.toLowerCase();
  if (/^[a-z0-9]+$/i.test(lowered)) {
    return new RegExp(`\\b${lowered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  }
  return text.includes(lowered);
}

function chooseProfiles(primaryText, contextText) {
  const scored = topicProfiles.map((profile) => ({
    profile,
    primaryScore: profile.terms.reduce((sum, term) => sum + (includesTerm(primaryText, term) ? (term.includes(" ") ? 5 : 3) : 0), 0),
    contextScore: profile.terms.reduce((sum, term) => sum + (includesTerm(contextText, term) ? 1 : 0), 0),
  }));
  scored.forEach((entry) => { entry.score = entry.primaryScore + entry.contextScore; });
  scored.sort((a, b) => b.score - a.score || b.primaryScore - a.primaryScore);
  const primaryMatches = scored.filter((entry) => entry.primaryScore > 0);
  if (!primaryMatches.length) return [topicProfiles.find((profile) => profile.id === "culture-signal")];
  const selected = scored.filter((entry) => entry.score > 0).slice(0, 2).map((entry) => entry.profile);
  return selected.length ? selected : [topicProfiles.at(-1)];
}

function chooseMethod(text) {
  return methodProfiles
    .map((profile) => ({ profile, score: profile.terms.reduce((sum, term) => sum + (includesTerm(text, term) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score)
    .find((entry) => entry.score > 0)?.profile || null;
}

function extractEvidence(item, topics) {
  const titleTokens = new Set(normalizedTokens(item.titleKo || item.title || ""));
  const topicTerms = topics.flatMap((topic) => topic.terms);
  const source = cleanText([
    item.summaryKo,
    item.summary,
    item.description,
    item.snippet,
    item.text,
  ].filter(Boolean).join(" "));
  if (!source) return "";
  const sentences = source
    .split(/(?<=[.!?。！？])\s+|\s*[\r\n]+\s*/)
    .map(cleanText)
    .filter(Boolean)
    .filter((sentence) => !lowValueSentencePatterns.some((pattern) => pattern.test(sentence)));
  if (!sentences.length) return "";
  const ranked = sentences.map((sentence, index) => {
    const lower = sentence.toLowerCase();
    const overlap = normalizedTokens(sentence).filter((token) => titleTokens.has(token)).length;
    const topicHits = topicTerms.filter((term) => includesTerm(lower, term)).length;
    const lengthScore = sentence.length >= 45 && sentence.length <= 280 ? 4 : sentence.length >= 25 ? 1 : -4;
    const lowValue = lowValueSentencePatterns.some((pattern) => pattern.test(sentence)) ? 20 : 0;
    return { sentence, score: overlap * 3 + topicHits * 2 + lengthScore - index * 0.15 - lowValue };
  }).sort((a, b) => b.score - a.score);
  const evidence = ranked[0]?.sentence || source;
  return evidence.length > 280 ? `${evidence.slice(0, 277).trim()}...` : evidence;
}

function compact(value = "", limit = 125) {
  const text = cleanText(value)
    .replace(/\s*[-–—]\s*[^-–—]{2,30}$/u, "")
    .replace(/^[‘’'"“”]+|[‘’'"“”]+$/gu, "")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 3).trim()}...` : text;
}

function inferRole(item, query, explicitRole) {
  if (explicitRole && roleLabels[explicitRole]) return explicitRole;
  if (query) return "search";
  if (item.cinemaQualityScore !== undefined || /영화가 이미지/.test(item.code || "")) return "cinema";
  if (item.koreanCodeQuality || item.mixCode) return "korean-code";
  if (item.sourceLayer === "history") return "history";
  return "updates";
}

function analysisForRole({ role, subject, evidence, topic, method, query }) {
  const evidenceText = evidence && /[가-힣]/.test(evidence) ? `“${compact(evidence, 115)}”` : "";
  const methodFocus = method?.id === "interview"
    ? "창작자의 선택 기준"
    : method?.id === "process"
      ? "제작 순서와 제약"
      : method?.id === "analysis"
        ? "비평의 판단 근거"
        : method?.id === "case-study"
          ? "문제·아이디어·실행의 인과"
          : "표면에 드러난 변화";

  if (role === "korean-code") {
    const [localCode, globalTranslation] = koreanCodeMeanings[topic.id] || koreanCodeMeanings["culture-signal"];
    if (!evidence) {
      return `‘${subject}’은 아직 한국적 코드라고 단정하기 어렵습니다. 원문에서 ${localCode}이 실제로 보이는지 먼저 확인해 보세요.`;
    }
    return evidenceText
      ? `‘${subject}’의 핵심 코드는 ${localCode}입니다. ${evidenceText}에서 출발해, 이것이 ${globalTranslation}인지 살펴보세요.`
      : `‘${subject}’의 핵심 코드는 ${localCode}입니다. 원문에서 이 코드가 ${globalTranslation}으로 이어지는 선택을 찾아보세요.`;
  }
  if (role === "cinema") {
    const [topicQuestion, topicMeaning] = cinemaMeanings[topic.id] || cinemaMeanings["moving-image"];
    const question = method?.id === "analysis"
      ? "기사의 평가가 서사, 형식, 연기, 시대 맥락 가운데 어떤 근거에 기대는가"
      : topicQuestion;
    const meaning = method?.id === "analysis"
      ? "좋고 나쁨의 결론보다 다른 작품에도 적용할 수 있는 비평 기준을 드러냅니다"
      : topicMeaning;
    if (!evidence) {
      return `‘${subject}’은 아직 장면의 근거가 부족합니다. 원문에서 ${question}를 확인한 뒤 레퍼런스로 남겨보세요.`;
    }
    return evidenceText
      ? `‘${subject}’에서 볼 지점은 ${question}입니다. ${evidenceText}에서 그 선택을 따라가면 ${meaning}.`
      : `‘${subject}’에서 볼 지점은 ${question}입니다. 원문에서 그 선택을 따라가면 ${meaning}.`;
  }
  if (role === "search") {
    const intent = compact(query || "현재 검색", 55);
    return `이 자료에서 볼 것은 ${topic.label}입니다. ${evidenceText || `‘${subject}’의 원문`}를 ${methodFocus}으로 읽으면 “${intent}”에 가져올 제작 판단이 선명해집니다.`;
  }
  if (role === "history") {
    if (!evidence) {
      return `아직 제목과 주소만 확인된 자료입니다. 원문에서 ${topic.label}의 실제 제작 판단 하나를 찾은 뒤 사용하세요.`;
    }
    return `남길 이유는 ${topic.label}의 반복 가능한 기준이 있기 때문입니다. ${evidenceText}에서 ${methodFocus} 하나를 뽑아두세요.`;
  }
  const meaning = updateMeanings[topic.id] || updateMeanings["culture-signal"];
  if (!evidence) {
    return `‘${subject}’은 아직 제목만 확인됐습니다. 원문에서 ${methodFocus}에 해당하는 변화가 보일 때 채택하세요.`;
  }
  return evidenceText
    ? `‘${subject}’의 포인트는 ${methodFocus}입니다. ${evidenceText}에서 ${meaning}.`
    : `‘${subject}’의 포인트는 ${methodFocus}입니다. ${meaning}.`;
}

function creativeUseForRole({ role, subject, topic, query }) {
  if (role === "korean-code") {
    return `한국적인 요소 하나, 누구나 공감할 갈등 하나, 해외에 통할 형식 하나를 적고 셋이 만나는 코드만 남겨보세요.`;
  }
  if (role === "cinema") {
    return `‘${subject}’에서 장면 하나만 골라 ${cinemaActions[topic.id] || cinemaActions["moving-image"]}`;
  }
  if (role === "search") {
    return `“${compact(query || "검색 주제", 45)}”에 필요한 결정 하나와 이 자료에서 빌릴 규칙 하나를 짝지어 바로 한 장면으로 시험해 보세요.`;
  }
  if (role === "history") {
    return `‘${subject}’에서 반복할 규칙 하나와 이번 작업에서 바꿀 변수 하나만 카드로 남겨보세요.`;
  }
  return `‘${subject}’의 결과를 따라 하기보다 다음 촬영이나 기획에서 바꿔 볼 선택 하나만 가져오세요.`;
}

export function deriveContentInsight(item = {}, { query = "", role: explicitRole = "" } = {}) {
  const primary = cleanText([
    item.titleKo,
    item.title,
    item.articleTitle,
    item.summaryKo,
    item.summary,
    item.description,
    String(item.text || "").slice(0, 4000),
  ].filter(Boolean).join(" ")).toLowerCase();
  const context = cleanText([
    item.focusKo,
    item.focus,
    item.field,
    item.sourceCategory,
    item.path,
    query,
  ].filter(Boolean).join(" ")).toLowerCase();
  const topics = chooseProfiles(primary, context);
  const method = chooseMethod(`${primary} ${context}`);
  const evidence = extractEvidence(item, topics);
  const role = inferRole(item, query, explicitRole);
  const localizedTitle = cleanText(item.titleKo || "");
  const titleIsFallback = /동시대 크리에이티브 변화를 보여주는 사례|영화의 형식과 제작 판단을 살펴보는 사례|한국적 창작 코드를 살펴보는 사례/i.test(localizedTitle);
  const subject = compact(
    titleIsFallback ? (item.articleTitle || item.title || localizedTitle) : (localizedTitle || item.articleTitle || item.title || "이 자료"),
    90,
  );
  const updateFields = role === "updates"
    ? updateInsightFields({ subject, evidence, topic: topics[0], method })
    : {};
  return {
    version: "role-analysis-v2",
    engine: "role-aware-rules",
    tone: "friendly-sharp-v1",
    role,
    roleLabel: roleLabels[role],
    topics: topics.map((topic) => topic.id),
    topicLabels: topics.map((topic) => topic.label),
    method: method?.id || "observation",
    analysisFocus: method?.id || "observation",
    confidence: evidence ? "evidence-backed" : "title-only",
    evidence,
    insight: analysisForRole({ role, subject, evidence, topic: topics[0], method, query }),
    creativeUse: creativeUseForRole({ role, subject, topic: topics[0], query }),
    ...updateFields,
  };
}

export function enrichWithContentInsight(item, options = {}) {
  return { ...item, contentInsight: deriveContentInsight(item, options) };
}
