"use client";

import { formatCurrency, formatNumber } from "./api";
import type { PacingStatus, RevenueSlice, TrendPoint } from "./types";

/* ------------------------------------------------------------------ */
/*  Delivery trend (SVG area chart, no deps)                           */
/* ------------------------------------------------------------------ */

export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (!data.length) {
    return <p className="sl-muted sl-pad">No delivery data yet. Import delivery records to see the trend.</p>;
  }
  const W = 560;
  const H = 230;
  const padL = 52;
  const padR = 14;
  const padT = 14;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxVal = Math.max(...data.map((d) => d.impressions), 1);
  const step = Math.pow(10, Math.floor(Math.log10(maxVal))) / 2;
  const yMax = Math.ceil(maxVal / step) * step;

  const x = (i: number) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / yMax) * innerH;

  const linePoints = data.map((d, i) => `${x(i)},${y(d.impressions)}`).join(" ");
  const areaPath = `M ${x(0)},${padT + innerH} L ${data.map((d, i) => `${x(i)},${y(d.impressions)}`).join(" L ")} L ${x(data.length - 1)},${padT + innerH} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const labelIdx = data.length <= 2 ? data.map((_, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];
  const fmtShort = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

  return (
    <svg className="sl-trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly delivered impressions trend">
      <defs>
        <linearGradient id="sl-trend-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f3a5f" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#1f3a5f" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map((t) => (
        <g key={t}>
          <line className="sl-trend-grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
          <text className="sl-trend-ylab" x={padL - 8} y={y(t) + 3} textAnchor="end">{fmtShort(t)}</text>
        </g>
      ))}
      <path className="sl-trend-area" d={areaPath} />
      <polyline className="sl-trend-line" points={linePoints} />
      {data.map((d, i) => (
        <g key={d.bucket}>
          <circle className="sl-trend-dot" cx={x(i)} cy={y(d.impressions)} r={3.2}>
            <title>{`${d.bucket}: ${formatNumber(d.impressions)} impressions`}</title>
          </circle>
          <rect
            className="sl-trend-hit"
            x={x(i) - innerW / (data.length * 2)}
            y={padT}
            width={innerW / data.length}
            height={innerH}
          >
            <title>{`Week of ${d.bucket}: ${formatNumber(d.impressions)} impressions delivered`}</title>
          </rect>
        </g>
      ))}
      {labelIdx.map((i) => (
        <text key={i} className="sl-trend-xlab" x={x(i)} y={H - 8} textAnchor="middle">{data[i].bucket.slice(5)}</text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Revenue by advertiser (committed vs delivered bars)                */
/* ------------------------------------------------------------------ */

export function RevenueBars({ data }: { data: RevenueSlice[] }) {
  if (!data.length) {
    return <p className="sl-muted sl-pad">No revenue data yet.</p>;
  }
  const max = Math.max(...data.map((d) => d.committed_value), 1);
  return (
    <div>
      {data.map((d) => (
        <div key={d.advertiser} className="sl-rev-row">
          <div className="sl-rev-top">
            <span className="sl-rev-name">{d.advertiser}</span>
            <span className="sl-rev-val">{formatCurrency(d.delivered_value)} / {formatCurrency(d.committed_value)}</span>
          </div>
          <div className="sl-rev-bar" role="img" aria-label={`${d.advertiser}: ${formatCurrency(d.delivered_value)} delivered of ${formatCurrency(d.committed_value)} committed`}>
            <span className="sl-rev-fill-committed" />
            <span className="sl-rev-fill-delivered" style={{ width: `${Math.min(100, (d.delivered_value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
      <div className="sl-rev-legend">
        <span className="sl-rev-key"><i style={{ background: "linear-gradient(90deg,#3a6ba0,#1f3a5f)" }} /> Delivered value</span>
        <span className="sl-rev-key"><i style={{ background: "#d7e2ef" }} /> Committed value</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pacing donut                                                       */
/* ------------------------------------------------------------------ */

const PACING_META: Array<{ key: PacingStatus; label: string; color: string }> = [
  { key: "on_track", label: "On track", color: "#1f7a4d" },
  { key: "slight_risk", label: "Slight risk", color: "#c99a3a" },
  { key: "at_risk", label: "At risk", color: "#c85a57" },
  { key: "behind", label: "Behind", color: "#a5322f" },
  { key: "not_started", label: "Not started", color: "#9aa1ac" },
];

export function PacingDonut({ counts }: { counts: Record<PacingStatus, number> }) {
  const total = PACING_META.reduce((sum, m) => sum + (counts[m.key] || 0), 0);
  const countsArr = PACING_META.map((m) => ({
    ...m,
    value: counts[m.key] || 0,
  })).filter((m) => m.value > 0);

  if (!total) {
    return <p className="sl-muted sl-pad">No campaigns yet.</p>;
  }

  const R = 52;
  const C = 2 * Math.PI * R;
  const segments = countsArr.map((m, idx) => {
    const prev = countsArr.slice(0, idx).reduce((sum, k) => sum + (k.value / total) * C, 0);
    return { ...m, len: (m.value / total) * C, offset: prev };
  });

  return (
    <div className="sl-donut-wrap">
      <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Pacing distribution">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eef0f3" strokeWidth="16" />
        {segments.map((m) => (
          <circle
            key={m.key}
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={m.color}
            strokeWidth="16"
            strokeDasharray={`${m.len} ${C - m.len}`}
            strokeDashoffset={-m.offset}
            transform="rotate(-90 70 70)"
          >
            <title>{`${m.label}: ${m.value} campaign${m.value === 1 ? "" : "s"}`}</title>
          </circle>
        ))}
        <text className="sl-donut-center" x="70" y="68" textAnchor="middle">{total}</text>
        <text className="sl-donut-sublabel" x="70" y="84" textAnchor="middle">campaigns</text>
      </svg>
      <div className="sl-donut-legend">
        {PACING_META.map((m) => {
          const c = countsArr.find((k) => k.key === m.key);
          return (
            <span key={m.key} className="sl-donut-key">
              <i style={{ background: m.color }} /> {m.label} <b>{c ? c.value : 0}</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}
