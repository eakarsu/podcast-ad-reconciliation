"use client";

import { useCallback, useEffect, useState } from "react";
import { api, downloadFile, formatCurrency, formatDate, formatNumber } from "../../lib/api";
import type { ReportResponse, ReportRow } from "../../lib/types";
import { Icon, Modal, Notices, PageHead, Spinner, useNotices } from "../../lib/ui";
import SampleDataButton from "../../components/SampleDataButton";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 1000 * 60 * 60 * 24).toISOString().slice(0, 10);
}

const PRESETS = [
  { label: "Last 30 days", start: () => isoDaysAgo(30), end: () => isoDaysAgo(0) },
  { label: "Last 90 days", start: () => isoDaysAgo(90), end: () => isoDaysAgo(0) },
  { label: "Last 365 days", start: () => isoDaysAgo(365), end: () => isoDaysAgo(0) },
];

export default function ReportsPage() {
  const [groupBy, setGroupBy] = useState<"show" | "advertiser">("show");
  const [start, setStart] = useState(isoDaysAgo(30));
  const [end, setEnd] = useState(isoDaysAgo(0));
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportRow | null>(null);
  const [editingReport, setEditingReport] = useState<ReportRow | null>(null);
  const { notices, push, dismiss } = useNotices();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.reports({ group_by: groupBy, start, end }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report.");
    } finally {
      setLoading(false);
    }
  }, [groupBy, start, end]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const exportAs = async (format: "csv" | "json") => {
    try {
      const url = api.reportsExportUrl({ group_by: groupBy, start, end, format });
      const ext = format === "csv" ? "csv" : "json";
      await downloadFile(url, `report_${groupBy}_${start}_${end}.${ext}`);
      push("success", `${ext.toUpperCase()} report downloaded.`);
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Export failed.");
    }
  };

  const delta = (cur: number, prev?: number | null): { text: string; cls: string } => {
    if (prev == null) return { text: "—", cls: "sl-muted" };
    if (prev === 0) return cur === 0 ? { text: "0%", cls: "sl-muted" } : { text: "new", cls: "sl-delta-pos" };
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`, cls: pct >= 0 ? "sl-delta-pos" : "sl-delta-neg" };
  };

  const rows: ReportRow[] = data?.rows || [];
  const totals = data?.totals;

  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Reports"
        tagline="Breakdowns by podcast or advertiser, with period-over-period comparison"
        actions={
          <>
            <button className="sl-btn sl-btn-outline" onClick={() => void exportAs("csv")} disabled={!data}>
              <Icon name="download" /> CSV
            </button>
            <button className="sl-btn sl-btn-outline" onClick={() => void exportAs("json")} disabled={!data}>
              <Icon name="download" /> JSON
            </button>
            <button className="sl-btn sl-btn-ghost" onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner sm /> : <Icon name="refresh" />} Refresh
            </button>
          </>
        }
      />

      {error ? (
        <div className="sl-banner sl-banner-error" role="alert">
          <span className="sl-banner-icon"><Icon name="alert" /></span>
          <div className="sl-banner-body"><strong>Connection problem.</strong> {error}</div>
          <button className="sl-btn sl-btn-outline" onClick={() => void load()}>Retry</button>
        </div>
      ) : null}

      <section className="sl-filters" aria-label="Report parameters">
        <div className="sl-seg" role="tablist" aria-label="Group by">
          <button className={`sl-seg-btn ${groupBy === "show" ? "sl-active" : ""}`} onClick={() => { setGroupBy("show"); setSelectedReport(null); }}>By podcast</button>
          <button className={`sl-seg-btn ${groupBy === "advertiser" ? "sl-active" : ""}`} onClick={() => { setGroupBy("advertiser"); setSelectedReport(null); }}>By advertiser</button>
        </div>
        <label className="sl-field">
          <span className="sl-field-label">From</span>
          <input className="sl-input" type="date" value={start} onChange={(e) => { setStart(e.target.value); setSelectedReport(null); }} />
        </label>
        <label className="sl-field">
          <span className="sl-field-label">To</span>
          <input className="sl-input" type="date" value={end} onChange={(e) => { setEnd(e.target.value); setSelectedReport(null); }} />
        </label>
        <div className="sl-filter-meta">
          {PRESETS.map((p) => (
            <button key={p.label} className="sl-linkbtn" onClick={() => { setStart(p.start()); setEnd(p.end()); setSelectedReport(null); }}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {data ? (
        <>
          <section className="sl-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }} aria-label="Report totals">
            <Kpi label="Delivered value" value={formatCurrency(totals?.delivered_value || 0)} sub={delta(totals?.delivered_value || 0, totals?.previous?.delivered_value ?? null).text} accent="pos" icon="dollar" />
            <Kpi label="Committed value" value={formatCurrency(totals?.committed_value || 0)} sub={`${formatNumber(totals?.campaign_count || 0)} campaigns in window`} accent="ink" icon="shield" />
            <Kpi label="Delivered impressions" value={formatNumber(totals?.delivered_impressions || 0)} sub={delta(totals?.delivered_impressions || 0, totals?.previous?.delivered_impressions ?? null).text} accent="amber" icon="pulse" />
            <Kpi label="Open issues" value={formatNumber(totals?.open_issues || 0)} sub={`Makegoods ${formatCurrency(totals?.makegood_value || 0)}`} accent="warn" icon="alert" />
          </section>

          <section className="sl-tablewrap" aria-label="Report rows">
            <div className="sl-table-scroll">
              <table className="sl-table">
                <thead>
                  <tr>
                    <th>{groupBy === "show" ? "Podcast" : "Advertiser"}</th>
                    <th className="sl-th-right">Campaigns</th>
                    <th className="sl-th-right">Committed imps</th>
                    <th className="sl-th-right">Delivered imps</th>
                    <th className="sl-th-right">vs prev</th>
                    <th className="sl-th-right">Committed value</th>
                    <th className="sl-th-right">Delivered value</th>
                    <th className="sl-th-right">vs prev</th>
                    <th className="sl-th-right">Makegoods</th>
                    <th className="sl-th-center">Open issues</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="sl-row-skeleton">
                        {Array.from({ length: 10 }).map((__, j) => <td key={j}><span className="sl-bar" /></td>)}
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={10}>
                        <div className="sl-empty">
                          <span className="sl-empty-icon"><Icon name="flag" /></span>
                          <h3>No activity in this window</h3>
                          <p>Try widening the date range — campaigns whose flight overlaps {formatDate(data.start)} → {formatDate(data.end)} are included.</p>
                          <div className="sl-empty-actions">
                            <SampleDataButton onLoaded={load} push={push} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const impDelta = delta(r.delivered_impressions, r.previous?.delivered_impressions ?? null);
                      const valDelta = delta(r.delivered_value, r.previous?.delivered_value ?? null);
                      return (
                        <tr
                          key={r.name}
                          className="sl-row"
                          tabIndex={0}
                          onClick={() => setSelectedReport(r)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedReport(r);
                            }
                          }}
                          aria-label={`Open ${groupBy} report for ${r.name}`}
                        >
                          <td className="sl-cell-io">{r.name}</td>
                          <td className="sl-cell-num">{r.campaign_count}{r.active_campaigns > 0 ? <span className="sl-show"> ({r.active_campaigns} active)</span> : null}</td>
                          <td className="sl-cell-num">{formatNumber(r.committed_impressions)}</td>
                          <td className="sl-cell-num">{formatNumber(r.delivered_impressions)}</td>
                          <td className="sl-cell-num"><span className={impDelta.cls}>{impDelta.text}</span></td>
                          <td className="sl-cell-num">{formatCurrency(r.committed_value)}</td>
                          <td className="sl-cell-num">{formatCurrency(r.delivered_value)}</td>
                          <td className="sl-cell-num"><span className={valDelta.cls}>{valDelta.text}</span></td>
                          <td className="sl-cell-num">{formatCurrency(r.makegood_value)}</td>
                          <td className="sl-th-center">
                            {r.open_issues > 0 ? <span className="sl-flag sl-flag-issue">{r.open_issues}</span> : <span className="sl-muted">—</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {data.previous ? (
              <p className="sl-form-hint" style={{ padding: "8px 16px" }}>
                Comparison period: {formatDate(data.previous.start)} → {formatDate(data.previous.end)} (the window of equal length immediately before).
              </p>
            ) : null}
          </section>
        </>
      ) : loading ? (
        <div className="sl-pad sl-muted">Loading report…</div>
      ) : null}

      {selectedReport && data ? (
        <Modal
          title={selectedReport.name}
          sub={`${groupBy === "show" ? "Podcast" : "Advertiser"} performance · ${formatDate(data.start)} → ${formatDate(data.end)}`}
          onClose={() => setSelectedReport(null)}
          footer={
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setSelectedReport(null)}>Cancel</button>
              <button className="sl-btn sl-btn-danger" disabled title="A report row has linked campaigns and cannot be deleted."><Icon name="close" /> Delete</button>
              <button className="sl-btn sl-btn-primary" onClick={() => { setEditingReport(selectedReport); setSelectedReport(null); }}><Icon name="edit" /> Edit</button>
            </>
          }
          wide
        >
          <div className="sl-record-grid">
            <div className="sl-record-metric"><span>Campaigns</span><strong>{formatNumber(selectedReport.campaign_count)}{selectedReport.active_campaigns > 0 ? ` · ${formatNumber(selectedReport.active_campaigns)} active` : ""}</strong></div>
            <div className="sl-record-metric"><span>Committed impressions</span><strong>{formatNumber(selectedReport.committed_impressions)}</strong></div>
            <div className="sl-record-metric"><span>Delivered impressions</span><strong>{formatNumber(selectedReport.delivered_impressions)}</strong></div>
            <div className="sl-record-metric"><span>Impressions vs previous</span><strong className={delta(selectedReport.delivered_impressions, selectedReport.previous?.delivered_impressions ?? null).cls}>{delta(selectedReport.delivered_impressions, selectedReport.previous?.delivered_impressions ?? null).text}</strong></div>
            <div className="sl-record-metric"><span>Committed value</span><strong>{formatCurrency(selectedReport.committed_value)}</strong></div>
            <div className="sl-record-metric"><span>Delivered value</span><strong>{formatCurrency(selectedReport.delivered_value)}</strong></div>
            <div className="sl-record-metric"><span>Value vs previous</span><strong className={delta(selectedReport.delivered_value, selectedReport.previous?.delivered_value ?? null).cls}>{delta(selectedReport.delivered_value, selectedReport.previous?.delivered_value ?? null).text}</strong></div>
            <div className="sl-record-metric"><span>Makegoods</span><strong>{formatCurrency(selectedReport.makegood_value)}</strong></div>
            <div className={`sl-record-metric ${selectedReport.open_issues > 0 ? "sl-record-warn" : "sl-record-ok"}`}><span>Open issues</span><strong>{formatNumber(selectedReport.open_issues)}</strong></div>
          </div>
        </Modal>
      ) : null}

      {editingReport ? (
        <EditReportEntityModal
          row={editingReport}
          groupBy={groupBy}
          onClose={() => setEditingReport(null)}
          onSaved={load}
          push={push}
        />
      ) : null}
    </main>
  );
}

function EditReportEntityModal({ row, groupBy, onClose, onSaved, push }: {
  row: ReportRow;
  groupBy: "show" | "advertiser";
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [name, setName] = useState(row.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = groupBy === "show" ? "podcast" : "advertiser";

  const submit = async () => {
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName) { setError(`${groupBy === "show" ? "Podcast title" : "Advertiser name"} is required.`); return; }
    setBusy(true);
    setError(null);
    try {
      if (groupBy === "show") await api.updateShow(row.entity_id, { title: cleanName });
      else await api.updateAdvertiser(row.entity_id, { name: cleanName });
      push("success", `${groupBy === "show" ? "Podcast" : "Advertiser"} updated.`);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not update ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit ${label}`}
      sub="The updated name will appear across campaigns and reports."
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sl-btn sl-btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner sm /> : <Icon name="edit" />} Save changes</button>
        </>
      }
    >
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <label className="sl-field">
        <span className="sl-field-label">{groupBy === "show" ? "Podcast title" : "Advertiser name"}</span>
        <input className="sl-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
    </Modal>
  );
}

function Kpi({ label, value, sub, accent, icon }: { label: string; value: string; sub: string; accent: string; icon: string }) {
  return (
    <article className="sl-kpi">
      <div className={`sl-kpi-accent sl-accent-${accent}`} />
      <div className="sl-kpi-body">
        <div className="sl-kpi-top">
          <span className="sl-kpi-label">{label}</span>
          <span className={`sl-kpi-icon sl-accent-${accent}`}><Icon name={icon} /></span>
        </div>
        <div className="sl-kpi-value">{value}</div>
        <div className="sl-kpi-sub">{sub}</div>
      </div>
    </article>
  );
}
