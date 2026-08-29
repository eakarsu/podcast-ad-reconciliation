"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatCurrency, formatDate, formatDateTime, formatNumber } from "../lib/api";
import type { CampaignDetail as CampaignDetailData, CampaignStatus, DeliveryRecord, Makegood } from "../lib/types";
import { EmptyLine, Icon, Modal, PacingBadge, ProgressBar, Spinner, StatusPill, VarianceCell } from "../lib/ui";

const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

const DELIVERY_SOURCES = ["manual", "ad_server", "api", "import"];

export default function CampaignDetail({ id, onClose, onEdit, onInvoice, onChanged, push }: {
  id: string;
  onClose: () => void;
  onEdit: (campaign: CampaignDetailData) => void;
  onInvoice: (campaignId: string) => void;
  onChanged: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [detail, setDetail] = useState<CampaignDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<CampaignStatus | null>(null);
  const [makegoodImpressions, setMakegoodImpressions] = useState("");
  const [makegoodIssueId, setMakegoodIssueId] = useState("");
  const [makegoodBusy, setMakegoodBusy] = useState(false);
  const [aircheckModal, setAircheckModal] = useState(false);
  const [confirmingCampaignDelete, setConfirmingCampaignDelete] = useState(false);
  const [campaignDeleting, setCampaignDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.campaign(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaign.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  const remainingImpressions = detail ? Math.max(0, detail.committed_impressions - detail.delivered_total) : 0;

  const changeStatus = async (next: CampaignStatus) => {
    if (busy) return;
    setBusy(true);
    setPendingStatus(next);
    try {
      await api.setStatus(id, next);
      push("success", `Status updated to “${next}”.`);
      await onChanged();
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not update status.");
    } finally {
      setBusy(false);
      setPendingStatus(null);
    }
  };

  const submitMakegood = async () => {
    if (makegoodBusy) return;
    const imp = parseInt(makegoodImpressions, 10);
    if (!imp || imp <= 0) {
      push("error", "Enter a positive number of impressions.");
      return;
    }
    setMakegoodBusy(true);
    try {
      await api.createMakegood(id, { impressions: imp, issue_id: makegoodIssueId || null });
      push("success", `Makegood logged for ${formatNumber(imp)} impressions.`);
      setMakegoodImpressions("");
      setMakegoodIssueId("");
      await onChanged();
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not create makegood.");
    } finally {
      setMakegoodBusy(false);
    }
  };

  const deleteCampaign = async () => {
    if (!detail || campaignDeleting) return;
    setCampaignDeleting(true);
    try {
      await api.deleteCampaign(detail.id);
      push("success", `Deleted campaign ${detail.io_number}.`);
      await onChanged();
      onClose();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not delete campaign.");
    } finally {
      setCampaignDeleting(false);
    }
  };

  return (
    <div className="sl-panel-inner">
      <div className="sl-panel-head">
        <div>
          <span className="sl-panel-io">{detail?.io_number || "…"}</span>
          <h2 className="sl-panel-title">{detail?.advertiser_name || "Loading…"}</h2>
          <p className="sl-panel-sub">{detail?.show_title}</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="sl-iconbtn" onClick={onClose} aria-label="Close panel"><Icon name="close" /></button>
        </div>
      </div>

      {loading ? (
        <div className="sl-panel-loading"><Spinner /> Loading campaign ledger…</div>
      ) : error ? (
        <div className="sl-panel-error">
          <Icon name="alert" /> {error}
          <button className="sl-btn sl-btn-outline" onClick={() => void load()}>Retry</button>
        </div>
      ) : detail ? (
        <>
          <div className="sl-panel-summary">
            <div className="sl-panel-stat">
              <span className="sl-ps-label">Committed</span>
              <span className="sl-ps-value">{formatNumber(detail.committed_impressions)}</span>
            </div>
            <div className="sl-panel-stat">
              <span className="sl-ps-label">Delivered</span>
              <span className="sl-ps-value">{formatNumber(detail.delivered_total)}</span>
            </div>
            <div className="sl-panel-stat">
              <span className="sl-ps-label">Variance</span>
              <span className="sl-ps-value"><VarianceCell v={detail.variance_percent} /></span>
            </div>
          </div>
          <div className="sl-panel-delivery">
            <div className="sl-panel-delivery-top">
              <span>Delivery progress</span>
              <span>{detail.committed_impressions > 0 ? ((detail.delivered_total / detail.committed_impressions) * 100).toFixed(1) : "0"}%</span>
            </div>
            <ProgressBar pct={detail.committed_impressions > 0 ? (detail.delivered_total / detail.committed_impressions) * 100 : 0} tone={detail.variance_percent >= 0 ? "pos" : "warn"} />
            <div className="sl-panel-delivery-foot">
              <StatusPill status={detail.status} />
              <PacingBadge pacing={detail.pacing_status} />
              <span className="sl-cpm">CPM {formatCurrency(detail.cpm)}</span>
            </div>
            {detail.invoice_ready ? (
              <button
                className="sl-btn sl-btn-primary"
                style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
                onClick={() => onInvoice(detail.id)}
              >
                <Icon name="file" /> Generate invoice
              </button>
            ) : null}
          </div>

          <div className="sl-panel-section">
            <h4 className="sl-section-title">Workflow status</h4>
            <div className="sl-status-controls">
              {VALID_TRANSITIONS[detail.status].length === 0 ? (
                <p className="sl-muted">This campaign is closed ({detail.status}). No further transitions are permitted.</p>
              ) : (
                VALID_TRANSITIONS[detail.status].map((t) => (
                  <button key={t} className={`sl-btn sl-btn-transition sl-t-${t}`} disabled={busy} onClick={() => void changeStatus(t)}>
                    {busy && pendingStatus === t ? <Spinner sm /> : null}
                    Move to {t}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="sl-panel-section">
            <h4 className="sl-section-title">Log a makegood</h4>
            {remainingImpressions <= 0 ? (
              <p className="sl-muted">Fully delivered — no makegoods needed.</p>
            ) : (
              <form className="sl-makegood" onSubmit={(e) => { e.preventDefault(); void submitMakegood(); }}>
                <label className="sl-field grow">
                  <span className="sl-field-label">Impressions to grant</span>
                  <input className="sl-input" type="number" min={1} max={remainingImpressions} value={makegoodImpressions} onChange={(e) => setMakegoodImpressions(e.target.value)} placeholder={`up to ${formatNumber(remainingImpressions)}`} />
                </label>
                <label className="sl-field grow">
                  <span className="sl-field-label">Linked issue (optional)</span>
                  <select className="sl-select" value={makegoodIssueId} onChange={(e) => setMakegoodIssueId(e.target.value)}>
                    <option value="">None</option>
                    {detail.issues.filter((i) => !i.resolved).map((i) => <option key={i.id} value={i.id}>{i.type}</option>)}
                  </select>
                </label>
                <button className="sl-btn sl-btn-primary" type="submit" disabled={makegoodBusy}>
                  {makegoodBusy ? <Spinner sm /> : <Icon name="check" />} Grant makegood
                </button>
              </form>
            )}
          </div>

          <PanelTabs
            detail={detail}
            onChanged={async () => {
              await onChanged();
              await load();
            }}
            push={push}
            onAddAircheck={() => setAircheckModal(true)}
          />
        </>
      ) : null}

      {detail ? (
        <div className="sl-modal-foot sl-campaign-actions">
          {confirmingCampaignDelete ? (
            <>
              <span className="sl-delete-warning">Delete this campaign and all linked delivery, issue, aircheck, and makegood records?</span>
              <button className="sl-btn sl-btn-ghost" onClick={() => setConfirmingCampaignDelete(false)} disabled={campaignDeleting}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => void deleteCampaign()} disabled={campaignDeleting}>
                {campaignDeleting ? <Spinner sm /> : <Icon name="close" />} Delete permanently
              </button>
            </>
          ) : (
            <>
              <button className="sl-btn sl-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => setConfirmingCampaignDelete(true)}><Icon name="close" /> Delete</button>
              <button className="sl-btn sl-btn-primary" onClick={() => onEdit(detail)}><Icon name="edit" /> Edit</button>
            </>
          )}
        </div>
      ) : null}

      {aircheckModal && detail ? (
        <AircheckModal
          campaignId={detail.id}
          onClose={() => setAircheckModal(false)}
          onSaved={async () => {
            setAircheckModal(false);
            await onChanged();
            await load();
          }}
          push={push}
        />
      ) : null}
    </div>
  );
}

function PanelTabs({ detail, onChanged, push, onAddAircheck }: {
  detail: CampaignDetailData;
  onChanged: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
  onAddAircheck: () => void;
}) {
  const [tab, setTab] = useState<"delivery" | "airchecks" | "issues" | "makegoods">("delivery");
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryRecord | null>(null);
  const [editingDelivery, setEditingDelivery] = useState<DeliveryRecord | null>(null);
  const [selectedMakegood, setSelectedMakegood] = useState<Makegood | null>(null);
  const [editingMakegood, setEditingMakegood] = useState<Makegood | null>(null);
  const [deliveryDeleting, setDeliveryDeleting] = useState(false);
  const [makegoodDeleting, setMakegoodDeleting] = useState(false);
  const tabs: Array<{ id: typeof tab; label: string; count: number }> = [
    { id: "delivery", label: "Delivery", count: detail.delivery_records.length },
    { id: "airchecks", label: "Airchecks", count: detail.airchecks.length },
    { id: "issues", label: "Issues", count: detail.issues.length },
    { id: "makegoods", label: "Makegoods", count: detail.makegoods.length },
  ];
  const deleteSelectedDelivery = async () => {
    if (!selectedDelivery || deliveryDeleting) return;
    setDeliveryDeleting(true);
    try {
      await api.deleteDelivery(detail.id, selectedDelivery.id);
      push("success", `Removed delivery record for ${formatDate(selectedDelivery.date)}.`);
      setSelectedDelivery(null);
      await onChanged();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not delete record.");
    } finally {
      setDeliveryDeleting(false);
    }
  };

  const deleteSelectedMakegood = async () => {
    if (!selectedMakegood || makegoodDeleting) return;
    setMakegoodDeleting(true);
    try {
      await api.deleteMakegood(detail.id, selectedMakegood.id);
      push("success", `Deleted makegood created ${formatDate(selectedMakegood.created_at)}.`);
      setSelectedMakegood(null);
      await onChanged();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Could not delete makegood.");
    } finally {
      setMakegoodDeleting(false);
    }
  };

  return (
    <>
      <div className="sl-tabs-wrap">
      <div className="sl-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`sl-tab ${tab === t.id ? "sl-tab-active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}<span className="sl-tab-count">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="sl-tabpanel" role="tabpanel">
        {tab === "delivery" ? (
          <>
            <DeliveryForm campaignId={detail.id} onChanged={onChanged} push={push} />
            {detail.delivery_records.length ? (
              <table className="sl-detail-table">
                <thead><tr><th>Date</th><th>Source</th><th className="sl-th-right">Impressions</th></tr></thead>
                <tbody>
                  {detail.delivery_records.map((d) => (
                    <tr
                      key={d.id}
                      className="sl-detail-row"
                      tabIndex={0}
                      onClick={() => setSelectedDelivery(d)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedDelivery(d);
                        }
                      }}
                      aria-label={`Open delivery record for ${formatDate(d.date)}`}
                    >
                      <td>{formatDate(d.date)}</td>
                      <td>{d.source}</td>
                      <td className="sl-th-right">{formatNumber(d.impressions_delivered)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyLine text="No delivery records yet — add one above or import a CSV." />}
          </>
        ) : null}
        {tab === "airchecks" ? (
          <>
            <div className="sl-tab-actions">
              <button className="sl-btn sl-btn-outline" onClick={onAddAircheck}><Icon name="plus" /> Add aircheck</button>
            </div>
            {detail.airchecks.length ? (
              <ul className="sl-list">
                {detail.airchecks.map((a) => (
                  <li key={a.id} className="sl-list-item">
                    <span className="sl-list-main">
                      {a.episode_title || "Aircheck"}
                      {a.aircheck_url ? (
                        <>
                          {" — "}
                          <a className="sl-link" href={a.aircheck_url.startsWith("/uploads/") ? `${a.aircheck_url}` : a.aircheck_url} target="_blank" rel="noreferrer">open</a>
                        </>
                      ) : null}
                      {a.notes ? <span className="sl-show"> · {a.notes}</span> : null}
                    </span>
                    <time className="sl-list-time">{formatDateTime(a.verified_at)}</time>
                  </li>
                ))}
              </ul>
            ) : <EmptyLine text="No airchecks on file." />}
          </>
        ) : null}
        {tab === "issues" ? (
          detail.issues.length ? (
            <ul className="sl-list">{detail.issues.map((i) => <li key={i.id} className="sl-list-item"><span className={`sl-issue-dot ${i.resolved ? "sl-resolved" : ""}`} /><span className="sl-list-main"><strong>{i.type}</strong> — {i.description}</span><span className={`sl-issue-state ${i.resolved ? "sl-ok" : "sl-open"}`}>{i.resolved ? "resolved" : "open"}</span></li>)}</ul>
          ) : <EmptyLine text="No reconciliation issues. Clean books." />
        ) : null}
        {tab === "makegoods" ? (
          detail.makegoods.length ? (
            <table className="sl-detail-table">
              <thead><tr><th>Created</th><th>Status</th><th className="sl-th-right">Imps</th><th className="sl-th-right">Value</th></tr></thead>
              <tbody>{detail.makegoods.map((m) => (
                <tr
                  key={m.id}
                  className="sl-detail-row"
                  tabIndex={0}
                  onClick={() => setSelectedMakegood(m)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedMakegood(m);
                    }
                  }}
                  aria-label={`Open makegood created ${formatDate(m.created_at)}`}
                >
                  <td>{formatDate(m.created_at)}</td>
                  <td><span className={`sl-pill sl-mg-${m.status}`}>{m.status}</span></td>
                  <td className="sl-th-right">{formatNumber(m.impressions_granted)}</td>
                  <td className="sl-th-right">{formatCurrency(m.value)}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <EmptyLine text="No makegoods granted." />
        ) : null}
        </div>
      </div>

      {selectedDelivery ? (
        <Modal
          title="Delivery record"
          sub="Review this delivery entry before choosing an action."
          onClose={() => { if (!deliveryDeleting) setSelectedDelivery(null); }}
          footer={
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setSelectedDelivery(null)} disabled={deliveryDeleting}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => void deleteSelectedDelivery()} disabled={deliveryDeleting}>
                {deliveryDeleting ? <Spinner sm /> : <Icon name="close" />} Delete
              </button>
              <button className="sl-btn sl-btn-primary" onClick={() => { setEditingDelivery(selectedDelivery); setSelectedDelivery(null); }} disabled={deliveryDeleting}><Icon name="edit" /> Edit</button>
            </>
          }
        >
          <div className="sl-record-grid">
            <div className="sl-record-metric"><span>Date</span><strong>{formatDate(selectedDelivery.date)}</strong></div>
            <div className="sl-record-metric"><span>Source</span><strong>{selectedDelivery.source.replace(/_/g, " ")}</strong></div>
            <div className="sl-record-metric"><span>Impressions</span><strong>{formatNumber(selectedDelivery.impressions_delivered)}</strong></div>
          </div>
        </Modal>
      ) : null}

      {selectedMakegood ? (
        <Modal
          title="Makegood record"
          sub="Granted inventory and reconciliation value."
          onClose={() => { if (!makegoodDeleting) setSelectedMakegood(null); }}
          footer={
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setSelectedMakegood(null)} disabled={makegoodDeleting}>Cancel</button>
              <button className="sl-btn sl-btn-danger" onClick={() => void deleteSelectedMakegood()} disabled={makegoodDeleting}>{makegoodDeleting ? <Spinner sm /> : <Icon name="close" />} Delete</button>
              <button className="sl-btn sl-btn-primary" onClick={() => { setEditingMakegood(selectedMakegood); setSelectedMakegood(null); }} disabled={makegoodDeleting}><Icon name="edit" /> Edit</button>
            </>
          }
        >
          <div className="sl-record-grid">
            <div className="sl-record-metric"><span>Created</span><strong>{formatDate(selectedMakegood.created_at)}</strong></div>
            <div className="sl-record-metric"><span>Status</span><strong>{selectedMakegood.status}</strong></div>
            <div className="sl-record-metric"><span>Granted impressions</span><strong>{formatNumber(selectedMakegood.impressions_granted)}</strong></div>
            <div className="sl-record-metric"><span>Value</span><strong>{formatCurrency(selectedMakegood.value)}</strong></div>
          </div>
        </Modal>
      ) : null}

      {editingDelivery ? (
        <EditDeliveryModal
          campaignId={detail.id}
          record={editingDelivery}
          onClose={() => setEditingDelivery(null)}
          onSaved={async () => { setEditingDelivery(null); await onChanged(); }}
          push={push}
        />
      ) : null}

      {editingMakegood ? (
        <EditMakegoodModal
          campaignId={detail.id}
          record={editingMakegood}
          onClose={() => setEditingMakegood(null)}
          onSaved={async () => { setEditingMakegood(null); await onChanged(); }}
          push={push}
        />
      ) : null}
    </>
  );
}

function EditDeliveryModal({ campaignId, record, onClose, onSaved, push }: {
  campaignId: string;
  record: DeliveryRecord;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [date, setDate] = useState(record.date.slice(0, 10));
  const [impressions, setImpressions] = useState(String(record.impressions_delivered));
  const [source, setSource] = useState(record.source);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const imp = Math.round(Number(impressions));
    if (!date) { setError("Pick a delivery date."); return; }
    if (!Number.isFinite(imp) || imp < 0) { setError("Enter a non-negative impression count."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.updateDelivery(campaignId, record.id, { date, impressions: imp, source });
      push("success", `Delivery record for ${formatDate(date)} updated.`);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update delivery record.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit delivery record" sub="Update the date, source, or delivered impressions." onClose={onClose} footer={<><button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="sl-btn sl-btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner sm /> : <Icon name="edit" />} Save changes</button></>}>
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <div className="sl-form-grid">
        <label className="sl-field"><span className="sl-field-label">Date</span><input className="sl-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="sl-field"><span className="sl-field-label">Source</span><select className="sl-select" value={source} onChange={(e) => setSource(e.target.value)}>{DELIVERY_SOURCES.map((option) => <option key={option} value={option}>{option.replace(/_/g, " ")}</option>)}</select></label>
        <label className="sl-field sl-form-full"><span className="sl-field-label">Impressions</span><input className="sl-input" type="number" min={0} value={impressions} onChange={(e) => setImpressions(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function EditMakegoodModal({ campaignId, record, onClose, onSaved, push }: {
  campaignId: string;
  record: Makegood;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [impressions, setImpressions] = useState(String(record.impressions_granted));
  const [status, setStatus] = useState(record.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const imp = Math.round(Number(impressions));
    if (!Number.isFinite(imp) || imp <= 0) { setError("Enter a positive impression count."); return; }
    setBusy(true);
    setError(null);
    try {
      await api.updateMakegood(campaignId, record.id, { impressions: imp, status });
      push("success", "Makegood updated.");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update makegood.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit makegood" sub="Update granted inventory or workflow status." onClose={onClose} footer={<><button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="sl-btn sl-btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? <Spinner sm /> : <Icon name="edit" />} Save changes</button></>}>
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <div className="sl-form-grid">
        <label className="sl-field"><span className="sl-field-label">Granted impressions</span><input className="sl-input" type="number" min={1} value={impressions} onChange={(e) => setImpressions(e.target.value)} /></label>
        <label className="sl-field"><span className="sl-field-label">Status</span><select className="sl-select" value={status} onChange={(e) => setStatus(e.target.value)}>{["pending", "approved", "delivered"].map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      </div>
    </Modal>
  );
}

function DeliveryForm({ campaignId, onChanged, push }: {
  campaignId: string;
  onChanged: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [impressions, setImpressions] = useState("");
  const [source, setSource] = useState("manual");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const imp = Math.round(Number(impressions));
    if (!date) { push("error", "Pick a delivery date."); return; }
    if (!Number.isFinite(imp) || imp < 0) { push("error", "Enter a non-negative impression count."); return; }
    setBusy(true);
    try {
      const res = await api.addDelivery(campaignId, { date, impressions: imp, source });
      push("success", `Delivery logged: ${formatNumber(imp)} imps on ${formatDate(date)}${res.auto_issues_detected ? ` · ${res.auto_issues_detected} issue(s) auto-detected` : ""}.`);
      setImpressions("");
      await onChanged();
    } catch (e2) {
      push("error", e2 instanceof Error ? e2.message : "Could not save delivery.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sl-delivery-form" onSubmit={submit}>
      <label className="sl-field">
        <span className="sl-field-label">Date</span>
        <input className="sl-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="sl-field grow">
        <span className="sl-field-label">Impressions</span>
        <input className="sl-input" type="number" min={0} value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="12500" />
      </label>
      <label className="sl-field">
        <span className="sl-field-label">Source</span>
        <select className="sl-select" value={source} onChange={(e) => setSource(e.target.value)}>
          {DELIVERY_SOURCES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <button className="sl-btn sl-btn-primary" type="submit" disabled={busy}>
        {busy ? <Spinner sm /> : <Icon name="plus" />} Add
      </button>
    </form>
  );
}

function AircheckModal({ campaignId, onClose, onSaved, push }: {
  campaignId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [episode, setEpisode] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!episode.trim()) { setError("Episode title is required."); return; }
    setBusy(true);
    setError(null);
    try {
      if (file) {
        await api.uploadAircheck(campaignId, file, { episode_title: episode.trim(), notes: notes.trim() || undefined });
        push("success", `Aircheck “${episode.trim()}” uploaded.`);
      } else if (url.trim()) {
        await api.addAircheck(campaignId, { episode_title: episode.trim(), aircheck_url: url.trim(), notes: notes.trim() || undefined });
        push("success", `Aircheck “${episode.trim()}” linked.`);
      } else {
        setError("Add a file or paste a URL.");
        setBusy(false);
        return;
      }
      await onSaved();
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Could not save aircheck.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add aircheck"
      sub="Upload the recorded ad segment or link to where it is hosted."
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sl-btn sl-btn-primary" onClick={(e) => void submit(e as unknown as React.FormEvent)} disabled={busy}>
            {busy ? <Spinner sm /> : <Icon name="check" />} Save aircheck
          </button>
        </>
      }
    >
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <form className="sl-form-grid" onSubmit={submit}>
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">Episode title *</span>
          <input className="sl-input" value={episode} onChange={(e) => setEpisode(e.target.value)} placeholder="Ep 42: Season Finale" autoFocus />
        </label>
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">Upload file</span>
          <input ref={fileRef} className="sl-input" type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file ? <span className="sl-form-hint">{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB</span> : <span className="sl-form-hint">Up to 80 MB — mp3, wav, m4a…</span>}
        </label>
        <div className="sl-form-or">— or link to it —</div>
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">URL</span>
          <input className="sl-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cdn.example.com/ep42-ad.mp3" disabled={Boolean(file)} />
        </label>
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">Notes</span>
          <textarea className="sl-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Mid-roll, first ad slot. Verified against copy." />
        </label>
      </form>
    </Modal>
  );
}
