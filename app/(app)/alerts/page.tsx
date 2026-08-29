"use client";
import { useCallback, useEffect, useState } from "react";
import { api, formatDate } from "../../lib/api";
import type { AlertRow } from "../../lib/types";
import {
  Icon,
  Modal,
  Notices,
  PageHead,
  Spinner,
  useNotices,
} from "../../lib/ui";
export default function AlertsPage() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [selected, setSelected] = useState<AlertRow | null>(null);
  const [status, setStatus] = useState("open");
  const [busy, setBusy] = useState(false);
  const { notices, push, dismiss } = useNotices();
  const load = useCallback(async () => {
    try {
      setRows(await api.alerts(status));
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not load alerts.");
    }
  }, [status, push]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const update = async (value: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.updateAlert(selected.id, value);
      push("success", `Alert ${value}.`);
      setSelected(null);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };
  const detect = async () => {
    setBusy(true);
    try {
      const result = await api.detectAlerts();
      push("success", `${result.created} new alerts detected.`);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Detection failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Alerts"
        tagline="Under-delivery, missing airchecks, and campaign deadlines"
        actions={
          <button
            className="sl-btn sl-btn-primary"
            disabled={busy}
            onClick={() => void detect()}
          >
            {busy ? <Spinner sm /> : <Icon name="refresh" />} Run detection
          </button>
        }
      />
      <section className="sl-filters">
        <select
          className="sl-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <div className="sl-filter-meta">
          <span className="sl-count">{rows.length} alerts</span>
        </div>
      </section>
      <section className="sl-tablewrap">
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Campaign</th>
                <th>Podcast</th>
                <th>Severity</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => setSelected(row)}>
                  <td className="sl-cell-name">
                    <span className="sl-advertiser">{row.title}</span>
                    <span className="sl-show">{row.message}</span>
                  </td>
                  <td className="sl-cell-io">{row.io_number || "—"}</td>
                  <td>{row.podcast_title || "—"}</td>
                  <td>
                    <span className={`sl-pill sl-sev-${row.severity}`}>
                      {row.severity}
                    </span>
                  </td>
                  <td>{row.due_at ? formatDate(row.due_at) : "—"}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? (
          <p className="sl-empty-line">No {status} alerts.</p>
        ) : null}
      </section>
      {selected ? (
        <Modal
          title={selected.title}
          sub={`${selected.alert_type.replaceAll("_", " ")} · ${selected.severity} severity`}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button
                className="sl-btn sl-btn-ghost"
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              {selected.status !== "dismissed" ? (
                <button
                  className="sl-btn sl-btn-outline"
                  disabled={busy}
                  onClick={() => void update("dismissed")}
                >
                  Dismiss
                </button>
              ) : null}
              {selected.status !== "resolved" ? (
                <button
                  className="sl-btn sl-btn-primary"
                  disabled={busy}
                  onClick={() => void update("resolved")}
                >
                  <Icon name="check" /> Resolve
                </button>
              ) : (
                <button
                  className="sl-btn sl-btn-primary"
                  disabled={busy}
                  onClick={() => void update("open")}
                >
                  Reopen
                </button>
              )}
            </>
          }
        >
          <p>{selected.message}</p>
          <div className="sl-record-grid">
            <div className="sl-record-metric">
              <span>Campaign</span>
              <strong>{selected.io_number || "Not linked"}</strong>
            </div>
            <div className="sl-record-metric">
              <span>Created</span>
              <strong>{formatDate(selected.created_at)}</strong>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
