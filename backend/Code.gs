/**
 * workoutBoard 백엔드 (Google Apps Script, 컨테이너 바인딩, V8)
 *
 * - doPost: iOS 단축어가 보낸 운동 목록을 검증하고 시트에 upsert
 * - doGet : 대시보드가 기간별 운동 목록을 조회 (또는 action=ping 으로 신선도 확인)
 * - setup(): 최초 1회 실행. 시트/헤더/서식 생성 + 키 자동 생성(기존 키는 절대 덮어쓰지 않음)
 *
 * 키(쓰기 토큰, 읽기 키)는 코드에 넣지 않고 스크립트 속성(Script Properties)에만 둔다.
 * 시간대는 Asia/Seoul(+09:00, DST 없음) 고정이다.
 */

var SHEET_NAME = 'workouts';
var HEADERS = ['id', 'user', 'type', 'start', 'end', 'duration_min',
  'active_kcal', 'avg_hr', 'max_hr', 'received_at', 'first_received_at'];
var NUM_COLS = HEADERS.length;
var USERS = { me: 'WRITE_TOKEN_ME', wife: 'WRITE_TOKEN_WIFE' };
var READ_KEY_PROP = 'READ_KEY';
var SS_ID_PROP = 'SPREADSHEET_ID';

var MAX_WORKOUTS = 1000;         // 요청 1건당 최대 운동 수
var MAX_RANGE_DAYS = 400;        // GET 기간 최대(시작·끝 날짜 포함 일수)
var MAX_DURATION_MIN = 24 * 60;
var LOCK_WAIT_MS = 20000;
var KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ───────────────────────── 설정 ─────────────────────────

/** 최초 1회 수동 실행. 여러 번 실행해도 안전하다(멱등). */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss);

  var props = PropertiesService.getScriptProperties();
  // 웹앱 실행 컨텍스트에서는 getActiveSpreadsheet 가 불안정하므로 ID 를 저장해 둔다.
  if (!props.getProperty(SS_ID_PROP)) {
    props.setProperty(SS_ID_PROP, ss.getId());
    Logger.log('저장됨 ' + SS_ID_PROP);
  } else {
    Logger.log('이미 있음 ' + SS_ID_PROP + ' (유지)');
  }
  var names = [USERS.me, USERS.wife, READ_KEY_PROP];
  for (var i = 0; i < names.length; i++) {
    var existing = props.getProperty(names[i]);
    if (!existing) {
      props.setProperty(names[i], generateKey_());
      Logger.log('생성됨 ' + names[i] + ' (값은 프로젝트 설정 > 스크립트 속성에서 확인)');
    } else {
      Logger.log('이미 있음 ' + names[i] + ' (유지)');
    }
  }
  Logger.log('setup 완료');
}

/** 저장된 ID 로 스프레드시트를 열고, 없으면 활성 스프레드시트로 대체한다. */
function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(SS_ID_PROP);
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** workouts 시트가 없으면 만들고 헤더/서식/고정행을 설정한다. */
function ensureSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) return upgradeSheet_(sheet);
  sheet = ss.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, NUM_COLS).setValues([HEADERS]);
  // 문자열 컬럼은 텍스트 서식(@)으로 고정해 시트가 날짜로 자동 변환하지 못하게 한다.
  var maxRows = sheet.getMaxRows();
  sheet.getRange(1, 1, maxRows, 5).setNumberFormat('@');   // id..end
  sheet.getRange(1, 10, maxRows, 2).setNumberFormat('@');  // received_at, first_received_at
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * 예전 10열 시트에 first_received_at 헤더(11열)가 없으면 추가한다.
 * 기존 행의 first_received_at 은 알 수 없으므로 비워 둔다(received_at 으로 채우지 않음).
 */
function upgradeSheet_(sheet) {
  var hdr = sheet.getRange(1, NUM_COLS, 1, 1).getValues()[0][0];
  if (hdr === HEADERS[NUM_COLS - 1]) return sheet;
  if (sheet.getMaxColumns() < NUM_COLS) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), NUM_COLS - sheet.getMaxColumns());
  }
  sheet.getRange(1, NUM_COLS, 1, 1).setValues([[HEADERS[NUM_COLS - 1]]]);
  sheet.getRange(1, NUM_COLS, sheet.getMaxRows(), 1).setNumberFormat('@');
  return sheet;
}

function generateKey_() {
  var raw = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  return raw.substring(0, 40); // 16진수 40자: URL 안전
}

// ───────────────────────── 응답 헬퍼 ─────────────────────────

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(code) {
  return json_({ ok: false, error: code });
}

/** 길이가 달라도 끝까지 비교하는 상수 시간 근사 비교. */
function safeEqual_(a, b) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0 && b.length > 0;
}

// ───────────────────────── 파싱 헬퍼 ─────────────────────────

/** 단축어의 지저분한 숫자("1,204", "142 count/min", "310 kcal")를 숫자로. 실패 시 null. */
function parseNum_(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).replace(/[^0-9.,\-]/g, '');
  if (s === '') return null;
  if (s.indexOf(',') >= 0) {
    // 쉼표는 천 단위 구분으로만 허용: "1,204"(O), "310,4" / "1.204,5"(X)
    if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  var n = Number(s); // 전체가 숫자여야 함: "142-150" → NaN → null
  return isFinite(n) ? n : null;
}

var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** ISO 8601(오프셋 또는 Z 필수) 문자열 → epoch ms. 형식이 틀리면 null. */
function parseIso_(v) {
  if (typeof v !== 'string') return null;
  var m = ISO_RE.exec(v.trim());
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  var local = Date.UTC(y, mo - 1, d, h, mi, s);
  var chk = new Date(local);
  if (chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null; // 2월 30일 등
  var offMin = 0;
  if (m[7] !== 'Z') {
    var sign = m[7].charAt(0) === '-' ? -1 : 1;
    var digits = m[7].substring(1).replace(':', '');
    var oh = +digits.substring(0, 2), om = +digits.substring(2, 4);
    if (oh > 23 || om > 59) return null;
    offMin = sign * (oh * 60 + om);
  }
  return local - offMin * 60000;
}

function pad_(n, w) {
  var s = String(n);
  while (s.length < (w || 2)) s = '0' + s;
  return s;
}

/** epoch ms → 'yyyy-MM-ddTHH:mm:ss+09:00' (Asia/Seoul). */
function formatKst_(ms) {
  var d = new Date(Math.floor(ms / 1000) * 1000 + KST_OFFSET_MS);
  return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate()) +
    'T' + pad_(d.getUTCHours()) + ':' + pad_(d.getUTCMinutes()) + ':' + pad_(d.getUTCSeconds()) +
    '+09:00';
}

/** 셀 값을 문자열로(시트가 Date로 바꿔 놓은 경우 방어). */
function cellStr_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return formatKst_(v.getTime());
  return v == null ? '' : String(v);
}

function cellNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

function inRangeOrNull_(n, lo, hi) {
  if (n === null) return null;
  return (n >= lo && n <= hi) ? n : null;
}

/**
 * 운동 1건을 검증·정규화한다.
 * @return {{row: Array}|{reason: string}}
 */
function normalizeWorkout_(w, user, receivedAt) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return { reason: 'not_object' };

  var type = (w.type === null || w.type === undefined) ? '' : String(w.type).trim();
  // 수식 주입 방지: 앞쪽의 = + - @ 와 공백 제거
  type = type.replace(/^[\s=+\-@]+/, '');
  if (!type) return { reason: 'missing_type' };
  if (type.length > 60) return { reason: 'type_too_long' };

  var isBlank = function (x) { return x === null || x === undefined || x === ''; };
  if (isBlank(w.start)) return { reason: 'missing_start' };
  var startMs = parseIso_(w.start);
  if (startMs === null) return { reason: 'invalid_start' };

  var endMs = null;
  if (!isBlank(w.end)) {
    endMs = parseIso_(w.end);
    if (endMs === null) return { reason: 'invalid_end' };
  }

  var dur = parseNum_(w.duration_min);
  if (endMs === null && dur === null) return { reason: 'missing_end_and_duration' };

  if (endMs === null) {
    if (!(dur > 0 && dur <= MAX_DURATION_MIN)) return { reason: 'invalid_duration' };
    endMs = startMs + Math.round(dur * 60000);
  } else {
    if (endMs < startMs) return { reason: 'end_before_start' };
    if (dur === null) dur = (endMs - startMs) / 60000;
  }
  if (!(dur > 0 && dur <= MAX_DURATION_MIN)) return { reason: 'invalid_duration' };
  dur = Math.round(dur * 10) / 10;
  if (!(dur > 0)) return { reason: 'invalid_duration' }; // 반올림 후 0 (예: 0.04)

  var kcal = inRangeOrNull_(parseNum_(w.active_kcal), 0, 10000);
  var avg = inRangeOrNull_(parseNum_(w.avg_hr), 25, 250);
  var max = inRangeOrNull_(parseNum_(w.max_hr), 25, 250);
  var rnd = function (n) { return n === null ? '' : Math.round(n); };

  var start = formatKst_(startMs);
  return {
    row: [user + '_' + start, user, type, start, formatKst_(endMs), dur,
      rnd(kcal), rnd(avg), rnd(max), receivedAt]
  };
}

// ───────────────────────── doPost ─────────────────────────

function doPost(e) {
  var lock = null;
  var locked = false;
  try {
    var body;
    try {
      var raw = e && e.postData && e.postData.contents;
      body = JSON.parse(raw);
    } catch (err) {
      return fail_('bad_request');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail_('bad_request');

    var user = body.user;
    if (typeof user !== 'string' || !USERS.hasOwnProperty(user)) return fail_('bad_request');

    var expected = PropertiesService.getScriptProperties().getProperty(USERS[user]);
    if (!expected || !safeEqual_(body.token, expected)) return fail_('unauthorized');

    if (!Array.isArray(body.workouts)) return fail_('bad_request');
    if (body.workouts.length > MAX_WORKOUTS) return fail_('too_many');

    lock = LockService.getScriptLock();
    try {
      lock.waitLock(LOCK_WAIT_MS);
      locked = true;
    } catch (err) {
      return fail_('busy');
    }

    var result = upsertWorkouts_(user, body.workouts);
    return json_({ ok: true, inserted: result.inserted, updated: result.updated,
      rejected: result.rejected });
  } catch (err) {
    Logger.log('doPost 오류: ' + (err && err.stack ? err.stack : err));
    return fail_('server_error');
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (err2) { /* 무시 */ }
    }
  }
}

/** 락을 잡은 상태에서 호출. 시트 전체를 한 번 읽고 메모리에서 병합해 한 번에 쓴다. */
function upsertWorkouts_(user, workouts) {
  var sheet = ensureSheet_(getSpreadsheet_());
  var receivedAt = formatKst_(Date.now());
  var rejected = [];
  var inserted = 0, updated = 0;

  var lastRow = sheet.getLastRow();
  var map = {}; // id -> row
  var order = [];
  var orphans = []; // id 없는 보존 대상 행
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var id = cellStr_(r[0]);
      if (!id) {
        // id 가 없지만 다른 셀이 채워진 행(수동 입력 중)은 보존한다. 완전히 빈 행은 버린다.
        if (r.some(function (c) { return c !== '' && c !== null && c !== undefined; })) orphans.push(r);
        continue;
      }
      r[0] = id;
      r[3] = cellStr_(r[3]);
      r[4] = cellStr_(r[4]);
      r[9] = cellStr_(r[9]);
      r[10] = cellStr_(r[10]);
      if (!map.hasOwnProperty(id)) order.push(id);
      map[id] = r;
    }
  }

  var changed = false;
  for (var k = 0; k < workouts.length; k++) {
    var res = normalizeWorkout_(workouts[k], user, receivedAt);
    if (res.reason) {
      rejected.push({ index: k, reason: res.reason });
      continue;
    }
    var row = res.row;
    if (map.hasOwnProperty(row[0])) {
      updated++;
      var old = map[row[0]];
      // 새 값이 비어 있으면 기존 측정값(kcal/심박)을 유지한다.
      for (var c = 6; c <= 8; c++) {
        if (row[c] === '' && old[c] !== '' && old[c] !== null && old[c] !== undefined) row[c] = old[c];
      }
      row[10] = old[10] == null ? '' : old[10]; // first_received_at 불변
    } else {
      inserted++;
      order.push(row[0]);
      row[10] = receivedAt;
    }
    map[row[0]] = row;
    changed = true;
  }

  if (changed) {
    var rows = order.map(function (id) { return map[id]; });
    rows.sort(function (a, b) {
      return a[3] < b[3] ? -1 : (a[3] > b[3] ? 1 : (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0)));
    });
    rows = rows.concat(orphans); // id 행 뒤에 그대로 이어 쓴다
    var needed = rows.length + 1;
    if (needed > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    }
    var range = sheet.getRange(2, 1, rows.length, NUM_COLS);
    range.setValues(rows);
    // 수동 편집으로 중복 행이 있었다면 줄어든 만큼 꼬리 행을 비운다.
    var oldCount = lastRow >= 2 ? lastRow - 1 : 0;
    if (rows.length < oldCount) {
      sheet.getRange(rows.length + 2, 1, oldCount - rows.length, NUM_COLS).clearContent();
    }
    SpreadsheetApp.flush(); // 락을 쥔 채로 쓰기를 확정
  }
  return { inserted: inserted, updated: updated, rejected: rejected };
}

// ───────────────────────── doGet ─────────────────────────

/** 'YYYY-MM-DD' → epoch day 수(UTC 기준). 형식/날짜가 틀리면 null. */
function parseDay_(s) {
  if (typeof s !== 'string') return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  var ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var d = new Date(ms);
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return Math.round(ms / 86400000);
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var readKey = PropertiesService.getScriptProperties().getProperty(READ_KEY_PROP);
    if (!readKey || !safeEqual_(p.key, readKey)) return fail_('unauthorized');

    var sheet = ensureSheet_(getSpreadsheet_());
    var lastRow = sheet.getLastRow();
    var values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues() : [];

    var updatedAt = null;
    for (var i = 0; i < values.length; i++) {
      var ra = cellStr_(values[i][9]);
      if (ra && (updatedAt === null || ra > updatedAt)) updatedAt = ra;
    }

    if (p.action === 'ping') return json_({ ok: true, updated_at: updatedAt });

    var fromDay = parseDay_(p.from), toDay = parseDay_(p.to);
    if (fromDay === null || toDay === null || toDay < fromDay ||
        (toDay - fromDay + 1) > MAX_RANGE_DAYS) {
      return fail_('bad_request');
    }

    var workouts = [];
    for (var j = 0; j < values.length; j++) {
      var r = values[j];
      var id = cellStr_(r[0]);
      var start = cellStr_(r[3]);
      if (!id || !start) continue;
      var day = parseDay_(start.substring(0, 10)); // 시작 시각의 서울 날짜
      if (day === null || day < fromDay || day > toDay) continue;
      workouts.push({
        id: id, user: cellStr_(r[1]), type: cellStr_(r[2]),
        start: start, end: cellStr_(r[4]),
        duration_min: cellNum_(r[5]), active_kcal: cellNum_(r[6]),
        avg_hr: cellNum_(r[7]), max_hr: cellNum_(r[8])
      });
    }
    workouts.sort(function (a, b) {
      return a.start < b.start ? -1 : (a.start > b.start ? 1 : (a.id < b.id ? -1 : 1));
    });

    return json_({ ok: true, workouts: workouts, updated_at: updatedAt,
      server_time: formatKst_(Date.now()) });
  } catch (err) {
    Logger.log('doGet 오류: ' + (err && err.stack ? err.stack : err));
    return fail_('server_error');
  }
}
