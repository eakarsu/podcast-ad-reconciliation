import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DETECTION_RULES, detectCampaignIssues } from '../server/lib/detection.mjs';

const CAMPAIGN = {
  id: 'c1',
  status: 'active',
  start_date: '2024-01-01T00:00:00Z',
  end_date: '2024-01-21T00:00:00Z',
  committed_impressions: 1000,
};
const NOW = '2024-01-11T00:00:00Z'; // 50% of flight elapsed

test('no issues when pacing on track', () => {
  const issues = detectCampaignIssues(CAMPAIGN, 500, 1, NOW);
  assert.equal(issues.length, 0);
});

test('under_delivery flagged when actual < 80% of expected', () => {
  const issues = detectCampaignIssues(CAMPAIGN, 300, 1, NOW); // 30% vs 50% expected
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'under_delivery');
  assert.ok(['high', 'medium', 'low'].includes(issues[0].severity));
  assert.match(issues[0].description, /Auto-detected under-delivery: 30% delivered with 50% of flight elapsed/);
});

test('severity escalates with how far behind', () => {
  // expected = 50%; high < 25%, medium = [25%, 32.5%), low >= 32.5%
  const low = detectCampaignIssues(CAMPAIGN, 350, 1, NOW); // 35% vs 50% => low
  assert.equal(low[0].severity, 'low');
  const medium = detectCampaignIssues(CAMPAIGN, 300, 1, NOW); // 30% vs 50% => medium
  assert.equal(medium[0].severity, 'medium');
  const high = detectCampaignIssues(CAMPAIGN, 150, 1, NOW); // 15% vs 50% => high
  assert.equal(high[0].severity, 'high');
});

test('no under_delivery before MIN_ELAPSED of flight', () => {
  const early = '2024-01-02T00:00:00Z'; // ~5% elapsed
  assert.equal(detectCampaignIssues(CAMPAIGN, 0, 1, early).length, 0);
});

test('zero committed impressions never flags under_delivery', () => {
  const issues = detectCampaignIssues({ ...CAMPAIGN, committed_impressions: 0 }, 0, 1, NOW);
  assert.equal(issues.length, 0);
});

test('missing_aircheck flagged when delivery exists but no airchecks', () => {
  const issues = detectCampaignIssues(CAMPAIGN, 500, 0, NOW);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, 'missing_aircheck');
  assert.equal(issues[0].severity, 'medium');
});

test('completed campaign only gets missing_aircheck', () => {
  const done = { ...CAMPAIGN, status: 'completed' };
  assert.deepEqual(detectCampaignIssues(done, 1000, 2, NOW), []);
  const missing = detectCampaignIssues(done, 500, 0, NOW);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].type, 'missing_aircheck');
});

test('descriptions are deterministic (dedupe-friendly)', () => {
  const a = detectCampaignIssues(CAMPAIGN, 300, 1, NOW);
  const b = detectCampaignIssues(CAMPAIGN, 300, 1, NOW);
  assert.equal(a[0].description, b[0].description);
});

test('rules are sane', () => {
  assert.ok(DETECTION_RULES.MIN_ELAPSED > 0 && DETECTION_RULES.MIN_ELAPSED < 1);
  assert.ok(DETECTION_RULES.UNDER_DELIVERY_FACTOR > 0 && DETECTION_RULES.UNDER_DELIVERY_FACTOR < 1);
});
