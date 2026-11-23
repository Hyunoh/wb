import test from 'node:test';
import assert from 'node:assert/strict';
import { seoulToday, monthGrid, fetchRangeFor, addDays, addMonths, weekday } from '../lib/dates.js';

test('seoulToday: UTC 15:00 이후는 서울에서 다음 날', () => {
  assert.equal(seoulToday(new Date('2026-11-21T14:59:59Z')), '2026-11-21');
  assert.equal(seoulToday(new Date('2026-11-21T15:00:00Z')), '2026-11-22');
  assert.equal(seoulToday(new Date('2026-12-31T16:00:00Z')), '2027-01-01');
});

test('addDays / addMonths / weekday', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(weekday('2026-11-22'), 0); // 일요일
});

test('monthGrid: 2026-11은 5주, 일요일 시작(10/25)~토요일 끝(11/28 아님 12/5)', () => {
  const g = monthGrid('2026-11'); // 11/1은 일요일, 30일 -> 5주
  assert.equal(g.rows, 5);
  assert.equal(g.from, '2026-11-01');
  assert.equal(g.to, '2026-12-05');
  assert.equal(g.cells.length, 35);
  assert.equal(g.cells[0].sunday, true);
  assert.equal(g.cells[0].out, false);
  assert.equal(g.cells[30].out, true);
});

test('monthGrid: 2026-08은 6주(8/1 토요일), 앞뒤 이웃 달 포함', () => {
  const g = monthGrid('2026-08');
  assert.equal(g.rows, 6);
  assert.equal(g.from, '2026-07-26');
  assert.equal(g.to, '2026-09-05');
  assert.equal(g.cells[0].out, true);
  assert.equal(g.cells[6].date, '2026-08-01');
  assert.equal(g.cells[6].out, false);
});

test('monthGrid: 2026-02(28일, 일요일 시작)은 4주', () => {
  const g = monthGrid('2026-02');
  assert.equal(g.rows, 4);
  assert.equal(g.from, '2026-02-01');
  assert.equal(g.to, '2026-02-28');
});

test('fetchRangeFor: 오늘까지로 자른다', () => {
  assert.deepEqual(fetchRangeFor('2026-11', '2026-11-22'), { from: '2026-11-01', to: '2026-11-22' });
  assert.deepEqual(fetchRangeFor('2026-08', '2026-11-22'), { from: '2026-07-26', to: '2026-09-05' });
});
