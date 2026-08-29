"use client";

import { useRef, useState } from "react";
import { api, formatNumber } from "../lib/api";
import { parseCsv, toNum } from "../lib/csv";
import type { ImportResult } from "../lib/types";
import { Icon, Modal, ProgressBar, Spinner } from "../lib/ui";

interface Preview {
  ioRows: Record<string, unknown>[];
  deliveryRows: Record<string, unknown>[];
  warnings: string[];
}

export default function ImportModal({ onClose, onImported, push }: {
  onClose: () => void;
  onImported: () => Promise<void> | void;
  push: (tone: "success" | "error" | "info", message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onFileChange = async (f: File | null) => {
    setFile(f);
    setResult(null);
    setError(null);
    setPreview(null);
    if (!f) return;
    try {
      const rows = parseCsv(await f.text());
      if (rows.length < 2) {
        setError("The CSV needs a header row and at least one data row.");
        return;
      }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
      const kindCol = idx("kind", "type", "record", "rowtype");
      const ioCols = {
        ioNumber: idx("io_number", "io", "ionumber", "io #", "io#"),
        showTitle: idx("show", "showtitle", "show_title", "podcast", "program"),
        category: idx("category", "genre"),
        advertiserName: idx("advertiser", "advertisername", "advertiser_name", "client", "brand"),
        email: idx("email", "contact_email", "contact"),
        status: idx("status"),
        startDate: idx("start_date", "startdate", "start"),
        endDate: idx("end_date", "enddate", "end"),
        committedImpressions: idx("committed_impressions", "committed", "commitment", "imps_committed"),
        cpm: idx("cpm", "rate"),
      };
      const delCols = {
        ioNumber: idx("io_number", "io", "ionumber", "io #", "io#"),
        date: idx("date", "day"),
        impressions: idx("impressions", "impressions_delivered", "delivered", "imps"),
        source: idx("source"),
      };
      const looksLikeDelivery = kindCol >= 0 || (delCols.date >= 0 && delCols.impressions >= 0 && ioCols.showTitle < 0);
      const ioRows: Record<string, unknown>[] = [];
      const deliveryRows: Record<string, unknown>[] = [];
      const warnings: string[] = [];
      rows.slice(1).forEach((r, ri) => {
        const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
        const kind = kindCol >= 0 ? get(kindCol).toLowerCase() : "";
        const isDelivery = kind === "delivery" || (looksLikeDelivery && kind !== "io" && kind !== "campaign");
        if (isDelivery) {
          const ioNumber = get(delCols.ioNumber);
          if (!ioNumber) {
            warnings.push(`Row ${ri + 2}: delivery missing IO number — skipped.`);
            return;
          }
          deliveryRows.push({ ioNumber, date: get(delCols.date), impressions: toNum(get(delCols.impressions)), source: get(delCols.source) || "import" });
        } else {
          const ioNumber = get(ioCols.ioNumber);
          if (!ioNumber) {
            warnings.push(`Row ${ri + 2}: IO row missing IO number — skipped.`);
            return;
          }
          ioRows.push({
            ioNumber,
            showTitle: get(ioCols.showTitle) || "Unknown Podcast",
            category: get(ioCols.category) || "General",
            advertiserName: get(ioCols.advertiserName) || "Unknown Advertiser",
            email: get(ioCols.email) || "",
            status: get(ioCols.status) || "active",
            startDate: get(ioCols.startDate),
            endDate: get(ioCols.endDate),
            committedImpressions: toNum(get(ioCols.committedImpressions)),
            cpm: toNum(get(ioCols.cpm)),
          });
        }
      });
      if (ioRows.length === 0 && deliveryRows.length === 0) {
        setError("No valid rows detected. Check your column headers.");
        return;
      }
      setPreview({ ioRows, deliveryRows, warnings });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    }
  };

  const runImport = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(12);
    try {
      const res = await api.import({ ioRows: preview.ioRows, deliveryRows: preview.deliveryRows });
      setProgress(100);
      setResult(res);
      push(res.errors.length ? "info" : "success", `Import complete: ${res.importedIOs} IOs, ${res.importedDeliveries} deliveries.`);
      await onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import reconciliation data"
      sub="Upload a CSV of IO commitments and/or delivery records. We parse it locally, then POST JSON to /api/import."
      onClose={onClose}
      footer={
        <>
          <button className="sl-btn sl-btn-ghost" onClick={onClose}>Close</button>
          <button className="sl-btn sl-btn-primary" disabled={!preview || busy} onClick={() => void runImport()}>
            {busy ? <Spinner sm /> : <Icon name="upload" />} Confirm import
          </button>
        </>
      }
    >
      <label className="sl-dropzone" htmlFor="sl-file">
        <input ref={fileInputRef} id="sl-file" type="file" accept=".csv,text/csv" className="sl-file-input" onChange={(e) => void onFileChange(e.target.files?.[0] || null)} />
        <span className="sl-drop-icon"><Icon name="upload" /></span>
        <span className="sl-drop-text">{file ? file.name : "Choose a .csv file or drag it here"}</span>
        <span className="sl-drop-hint">Columns auto-detected: io_number, podcast/show, advertiser, status, dates, committed_impressions, cpm, date, impressions, source</span>
      </label>

      {error ? <div className="sl-inline-error"><Icon name="alert" /> {error}</div> : null}

      {preview ? (
        <div className="sl-preview">
          <div className="sl-preview-stats">
            <span className="sl-chip sl-chip-io">{preview.ioRows.length} IO rows</span>
            <span className="sl-chip sl-chip-del">{preview.deliveryRows.length} delivery rows</span>
          </div>
          {preview.warnings.length ? (
            <ul className="sl-warnings">{preview.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul>
          ) : null}
          <div className="sl-preview-cols">
            {preview.ioRows.length ? (
              <div className="sl-preview-col">
                <h5>Sample IOs</h5>
                <table className="sl-mini">
                  <thead><tr><th>IO</th><th>Podcast</th><th>Advert.</th><th>Committed</th></tr></thead>
                  <tbody>{preview.ioRows.slice(0, 4).map((r, i) => <tr key={i}><td>{String(r.ioNumber)}</td><td>{String(r.showTitle)}</td><td>{String(r.advertiserName)}</td><td>{formatNumber(Number(r.committedImpressions))}</td></tr>)}</tbody>
                </table>
              </div>
            ) : null}
            {preview.deliveryRows.length ? (
              <div className="sl-preview-col">
                <h5>Sample deliveries</h5>
                <table className="sl-mini">
                  <thead><tr><th>IO</th><th>Date</th><th>Imps</th></tr></thead>
                  <tbody>{preview.deliveryRows.slice(0, 4).map((r, i) => <tr key={i}><td>{String(r.ioNumber)}</td><td>{String(r.date)}</td><td>{formatNumber(Number(r.impressions))}</td></tr>)}</tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="sl-import-progress">
          <ProgressBar pct={progress} tone="ink" />
          <span className="sl-muted">Uploading & reconciling…</span>
        </div>
      ) : null}

      {result ? (
        <div className="sl-import-result">
          <div className="sl-result-grid">
            <div><span>{result.importedIOs}</span><small>IOs upserted</small></div>
            <div><span>{result.importedDeliveries}</span><small>deliveries added</small></div>
            <div><span>{result.errors.length}</span><small>row errors</small></div>
          </div>
          {result.errors.length ? (
            <details className="sl-result-errors"><summary>View {result.errors.length} error(s)</summary>
              <ul>{result.errors.slice(0, 10).map((e, i) => <li key={i}><code>{e.row}</code>: {e.error}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
