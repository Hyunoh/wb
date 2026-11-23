import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, fmtMin, fmtShort, relativeLabel } from '../lib/format.js';

test('relativeLabel', () => {
  const now = new Date('2026-11-22T10:00:00+09:00');
  const at = (s) => relativeLabel(s, now);
  assert.equal(at('2026-11-22T09:59:30+09:00'), '방금 전');
  assert.equal(at('2026-11-22T10:00:30+09:00'), '방금 전'); // 미래(시계 오차)
  assert.equal(at('2026-11-22T09:57:00+09:00'), '3분 전');
  assert.equal(at('2026-11-22T09:01:00+09:00'), '59분 전');
  assert.equal(at('2026-11-22T08:00:00+09:00'), '2시간 전');
  assert.equal(at('2026-11-21T10:00:00+09:00'), '1일 전');
  assert.equal(at('2026-11-19T09:00:00+09:00'), '3일 전');
  assert.equal(at('garbage'), '');
});

test('fmtShort h:mm / fmtMin', () => {
  assert.equal(fmtShort(560), '9:20');
  assert.equal(fmtShort(0), '0:00');
  assert.equal(fmtShort(65.4), '1:05');
  assert.equal(fmtMin(45), '45분');
  assert.equal(fmtMin(65), '1시간 5분');
  assert.equal(fmtMin(120), '2시간');
});

test('escapeHtml', () => {
  assert.equal(escapeHtml('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(5), '5');
});
