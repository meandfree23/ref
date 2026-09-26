/* Reference Selector v2 front end. Static JSON + two small API calls. */
const CATEGORIES = ["영상·연출", "광고·브랜드", "디자인·타이포", "사진·이미지", "공간·전시", "미술·물성", "패션·뷰티", "기술·AI", "영화·비평", "문화·신호"];
const TAB_VIEWS = ["updates", "korean-code", "cinema"];
const LS_KEY = "refsel.taste.v1";
const DATA_VERSION = Date.now().toString(36).slice(0, 6);

const state = {
  view: "today",
  category: "all",
  axis: "",
  signal: "",
  date: "all",
  showAll: false,
  query: "",
  meta: null,
  today: null,
  signals: null,
  curator: null,
  tabs: {},        // view -> { recent:{dates,items}, all:{dates,items}|null, loadingAll:Promise|null }
  brief: { query: "", results: [], mode: "", board: null, loading: false, composing: false, layers: { archive: true, history: true } },
  taste: loadTaste(),
  briefPending: null,
  density: storeGet("refsel.density", "scan"),   // "scan" (훑어보기) | "detail" (자세히)
  visit: null,        // { prev: ISO|null, prevDay: "YYYY-MM-DD"|null }
  read: storeGet("refsel.read.v1", {}),
  scrollByView: {},
  briefOrigin: null,  // { view, scroll, label } for the back button
};

const els = {
  panel: document.querySelector("#panel"),
  tabs: document.querySelectorAll(".view-tab"),
  filterBar: document.querySelector("#filterBar"),
  chips: document.querySelector("#categoryChips"),
  localFilter: document.querySelector("#localFilter"),
  dateSelect: document.querySelector("#dateSelect"),
  toggleAll: document.querySelector("#toggleAll"),
  briefForm: document.querySelector("#briefForm"),
  briefInput: document.querySelector("#briefInput"),
  footMeta: document.querySelector("#footMeta"),
  mastheadNote: document.querySelector("#mastheadNote"),
};

/* ---------- utilities ---------- */
const fmtDay = (key) => {
  if (!key) return "";
  const [y, m, d] = key.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
};
const fmtDate = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" }).format(date);
};
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
};
async function getJson(path) {
  const response = await fetch(`${path}${path.includes("?") ? "&" : "?"}v=${DATA_VERSION}`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

/* ---------- taste (localStorage) ---------- */
function storeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: keep working in memory */ }
}
const kstDay = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(iso));

/* ---------- visit memory: what is new since the last visit ---------- */
function initVisit() {
  const record = storeGet("refsel.visit.v1", {});
  const now = Date.now();
  // A reload within 30 minutes keeps the same baseline, so "새" badges do not vanish mid-session.
  const sessionFresh = record.last && now - new Date(record.last).getTime() < 30 * 60000;
  const prev = sessionFresh ? (record.prev || null) : (record.last || null);
  storeSet("refsel.visit.v1", { prev, last: new Date(now).toISOString() });
  state.visit = { prev, prevDay: prev ? kstDay(prev) : null };
}
function isNew(item) {
  // Day-level on purpose: backfilled items carry end-of-day timestamps, and the tab
  // badges count by day, so both must agree.
  if (!state.visit?.prevDay) return false;
  return item.day > state.visit.prevDay;
}
function newCountForTab(tab) {
  const counts = state.meta?.tabs?.[tab]?.dayCounts || {};
  if (!state.visit?.prevDay) return 0;
  return Object.entries(counts).filter(([day]) => day > state.visit.prevDay).reduce((sum, [, n]) => sum + n, 0);
}

/* ---------- read state ---------- */
function markRead(item) {
  if (!item?.id || state.read[item.id]) return;
  state.read[item.id] = Date.now();
  const ids = Object.keys(state.read);
  if (ids.length > 4000) ids.sort((a, b) => state.read[a] - state.read[b]).slice(0, ids.length - 4000).forEach((id) => delete state.read[id]);
  storeSet("refsel.read.v1", state.read);
  document.querySelectorAll(`[data-id="${CSS.escape(item.id)}"]`).forEach((node) => node.classList.add("is-read"));
}

function loadTaste() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    return { saved: {}, hidden: {}, views: {}, ...parsed };
  } catch {
    return { saved: {}, hidden: {}, views: {} };
  }
}
function persistTaste() {
  storeSet(LS_KEY, state.taste);
}
function toggleSaved(item) {
  const key = item.id || item.u;
  if (state.taste.saved[key]) delete state.taste.saved[key];
  else state.taste.saved[key] = { ...item, savedAt: new Date().toISOString() };
  persistTaste();
}
function toggleHidden(item) {
  const key = item.id || item.u;
  if (state.taste.hidden[key]) delete state.taste.hidden[key];
  else state.taste.hidden[key] = { cat: item.cat, s: item.s, at: new Date().toISOString() };
  persistTaste();
}
function tasteAffinity() {
  const cat = {};
  const src = {};
  const ax = {};
  for (const item of Object.values(state.taste.saved)) {
    if (item.cat) cat[item.cat] = (cat[item.cat] || 0) + 1;
    if (item.s) src[item.s] = (src[item.s] || 0) + 1;
    for (const axis of item.ax || []) ax[axis] = (ax[axis] || 0) + 1;
  }
  for (const item of Object.values(state.taste.hidden)) {
    if (item.cat) cat[item.cat] = (cat[item.cat] || 0) - 1;
    if (item.s) src[item.s] = (src[item.s] || 0) - 1;
  }
  return { cat, src, ax };
}
function tasteBoost(item, affinity) {
  return Math.max(-1.5, Math.min(1.5, 0.25 * ((affinity.cat[item.cat] || 0) + (affinity.src[item.s] || 0) * 0.6 + (item.ax || []).reduce((sum, axis) => sum + (affinity.ax[axis] || 0) * 0.3, 0))));
}

/* ---------- rendering: reference card ---------- */
function media(item, className = "ref-media") {
  if (!item.img) return el("div", { class: `${className} is-empty` }, "NO IMAGE");
  const img = el("img", { src: item.img, alt: item.t || "", loading: "lazy" });
  img.addEventListener("error", () => { img.replaceWith(el("div", { class: `${className} is-empty` }, "IMAGE OFF")); }, { once: true });
  return el("a", { class: className, href: item.u, target: "_blank", rel: "noreferrer", onclick: () => markRead(item) }, img);
}
function titleLink(item) {
  return el("a", { href: item.u, target: "_blank", rel: "noreferrer", onclick: () => markRead(item) }, item.t);
}
function badges(item, { withAxes = true } = {}) {
  const list = [];
  if (isNew(item)) list.push(el("span", { class: "badge badge-new" }, "새로"));
  if (item.id && state.read[item.id]) list.push(el("span", { class: "badge badge-read" }, "읽음"));
  if (item.sh) list.push(el("span", { class: `badge badge-sharp${item.sh >= 8 ? " is-top" : ""}`, title: item.why || "" }, `날카로움 ${item.sh}`));
  if (item.tl) list.push(el("span", { class: "badge badge-tl" }, "오래 남을 것"));
  if (item.old) list.push(el("span", { class: "badge badge-old" }, `아카이브 발굴 · 원문 ${fmtDate(item.od)}`));
  if (item.g === "summary") list.push(el("span", { class: "badge", title: "원문 본문 없이 요약만으로 판독" }, "요약 판독"));
  if (withAxes) for (const axis of item.ax || []) list.push(el("button", { class: "badge badge-axis", type: "button", onclick: () => setFilter({ axis }) }, axis));
  return el("div", { class: "badges" }, list);
}
function actions(item) {
  const key = item.id || item.u;
  const saved = Boolean(state.taste.saved[key]);
  const hidden = Boolean(state.taste.hidden[key]);
  const saveBtn = el("button", { class: `act${saved ? " is-on" : ""}`, type: "button", onclick: (event) => { toggleSaved(item); event.currentTarget.classList.toggle("is-on"); event.currentTarget.textContent = state.taste.saved[key] ? "보드에 있음" : "보드에 담기"; } }, saved ? "보드에 있음" : "보드에 담기");
  const hideBtn = el("button", { class: `act act-quiet${hidden ? " is-on" : ""}`, type: "button", onclick: (event) => { toggleHidden(item); event.currentTarget.textContent = state.taste.hidden[key] ? "관심 없음 취소" : "관심 없음"; } }, hidden ? "관심 없음 취소" : "관심 없음");
  const link = el("a", { class: "act act-quiet", href: item.u, target: "_blank", rel: "noreferrer", onclick: () => markRead(item) }, "원문 ↗");
  const similar = el("button", { class: "act", type: "button", title: "아카이브 전체에서 비슷한 레퍼런스를 찾습니다", onclick: () => findSimilar(item) }, "비슷한 것 찾기");
  const sigs = (item.sig || []).length ? el("div", { class: "signals-inline" }, (item.sig || []).map((signal) => el("button", { class: "sig", type: "button", title: "이 흐름으로 아카이브 전체를 검색", onclick: () => openBrief(signal, { label: `신호 '${signal}'` }) }, `# ${signal}`))) : null;
  return el("div", { class: "ref-actions" }, saveBtn, similar, hideBtn, link, sigs);
}
function reading(item) {
  if (!item.sh) return null;
  const rows = [];
  if (item.nov) rows.push(["새로움", item.nov]);
  if (item.mech) rows.push(["작동 원리", item.mech]);
  if (item.ev) rows.push(["근거", item.ev, "evidence"]);
  if (item.stl) rows.push(["가져갈 한 수", item.stl, "steal"]);
  if (item.lim) rows.push(["한계", item.lim, "limit"]);
  return el("dl", { class: "reading" }, rows.map(([label, text, cls]) => el("div", {}, el("dt", {}, label), el("dd", { class: cls || "" }, text))));
}
function scanCard(item) {
  const muted = item.sh && !item.k;
  const card = el("article", { class: `ref ref-scan${muted ? " is-muted" : ""}${item.id && state.read[item.id] ? " is-read" : ""}`, dataset: { id: item.id || "" } });
  const detail = el("div", { class: "scan-detail", hidden: true },
    item.ot && item.ot !== item.t ? el("p", { class: "ref-orig" }, item.ot) : null,
    item.sum ? el("p", { class: "ref-sum" }, item.sum) : null,
    muted && item.why ? el("p", { class: "status-line" }, `접힌 이유 · ${item.why}`) : null,
    reading(item),
    actions(item),
  );
  const toggle = el("button", { class: "act scan-toggle", type: "button", "aria-expanded": "false", onclick: (event) => {
    const open = detail.hidden;
    detail.hidden = !open;
    event.currentTarget.setAttribute("aria-expanded", String(open));
    event.currentTarget.textContent = open ? "접기 ▴" : (item.sh ? "판독 펼치기 ▾" : "요약 펼치기 ▾");
    if (open) markRead(item);
  } }, item.sh ? "판독 펼치기 ▾" : "요약 펼치기 ▾");
  const thumb = item.img ? media(item, "ref-thumb") : null;
  card.append(
    thumb || el("div", { class: "ref-thumb is-blank" }),
    el("div", { class: "ref-body" },
      el("p", { class: "ref-kicker" }, el("b", {}, item.s || "출처 미상"), ` · ${item.cat || ""}`, item.od ? ` · 원문 ${fmtDate(item.od)}` : ""),
      el("h3", { class: "ref-title" }, titleLink(item)),
      badges(item, { withAxes: false }),
      item.k && item.stl ? el("p", { class: "pick-steal" }, item.stl) : (!item.sh && item.sum ? el("p", { class: "ref-sum ref-sum-clamp" }, item.sum) : null),
      el("div", { class: "scan-row" }, toggle, el("button", { class: `act${state.taste.saved[item.id] ? " is-on" : ""}`, type: "button", onclick: (event) => { toggleSaved(item); event.currentTarget.classList.toggle("is-on"); } }, "보드에 담기"), el("button", { class: "act act-quiet", type: "button", onclick: () => findSimilar(item) }, "비슷한 것")),
      detail,
    ),
  );
  return card;
}
function referenceCard(item, { compact = false } = {}) {
  if (!compact && state.density === "scan") return scanCard(item);
  const muted = item.sh && !item.k;
  const card = el("article", { class: `ref${compact ? " is-compact" : ""}${muted ? " is-muted" : ""}${item.id && state.read[item.id] ? " is-read" : ""}`, dataset: { id: item.id || "" } });
  const side = el("div", { class: "ref-side" }, media(item), el("p", { class: "ref-kicker" }, el("b", {}, item.s || "출처 미상"), ` · ${item.cat || ""}`, item.od ? el("span", {}, ` · 원문 ${fmtDate(item.od)}`) : null));
  const title = el("h3", { class: "ref-title" }, titleLink(item));
  const body = el("div", { class: "ref-body" },
    title,
    item.ot && item.ot !== item.t ? el("p", { class: "ref-orig" }, item.ot) : null,
    badges(item),
    item.sum ? el("p", { class: "ref-sum" }, item.sum) : null,
    muted && item.why ? el("p", { class: "status-line" }, `접힌 이유 · ${item.why}`) : null,
    reading(item),
    actions(item),
  );
  if (compact) {
    card.append(el("div", { class: "ref-body" }, title, el("p", { class: "status-line" }, `${item.s || ""}${item.why ? ` · ${item.why}` : ""}`), badges(item, { withAxes: false })));
    card.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      card.replaceWith(state.density === "scan" ? scanCard(item) : referenceCard(item));
    });
    return card;
  }
  card.append(side, body);
  return card;
}

/* ---------- filters ---------- */
function setFilter(patch) {
  Object.assign(state, patch);
  if (patch.axis || patch.signal) {
    state.showAll = true;
    if (!TAB_VIEWS.includes(state.view)) state.view = "updates";
  }
  render();
}
function itemMatches(item) {
  if (state.category !== "all" && item.cat !== state.category) return false;
  if (state.axis && !(item.ax || []).includes(state.axis)) return false;
  if (state.signal && !(item.sig || []).includes(state.signal)) return false;
  if (state.date !== "all" && item.day !== state.date) return false;
  if (state.query) {
    const hay = `${item.t} ${item.ot || ""} ${item.sum || ""} ${item.s || ""} ${item.stl || ""} ${(item.sig || []).join(" ")}`.toLowerCase();
    if (!state.query.toLowerCase().split(/\s+/).every((token) => hay.includes(token))) return false;
  }
  return true;
}
function renderFilterBar(items, dates) {
  els.filterBar.hidden = !TAB_VIEWS.includes(state.view);
  if (els.filterBar.hidden) return;
  const counts = {};
  for (const item of items) counts[item.cat] = (counts[item.cat] || 0) + 1;
  els.chips.innerHTML = "";
  const chip = (label, value, count) => el("button", { class: `chip${state.category === value ? " is-active" : ""}`, type: "button", onclick: () => setFilter({ category: value }) }, label, count != null ? el("small", {}, count) : null);
  els.chips.append(chip("전체", "all", items.length));
  for (const category of CATEGORIES) if (counts[category]) els.chips.append(chip(category, category, counts[category]));
  if (state.axis) els.chips.append(el("button", { class: "chip is-active", type: "button", onclick: () => setFilter({ axis: "" }) }, `축: ${state.axis} ×`));
  if (state.signal) els.chips.append(el("button", { class: "chip is-active", type: "button", onclick: () => setFilter({ signal: "" }) }, `신호: ${state.signal} ×`));
  els.dateSelect.innerHTML = "";
  els.dateSelect.append(el("option", { value: "all" }, "모든 날짜"));
  for (const day of dates) els.dateSelect.append(el("option", { value: day, selected: state.date === day }, fmtDay(day)));
  els.toggleAll.setAttribute("aria-pressed", String(state.showAll));
  els.toggleAll.textContent = state.showAll ? "접힌 항목 숨기기" : "접힌 항목 보기";
  els.localFilter.value = state.query;
}

/* ---------- views ---------- */
function sectionHead(title, count, extra) {
  return el("div", { class: "section-head" }, el("h2", {}, title), count != null ? el("span", { class: "count" }, count) : null, el("span", { class: "spacer" }), extra || null);
}

async function ensureTab(view) {
  state.tabs[view] ||= { recent: null, all: null, loadingAll: null };
  const entry = state.tabs[view];
  if (!entry.recent) entry.recent = await getJson(`./data/${view}-recent.json`);
  return entry;
}
async function ensureTabAll(view) {
  const entry = await ensureTab(view);
  if (entry.all) return entry;
  entry.loadingAll ||= getJson(`./data/${view}-all.json`).then((all) => { entry.all = all; entry.loadingAll = null; return entry; });
  return entry.loadingAll;
}

async function renderTab(view) {
  const entry = await ensureTab(view);
  const needAll = state.date !== "all" && !entry.recent.dates.includes(state.date) || state.query || state.axis || state.signal || state.category !== "all";
  const data = needAll ? (await ensureTabAll(view)).all : (entry.all || entry.recent);
  const dates = (entry.all || entry.recent).dates;
  renderFilterBar(data.items, dates);
  const filtered = data.items.filter(itemMatches);
  const hidden = state.taste.hidden;
  const groups = new Map();
  for (const item of filtered) {
    if (!groups.has(item.day)) groups.set(item.day, []);
    groups.get(item.day).push(item);
  }
  const frag = document.createDocumentFragment();
  const tabMeta = state.meta?.tabs?.[view];
  frag.append(sectionHead(tabMeta?.label || view, `${tabMeta?.dateCount || dates.length}개 날짜 · ${tabMeta?.itemCount || data.items.length}개 · 판독 ${tabMeta?.readCount || 0} · 핵심 ${tabMeta?.keepCount || 0}`,
    el("div", { class: "brief-controls" },
      densityToggle(),
      !entry.all && !needAll ? el("button", { class: "btn btn-small", type: "button", onclick: async () => { await ensureTabAll(view); render(); } }, "전체 아카이브 열기") : null)));
  const freshCount = filtered.filter(isNew).length;
  if (freshCount) frag.append(el("p", { class: "new-note" }, `지난 방문(${fmtDate(state.visit.prev)}) 이후 새로 들어온 항목 ${freshCount}개 · '새로' 표시`));
  if (!filtered.length) frag.append(el("p", { class: "empty-state" }, "조건에 맞는 항목이 없습니다."));
  let rendered = 0;
  for (const [day, items] of groups) {
    if (rendered > 220) { frag.append(el("p", { class: "collapsed-note" }, "더 오래된 날짜는 날짜 선택으로 열어보세요.")); break; }
    const byNewest = (a, b) => (new Date(b.od || 0) - new Date(a.od || 0)) || ((b.sh || 0) - (a.sh || 0));
    const kept = items.filter((item) => (item.k || !item.sh) && !hidden[item.id]).sort(byNewest);
    const folded = items.filter((item) => (item.sh && !item.k) || hidden[item.id]).sort(byNewest);
    const dayNew = items.filter(isNew).length;
    const daySection = el("section", { class: "update-day" }, sectionHead(fmtDay(day), `핵심 ${kept.length} · 접힘 ${folded.length}${dayNew ? ` · 새로 ${dayNew}` : ""}`));
    for (const item of kept) daySection.append(referenceCard(item));
    if (folded.length) {
      if (state.showAll) for (const item of folded) daySection.append(referenceCard(item, { compact: true }));
      else daySection.append(el("p", { class: "collapsed-note" }, `날카롭지 않아 접어 둔 ${folded.length}개 · `, el("button", { type: "button", onclick: () => setFilter({ showAll: true }) }, "펼치기")));
    }
    frag.append(daySection);
    rendered += items.length;
  }
  return frag;
}

function renderToday() {
  const today = state.today;
  const frag = document.createDocumentFragment();
  if (!today?.items?.length) {
    frag.append(sectionHead("오늘의 픽"), el("p", { class: "empty-state" }, "아직 판독된 항목이 없습니다. 다음 07:10 자동 판독을 기다려 주세요."));
    return frag;
  }
  const affinity = tasteAffinity();
  const items = today.items
    .filter((item) => !state.taste.hidden[item.id])
    .map((item) => ({ item, score: item.sh + tasteBoost(item, affinity) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
  frag.append(sectionHead("오늘의 픽", `${today.days.map(fmtDay).join(" · ")} 판독분에서 날카로운 순`));
  const tabNew = TAB_VIEWS.map((tab) => [tab, newCountForTab(tab)]);
  if (state.visit?.prev) {
    const unread = items.filter((item) => !state.read[item.id]).length;
    frag.append(el("div", { class: "return-bar" },
      el("span", {}, `지난 방문 ${fmtDate(state.visit.prev)} · 아래 픽 중 안 읽은 것 ${unread}개`),
      ...tabNew.map(([tab, count]) => el("button", { class: `chip${count ? " chip-new" : ""}`, type: "button", onclick: () => switchView(tab) }, `${state.meta?.tabs?.[tab]?.label || tab}`, el("small", {}, count ? `새 ${count}` : "새 항목 없음"))),
    ));
  } else {
    frag.append(el("p", { class: "intro" }, "세 탭 전체에서 원문을 읽고 점수를 매긴 뒤, 보드에 담은 취향을 반영해 정렬합니다. 카드의 빨간 줄이 오늘 현장에서 써 볼 한 수입니다."));
  }
  frag.append(el("div", { class: "pick-grid" }, items.map((item) => el("article", { class: `pick${state.read[item.id] ? " is-read" : ""}`, dataset: { id: item.id } },
    media(item),
    el("div", { class: "pick-body" },
      el("p", { class: "ref-kicker" }, el("b", {}, item.s), ` · ${item.cat}`, ` · ${state.meta?.tabs?.[item.tab]?.label || item.tab}`),
      el("h3", { class: "ref-title" }, titleLink(item)),
      badges(item, { withAxes: false }),
      item.nov ? el("p", { class: "ref-sum" }, item.nov) : null,
      item.stl ? el("p", { class: "pick-steal" }, item.stl) : null,
      el("div", { class: "pick-foot" }, actions(item)),
    )))));
  if (state.signals?.hypotheses?.length) {
    frag.append(sectionHead("지금 굳어지는 흐름", `${state.signals.hypotheses.length}개 가설`, el("button", { class: "btn btn-small", type: "button", onclick: () => switchView("signals") }, "시그널 탭으로")));
    frag.append(el("ul", { class: "quiet-list" }, state.signals.hypotheses.slice(0, 3).map((hyp) => el("li", {}, el("b", {}, hyp.title), " ", el("span", {}, `${hyp.momentum} · 근거 ${hyp.evidence.length}건`)))));
  }
  frag.append(sectionHead("이어 읽기"));
  frag.append(el("div", { class: "continue-row" }, TAB_VIEWS.map((tab) => {
    const info = state.meta?.tabs?.[tab];
    const count = newCountForTab(tab);
    return el("button", { class: "continue-card", type: "button", onclick: () => switchView(tab) },
      el("b", {}, info?.label || tab),
      el("span", {}, `최신 ${fmtDay(info?.latest)} · 핵심 ${info?.keepCount || 0}개`),
      count ? el("em", {}, `지난 방문 이후 새 ${count}`) : null);
  })));
  return frag;
}

function renderSignals() {
  const frag = document.createDocumentFragment();
  const signals = state.signals;
  if (!signals?.hypotheses?.length) {
    frag.append(sectionHead("시그널"), el("p", { class: "empty-state" }, "가설을 세울 만큼 판독이 쌓이지 않았습니다. 자동 판독이 며칠 돌면 채워집니다."));
    return frag;
  }
  frag.append(sectionHead("시그널", `${signals.since} 이후 ${signals.readingCount}개 판독 · ${fmtDate(signals.generatedAt)} 생성`));
  frag.append(el("p", { class: "intro" }, "한 기사가 아니라 여러 자료에 걸쳐 반복되는 움직임을 가설로 세웁니다. 서로 다른 출처 2곳 이상, 자료 3개 이상이 근거로 붙은 것만 남깁니다."));
  for (const hyp of signals.hypotheses) {
    frag.append(el("section", { class: "hyp" },
      el("div", { class: "hyp-head" }, el("h3", {}, hyp.title), el("span", { class: "hyp-momentum" }, hyp.momentum), el("span", { class: "hyp-meta" }, `${fmtDay(hyp.firstSeen)} ~ ${fmtDay(hyp.lastSeen)} · 출처 ${hyp.sourceCount}곳 · 근거 ${hyp.evidence.length}건`)),
      el("p", {}, hyp.thesis),
      el("span", { class: "label" }, "지금 할 수 있는 선택"), el("p", { class: "implication" }, hyp.implication),
      el("span", { class: "label" }, "반론"), el("p", {}, hyp.counter),
      el("span", { class: "label" }, "다음 2주 관찰 포인트"), el("p", {}, hyp.watch),
      el("div", { class: "evidence-row" }, hyp.evidence.map((ev) => el("a", { class: "ev", href: ev.u, target: "_blank", rel: "noreferrer" }, media(ev), el("div", { class: "ev-body" }, el("b", {}, ev.t), el("span", {}, `${ev.s} · ${fmtDay(ev.day)}`))))),
    ));
  }
  if (signals.clusters?.length) {
    frag.append(sectionHead("반복되는 소재", "클릭하면 해당 자료로"));
    frag.append(el("div", { class: "cluster-strip" }, signals.clusters.map((cluster) => el("button", { class: "cluster", type: "button", onclick: (event) => {
      const open = event.currentTarget.nextElementSibling;
      document.querySelectorAll(".cluster").forEach((node) => node.classList.remove("is-active"));
      event.currentTarget.classList.add("is-active");
      const grid = document.querySelector("#clusterGrid");
      grid.innerHTML = "";
      grid.append(...cluster.evidence.map((ev) => el("a", { class: "ev", href: ev.u, target: "_blank", rel: "noreferrer" }, media(ev), el("div", { class: "ev-body" }, el("b", {}, ev.t), el("span", {}, `${ev.s} · ${fmtDay(ev.day)}`)))));
      void open;
    } }, cluster.label, el("b", {}, cluster.ids.length)))));
    frag.append(el("div", { class: "evidence-row", id: "clusterGrid" }));
  }
  if (signals.history?.length > 1) {
    frag.append(sectionHead("가설 이력"));
    frag.append(el("ul", { class: "quiet-list" }, signals.history.slice(0, 10).map((entry) => el("li", {}, el("span", {}, `${fmtDay(entry.date)} · `), entry.titles.join(" / ")))));
  }
  return frag;
}

/* ---------- brief search ---------- */
function openBrief(query, { label = "" } = {}) {
  if (state.view !== "brief") state.briefOrigin = { view: state.view, scroll: window.scrollY, label };
  else if (state.briefOrigin) state.briefOrigin.label = label;
  els.briefInput.value = query;
  pushView("brief", { q: query });
  runBrief(query);
}
function findSimilar(item) {
  markRead(item);
  const query = [item.t, item.stl || item.nov || item.sum || ""].join(". ").slice(0, 300);
  state.brief.excludeUrl = item.u;
  openBrief(query, { label: `'${item.t.slice(0, 40)}'와 비슷한 레퍼런스` });
}
async function runBrief(query) {
  state.brief = { ...state.brief, query, results: [], board: null, loading: true, error: "" };
  state.view = "brief";
  render();
  try {
    const layers = Object.entries(state.brief.layers).filter(([, on]) => on).map(([name]) => name).join(",");
    const payload = await getJson(`/api/brief?q=${encodeURIComponent(query)}&layers=${layers}&n=36`);
    const exclude = state.brief.excludeUrl;
    state.brief.results = (payload.results || []).filter((result) => !exclude || result.u !== exclude);
    state.brief.mode = payload.mode;
    state.brief.took = payload.took;
  } catch (error) {
    state.brief.error = error.message;
  }
  state.brief.loading = false;
  render();
}
async function composeBrief() {
  const { query, results } = state.brief;
  if (!results.length) return;
  state.brief.composing = true;
  render();
  try {
    const response = await fetch("/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: query, results: results.slice(0, 30).map((item) => ({ id: item.id, t: item.t, s: item.s, st: item.st, c: item.c, ax: item.ax, sn: item.sn })) }) });
    const payload = await response.json();
    state.brief.board = payload.ok ? payload : { error: payload.error || "해설 실패" };
  } catch (error) {
    state.brief.board = { error: error.message };
  }
  state.brief.composing = false;
  render();
}
function resultCard(item) {
  const layer = { archive: "아카이브", history: "북마크 히스토리", bookmark: "북마크" }[item.l] || item.l;
  const saveItem = { id: item.id, t: item.t, u: item.u, s: item.s, img: item.img, cat: item.c, ax: item.ax, stl: item.st, sh: item.sh };
  const key = item.id;
  return el("div", { class: "mini" },
    item.img ? media(item) : null,
    el("span", { class: "m" }, el("span", { class: "layer-tag" }, layer), ` ${item.s || ""}${item.c ? ` · ${item.c}` : ""}${item.f ? ` · ${item.f}` : ""}${item.d ? ` · ${fmtDate(item.d)}` : ""}`),
    el("a", { href: item.u, target: "_blank", rel: "noreferrer" }, item.t),
    item.st ? el("span", { class: "pick-steal" }, item.st) : item.sn ? el("span", { class: "m" }, item.sn) : null,
    el("div", { class: "ref-actions" },
      item.sh ? el("span", { class: `badge badge-sharp${item.sh >= 8 ? " is-top" : ""}` }, item.sh) : null,
      el("button", { class: `act${state.taste.saved[key] ? " is-on" : ""}`, type: "button", onclick: (event) => { toggleSaved(saveItem); event.currentTarget.classList.toggle("is-on"); } }, "보드에 담기"),
    ),
  );
}
function renderBrief() {
  const frag = document.createDocumentFragment();
  const brief = state.brief;
  const origin = state.briefOrigin;
  frag.append(sectionHead(origin?.label || "브리프 검색", origin?.label ? null : (brief.query ? `"${brief.query}"` : null),
    origin ? el("button", { class: "btn btn-small", type: "button", onclick: () => goBackFromBrief() }, `← ${viewLabel(origin.view)}로 돌아가기`) : null));
  frag.append(el("p", { class: "intro" }, "상단 검색창에 브리프를 문장으로 넣으세요. 아카이브 판독과 북마크 히스토리를 의미로 비교해 찾고, 원하면 연출 축별 보드로 묶어 줍니다."));
  frag.append(el("div", { class: "brief-controls" },
    ...Object.entries({ archive: "아카이브", history: "북마크·히스토리" }).map(([name, label]) => el("label", {}, el("input", { type: "checkbox", checked: brief.layers[name], onchange: (event) => { brief.layers[name] = event.target.checked; if (brief.query) runBrief(brief.query); } }), label)),
    brief.results.length ? el("button", { class: "btn btn-small btn-ink", type: "button", disabled: brief.composing, onclick: composeBrief }, brief.composing ? "묶는 중 (20~40초)" : "AI로 연출 축 보드 만들기") : null,
    brief.mode ? el("span", { class: "status-line" }, `${brief.mode === "semantic" ? "의미 검색" : "키워드 검색"} · ${brief.results.length}개 · ${brief.took}ms`) : null,
  ));
  if (brief.loading) frag.append(el("div", { class: "loading-row" }, "브리프를 임베딩해서 비교하는 중"));
  if (brief.error) frag.append(el("p", { class: "empty-state" }, `검색 실패: ${brief.error}`));
  if (brief.board) {
    if (brief.board.error) frag.append(el("p", { class: "status-line" }, brief.board.error));
    else {
      const byId = new Map(brief.results.map((item) => [item.id, item]));
      frag.append(el("div", { class: "board" }, el("p", { class: "board-read" }, brief.board.read), el("p", {}, `빠진 관점 · ${brief.board.gaps}`), el("div", { class: "next-q" }, (brief.board.next || []).map((q) => el("button", { class: "chip", type: "button", onclick: () => { els.briefInput.value = q; runBrief(q); } }, q)))));
      for (const board of brief.board.boards) {
        frag.append(el("div", { class: "board" }, el("span", { class: "axis" }, board.axis), el("h3", {}, board.title), el("p", {}, board.why), el("div", { class: "mini-grid" }, board.ids.map((id) => byId.get(id)).filter(Boolean).map(resultCard))));
      }
    }
  }
  if (brief.results.length) frag.append(el("div", { class: "result-list" }, brief.results.map(resultCard)));
  else if (!brief.loading && brief.query) frag.append(el("p", { class: "empty-state" }, "결과가 없습니다. 더 구체적인 장면이나 질감으로 써 보세요."));
  return frag;
}

/* ---------- board ---------- */
function renderBoard() {
  const frag = document.createDocumentFragment();
  const saved = Object.values(state.taste.saved).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  const affinity = tasteAffinity();
  frag.append(sectionHead("내 보드", `${saved.length}개 저장`, el("div", { class: "brief-controls" },
    el("button", { class: "btn btn-small", type: "button", onclick: () => window.print() }, "인쇄 / PDF"),
    el("button", { class: "btn btn-small", type: "button", onclick: () => { const text = saved.map((item) => `- ${item.t}\n  ${item.u}${item.stl ? `\n  가져갈 한 수: ${item.stl}` : ""}`).join("\n"); navigator.clipboard?.writeText(text); } }, "텍스트 복사"),
  )));
  frag.append(el("p", { class: "intro" }, "이 브라우저에만 저장됩니다. 담은 항목의 분야·출처·연출 축이 '오늘의 픽' 정렬에 반영됩니다."));
  const topCats = Object.entries(affinity.cat).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (topCats.length) {
    const max = topCats[0][1];
    frag.append(el("ul", { class: "bar-list" }, topCats.map(([label, n]) => el("li", {}, el("span", {}, label), el("i", { style: `width:${Math.round((n / max) * 100)}%` }), el("em", {}, n)))));
  }
  if (!saved.length) frag.append(el("p", { class: "empty-state" }, "카드의 '보드에 담기'를 누르면 여기 모입니다."));
  for (const item of saved) frag.append(referenceCard(item));
  const syncBox = el("textarea", { class: "sync", placeholder: "다른 기기의 보드 JSON을 붙여넣고 '가져오기'" });
  frag.append(sectionHead("기기 간 옮기기"), el("div", { class: "brief-controls" },
    el("button", { class: "btn btn-small", type: "button", onclick: () => { syncBox.value = JSON.stringify(state.taste); syncBox.select(); } }, "내보내기"),
    el("button", { class: "btn btn-small", type: "button", onclick: () => { try { const incoming = JSON.parse(syncBox.value); state.taste = { saved: { ...state.taste.saved, ...(incoming.saved || {}) }, hidden: { ...state.taste.hidden, ...(incoming.hidden || {}) }, views: {} }; persistTaste(); render(); } catch { syncBox.value = "JSON 형식이 아닙니다."; } } }, "가져오기"),
  ), syncBox);
  return frag;
}

/* ---------- curator ---------- */
function renderCurator() {
  const frag = document.createDocumentFragment();
  const curator = state.curator;
  const meta = state.meta;
  frag.append(sectionHead("큐레이터 메모리", curator ? `${fmtDate(curator.generatedAt)} 갱신` : null));
  if (!curator) { frag.append(el("p", { class: "empty-state" }, "메모리를 불러오지 못했습니다.")); return frag; }
  frag.append(el("p", { class: "intro" }, `독자: ${curator.reader}. ${curator.taste?.summary || ""}`));
  frag.append(el("div", { class: "stat-row" },
    el("div", { class: "stat" }, el("b", {}, `${meta?.readProgress?.read || 0}/${meta?.readProgress?.total || 0}`), el("span", {}, "원문 판독 진행")),
    el("div", { class: "stat" }, el("b", {}, meta?.sourceCount || 0), el("span", {}, "수집 소스")),
    el("div", { class: "stat" }, el("b", {}, curator.sources?.counts?.trusted || 0), el("span", {}, "신뢰 소스")),
    el("div", { class: "stat" }, el("b", {}, curator.sources?.counts?.demoted || 0), el("span", {}, "강등 소스")),
    el("div", { class: "stat" }, el("b", {}, meta?.search ? meta.search.shards.reduce((sum, shard) => sum + shard.count, 0).toLocaleString() : "-"), el("span", {}, "검색 인덱스 문서")),
  ));
  frag.append(el("div", { class: "two-col" },
    el("div", {}, sectionHead("관심 축"), el("ul", { class: "quiet-list" }, (curator.taste?.core_interests || []).map((line) => el("li", {}, line))), sectionHead("피하는 것"), el("ul", { class: "quiet-list" }, (curator.taste?.avoid || []).map((line) => el("li", {}, line)))),
    el("div", {}, sectionHead("소스 성적", "판독 keep 비율 기준"), el("ul", { class: "bar-list" }, (curator.sources?.trusted || []).slice(0, 12).map((row) => el("li", {}, el("span", {}, row.name), el("i", { style: `width:${Math.round(row.keepRate * 100)}%` }), el("em", {}, `${Math.round(row.keepRate * 100)}%`)))),
      curator.sources?.demoted?.length ? el("p", { class: "status-line" }, `강등: ${curator.sources.demoted.map((row) => row.name).join(", ")}`) : null),
  ));
  frag.append(el("div", { class: "two-col" },
    el("div", {}, sectionHead("편집 결정"), el("ul", { class: "quiet-list" }, (curator.decisions || []).map((entry) => el("li", {}, el("span", {}, `${entry.date} · `), entry.decision)))),
    el("div", {}, sectionHead("파이프라인 로그"), el("ul", { class: "quiet-list" }, (curator.health || []).map((entry) => el("li", {}, el("span", {}, `${fmtDate(entry.at)} · ${entry.agent} · `), entry.agent === "deep-insight" ? `본문 ${entry.daily?.done || 0}(원문 ${entry.daily?.fulltext || 0}) · 백필 ${entry.backfill?.done || 0} · 남은 ${entry.remaining} · 요청 ${entry.requests}${entry.lastError ? ` · 오류: ${entry.lastError}` : ""}` : entry.agent === "signal" ? `가설 ${entry.hypotheses} · 묶음 ${entry.clusters} · 판독 ${entry.readings}` : JSON.stringify(entry))))),
  ));
  if (curator.openQuestions?.length) frag.append(sectionHead("열린 질문"), el("ul", { class: "quiet-list" }, curator.openQuestions.map((line) => el("li", {}, line))));
  return frag;
}

/* ---------- shell ---------- */
async function render() {
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.view));
  els.filterBar.hidden = !TAB_VIEWS.includes(state.view);
  const token = Symbol("render");
  state.renderToken = token;
  let content;
  try {
    if (TAB_VIEWS.includes(state.view)) {
      els.panel.replaceChildren(el("div", { class: "loading-row" }, "아카이브 불러오는 중"));
      content = await renderTab(state.view);
    } else if (state.view === "today") content = renderToday();
    else if (state.view === "signals") content = renderSignals();
    else if (state.view === "brief") content = renderBrief();
    else if (state.view === "board") content = renderBoard();
    else content = renderCurator();
  } catch (error) {
    content = el("p", { class: "empty-state" }, `불러오지 못했습니다: ${error.message}`);
  }
  if (state.renderToken !== token) return;
  els.panel.replaceChildren(content);
  if (state.restoreScroll != null) {
    const target = state.restoreScroll;
    state.restoreScroll = null;
    requestAnimationFrame(() => window.scrollTo({ top: target }));
  }
  updateTabBadges();
}
const TAB_LABELS = Object.fromEntries([...document.querySelectorAll(".view-tab")].map((tab) => [tab.dataset.view, tab.textContent.trim()]));
function viewLabel(view) {
  return TAB_LABELS[view] || view;
}
function densityToggle() {
  return el("div", { class: "seg" },
    el("button", { type: "button", class: state.density === "scan" ? "is-on" : "", onclick: () => { state.density = "scan"; storeSet("refsel.density", "scan"); render(); } }, "훑어보기"),
    el("button", { type: "button", class: state.density === "detail" ? "is-on" : "", onclick: () => { state.density = "detail"; storeSet("refsel.density", "detail"); render(); } }, "자세히"));
}
function pushView(view, params = {}) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    if (params.q) url.searchParams.set("q", params.q); else url.searchParams.delete("q");
    if (url.href !== window.location.href) history.pushState({ view, q: params.q || "" }, "", url);
  } catch { /* history API unavailable: navigation still works in-page */ }
}
function switchView(view, { push = true, restore = true } = {}) {
  state.scrollByView[state.view] = window.scrollY;
  if (view !== "brief") state.briefOrigin = null;
  state.view = view;
  state.restoreScroll = restore ? (state.scrollByView[view] || 0) : 0;
  if (!TAB_VIEWS.includes(view)) { state.axis = ""; state.signal = ""; }
  if (push) pushView(view);
  render();
}
function goBackFromBrief() {
  const origin = state.briefOrigin;
  if (!origin) return switchView("today");
  state.scrollByView[origin.view] = origin.scroll;
  switchView(origin.view);
}

function updateTabBadges() {
  els.tabs.forEach((tab) => {
    const count = TAB_VIEWS.includes(tab.dataset.view) ? newCountForTab(tab.dataset.view) : 0;
    let dot = tab.querySelector(".tab-new");
    if (!count) { dot?.remove(); return; }
    if (!dot) { dot = el("span", { class: "tab-new" }); tab.append(dot); }
    dot.textContent = count > 99 ? "99+" : String(count);
  });
}
function renderGuide() {
  if (storeGet("refsel.guide.v1", false)) return;
  const guide = el("section", { class: "guide", "aria-label": "읽는 법" },
    el("b", {}, "처음이세요? 이렇게 읽으면 돼요"),
    el("ul", {},
      el("li", {}, "'오늘의 픽'부터: 세 탭에서 가장 날카로운 레퍼런스 12개"),
      el("li", {}, "날카로움(1~10) = 광고·영상 현장에 바로 쓸 만한 정도. 빨간 줄이 '가져갈 한 수'"),
      el("li", {}, "흐린 카드는 판독에서 접힌 것. '판독 펼치기'로 새로움·작동 원리·근거를 봐요"),
      el("li", {}, "'비슷한 것'은 아카이브 전체에서 연관 레퍼런스를 찾아요. '보드에 담기'를 하면 픽이 취향대로 정렬돼요")),
    el("button", { class: "btn btn-small", type: "button", onclick: () => { storeSet("refsel.guide.v1", true); guide.remove(); } }, "알겠어요"));
  document.querySelector(".view-tabs").after(guide);
}
function bindBackToTop() {
  const button = el("button", { class: "to-top", type: "button", hidden: true, "aria-label": "맨 위로", onclick: () => window.scrollTo({ top: 0, behavior: "smooth" }) }, "↑");
  document.body.append(button);
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { button.hidden = window.scrollY < 1600; ticking = false; });
  }, { passive: true });
}
function bind() {
  els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view, { restore: tab.dataset.view !== state.view })));
  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") || "today";
    const query = params.get("q");
    if (view === "brief" && query) {
      if (state.view !== "brief") state.briefOrigin = { view: state.view, scroll: window.scrollY, label: "" };
      els.briefInput.value = query;
      state.scrollByView[state.view] = window.scrollY;
      state.view = "brief";
      runBrief(query);
      return;
    }
    switchView(view, { push: false });
  });
  els.localFilter.addEventListener("input", (event) => { clearTimeout(state.queryTimer); state.queryTimer = setTimeout(() => setFilter({ query: event.target.value.trim() }), 300); });
  els.dateSelect.addEventListener("change", (event) => setFilter({ date: event.target.value }));
  els.toggleAll.addEventListener("click", () => setFilter({ showAll: !state.showAll }));
  els.briefForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = els.briefInput.value.trim();
    if (!query) return;
    state.brief.excludeUrl = "";
    state.briefOrigin = null;
    openBrief(query);
  });
  bindBackToTop();
}

async function init() {
  initVisit();
  bind();
  renderGuide();
  const params = new URLSearchParams(window.location.search);
  const results = await Promise.allSettled([getJson("./data/meta.json"), getJson("./data/today.json"), getJson("./data/signals.json"), getJson("./data/curator.json")]);
  [state.meta, state.today, state.signals, state.curator] = results.map((result) => (result.status === "fulfilled" ? result.value : null));
  if (state.meta) {
    const total = Object.values(state.meta.tabs).reduce((sum, tab) => sum + tab.itemCount, 0);
    els.footMeta.textContent = `총 ${total.toLocaleString()}개 보관 · 원문 판독 ${state.meta.readProgress.read.toLocaleString()}개 · 소스 ${state.meta.sourceCount}개 · ${fmtDate(state.meta.generatedAt)} 갱신`;
    els.mastheadNote.textContent = `매일 원문을 읽고 판독합니다 · 최신 ${fmtDay(state.meta.tabs.updates?.latest)}`;
    const ageHours = (Date.now() - new Date(state.meta.generatedAt).getTime()) / 3600000;
    if (ageHours > 40) {
      els.mastheadNote.textContent = `자동 업데이트가 ${Math.round(ageHours)}시간 동안 멈춰 있어요. GitHub Actions 실행 기록을 확인해 주세요.`;
      els.mastheadNote.style.color = "#e43d30";
      els.mastheadNote.style.fontWeight = "700";
    }
  }
  const view = params.get("view");
  const query = params.get("q");
  if (query) { els.briefInput.value = query; state.view = "brief"; runBrief(query); updateTabBadges(); return; }
  if (view && [...els.tabs].some((tab) => tab.dataset.view === view)) state.view = view;
  render();
}

init().catch((error) => { els.panel.replaceChildren(el("p", { class: "empty-state" }, `초기화 실패: ${error.message}`)); });
