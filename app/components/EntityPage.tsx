"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatCurrency, formatNumber } from "../lib/api";
import type { AdvertiserRow, ShowRow } from "../lib/types";
import { Icon, Modal, Notices, PageHead, Pagination, Spinner, useNotices } from "../lib/ui";
import SampleDataButton from "./SampleDataButton";

type Row = (ShowRow & { title?: string; category?: string | null; contact_email?: string | null; name?: string }) &
  (AdvertiserRow & { title?: string; category?: string | null; contact_email?: string | null; name?: string });

export default function EntityPage({ kind }: { kind: "show" | "advertiser" }) {
  const isShow = kind === "show";
  const title = isShow ? "Shows" : "Advertisers";
  const singular = isShow ? "show" : "advertiser";

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { notices, push, dismiss } = useNotices();

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = isShow
        ? await api.shows({ q: debouncedQ || undefined, page, pageSize })
        : await api.advertisers({ q: debouncedQ || undefined, page, pageSize });
      setRows(res.rows as Row[]);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach the reconciliation API.");
    } finally {
      setLoading(false);
    }
  }, [isShow, debouncedQ, page, pageSize]);

  useEffect(() => {
    const timer = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(timer);
  }, [loadAll]);

  const submitForm = async (body: Record<string, string>) => {
    try {
      if (editing) {
        if (isShow) await api.updateShow(editing.id, { title: body.title, category: body.category });
        else await api.updateAdvertiser(editing.id, { name: body.name, contact_email: body.contact_email });
        push("success", `${singular === "show" ? "Show" : "Advertiser"} updated.`);
      } else {
        if (isShow) await api.createShow({ title: body.title, category: body.category });
        else await api.createAdvertiser({ name: body.name, contact_email: body.contact_email });
        push("success", `${singular === "show" ? "Show" : "Advertiser"} created.`);
      }
      setFormOpen(false);
      setEditing(null);
      await loadAll();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Save failed.");
      throw e;
    }
  };

  const remove = async (row: Row) => {
    const label = isShow ? row.title! : row.name;
    setDeleting(true);
    try {
      if (isShow) await api.deleteShow(row.id);
      else await api.deleteAdvertiser(row.id);
      push("success", `Deleted "${label}".`);
      setSelected(null);
      setConfirmingDelete(false);
      await loadAll();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const nameOf = (r: Row) => (isShow ? r.title || "" : r.name || "");

  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title={title}
        tagline={isShow ? "Podcasts you sell inventory on" : "Brands buying inventory, with delivery performance"}
        actions={
          <button className="sl-btn sl-btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Icon name="plus" /> New {singular}
          </button>
        }
      />

      {error ? (
        <div className="sl-banner sl-banner-error" role="alert">
          <span className="sl-banner-icon"><Icon name="alert" /></span>
          <div className="sl-banner-body"><strong>Connection problem.</strong> {error}</div>
          <button className="sl-btn sl-btn-outline" onClick={() => void loadAll()}>Retry</button>
        </div>
      ) : null}

      <section className="sl-filters" aria-label="Filters">
        <div className="sl-search">
          <span className="sl-search-icon"><Icon name="search" /></span>
          <input className="sl-input" type="search" placeholder={`Search ${isShow ? "titles or categories" : "names or emails"}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${title.toLowerCase()}`} />
        </div>
        <div className="sl-filter-meta">
          <span className="sl-count">{formatNumber(total)} total</span>
        </div>
      </section>

      <section className="sl-tablewrap" aria-label={title}>
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th>{isShow ? "Title" : "Name"}</th>
                <th>{isShow ? "Category" : "Contact"}</th>
                <th className="sl-th-right">Campaigns</th>
                <th className="sl-th-right">Committed</th>
                <th className="sl-th-right">Delivered</th>
                <th className="sl-th-right">Delivered value</th>
                <th className="sl-th-center">Open issues</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="sl-row-skeleton">
                    {Array.from({ length: 7 }).map((__, j) => <td key={j}><span className="sl-bar" /></td>)}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="sl-empty">
                      <span className="sl-empty-icon"><Icon name={isShow ? "mic" : "dollar"} /></span>
                      <h3>No {title.toLowerCase()} yet</h3>
                      <p>{`Create one manually, or they'll be auto-created when you import IOs.`}</p>
                      {!debouncedQ ? (
                        <div className="sl-empty-actions">
                          <SampleDataButton onLoaded={loadAll} push={push} />
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="sl-row"
                    tabIndex={0}
                    onClick={() => { setSelected(r); setConfirmingDelete(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(r);
                        setConfirmingDelete(false);
                      }
                    }}
                    aria-label={`Open ${singular} details for ${nameOf(r)}`}
                  >
                    <td className="sl-cell-io">{nameOf(r)}</td>
                    <td className="sl-cell-name">
                      {isShow ? (
                        <span className="sl-show">{r.category || "—"}</span>
                      ) : (
                        <span className="sl-show">{r.contact_email || "—"}</span>
                      )}
                    </td>
                    <td className="sl-cell-num">
                      {r.campaign_count}
                      {r.active_campaigns > 0 ? <span className="sl-show"> ({r.active_campaigns} active)</span> : null}
                    </td>
                    <td className="sl-cell-num">{formatNumber(r.committed_impressions)}</td>
                    <td className="sl-cell-num">{formatNumber(r.delivered_impressions)}</td>
                    <td className="sl-cell-num">{formatCurrency(r.delivered_value)}</td>
                    <td className="sl-th-center">
                      {r.open_issues > 0 ? <span className="sl-flag sl-flag-issue">{r.open_issues}</span> : <span className="sl-muted">—</span>}
                    </td>
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

      {selected ? (
        <Modal
          title={confirmingDelete ? `Delete ${nameOf(selected)}?` : nameOf(selected)}
          sub={confirmingDelete
            ? `This ${singular} can only be deleted when it has no linked campaigns.`
            : `Review this ${singular}, then choose an action.`}
          onClose={() => { if (!deleting) { setSelected(null); setConfirmingDelete(false); } }}
          footer={confirmingDelete ? (
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => void remove(selected)} disabled={deleting}>
                {deleting ? <Spinner sm /> : <Icon name="close" />} Delete permanently
              </button>
            </>
          ) : (
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => setConfirmingDelete(true)}>
                <Icon name="close" /> Delete
              </button>
              <button className="sl-btn sl-btn-primary" onClick={() => { setEditing(selected); setSelected(null); setFormOpen(true); }}>
                <Icon name="edit" /> Edit
              </button>
            </>
          )}
        >
          {confirmingDelete ? (
            <div className="sl-confirm-copy">
              <span className="sl-confirm-icon"><Icon name="alert" /></span>
              <div>
                <strong>This action cannot be undone.</strong>
                <p>If campaigns reference this {singular}, SignalLedger will keep it and explain why deletion is blocked.</p>
              </div>
            </div>
          ) : (
            <div className="sl-record-grid">
              <RecordMetric label={isShow ? "Category" : "Contact"} value={isShow ? selected.category || "Not categorized" : selected.contact_email || "No email"} />
              <RecordMetric label="Campaigns" value={`${formatNumber(selected.campaign_count)} total · ${formatNumber(selected.active_campaigns)} active`} />
              <RecordMetric label="Committed impressions" value={formatNumber(selected.committed_impressions)} />
              <RecordMetric label="Delivered impressions" value={formatNumber(selected.delivered_impressions)} />
              <RecordMetric label="Delivered value" value={formatCurrency(selected.delivered_value)} />
              <RecordMetric label="Open issues" value={selected.open_issues ? formatNumber(selected.open_issues) : "None"} tone={selected.open_issues ? "warn" : "ok"} />
            </div>
          )}
        </Modal>
      ) : null}

      {formOpen ? (
        <EntityForm
          kind={kind}
          existing={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSubmit={submitForm}
        />
      ) : null}
    </main>
  );
}

function RecordMetric({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className={`sl-record-metric ${tone ? `sl-record-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EntityForm({ kind, existing, onClose, onSubmit }: {
  kind: "show" | "advertiser";
  existing: Row | null;
  onClose: () => void;
  onSubmit: (body: Record<string, string>) => Promise<void>;
}) {
  const isShow = kind === "show";
  const [title, setTitle] = useState(isShow ? existing?.title || "" : "");
  const [name, setName] = useState(!isShow ? existing?.name || "" : "");
  const [category, setCategory] = useState(isShow ? existing?.category || "" : "");
  const [email, setEmail] = useState(!isShow ? existing?.contact_email || "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const body: Record<string, string> = isShow
      ? { title: title.trim(), category: category.trim() }
      : { name: name.trim(), contact_email: email.trim() };
    if (!Object.values(body)[0]) {
      setError(isShow ? "Title is required." : "Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit ${isShow ? "show" : "advertiser"}` : `New ${isShow ? "show" : "advertiser"}`}
      sub={existing ? "Changes apply immediately across the workspace." : "New records are also auto-created during CSV imports."}
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sl-btn sl-btn-primary" onClick={(e) => void submit(e as unknown as React.FormEvent)} disabled={busy}>
            {busy ? <Spinner sm /> : <Icon name="check" />} Save
          </button>
        </>
      }
    >
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <div className="sl-form-grid">
        {isShow ? (
          <>
            <label className="sl-field">
              <span className="sl-field-label">Title *</span>
              <input className="sl-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tech Today" autoFocus />
            </label>
            <label className="sl-field">
              <span className="sl-field-label">Category</span>
              <input className="sl-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Technology" />
            </label>
          </>
        ) : (
          <>
            <label className="sl-field">
              <span className="sl-field-label">Name *</span>
              <input className="sl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="CloudCorp Inc." autoFocus />
            </label>
            <label className="sl-field">
              <span className="sl-field-label">Contact email</span>
              <input className="sl-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ads@cloudcorp.com" />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
