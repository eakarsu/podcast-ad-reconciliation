"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { Icon, Modal, Spinner } from "../lib/ui";

export default function SampleDataButton({
  onLoaded,
  push,
  label = "Load sample workspace",
}: {
  onLoaded: () => void | Promise<void>;
  push: (tone: "success" | "error" | "info", message: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.seedSampleData();
      await onLoaded();
      setOpen(false);
      push(
        "success",
        `Sample workspace ready: ${result.counts.shows} podcasts, ${result.counts.episodes} episodes, ${result.counts.campaigns} campaigns, and ${result.counts.alerts} alerts.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create sample data.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="sl-btn sl-btn-outline" onClick={() => setOpen(true)}>
        <Icon name="pulse" /> {label}
      </button>
      {open ? (
        <Modal
          title="Create a sample workspace"
          sub="Explore every reconciliation workflow without preparing a CSV first."
          onClose={() => { if (!busy) setOpen(false); }}
          footer={
            <>
              <button className="sl-btn sl-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="sl-btn sl-btn-primary" onClick={() => void load()} disabled={busy}>
                {busy ? <Spinner sm /> : <Icon name="plus" />} Create sample data
              </button>
            </>
          }
        >
          <div className="sl-sample-summary">
            <div><strong>18</strong><span>podcasts</span></div>
            <div><strong>18</strong><span>advertisers</span></div>
            <div><strong>33</strong><span>campaigns</span></div>
            <div><strong>18</strong><span>open issues</span></div>
            <div><strong>15</strong><span>invoice-ready</span></div>
          </div>
          <p className="sl-modal-note">Sample records are clearly labeled and added without overwriting anything already in your workspace. You can run this again safely.</p>
          {error ? <div className="sl-inline-error"><Icon name="alert" /> {error}</div> : null}
        </Modal>
      ) : null}
    </>
  );
}
