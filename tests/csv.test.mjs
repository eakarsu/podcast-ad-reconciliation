import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, toNum } from '../app/lib/csv.ts';

test('parseCsv handles simple rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv handles quoted fields with commas and escaped quotes', () => {
  const csv = 'name,note\n"Smith, John","He said ""hi"""';
  assert.deepEqual(parseCsv(csv), [['name', 'note'], ['Smith, John', 'He said "hi"']]);
});

test('parseCsv handles CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCsv drops blank lines but keeps empty fields', () => {
  const csv = 'a,b\n\n1,\n';
  assert.deepEqual(parseCsv(csv), [['a', 'b'], ['1', '']]);
});

test('toNum strips currency formatting', () => {
  assert.equal(toNum('$1,234.50'), 1234.5);
  assert.equal(toNum('2,000 imps'), 2000);
  assert.equal(toNum(''), 0);
  assert.equal(toNum(null), 0);
});
