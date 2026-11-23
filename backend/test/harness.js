// Code.gs 를 vm 컨텍스트에 로드하고 Apps Script 서비스를 메모리 목으로 대체한다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const HEADERS = ['id', 'user', 'type', 'start', 'end', 'duration_min',
  'active_kcal', 'avg_hr', 'max_hr', 'received_at', 'first_received_at'];

class MockSheet {
  constructor(name) {
    this.name = name;
    this.grid = []; // grid[r][c], 0-based
    this.maxRows = 1000;
    this.maxCols = 26;
    this.formats = [];
    this.frozen = 0;
    this.setValuesCalls = 0;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_pos, n) { this.maxRows += n; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(_pos, n) { this.maxCols += n; }
  setFrozenRows(n) { this.frozen = n; }
  getLastRow() {
    for (let r = this.grid.length - 1; r >= 0; r--) {
      if ((this.grid[r] || []).some((v) => v !== '' && v !== undefined)) return r + 1;
    }
    return 0;
  }
  getRange(row, col, nr = 1, nc = 1) {
    const s = this;
    if (row + nr - 1 > s.maxRows) throw new Error('range out of grid');
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const line = [];
          for (let j = 0; j < nc; j++) {
            const v = (s.grid[row - 1 + i] || [])[col - 1 + j];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues(vals) {
        s.setValuesCalls++;
        if (vals.length !== nr || vals.some((r) => r.length !== nc)) throw new Error('dimension mismatch');
        for (let i = 0; i < nr; i++) {
          s.grid[row - 1 + i] = s.grid[row - 1 + i] || [];
          for (let j = 0; j < nc; j++) s.grid[row - 1 + i][col - 1 + j] = vals[i][j];
        }
      },
      clearContent() {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
          if (s.grid[row - 1 + i]) s.grid[row - 1 + i][col - 1 + j] = '';
        }
      },
      setNumberFormat(f) { s.formats.push({ row, col, nr, nc, f }); },
    };
  }
  dataRows() { return this.grid.slice(1, this.getLastRow()); }
}

function createEnv(opts = {}) {
  const sheets = {};
  const props = Object.assign({}, opts.props || {});
  const logs = [];
  const state = { activeCalls: 0, openedIds: [], lockReleased: 0, lockAcquired: 0, lockTimeout: false };

  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new MockSheet(n)),
    getId: () => 'SS_ID_1',
  };
  const events = [];
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => { state.activeCalls++; return ss; },
      openById: (id) => { state.openedIds.push(id); return ss; },
      flush: () => { events.push('flush'); },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (state.lockTimeout) throw new Error('Lock timeout');
          state.lockAcquired++;
        },
        releaseLock() { state.lockReleased++; events.push('release'); },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (t) => ({
        text: t, mime: null,
        setMimeType(m) { this.mime = m; return this; },
        getContent() { return this.text; },
      }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate(date, tz, fmt) {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(date).map((x) => [x.type, x.value]));
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
          .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
    },
    Logger: { log: (m) => logs.push(String(m)) },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

  const env = {
    ctx, sheets, props, logs, state, events, HEADERS,
    sheet: () => sheets.workouts,
    post(body) {
      const contents = typeof body === 'string' ? body : JSON.stringify(body);
      return JSON.parse(ctx.doPost({ postData: { contents } }).getContent());
    },
    get(params) { return JSON.parse(ctx.doGet({ parameter: params }).getContent()); },
    rawGet(params) { return ctx.doGet({ parameter: params }); },
    setup: () => ctx.setup(),
  };
  return env;
}

/** setup 까지 끝낸 환경. */
function readyEnv() {
  const env = createEnv();
  env.setup();
  return env;
}

const W = (o = {}) => Object.assign({
  type: '실외 달리기', start: '2026-11-22T07:05:00+09:00', end: '2026-11-22T07:37:30+09:00',
  duration_min: 32.5, active_kcal: 310, avg_hr: 142, max_hr: 171,
}, o);

module.exports = { createEnv, readyEnv, W, HEADERS };
