// 디자인 목업용 가짜 데이터. 실제 시트 스키마(PRD 5.2)와 같은 모양이다.
// 2026-08-01 ~ 2026-11-22, 시드 고정이라 새로 고쳐도 같은 값이 나온다.

export const TODAY = '2026-11-22';

export const USERS = [
  { id: 'me', name: '나' },
  { id: 'wife', name: '아내' },
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// [종류, 가중치, 분 범위, kcal/분 범위, 평균심박 범위]
const PLAN = {
  me: {
    p: 0.55,
    hours: [6, 7, 19, 20, 21],
    types: [
      ['실외 달리기', 0.38, [22, 55], [9, 12.5], [140, 168]],
      ['기능적 근력 강화 운동', 0.32, [35, 60], [5, 7.5], [105, 138]],
      ['실외 걷기', 0.15, [30, 70], [4, 5.5], [96, 118]],
      ['실외 사이클', 0.1, [40, 95], [7, 10], [122, 152]],
      ['고강도 인터벌 트레이닝', 0.05, [15, 25], [10, 13], [150, 172]],
    ],
  },
  wife: {
    p: 0.5,
    hours: [8, 9, 10, 18, 19],
    types: [
      ['요가', 0.28, [30, 60], [2.8, 4], [84, 108]],
      ['실외 걷기', 0.3, [30, 80], [4, 5.5], [95, 122]],
      ['필라테스', 0.2, [40, 55], [4, 5.8], [98, 128]],
      ['실내 사이클', 0.12, [25, 45], [7, 9.5], [125, 150]],
      ['댄스', 0.1, [30, 50], [6, 8], [118, 145]],
    ],
  },
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d, h, m) => `${d}T${pad(h)}:${pad(m)}:00+09:00`;
const between = (r, [a, b]) => a + r() * (b - a);

function pick(r, types) {
  let x = r() * types.reduce((s, t) => s + t[1], 0);
  for (const t of types) if ((x -= t[1]) <= 0) return t;
  return types[0];
}

function makeWorkout(r, user, date, hour, t) {
  const [type, , mins, kpm, hr] = t;
  const dur = Math.round(between(r, mins) * 10) / 10;
  const startMin = Math.floor(r() * 50);
  const endTotal = hour * 60 + startMin + Math.round(dur);
  const avg = Math.round(between(r, hr));
  return {
    id: `${user}_${iso(date, hour, startMin)}`,
    user,
    type,
    start: iso(date, hour, startMin),
    end: iso(date, Math.floor(endTotal / 60) % 24, endTotal % 60),
    duration_min: dur,
    active_kcal: Math.round(dur * between(r, kpm)),
    avg_hr: avg,
    max_hr: avg + 12 + Math.round(r() * 22),
  };
}

function generate() {
  const out = [];
  const r = rng(20261122);
  const d = new Date(Date.UTC(2026, 7, 1));
  const end = new Date(Date.UTC(2026, 10, 22));
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (date === TODAY) continue; // 오늘은 아래 고정 데이터만
    for (const u of USERS) {
      const plan = PLAN[u.id];
      if (r() > plan.p) continue;
      const hour = plan.hours[Math.floor(r() * plan.hours.length)];
      out.push(makeWorkout(r, u.id, date, hour, pick(r, plan.types)));
      // 가끔 하루 두 번 (예: 달리기 + 근력)
      if (r() < 0.13) out.push(makeWorkout(r, u.id, date, Math.min(hour + 2, 22), pick(r, plan.types)));
    }
  }
  // 상세 화면에서 보여 줄 예외 케이스: 심박이 없는 운동(수영, 워치 미착용 구간)
  out.push({
    id: 'me_2026-11-18T12:20:00+09:00', user: 'me', type: '수영',
    start: '2026-11-18T12:20:00+09:00', end: '2026-11-18T13:00:00+09:00',
    duration_min: 40, active_kcal: 330, avg_hr: null, max_hr: null,
  });
  // 오늘 아침: 둘 다 운동한 날
  out.push({
    id: 'me_2026-11-22T07:05:00+09:00', user: 'me', type: '실외 달리기',
    start: '2026-11-22T07:05:00+09:00', end: '2026-11-22T07:41:00+09:00',
    duration_min: 36.2, active_kcal: 402, avg_hr: 151, max_hr: 174,
  });
  out.push({
    id: 'wife_2026-11-22T09:30:00+09:00', user: 'wife', type: '요가',
    start: '2026-11-22T09:30:00+09:00', end: '2026-11-22T10:15:00+09:00',
    duration_min: 45, active_kcal: 152, avg_hr: 96, max_hr: 121,
  });
  const seen = new Set();
  return out.filter((w) => !seen.has(w.id) && seen.add(w.id))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const WORKOUTS = generate();
