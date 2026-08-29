import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInsightsPrompt } from '../server/lib/ai.mjs';

test('buildInsightsPrompt includes core facts', () => {
  const prompt = buildInsightsPrompt({
    totalCampaigns: 10,
    activeCampaigns: 4,
    deliveryAccuracy: 66.67,
    committedRevenue: 17705,
    invoiceReadyRevenue: 2065,
    revenueAtRisk: 500,
    openIssues: 7,
  });
  assert.match(prompt, /Campaigns: 10 total, 4 active/);
  assert.match(prompt, /Delivery accuracy.*66\.67%/);
  assert.match(prompt, /Open reconciliation issues: 7/);
  assert.match(prompt, /operational briefing/);
});

test('buildInsightsPrompt includes pacing, at-risk campaigns and issues when present', () => {
  const prompt = buildInsightsPrompt({
    totalCampaigns: 2,
    activeCampaigns: 1,
    deliveryAccuracy: 50,
    committedRevenue: 100,
    invoiceReadyRevenue: 0,
    revenueAtRisk: 0,
    openIssues: 1,
    pacingCounts: { on_track: 1, slight_risk: 0, at_risk: 1, behind: 0, not_started: 0 },
    atRiskCampaigns: [{ io: 'IO-1', advertiser: 'Acme', show: 'Tech Today', status: 'active', committed: 100, delivered: 10, pacing: 'at_risk' }],
    issueBreakdown: [{ type: 'under_delivery', severity: 'high', count: 1 }],
  });
  assert.match(prompt, /Pacing: on_track=1/);
  assert.match(prompt, /IO-1 \(Acme \/ Tech Today\)/);
  assert.match(prompt, /under_delivery \(high\): 1/);
});

test('buildInsightsPrompt omits optional sections when absent', () => {
  const prompt = buildInsightsPrompt({
    totalCampaigns: 0, activeCampaigns: 0, deliveryAccuracy: 0,
    committedRevenue: 0, invoiceReadyRevenue: 0, revenueAtRisk: 0, openIssues: 0,
  });
  assert.ok(!prompt.includes('Pacing:'));
  assert.ok(!prompt.includes('needing attention'));
  assert.ok(!prompt.includes('Open issue types'));
});
