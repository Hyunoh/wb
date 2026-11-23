// 날짜 유틸. 모든 날짜는 'YYYY-MM-DD' 문자열(서울 기준)로 다루고, 계산은 UTC로 해서 기기 시간대 영향을 없앤다.

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const pad2 = (n) => String(n).padStart(2, '0');
export const dstr = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

const SEOUL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** 현재(또는 주입된) 시각의 서울 날짜 */
export function seoulToday(now = new Date()) {
  const p = Object.fromEntries(SEOUL_FMT.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** 날짜에 n일을 더한다 */
export function addDays(date, n) {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dstr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 요일 (0=일) */
export function weekday(date) {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 'YYYY-MM'에 n달을 더한다 */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}`;
}

/**
 * 월 달력 격자. 앞뒤 이웃 달 날짜를 포함해 주 단위(5주 또는 6주)로 채운다.
 * 반환: { from, to, rows, cells: [{ date, day, out, sunday }] }
 */
export function monthGrid(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = dstr(y, m, 1);
  const lead = weekday(first);
  const total = Math.ceil((lead + daysInMonth(y, m)) / 7) * 7;
  const from = addDays(first, -lead);
  const cells = [];
  for (let i = 0; i < total; i++) {
    const date = addDays(from, i);
    cells.push({ date, day: parseDate(date).d, out: !date.startsWith(ym), sunday: i % 7 === 0 });
  }
  return { from, to: cells[cells.length - 1].date, rows: total / 7, cells };
}

/** 조회 범위: 격자 전체를 오늘까지로 자른다 */
export function fetchRangeFor(ym, today) {
  const g = monthGrid(ym);
  return { from: g.from, to: g.to > today ? today : g.to };
}

/**
 * 날짜가 바뀐 뒤 보여 줄 달. 이전 "현재 달"을 보던 중이면 새 현재 달로 옮기고,
 * 미래 달이 되어 버렸으면 현재 달로 당긴다.
 */
export function rolloverYm(ym, prevToday, newToday) {
  const prevCur = prevToday.slice(0, 7);
  const newCur = newToday.slice(0, 7);
  if (ym === prevCur && newCur !== prevCur) return newCur;
  return ym > newCur ? newCur : ym;
}

/** 날짜가 해당 달 격자(앞뒤 이웃 날짜 포함)에 보이는지 */
export const inGrid = (ym, date) => monthGrid(ym).cells.some((c) => c.date === date);
