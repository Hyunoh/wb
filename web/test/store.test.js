import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, isStale, MONTH_TTL_MS } from '../lib/store.js';

function fakeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
}

test('월 캐시 읽기/쓰기', () => {
  const st = createStore(fakeStorage());
  assert.equal(st.getMonth('2026-11'), null);
  st.setMonth('2026-11', [{ id: 1 }], 1000);
  assert.deepEqual(st.getMonth('2026-11'), { fetchedAt: 1000, workouts: [{ id: 1 }], to: null });
});

test('손상된 캐시는 null', () => {
  const s = fakeStorage();
  s.setItem('wb.m.2026-11', '{oops');
  assert.equal(createStore(s).getMonth('2026-11'), null);
  s.setItem('wb.m.2026-10', '{"fetchedAt":"x","workouts":[]}');
  assert.equal(createStore(s).getMonth('2026-10'), null);
});

test('만료 판정', () => {
  const e = { fetchedAt: 0, workouts: [] };
  assert.equal(isStale(null, 0, MONTH_TTL_MS), true);
  assert.equal(isStale(e, MONTH_TTL_MS, MONTH_TTL_MS), false);
  assert.equal(isStale(e, MONTH_TTL_MS + 1, MONTH_TTL_MS), true);
  assert.equal(isStale(e, 61000, 60000), true);
  assert.equal(isStale({ ...e, to: '2026-11-22' }, 1, MONTH_TTL_MS, '2026-11-23'), true); // 자정 이후 범위 확장
  assert.equal(isStale({ ...e, to: '2026-11-23' }, 1, MONTH_TTL_MS, '2026-11-23'), false);
  assert.equal(isStale(e, 1, MONTH_TTL_MS, '2026-11-23'), true); // to 없는 옛 캐시
});

test('updated_at: undefined / null / 문자열 구분', () => {
  const st = createStore(fakeStorage());
  assert.equal(st.getUpdatedAt(), undefined);
  st.setUpdatedAt(null);
  assert.equal(st.getUpdatedAt(), null);
  st.setUpdatedAt('2026-11-22T07:40:12+09:00');
  assert.equal(st.getUpdatedAt(), '2026-11-22T07:40:12+09:00');
});

test('clearAll: 키와 캐시만 지우고 다른 항목은 둔다', () => {
  const s = fakeStorage();
  const st = createStore(s);
  st.setKey('k'); st.setMonth('2026-11', []); st.setUpdatedAt(null);
  s.setItem('other', '1');
  assert.equal(st.getKey(), 'k');
  st.clearAll();
  assert.equal(st.getKey(), '');
  assert.equal(st.getMonth('2026-11'), null);
  assert.equal(s.getItem('other'), '1');
  assert.equal(s._m.size, 1);
});

test('storage가 예외를 던져도 죽지 않는다', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); }, length: 0, key: () => null };
  const st = createStore(bad);
  assert.equal(st.getKey(), '');
  assert.equal(st.getMonth('2026-11'), null);
  assert.equal(st.setKey('a'), false); // 저장 실패를 알린다
  st.setMonth('2026-11', [1], 5);
  assert.equal(st.getKey(), 'a');      // 그래도 메모리로 세션 동안 동작
  assert.deepEqual(st.getMonth('2026-11').workouts, [1]);
  st.clearAll();
  assert.equal(st.getKey(), '');
});

test('epoch: 키 설정/삭제 때 증가', () => {
  const st = createStore(fakeStorage());
  const e0 = st.epoch;
  st.setKey('a');
  assert.ok(st.epoch > e0);
  const e1 = st.epoch;
  st.clearAll();
  assert.ok(st.epoch > e1);
});
