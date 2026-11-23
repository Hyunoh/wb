const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv, readyEnv, W, HEADERS } = require('./harness');

const post = (env, workouts, user = 'me', token) => env.post({
  token: token === undefined ? env.props[user === 'me' ? 'WRITE_TOKEN_ME' : 'WRITE_TOKEN_WIFE'] : token,
  user, workouts,
});
const getAll = (env, extra = {}) => env.get(Object.assign({
  key: env.props.READ_KEY, from: '2026-01-01', to: '2026-12-31' }, extra));

test('setup: 시트, 헤더, 텍스트 서식, 고정행, 키 생성', () => {
  const env = createEnv();
  env.setup();
  assert.deepEqual(env.sheet().grid[0], HEADERS);
  assert.equal(env.sheet().frozen, 1);
  assert.ok(env.sheet().formats.every((f) => f.f === '@'));
  assert.ok(env.sheet().formats.some((f) => f.col === 1 && f.nc === 5));
  for (const k of ['WRITE_TOKEN_ME', 'WRITE_TOKEN_WIFE', 'READ_KEY']) {
    assert.match(env.props[k], /^[A-Za-z0-9_-]{24,}$/);
  }
  assert.equal(new Set([env.props.WRITE_TOKEN_ME, env.props.WRITE_TOKEN_WIFE, env.props.READ_KEY]).size, 3);
});

test('setup: 멱등, 기존 키/데이터 유지, 누락 키만 생성', () => {
  const env = createEnv({ props: { WRITE_TOKEN_ME: 'keepme-keepme-keepme-keepme-1' } });
  env.setup();
  const wife = env.props.WRITE_TOKEN_WIFE;
  const rk = env.props.READ_KEY;
  post(env, [W()]);
  env.setup();
  env.setup();
  assert.equal(env.props.WRITE_TOKEN_ME, 'keepme-keepme-keepme-keepme-1');
  assert.equal(env.props.WRITE_TOKEN_WIFE, wife);
  assert.equal(env.props.READ_KEY, rk);
  assert.equal(env.sheet().dataRows().length, 1);
});

test('인증 실패: 틀린 토큰, 상대방 토큰, 누락', () => {
  const env = readyEnv();
  assert.deepEqual(post(env, [W()], 'me', 'wrong'), { ok: false, error: 'unauthorized' });
  assert.deepEqual(post(env, [W()], 'me', env.props.WRITE_TOKEN_WIFE), { ok: false, error: 'unauthorized' });
  assert.deepEqual(post(env, [W()], 'wife', env.props.WRITE_TOKEN_ME), { ok: false, error: 'unauthorized' });
  assert.deepEqual(env.post({ user: 'me', workouts: [W()] }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(post(env, [W()], 'me', ''), { ok: false, error: 'unauthorized' });
  assert.equal(env.sheet().dataRows().length, 0);
});

test('setup 전(토큰 미설정)에는 빈 토큰으로도 인증되지 않음', () => {
  const env = createEnv();
  assert.equal(env.post({ token: '', user: 'me', workouts: [] }).error, 'unauthorized');
});

test('bad_request: 알 수 없는 user, 잘못된 JSON, 본문 없음, workouts 누락', () => {
  const env = readyEnv();
  assert.equal(post(env, [W()], 'bob', 'x').error, 'bad_request');
  assert.equal(env.post('{not json').error, 'bad_request');
  assert.equal(env.post('[1,2]').error, 'bad_request');
  assert.equal(env.ctx.doPost({}) .getContent(), '{"ok":false,"error":"bad_request"}');
  assert.equal(env.post({ token: env.props.WRITE_TOKEN_ME, user: 'me' }).error, 'bad_request');
  assert.equal(env.post({ token: env.props.WRITE_TOKEN_ME, user: 'me', workouts: 'x' }).error, 'bad_request');
});

test('too_many: 1000개 초과', () => {
  const env = readyEnv();
  const many = Array.from({ length: 1001 }, () => W());
  assert.equal(post(env, many).error, 'too_many');
  const ok = post(env, Array.from({ length: 1000 }, (_, i) =>
    W({ start: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), end: undefined, duration_min: 10 })));
  assert.equal(ok.inserted, 1000);
});

test('응답은 JSON 마임타입, 토큰을 되돌려주지 않음', () => {
  const env = readyEnv();
  const out = env.ctx.doPost({ postData: { contents: JSON.stringify({ token: 'zzz', user: 'me', workouts: [] }) } });
  assert.equal(out.mime, 'JSON');
  assert.ok(!out.getContent().includes('zzz'));
});

test('숫자 관대 파싱', () => {
  const env = readyEnv();
  const r = post(env, [W({ duration_min: '32.54', active_kcal: '1,204', avg_hr: '142 count/min', max_hr: ' 171.6 ' })]);
  assert.equal(r.inserted, 1);
  const w = getAll(env).workouts[0];
  assert.equal(w.duration_min, 32.5);
  assert.equal(w.active_kcal, 1204);
  assert.equal(w.avg_hr, 142);
  assert.equal(w.max_hr, 172);
  const r2 = post(env, [W({ active_kcal: '310 kcal', avg_hr: '', max_hr: 'abc' })]);
  assert.equal(r2.updated, 1);
  const w2 = getAll(env).workouts[0];
  assert.equal(w2.active_kcal, 310);
  assert.equal(w2.avg_hr, 142); // 빈 값은 기존 측정값을 지우지 않음
  assert.equal(w2.max_hr, 172);
});

test('범위 밖 심박/칼로리는 null, 빈 셀로 저장', () => {
  const env = readyEnv();
  post(env, [W({ avg_hr: 10, max_hr: 300, active_kcal: -5 }),
    W({ start: '2026-11-23T07:00:00+09:00', end: '2026-11-23T08:00:00+09:00', duration_min: undefined, active_kcal: 20000, avg_hr: 10 })]);
  const ws = getAll(env).workouts;
  for (const w of ws) { assert.equal(w.avg_hr, null); assert.equal(w.active_kcal, null); }
  assert.equal(ws[0].max_hr, null);
  assert.equal(env.sheet().dataRows()[0][7], '');
});

test('ISO 정규화: Z, 밀리초, 다른 오프셋, 날짜 넘김', () => {
  const env = readyEnv();
  post(env, [
    W({ start: '2026-11-22T07:05:00Z', end: '2026-11-22T07:35:00Z', duration_min: undefined }),
    W({ start: '2026-11-21T15:30:00.123Z', end: '2026-11-21T16:00:00.999Z', duration_min: undefined }),
    W({ start: '2026-11-22T00:00:00-05:00', end: '2026-11-22T01:00:00-05:00', duration_min: undefined }),
    W({ start: '2026-11-22T07:05+0900', end: '2026-11-22T07:35+09:00', duration_min: undefined }),
  ]);
  const ids = getAll(env).workouts.map((w) => w.id);
  assert.deepEqual(ids, [
    'me_2026-11-22T00:30:00+09:00',
    'me_2026-11-22T07:05:00+09:00',
    'me_2026-11-22T14:00:00+09:00',
    'me_2026-11-22T16:05:00+09:00',
  ]);
  const w = getAll(env).workouts[0];
  assert.equal(w.end, '2026-11-22T01:00:00+09:00'); // 밀리초 버림
  assert.equal(w.duration_min, 30);
});

test('행 거부 사유', () => {
  const env = readyEnv();
  const r = post(env, [
    W({ type: '  ' }),                               // 0 missing_type
    W({ type: 'x'.repeat(61) }),                     // 1 type_too_long
    W({ start: undefined }),                         // 2 missing_start
    W({ start: '2026-11-22 07:05:00' }),             // 3 invalid_start
    W({ start: '2026-11-22T07:05:00' }),             // 4 오프셋 없음
    W({ end: 'yesterday' }),                         // 5 invalid_end
    W({ end: undefined, duration_min: undefined }),  // 6 missing_end_and_duration
    W({ end: '2026-11-22T07:00:00+09:00' }),         // 7 end_before_start
    W({ duration_min: 0 }),                          // 8 invalid_duration
    W({ duration_min: 1441 }),                       // 9 invalid_duration
    W({ end: '2026-11-22T07:05:00+09:00', duration_min: undefined }), // 10 길이 0
    'oops',                                          // 11 not_object
    W({ start: '2026-02-30T07:05:00+09:00' }),       // 12 invalid_start
    W(),                                             // 13 정상
  ]);
  assert.equal(r.inserted, 1);
  assert.deepEqual(r.rejected.map((x) => [x.index, x.reason]), [
    [0, 'missing_type'], [1, 'type_too_long'], [2, 'missing_start'], [3, 'invalid_start'],
    [4, 'invalid_start'], [5, 'invalid_end'], [6, 'missing_end_and_duration'],
    [7, 'end_before_start'], [8, 'invalid_duration'], [9, 'invalid_duration'],
    [10, 'invalid_duration'], [11, 'not_object'], [12, 'invalid_start'],
  ]);
});

test('duration 만 있으면 end 계산, type 은 trim', () => {
  const env = readyEnv();
  post(env, [W({ type: '  요가 ', end: undefined, duration_min: '45' })]);
  const w = getAll(env).workouts[0];
  assert.equal(w.type, '요가');
  assert.equal(w.end, '2026-11-22T07:50:00+09:00');
  assert.equal(w.duration_min, 45);
});

test('멱등 upsert: 같은 페이로드 두 번 → 1행, 두 번째는 updated', () => {
  const env = readyEnv();
  const p = [W(), W({ start: '2026-11-23T07:05:00+09:00', end: '2026-11-23T07:35:00+09:00' })];
  assert.deepEqual(post(env, p), { ok: true, inserted: 2, updated: 0, rejected: [] });
  assert.deepEqual(post(env, p), { ok: true, inserted: 0, updated: 2, rejected: [] });
  assert.equal(env.sheet().dataRows().length, 2);
});

test('upsert 는 값을 덮어쓰고 received_at 을 갱신', () => {
  const env = readyEnv();
  post(env, [W({ active_kcal: 100 })]);
  env.sheet().grid[1][9] = '2000-01-01T00:00:00+09:00';
  post(env, [W({ active_kcal: 250 })]);
  const row = env.sheet().dataRows()[0];
  assert.equal(row[6], 250);
  assert.ok(row[9] > '2020');
  assert.equal(env.sheet().dataRows().length, 1);
});

test('혼합 insert/update, 사용자별 id 분리, 시작 시각 정렬', () => {
  const env = readyEnv();
  post(env, [W({ start: '2026-11-24T07:00:00+09:00', end: '2026-11-24T08:00:00+09:00' })]);
  const r = post(env, [
    W({ start: '2026-11-24T07:00:00+09:00', end: '2026-11-24T08:00:00+09:00' }),
    W({ start: '2026-11-20T07:00:00+09:00', end: '2026-11-20T08:00:00+09:00' }),
    W({ start: '2026-11-22T07:00:00+09:00', end: '2026-11-22T08:00:00+09:00' }),
  ]);
  assert.equal(r.inserted, 2);
  assert.equal(r.updated, 1);
  post(env, [W({ start: '2026-11-22T07:00:00+09:00', end: '2026-11-22T08:00:00+09:00' })], 'wife');
  const starts = env.sheet().dataRows().map((x) => x[3]);
  assert.deepEqual(starts, [...starts].sort());
  assert.equal(env.sheet().dataRows().length, 4);
  assert.equal(new Set(env.sheet().dataRows().map((x) => x[0])).size, 4);
});

test('쓰기는 setValues 한 번(데이터 블록 일괄)', () => {
  const env = readyEnv();
  const before = env.sheet().setValuesCalls;
  post(env, [W(), W({ start: '2026-11-23T07:00:00+09:00', end: '2026-11-23T08:00:00+09:00' })]);
  assert.equal(env.sheet().setValuesCalls - before, 1);
});

test('전부 거부되면 시트 쓰기 없음', () => {
  const env = readyEnv();
  const before = env.sheet().setValuesCalls;
  const r = post(env, [W({ type: '' })]);
  assert.equal(r.inserted, 0);
  assert.equal(env.sheet().setValuesCalls, before);
});

test('시트가 Date 로 자동 변환해 둔 셀도 읽어서 복구', () => {
  const env = readyEnv();
  post(env, [W()]);
  env.sheet().grid[1][3] = new Date('2026-11-21T22:05:00Z'); // = 11-22 07:05 KST
  const w = getAll(env).workouts[0];
  assert.equal(w.start, '2026-11-22T07:05:00+09:00');
});

test('락: 성공/거부 시 해제, 예외 시에도 해제, 타임아웃은 busy', () => {
  const env = readyEnv();
  post(env, [W()]);
  assert.equal(env.state.lockAcquired, 1);
  assert.equal(env.state.lockReleased, 1);

  env.sheet().getRange = () => { throw new Error('boom'); };
  const r = post(env, [W()]);
  assert.deepEqual(r, { ok: false, error: 'server_error' });
  assert.equal(env.state.lockReleased, 2);
  assert.ok(env.logs.some((l) => l.includes('boom')));

  const env2 = readyEnv();
  env2.state.lockTimeout = true;
  assert.deepEqual(post(env2, [W()]), { ok: false, error: 'busy' });
  assert.equal(env2.state.lockReleased, 0);
  assert.equal(env2.sheet().dataRows().length, 0);
});

test('server_error 응답에 스택/토큰 미포함', () => {
  const env = readyEnv();
  env.sheet().getRange = () => { throw new Error('secret-detail'); };
  const out = env.ctx.doPost({ postData: { contents: JSON.stringify({
    token: env.props.WRITE_TOKEN_ME, user: 'me', workouts: [W()] }) } }).getContent();
  assert.equal(out, '{"ok":false,"error":"server_error"}');
});

// ───── GET ─────

test('GET unauthorized: workouts 필드 없음', () => {
  const env = readyEnv();
  post(env, [W()]);
  for (const key of [undefined, '', 'bad', env.props.WRITE_TOKEN_ME]) {
    const r = env.get({ key, from: '2026-11-01', to: '2026-11-30' });
    assert.deepEqual(r, { ok: false, error: 'unauthorized' });
  }
  assert.deepEqual(env.get({ action: 'ping', key: 'bad' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(env.ctx.doGet({}).getContent(), '{"ok":false,"error":"unauthorized"}');
});

test('GET bad_request: 날짜 누락/형식/역순/400일 초과', () => {
  const env = readyEnv();
  const key = env.props.READ_KEY;
  for (const q of [
    {}, { from: '2026-11-01' }, { to: '2026-11-30' },
    { from: '2026/11/01', to: '2026-11-30' }, { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-11-30', to: '2026-11-01' }, { from: '2025-01-01', to: '2026-12-31' },
  ]) {
    assert.deepEqual(env.get({ key, ...q }), { ok: false, error: 'bad_request' }, JSON.stringify(q));
  }
  assert.equal(env.get({ key, from: '2025-11-23', to: '2026-12-27' }).ok, true); // 400일
  assert.equal(env.get({ key, from: '2025-11-22', to: '2026-12-27' }).ok, false); // 401일
});

test('GET 기간 필터: 시작 시각의 서울 날짜 기준, 양끝 포함', () => {
  const env = readyEnv();
  post(env, [
    W({ start: '2026-11-21T23:30:00+09:00', end: '2026-11-22T00:10:00+09:00' }),          // 11-21
    W({ start: '2026-11-21T15:30:00Z', end: '2026-11-21T16:00:00Z' }),                    // 11-22 00:30
    W({ start: '2026-11-22T23:59:59+09:00', end: '2026-11-23T00:30:00+09:00' }),          // 11-22
    W({ start: '2026-11-23T00:00:00+09:00', end: '2026-11-23T00:30:00+09:00' }),          // 11-23
  ]);
  const day = (d) => env.get({ key: env.props.READ_KEY, from: d, to: d }).workouts.map((w) => w.start);
  assert.deepEqual(day('2026-11-21'), ['2026-11-21T23:30:00+09:00']);
  assert.deepEqual(day('2026-11-22'), ['2026-11-22T00:30:00+09:00', '2026-11-22T23:59:59+09:00']);
  assert.equal(env.get({ key: env.props.READ_KEY, from: '2026-11-21', to: '2026-11-22' }).workouts.length, 3);
});

test('GET 응답 형태: 숫자/null, 정렬, 두 사용자, updated_at, server_time', () => {
  const env = readyEnv();
  assert.equal(getAll(env).updated_at, null);
  assert.deepEqual(getAll(env).workouts, []);
  post(env, [W({ start: '2026-11-23T07:00:00+09:00', end: '2026-11-23T08:00:00+09:00', avg_hr: undefined, active_kcal: undefined })]);
  post(env, [W()], 'wife');
  const r = getAll(env);
  assert.equal(r.ok, true);
  assert.deepEqual(r.workouts.map((w) => w.user), ['wife', 'me']);
  assert.deepEqual(Object.keys(r.workouts[0]),
    ['id', 'user', 'type', 'start', 'end', 'duration_min', 'active_kcal', 'avg_hr', 'max_hr']);
  const me = r.workouts[1];
  assert.equal(me.avg_hr, null);
  assert.equal(me.active_kcal, null);
  assert.equal(typeof me.duration_min, 'number');
  assert.equal(typeof r.workouts[0].avg_hr, 'number');
  assert.match(r.server_time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/);
  const max = env.sheet().dataRows().map((x) => x[9]).sort().pop();
  assert.equal(r.updated_at, max);
});

test('updated_at 은 조회 기간과 무관하게 시트 전체의 최댓값', () => {
  const env = readyEnv();
  post(env, [W({ start: '2024-01-01T07:00:00+09:00', end: '2024-01-01T08:00:00+09:00' })]);
  const r = env.get({ key: env.props.READ_KEY, from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(r.workouts, []);
  assert.match(r.updated_at, /^20/);
});

test('ping: 키 검증 후 updated_at 만 반환', () => {
  const env = readyEnv();
  assert.deepEqual(env.get({ key: env.props.READ_KEY, action: 'ping' }), { ok: true, updated_at: null });
  post(env, [W()]);
  const r = env.get({ key: env.props.READ_KEY, action: 'ping' });
  assert.equal(r.ok, true);
  assert.match(r.updated_at, /\+09:00$/);
  assert.equal('workouts' in r, false);
});

test('setup: SPREADSHEET_ID 저장(덮어쓰지 않음), 키 값은 로그에 없음', () => {
  const env = createEnv();
  env.setup();
  assert.equal(env.props.SPREADSHEET_ID, 'SS_ID_1');
  env.props.SPREADSHEET_ID = 'custom';
  env.setup();
  assert.equal(env.props.SPREADSHEET_ID, 'custom');
  const all = env.logs.join('\n');
  for (const k of ['WRITE_TOKEN_ME', 'WRITE_TOKEN_WIFE', 'READ_KEY']) {
    assert.ok(!all.includes(env.props[k]));
  }
  assert.ok(all.includes('WRITE_TOKEN_ME'));
});

test('getSpreadsheet_: ID 있으면 openById, 없으면 활성 스프레드시트', () => {
  const env = readyEnv();
  env.state.activeCalls = 0;
  post(env, [W()]);
  getAll(env);
  assert.ok(env.state.openedIds.length >= 2);
  assert.equal(env.state.openedIds[0], 'SS_ID_1');
  assert.equal(env.state.activeCalls, 0);
  const env2 = readyEnv();
  delete env2.props.SPREADSHEET_ID;
  env2.state.activeCalls = 0;
  post(env2, [W()]);
  assert.equal(env2.state.activeCalls, 1);
});

test('flush 는 락 해제 전에 호출', () => {
  const env = readyEnv();
  post(env, [W()]);
  assert.deepEqual(env.events, ['flush', 'release']);
});

test('type 수식 주입 문자 제거', () => {
  const env = readyEnv();
  const r = post(env, [
    W({ type: '=IMPORTXML("http://x","//a")' }),
    W({ type: '  +cmd', start: '2026-11-23T07:00:00+09:00', end: '2026-11-23T08:00:00+09:00' }),
    W({ type: ' =-+@ ', start: '2026-11-24T07:00:00+09:00', end: '2026-11-24T08:00:00+09:00' }),
  ]);
  assert.deepEqual(r.rejected, [{ index: 2, reason: 'missing_type' }]);
  const t = getAll(env).workouts.map((w) => w.type);
  assert.deepEqual(t, ['IMPORTXML("http://x","//a")', 'cmd']);
});

test('중복 행이 시트에 있어도 upsert 후 1행만 남음', () => {
  const env = readyEnv();
  post(env, [W()]);
  const row = env.sheet().grid[1].slice();
  env.sheet().grid[2] = row.slice();
  assert.equal(env.sheet().dataRows().length, 2);
  post(env, [W({ active_kcal: 999 })]);
  assert.equal(env.sheet().dataRows().length, 1);
  const ws = getAll(env).workouts;
  assert.equal(ws.length, 1);
  assert.equal(ws[0].active_kcal, 999);
});

test('parseNum 엄격: 142-150 → null, 0.04분은 invalid_duration', () => {
  const env = readyEnv();
  const r = post(env, [
    W({ avg_hr: '142-150', max_hr: '1.2.3', active_kcal: '-' }),
    W({ start: '2026-11-23T07:00:00+09:00', end: undefined, duration_min: '0.04' }),
  ]);
  assert.deepEqual(r.rejected, [{ index: 1, reason: 'invalid_duration' }]);
  const w = getAll(env).workouts[0];
  assert.equal(w.avg_hr, null);
  assert.equal(w.max_hr, null);
  assert.equal(w.active_kcal, null);
});

test('id 없이 일부 셀만 채워진 행은 보존, GET 은 무시', () => {
  const env = readyEnv();
  post(env, [W()]);
  env.sheet().grid[2] = ['', '', '수동입력중', '', '', '', '', '', '', ''];
  post(env, [W({ start: '2026-11-25T07:00:00+09:00', end: '2026-11-25T08:00:00+09:00' })]);
  const rows = env.sheet().dataRows();
  assert.equal(rows.length, 3);
  assert.ok(rows.some((r) => r[2] === '수동입력중'));
  assert.equal(rows[2][2], '수동입력중');
  assert.equal(getAll(env).workouts.length, 2);
});

test('duration 경계값', () => {
  const env = readyEnv();
  const mk = (d, n) => W({ start: `2026-11-${10 + n}T00:00:00+09:00`, end: undefined, duration_min: d });
  const r = post(env, [mk(1440, 0), mk(1440.01, 1), mk(0.05, 2), mk(0.04, 3)]);
  assert.deepEqual(r.rejected.map((x) => [x.index, x.reason]),
    [[1, 'invalid_duration'], [3, 'invalid_duration']]);
  const ws = getAll(env).workouts;
  assert.equal(ws[0].duration_min, 1440);
  assert.equal(ws[1].duration_min, 0.1);
});
