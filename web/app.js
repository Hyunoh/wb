// 운동보드 대시보드 UI. 달력 칸 표현은 mockup/ A안(사람별 막대 + 분)과 동일하다.
// ?mock=1 이면 키/네트워크 없이 mock-data.js로 그린다(디자인 확인용).
import { API_URL, USERS as CONFIG_USERS } from './config.js';
import { WEEKDAYS, seoulToday, monthGrid, addDays, addMonths, parseDate, fetchRangeFor, rolloverYm, inGrid } from './lib/dates.js';
import { escapeHtml as esc, isNum, fmtInt, fmtMin, fmtShort, relativeLabel, hrHTML } from './lib/format.js';
import { barWidth, groupByDate, sumBy, summarize, iconFor } from './lib/aggregate.js';
import { fetchRange, ping } from './lib/api.js';
import { createStore, safeLocalStorage, isStale, VISIBLE_TTL_MS } from './lib/store.js';
import { createLoader } from './lib/loader.js';

const $ = (s) => document.querySelector(s);
const MOCK = new URLSearchParams(location.search).get('mock') === '1';

const MSG_BAD_KEY = '키가 맞지 않아요. 다시 확인해 주세요.';
const MSG_OFFLINE = '연결할 수 없어요. 잠시 후 다시 시도해 주세요.';

let USERS = CONFIG_USERS;
let mock = null; // 목 모드 데이터 { byDate, today }
const store = createStore(safeLocalStorage());
const state = {
  filter: 'both',
  ym: '',
  day: null,
  today: seoulToday(),
  started: false,
  persistFail: false,   // 키를 이 기기에 저장하지 못함(세션 동안은 메모리로 동작)
};
// 달별 로딩/오류 상태, 중복 요청 합치기, 인증 세대 검사는 loader가 맡는다
const loader = createLoader({
  fetchFn: (u) => fetch(u),
  apiUrl: API_URL,
  store,
  onUnauthorized: () => handleUnauthorized(),
  onChange: () => { if (state.started) renderAll(); },
});

const people = () => (state.filter === 'both' ? USERS : USERS.filter((u) => u.id === state.filter));
const userIds = () => USERS.map((u) => u.id);
const emptyRec = () => Object.fromEntries(userIds().map((id) => [id, []]));

// 현재 달의 날짜별 집계. 달 캐시(격자 범위 전체)에서 만든다
function currentByDate() {
  if (mock) return mock.byDate;
  if (!state.started) return new Map();
  const entry = store.getMonth(state.ym);
  return groupByDate(entry ? entry.workouts : [], userIds());
}

// ── 렌더링 ──
function renderCalendar(byDate) {
  const g = monthGrid(state.ym);
  const [y, m] = state.ym.split('-');
  $('#month-title').textContent = `${y}년 ${Number(m)}월`;
  const grid = $('#grid');
  grid.className = `grid ${state.filter === 'both' ? '' : 'single'}`;
  grid.style.setProperty('--rows', g.rows);
  grid.innerHTML = g.cells.map((c) => cellHTML(c, byDate)).join('');
}

function cellHTML(c, byDate) {
  const rec = byDate.get(c.date) || emptyRec();
  const future = c.date > state.today;
  const cls = ['day', c.out && 'out', future && 'future', c.sunday && 'sunday',
    c.date === state.today && 'today', c.date === state.day && 'sel'].filter(Boolean).join(' ');
  let body = '';
  if (!future) {
    body = `<div class="bars">${people().map((u) => {
      const mins = sumBy(rec[u.id], 'duration_min');
      return `<div class="bar ${esc(u.id)} ${mins ? '' : 'empty'}"><span class="track"><i style="width:${barWidth(mins)}%"></i></span><b>${Math.round(mins)}</b></div>`;
    }).join('')}</div>`;
  }
  return `<button class="${cls}" data-date="${c.date}" ${future ? 'disabled' : ''} aria-label="${c.date}">
    <span class="num">${c.day}</span>${body}</button>`;
}

function renderSummary(byDate) {
  $('#summary').innerHTML = people().map((u) => {
    const s = summarize(byDate, state.ym, u.id);
    return `<div class="sum-row">
      <span class="who ${esc(u.id)}"><i class="sw ${esc(u.id)}"></i>${esc(u.name)}</span>
      <span><small>운동</small><strong>${s.days}</strong>일</span>
      <span><small>시간</small><strong>${fmtShort(s.minutes)}</strong></span>
      <span><small>kcal</small><strong>${fmtInt(s.kcal)}</strong></span>
    </div>`;
  }).join('');
}

function renderFilter() {
  const btns = [{ id: 'both', name: '둘 다' }, ...USERS].map((u) =>
    `<button data-f="${esc(u.id)}" class="${state.filter === u.id ? 'on' : ''}">${u.id === 'both' ? '' : `<i class="sw ${esc(u.id)}"></i>`}${esc(u.name)}</button>`);
  $('#filter').innerHTML = btns.join('');
}

function renderSynced() {
  const el = $('#synced');
  let text;
  const upd = mock ? undefined : store.getUpdatedAt();
  const status = mock ? 'idle' : loader.status(state.ym); // 지금 보이는 달의 상태만 반영한다
  if (mock) text = '3분 전 업데이트';
  else if (status === 'loading') text = '업데이트 중…';
  else if (status === 'error') text = '오프라인 · 저장된 기록';
  else if (upd === null) text = '기록 없음';
  else if (upd === undefined) text = '업데이트 대기';
  else text = `${relativeLabel(upd) || '–'} 업데이트`;
  el.textContent = text;
  el.classList.toggle('off', status === 'error');
  el.classList.toggle('busy', status === 'loading');
  $('#notice').hidden = !state.persistFail;
}

function renderAll() {
  const byDate = currentByDate();
  renderCalendar(byDate);
  renderSummary(byDate);
  renderFilter();
  renderSynced();
  $('#next').style.opacity = state.ym >= state.today.slice(0, 7) ? 0.25 : 1;
  if (state.day) renderSheet(sheetByDate(byDate));
}

// 시트는 선택한 날짜가 속한 달의 데이터를 우선 쓴다(없으면 현재 격자 데이터)
function sheetByDate(fallback) {
  if (mock) return fallback;
  const entry = store.getMonth(state.day.slice(0, 7));
  return entry ? groupByDate(entry.workouts, userIds()) : fallback;
}

// ── 상세 시트 ──
function wkHTML(w) {
  const t = esc(String(w.start).slice(11, 16));
  const hr = hrHTML(w.avg_hr, w.max_hr);
  const dur = isNum(w.duration_min) ? fmtMin(w.duration_min) : '–';
  const kcal = isNum(w.active_kcal) ? fmtInt(w.active_kcal) : '–';
  return `<div class="wk">
    <div class="ico">${iconFor(w.type)}</div>
    <div class="name-line"><span class="type">${esc(w.type)}</span><span class="time">${t} · ${esc(dur)}</span></div>
    <div class="stats"><span><em>🔥</em>${esc(kcal)} kcal</span>${hr}</div>
  </div>`;
}

function renderSheet(byDate) {
  const date = state.day;
  const { m, d } = parseDate(date);
  const wd = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  $('#sheet-title').textContent = `${m}월 ${d}일 (${wd})`;
  const rec = byDate.get(date) || emptyRec();
  $('#sheet-body').innerHTML = people().map((u) => {
    const ws = rec[u.id];
    const meta = ws.length ? `${fmtMin(sumBy(ws, 'duration_min'))} · ${fmtInt(sumBy(ws, 'active_kcal'))} kcal` : '';
    const list = ws.length ? ws.map(wkHTML).join('') : '<div class="none">운동 기록이 없어요</div>';
    return `<div class="person ${esc(u.id)}"><h3><i class="sw ${esc(u.id)}"></i><span class="name">${esc(u.name)}</span><span class="meta">${esc(meta)}</span></h3>${list}</div>`;
  }).join('');
  const atEnd = date >= state.today;
  $('#day-next').disabled = atEnd;
  $('#day-next').style.opacity = atEnd ? 0.3 : 1;
}

function openDay(date) {
  state.day = date;
  $('#sheet').classList.add('show');
  $('#sheet').setAttribute('aria-hidden', 'false');
  $('#backdrop').classList.add('show');
  renderAll();
  $('#sheet-body').scrollTop = 0;
}

function closeDay() {
  state.day = null;
  $('#sheet').classList.remove('show');
  $('#sheet').setAttribute('aria-hidden', 'true');
  $('#backdrop').classList.remove('show');
  renderAll();
}

function shiftDay(n) {
  if (!state.day) return;
  const next = addDays(state.day, n);
  if (next > state.today) return;
  const ym = next.slice(0, 7);
  if (ym !== state.ym) { state.ym = ym; loadMonth(); }
  openDay(next);
}

function shiftMonth(n) {
  const next = addMonths(state.ym, n);
  if (next > state.today.slice(0, 7)) return;
  gotoMonth(next);
}

function gotoMonth(ym) {
  state.ym = ym;
  renderAll();
  loadMonth();
}

// ── 데이터 로딩 (D8) ──
/** 인증 실패: 화면의 데이터를 즉시 비우고 키 입력 화면으로 */
function handleUnauthorized() {
  store.clearAll(); // epoch가 올라가 진행 중이던 옛 요청의 응답은 버려진다
  loader.reset();
  state.started = false;
  state.day = null;
  $('#sheet').classList.remove('show');
  $('#sheet').setAttribute('aria-hidden', 'true');
  $('#backdrop').classList.remove('show');
  $('#sheet-body').innerHTML = '';
  $('#grid').innerHTML = '';
  $('#summary').innerHTML = '';
  showGate(MSG_BAD_KEY);
}

const refreshMonth = (ym, force = false) => {
  if (mock) return Promise.resolve();
  return loader.refresh(ym, { force, today: state.today });
};
const loadMonth = () => refreshMonth(state.ym);

/** 앱이 다시 보일 때: 날짜가 바뀌었으면 다시 그리고, 마지막 갱신이 60초 넘었으면 새로 받는다 */
function onVisible() {
  if (!state.started || mock) return;
  checkDateRollover();
  const { to } = fetchRangeFor(state.ym, state.today);
  if (isStale(store.getMonth(state.ym), Date.now(), VISIBLE_TTL_MS, to)) refreshMonth(state.ym, true);
}

function checkDateRollover() {
  const t = seoulToday();
  if (t === state.today) return;
  const prev = state.today;
  state.today = t;
  state.ym = rolloverYm(state.ym, prev, t);
  if (state.day && !inGrid(state.ym, state.day)) closeDay(); // 새 달 격자 밖의 날짜면 시트를 닫는다
  renderAll();
  loadMonth(); // 조회 범위(오늘까지)가 달라졌으므로 캐시의 to가 이르면 다시 받는다
}

// ── 키 입력 화면 (D6) ──
function showGate(errMsg, prefill = '') {
  $('#gate').hidden = false;
  const err = $('#gate-err');
  err.hidden = !errMsg;
  err.textContent = errMsg || '';
  $('#gate-key').value = prefill;
  $('#gate-btn').disabled = false;
}

/** 키를 서버로 검증하고 통과하면 저장. 결과 status 반환 */
async function tryKey(key) {
  const r = await ping((u) => fetch(u), API_URL, key);
  if (r.status === 'ok') {
    if (store.getKey() !== key) store.clearAll(); // 다른 키의 캐시는 버린다
    state.persistFail = !store.setKey(key);
  }
  return r;
}

function gateMessage(status) {
  return status === 'unauthorized' ? MSG_BAD_KEY : MSG_OFFLINE;
}

$('#gate-form').onsubmit = async (e) => {
  e.preventDefault();
  const key = $('#gate-key').value.trim();
  const err = $('#gate-err');
  if (!key) { err.textContent = MSG_BAD_KEY; err.hidden = false; return; }
  $('#gate-btn').disabled = true;
  const r = await tryKey(key);
  $('#gate-btn').disabled = false;
  if (r.status === 'ok') { $('#gate').hidden = true; $('#gate-key').value = ''; start(); return; }
  err.textContent = gateMessage(r.status);
  err.hidden = false;
};

/** 설정 링크(#k=키)에서 키를 꺼내고 주소창에서 즉시 지운다 */
function takeHashKey() {
  const h = location.hash;
  if (!h.includes('k=')) return '';
  const k = new URLSearchParams(h.replace(/^#/, '')).get('k') || '';
  history.replaceState(null, '', location.pathname + location.search);
  return k.trim();
}

// ── 시작 ──
function start() {
  if (state.started) return;
  state.started = true;
  renderAll();                 // 캐시로 먼저 즉시 그린다
  refreshMonth(state.ym, true); // 뒤에서 새로 받는다
}

function bindEvents() {
  $('#grid').addEventListener('click', (e) => {
    const b = e.target.closest('.day');
    if (b && !b.disabled) openDay(b.dataset.date);
  });
  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.filter = b.dataset.f;
    renderAll();
  });
  $('#prev').onclick = () => shiftMonth(-1);
  $('#next').onclick = () => shiftMonth(1);
  $('#today').onclick = () => { checkDateRollover(); gotoMonth(state.today.slice(0, 7)); };
  $('#backdrop').onclick = closeDay;
  $('#close').onclick = closeDay;
  $('#day-prev').onclick = () => shiftDay(-1);
  $('#day-next').onclick = () => shiftDay(1);
  $('#synced').onclick = () => { if (!mock) refreshMonth(state.ym, true); };

  // 시트 아래로 끌어서 닫기: 손잡이/헤더에서 시작하면 항상, 본문에서는 스크롤이 맨 위일 때만
  let startY = null;
  $('#sheet').addEventListener('touchstart', (e) => {
    const onHandle = e.target.closest('.grabber, .sheet-head');
    startY = onHandle || $('#sheet-body').scrollTop <= 0 ? e.touches[0].clientY : null;
  }, { passive: true });
  $('#sheet').addEventListener('touchend', (e) => {
    if (startY != null && e.changedTouches[0].clientY - startY > 70) closeDay();
    startY = null;
  });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onVisible(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) onVisible(); });
  setInterval(() => { if (state.started) { checkDateRollover(); renderSynced(); } }, 60000); // 상대 시간 갱신
}

async function boot() {
  bindEvents();
  if (MOCK) {
    const m = await import('./mock-data.js');
    USERS = m.USERS;
    state.today = m.TODAY;
    mock = { byDate: groupByDate(m.WORKOUTS, m.USERS.map((u) => u.id)) };
    state.ym = state.today.slice(0, 7);
    state.started = true;
    renderAll();
    return;
  }
  state.ym = state.today.slice(0, 7);
  const hashKey = takeHashKey();
  if (hashKey) {
    const r = await tryKey(hashKey);
    if (r.status === 'ok') return start();
    return showGate(gateMessage(r.status), r.status === 'unauthorized' ? '' : hashKey);
  }
  if (store.getKey()) start(); else showGate();
}

boot();
