"use client";
import { useCallback, useEffect, useState } from "react";
import { api, formatDate } from "../../lib/api";
import type { IntegrationRow } from "../../lib/types";
import {
  Icon,
  Modal,
  Notices,
  PageHead,
  Spinner,
  useNotices,
} from "../../lib/ui";
const blank = {
  name: "",
  provider: "",
  integration_type: "hosting",
  endpoint_url: "",
  api_key_env: "",
  status: "paused",
};
export default function IntegrationsPage() {
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [selected, setSelected] = useState<IntegrationRow | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notices, push, dismiss } = useNotices();
  const load = useCallback(async () => {
    try {
      setRows(await api.integrations());
    } catch (e) {
      push(
        "error",
        e instanceof Error ? e.message : "Could not load integrations.",
      );
    }
  }, [push]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const edit = (row?: IntegrationRow) => {
    setEditing(row?.id || null);
    setForm(
      row
        ? {
            name: row.name,
            provider: row.provider,
            integration_type: row.integration_type,
            endpoint_url: row.endpoint_url || "",
            api_key_env: row.api_key_env || "",
            status: row.status,
          }
        : { ...blank },
    );
    setSelected(null);
  };
  const save = async () => {
    if (!form?.name || !form.provider)
      return push("error", "Name and provider are required.");
    setBusy(true);
    try {
      if (editing) await api.updateIntegration(editing, form);
      else await api.createIntegration(form);
      push(
        "success",
        editing ? "Integration updated." : "Integration created.",
      );
      setForm(null);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };
  const sync = async (row: IntegrationRow) => {
    setBusy(true);
    try {
      const result = await api.syncIntegration(row.id);
      push(
        "success",
        `Sync completed: ${result.records_processed} records processed.`,
      );
      setSelected(null);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (row: IntegrationRow) => {
    setBusy(true);
    try {
      await api.deleteIntegration(row.id);
      push("success", "Integration deleted.");
      setSelected(null);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Integrations"
        tagline="Connect podcast hosting, ad delivery APIs, and invoice email without storing secrets"
        actions={
          <button className="sl-btn sl-btn-primary" onClick={() => edit()}>
            <Icon name="plus" /> New integration
          </button>
        }
      />
      <section className="sl-kpis">
        {rows.map((row) => (
          <article
            className="sl-kpi sl-clickable"
            key={row.id}
            onClick={() => {
              setSelected(row);
              setConfirm(false);
            }}
          >
            <div
              className={`sl-kpi-accent sl-accent-${row.status === "connected" ? "pos" : row.status === "error" ? "neg" : "ink"}`}
            />
            <div className="sl-kpi-body">
              <div className="sl-kpi-top">
                <span className="sl-kpi-label">
                  {row.integration_type.replaceAll("_", " ")}
                </span>
                <span
                  className={`sl-pill sl-status-${row.status === "connected" ? "completed" : row.status === "error" ? "cancelled" : "paused"}`}
                >
                  {row.status}
                </span>
              </div>
              <div className="sl-kpi-value sl-kpi-text">{row.name}</div>
              <div className="sl-kpi-sub">
                {row.provider} ·{" "}
                {row.last_synced_at
                  ? `synced ${formatDate(row.last_synced_at)}`
                  : "never synced"}
              </div>
            </div>
          </article>
        ))}
      </section>
      <div className="sl-banner">
        <span className="sl-banner-icon">
          <Icon name="shield" />
        </span>
        <div className="sl-banner-body">
          <strong>Credentials stay in the server environment.</strong> Set the
          variable named in “API key environment variable”; SignalLedger stores
          only its name.
        </div>
      </div>
      {selected ? (
        <Modal
          title={confirm ? `Delete ${selected.name}?` : selected.name}
          sub={`${selected.provider} · ${selected.integration_type.replaceAll("_", " ")}`}
          onClose={() => !busy && setSelected(null)}
          footer={
            confirm ? (
              <>
                <button
                  className="sl-btn sl-btn-ghost"
                  onClick={() => setConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  className="sl-btn sl-btn-danger"
                  disabled={busy}
                  onClick={() => void remove(selected)}
                >
                  {busy ? <Spinner sm /> : <Icon name="close" />} Delete
                  permanently
                </button>
              </>
            ) : (
              <>
                <button
                  className="sl-btn sl-btn-ghost"
                  onClick={() => setSelected(null)}
                >
                  Cancel
                </button>
                <button
                  className="sl-btn sl-btn-danger"
                  onClick={() => setConfirm(true)}
                >
                  <Icon name="close" /> Delete
                </button>
                <button
                  className="sl-btn sl-btn-outline"
                  onClick={() => edit(selected)}
                >
                  <Icon name="edit" /> Edit
                </button>
                <button
                  className="sl-btn sl-btn-primary"
                  disabled={busy || selected.integration_type === "email"}
                  onClick={() => void sync(selected)}
                >
                  {busy ? <Spinner sm /> : <Icon name="refresh" />} Sync now
                </button>
              </>
            )
          }
        >
          <div className="sl-record-grid">
            <Metric label="Status" value={selected.status} />
            <Metric
              label="Endpoint"
              value={selected.endpoint_url || "Not configured"}
            />
            <Metric
              label="Credential variable"
              value={selected.api_key_env || "None"}
            />
            <Metric
              label="Last result"
              value={selected.last_run?.message || "No runs"}
            />
          </div>
          {selected.sync_error ? (
            <div className="sl-inline-error">
              <Icon name="alert" />
              {selected.sync_error}
            </div>
          ) : null}
        </Modal>
      ) : null}
      {form ? (
        <Modal
          title={editing ? "Edit integration" : "New integration"}
          sub="Generic JSON ad servers should return a deliveries array with io_number, date, and impressions."
          onClose={() => setForm(null)}
          footer={
            <>
              <button
                className="sl-btn sl-btn-ghost"
                onClick={() => setForm(null)}
              >
                Cancel
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
            <Field label="Name *" name="name" form={form} setForm={setForm} />
            <Field
              label="Provider *"
              name="provider"
              form={form}
              setForm={setForm}
            />
            <label className="sl-field">
              <span className="sl-field-label">Type</span>
              <select
                className="sl-select"
                value={form.integration_type}
                onChange={(e) =>
                  setForm({ ...form, integration_type: e.target.value })
                }
              >
                <option value="hosting">Podcast hosting</option>
                <option value="ad_server">Ad server</option>
                <option value="email">Invoice email</option>
              </select>
            </label>
            <label className="sl-field">
              <span className="sl-field-label">Status</span>
              <select
                className="sl-select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="paused">Paused</option>
                <option value="connected">Connected</option>
              </select>
            </label>
            <label className="sl-field sl-form-full">
              <span className="sl-field-label">Endpoint URL</span>
              <input
                className="sl-input"
                value={form.endpoint_url}
                onChange={(e) =>
                  setForm({ ...form, endpoint_url: e.target.value })
                }
              />
            </label>
            <label className="sl-field sl-form-full">
              <span className="sl-field-label">
                API key environment variable
              </span>
              <input
                className="sl-input"
                placeholder="MEGAPHONE_API_KEY"
                value={form.api_key_env}
                onChange={(e) =>
                  setForm({ ...form, api_key_env: e.target.value })
                }
              />
            </label>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="sl-record-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Field({
  label,
  name,
  form,
  setForm,
}: {
  label: string;
  name: string;
  form: Record<string, string>;
  setForm: (v: Record<string, string>) => void;
}) {
  return (
    <label className="sl-field">
      <span className="sl-field-label">{label}</span>
      <input
        className="sl-input"
        value={form[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
    </label>
  );
}
