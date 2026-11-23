import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
import { createLoader } from '../lib/loader.js';
import { rolloverYm } from '../lib/dates.js';
import { hrHTML } from '../lib/format.js';

const mem = () => { const m = new Map(); return { get length() { return m.size; }, key: (i) => [...m.keys()][i], getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const W = { user: 'me', type: '요가', start: '2026-11-02T07:00:00+09:00' };
const okBody = (ws = [W]) => ({ ok: true, workouts: ws, updated_at: '2026-11-22T07:00:00+09:00' });

/** 응답을 수동으로 풀어 줄 수 있는 fetch */
function manualFetch() {
  const calls = [];
  const fn = (url) => new Promise((resolve) => calls.push({ url, resolve: (body) => resolve({ json: async () => body }) }));
  return { fn, calls };
}
const tick = () => new Promise((r) => setImmediate(r));

function setup() {
  const store = createStore(mem());
  store.setKey('k');
  const f = manualFetch();
  const events = [];
  let unauth = 0;
  const loader = createLoader({
    fetchFn: f.fn, apiUrl: 'https://h/exec', store,
    onUnauthorized: () => { unauth++; store.clearAll(); },
    onChange: (ym, s) => events.push([ym, s]),
  });
  return { store, f, loader, events, unauth: () => unauth };
}

test('(a) unauthorized 뒤 도착한 옛 epoch 응답은 캐시/상태를 건드리지 않는다', async () => {
  const { store, f, loader, events, unauth } = setup();
  const p1 = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  const p2 = loader.refresh('2026-10', { force: true, today: '2026-11-22' });
  f.calls[0].resolve({ ok: false, error: 'unauthorized' });
  await p1;
  assert.equal(unauth(), 1);
  events.length = 0;
  f.calls[1].resolve(okBody()); // 키가 지워진 뒤 늦게 도착
  await p2;
  assert.equal(store.getMonth('2026-10'), null);
  assert.equal(store.getUpdatedAt(), undefined);
  assert.equal(store.getKey(), '');
  assert.deepEqual(events, []);
});

test('(b) 자정: 22일까지의 진행 중 요청이 23일까지 요청을 대신하지 않는다', async () => {
  const { f, loader } = setup();
  const p1 = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  const p2 = loader.refresh('2026-11', { force: true, today: '2026-11-23' });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /to=2026-11-22/);
  assert.match(f.calls[1].url, /to=2026-11-23/);
  // 같은 범위는 합쳐진다
  loader.refresh('2026-11', { force: true, today: '2026-11-23' });
  assert.equal(f.calls.length, 2);
  f.calls[0].resolve(okBody()); f.calls[1].resolve(okBody());
  await Promise.all([p1, p2]);
});

test('(b) 자정: 캐시의 to가 이르면 비강제 갱신도 다시 받는다', async () => {
  const { f, loader } = setup();
  const p = loader.refresh('2026-11', { today: '2026-11-22' });
  f.calls[0].resolve(okBody()); await p;
  loader.refresh('2026-11', { today: '2026-11-22' }); // 신선 → 요청 없음
  assert.equal(f.calls.length, 1);
  loader.refresh('2026-11', { today: '2026-11-23' }); // 범위 확장 → 요청
  assert.equal(f.calls.length, 2);
});

test('(b) 월 롤오버: 이전 현재 달을 보던 중이면 새 현재 달로', () => {
  assert.equal(rolloverYm('2026-11', '2026-11-30', '2026-12-01'), '2026-12');
  assert.equal(rolloverYm('2026-10', '2026-11-30', '2026-12-01'), '2026-10'); // 과거 달은 유지
  assert.equal(rolloverYm('2026-11', '2026-11-22', '2026-11-23'), '2026-11');
});

test('(c) 다른 달의 늦은 응답은 현재 달 상태를 바꾸지 않는다', async () => {
  const { store, f, loader } = setup();
  const pOld = loader.refresh('2026-10', { force: true, today: '2026-11-22' });
  const pCur = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  assert.equal(loader.status('2026-11'), 'loading');
  f.calls[0].resolve({ ok: false, error: 'busy' }); // 10월 실패
  await pOld;
  assert.equal(loader.status('2026-10'), 'error');
  assert.equal(loader.status('2026-11'), 'loading'); // 현재 달은 그대로
  f.calls[1].resolve(okBody());
  await pCur;
  assert.equal(loader.status('2026-11'), 'idle');
  assert.equal(store.getMonth('2026-11').workouts.length, 1);
  // 현재 달이 먼저 끝나고 다른 달이 늦게 성공해도 현재 달 상태는 그대로, 캐시는 갱신
  const pErr = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  const pLate = loader.refresh('2026-10', { force: true, today: '2026-11-22' });
  f.calls[2].resolve({ ok: false, error: 'busy' }); await pErr;
  assert.equal(loader.status('2026-11'), 'error');
  f.calls[3].resolve(okBody()); await pLate;
  assert.equal(loader.status('2026-11'), 'error');
  assert.equal(loader.status('2026-10'), 'idle');
  assert.ok(store.getMonth('2026-10'));
});

test('(d) 심박 표시: 평균만 / 최고만 / 없음', () => {
  const both = hrHTML(142, 171);
  assert.ok(both.includes('♥ 평균') && both.includes('142') && both.includes('최고') && both.includes('171'));
  const avgOnly = hrHTML(142, null);
  assert.ok(avgOnly.includes('142') && !avgOnly.includes('최고') && !avgOnly.includes('심박 없음'));
  const maxOnly = hrHTML(null, 171);
  assert.ok(maxOnly.includes('최고') && maxOnly.includes('171') && !maxOnly.includes('평균') && !maxOnly.includes('심박 없음'));
  assert.ok(hrHTML(null, null).includes('심박 없음'));
});

test('(r2-1a) 최신(to=23) 먼저 성공, 옛(to=22) 나중 성공 → 최신 데이터 유지', async () => {
  const { store, f, loader } = setup();
  const pOld = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  const pNew = loader.refresh('2026-11', { force: true, today: '2026-11-23' });
  f.calls[1].resolve(okBody([{ ...W, type: '새것' }])); await pNew;
  f.calls[0].resolve(okBody([{ ...W, type: '옛것' }])); await pOld;
  const e = store.getMonth('2026-11');
  assert.equal(e.to, '2026-11-23');
  assert.equal(e.workouts[0].type, '새것');
});

test('(r2-1b) 최신 성공 뒤 옛 요청 실패 → 상태는 정상', async () => {
  const { f, loader } = setup();
  const pOld = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  const pNew = loader.refresh('2026-11', { force: true, today: '2026-11-23' });
  f.calls[1].resolve(okBody()); await pNew;
  f.calls[0].resolve({ ok: false, error: 'busy' }); await pOld;
  assert.equal(loader.status('2026-11'), 'idle');
});

test('(r2-1c) 최신 실패 뒤 옛 요청 성공 → 상태는 오류 유지, 캐시 불변', async () => {
  const { store, f, loader } = setup();
  const pOld = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  const pNew = loader.refresh('2026-11', { force: true, today: '2026-11-23' });
  f.calls[1].resolve({ ok: false, error: 'busy' }); await pNew;
  f.calls[0].resolve(okBody()); await pOld;
  assert.equal(loader.status('2026-11'), 'error');
  assert.equal(store.getMonth('2026-11'), null);
});

test('(r2-2) 옛 epoch 요청이 끝나도 같은 키의 새 in-flight를 지우지 않는다', async () => {
  const { store, f, loader } = setup();
  const pOld = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  store.clearAll(); loader.reset(); store.setKey('k2');
  const pNew = loader.refresh('2026-11', { force: true, today: '2026-11-22' });
  assert.equal(f.calls.length, 2);
  f.calls[0].resolve(okBody()); await pOld;
  loader.refresh('2026-11', { force: true, today: '2026-11-22' }); // 여전히 합쳐져야 한다
  assert.equal(f.calls.length, 2);
  assert.equal(loader.status('2026-11'), 'loading');
  f.calls[1].resolve(okBody()); await pNew;
});

test('(r2-3) 격자 밖 날짜 판정', async () => {
  const { inGrid } = await import('../lib/dates.js');
  assert.equal(inGrid('2026-12', '2026-11-30'), true);  // 앞쪽 이웃 날짜
  assert.equal(inGrid('2026-12', '2026-11-22'), false);
});

test('(r2-4) localStorage getter가 던져도 메모리로 동작', async () => {
  const { safeLocalStorage } = await import('../lib/store.js');
  const ls = safeLocalStorage({ get localStorage() { throw new Error('SecurityError'); } });
  const st = createStore(ls);
  assert.equal(st.getKey(), '');
  st.setKey('abc');
  assert.equal(st.getKey(), 'abc');
  st.setMonth('2026-11', [], 1);
  assert.ok(st.getMonth('2026-11'));
  st.clearAll();
  assert.equal(st.getKey(), '');
});
