"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { api, downloadFile, formatDate, formatNumber } from "../../lib/api";
import type { CampaignRow, CampaignStatus, SortDir, SortKey } from "../../lib/types";
import { Icon, Notices, PageHead, Pagination, PacingBadge, StatusPill, Th, useNotices, VarianceCell } from "../../lib/ui";
import CampaignDetail from "../../components/CampaignDetail";
import CampaignForm from "../../components/CampaignForm";
import ImportModal from "../../components/ImportModal";
import InvoiceModal from "../../components/InvoiceModal";
import SampleDataButton from "../../components/SampleDataButton";

const STATUS_ORDER: CampaignStatus[] = ["draft", "active", "paused", "completed", "cancelled"];

export default function CampaignsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL is the source of truth for shareable state: q, status, show, start, end, sort, order, page, campaign
  const q = searchParams.get("q") || "";
  const statusFilter = searchParams.get("status") || "";
  const showFilter = searchParams.get("show") || "";
  const startFilter = searchParams.get("start") || "";
  const endFilter = searchParams.get("end") || "";
  const sortKey = (searchParams.get("sort") || "created_at") as SortKey;
  const sortDir = (searchParams.get("order") || "desc") as SortDir;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10) || 25);
  const selectedId = searchParams.get("campaign");

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qInput, setQInput] = useState(q);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);

  const [showTitles, setShowTitles] = useState<string[]>([]);
  const [advertiserNames, setAdvertiserNames] = useState<string[]>([]);

  const { notices, push, dismiss } = useNotices();

  // Keep the search box in sync when the URL changes externally (back/forward, shared links).
  // Render-time adjustment: if the input diverges from the URL param, adopt the URL value.
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    if (qInput !== q) setQInput(q);
  }

  // Debounce search input into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if (qInput.trim() !== q) setParams({ q: qInput.trim() || null, page: null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.campaigns({
        q,
        status: statusFilter,
        show: showFilter,
        start: startFilter,
        end: endFilter,
        sort: sortKey,
        order: sortDir,
        page,
        pageSize,
      });
      setCampaigns(res.rows);
      setTotal(res.total);
      if (res.rows.length === 0 && page > 1) setParams({ page: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach the reconciliation API.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, statusFilter, showFilter, startFilter, endFilter, sortKey, sortDir, page, pageSize]);

  useEffect(() => {
    const timer = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(timer);
  }, [loadAll]);

  useEffect(() => {
    void api.shows({ pageSize: 100 }).then((res) => setShowTitles(res.rows.map((r) => r.title))).catch(() => undefined);
    void api.advertisers({ pageSize: 100 }).then((res) => setAdvertiserNames(res.rows.map((r) => r.name))).catch(() => undefined);
  }, [formOpen]);

  const showOptions = useMemo(() => {
    const set = new Set<string>(showTitles);
    campaigns.forEach((c) => set.add(c.show_title));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [showTitles, campaigns]);

  const openEdit = (campaign: CampaignRow) => {
    setEditing(campaign);
    setFormOpen(true);
  };
  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const resetFilters = () => {
    router.replace(pathname, { scroll: false });
    setQInput("");
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setParams({ order: sortDir === "asc" ? "desc" : "asc" });
    else setParams({ sort: key, order: "desc" });
  };

  const hasActiveFilters = Boolean(q || statusFilter || showFilter || startFilter || endFilter);

  const exportCsv = async () => {
    try {
      await downloadFile(api.exportUrl({ q, status: statusFilter, show: showFilter, start: startFilter, end: endFilter }), "reconciliation_report.csv");
      push("success", "CSV export downloaded.");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Export failed.");
    }
  };

  const shareLink = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    void navigator.clipboard?.writeText(url);
    push("info", "Shareable link copied to clipboard.");
  };

  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Campaigns"
        tagline="Insertion orders, delivery pacing, and reconciliation flags"
        actions={
          <>
            <button className="sl-btn sl-btn-ghost" onClick={shareLink} title="Copy a shareable link to this view">
              <Icon name="shield" /> Share view
            </button>
            <button className="sl-btn sl-btn-outline" onClick={() => void exportCsv()}>
              <Icon name="download" /> Export CSV
            </button>
            <button className="sl-btn sl-btn-ghost" onClick={() => setImportOpen(true)}>
              <Icon name="upload" /> Import
            </button>
            <button className="sl-btn sl-btn-primary" onClick={openNew}>
              <Icon name="plus" /> New campaign
            </button>
          </>
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

      <section className="sl-filters" aria-label="Filters">
        <div className="sl-search">
          <span className="sl-search-icon"><Icon name="search" /></span>
          <input className="sl-input" type="search" placeholder="Search IO number, advertiser, or podcast…" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Search campaigns" />
        </div>
        <label className="sl-field">
          <span className="sl-field-label">Status</span>
          <select className="sl-select" value={statusFilter} onChange={(e) => setParams({ status: e.target.value || null, page: null })} aria-label="Filter by status">
            <option value="">All statuses</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Podcast</span>
          <select className="sl-select" value={showFilter} onChange={(e) => setParams({ show: e.target.value || null, page: null })} aria-label="Filter by podcast">
            <option value="">All podcasts</option>
            {showOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="sl-field sl-range-fields">
          <label className="sl-field">
            <span className="sl-field-label">Flight from</span>
            <input className="sl-input" type="date" value={startFilter} onChange={(e) => setParams({ start: e.target.value || null, page: null })} aria-label="Flights ending on or after" />
          </label>
          <label className="sl-field">
            <span className="sl-field-label">Flight to</span>
            <input className="sl-input" type="date" value={endFilter} onChange={(e) => setParams({ end: e.target.value || null, page: null })} aria-label="Flights starting on or before" />
          </label>
        </div>
        <div className="sl-filter-meta">
          <span className="sl-count">{formatNumber(total)} total</span>
          {hasActiveFilters ? <button className="sl-linkbtn" onClick={resetFilters}>Clear filters</button> : null}
        </div>
      </section>

      <section className="sl-tablewrap" aria-label="Campaigns">
          <div className="sl-table-scroll">
            <table className="sl-table">
              <thead>
                <tr>
                  <Th label="IO #" k="io_number" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="sl-th-left">Advertiser / Podcast</th>
                  <Th label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="sl-th-left">Dates</th>
                  <th className="sl-th-right">Committed</th>
                  <th className="sl-th-right">Delivered</th>
                  <th className="sl-th-right">Var %</th>
                  <th className="sl-th-left">Pacing</th>
                  <th className="sl-th-center">Flags</th>
                </tr>
              </thead>
              <tbody>
                {loading && campaigns.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="sl-row-skeleton">
                      {Array.from({ length: 9 }).map((__, j) => <td key={j}><span className="sl-bar" /></td>)}
                    </tr>
                  ))
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="sl-empty">
                        <span className="sl-empty-icon"><Icon name="search" /></span>
                        <h3>No campaigns match your filters</h3>
                        <p>Try clearing search or status filters, import reconciliation data, or create a campaign manually.</p>
                        <div className="sl-empty-actions">
                          {hasActiveFilters ? <button className="sl-btn sl-btn-outline" onClick={resetFilters}>Reset filters</button> : null}
                          {!hasActiveFilters ? <SampleDataButton onLoaded={loadAll} push={push} /> : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <tr
                      key={c.id}
                      className={`sl-row ${selectedId === c.id ? "sl-row-active" : ""}`}
                      tabIndex={0}
                      onClick={() => setParams({ campaign: c.id })}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setParams({ campaign: c.id }); } }}
                      aria-selected={selectedId === c.id}
                    >
                      <td className="sl-cell-io">{c.io_number}</td>
                      <td className="sl-cell-name">
                        <span className="sl-advertiser">{c.advertiser_name}</span>
                        <span className="sl-show">{c.show_title}</span>
                      </td>
                      <td><StatusPill status={c.status} /></td>
                      <td className="sl-cell-dates">{formatDate(c.start_date)} → {formatDate(c.end_date)}</td>
                      <td className="sl-cell-num">{formatNumber(c.committed_impressions)}</td>
                      <td className="sl-cell-num">{formatNumber(c.delivered_impressions)}</td>
                      <td className="sl-cell-num"><VarianceCell v={c.variance_percent} /></td>
                      <td><PacingBadge pacing={c.pacing_status} /></td>
                      <td className="sl-cell-flags">
                        {c.open_issue_count > 0 ? <span className="sl-flag sl-flag-issue" title={`${c.open_issue_count} open issues`}>{c.open_issue_count}</span> : null}
                        {c.makegood_amount > 0 ? <span className="sl-flag sl-flag-mg" title="Makegoods applied">MG</span> : null}
                        {c.invoice_ready ? <span className="sl-flag sl-flag-ready" title="Invoice ready"><Icon name="check" /></span> : null}
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
            onPage={(p) => setParams({ page: p > 1 ? String(p) : null })}
            onPageSize={(s) => setParams({ pageSize: s !== 25 ? String(s) : null, page: null })}
          />
      </section>

      {selectedId ? (
        <div
          className="sl-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Campaign details"
          onClick={() => setParams({ campaign: null })}
        >
          <div className="sl-modal sl-campaign-modal" onClick={(e) => e.stopPropagation()}>
            <CampaignDetail
              key={selectedId}
              id={selectedId}
              onClose={() => setParams({ campaign: null })}
              onEdit={openEdit}
              onInvoice={(cid) => setInvoiceFor(cid)}
              onChanged={loadAll}
              push={push}
            />
          </div>
        </div>
      ) : null}

      {formOpen ? (
        <CampaignForm
          existing={editing}
          showTitles={showTitles}
          advertiserNames={advertiserNames}
          onClose={closeForm}
          onSaved={loadAll}
          push={push}
        />
      ) : null}

      {importOpen ? (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={loadAll}
          push={push}
        />
      ) : null}

      {invoiceFor ? (
        <InvoiceModal campaignId={invoiceFor} onClose={() => setInvoiceFor(null)} push={push} />
      ) : null}
    </main>
  );
}
