// Prompt builders for AI features. Pure functions so they are unit-testable;
// actual model calls go through server/lib/openrouter.mjs only.

export function buildInsightsPrompt(f) {
  const lines = [];
  lines.push('Podcast ad reconciliation snapshot:');
  lines.push(`- Campaigns: ${f.totalCampaigns} total, ${f.activeCampaigns} active`);
  lines.push(`- Delivery accuracy (delivered vs committed): ${f.deliveryAccuracy}%`);
  lines.push(`- Committed revenue: $${f.committedRevenue}`);
  lines.push(`- Invoice-ready revenue: $${f.invoiceReadyRevenue}`);
  lines.push(`- Makegood value at risk: $${f.revenueAtRisk}`);
  lines.push(`- Open reconciliation issues: ${f.openIssues}`);
  if (f.pacingCounts) {
    const pc = f.pacingCounts;
    lines.push(
      `- Pacing: on_track=${pc.on_track}, slight_risk=${pc.slight_risk}, at_risk=${pc.at_risk}, behind=${pc.behind}, not_started=${pc.not_started}`
    );
  }
  if (Array.isArray(f.atRiskCampaigns) && f.atRiskCampaigns.length) {
    lines.push('Campaigns needing attention:');
    for (const c of f.atRiskCampaigns) {
      lines.push(
        `  - ${c.io} (${c.advertiser} / ${c.show}) ${c.status}: ${c.delivered}/${c.committed} imps, pacing=${c.pacing}`
      );
    }
  }
  if (Array.isArray(f.issueBreakdown) && f.issueBreakdown.length) {
    lines.push('Open issue types:');
    for (const i of f.issueBreakdown) {
      lines.push(`  - ${i.type} (${i.severity}): ${i.count}`);
    }
  }
  lines.push(
    'Write a brief operational briefing for the ad-ops team: 3-5 short bullets covering the biggest delivery risks, revenue exposure, and concrete next actions. Plain text only, no markdown headers.'
  );
  return lines.join('\n');
}
