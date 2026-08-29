"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatCurrency, formatDate } from "../../lib/api";
import type { CampaignRow, InvoiceRow } from "../../lib/types";
import {
  Icon,
  Modal,
  Notices,
  PageHead,
  Spinner,
  useNotices,
} from "../../lib/ui";
export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [ready, setReady] = useState<CampaignRow[]>([]);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const { notices, push, dismiss } = useNotices();
  const load = useCallback(async () => {
    try {
      const [i, c] = await Promise.all([
        api.invoiceRecords(),
        api.campaigns({ ready: "true", pageSize: 500 }),
      ]);
      setRows(i);
      setReady(c.rows);
    } catch (e) {
      push(
        "error",
        e instanceof Error ? e.message : "Could not load invoices.",
      );
    }
  }, [push]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const ungenerated = useMemo(
    () => ready.filter((c) => !rows.some((i) => i.campaign_id === c.id)),
    [ready, rows],
  );
  const generateAll = async () => {
    setBusy(true);
    try {
      for (const campaign of ungenerated)
        await api.generateInvoice(campaign.id);
      push("success", `Generated ${ungenerated.length} invoice records.`);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };
  const open = (row: InvoiceRow) => {
    setSelected(row);
    setStatus(row.status);
    setEmail(row.recipient_email || "");
  };
  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.updateInvoice(selected.id, { status, recipient_email: email });
      push("success", "Invoice updated.");
      setSelected(null);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.sendInvoice(selected.id, email);
      push("success", `Invoice sent to ${email}.`);
      setSelected(null);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Email failed.");
    } finally {
      setBusy(false);
    }
  };
  const total = rows
    .filter((r) => !["paid", "void"].includes(r.status))
    .reduce((sum, r) => sum + Number(r.amount), 0);
  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Invoices"
        tagline="Generate PDFs, deliver invoices by email, and track payment status"
        actions={
          <button
            className="sl-btn sl-btn-primary"
            disabled={busy || !ungenerated.length}
            onClick={() => void generateAll()}
          >
            {busy ? <Spinner sm /> : <Icon name="plus" />} Generate{" "}
            {ungenerated.length || "missing"} invoices
          </button>
        }
      />
      <section className="sl-kpis">
        <Kpi
          label="Open balance"
          value={formatCurrency(total)}
          sub="draft, sent, and overdue"
        />
        <Kpi
          label="Invoice records"
          value={String(rows.length)}
          sub={`${rows.filter((r) => r.status === "paid").length} paid`}
        />
        <Kpi
          label="Ready to generate"
          value={String(ungenerated.length)}
          sub="reconciled campaigns"
        />
      </section>
      <section className="sl-tablewrap">
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Advertiser / Podcast</th>
                <th>IO</th>
                <th>Status</th>
                <th>Issued / Due</th>
                <th className="sl-th-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => open(row)}>
                  <td className="sl-cell-io">{row.invoice_number}</td>
                  <td className="sl-cell-name">
                    <span className="sl-advertiser">{row.advertiser_name}</span>
                    <span className="sl-show">{row.podcast_title}</span>
                  </td>
                  <td>{row.io_number}</td>
                  <td>
                    <span className={`sl-pill sl-invoice-${row.status}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>
                    {formatDate(row.issued_at)} →{" "}
                    {row.due_at ? formatDate(row.due_at) : "—"}
                  </td>
                  <td className="sl-cell-num">
                    {formatCurrency(Number(row.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? (
          <p className="sl-empty-line">
            Generate invoice records from reconciled campaigns to get started.
          </p>
        ) : null}
      </section>
      {selected ? (
        <Modal
          title={selected.invoice_number}
          sub={`${selected.advertiser_name} · ${selected.podcast_title}`}
          onClose={() => !busy && setSelected(null)}
          footer={
            <>
              <button
                className="sl-btn sl-btn-ghost"
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <a
                className="sl-btn sl-btn-outline"
                href={api.invoicePdfUrl(selected.id)}
              >
                <Icon name="download" /> PDF
              </a>
              <button
                className="sl-btn sl-btn-outline"
                disabled={busy || !email}
                onClick={() => void send()}
              >
                <Icon name="file" /> Send email
              </button>
              <button
                className="sl-btn sl-btn-primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? <Spinner sm /> : <Icon name="check" />} Save
              </button>
            </>
          }
        >
          <div className="sl-form-grid">
            <label className="sl-field sl-form-full">
              <span className="sl-field-label">Recipient email</span>
              <input
                className="sl-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="sl-field">
              <span className="sl-field-label">Payment status</span>
              <select
                className="sl-select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="void">Void</option>
              </select>
            </label>
            <div className="sl-record-metric">
              <span>Amount</span>
              <strong>{formatCurrency(Number(selected.amount))}</strong>
            </div>
          </div>
          <p className="sl-modal-note">
            PDFs are rendered from reconciled delivery and makegood records.
            Email requires SMTP settings on the API server.
          </p>
        </Modal>
      ) : null}
    </main>
  );
}
function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <article className="sl-kpi">
      <div className="sl-kpi-accent sl-accent-ink" />
      <div className="sl-kpi-body">
        <span className="sl-kpi-label">{label}</span>
        <div className="sl-kpi-value">{value}</div>
        <div className="sl-kpi-sub">{sub}</div>
      </div>
    </article>
  );
}
