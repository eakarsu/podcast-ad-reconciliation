"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatDateTime, formatNumber } from "../../lib/api";
import type { CampaignRow, IssueRow, IssueSeverity, IssueType } from "../../lib/types";
import { Icon, Modal, Notices, PageHead, Pagination, Spinner, useNotices } from "../../lib/ui";
import SampleDataButton from "../../components/SampleDataButton";

const ISSUE_TYPES: IssueType[] = ["under_delivery", "over_delivery", "missing_aircheck", "discrepancy"];
const SEVERITIES: IssueSeverity[] = ["low", "medium", "high"];

export default function IssuesPage() {
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  const [resolvedFilter, setResolvedFilter] = useState("false");
  const [typeFilter, setTypeFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [createOpen, setCreateOpen] = useState(false);
  const [makegoodFor, setMakegoodFor] = useState<IssueRow | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<IssueRow | null>(null);
  const [editingIssue, setEditingIssue] = useState<IssueRow | null>(null);
  const [confirmingIssueDelete, setConfirmingIssueDelete] = useState(false);
  const [issueBusy, setIssueBusy] = useState(false);

  const { notices, push, dismiss } = useNotices();

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.issues({
        resolved: resolvedFilter || undefined,
        type: typeFilter || undefined,
        severity: severityFilter || undefined,
        q: debouncedQ || undefined,
        page,
        pageSize,
      });
      setIssues(res.rows);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach the reconciliation API.");
    } finally {
      setLoading(false);
    }
  }, [resolvedFilter, typeFilter, severityFilter, debouncedQ, page, pageSize]);

  useEffect(() => {
    const timer = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(timer);
  }, [loadAll]);

  const counts = useMemo(() => {
    const open = issues.filter((i) => !i.resolved);
    return {
      open: open.length,
      high: open.filter((i) => i.severity === "high").length,
      medium: open.filter((i) => i.severity === "medium").length,
      low: open.filter((i) => i.severity === "low").length,
    };
  }, [issues]);

  const runDetection = async () => {
    if (detecting) return;
    setDetecting(true);
    try {
      const res = await api.detectIssues();
      push(res.created > 0 ? "success" : "info", res.created > 0 ? `Auto-detected ${res.created} new issue${res.created === 1 ? "" : "s"}.` : "No new issues detected — pacing looks clean.");
      await loadAll();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Auto-detection failed.");
    } finally {
      setDetecting(false);
    }
  };

  const setResolved = async (issue: IssueRow, resolved: boolean) => {
    if (issueBusy) return;
    setIssueBusy(true);
    try {
      await api.setIssueResolved(issue.id, resolved);
      push("success", `Issue ${resolved ? "resolved" : "reopened"}: ${issue.io_number} · ${issue.type}.`);
      setSelectedIssue(null);
      await loadAll();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not update the issue.");
    } finally {
      setIssueBusy(false);
    }
  };

  const deleteIssue = async (issue: IssueRow) => {
    if (issueBusy) return;
    setIssueBusy(true);
    try {
      await api.deleteIssue(issue.id);
      push("success", `Deleted issue ${issue.io_number} · ${issue.type}.`);
      setSelectedIssue(null);
      setConfirmingIssueDelete(false);
      await loadAll();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not delete the issue.");
    } finally {
      setIssueBusy(false);
    }
  };

  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Issues"
        tagline="Reconciliation queue across all campaigns"
        actions={
          <>
            <button className="sl-btn sl-btn-outline" onClick={() => void runDetection()} disabled={detecting}>
              {detecting ? <Spinner sm /> : <Icon name="pulse" />} Run auto-detect
            </button>
            <button className="sl-btn sl-btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" /> New issue
            </button>
          </>
        }
      />

      {error ? (
        <div className="sl-banner sl-banner-error" role="alert">
          <span className="sl-banner-icon"><Icon name="alert" /></span>
          <div className="sl-banner-body">
            <strong>Connection problem.</strong> {error}
          </div>
          <button className="sl-btn sl-btn-outline" onClick={() => void loadAll()}>Retry</button>
        </div>
      ) : null}

      <section className="sl-kpis" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }} aria-label="Issue counts">
        <KpiMini label="Open issues" value={counts.open} accent="warn" />
        <KpiMini label="High severity" value={counts.high} accent="neg" />
        <KpiMini label="Medium" value={counts.medium} accent="amber" />
        <KpiMini label="Low" value={counts.low} accent="ink" />
      </section>

      <section className="sl-filters" aria-label="Filters">
        <div className="sl-search">
          <span className="sl-search-icon"><Icon name="search" /></span>
          <input className="sl-input" type="search" placeholder="Search description, IO, advertiser, or podcast…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search issues" />
        </div>
        <label className="sl-field">
          <span className="sl-field-label">State</span>
          <select className="sl-select" value={resolvedFilter} onChange={(e) => { setResolvedFilter(e.target.value); setPage(1); }}>
            <option value="false">Open only</option>
            <option value="true">Resolved only</option>
            <option value="">All</option>
          </select>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Type</span>
          <select className="sl-select" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All types</option>
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Severity</span>
          <select className="sl-select" value={severityFilter} onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="sl-filter-meta">
          <span className="sl-count">{formatNumber(total)} shown</span>
        </div>
      </section>

      <section className="sl-tablewrap" aria-label="Issues">
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th>IO</th>
                <th>Advertiser / Podcast</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Description</th>
                <th>Created</th>
                <th className="sl-th-center">Makegoods</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {loading && issues.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="sl-row-skeleton">
                    {Array.from({ length: 8 }).map((__, j) => <td key={j}><span className="sl-bar" /></td>)}
                  </tr>
                ))
              ) : issues.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="sl-empty">
                      <span className="sl-empty-icon"><Icon name="check" /></span>
                      <h3>{resolvedFilter === "false" ? "No open issues" : "No issues found"}</h3>
                      <p>{resolvedFilter === "false" ? "Clean books — every campaign is reconciled." : "Try clearing filters, or create an issue manually."}</p>
                      {!q && !typeFilter && !severityFilter ? (
                        <div className="sl-empty-actions">
                          <SampleDataButton onLoaded={loadAll} push={push} />
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : (
                issues.map((i) => (
                  <tr
                    key={i.id}
                    className={`sl-row ${i.resolved ? "sl-row-resolved" : ""}`}
                    tabIndex={0}
                    onClick={() => { setSelectedIssue(i); setConfirmingIssueDelete(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedIssue(i);
                        setConfirmingIssueDelete(false);
                      }
                    }}
                    aria-label={`Open issue ${i.io_number}: ${i.type.replace(/_/g, " ")}`}
                  >
                    <td className="sl-cell-io">{i.io_number}</td>
                    <td className="sl-cell-name">
                      <span className="sl-advertiser">{i.advertiser_name}</span>
                      <span className="sl-show">{i.show_title}</span>
                    </td>
                    <td><span className="sl-issue-type">{i.type.replace(/_/g, " ")}</span></td>
                    <td><span className={`sl-sev sl-sev-${i.severity}`}>{i.severity}</span></td>
                    <td className="sl-issue-desc">{i.description}</td>
                    <td className="sl-cell-dates">{formatDateTime(i.created_at)}</td>
                    <td className="sl-th-center">{i.makegood_count > 0 ? <span className="sl-flag sl-flag-mg">{i.makegood_count}</span> : <span className="sl-muted">—</span>}</td>
                    <td><span className={`sl-issue-state ${i.resolved ? "sl-ok" : "sl-open"}`}>{i.resolved ? "resolved" : "open"}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          disabled={loading}
          onPage={(p) => setPage(p)}
          onPageSize={(s) => { setPageSize(s); setPage(1); }}
        />
      </section>

      {selectedIssue ? (
        <Modal
          title={`${selectedIssue.io_number} · ${selectedIssue.type.replace(/_/g, " ")}`}
          sub={`${selectedIssue.advertiser_name} on ${selectedIssue.show_title}`}
          onClose={() => { if (!issueBusy) { setSelectedIssue(null); setConfirmingIssueDelete(false); } }}
          footer={confirmingIssueDelete ? (
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setConfirmingIssueDelete(false)} disabled={issueBusy}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => void deleteIssue(selectedIssue)} disabled={issueBusy}>
                {issueBusy ? <Spinner sm /> : <Icon name="close" />} Delete permanently
              </button>
            </>
          ) : (
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setSelectedIssue(null)}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => setConfirmingIssueDelete(true)}><Icon name="close" /> Delete</button>
              <button className="sl-btn sl-btn-primary" onClick={() => { setEditingIssue(selectedIssue); setSelectedIssue(null); }}><Icon name="edit" /> Edit</button>
            </>
          )}
        >
          {confirmingIssueDelete ? (
            <div className="sl-confirm-copy">
              <span className="sl-confirm-icon"><Icon name="alert" /></span>
              <div><strong>This action cannot be undone.</strong><p>The issue will be removed. Linked makegoods will remain, but their issue link will be cleared.</p></div>
            </div>
          ) : (
            <>
              <div className="sl-record-grid">
                <div className="sl-record-metric"><span>Severity</span><strong>{selectedIssue.severity}</strong></div>
                <div className={`sl-record-metric ${selectedIssue.resolved ? "sl-record-ok" : "sl-record-warn"}`}><span>State</span><strong>{selectedIssue.resolved ? "Resolved" : "Open"}</strong></div>
                <div className="sl-record-metric"><span>Created</span><strong>{formatDateTime(selectedIssue.created_at)}</strong></div>
                <div className="sl-record-metric"><span>Makegoods</span><strong>{formatNumber(selectedIssue.makegood_count)}</strong></div>
              </div>
              <div className="sl-record-copy">
                <span>Description</span>
                <p>{selectedIssue.description}</p>
              </div>
              <div className="sl-record-actions">
                {!selectedIssue.resolved ? (
                  <>
                    <button className="sl-btn sl-btn-outline" onClick={() => { setMakegoodFor(selectedIssue); setSelectedIssue(null); }}><Icon name="dollar" /> Makegood</button>
                    <button className="sl-btn sl-btn-outline" onClick={() => void setResolved(selectedIssue, true)} disabled={issueBusy}>{issueBusy ? <Spinner sm /> : <Icon name="check" />} Resolve issue</button>
                  </>
                ) : (
                  <button className="sl-btn sl-btn-outline" onClick={() => void setResolved(selectedIssue, false)} disabled={issueBusy}>{issueBusy ? <Spinner sm /> : <Icon name="refresh" />} Reopen issue</button>
                )}
              </div>
            </>
          )}
        </Modal>
      ) : null}

      {createOpen ? (
        <CreateIssueModal
          onClose={() => setCreateOpen(false)}
          onCreated={loadAll}
          push={push}
        />
      ) : null}

      {makegoodFor ? (
        <MakegoodModal
          issue={makegoodFor}
          onClose={() => setMakegoodFor(null)}
          onDone={loadAll}
          push={push}
        />
      ) : null}

      {editingIssue ? (
        <EditIssueModal
          issue={editingIssue}
          onClose={() => setEditingIssue(null)}
          onSaved={loadAll}
          push={push}
        />
      ) : null}
    </main>
  );
}

function KpiMini({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <article className="sl-kpi">
      <div className={`sl-kpi-accent sl-accent-${accent}`} />
      <div className="sl-kpi-body">
        <div className="sl-kpi-top"><span className="sl-kpi-label">{label}</span></div>
        <div className="sl-kpi-value">{value}</div>
      </div>
    </article>
  );
}

function CreateIssueModal({ onClose, onCreated, push }: {
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [type, setType] = useState<string>("under_delivery");
  const [severity, setSeverity] = useState<string>("medium");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.campaigns({ pageSize: 100 }).then((res) => {
      setCampaigns(res.rows);
      if (res.rows.length > 0) setCampaignId(res.rows[0].id);
    }).catch(() => undefined);
  }, []);

  const submit = async () => {
    if (busy) return;
    if (!campaignId) { setError("Pick a campaign."); return; }
    if (!description.trim()) { setError("Description is required."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.createIssue({ campaign_id: campaignId, type, severity, description: description.trim() });
      push("success", "Issue created.");
      await onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create issue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New reconciliation issue"
      sub="Flag a delivery problem, discrepancy, or missing aircheck on any campaign."
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sl-btn sl-btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner sm /> : <Icon name="plus" />} Create issue
          </button>
        </>
      }
    >
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <div className="sl-form-grid">
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">Campaign *</span>
          <select className="sl-select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.io_number} — {c.advertiser_name} / {c.show_title}</option>)}
          </select>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Type *</span>
          <select className="sl-select" value={type} onChange={(e) => setType(e.target.value)}>
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Severity *</span>
          <select className="sl-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">Description *</span>
          <textarea
            className="sl-input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Ad server count differs from publisher report by 4%"
          />
        </label>
      </div>
    </Modal>
  );
}

function EditIssueModal({ issue, onClose, onSaved, push }: {
  issue: IssueRow;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [type, setType] = useState(issue.type);
  const [severity, setSeverity] = useState(issue.severity);
  const [description, setDescription] = useState(issue.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!description.trim()) { setError("Description is required."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.updateIssue(issue.id, { type, severity, description: description.trim() });
      push("success", `Issue ${issue.io_number} updated.`);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update issue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit issue · ${issue.io_number}`}
      sub={`${issue.advertiser_name} on ${issue.show_title}`}
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sl-btn sl-btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner sm /> : <Icon name="edit" />} Save changes</button>
        </>
      }
    >
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <div className="sl-form-grid">
        <label className="sl-field">
          <span className="sl-field-label">Type</span>
          <select className="sl-select" value={type} onChange={(e) => setType(e.target.value)}>
            {ISSUE_TYPES.map((option) => <option key={option} value={option}>{option.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Severity</span>
          <select className="sl-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {SEVERITIES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">Description</span>
          <textarea className="sl-input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        </label>
      </div>
    </Modal>
  );
}

function MakegoodModal({ issue, onClose, onDone, push }: {
  issue: IssueRow;
  onClose: () => void;
  onDone: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [impressions, setImpressions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const imp = parseInt(impressions, 10);
    if (!imp || imp <= 0) { setError("Enter a positive number of impressions."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.createMakegood(issue.campaign_id, { impressions: imp, issue_id: issue.id });
      push("success", `Makegood logged for IO ${issue.io_number}.`);
      await onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create makegood.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Log a makegood"
      sub={`IO ${issue.io_number} · linked to “${issue.type.replace(/_/g, " ")}” issue`}
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sl-btn sl-btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner sm /> : <Icon name="check" />} Grant makegood
          </button>
        </>
      }
    >
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <label className="sl-field">
        <span className="sl-field-label">Impressions to grant *</span>
        <input className="sl-input" type="number" min={1} value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="5000" autoFocus />
        <span className="sl-form-hint">The server caps the grant at the remaining undelivered impressions.</span>
      </label>
    </Modal>
  );
}
