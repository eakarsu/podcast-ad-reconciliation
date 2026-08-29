"use client";

import { useCallback, useRef, useState } from "react";
import type { CampaignStatus, PacingStatus, SortDir, SortKey } from "./types";

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

export function Icon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "search":
      return (<svg {...common}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>);
    case "refresh":
      return (<svg {...common}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>);
    case "download":
      return (<svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>);
    case "upload":
      return (<svg {...common}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>);
    case "close":
      return (<svg {...common}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
    case "chevron":
      return (<svg {...common}><polyline points="9 18 15 12 9 6" /></svg>);
    case "sort":
      return (<svg {...common}><path d="M8 3v18" /><path d="M4 7l4-4 4 4" /><path d="M16 21V3" /><path d="M20 17l-4 4-4-4" /></svg>);
    case "pulse":
      return (<svg {...common}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>);
    case "alert":
      return (<svg {...common}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>);
    case "check":
      return (<svg {...common}><polyline points="20 6 9 17 4 12" /></svg>);
    case "mic":
      return (<svg {...common}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="22" /></svg>);
    case "shield":
      return (<svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>);
    case "grid":
      return (<svg {...common}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>);
    case "file":
      return (<svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>);
    case "plus":
      return (<svg {...common}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
    case "edit":
      return (<svg {...common}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>);
    case "print":
      return (<svg {...common}><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>);
    case "flag":
      return (<svg {...common}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>);
    case "dollar":
      return (<svg {...common}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Small presentational pieces                                        */
/* ------------------------------------------------------------------ */

export function StatusPill({ status }: { status: CampaignStatus }) {
  return <span className={`sl-pill sl-status-${status}`}>{status}</span>;
}

export function PacingBadge({ pacing }: { pacing: PacingStatus }) {
  const label = pacing === "not_started" ? "Not started" : pacing === "on_track" ? "On track" : pacing === "slight_risk" ? "Slight risk" : pacing === "at_risk" ? "At risk" : "Behind";
  return <span className={`sl-badge sl-pacing-${pacing}`}><span className="sl-dot" />{label}</span>;
}

export function VarianceCell({ v }: { v: number }) {
  const cls = v >= 0 ? "sl-var-pos" : "sl-var-neg";
  return <span className={cls}>{`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}</span>;
}

export function ProgressBar({ pct, tone }: { pct: number; tone: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="sl-progress" role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`sl-progress-fill sl-tone-${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function KpiCard({ label, value, sub, accent, icon }: { label: string; value: string; sub?: string; accent: string; icon: string }) {
  return (
    <article className="sl-kpi">
      <div className={`sl-kpi-accent sl-accent-${accent}`} />
      <div className="sl-kpi-body">
        <div className="sl-kpi-top">
          <span className="sl-kpi-label">{label}</span>
          <span className={`sl-kpi-icon sl-accent-${accent}`}><Icon name={icon} /></span>
        </div>
        <div className="sl-kpi-value">{value}</div>
        {sub ? <div className="sl-kpi-sub">{sub}</div> : null}
      </div>
    </article>
  );
}

export function Th({ label, k, sortKey, sortDir, onSort }: { label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; onSort: (k: SortKey) => void }) {
  const active = sortKey === k;
  return (
    <th className="sl-th-sortable">
      <button className={`sl-sortbtn ${active ? "sl-active" : ""}`} onClick={() => onSort(k)} aria-label={`Sort by ${label}`}>
        {label}
        <span className="sl-sort-arrow">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return <p className="sl-empty-line">{text}</p>;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, disabled }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  disabled?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  for (let i = start; i < start + 5 && i <= pageCount; i++) pages.push(i);

  return (
    <nav className="sl-pagination" aria-label="Pagination" style={disabled ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
      <span className="sl-page-info">
        {from}–{to} of {formatInt(total)}
      </span>
      <div className="sl-page-controls">
        <button className="sl-pagebtn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
        {pages.map((p) => (
          <button
            key={p}
            className={`sl-pagebtn ${p === page ? "sl-pagebtn-active" : ""}`}
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
          >
            {p}
          </button>
        ))}
        <button className="sl-pagebtn" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label="Next page">›</button>
      </div>
      {onPageSize ? (
        <label className="sl-page-size">
          <select className="sl-select" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100].map((s) => <option key={s} value={s}>{s} / page</option>)}
          </select>
        </label>
      ) : null}
    </nav>
  );
}

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function Spinner({ sm }: { sm?: boolean }) {
  return <span className={`sl-spinner ${sm ? "sm" : ""}`} />;
}

/* ------------------------------------------------------------------ */
/*  Notices                                                            */
/* ------------------------------------------------------------------ */

export type NoticeTone = "success" | "error" | "info";
export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
}

export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const seq = useRef(0);
  const push = useCallback((tone: NoticeTone, message: string) => {
    const id = ++seq.current;
    setNotices((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 5000);
  }, []);
  const dismiss = useCallback((id: number) => setNotices((prev) => prev.filter((n) => n.id !== id)), []);
  return { notices, push, dismiss };
}

export function Notices({ notices, dismiss }: { notices: Notice[]; dismiss: (id: number) => void }) {
  return (
    <div className="sl-notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`sl-notice sl-notice-${n.tone}`}>
          <span className="sl-notice-icon"><Icon name={n.tone === "success" ? "check" : n.tone === "error" ? "alert" : "shield"} /></span>
          <span className="sl-notice-msg">{n.message}</span>
          <button className="sl-notice-x" onClick={() => dismiss(n.id)} aria-label="Dismiss"><Icon name="close" /></button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

export function Modal({ title, sub, onClose, children, footer, wide }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <div className="sl-modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={`sl-modal ${wide ? "sl-modal-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sl-modal-head">
          <div>
            <h2 className="sl-modal-title">{title}</h2>
            {sub ? <p className="sl-modal-sub">{sub}</p> : null}
          </div>
          <button className="sl-iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="sl-modal-body">{children}</div>
        {footer ? <div className="sl-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page header                                                        */
/* ------------------------------------------------------------------ */

export function PageHead({ title, tagline, actions }: { title: string; tagline?: string; actions?: React.ReactNode }) {
  return (
    <div className="sl-pagehead">
      <div>
        <h2 className="sl-pagehead-title">{title}</h2>
        {tagline ? <p className="sl-pagehead-tagline">{tagline}</p> : null}
      </div>
      {actions ? <div className="sl-pagehead-actions">{actions}</div> : null}
    </div>
  );
}
