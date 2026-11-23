import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByDate, barWidth, summarize, iconFor } from '../lib/aggregate.js';

const W = (user, start, min, kcal, type = '요가') => ({ user, type, start, duration_min: min, active_kcal: kcal });
const IDS = ['me', 'wife'];

test('groupByDate: 서울 시작 날짜 기준, 사람별', () => {
  const m = groupByDate([
    W('me', '2026-11-22T00:30:00+09:00', 30, 100),
    W('me', '2026-11-21T23:50:00+09:00', 20, 50),
    W('wife', '2026-11-22T09:00:00+09:00', 45, 150),
    W('stranger', '2026-11-22T09:00:00+09:00', 45, 150),
  ], IDS);
  assert.equal(m.get('2026-11-22').me.length, 1);
  assert.equal(m.get('2026-11-22').wife.length, 1);
  assert.equal(m.get('2026-11-21').me.length, 1);
  assert.equal(m.size, 2);
});

test('barWidth: 90분=100%, 상한 100%', () => {
  assert.equal(barWidth(90), 100);
  assert.equal(barWidth(45), 50);
  assert.equal(barWidth(200), 100);
  assert.equal(barWidth(0), 0);
});

test('summarize: 해당 월만, null 값은 0', () => {
  const m = groupByDate([
    W('me', '2026-11-02T07:00:00+09:00', 30, 300),
    W('me', '2026-11-02T20:00:00+09:00', 30.4, null),
    W('me', '2026-11-05T07:00:00+09:00', 60, 400),
    W('me', '2026-10-31T07:00:00+09:00', 99, 999),
    W('wife', '2026-11-05T07:00:00+09:00', 45, 150),
  ], IDS);
  const s = summarize(m, '2026-11', 'me');
  assert.equal(s.days, 2);
  assert.ok(Math.abs(s.minutes - 120.4) < 1e-9);
  assert.equal(s.kcal, 700);
  assert.deepEqual(summarize(m, '2026-09', 'me'), { days: 0, minutes: 0, kcal: 0 });
});

test('iconFor', () => {
  assert.equal(iconFor('실외 달리기'), '🏃');
  assert.equal(iconFor('고강도 인터벌 트레이닝'), '⚡');
  assert.equal(iconFor('코어 트레이닝'), '🏋️');
  assert.equal(iconFor('수영(실내)'), '🏊');
  assert.equal(iconFor('알 수 없음'), '🏅');
});
