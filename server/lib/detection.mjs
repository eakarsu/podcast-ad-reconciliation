import { elapsedPct } from './helpers.mjs';

// Thresholds for auto-flagging pacing slips.
export const DETECTION_RULES = {
  // Only flag once at least this fraction of the flight has elapsed.
  MIN_ELAPSED: 0.25,
  // Flag when actual delivery % falls below expected % times this factor.
  UNDER_DELIVERY_FACTOR: 0.8,
  // A completed flight must have delivered everything.
};

// Pure: given one campaign's stats, decide which issues should exist.
// campaign: { id, status, start_date, end_date, committed_impressions }
export function detectCampaignIssues(campaign, delivered, aircheckCount, today) {
  const issues = [];
  const { status, committed_impressions, start_date, end_date } = campaign;
  const committed = Number(committed_impressions) || 0;
  const actual = Number(delivered) || 0;

  if (status === 'active') {
    const expected = elapsedPct(start_date, end_date, today);
    if (expected >= DETECTION_RULES.MIN_ELAPSED && committed > 0) {
      const actualPct = actual / committed;
      if (actualPct < expected * DETECTION_RULES.UNDER_DELIVERY_FACTOR) {
        // Deterministic description so the unique index (campaign, type, description)
        // de-duplicates repeated sweeps.
        const description = `Auto-detected under-delivery: ${Math.round(actualPct * 100)}% delivered with ${Math.round(expected * 100)}% of flight elapsed`;
        const severity =
          actualPct < expected * 0.5 ? 'high' : actualPct < expected * 0.65 ? 'medium' : 'low';
        issues.push({ type: 'under_delivery', severity, description });
      }
    }
  }

  if ((status === 'active' || status === 'completed') && actual > 0 && Number(aircheckCount) === 0) {
    issues.push({
      type: 'missing_aircheck',
      severity: 'medium',
      description: 'Auto-detected missing aircheck: delivery recorded but no aircheck on file',
    });
  }

  return issues;
}
