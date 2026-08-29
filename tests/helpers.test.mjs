import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcVariance, elapsedPct, getPacingStatus, paginated, parseCookies, parsePagination, toSqlDate } from '../server/lib/helpers.mjs';

test('toSqlDate normalizes to YYYY-MM-DD and rejects junk', () => {
  assert.equal(toSqlDate('2024-03-05'), '2024-03-05');
  assert.equal(toSqlDate('March 5, 2024 UTC'), '2024-03-05');
  assert.equal(toSqlDate(''), null);
  assert.equal(toSqlDate(null), null);
  assert.equal(toSqlDate('not a date'), null);
});

test('calcVariance computes percent delta and guards zero', () => {
  assert.equal(calcVariance(1000, 1100), 10);
  assert.equal(calcVariance(1000, 500), -50);
  assert.equal(calcVariance(0, 100), 0);
});

test('getPacingStatus before/after flight', () => {
  const c = { start_date: '2024-01-01', end_date: '2024-01-31', committed_impressions: 100 };
  assert.equal(getPacingStatus(c, 0, '2023-12-15'), 'not_started');
  assert.equal(getPacingStatus(c, 100, '2024-02-15'), 'on_track');
  assert.equal(getPacingStatus(c, 50, '2024-02-15'), 'behind');
});

test('getPacingStatus mid-flight thresholds', () => {
  // 20-day flight; 10 days elapsed => expected 50%
  const c = { start_date: '2024-01-01T00:00:00Z', end_date: '2024-01-21T00:00:00Z', committed_impressions: 1000 };
  assert.equal(getPacingStatus(c, 500, '2024-01-11T00:00:00Z'), 'on_track'); // 50% >= 47.5%
  assert.equal(getPacingStatus(c, 420, '2024-01-11T00:00:00Z'), 'slight_risk'); // 42% >= 40%
  assert.equal(getPacingStatus(c, 300, '2024-01-11T00:00:00Z'), 'at_risk'); // 30% < 40%
});

test('elapsedPct is 0 before start, linear between, unclamped after end', () => {
  assert.equal(elapsedPct('2024-01-01T00:00:00Z', '2024-01-11T00:00:00Z', '2023-12-30T00:00:00Z'), 0);
  assert.equal(elapsedPct('2024-01-01T00:00:00Z', '2024-01-11T00:00:00Z', '2024-01-06T00:00:00Z'), 0.5);
  // Intentionally unclamped after the flight ends (callers decide how to treat it).
  assert.equal(elapsedPct('2024-01-01T00:00:00Z', '2024-01-11T00:00:00Z', '2024-02-01T00:00:00Z'), 3.1);
});

test('parsePagination clamps and defaults', () => {
  assert.deepEqual(parsePagination({}), { page: 1, pageSize: 25, offset: 0 });
  assert.deepEqual(parsePagination({ page: '3', pageSize: '50' }), { page: 3, pageSize: 50, offset: 100 });
  assert.deepEqual(parsePagination({ page: '-2', pageSize: '99999' }), { page: 1, pageSize: 500, offset: 0 });
  assert.deepEqual(parsePagination({ page: 'abc', pageSize: 'x' }), { page: 1, pageSize: 25, offset: 0 });
});

test('paginated builds the standard envelope', () => {
  assert.deepEqual(paginated([1, 2], 51, 2, 25), { rows: [1, 2], total: 51, page: 2, pageSize: 25, pageCount: 3 });
});

test('parseCookies handles basic and quoted values', () => {
  assert.deepEqual(parseCookies('a=1; b=two'), { a: '1', b: 'two' });
  assert.deepEqual(parseCookies('sl_session=abc%2Fdef'), { sl_session: 'abc/def' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
});
