// localStorage 래퍼. storage는 주입 가능(테스트).
// 모든 접근을 try/catch로 감싸고, 쓴 값은 메모리에도 둔다(저장이 막힌 환경에서도 세션 동안은 동작).

export const KEY_NAME = 'wb.key';
export const UPDATED_NAME = 'wb.updated_at';
export const MONTH_PREFIX = 'wb.m.';
export const MONTH_TTL_MS = 5 * 60 * 1000; // 달 캐시 유효 시간
export const VISIBLE_TTL_MS = 60 * 1000;   // 앱이 다시 보일 때 갱신 기준

export function createStore(storage) {
  const get = (k) => { try { return storage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { storage.setItem(k, v); return true; } catch { return false; } };
  const del = (k) => { try { storage.removeItem(k); } catch { /* 무시 */ } };

  // 메모리 사본. wiped=true면 clearAll 이후라 저장소의 남은 값을 다시 읽지 않는다
  const mem = { key: null, months: new Map(), updated: undefined, wiped: false };
  let epoch = 0; // 키가 설정/삭제될 때마다 증가. 요청은 시작 시점의 값을 들고 있다가 달라졌으면 응답을 버린다

  const parseMonth = (raw) => {
    try {
      const e = JSON.parse(raw);
      if (e && typeof e.fetchedAt === 'number' && Array.isArray(e.workouts)) return e;
    } catch { /* 손상된 캐시는 없는 것으로 */ }
    return null;
  };

  return {
    get epoch() { return epoch; },

    getKey() {
      if (mem.key !== null) return mem.key;
      if (mem.wiped) return '';
      const k = get(KEY_NAME) || '';
      mem.key = k;
      return k;
    },
    /** 저장 성공 여부를 반환(실패해도 메모리에는 유지) */
    setKey(k) {
      if (k !== this.getKey()) epoch++;
      mem.key = k;
      return set(KEY_NAME, k);
    },

    /** 캐시된 달: { fetchedAt, workouts, to? } 또는 null */
    getMonth(ym) {
      if (mem.months.has(ym)) return mem.months.get(ym);
      if (mem.wiped) return null;
      const e = parseMonth(get(MONTH_PREFIX + ym));
      if (e) mem.months.set(ym, e);
      return e;
    },
    /** to: 이 응답이 커버한 마지막 날짜(오늘로 잘린 값) */
    setMonth(ym, workouts, now = Date.now(), to = null) {
      const e = { fetchedAt: now, workouts, to };
      mem.months.set(ym, e);
      return set(MONTH_PREFIX + ym, JSON.stringify(e));
    },

    /** updated_at은 null도 유효한 값이라 {v}로 감싼다. 없으면 undefined */
    getUpdatedAt() {
      if (mem.updated !== undefined) return mem.updated;
      if (mem.wiped) return undefined;
      try {
        const o = JSON.parse(get(UPDATED_NAME));
        if (o && 'v' in o && (o.v === null || typeof o.v === 'string')) return o.v;
      } catch { /* 무시 */ }
      return undefined;
    },
    setUpdatedAt(v) { mem.updated = v; return set(UPDATED_NAME, JSON.stringify({ v })); },

    /** 키와 모든 캐시 삭제(저장소 + 메모리) */
    clearAll() {
      epoch++;
      mem.key = ''; mem.months.clear(); mem.updated = undefined; mem.wiped = true;
      try {
        const names = [];
        for (let i = 0; i < storage.length; i++) names.push(storage.key(i));
        for (const n of names) if (n && (n === KEY_NAME || n === UPDATED_NAME || n.startsWith(MONTH_PREFIX))) del(n);
      } catch { /* 무시 */ }
    },
  };
}

/** 캐시가 없거나 ttl보다 오래됐거나, 커버한 마지막 날짜(to)가 지금 필요한 requiredTo보다 이르면 true */
export function isStale(entry, now, ttl, requiredTo = null) {
  if (!entry || now - entry.fetchedAt > ttl) return true;
  return !!requiredTo && (!entry.to || entry.to < requiredTo);
}

/** 메모리만 쓰는 storage (localStorage를 못 쓸 때의 대체) */
export function memoryStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** window.localStorage 접근 자체가 SecurityError를 던질 수 있어 getter까지 감싼다 */
export function safeLocalStorage(win = globalThis) {
  try {
    const ls = win.localStorage;
    if (ls) return ls;
  } catch { /* 차단됨 */ }
  return memoryStorage();
}
