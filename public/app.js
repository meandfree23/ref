const state = {
  items: [],
  latestUpdates: [],
  koreanCodeItems: [],
  cinemaItems: [],
  latestUpdateDate: null,
  latestKoreanCodeDate: null,
  latestCinemaDate: null,
  folderFilter: "all",
  kindFilter: "all",
  sourceScope: "expanded",
  query: "",
  status: null,
  abortController: null,
  searchTimer: null,
  liveRefreshing: false,
  dailyRecoveryPromise: null,
  currentView: "updates",
};

const researchVersionLabel = "ver.1";

const els = {
  query: document.querySelector("#queryInput"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#resultCount"),
  generatedAt: document.querySelector("#generatedAt"),
  networkPanel: document.querySelector("#networkPanel"),
  cardTemplate: document.querySelector("#cardTemplate"),
  chips: document.querySelectorAll(".chip"),
  viewTabs: document.querySelectorAll(".view-tab"),
  updatesPanel: document.querySelector("#updatesPanel"),
  updatesMeta: document.querySelector("#updatesMeta"),
  updatesList: document.querySelector("#updatesList"),
  koreanCodePanel: document.querySelector("#koreanCodePanel"),
  koreanCodeMeta: document.querySelector("#koreanCodeMeta"),
  koreanCodeList: document.querySelector("#koreanCodeList"),
  cinemaPanel: document.querySelector("#cinemaPanel"),
  cinemaMeta: document.querySelector("#cinemaMeta"),
  cinemaList: document.querySelector("#cinemaList"),
};

function mergeLatestUpdates(existing, incoming) {
  const seen = new Set();
  const merged = [];
  for (const item of [...incoming, ...existing]) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push(item);
  }
  return merged.sort((a, b) => {
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    return bTime - aTime;
  });
}

function formatKoreanDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "날짜 미확인";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function groupUpdates(items) {
  const groups = [];
  for (const item of items) {
    const dateLabel = formatKoreanDate(item.date || item.archivedAt);
    let group = groups.find((entry) => entry.dateLabel === dateLabel);
    if (!group) {
      group = { dateLabel, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function faviconFor(url) {
  const parsed = new URL(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`;
}

function setView(view) {
  state.currentView = view;
  document.body.classList.toggle("is-korean-code-view", view === "korean-code");
  document.body.classList.toggle("is-cinema-view", view === "cinema");
  els.viewTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
  els.updatesPanel.hidden = view !== "updates";
  els.koreanCodePanel.hidden = view !== "korean-code";
  els.cinemaPanel.hidden = view !== "cinema";
  if (view === "korean-code") loadKoreanCodeUpdates();
  if (view === "cinema") loadCinemaUpdates();
}

function renderKoreanCode() {
  renderArchivePanel({
    panel: els.koreanCodePanel,
    meta: els.koreanCodeMeta,
    list: els.koreanCodeList,
    emptyText: "Korean Code 스크랩을 찾지 못했습니다.",
    payload: {
      sourceCount: 0,
      okSourceCount: 0,
      archive: {
        enabled: false,
        itemCount: state.koreanCodeItems.length,
        dateCount: groupUpdates(state.koreanCodeItems).length,
      },
      items: state.koreanCodeItems,
    },
  });
}

function renderArchivePanel({ panel, meta, list, payload, emptyText }) {
  const archiveLabel = payload.archive?.enabled
    ? `${payload.archive.dateCount}개 날짜 · 총 ${payload.archive.itemCount}개 보관`
    : `${payload.items.length}개 스크랩`;
  meta.textContent = `${archiveLabel} · ${payload.okSourceCount}/${payload.sourceCount}개 소스`;
  list.innerHTML = "";

  if (!payload.items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    list.append(empty);
    return;
  }

  groupUpdates(payload.items).forEach((group) => {
    const section = document.createElement("section");
    section.className = "update-day";
    const heading = document.createElement("h2");
    heading.textContent = `${researchVersionLabel} · ${group.dateLabel}`;
    const items = document.createElement("div");
    items.className = "update-items";

    group.items.forEach((item, index) => {
      items.append(createArchiveItem(item, index));
    });

    section.append(heading, items);
    list.append(section);
  });
}

function createArchiveItem(item, index) {
  const article = document.createElement("article");
  article.className = "update-item";
  const displayImage = ["related", "page-preview"].includes(item.imageKind) ? "" : item.image;
  if (!displayImage) article.classList.add("has-no-image");
  if (item.originalDate) article.classList.add("is-scrap-item");
  article.style.setProperty("--delay", `${index * 45}ms`);
  if (displayImage) {
    const media = document.createElement("a");
    media.className = "update-media";
    media.href = item.url;
    media.target = "_blank";
    media.rel = "noreferrer";

    const image = document.createElement("img");
    image.alt = item.title || item.articleTitle || "";
    image.loading = "lazy";
    image.src = displayImage;
    image.addEventListener("error", () => {
      article.classList.add("has-no-image");
      media.remove();
    }, { once: true });

    media.append(image);
    if (item.imageLabel) {
      const badge = document.createElement("span");
      badge.className = "update-image-badge";
      badge.textContent = item.imageLabel;
      media.append(badge);
    }
    article.append(media);
  }

  const meta = document.createElement("div");
  meta.className = "update-meta";
  const source = document.createElement("span");
  source.className = "update-source";
  source.textContent = `${item.sourceName || item.field || "Source"} · ${item.field || item.referenceLensKo || item.focusKo || item.focus || "reference"}`;
  if (item.originalDate) {
    const originalDate = document.createElement("span");
    originalDate.className = "update-original-date";
    originalDate.textContent = `원문 ${formatKoreanDate(item.originalDate)}`;
    source.append(" · ", originalDate);
  }
  const link = document.createElement("a");
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = item.titleKo || item.articleTitle || item.title;
  const summary = document.createElement("p");
  summary.textContent = item.summaryKo || item.insight || item.summary || "요약이 제공되지 않은 업데이트입니다.";
  meta.append(source, link, summary);

  if (item.contentInsight?.insight) {
    const insightBlock = document.createElement("div");
    insightBlock.className = "content-insight";
    const insight = document.createElement("p");
    insight.className = "content-insight-point";
    insight.textContent = item.contentInsight.role === "updates" && item.contentInsight.whatIsNew
      ? `한눈에 · ${item.contentInsight.whatIsNew}`
      : `${item.contentInsight.confidence === "title-only" ? "먼저 확인" : "읽을 포인트"} · ${item.contentInsight.insight}`;
    const creativeUse = document.createElement("p");
    creativeUse.className = "content-insight-use";
    creativeUse.textContent = item.contentInsight.role === "updates" && item.contentInsight.creativePrinciple
      ? `가져올 점 · ${item.contentInsight.creativePrinciple}`
      : `내 작업에 쓰기 · ${item.contentInsight.creativeUse}`;
    insightBlock.append(insight);
    if (item.contentInsight.role === "updates" && item.contentInsight.whyItMatters) {
      const why = document.createElement("p");
      why.className = "content-insight-use";
      why.textContent = `왜 볼까 · ${item.contentInsight.whyItMatters}`;
      insightBlock.append(why);
    }
    insightBlock.append(creativeUse);
    if (item.contentInsight.role === "updates" && item.contentInsight.applicationQuestion) {
      const question = document.createElement("p");
      question.className = "content-insight-use";
      question.textContent = `바로 해보기 · ${item.contentInsight.applicationQuestion}`;
      insightBlock.append(question);
    }
    meta.append(insightBlock);
  }

  if (displayImage && item.imageSourceName && item.imageSourceUrl) {
    const imageSource = document.createElement("a");
    imageSource.className = "update-image-source";
    imageSource.href = item.imageSourceUrl;
    imageSource.target = "_blank";
    imageSource.rel = "noreferrer";
    imageSource.textContent = `${item.imageKind === "related" ? "관련 이미지" : "이미지"} · ${item.imageSourceName}`;
    meta.append(imageSource);
  }

  if (!item.originalDate && (item.code || item.mixCode || item.creativeUse)) {
    const note = document.createElement("p");
    note.className = "update-code-note";
    note.textContent = [item.code, item.mixCode, item.creativeUse].filter(Boolean).slice(0, 2).join(" / ");
    meta.append(note);
  }

  article.append(meta);
  return article;
}

function matches(item) {
  const folderOk = state.folderFilter === "all" || item.sourceFolder === state.folderFilter;
  const kindOk = state.kindFilter === "all" || item.kind === state.kindFilter;
  return folderOk && kindOk;
}

function renderNetworkPanel() {
  const meta = state.lastMeta;
  if (!meta?.network || state.status !== "done") {
    els.networkPanel.hidden = true;
    els.networkPanel.innerHTML = "";
    return;
  }

  const axes = meta.intent?.axes?.map((axis) => axis.label).slice(0, 3) || [];
  const sourceMix = meta.network.layers?.length ? meta.network.layers.slice(0, 4) : meta.network.roles.slice(0, 4);
  const uses = meta.network.uses.slice(0, 4);
  els.networkPanel.hidden = false;
  els.networkPanel.innerHTML = "";

  [
    ["검색 의도", axes.map((label) => ({ label }))],
    ["소스 구성", sourceMix.map((role) => ({ label: role.label, count: role.count }))],
    ["활용 방향", uses.map((use) => ({ label: use.label, count: use.count }))],
  ].forEach(([title, rows]) => {
    const column = document.createElement("section");
    column.className = "network-column";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const list = document.createElement("ul");
    rows.forEach((row) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = row.label;
      item.append(label);
      if (row.count) {
        const count = document.createElement("strong");
        count.textContent = row.count;
        item.append(count);
      }
      list.append(item);
    });
    column.append(heading, list);
    els.networkPanel.append(column);
  });
}

function renderResults() {
  document.body.classList.toggle("has-active-search", Boolean(state.query.trim()));
  if (state.currentView === "korean-code" && state.query.trim()) setView("updates");
  const filtered = state.items.filter(matches);
  if (state.status === "loading") {
    els.resultCount.textContent = "북마크 인덱스에서 바로 찾는 중입니다...";
  } else if (state.status === "idle") {
    els.resultCount.textContent = "검색어를 입력하면 북마크와 큐레이션 소스에서 바로 찾습니다.";
  } else if (state.status === "done") {
    const modeLabel = state.lastMeta?.mode === "visual" ? "이미지 우선" : state.lastMeta?.mode === "live" ? "원본 검토" : "빠른 검색";
    const refreshLabel = state.liveRefreshing ? " · 대표 이미지 확인 중" : "";
    els.resultCount.textContent = `${filtered.length}개 결과 · ${modeLabel} · ${state.lastMeta?.scanned || 0}/${state.lastMeta?.totalBookmarks || 0}개 소스${refreshLabel}`;
  }
  els.results.innerHTML = "";
  renderNetworkPanel();

  if (state.status === "loading") {
    els.networkPanel.hidden = true;
    const loading = document.createElement("p");
    loading.className = "empty-state";
    loading.textContent = "저장된 북마크 제목, 폴더, 소스 성격을 기준으로 관련도를 계산하고 있습니다.";
    els.results.append(loading);
    return;
  }

  if (state.status === "idle") {
    els.networkPanel.hidden = true;
    const idle = document.createElement("p");
    idle.className = "empty-state";
    idle.textContent = "예: \"네이티브 코딩 같은 인터랙션\", \"광고 캠페인 인사이트\", \"패션 필름 무드\", \"작가 포트폴리오 이미지\"";
    els.results.append(idle);
    return;
  }

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "관련 결과가 없습니다. 조금 더 일상적인 문장이나 넓은 표현으로 다시 검색해보세요.";
    els.results.append(empty);
    return;
  }

  const firstMediaId = filtered.find((item) => item.image)?.id;
  filtered.forEach((item) => {
    const node = els.cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".ref-card");
    const title = node.querySelector("h3");
    const favicon = node.querySelector(".favicon");
    const mediaPreview = node.querySelector(".media-preview");
    const mediaImage = node.querySelector(".media-preview img");
    const kind = node.querySelector(".kind");
    const path = node.querySelector(".path");
    const curation = node.querySelector(".curation");
    const snippet = node.querySelector(".snippet");
    const host = node.querySelector(".host");
    const layer = node.querySelector(".layer");
    const hostName = node.querySelector(".host-name");
    const origin = node.querySelector(".origin");
    const images = node.querySelector(".images");
    const videos = node.querySelector(".videos");

    card.dataset.id = item.id;
    if (item.image) card.classList.add("has-media");
    if (item.id === firstMediaId) card.classList.add("is-featured");
    title.textContent = item.title;
    favicon.src = faviconFor(item.url);
    if (item.image) {
      mediaPreview.href = item.image;
      mediaImage.src = item.image;
      mediaImage.alt = `${item.title} preview`;
    } else if (state.liveRefreshing) {
      mediaPreview.removeAttribute("href");
      mediaPreview.classList.add("is-loading");
      mediaImage.removeAttribute("src");
      mediaImage.alt = "";
    } else {
      mediaPreview.hidden = true;
    }
    kind.textContent = item.kind;
    path.textContent = item.path;
    curation.innerHTML = "";
    const role = document.createElement("p");
    role.className = "curation-role";
    role.textContent = item.curation?.role || "Reference Source";
    const uses = document.createElement("p");
    uses.className = "curation-use";
    uses.textContent = (item.curation?.uses || []).slice(0, 2).join(" · ");
    const reason = document.createElement("p");
    reason.className = "curation-reason";
    reason.textContent = (item.curation?.reasons || []).slice(0, 2).join(" / ");
    curation.append(role, uses, reason);
    if (item.contentInsight?.insight) {
      const insight = document.createElement("p");
      insight.className = "curation-insight";
      insight.textContent = `${item.contentInsight.confidence === "title-only" ? "먼저 확인" : "읽을 포인트"} · ${item.contentInsight.insight}`;
      const creativeUse = document.createElement("p");
      creativeUse.className = "curation-creative-use";
      creativeUse.textContent = `내 작업에 쓰기 · ${item.contentInsight.creativeUse}`;
      curation.append(insight, creativeUse);
    }
    snippet.textContent = item.snippet || item.description || "";
    layer.textContent = item.sourceLayer === "verified"
      ? "큐레이션"
      : item.sourceLayer === "history"
        ? "과거 아카이브"
        : "북마크";
    hostName.textContent = item.host;
    origin.href = item.url;
    if (item.images?.length) {
      images.href = item.images[0];
      images.textContent = `이미지 ${item.images.length}`;
    } else {
      images.hidden = true;
    }
    if (item.videos?.length) {
      videos.href = item.videos[0];
      videos.textContent = `영상 ${item.videos.length}`;
    } else {
      videos.hidden = true;
    }

    els.results.append(node);
  });
}

function renderUpdates(payload) {
  renderArchivePanel({
    panel: els.updatesPanel,
    meta: els.updatesMeta,
    list: els.updatesList,
    emptyText: "최근 업데이트를 찾지 못했습니다.",
    payload,
  });
}

function renderStaticUpdatesIfAvailable() {
  const fallback = window.__STATIC_UPDATE_ARCHIVE__;
  if (!fallback?.items?.length) return false;

  state.latestUpdates = mergeLatestUpdates(state.latestUpdates, fallback.items);
  state.latestUpdateDate = fallback.archive?.dates?.[0] || "";
  renderUpdates({
    fetchedAt: fallback.generatedAt,
    sourceCount: fallback.sourceCount || 0,
    okSourceCount: fallback.okSourceCount || fallback.sourceCount || 0,
    archive: fallback.archive,
    items: state.latestUpdates,
  });
  return true;
}

function renderStaticKoreanCodeIfAvailable() {
  const fallback = window.__STATIC_UPDATE_ARCHIVE__?.koreanCode || window.__KOREAN_CODE_RESEARCH__;
  if (!fallback?.items?.length) return false;

  state.koreanCodeItems = mergeLatestUpdates(state.koreanCodeItems, fallback.items);
  state.latestKoreanCodeDate = fallback.archive?.dates?.[0] || "";
  renderArchivePanel({
    panel: els.koreanCodePanel,
    meta: els.koreanCodeMeta,
    list: els.koreanCodeList,
    emptyText: "Korean Code 스크랩을 찾지 못했습니다.",
    payload: {
      fetchedAt: fallback.generatedAt || fallback.updatedAt,
      sourceCount: fallback.sourceCount || 0,
      okSourceCount: fallback.okSourceCount || fallback.sourceCount || 0,
      archive: fallback.archive || {
        enabled: false,
        itemCount: fallback.items.length,
        dateCount: groupUpdates(fallback.items).length,
      },
      items: state.koreanCodeItems,
    },
  });
  return true;
}

function renderStaticCinemaIfAvailable() {
  const fallback = window.__STATIC_UPDATE_ARCHIVE__?.cinema;
  if (!fallback?.items?.length) return false;

  state.cinemaItems = mergeLatestUpdates(state.cinemaItems, fallback.items);
  state.latestCinemaDate = fallback.archive?.dates?.[0] || "";
  renderArchivePanel({
    panel: els.cinemaPanel,
    meta: els.cinemaMeta,
    list: els.cinemaList,
    emptyText: "Cinema 스크랩을 찾지 못했습니다.",
    payload: {
      fetchedAt: fallback.generatedAt,
      sourceCount: fallback.sourceCount || 0,
      okSourceCount: fallback.okSourceCount || fallback.sourceCount || 0,
      archive: fallback.archive || {
        enabled: false,
        itemCount: fallback.items.length,
        dateCount: groupUpdates(fallback.items).length,
      },
      items: state.cinemaItems,
    },
  });
  return true;
}

async function loadLatestUpdates() {
  els.updatesPanel.hidden = state.currentView !== "updates";
  const renderedStaticArchive = renderStaticUpdatesIfAvailable();
  if (!renderedStaticArchive) {
    els.updatesMeta.textContent = "업데이트 확인 중...";
    els.updatesList.innerHTML = `<p class="empty-state">최신 업데이트를 불러오는 중입니다.</p>`;
  }

  try {
    const response = await fetch("/api/updates?limit=15");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.latestUpdates = mergeLatestUpdates(state.latestUpdates, payload.items || []);
    state.latestUpdateDate = payload.archive?.dates?.[0] || "";
    renderUpdates({
      ...payload,
      items: state.latestUpdates,
    });
    els.updatesPanel.hidden = state.currentView !== "updates";
  } catch (error) {
    if (renderedStaticArchive || renderStaticUpdatesIfAvailable()) return;
    els.updatesMeta.textContent = "실패";
    els.updatesList.innerHTML = `<p class="empty-state">업데이트를 불러오지 못했습니다: ${error.message}</p>`;
  }
}

async function loadKoreanCodeUpdates() {
  els.koreanCodePanel.hidden = state.currentView !== "korean-code";
  const renderedStaticArchive = renderStaticKoreanCodeIfAvailable();
  if (!renderedStaticArchive) {
    els.koreanCodeMeta.textContent = "Korean Code 확인 중...";
    els.koreanCodeList.innerHTML = `<p class="empty-state">Korean Code 스크랩을 불러오는 중입니다.</p>`;
  }

  try {
    const response = await fetch("/api/korean-code?limit=30");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.koreanCodeItems = mergeLatestUpdates(state.koreanCodeItems, payload.items || []);
    state.latestKoreanCodeDate = payload.archive?.dates?.[0] || "";
    renderArchivePanel({
      panel: els.koreanCodePanel,
      meta: els.koreanCodeMeta,
      list: els.koreanCodeList,
      emptyText: "Korean Code 스크랩을 찾지 못했습니다.",
      payload: {
        ...payload,
        items: state.koreanCodeItems,
      },
    });
    els.koreanCodePanel.hidden = state.currentView !== "korean-code";
  } catch (error) {
    if (renderedStaticArchive || renderStaticKoreanCodeIfAvailable()) return;
    els.koreanCodeMeta.textContent = "실패";
    els.koreanCodeList.innerHTML = `<p class="empty-state">Korean Code를 불러오지 못했습니다: ${error.message}</p>`;
  }
}

async function loadCinemaUpdates() {
  els.cinemaPanel.hidden = state.currentView !== "cinema";
  const renderedStaticArchive = renderStaticCinemaIfAvailable();
  if (!renderedStaticArchive) {
    els.cinemaMeta.textContent = "Cinema 확인 중...";
    els.cinemaList.innerHTML = `<p class="empty-state">Cinema 스크랩을 불러오는 중입니다.</p>`;
  }

  try {
    const response = await fetch("/api/cinema?limit=30");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.cinemaItems = mergeLatestUpdates(state.cinemaItems, payload.items || []);
    state.latestCinemaDate = payload.archive?.dates?.[0] || "";
    renderArchivePanel({
      panel: els.cinemaPanel,
      meta: els.cinemaMeta,
      list: els.cinemaList,
      emptyText: "Cinema 스크랩을 찾지 못했습니다.",
      payload: {
        ...payload,
        items: state.cinemaItems,
      },
    });
    els.cinemaPanel.hidden = state.currentView !== "cinema";
  } catch (error) {
    if (renderedStaticArchive || renderStaticCinemaIfAvailable()) return;
    els.cinemaMeta.textContent = "실패";
    els.cinemaList.innerHTML = `<p class="empty-state">Cinema를 불러오지 못했습니다: ${error.message}</p>`;
  }
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    els.generatedAt.textContent = `북마크 ${status.bookmarkCount}개 · 큐레이션 소스 ${status.verifiedCount}개`;
  } catch {
    const status = window.__STATIC_UPDATE_ARCHIVE__?.status;
    if (status) {
      els.generatedAt.textContent = `북마크 ${status.bookmarkCount}개 · 큐레이션 소스 ${status.verifiedCount}개`;
    }
  }
}

async function runLiveSearch() {
  const query = state.query.trim();
  if (state.abortController) state.abortController.abort();

  if (!query) {
    state.items = [];
    state.status = "idle";
    state.liveRefreshing = false;
    renderResults();
    return;
  }

  state.status = "loading";
  state.items = [];
  state.liveRefreshing = false;
  renderResults();

  const controller = new AbortController();
  state.abortController = controller;

  try {
    const quickUrl = `/api/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(state.sourceScope)}&mode=quick`;
    const response = await fetch(quickUrl, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.items = payload.results || [];
    state.lastMeta = payload;
    state.status = "done";
    state.liveRefreshing = true;
    renderResults();

    const liveUrl = `/api/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(state.sourceScope)}&mode=visual`;
    const liveResponse = await fetch(liveUrl, {
      signal: controller.signal,
    });
    if (!liveResponse.ok) throw new Error(`HTTP ${liveResponse.status}`);
    const livePayload = await liveResponse.json();
    if (state.query.trim() !== query) return;
    const visualResults = livePayload.results || state.items;
    state.items = [
      ...visualResults.filter((item) => item.image),
      ...visualResults.filter((item) => !item.image),
    ];
    state.lastMeta = livePayload;
    state.liveRefreshing = false;
    renderResults();
  } catch (error) {
    state.liveRefreshing = false;
    if (error.name === "AbortError") return;
    if (isFileView()) {
      state.status = "done";
      state.items = [];
      els.resultCount.textContent = "로컬 파일 보기에서는 검색 API를 사용할 수 없습니다.";
      els.results.innerHTML = `<p class="empty-state">검색은 Vercel 주소나 로컬 서버 주소에서 사용할 수 있습니다. 이 화면에서는 아래 업데이트 아카이브를 정적 백업으로 확인할 수 있습니다.</p>`;
      return;
    }
    if (state.items.length) {
      renderResults();
      return;
    }
    state.status = "done";
    state.items = [];
    els.resultCount.textContent = "검색 중 문제가 생겼습니다.";
    els.results.innerHTML = `<p class="empty-state">${error.message}</p>`;
  }
}

function scheduleSearch() {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(runLiveSearch, 650);
}

function resetResultFilters() {
  state.folderFilter = "all";
  state.kindFilter = "all";
  els.chips.forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.filter === "all");
  });
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isFileView() {
  return window.location.protocol === "file:";
}

function currentKstHour() {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date()));
}

function archiveTodayCount(payload) {
  const today = todayKey();
  return (payload?.archive?.items || payload?.items || []).filter((item) => {
    const value = item.date || item.archivedAt;
    if (!value) return false;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value)) === today;
  }).length;
}

async function ensureDailyArchive() {
  if (isFileView() || currentKstHour() < 7) return false;
  if (state.dailyRecoveryPromise) return state.dailyRecoveryPromise;

  state.dailyRecoveryPromise = (async () => {
    const responses = await Promise.all([
      fetch("/api/updates?limit=15", { cache: "no-store" }),
      fetch("/api/korean-code?limit=15", { cache: "no-store" }),
      fetch("/api/cinema?limit=15", { cache: "no-store" }),
    ]);
    if (responses.some((response) => !response.ok)) return false;

    const payloads = await Promise.all(responses.map((response) => response.json()));
    const today = todayKey();
    const needsRecovery = payloads.some((payload) => (
      payload.archive?.dates?.[0] !== today || archiveTodayCount(payload) < 15
    ));
    if (!needsRecovery) return false;

    const response = await fetch("/api/daily-update?target=15&limit=80", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const report = await response.json();
    if (!report.allTabsComplete) throw new Error("일일 아카이브가 15개를 채우지 못했습니다.");
    return true;
  })().finally(() => {
    state.dailyRecoveryPromise = null;
  });

  return state.dailyRecoveryPromise;
}

function bindInteractions() {
  els.viewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setView(tab.dataset.view || "updates");
    });
  });

  els.query.addEventListener("input", (event) => {
    const wasEmpty = !state.query.trim();
    state.query = event.target.value;
    if (wasEmpty && state.query.trim()) resetResultFilters();
    document.body.classList.toggle("has-active-search", Boolean(state.query.trim()));
    scheduleSearch();
  });

  els.chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.dataset.filter) state.folderFilter = chip.dataset.filter;
      if (chip.dataset.kind) state.kindFilter = state.kindFilter === chip.dataset.kind ? "all" : chip.dataset.kind;
      els.chips.forEach((item) => item.classList.toggle(
        "is-active",
        item.dataset.filter === state.folderFilter || item.dataset.kind === state.kindFilter,
      ));
      renderResults();
    });
  });

}

async function refreshDailyArchives() {
  await ensureDailyArchive();
  await Promise.all([
    loadLatestUpdates(),
    loadKoreanCodeUpdates(),
    loadCinemaUpdates(),
  ]);
}

function scheduleDailyUpdates() {
  setInterval(() => {
    refreshDailyArchives().catch(() => {});
  }, 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && [
      state.latestUpdateDate,
      state.latestKoreanCodeDate,
      state.latestCinemaDate,
    ].some((date) => date !== todayKey())) {
      refreshDailyArchives().catch(() => {});
    }
  });
}

async function init() {
  state.status = "idle";
  bindInteractions();
  setView("updates");
  renderResults();

  loadStatus().catch((error) => {
    els.generatedAt.textContent = error.message;
  });
  await Promise.all([
    loadLatestUpdates(),
    loadKoreanCodeUpdates(),
    loadCinemaUpdates(),
  ]);
  ensureDailyArchive().then((repaired) => {
    if (repaired) return refreshDailyArchives();
    return null;
  }).catch(() => {});
  scheduleDailyUpdates();

  const initialQuery = new URLSearchParams(window.location.search).get("q") || "";
  if (initialQuery) {
    state.query = initialQuery;
    els.query.value = initialQuery;
    runLiveSearch();
  }
}

init().catch((error) => {
  els.results.innerHTML = `<p class="empty-state">데이터를 불러오지 못했습니다: ${error.message}</p>`;
});
