// workoutBoard 디자인 목업. 백엔드 없이 mock-data.js로 그린다.
// 달력 칸 표현: A안(사람별 막대 + 분)으로 확정 (2026-11-22)
// URL 파라미터(스크린샷용): filter=both|me|wife, theme=light|dark,
//   month=2026-11, day=2026-11-18(상세 시트 열기), screen=key|key-error, demo=1(시안 전환 버튼)
import { WORKOUTS, USERS, TODAY } from './mock-data.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);

const state = {
  filter: ['me', 'wife'].includes(q.get('filter')) ? q.get('filter') : 'both',
  ym: q.get('month') || TODAY.slice(0, 7),
  day: q.get('day'),
};
if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');

// ── 운동 종류 → 아이콘 (PRD D9). 모르는 종류는 🏅 ──
const ICONS = [
  [/달리기|러닝/, '🏃'], [/걷기|워킹/, '🚶'], [/하이킹|등산/, '🥾'],
  [/근력|웨이트|코어/, '🏋️'], [/고강도|인터벌|HIIT/i, '⚡'], [/요가/, '🧘'],
  [/필라테스/, '🤸'], [/사이클|자전거/, '🚴'], [/수영/, '🏊'], [/댄스/, '💃'],
  [/쿨다운|스트레칭|유연성/, '🙆'], [/테니스|배드민턴|탁구/, '🏸'], [/축구|농구|야구/, '⚽'],
];
const iconFor = (t) => (ICONS.find(([re]) => re.test(t)) || [, '🏅'])[1];

// ── 집계 ──
const byDate = new Map(); // 'YYYY-MM-DD' → { me: [...], wife: [...] }
for (const w of WORKOUTS) {
  const d = w.start.slice(0, 10); // 시작 시각(+09:00 기준)의 날짜로 집계
  if (!byDate.has(d)) byDate.set(d, { me: [], wife: [] });
  byDate.get(d)[w.user].push(w);
}
const sum = (arr, k) => arr.reduce((s, w) => s + (w[k] || 0), 0);
const fmtMin = (m) => {
  m = Math.round(m);
  if (m < 60) return `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`;
};
const fmtShort = (m) => { // 요약 줄은 공간이 좁아서 9:20 형식
  m = Math.round(m); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const people = () => (state.filter === 'both' ? USERS : USERS.filter((u) => u.id === state.filter));
const dstr = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];

// ── 달력 ──
function renderCalendar() {
  const [y, m] = state.ym.split('-').map(Number);
  $('#month-title').textContent = `${y}년 ${m}월`;
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();
  const cells = [];
  const totalCells = Math.ceil((first + days) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    let dd = i - first + 1, cy = y, cm = m, out = false;
    if (dd < 1) { out = true; cm = m - 1; dd = prevDays + dd; if (cm < 1) { cm = 12; cy--; } }
    else if (dd > days) { out = true; cm = m + 1; dd -= days; if (cm > 12) { cm = 1; cy++; } }
    cells.push(cellHTML(dstr(cy, cm, dd), dd, out, i % 7 === 0));
  }
  const grid = $('#grid');
  grid.className = `grid ${state.filter === 'both' ? '' : 'single'}`;
  grid.style.setProperty('--rows', totalCells / 7);
  grid.innerHTML = cells.join('');
}

function cellHTML(date, dd, out, sunday) {
  const rec = byDate.get(date) || { me: [], wife: [] };
  const future = date > TODAY;
  const cls = ['day', out && 'out', future && 'future', sunday && 'sunday',
    date === TODAY && 'today', date === state.day && 'sel'].filter(Boolean).join(' ');
  let body = '';
  if (!future) {
    const ps = people();
    body = `<div class="bars">${ps.map((u) => {
      const mins = sum(rec[u.id], 'duration_min');
      const w = Math.min(mins / 90, 1) * 100; // 90분 이상이면 칸을 꽉 채운다
      return `<div class="bar ${u.id} ${mins ? '' : 'empty'}"><span class="track"><i style="width:${w}%"></i></span><b>${Math.round(mins)}</b></div>`;
    }).join('')}</div>`;
  }
  return `<button class="${cls}" data-date="${date}" ${future ? 'disabled' : ''} aria-label="${date}">
    <span class="num">${dd}</span>${body}</button>`;
}

// ── 월 요약 (PRD D4) ──
function renderSummary() {
  const rows = people().map((u) => {
    let dayCount = 0, mins = 0, kcal = 0;
    for (const [d, rec] of byDate) {
      if (!d.startsWith(state.ym) || !rec[u.id].length) continue;
      dayCount++; mins += sum(rec[u.id], 'duration_min'); kcal += sum(rec[u.id], 'active_kcal');
    }
    return `<div class="sum-row">
      <span class="who ${u.id}"><i class="sw ${u.id}"></i>${u.name}</span>
      <span><small>운동</small><strong>${dayCount}</strong>일</span>
      <span><small>시간</small><strong>${fmtShort(mins)}</strong></span>
      <span><small>kcal</small><strong>${kcal.toLocaleString('ko-KR')}</strong></span>
    </div>`;
  });
  $('#summary').innerHTML = rows.join('');
}

// ── 상세 시트 (PRD D3) ──
function openDay(date) {
  state.day = date;
  const d = new Date(date + 'T00:00:00');
  $('#sheet-title').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`;
  const rec = byDate.get(date) || { me: [], wife: [] };
  $('#sheet-body').innerHTML = people().map((u) => {
    const ws = rec[u.id];
    const meta = ws.length ? `${fmtMin(sum(ws, 'duration_min'))} · ${sum(ws, 'active_kcal').toLocaleString('ko-KR')} kcal` : '';
    const list = ws.length ? ws.map(wkHTML).join('') : '<div class="none">운동 기록이 없어요</div>';
    return `<div class="person ${u.id}"><h3><i class="sw ${u.id}"></i><span class="name">${u.name}</span><span class="meta">${meta}</span></h3>${list}</div>`;
  }).join('');
  $('#sheet').classList.add('show');
  $('#sheet').setAttribute('aria-hidden', 'false');
  $('#backdrop').classList.add('show');
  $('#day-next').disabled = date >= TODAY;
  $('#day-next').style.opacity = date >= TODAY ? .3 : 1;
  renderCalendar();
}

function wkHTML(w) {
  const t = w.start.slice(11, 16);
  const hr = w.avg_hr == null
    ? '<span class="na"><em>♥</em>심박 없음</span>'
    : `<span><em>♥ 평균</em>${w.avg_hr}</span><span><em>최고</em>${w.max_hr}</span>`;
  return `<div class="wk">
    <div class="ico">${iconFor(w.type)}</div>
    <div class="name-line"><span class="type">${w.type}</span><span class="time">${t} · ${fmtMin(w.duration_min)}</span></div>
    <div class="stats"><span><em>🔥</em>${(w.active_kcal ?? '–').toLocaleString('ko-KR')} kcal</span>${hr}</div>
  </div>`;
}

function closeDay() {
  state.day = null;
  $('#sheet').classList.remove('show');
  $('#sheet').setAttribute('aria-hidden', 'true');
  $('#backdrop').classList.remove('show');
  renderCalendar();
}

function shiftDay(n) {
  const d = new Date(state.day + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const next = dstr(d.getFullYear(), d.getMonth() + 1, d.getDate());
  if (next > TODAY) return;
  if (!next.startsWith(state.ym)) { state.ym = next.slice(0, 7); renderAll(); }
  openDay(next);
}

function shiftMonth(n) {
  let [y, m] = state.ym.split('-').map(Number);
  m += n; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  const next = dstr(y, m, 1).slice(0, 7);
  if (next > TODAY.slice(0, 7)) return;
  state.ym = next; renderAll();
}

function renderAll() {
  renderCalendar();
  renderSummary();
  document.querySelectorAll('#filter button').forEach((b) => b.classList.toggle('on', b.dataset.f === state.filter));
  $('#next').style.opacity = state.ym >= TODAY.slice(0, 7) ? .25 : 1;
}

// ── 이벤트 ──
$('#grid').addEventListener('click', (e) => {
  const b = e.target.closest('.day');
  if (b && !b.disabled) openDay(b.dataset.date);
});
$('#filter').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.filter = b.dataset.f; renderAll(); if (state.day) openDay(state.day);
});
$('#prev').onclick = () => shiftMonth(-1);
$('#next').onclick = () => shiftMonth(1);
$('#today').onclick = () => { state.ym = TODAY.slice(0, 7); renderAll(); };
$('#backdrop').onclick = closeDay;
$('#close').onclick = closeDay;
$('#day-prev').onclick = () => shiftDay(-1);
$('#day-next').onclick = () => shiftDay(1);

// 시트 아래로 끌어서 닫기
let startY = null;
$('#sheet').addEventListener('touchstart', (e) => { if ($('#sheet-body').scrollTop <= 0) startY = e.touches[0].clientY; }, { passive: true });
$('#sheet').addEventListener('touchend', (e) => {
  if (startY != null && e.changedTouches[0].clientY - startY > 70) closeDay();
  startY = null;
});

// 키 입력 화면 (PRD D6) — 목업에서는 "wrong"만 실패로 처리
const screen = q.get('screen');
if (screen === 'key' || screen === 'key-error') {
  $('#gate').hidden = false;
  if (screen === 'key-error') { $('#gate-err').hidden = false; $('#gate-key').value = 'wrongkey'; }
}
$('#gate-form').onsubmit = (e) => {
  e.preventDefault();
  if ($('#gate-key').value.trim() === 'wrong' || !$('#gate-key').value.trim()) { $('#gate-err').hidden = false; return; }
  $('#gate').hidden = true;
};

// 목업 전용: 다크 모드 전환
if (q.get('demo') === '1') {
  $('#demo').hidden = false;
  $('#demo').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'demo-theme') {
      const root = document.documentElement;
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    }
  });
}

renderAll();
if (state.day) openDay(state.day);
