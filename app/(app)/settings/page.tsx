"use client";
import { useCallback, useEffect, useState } from "react";
import { api, formatDate } from "../../lib/api";
import type {
  ActivityEvent,
  OrganizationSettings,
  WorkspaceUser,
} from "../../lib/types";
import {
  Icon,
  Modal,
  Notices,
  PageHead,
  Spinner,
  useNotices,
} from "../../lib/ui";
export default function SettingsPage() {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [audit, setAudit] = useState<ActivityEvent[]>([]);
  const [tab, setTab] = useState<"organization" | "users" | "audit">(
    "organization",
  );
  const [selected, setSelected] = useState<WorkspaceUser | null>(null);
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const { notices, push, dismiss } = useNotices();
  const load = useCallback(async () => {
    try {
      const [s, u, a] = await Promise.all([
        api.settings(),
        api.users().catch(() => []),
        api
          .audit()
          .then((v) => v.rows)
          .catch(() => []),
      ]);
      setSettings(s);
      setUsers(u);
      setAudit(a);
    } catch (e) {
      push(
        "error",
        e instanceof Error ? e.message : "Could not load settings.",
      );
    }
  }, [push]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const save = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      setSettings(await api.updateSettings(settings));
      push("success", "Organization settings saved.");
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };
  const saveRole = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.updateUserRole(selected.id, role);
      push("success", "User role updated.");
      setSelected(null);
      await load();
    } catch (e) {
      push("error", e instanceof Error ? e.message : "Role update failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Workspace settings"
        tagline="Organization defaults, access roles, and immutable activity history"
      />
      <div className="sl-tabs">
        <button
          className={`sl-tab ${tab === "organization" ? "sl-tab-active" : ""}`}
          onClick={() => setTab("organization")}
        >
          Organization
        </button>
        <button
          className={`sl-tab ${tab === "users" ? "sl-tab-active" : ""}`}
          onClick={() => setTab("users")}
        >
          Users & roles
        </button>
        <button
          className={`sl-tab ${tab === "audit" ? "sl-tab-active" : ""}`}
          onClick={() => setTab("audit")}
        >
          Audit history
        </button>
      </div>
      {tab === "organization" && settings ? (
        <section className="sl-card sl-settings-card">
          <div className="sl-form-grid">
            <Field
              label="Organization name"
              value={settings.name}
              onChange={(name) => setSettings({ ...settings, name })}
            />
            <Field
              label="Timezone"
              value={settings.timezone}
              onChange={(timezone) => setSettings({ ...settings, timezone })}
            />
            <Field
              label="Invoice prefix"
              value={settings.invoice_prefix}
              onChange={(invoice_prefix) =>
                setSettings({ ...settings, invoice_prefix })
              }
            />
            <label className="sl-field">
              <span className="sl-field-label">Payment terms (days)</span>
              <input
                className="sl-input"
                type="number"
                value={settings.payment_terms_days}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    payment_terms_days: Number(e.target.value),
                  })
                }
              />
            </label>
            <Field
              label="Alert email"
              value={settings.alert_email || ""}
              onChange={(alert_email) =>
                setSettings({ ...settings, alert_email })
              }
            />
            <label className="sl-field sl-check-field">
              <input
                type="checkbox"
                checked={settings.automatic_alerts}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    automatic_alerts: e.target.checked,
                  })
                }
              />
              <span>Run automatic alert checks</span>
            </label>
          </div>
          <div className="sl-form-actions">
            <button
              className="sl-btn sl-btn-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? <Spinner sm /> : <Icon name="check" />} Save settings
            </button>
          </div>
        </section>
      ) : null}
      {tab === "users" ? (
        <section className="sl-tablewrap">
          <div className="sl-table-scroll">
            <table className="sl-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => {
                      setSelected(user);
                      setRole(user.role);
                    }}
                  >
                    <td>{user.name || "Unnamed user"}</td>
                    <td>{user.email}</td>
                    <td>
                      <span className="sl-pill sl-status-active">
                        {user.role}
                      </span>
                    </td>
                    <td>{formatDate(user.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {tab === "audit" ? (
        <section className="sl-tablewrap">
          <div className="sl-table-scroll">
            <table className="sl-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Entity</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDate(event.created_at)}</td>
                    <td>{event.entity_type}</td>
                    <td className="sl-cell-io">
                      {event.action.replaceAll("_", " ")}
                    </td>
                    <td className="sl-show">
                      {event.details ? JSON.stringify(event.details) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {selected ? (
        <Modal
          title={`Access for ${selected.name || selected.email}`}
          sub="Roles take effect on the user’s next API request."
          onClose={() => setSelected(null)}
          footer={
            <>
              <button
                className="sl-btn sl-btn-ghost"
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <button
                className="sl-btn sl-btn-primary"
                disabled={busy}
                onClick={() => void saveRole()}
              >
                {busy ? <Spinner sm /> : <Icon name="check" />} Save role
              </button>
            </>
          }
        >
          <label className="sl-field">
            <span className="sl-field-label">Role</span>
            <select
              className="sl-select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="admin">
                Admin — all settings and integrations
              </option>
              <option value="member">Member — campaigns and operations</option>
              <option value="viewer">Viewer — read-only intended access</option>
            </select>
            <span className="sl-form-hint">
              The last administrator cannot be demoted.
            </span>
          </label>
        </Modal>
      ) : null}
    </main>
  );
}
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="sl-field">
      <span className="sl-field-label">{label}</span>
      <input
        className="sl-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
