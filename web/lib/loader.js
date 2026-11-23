// 달 데이터 로더: 중복 요청 합치기, 인증 세대(epoch) 검사, 달별 상태 추적. UI와 분리돼 테스트 가능.
import { fetchRange } from './api.js';
import { fetchRangeFor } from './dates.js';
import { isStale, MONTH_TTL_MS } from './store.js';

/**
 * deps: { fetchFn, apiUrl, store, now?, onUnauthorized(), onChange() }
 * status(ym): 'loading' | 'error' | 'idle'
 */
export function createLoader({ fetchFn, apiUrl, store, now = Date.now, onUnauthorized = () => {}, onChange = () => {} }) {
  const inflight = new Map(); // 'ym|from|to' → Promise. 범위가 다르면 별개 요청이다
  const seqs = new Map();     // ym → 마지막으로 발행한 요청 번호(단조 증가). 최신 요청만 결과를 반영한다
  const failed = new Set();   // 마지막 시도가 실패한 달

  const loadingFor = (ym) => [...inflight.keys()].some((k) => k.startsWith(`${ym}|`));

  function refresh(ym, { force = false, today, ttl = MONTH_TTL_MS } = {}) {
    const { from, to } = fetchRangeFor(ym, today);
    if (!force && !isStale(store.getMonth(ym), now(), ttl, to)) return Promise.resolve();
    const id = `${ym}|${from}|${to}`;
    if (inflight.has(id)) return inflight.get(id);
    const key = store.getKey();
    if (!key) return Promise.resolve();
    const epoch = store.epoch;
    const seq = (seqs.get(ym) || 0) + 1;
    seqs.set(ym, seq);

    const p = (async () => {
      const r = await fetchRange(fetchFn, apiUrl, key, from, to);
      if (store.epoch !== epoch) return 'stale'; // 키가 바뀌거나 지워진 뒤의 옛 응답: 아무것도 건드리지 않는다
      if (seqs.get(ym) !== seq) return 'stale'; // 같은 달의 더 새 요청이 있으면 성공/실패 모두 무시
      if (r.status === 'unauthorized') { onUnauthorized(); return 'unauthorized'; }
      if (r.status === 'ok') {
        store.setMonth(ym, r.workouts, now(), to);
        store.setUpdatedAt(r.updatedAt);
        failed.delete(ym);
        return 'ok';
      }
      failed.add(ym);
      return 'error';
    })().then((res) => {
      if (inflight.get(id) === p) inflight.delete(id); // 같은 키의 새 요청을 지우지 않는다
      if (res !== 'stale') onChange(ym, res);
      return res;
    });
    inflight.set(id, p);
    onChange(ym, 'loading');
    return p;
  }

  return {
    refresh,
    status: (ym) => (loadingFor(ym) ? 'loading' : failed.has(ym) ? 'error' : 'idle'),
    /** 인증이 끝났을 때(키 삭제) 상태 초기화 */
    reset() { failed.clear(); inflight.clear(); },
  };
}
