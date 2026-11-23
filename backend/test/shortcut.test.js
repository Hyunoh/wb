// iOS 단축어가 실제로 만들어 보내는 형태(모든 값이 문자열, 빈 값은 "")의 본문 회귀 테스트.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readyEnv } = require('./harness');

// 단축어 본문: 값은 전부 문자열이고 duration_min 은 없다.
const S = (o = {}) => Object.assign({
  type: '실외 달리기', start: '2026-11-22T07:05:00+09:00', end: '2026-11-22T07:37:30+09:00',
  active_kcal: '310.4', avg_hr: '142.3', max_hr: '171',
}, o);

const send = (env, workouts) => env.post(
  JSON.stringify({ token: env.props.WRITE_TOKEN_ME, user: 'me', workouts }));
const all = (env) => env.get({ key: env.props.READ_KEY, from: '2026-01-01', to: '2026-12-31' }).workouts;

test('단축어 형태: 문자열 값, 소수, 한글 종류, duration 서버 계산', () => {
  const env = readyEnv();
  const r = send(env, [S()]);
  assert.deepEqual(r, { ok: true, inserted: 1, updated: 0, rejected: [] });
  const [w] = all(env);
  assert.equal(w.type, '실외 달리기');
  assert.equal(w.start, '2026-11-22T07:05:00+09:00');
  assert.equal(w.end, '2026-11-22T07:37:30+09:00');
  assert.equal(w.duration_min, 32.5);
  assert.equal(w.active_kcal, 310);
  assert.equal(w.avg_hr, 142);
  assert.equal(w.max_hr, 171);
});

test('단축어 형태: 칼로리/심박이 빈 문자열이면 null 로 저장', () => {
  const env = readyEnv();
  const r = send(env, [S({ type: '요가', active_kcal: '', avg_hr: '', max_hr: '' })]);
  assert.equal(r.inserted, 1);
  const [w] = all(env);
  assert.equal(w.active_kcal, null);
  assert.equal(w.avg_hr, null);
  assert.equal(w.max_hr, null);
  assert.equal(w.type, '요가');
});

test('단축어 형태: 일부 항목 start 불량은 거부, 나머지는 저장, 재전송 시 전부 updated', () => {
  const env = readyEnv();
  const batch = [
    S({ start: '2026-11-20T06:00:00+09:00', end: '2026-11-20T06:30:00+09:00', type: '걷기' }),
    S({ start: '2026-11-21 07:05', end: '2026-11-21T07:37:30+09:00' }), // 오프셋/T 없음
    S({ start: '2026-11-22T07:05:00+09:00', active_kcal: '', avg_hr: '' }),
    S({ start: '', type: '수영' }),
  ];
  const r1 = send(env, batch);
  assert.deepEqual(r1, { ok: true, inserted: 2, updated: 0, rejected: [
    { index: 1, reason: 'invalid_start' }, { index: 3, reason: 'missing_start' }] });
  assert.equal(all(env).length, 2);
  const r2 = send(env, batch);
  assert.equal(r2.inserted, 0);
  assert.equal(r2.updated, 2);
  assert.equal(r2.rejected.length, 2);
  assert.equal(all(env).length, 2);
});

test('단축어 형태: 심박/칼로리가 나중에 채워지면 같은 행이 갱신됨', () => {
  const env = readyEnv();
  send(env, [S({ active_kcal: '', avg_hr: '', max_hr: '' })]);
  const r = send(env, [S()]);
  assert.equal(r.updated, 1);
  const ws = all(env);
  assert.equal(ws.length, 1);
  assert.equal(ws[0].avg_hr, 142);
});

// ───── B1: 갱신 시 측정값 보존 ─────
test('B1: 전체 값 저장 후 빈 문자열로 재전송하면 값 유지, 새 숫자면 덮어씀', () => {
  const env = readyEnv();
  send(env, [S()]);
  const r = send(env, [S({ active_kcal: '', avg_hr: '', max_hr: '' })]);
  assert.equal(r.updated, 1);
  let [w] = all(env);
  assert.deepEqual([w.active_kcal, w.avg_hr, w.max_hr], [310, 142, 171]);
  send(env, [S({ active_kcal: '400', avg_hr: '150', max_hr: '180' })]);
  [w] = all(env);
  assert.deepEqual([w.active_kcal, w.avg_hr, w.max_hr], [400, 150, 180]);
});

test('B1: 범위 밖/해석 불가 값도 기존 값을 지우지 않음', () => {
  const env = readyEnv();
  send(env, [S()]);
  send(env, [S({ avg_hr: '999', max_hr: 'abc' })]);
  const [w] = all(env);
  assert.equal(w.avg_hr, 142);
  assert.equal(w.max_hr, 171);
});

// ───── B2: first_received_at ─────
test('B2: 삽입 시 두 시각 설정, 갱신 시 received_at 만 변경', () => {
  const env = readyEnv();
  send(env, [S()]);
  const row1 = env.sheet().dataRows()[0].slice();
  assert.ok(row1[9] && row1[10]);
  assert.equal(row1[9], row1[10]);
  const vm = require('node:vm'); const D = vm.runInContext('Date', env.ctx); const realNow = D.now;
  D.now = () => realNow() + 5000;
  try { send(env, [S()]); } finally { D.now = realNow; }
  const row2 = env.sheet().dataRows()[0];
  assert.equal(row2[10], row1[10]);
  assert.notEqual(row2[9], row1[9]);
});

test('B2: 10열 구 시트는 헤더가 추가되고, 기존 행 first_received_at 은 빈 채 유지', () => {
  const env = readyEnv();
  const sh = env.sheet();
  // 구 시트 흉내: 11열 헤더 제거, 기존 행 1개(11열 없음)
  sh.grid[0].length = 10;
  sh.grid[1] = ['me_2026-11-20T06:00:00+09:00', 'me', '걷기', '2026-11-20T06:00:00+09:00',
    '2026-11-20T06:30:00+09:00', 30, 100, 110, 130, '2026-11-20T07:00:00+09:00'];
  sh.maxCols = 10;
  const r = send(env, [S(), S({ start: '2026-11-20T06:00:00+09:00', end: '2026-11-20T06:30:00+09:00', type: '걷기', active_kcal: '', avg_hr: '', max_hr: '' })]);
  assert.deepEqual([r.inserted, r.updated], [1, 1]);
  assert.equal(sh.grid[0][10], 'first_received_at');
  assert.ok(sh.maxCols >= 11);
  assert.ok(sh.formats.some((f) => f.col === 11 && f.f === '@'));
  const rows = sh.dataRows();
  assert.equal(rows[0][10], '');            // 구 행: 알 수 없음
  assert.equal(rows[0][6], 100);            // 측정값 보존
  assert.ok(rows[1][10]);                   // 새 행
  assert.equal(all(env).length, 2);
});

test('B2: id 없는 수동 입력 행은 11열에서도 보존', () => {
  const env = readyEnv();
  env.sheet().grid[1] = ['', '', '수동입력중', '', '', '', '', '', '', '', ''];
  send(env, [S()]);
  const rows = env.sheet().dataRows();
  assert.equal(rows.length, 2);
  assert.equal(rows[1][2], '수동입력중');
});

// ───── B3: 쉼표 규칙 ─────
test('B3: 쉼표는 천 단위 구분만 허용', () => {
  const env = readyEnv();
  const run = (k, h) => {
    send(env, [S({ start: `2026-10-${10 + run.n++}T06:00:00+09:00`, end: `2026-10-${10 + run.n - 1}T07:00:00+09:00`, active_kcal: k, avg_hr: h, max_hr: '' })]);
    return env.sheet().dataRows().find((r) => r[3] === `2026-10-${10 + run.n - 1}T06:00:00+09:00`);
  };
  run.n = 0;
  assert.equal(run('1,204', '142 count/min')[6], 1204);
  assert.equal(run('310 kcal', '1,204.5')[6], 310);
  assert.equal(run('310,4', '')[6], '');
  assert.equal(run('1.204,5', '')[6], '');
  assert.equal(run('12,34', '')[6], '');
  assert.equal(run('1,204,567', '')[6], ''); // 범위(0..10000) 밖 -> 빈칸
});
