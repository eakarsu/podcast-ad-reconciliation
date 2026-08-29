"use client";

import { useCallback, useEffect, useState } from "react";
import { api, describeActivity, formatCurrency, formatNumber, relativeTime } from "../lib/api";
import { PacingDonut, RevenueBars, TrendChart } from "../lib/charts";
import type { ActivityEvent, AiInsights, RevenueSlice, Summary, TrendPoint } from "../lib/types";
import { Icon, KpiCard, Notices, PageHead, Spinner, useNotices } from "../lib/ui";
import SampleDataButton from "../components/SampleDataButton";

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [revenue, setRevenue] = useState<RevenueSlice[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const { notices, push, dismiss } = useNotices();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, tr, rev, acts] = await Promise.all([
        api.summary(),
        api.deliveryTrend(),
        api.revenueByAdvertiser(),
        api.activity(),
      ]);
      setSummary(sum);
      setTrend(tr);
      setRevenue(rev);
      setActivity(acts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach the reconciliation API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setNowMs(Date.now());
      void loadAll();
    }, 0);
    const iv = setInterval(() => setNowMs(Date.now()), 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(iv);
    };
  }, [loadAll]);

  const generateInsights = async () => {
    if (insightsBusy) return;
    setInsightsBusy(true);
    setInsightsError(null);
    try {
      setInsights(await api.aiInsights());
    } catch (e) {
      setInsightsError(e instanceof Error ? e.message : "Could not generate insights.");
    } finally {
      setInsightsBusy(false);
    }
  };

  const accuracyTone = summary && summary.deliveryAccuracy >= 95 ? "pos" : summary && summary.deliveryAccuracy >= 80 ? "warn" : "neg";

  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Dashboard"
        tagline={summary ? `${formatNumber(summary.totalCampaigns)} campaigns · synced ${relativeTime(new Date().toISOString(), nowMs)}` : "Reconciliation overview"}
        actions={
          <button className="sl-btn sl-btn-outline" onClick={() => void loadAll()} disabled={loading}>
            {loading ? <Spinner sm /> : <Icon name="refresh" />} Refresh
          </button>
        }
      />

      {error ? (
        <div className="sl-banner sl-banner-error" role="alert">
          <span className="sl-banner-icon"><Icon name="alert" /></span>
          <div className="sl-banner-body">
            <strong>Connection problem.</strong> {error}
            <p className="sl-banner-hint">Confirm the API is running and PostgreSQL is reachable.</p>
          </div>
          <button className="sl-btn sl-btn-outline" onClick={() => void loadAll()}>Retry</button>
        </div>
      ) : null}

      {!loading && summary?.totalCampaigns === 0 ? (
        <section className="sl-onboarding" aria-label="Get started">
          <span className="sl-onboarding-icon"><Icon name="mic" /></span>
          <div className="sl-onboarding-copy">
            <span className="sl-eyebrow">Empty workspace</span>
            <h3>Start with a complete podcast portfolio</h3>
            <p>Load realistic podcasts, episodes, advertisers, campaigns, delivery, alerts, and invoice-ready records. Nothing existing will be overwritten.</p>
          </div>
          <SampleDataButton onLoaded={loadAll} push={push} label="Create sample workspace" />
        </section>
      ) : null}

      <section className="sl-kpis" aria-label="Key metrics">
        {loading && !summary ? (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="sl-kpi sl-skeleton-card" />)
        ) : summary ? (
          <>
            <KpiCard label="Committed revenue" value={formatCurrency(summary.committedRevenue)} sub={`${formatNumber(summary.totalCampaigns)} campaigns`} accent="ink" icon="shield" />
            <KpiCard label="Invoice-ready revenue" value={formatCurrency(summary.invoiceReadyRevenue)} sub={`${summary.invoiceReadyCount} campaigns reconciled`} accent="pos" icon="check" />
            <KpiCard label="Revenue at risk" value={formatCurrency(summary.revenueAtRisk)} sub="Approved makegoods" accent="neg" icon="alert" />
            <KpiCard label="Delivery accuracy" value={`${summary.deliveryAccuracy.toFixed(1)}%`} sub="Delivered vs committed" accent={accuracyTone} icon="pulse" />
            <KpiCard label="Active campaigns" value={formatNumber(summary.activeCampaigns)} sub="Currently running" accent="amber" icon="mic" />
            <KpiCard label="Open issues" value={formatNumber(summary.openIssues)} sub="Need attention" accent="warn" icon="alert" />
          </>
        ) : null}
      </section>

      <section className="sl-charts" aria-label="Analytics">
        <div className="sl-chart-card">
          <h3>Delivery trend</h3>
          <p className="sl-chart-sub">Delivered impressions per week (last 12 weeks)</p>
          {loading && trend.length === 0 ? <div className="sl-bar" style={{ height: 180 }} /> : <TrendChart data={trend} />}
        </div>
        <div className="sl-chart-card">
          <h3>Revenue by advertiser</h3>
          <p className="sl-chart-sub">Committed vs delivered, using each IO&apos;s CPM</p>
          {loading && revenue.length === 0 ? <div className="sl-bar" style={{ height: 180 }} /> : <RevenueBars data={revenue} />}
        </div>
      </section>

      <section className="sl-charts" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)" }} aria-label="Pacing and activity">
        <div className="sl-chart-card">
          <h3>Pacing health</h3>
          <p className="sl-chart-sub">Delivery progress vs elapsed flight time</p>
          {summary ? <PacingDonut counts={summary.pacingCounts} /> : <div className="sl-bar" style={{ height: 180 }} />}
        </div>
        <div className="sl-chart-card">
          <h3>Recent activity</h3>
          <p className="sl-chart-sub">Status changes, makegoods, and issue updates</p>
          {loading && activity.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="sl-act-skeleton" />)
          ) : activity.length === 0 ? (
            <p className="sl-muted sl-pad">No recorded activity yet.</p>
          ) : (
            <ul className="sl-activity-list" style={{ maxHeight: 260, marginTop: 0, border: "none" }}>
              {activity.slice(0, 8).map((a) => (
                <li key={a.id} className="sl-act-item">
                  <span className={`sl-act-dot sl-act-${a.action.includes("status") ? "status" : a.action.includes("makegood") || a.action === "created" ? "mg" : "other"}`} />
                  <div className="sl-act-body">
                    <span className="sl-act-action">{a.action.replace(/_/g, " ")}</span>
                    <span className="sl-act-desc">{describeActivity(a)}</span>
                  </div>
                  <time className="sl-act-time" dateTime={a.created_at}>{relativeTime(a.created_at, nowMs)}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="sl-chart-card sl-ai-card" aria-label="AI insights">
        <div className="sl-ai-head">
          <div>
            <h3><Icon name="pulse" /> AI insights</h3>
            <p className="sl-chart-sub">An operational briefing generated from your live reconciliation data</p>
          </div>
          <button className="sl-btn sl-btn-primary" onClick={() => void generateInsights()} disabled={insightsBusy}>
            {insightsBusy ? <Spinner sm /> : <Icon name="pulse" />}
            {insights ? "Regenerate" : "Generate insights"}
          </button>
        </div>
        {insightsError ? <div className="sl-inline-error"><Icon name="alert" /> {insightsError}</div> : null}
        {insights ? (
          <div className="sl-ai-body">
            <pre className="sl-ai-text">{insights.insights}</pre>
            <span className="sl-form-hint">Model {insights.model} · {relativeTime(insights.generated_at, nowMs)}</span>
          </div>
        ) : !insightsBusy && !insightsError ? (
          <p className="sl-muted sl-pad">Generate a briefing to surface the biggest pacing risks and revenue exposure.</p>
        ) : null}
      </section>
    </main>
  );
}
