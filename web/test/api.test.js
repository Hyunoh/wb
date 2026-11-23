import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRange, ping } from '../lib/api.js';

const resp = (body) => async () => ({ json: async () => body });
const W = { user: 'me', type: '요가', start: '2026-11-22T07:00:00+09:00' };

test('fetchRange: ok, 쿼리 구성(옵션 없이 URL만)', async () => {
  let args;
  const f = async (...a) => { args = a; return { json: async () => ({ ok: true, workouts: [W], updated_at: 'x' }) }; };
  const r = await fetchRange(f, 'https://h/exec', 'k&1', '2026-11-01', '2026-11-22');
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.workouts, [W]);
  assert.equal(r.updatedAt, 'x');
  assert.equal(args.length, 1); // 헤더/옵션 없음
  assert.equal(args[0], 'https://h/exec?key=k%261&from=2026-11-01&to=2026-11-22');
});

test('fetchRange: updated_at null 허용', async () => {
  const r = await fetchRange(resp({ ok: true, workouts: [], updated_at: null }), 'u', 'k', 'a', 'b');
  assert.equal(r.status, 'ok');
  assert.equal(r.updatedAt, null);
});

test('fetchRange: unauthorized / server', async () => {
  assert.equal((await fetchRange(resp({ ok: false, error: 'unauthorized' }), 'u', 'k', 'a', 'b')).status, 'unauthorized');
  assert.equal((await fetchRange(resp({ ok: false, error: 'busy' }), 'u', 'k', 'a', 'b')).status, 'server');
});

test('fetchRange: 잘못된 모양', async () => {
  for (const body of [null, 'x', {}, { ok: true }, { ok: true, workouts: {}, updated_at: null },
    { ok: true, workouts: [{ user: 1 }], updated_at: null }, { ok: true, workouts: [], updated_at: 5 }]) {
    assert.equal((await fetchRange(resp(body), 'u', 'k', 'a', 'b')).status, 'bad_shape');
  }
});

test('fetchRange: JSON이 아닌 응답은 bad_shape, 네트워크 오류는 network', async () => {
  const notJson = async () => ({ json: async () => JSON.parse('<html>') });
  assert.equal((await fetchRange(notJson, 'u', 'k', 'a', 'b')).status, 'bad_shape');
  const down = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal((await fetchRange(down, 'u', 'k', 'a', 'b')).status, 'network');
});

test('ping', async () => {
  const r = await ping(resp({ ok: true, updated_at: null }), 'https://h/exec', 'k');
  assert.deepEqual(r, { status: 'ok', updatedAt: null });
  let url;
  await ping(async (u) => { url = u; return { json: async () => ({ ok: true, updated_at: null }) }; }, 'https://h/exec', 'k');
  assert.equal(url, 'https://h/exec?action=ping&key=k');
  assert.equal((await ping(resp({ ok: false, error: 'unauthorized' }), 'u', 'k')).status, 'unauthorized');
  assert.equal((await ping(async () => { throw new Error('x'); }, 'u', 'k')).status, 'network');
  assert.equal((await ping(resp({ ok: true, updated_at: 3 }), 'u', 'k')).status, 'bad_shape');
});
