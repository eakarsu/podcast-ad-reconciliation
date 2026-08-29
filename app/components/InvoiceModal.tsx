"use client";

import { useEffect, useState } from "react";
import { api, formatCurrency, formatDate, formatNumber } from "../lib/api";
import type { InvoiceData } from "../lib/types";
import { Icon, Modal, Spinner, StatusPill } from "../lib/ui";

export default function InvoiceModal({ campaignId, onClose, push }: {
  campaignId: string;
  onClose: () => void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const d = await api.invoice(campaignId);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to generate invoice.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const print = () => {
    push("success", "Opening print dialog — choose “Save as PDF” to export the invoice.");
    setTimeout(() => window.print(), 150);
  };

  return (
    <Modal
      title={data ? `Invoice ${data.invoice_number}` : "Generating invoice…"}
      sub={data ? `${data.organization.name} · ${data.advertiser.name}` : undefined}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose}>Close</button>
          <button className="sl-btn sl-btn-primary" onClick={print} disabled={!data}>
            <Icon name="print" /> Print / Save PDF
          </button>
        </>
      }
    >
      {loading ? (
        <div className="sl-panel-loading"><Spinner /> Building invoice…</div>
      ) : error ? (
        <div className="sl-inline-error"><Icon name="alert" /> {error}</div>
      ) : data ? (
        <div className="sl-invoice-print">
          <div className="sl-invoice">
            <div className="sl-inv-head">
              <div>
                <div className="sl-inv-brand">Signal<span>Ledger</span></div>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>{data.organization.name}</p>
              </div>
              <div className="sl-inv-meta">
                <span>INVOICE <b>{data.invoice_number}</b></span>
                <span>Issued <b>{formatDate(data.issued_at)}</b></span>
                <span>Flight <b>{formatDate(data.campaign.start_date)} → {formatDate(data.campaign.end_date)}</b></span>
              </div>
            </div>

            <div className="sl-inv-parties">
              <div className="sl-inv-party">
                <h5>Billed to</h5>
                <p><strong>{data.advertiser.name}</strong><br />{data.advertiser.contact_email || "—"}<br />Podcast: {data.show}</p>
              </div>
              <div className="sl-inv-party">
                <h5>Campaign</h5>
                <p>
                  IO <strong>{data.campaign.io_number}</strong>
                  <br />Committed {formatNumber(data.campaign.committed_impressions)} impressions
                  <br />Delivered {formatNumber(data.campaign.delivered_impressions)} impressions
                  <br />CPM {formatCurrency(data.campaign.cpm)}
                </p>
                <span className="sl-inv-status"><StatusPill status={data.campaign.status} /></span>
              </div>
            </div>

            <table className="sl-inv-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="sl-th-right">Impressions</th>
                  <th className="sl-th-right">Rate</th>
                  <th className="sl-th-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Delivered impressions ({data.show})</td>
                  <td className="sl-num">{formatNumber(data.campaign.delivered_impressions)}</td>
                  <td className="sl-num">{formatCurrency(data.campaign.cpm)} CPM</td>
                  <td className="sl-num">{formatCurrency(data.totals.delivered_value)}</td>
                </tr>
                {data.totals.makegood_value > 0 ? (
                  <tr>
                    <td>Makegood credit — {formatNumber(data.totals.makegood_impressions)} granted impressions</td>
                    <td className="sl-num">({formatNumber(data.totals.makegood_impressions)})</td>
                    <td className="sl-num">—</td>
                    <td className="sl-num" style={{ color: "var(--neg)" }}>({formatCurrency(data.totals.makegood_value)})</td>
                  </tr>
                ) : null}
              </tbody>
            </table>

            <div className="sl-inv-totals">
              <table className="sl-inv-totals-table">
                <tbody>
                  <tr><td>Committed value</td><td>{formatCurrency(data.totals.committed_value)}</td></tr>
                  <tr><td>Delivered value</td><td>{formatCurrency(data.totals.delivered_value)}</td></tr>
                  {data.totals.makegood_value > 0 ? <tr><td>Makegood credit</td><td>({formatCurrency(data.totals.makegood_value)})</td></tr> : null}
                  <tr className="sl-inv-net"><td>Net due</td><td>{formatCurrency(data.totals.net_due)}</td></tr>
                </tbody>
              </table>
            </div>

            <p className="sl-inv-note">
              Reconciliation summary: {formatNumber(data.campaign.delivered_impressions)} of {formatNumber(data.campaign.committed_impressions)} committed impressions
              ({data.campaign.committed_impressions > 0 ? ((data.campaign.delivered_impressions / data.campaign.committed_impressions) * 100).toFixed(1) : "0"}% delivery).
              {data.totals.makegood_value > 0 ? ` Includes approved makegood credit of ${formatCurrency(data.totals.makegood_value)}.` : ""}
              {" "}Net due is capped at zero if credits exceed delivered value.
            </p>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
