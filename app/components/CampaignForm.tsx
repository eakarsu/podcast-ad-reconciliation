"use client";

import { useState } from "react";
import { api, formatDate } from "../lib/api";
import type { CampaignRow, CampaignStatus } from "../lib/types";
import { Icon, Modal, Spinner } from "../lib/ui";

const STATUS_OPTIONS: CampaignStatus[] = ["draft", "active", "paused"];

interface FormState {
  io_number: string;
  show_title: string;
  advertiser_name: string;
  advertiser_email: string;
  status: CampaignStatus;
  start_date: string;
  end_date: string;
  committed_impressions: string;
  cpm: string;
}

function toForm(c: CampaignRow | null): FormState {
  return {
    io_number: c?.io_number ?? "",
    show_title: c?.show_title ?? "",
    advertiser_name: c?.advertiser_name ?? "",
    advertiser_email: "",
    status: (c?.status as CampaignStatus) ?? "draft",
    start_date: c ? formatDate(c.start_date) : "",
    end_date: c ? formatDate(c.end_date) : "",
    committed_impressions: c ? String(c.committed_impressions) : "",
    cpm: c ? String(c.cpm) : "",
  };
}

export default function CampaignForm({ existing, showTitles, advertiserNames, onClose, onSaved, push }: {
  existing: CampaignRow | null;
  showTitles: string[];
  advertiserNames: string[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(existing));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (!form.io_number.trim() || !form.show_title.trim() || !form.advertiser_name.trim()) {
      setError("IO number, podcast, and advertiser are required.");
      return;
    }
    if (!form.start_date || !form.end_date) {
      setError("Start and end dates are required.");
      return;
    }
    if (form.end_date < form.start_date) {
      setError("End date must be on or after the start date.");
      return;
    }
    const committed = Number(form.committed_impressions);
    const cpm = Number(form.cpm);
    if (!Number.isFinite(committed) || committed <= 0) {
      setError("Committed impressions must be a positive number.");
      return;
    }
    if (!Number.isFinite(cpm) || cpm <= 0) {
      setError("CPM must be a positive number.");
      return;
    }
    setBusy(true);
    try {
      if (existing) {
        await api.updateCampaign(existing.id, {
          show_title: form.show_title.trim(),
          advertiser_name: form.advertiser_name.trim(),
          advertiser_email: form.advertiser_email || undefined,
          start_date: form.start_date,
          end_date: form.end_date,
          committed_impressions: committed,
          cpm,
        });
        push("success", `IO ${form.io_number} updated.`);
      } else {
        await api.createCampaign({
          io_number: form.io_number.trim(),
          show_title: form.show_title.trim(),
          advertiser_name: form.advertiser_name.trim(),
          advertiser_email: form.advertiser_email || undefined,
          status: form.status,
          start_date: form.start_date,
          end_date: form.end_date,
          committed_impressions: committed,
          cpm,
        });
        push("success", `IO ${form.io_number} created.`);
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit ${existing.io_number}` : "New insertion order"}
      sub={existing ? "Update campaign terms. Status changes are made from the detail panel." : "Create a campaign manually. Podcast and advertiser are matched by name (created if new)."}
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="sl-btn sl-btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner sm /> : <Icon name={existing ? "edit" : "plus"} />} {existing ? "Save changes" : "Create campaign"}
          </button>
        </>
      }
    >
      {error ? <div className="sl-inline-error" style={{ marginBottom: 14 }}><Icon name="alert" /> {error}</div> : null}
      <div className="sl-form-grid">
        <label className="sl-field">
          <span className="sl-field-label">IO number *</span>
          <input className="sl-input" value={form.io_number} onChange={set("io_number")} placeholder="IO-2024-003" disabled={Boolean(existing)} />
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Status *</span>
          <select className="sl-select" value={form.status} onChange={set("status")} disabled={Boolean(existing)}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {existing ? <span className="sl-form-hint">Status changes use workflow transitions in the detail panel.</span> : null}
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Podcast *</span>
          <input className="sl-input" list="sl-show-titles" value={form.show_title} onChange={set("show_title")} placeholder="Tech Today" />
          <datalist id="sl-show-titles">{showTitles.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Advertiser *</span>
          <input className="sl-input" list="sl-advertiser-names" value={form.advertiser_name} onChange={set("advertiser_name")} placeholder="CloudCorp Inc." />
          <datalist id="sl-advertiser-names">{advertiserNames.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
        <label className="sl-field sl-form-full">
          <span className="sl-field-label">Advertiser contact email</span>
          <input className="sl-input" type="email" value={form.advertiser_email} onChange={set("advertiser_email")} placeholder="ads@advertiser.com (only used when creating a new advertiser)" />
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Start date *</span>
          <input className="sl-input" type="date" value={form.start_date} onChange={set("start_date")} />
        </label>
        <label className="sl-field">
          <span className="sl-field-label">End date *</span>
          <input className="sl-input" type="date" value={form.end_date} onChange={set("end_date")} />
        </label>
        <label className="sl-field">
          <span className="sl-field-label">Committed impressions *</span>
          <input className="sl-input" type="number" min={1} value={form.committed_impressions} onChange={set("committed_impressions")} placeholder="100000" />
        </label>
        <label className="sl-field">
          <span className="sl-field-label">CPM (USD) *</span>
          <input className="sl-input" type="number" min={0.01} step="0.01" value={form.cpm} onChange={set("cpm")} placeholder="25.00" />
        </label>
      </div>
    </Modal>
  );
}
