"use client";
import { useCallback, useEffect, useState } from "react";
import { api, formatDate, formatNumber } from "../../lib/api";
import type {
  AdSlot,
  CampaignRow,
  EpisodeRow,
  PodcastRow,
} from "../../lib/types";
import {
  Icon,
  Modal,
  Notices,
  PageHead,
  Pagination,
  Spinner,
  useNotices,
} from "../../lib/ui";

export default function EpisodesPage() {
  const [rows, setRows] = useState<EpisodeRow[]>([]);
  const [podcasts, setPodcasts] = useState<PodcastRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EpisodeRow | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [slot, setSlot] = useState<Partial<AdSlot> | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notices, push, dismiss } = useNotices();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, p, c] = await Promise.all([
        api.episodes({ page, pageSize: 25 }),
        api.podcasts({ pageSize: 500 }),
        api.campaigns({ pageSize: 500 }),
      ]);
      setRows(e.rows);
      setTotal(e.total);
      setPodcasts(p.rows);
      setCampaigns(c.rows);
    } catch (error) {
      push(
        "error",
        error instanceof Error ? error.message : "Could not load episodes.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, push]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const open = async (row: EpisodeRow) => {
    try {
      setSelected(await api.episode(row.id));
      setConfirm(false);
    } catch (error) {
      push(
        "error",
        error instanceof Error ? error.message : "Could not open episode.",
      );
    }
  };
  const saveEpisode = async () => {
    if (!form?.show_id || !form.title)
      return push("error", "Podcast and title are required.");
    setBusy(true);
    try {
      await api.createEpisode({
        ...form,
        duration_seconds: Number(form.duration_seconds) || null,
        published_at: form.published_at || null,
      });
      push("success", "Episode created.");
      setForm(null);
      await load();
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };
  const saveSlot = async () => {
    if (!selected || !slot) return;
    setBusy(true);
    try {
      const body = {
        ...slot,
        position_seconds: Number(slot.position_seconds) || null,
        duration_seconds: Number(slot.duration_seconds) || 60,
        expected_impressions: Number(slot.expected_impressions) || 0,
        delivered_impressions: Number(slot.delivered_impressions) || 0,
      };
      if (slot.id) await api.updateAdSlot(slot.id, body);
      else await api.createAdSlot(selected.id, body);
      push("success", slot.id ? "Ad slot updated." : "Ad slot added.");
      setSlot(null);
      setSelected(await api.episode(selected.id));
      await load();
    } catch (error) {
      push(
        "error",
        error instanceof Error ? error.message : "Slot save failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.deleteEpisode(selected.id);
      push("success", "Episode deleted.");
      setSelected(null);
      setConfirm(false);
      await load();
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="sl-main">
      <Notices notices={notices} dismiss={dismiss} />
      <PageHead
        title="Episodes"
        tagline="Synced releases, campaign ad slots, delivery, and airchecks"
        actions={
          <button
            className="sl-btn sl-btn-primary"
            onClick={() =>
              setForm({
                show_id: podcasts[0]?.id || "",
                title: "",
                published_at: "",
                duration_seconds: "",
                audio_url: "",
              })
            }
          >
            <Icon name="plus" /> New episode
          </button>
        }
      />
      <section className="sl-tablewrap">
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th>Episode</th>
                <th>Podcast</th>
                <th>Published</th>
                <th className="sl-th-right">Duration</th>
                <th className="sl-th-right">Ad slots</th>
                <th>Audio</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="sl-row-skeleton">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j}>
                          <span className="sl-bar" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      onClick={() => void open(row)}
                    >
                      <td className="sl-cell-name">
                        <span className="sl-advertiser">{row.title}</span>
                        <span className="sl-show">
                          {row.episode_number
                            ? `S${row.season_number || 1} · E${row.episode_number}`
                            : "RSS episode"}
                        </span>
                      </td>
                      <td>{row.podcast_title}</td>
                      <td>
                        {row.published_at ? formatDate(row.published_at) : "—"}
                      </td>
                      <td className="sl-cell-num">
                        {row.duration_seconds
                          ? `${Math.round(row.duration_seconds / 60)} min`
                          : "—"}
                      </td>
                      <td className="sl-cell-num">{row.ad_slot_count}</td>
                      <td>{row.audio_url ? "Available" : "—"}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={25} total={total} onPage={setPage} />
      </section>
      {selected ? (
        <Modal
          wide
          title={confirm ? `Delete ${selected.title}?` : selected.title}
          sub={`${selected.podcast_title} · ${selected.published_at ? formatDate(selected.published_at) : "Unscheduled"}`}
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
                  onClick={() => void remove()}
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
                  className="sl-btn sl-btn-primary"
                  onClick={() =>
                    setSlot({
                      slot_type: "mid_roll",
                      status: "planned",
                      duration_seconds: 60,
                      expected_impressions: 0,
                      delivered_impressions: 0,
                    })
                  }
                >
                  <Icon name="plus" /> Add ad slot
                </button>
              </>
            )
          }
        >
          <div className="sl-record-grid">
            <Metric
              label="Duration"
              value={
                selected.duration_seconds
                  ? `${Math.round(selected.duration_seconds / 60)} minutes`
                  : "Unknown"
              }
            />
            <Metric
              label="Audio"
              value={selected.audio_url || "Not available"}
            />
          </div>
          <h3 className="sl-section-title">Ad slots & airchecks</h3>
          {selected.ad_slots?.length ? (
            selected.ad_slots.map((item) => (
              <button
                key={item.id}
                className="sl-list-row"
                onClick={() => setSlot(item)}
              >
                <span>
                  <strong>{item.slot_type.replaceAll("_", " ")}</strong>
                  <small>
                    {item.io_number || "Unassigned"} · {item.status}
                  </small>
                </span>
                <span>
                  {formatNumber(item.delivered_impressions)} /{" "}
                  {formatNumber(item.expected_impressions)}
                </span>
              </button>
            ))
          ) : (
            <p className="sl-empty-line">No ad slots on this episode.</p>
          )}
        </Modal>
      ) : null}
      {form ? (
        <Modal
          title="New episode"
          sub="Manual episodes can be enriched later by an RSS match."
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
                onClick={() => void saveEpisode()}
              >
                {busy ? <Spinner sm /> : <Icon name="check" />} Save
              </button>
            </>
          }
        >
          <div className="sl-form-grid">
            <label className="sl-field">
              <span className="sl-field-label">Podcast *</span>
              <select
                className="sl-select"
                value={form.show_id}
                onChange={(e) => setForm({ ...form, show_id: e.target.value })}
              >
                {podcasts.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Title *" name="title" form={form} setForm={setForm} />
            <Field
              label="Published"
              name="published_at"
              type="date"
              form={form}
              setForm={setForm}
            />
            <Field
              label="Duration (seconds)"
              name="duration_seconds"
              type="number"
              form={form}
              setForm={setForm}
            />
            <label className="sl-field sl-form-full">
              <span className="sl-field-label">Audio URL</span>
              <input
                className="sl-input"
                value={form.audio_url}
                onChange={(e) =>
                  setForm({ ...form, audio_url: e.target.value })
                }
              />
            </label>
          </div>
        </Modal>
      ) : null}
      {slot && selected ? (
        <Modal
          title={slot.id ? "Edit ad slot" : "New ad slot"}
          sub="Track scheduled position, delivered impressions, and aircheck evidence."
          onClose={() => setSlot(null)}
          footer={
            <>
              <button
                className="sl-btn sl-btn-ghost"
                onClick={() => setSlot(null)}
              >
                Cancel
              </button>
              {slot.id ? (
                <button
                  className="sl-btn sl-btn-danger"
                  onClick={async () => {
                    await api.deleteAdSlot(slot.id!);
                    setSlot(null);
                    setSelected(await api.episode(selected.id));
                    await load();
                  }}
                >
                  <Icon name="close" /> Delete
                </button>
              ) : null}
              <button
                className="sl-btn sl-btn-primary"
                disabled={busy}
                onClick={() => void saveSlot()}
              >
                {busy ? <Spinner sm /> : <Icon name="check" />} Save
              </button>
            </>
          }
        >
          <div className="sl-form-grid">
            <Select
              label="Campaign"
              value={slot.campaign_id || ""}
              onChange={(value) =>
                setSlot({ ...slot, campaign_id: value || null })
              }
              options={campaigns.map((c) => [
                c.id,
                `${c.io_number} · ${c.advertiser_name}`,
              ])}
            />
            <Select
              label="Slot type"
              value={slot.slot_type || "mid_roll"}
              onChange={(value) => setSlot({ ...slot, slot_type: value })}
              options={[
                ["pre_roll", "Pre-roll"],
                ["mid_roll", "Mid-roll"],
                ["post_roll", "Post-roll"],
                ["host_read", "Host read"],
              ]}
            />
            <NumberField
              label="Position (seconds)"
              value={slot.position_seconds}
              onChange={(value) =>
                setSlot({ ...slot, position_seconds: value })
              }
            />
            <NumberField
              label="Duration (seconds)"
              value={slot.duration_seconds}
              onChange={(value) =>
                setSlot({ ...slot, duration_seconds: value })
              }
            />
            <NumberField
              label="Expected impressions"
              value={slot.expected_impressions}
              onChange={(value) =>
                setSlot({ ...slot, expected_impressions: value })
              }
            />
            <NumberField
              label="Delivered impressions"
              value={slot.delivered_impressions}
              onChange={(value) =>
                setSlot({ ...slot, delivered_impressions: value })
              }
            />
            <label className="sl-field sl-form-full">
              <span className="sl-field-label">Aircheck URL</span>
              <input
                className="sl-input"
                value={slot.aircheck_url || ""}
                onChange={(e) =>
                  setSlot({ ...slot, aircheck_url: e.target.value })
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
  type = "text",
}: {
  label: string;
  name: string;
  form: Record<string, string>;
  setForm: (v: Record<string, string>) => void;
  type?: string;
}) {
  return (
    <label className="sl-field">
      <span className="sl-field-label">{label}</span>
      <input
        className="sl-input"
        type={type}
        value={form[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
    </label>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
}) {
  return (
    <label className="sl-field">
      <span className="sl-field-label">{label}</span>
      <select
        className="sl-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Unassigned</option>
        {options.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number) => void;
}) {
  return (
    <label className="sl-field">
      <span className="sl-field-label">{label}</span>
      <input
        className="sl-input"
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
