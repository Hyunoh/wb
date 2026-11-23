// 집계: 서울 시작 날짜 기준으로 사람별로 묶고, 막대 폭/월 요약을 계산한다.
import { isNum } from './format.js';

/** 90분 이상이면 칸을 꽉 채운다 */
export const FULL_BAR_MIN = 90;
export const barWidth = (mins) => Math.min(Math.max(mins, 0) / FULL_BAR_MIN, 1) * 100;

/** workouts → Map('YYYY-MM-DD' → { [userId]: workout[] }). 모르는 user는 무시 */
export function groupByDate(workouts, userIds) {
  const map = new Map();
  for (const w of workouts) {
    if (!userIds.includes(w.user) || typeof w.start !== 'string') continue;
    const d = w.start.slice(0, 10); // 시작 시각(+09:00)의 날짜
    if (!map.has(d)) map.set(d, Object.fromEntries(userIds.map((id) => [id, []])));
    map.get(d)[w.user].push(w);
  }
  return map;
}

export const sumBy = (arr, key) => arr.reduce((s, w) => s + (isNum(w[key]) ? w[key] : 0), 0);

/** 한 사람의 월 요약: 운동한 날 수, 총 분, 총 kcal */
export function summarize(byDate, ym, userId) {
  let days = 0, minutes = 0, kcal = 0;
  for (const [d, rec] of byDate) {
    const list = rec[userId];
    if (!d.startsWith(ym) || !list || !list.length) continue;
    days++;
    minutes += sumBy(list, 'duration_min');
    kcal += sumBy(list, 'active_kcal');
  }
  return { days, minutes, kcal };
}

// 운동 종류 → 아이콘 (PRD D9). 위에서부터 먼저 맞는 규칙이 이긴다. 모르는 종류는 🏅
const ICONS = [
  [/고강도|인터벌|HIIT/i, '⚡'], [/달리기|러닝/, '🏃'], [/걷기|워킹/, '🚶'],
  [/하이킹|등산/, '🥾'], [/근력|웨이트|코어|트레이닝/, '🏋️'], [/요가/, '🧘'],
  [/필라테스/, '🤸'], [/사이클|자전거/, '🚴'], [/수영/, '🏊'], [/댄스/, '💃'],
  [/쿨다운|스트레칭|유연성/, '🙆'], [/계단/, '🪜'], [/로잉/, '🚣'], [/일립티컬/, '🌀'],
  [/복싱/, '🥊'], [/테니스/, '🎾'], [/배드민턴/, '🏸'], [/탁구/, '🏓'], [/골프/, '⛳'],
  [/축구/, '⚽'], [/농구/, '🏀'], [/야구/, '⚾'],
];
export const iconFor = (type) => (ICONS.find(([re]) => re.test(String(type))) || [, '🏅'])[1];
