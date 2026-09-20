import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const translateCache = new Map();
const pendingTranslations = [];
const requestTimeoutMs = 15000;
const maxAttempts = 5;
const maxBatchCharacters = 450;
const minimumRequestIntervalMs = 1500;
const localTranslationModel = process.env.LOCAL_TRANSLATION_MODEL || "qwen3:1.7b";
const localTranslationTimeoutMs = 30000;
const preferLocalTranslation = process.env.LOCAL_TRANSLATION_PREFERRED === "1";
let flushTimer = null;
let flushing = false;
let lastRequestStartedAt = 0;
let circuitOpenUntil = 0;
let localCircuitOpenUntil = 0;
let localServiceStartAttempted = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hasKoreanText(value = "") {
  return /[가-힣]/.test(value);
}

const translationLeakPatterns = [
  /번역을 불러오지 못해 원문을 보존합니다/i,
  /모든 마커를 정확하게 보존/i,
  /같은 위치(?:에|에서).*유지/i,
  /명칭은 정확하게 (?:유지|보존)/i,
  /단순한 번역만 제공/i,
  /preserve every marker/i,
  /return only the translation/i,
  /^[^가-힣]+에 관한 기사$/i,
];

export function isDegradedKoreanTranslation(value = "") {
  const text = String(value || "").trim();
  return !text || !hasKoreanText(text) || translationLeakPatterns.some((pattern) => pattern.test(text));
}

export function localizeResearchFocus(value = "") {
  const text = String(value || "").trim();
  if (!text || hasKoreanText(text)) return text;
  const rules = [
    [/\b(?:film|cinema|cinematography|director|auteur|filmmaking|screenwriting|documentary|video)\b/i, "영화와 영상"],
    [/\b(?:criticism|reviews?|close reading|essays?|humanities|history)\b/i, "비평과 인문학"],
    [/\b(?:interviews?|creator)\b/i, "크리에이터 인터뷰"],
    [/\b(?:production|craft|studio practice|method|process)\b/i, "제작 방식"],
    [/\b(?:design|visual|typography|identity|branding)\b/i, "디자인과 시각 언어"],
    [/\b(?:advertising|commercials?|campaign|marketing|media planning|audience|strategy)\b/i, "광고와 전략"],
    [/\b(?:art|painting|installation|museum|biennale|curatorial)\b/i, "미술과 큐레이션"],
    [/\bphotograph(?:y|er)?\b/i, "사진"],
    [/\b(?:architecture|interiors?|city|hanok|public space)\b/i, "건축과 공간"],
    [/\b(?:fashion|beauty|styling)\b/i, "패션과 스타일"],
    [/\b(?:music|sound|fandom)\b/i, "음악과 사운드"],
    [/\b(?:culture|social mood|global|local-to-global|translation)\b/i, "문화와 글로벌 맥락"],
    [/\b(?:technology|ai|digital|games?|webtoon|interaction)\b/i, "기술과 인터랙션"],
    [/\b(?:ceramics|food|textile|material|tactility|ritual|fermentation)\b/i, "재료와 감각"],
    [/\b(?:narrative|storytelling|literature|theatre|dance|body|performance)\b/i, "서사와 퍼포먼스"],
    [/\b(?:animation|motion|vfx|graphics)\b/i, "모션과 애니메이션"],
  ];
  const labels = rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return [...new Set(labels)].slice(0, 5).join(" · ") || "창작 관점과 제작 방식";
}

const localTopicRules = [
  [/brand|branding|identity|campaign|advertis|marketing/i, "브랜드와 캠페인"],
  [/film|cinema|director|cinemat|video|moving image|short film/i, "영화와 영상 언어"],
  [/design|typograph|graphic|layout|website|interactive/i, "디자인과 시각 체계"],
  [/art|artist|exhibition|installation|museum|painting/i, "미술과 전시"],
  [/architect|interior|space|urban|building/i, "건축과 공간"],
  [/photograph|camera|portrait|image/i, "사진과 이미지"],
  [/fashion|textile|garment|beauty|style/i, "패션과 스타일"],
  [/animation|motion|vfx|title sequence/i, "모션과 애니메이션"],
  [/music|sound|audio/i, "음악과 사운드"],
  [/korea|korean|seoul|hanok|k-pop/i, "한국적 문화 코드"],
];

const localMethodRules = [
  [/material|craft|handmade|texture|ceramic|weav|print/i, "재료와 수공예적 질감"],
  [/typograph|typeface|letter|font/i, "타이포그래피"],
  [/colour|color|palette|lighting/i, "색과 빛"],
  [/story|narrative|character|documentary/i, "서사와 인물"],
  [/system|modular|grid|layout|framework/i, "모듈과 시스템"],
  [/process|method|behind|making|interview|conversation/i, "제작 과정과 창작자의 판단"],
  [/audience|community|fandom|culture|social/i, "관객과 문화적 맥락"],
  [/technology|digital|ai|interactive|webgl/i, "기술과 상호작용"],
];

function labelsFor(text, rules, fallback) {
  const labels = rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return [...new Set(labels)].slice(0, 3).join(" · ") || fallback;
}

export function makeRoleAwareKoreanFallback(item = {}, { role = "updates", kind = "summary" } = {}) {
  const title = String(item.title || item.articleTitle || "").trim();
  const summary = String(item.summary || "").trim();
  const text = `${title} ${summary}`;
  const topic = labelsFor(text, localTopicRules, role === "cinema" ? "영화 창작" : "동시대 창작");
  const method = labelsFor(text, localMethodRules, "형식과 제작 방식");
  const rolePrefix = role === "korean-code"
    ? "한국적 감각을 세계의 창작 언어로 번역한 사례"
    : role === "cinema"
      ? "영화의 형식과 제작 판단을 살펴보는 사례"
      : "동시대 크리에이티브 변화를 보여주는 사례";
  if (kind === "title") return `${rolePrefix}: ${title}`;
  const evidence = summary && summary.toLowerCase() !== title.toLowerCase()
    ? ` 원문은 “${summary.slice(0, 180)}${summary.length > 180 ? "..." : ""}”를 핵심 근거로 제시합니다.`
    : " 원문 제목의 구체적 대상과 제작 맥락을 함께 확인해야 합니다.";
  return `이 글은 ${topic} 영역에서 ${method}이 결과의 인상과 의미를 어떻게 만드는지 다룹니다.${evidence}`;
}

function takeBatch() {
  const batch = [];
  let characterCount = 0;
  while (pendingTranslations.length) {
    const next = pendingTranslations[0];
    const nextSize = next.text.length + 24;
    if (batch.length && characterCount + nextSize > maxBatchCharacters) break;
    batch.push(pendingTranslations.shift());
    characterCount += nextSize;
  }
  return batch;
}

function joinBatch(batch) {
  return batch
    .map((entry, index) => `${index ? `[[[RS_SPLIT_${index}]]]\n` : ""}${entry.text}`)
    .join("\n");
}

function splitBatch(translated, expectedCount) {
  const parts = translated
    .split(/\[\[\[RS_SPLIT_\d+\]\]\]/g)
    .map((part) => part.trim());
  if (parts.length !== expectedCount) {
    throw new Error(`translation batch split mismatch: ${parts.length}/${expectedCount}`);
  }
  return parts;
}

function parseJsonResponse(stdout, provider) {
  const body = String(stdout || "").trim();
  if (!body || !/^[\[{]/.test(body)) {
    throw new Error(`${provider} returned a non-JSON response`);
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${provider} returned invalid JSON`, { cause: error });
  }
}

function makePreservedKoreanFallback(text) {
  return `번역을 불러오지 못해 원문을 보존합니다: ${text}`;
}

async function requestTranslation(text) {
  const waitMs = Math.max(0, minimumRequestIntervalMs - (Date.now() - lastRequestStartedAt));
  if (waitMs) await sleep(waitMs);
  lastRequestStartedAt = Date.now();

  const url = new URL("https://translate.google.co.kr/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", "ko");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  try {
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "--fail-with-body",
      "--max-time",
      String(Math.ceil(requestTimeoutMs / 1000)),
      url.href,
    ], {
      maxBuffer: 1024 * 1024,
    });
    const data = parseJsonResponse(stdout, "google translate");
    const translated = Array.isArray(data?.[0])
      ? data[0].map((part) => part?.[0] || "").join("").trim()
      : "";
    if (!translated) throw new Error("translation response was empty");
    return translated;
  } catch (error) {
    if (/429/.test(error?.stderr || error?.message || "")) error.status = 429;
    throw error;
  }
}

async function requestFallbackTranslation(text) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "en|ko");
  const { stdout } = await execFileAsync("curl", [
    "-sS",
    "--fail-with-body",
    "--max-time",
    String(Math.ceil(requestTimeoutMs / 1000)),
    url.href,
  ], {
    maxBuffer: 1024 * 1024,
  });
  const data = parseJsonResponse(stdout, "fallback translation");
  const translated = String(data?.responseData?.translatedText || "").trim();
  if (data?.responseStatus !== 200 || !translated) {
    throw new Error(`fallback translation failed: ${data?.responseDetails || data?.responseStatus || "empty"}`);
  }
  return translated;
}

async function generateLocalTranslation(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), localTranslationTimeoutMs);
  try {
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: localTranslationModel,
        prompt: [
          "Translate the following text into concise, natural Korean.",
          "Preserve every marker like [[[RS_SPLIT_1]]] exactly and in the same position.",
          "Keep proper names accurate. Return only the translation without notes or quotation marks.",
          "",
          text,
        ].join("\n"),
        stream: false,
        think: false,
        options: { temperature: 0 },
      }),
    });
    if (!response.ok) throw new Error(`local translation HTTP ${response.status}`);
    const data = await response.json();
    const translated = String(data?.response || "").trim();
    if (!translated) throw new Error("local translation response was empty");
    if (isDegradedKoreanTranslation(translated)) {
      throw new Error("local translation response failed quality validation");
    }
    return translated;
  } finally {
    clearTimeout(timer);
  }
}

async function requestLocalTranslation(text) {
  if (Date.now() < localCircuitOpenUntil) {
    throw new Error("local translation circuit is open");
  }
  try {
    return await generateLocalTranslation(text);
  } catch (error) {
    if (localServiceStartAttempted) {
      localCircuitOpenUntil = Date.now() + (10 * 60 * 1000);
      throw error;
    }
    localServiceStartAttempted = true;
    const service = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
    });
    service.unref();
    await sleep(1800);
    try {
      return await generateLocalTranslation(text);
    } catch (retryError) {
      localCircuitOpenUntil = Date.now() + (10 * 60 * 1000);
      throw retryError;
    }
  }
}

async function requestWithRetry(text) {
  if (preferLocalTranslation) {
    try {
      return await requestLocalTranslation(text);
    } catch {
      // Keep the remote providers as a portable fallback when Ollama is absent.
    }
  }
  if (Date.now() < circuitOpenUntil) {
    return requestLocalTranslation(text);
  }
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestTranslation(text);
    } catch (error) {
      lastError = error;
      try {
        return await requestFallbackTranslation(text);
      } catch (fallbackError) {
        lastError = fallbackError;
        try {
          return await requestLocalTranslation(text);
        } catch (localError) {
          lastError = localError;
        }
        const rateLimited = [error, fallbackError].every((failure) => /429|quota|rate.limit/i.test(
          `${failure?.status || ""} ${failure?.stderr || ""} ${failure?.message || ""}`,
        ));
        if (rateLimited) {
          circuitOpenUntil = Date.now() + (30 * 60 * 1000);
          throw lastError;
        }
      }
      if (attempt < maxAttempts) {
        const baseDelay = error?.status === 429 ? 5000 : 700;
        await sleep(baseDelay * (2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

async function flushQueue() {
  if (flushing) return;
  flushing = true;
  flushTimer = null;
  try {
    while (pendingTranslations.length) {
      const batch = takeBatch();
      try {
        const translated = await requestWithRetry(joinBatch(batch));
        const parts = splitBatch(translated, batch.length);
        for (let index = 0; index < parts.length; index += 1) {
          if (!isDegradedKoreanTranslation(parts[index])) continue;
          let repaired = "";
          try {
            repaired = await requestTranslation(batch[index].text);
          } catch {
            try {
              repaired = await requestFallbackTranslation(batch[index].text);
            } catch {
              repaired = "";
            }
          }
          if (isDegradedKoreanTranslation(repaired)) {
            throw new Error(`translation item failed quality validation: ${index}`);
          }
          parts[index] = repaired;
        }
        batch.forEach((entry, index) => {
          const translatedValue = parts[index];
          const value = translatedValue;
          translateCache.set(entry.text, value);
          entry.resolve(value);
        });
      } catch (error) {
        batch.forEach((entry) => {
          const value = makePreservedKoreanFallback(entry.text);
          translateCache.set(entry.text, value);
          entry.resolve(value);
        });
      }
    }
  } finally {
    flushing = false;
    if (pendingTranslations.length && !flushTimer) flushTimer = setTimeout(flushQueue, 25);
  }
}

export function translateToKorean(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed || hasKoreanText(trimmed)) return Promise.resolve(trimmed);
  if (translateCache.has(trimmed)) return Promise.resolve(translateCache.get(trimmed));

  const promise = new Promise((resolve, reject) => {
    pendingTranslations.push({ text: trimmed, resolve, reject });
    if (!flushing && !flushTimer) flushTimer = setTimeout(flushQueue, 25);
  });
  translateCache.set(trimmed, promise);
  return promise;
}

export function hasCompleteKoreanLocalization(item = {}) {
  const required = [item.titleKo, item.summaryKo];
  if (item.focus) required.push(item.focusKo);
  return required.every((value) => !isDegradedKoreanTranslation(value || ""));
}
