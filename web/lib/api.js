// API 클라이언트. fetch는 주입 가능(테스트). 커스텀 헤더 없는 평범한 GET만 쓴다(프리플라이트 방지).
// 결과: { status: 'ok' | 'unauthorized' | 'bad_shape' | 'server' | 'network', ... }

function buildUrl(base, params) {
  return `${base}?${new URLSearchParams(params).toString()}`;
}

async function call(fetchFn, url) {
  let data;
  try {
    const res = await fetchFn(url);
    data = await res.json();
  } catch (e) {
    // 네트워크 실패와 JSON이 아닌 응답(HTML 오류 페이지 등)을 구분한다
    return { status: e instanceof SyntaxError ? 'bad_shape' : 'network' };
  }
  if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') return { status: 'bad_shape' };
  if (!data.ok) return { status: data.error === 'unauthorized' ? 'unauthorized' : 'server', error: String(data.error) };
  return { status: 'ok', data };
}

const validWorkout = (w) => w && typeof w === 'object' && typeof w.user === 'string'
  && typeof w.type === 'string' && typeof w.start === 'string';

/** 기간 조회 */
export async function fetchRange(fetchFn, apiUrl, key, from, to) {
  const r = await call(fetchFn, buildUrl(apiUrl, { key, from, to }));
  if (r.status !== 'ok') return r;
  const { workouts, updated_at: updatedAt } = r.data;
  if (!Array.isArray(workouts) || !workouts.every(validWorkout)
    || !(updatedAt === null || typeof updatedAt === 'string')) return { status: 'bad_shape' };
  return { status: 'ok', workouts, updatedAt };
}

/** 키 검증 및 신선도 확인 */
export async function ping(fetchFn, apiUrl, key) {
  const r = await call(fetchFn, buildUrl(apiUrl, { action: 'ping', key }));
  if (r.status !== 'ok') return r;
  const u = r.data.updated_at;
  if (!(u === null || typeof u === 'string')) return { status: 'bad_shape' };
  return { status: 'ok', updatedAt: u };
}
