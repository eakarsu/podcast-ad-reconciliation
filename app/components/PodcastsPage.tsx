"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatDate, formatNumber } from "../lib/api";
import type { PodcastRow } from "../lib/types";
import {
  Icon,
  Modal,
  Notices,
  PageHead,
  Pagination,
  Spinner,
  useNotices,
} from "../lib/ui";

const emptyForm = {
  title: "",
  category: "",
  rss_url: "",
  cover_art_url: "",
  network: "",
  host: "",
  description: "",
  website_url: "",
  language: "en",
};

export default function PodcastsPage() {
  const [rows, setRows] = useState<PodcastRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<PodcastRow | null>(null);
  const [editing, setEditing] = useState<PodcastRow | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [rss, setRss] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { notices, push, dismiss } = useNotices();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.podcasts({
        q: q || undefined,
        page,
        pageSize: 25,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (error) {
      push(
        "error",
        error instanceof Error ? error.message : "Could not load podcasts.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, q, push]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);
  const openForm = (row?: PodcastRow) => {
    setEditing(row || null);
    setForm(
      row
        ? Object.fromEntries(
            Object.keys(emptyForm).map((key) => [
              key,
              String(row[key as keyof PodcastRow] ?? ""),
            ]),
          )
        : { ...emptyForm },
    );
    setSelected(null);
  };
  const save = async () => {
    if (!form?.title.trim()) return push("error", "Podcast title is required.");
    setBusy(true);
    try {
      if (editing) await api.updatePodcast(editing.id, form);
      else await api.createPodcast(form);
      push("success", editing ? "Podcast updated." : "Podcast created.");
      setForm(null);
      setEditing(null);
      await load();
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };
  const importRss = async () => {
    if (!rss?.trim()) return;
    setBusy(true);
    try {
      const result = await api.importPodcastRss(rss.trim());
      push(
        "success",
        `Imported ${result.podcast.title} and synchronized ${result.episodes_synced} episodes.`,
      );
      setRss(null);
      await load();
    } catch (error) {
      push(
        "error",
        error instanceof Error ? error.message : "RSS import failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const sync = async (row: PodcastRow) => {
    setBusy(true);
    try {
      const result = await api.syncPodcast(row.id);
      push("success", `Synchronized ${result.episodes_synced} episodes.`);
      setSelected(null);
      await load();
    } catch (error) {
      push("error", error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (row: PodcastRow) => {
    setBusy(true);
    try {
      await api.deletePodcast(row.id);
      push("success", `Deleted ${row.title}.`);
      setSelected(null);
      setConfirmDelete(false);
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
        title="Podcasts"
        tagline="Profiles, RSS synchronization, hosts, networks, and episode inventory"
        actions={
          <>
            <button
              className="sl-btn sl-btn-outline"
              onClick={() => setRss("")}
            >
              <Icon name="download" /> Import RSS
            </button>
            <button
              className="sl-btn sl-btn-primary"
              onClick={() => openForm()}
            >
              <Icon name="plus" /> New podcast
            </button>
          </>
        }
      />
      <section className="sl-filters">
        <div className="sl-search">
          <span className="sl-search-icon">
            <Icon name="search" />
          </span>
          <input
            className="sl-input"
            placeholder="Search title, host, or network…"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="sl-filter-meta">
          <span className="sl-count">{formatNumber(total)} podcasts</span>
        </div>
      </section>
      <section className="sl-tablewrap">
        <div className="sl-table-scroll">
          <table className="sl-table">
            <thead>
              <tr>
                <th>Podcast</th>
                <th>Host / Network</th>
                <th>Category</th>
                <th className="sl-th-right">Episodes</th>
                <th className="sl-th-right">Campaigns</th>
                <th>Last RSS sync</th>
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
                      onClick={() => {
                        setSelected(row);
                        setConfirmDelete(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setSelected(row);
                          setConfirmDelete(false);
                        }
                      }}
                    >
                      <td className="sl-cell-name">
                        <span className="sl-advertiser">{row.title}</span>
                        <span className="sl-show">
                          {row.rss_url || "Manual profile"}
                        </span>
                      </td>
                      <td>
                        <strong>{row.host || "—"}</strong>
                        <span className="sl-show">
                          {row.network || "Independent"}
                        </span>
                      </td>
                      <td>{row.category || "General"}</td>
                      <td className="sl-cell-num">
                        {formatNumber(row.episode_count)}
                      </td>
                      <td className="sl-cell-num">
                        {formatNumber(row.campaign_count)}
                      </td>
                      <td>
                        {row.last_synced_at
                          ? formatDate(row.last_synced_at)
                          : "Not synced"}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={25} total={total} onPage={setPage} />
      </section>
      {selected ? (
        <Modal
          title={confirmDelete ? `Delete ${selected.title}?` : selected.title}
          sub={
            confirmDelete
              ? "This is only allowed when no campaigns reference the podcast."
              : `${selected.host || "Host not set"} · ${selected.network || "Independent"}`
          }
          onClose={() => {
            if (!busy) {
              setSelected(null);
              setConfirmDelete(false);
            }
          }}
          footer={
            confirmDelete ? (
              <>
                <button
                  className="sl-btn sl-btn-ghost"
                  onClick={() => setConfirmDelete(false)}
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
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="close" /> Delete
                </button>
                <button
                  className="sl-btn sl-btn-outline"
                  onClick={() => openForm(selected)}
                >
                  <Icon name="edit" /> Edit
                </button>
                <button
                  className="sl-btn sl-btn-primary"
                  disabled={busy || !selected.rss_url}
                  onClick={() => void sync(selected)}
                >
                  {busy ? <Spinner sm /> : <Icon name="refresh" />} Sync RSS
                </button>
              </>
            )
          }
        >
          <div className="sl-record-grid">
            <Metric label="Category" value={selected.category || "General"} />
            <Metric
              label="Episodes"
              value={formatNumber(selected.episode_count)}
            />
            <Metric
              label="RSS feed"
              value={selected.rss_url || "Not connected"}
            />
            <Metric label="Website" value={selected.website_url || "Not set"} />
            <Metric label="Language" value={selected.language || "en"} />
            <Metric
              label="Last sync"
              value={
                selected.last_synced_at
                  ? formatDate(selected.last_synced_at)
                  : "Never"
              }
            />
          </div>
          {selected.description ? (
            <p className="sl-modal-note">{selected.description}</p>
          ) : null}
        </Modal>
      ) : null}
      {form ? (
        <Modal
          title={editing ? "Edit podcast" : "New podcast"}
          sub="RSS metadata is refreshed during synchronization; manual values remain useful for private feeds."
          onClose={() => !busy && setForm(null)}
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
                {busy ? <Spinner sm /> : <Icon name="check" />} Save podcast
              </button>
            </>
          }
        >
          <div className="sl-form-grid">
            {Object.entries({
              title: "Title *",
              rss_url: "RSS URL",
              host: "Host",
              network: "Network",
              category: "Category",
              cover_art_url: "Cover art URL",
              website_url: "Website URL",
              language: "Language",
            }).map(([key, label]) => (
              <label className="sl-field" key={key}>
                <span className="sl-field-label">{label}</span>
                <input
                  className="sl-input"
                  value={form[key] || ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <label className="sl-field sl-form-full">
              <span className="sl-field-label">Description</span>
              <textarea
                className="sl-input"
                rows={4}
                value={form.description || ""}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
          </div>
        </Modal>
      ) : null}
      {rss !== null ? (
        <Modal
          title="Import podcast RSS"
          sub="SignalLedger reads podcast metadata and upserts up to 1,000 episodes."
          onClose={() => !busy && setRss(null)}
          footer={
            <>
              <button
                className="sl-btn sl-btn-ghost"
                onClick={() => setRss(null)}
              >
                Cancel
              </button>
              <button
                className="sl-btn sl-btn-primary"
                disabled={busy || !rss.trim()}
                onClick={() => void importRss()}
              >
                {busy ? <Spinner sm /> : <Icon name="download" />} Import and
                sync
              </button>
            </>
          }
        >
          <label className="sl-field">
            <span className="sl-field-label">Public RSS URL</span>
            <input
              className="sl-input"
              autoFocus
              placeholder="https://feeds.example.org/podcast.xml"
              value={rss}
              onChange={(e) => setRss(e.target.value)}
            />
            <span className="sl-form-hint">
              Private-network URLs and redirects are blocked for safety.
            </span>
          </label>
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
