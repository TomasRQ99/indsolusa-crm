// Small shared charts for number-heavy screens (audit 2026-11-12). Server components, no client code.
// Rules: colour = state (green protected, amber attention, red risk, blue neutral magnitude); a state colour always
// comes with a sign, arrow or label, never alone; every mark has a native tooltip; the exact figure stays visible
// as text next to the chart, so the chart helps to decide and the number stays the source.

import type { ReactNode } from "react";

export type Tone = "ok" | "attn" | "risk" | "info" | "wait" | "ai" | "s1" | "s2" | "s3" | "s4";
/** Which direction is good news for a figure. "none" = a change is neither good nor bad by itself. */
export type Good = "up" | "down" | "none";

/** Change against a previous value: arrow + signed figure, green when it moved the good way, red the other way. */
export function Delta({ now, prev, good = "up", fmt, same }: { now: number; prev: number | null; good?: Good; fmt: (abs: number) => string; same: string }) {
  if (prev == null) return <span className="vz-d none">—</span>;
  const d = Math.round((now - prev) * 100) / 100;
  if (d === 0) return <span className="vz-d none">{same}</span>;
  const up = d > 0;
  const cls = good === "none" ? "flat" : (good === "up") === up ? "ok" : "risk";
  return <span className={`vz-d ${cls}`}><i aria-hidden="true">{up ? "▲" : "▼"}</i>{up ? "+" : "−"}{fmt(Math.abs(d))}</span>;
}

/** Two thin bars on one scale: this period (solid) over the previous one (muted). */
export function PairBar({ now, prev, tipNow, tipPrev, label }: { now: number; prev: number | null; tipNow: string; tipPrev: string; label: string }) {
  const max = Math.max(Math.abs(now), Math.abs(prev ?? 0));
  if (max === 0) return null;
  const w = (v: number) => `${Math.max(v === 0 ? 0 : 3, (Math.abs(v) / max) * 100)}%`;
  return (
    <span className="vz-pair" role="img" aria-label={label}>
      <i className="now" style={{ width: w(now) }} title={tipNow} />
      {prev != null && <i className="prev" style={{ width: w(prev) }} title={tipPrev} />}
    </span>
  );
}

/** Progress or share, 0–100 %. `mark` draws a tick (for example "expected by today"). */
export function Meter({ pct, tone = "info", label, mark, markTip }: { pct: number; tone?: Tone; label: string; mark?: number | null; markTip?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className="vz-meter" role="img" aria-label={label} title={label}>
      <i className={tone} style={{ width: `${p}%` }} />
      {mark != null && <em style={{ left: `${Math.max(0, Math.min(100, mark))}%` }} title={markTip} />}
    </span>
  );
}

export type Part = { key: string; label: string; value: number; tone: Tone; text: string; href?: string; n?: number };
/** One bar split into parts (composition of a total), with a legend that carries the figures. Zero parts are left out. */
export function Split({ parts, label, caption }: { parts: Part[]; label: string; caption?: ReactNode }) {
  const live = parts.filter((p) => p.value > 0);
  const total = live.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return (
    <figure className="vz-split">
      {caption && <figcaption>{caption}</figcaption>}
      <div className="vz-split-bar" role="img" aria-label={label}>
        {live.map((p) => <i key={p.key} className={p.tone} style={{ flexGrow: p.value, flexBasis: 0 }} title={`${p.label}: ${p.text} · ${Math.round((p.value / total) * 100)} %`} />)}
      </div>
      <ul className="vz-legend">
        {live.map((p) => (
          <li key={p.key}><i className={p.tone} />{p.href ? <a href={p.href}>{p.label}</a> : <span>{p.label}</span>} <b>{p.text}</b>{p.n != null && <span className="n">({p.n})</span>} <span className="n">{Math.round((p.value / total) * 100)} %</span></li>
        ))}
      </ul>
    </figure>
  );
}

/** Money in and out per horizon, with the resulting balance written under each pair (red when below zero). */
export function FlowCols({ cols, label, inLabel, outLabel, netLabel, fmt }: { label: string; inLabel: string; outLabel: string; netLabel: string; fmt: (n: number) => string; cols: { label: string; inflow: number; outflow: number; net: number }[] }) {
  const W = 560, H = 120, top = 16, P = 8;
  const max = Math.max(1, ...cols.flatMap((c) => [c.inflow, c.outflow]));
  const step = (W - P * 2) / cols.length;
  const bw = Math.min(46, (step - 26) / 2);
  const h = (v: number) => (v <= 0 ? 0 : Math.max(3, (v / max) * (H - top)));
  const short = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v)));
  return (
    <figure className="vz-flow">
      <svg viewBox={`0 0 ${W} ${H + 44}`} role="img" aria-label={label}>
        <line x1={P} x2={W - P} y1={H} y2={H} className="vz-base" />
        {cols.map((c, n) => {
          const cx = P + n * step + step / 2;
          const hi = h(c.inflow), ho = h(c.outflow);
          return (
            <g key={n}>
              {hi > 0 && <rect x={cx - bw - 1} y={H - hi} width={bw} height={hi} rx={4} className="vz-in"><title>{`${c.label} · ${inLabel}: ${fmt(c.inflow)}`}</title></rect>}
              {ho > 0 && <rect x={cx + 1} y={H - ho} width={bw} height={ho} rx={4} className="vz-out"><title>{`${c.label} · ${outLabel}: ${fmt(c.outflow)}`}</title></rect>}
              {hi > 0 && <text x={cx - bw / 2 - 1} y={H - hi - 4} textAnchor="middle" className="vz-v">{short(c.inflow)}</text>}
              {ho > 0 && <text x={cx + bw / 2 + 1} y={H - ho - 4} textAnchor="middle" className="vz-v">{short(c.outflow)}</text>}
              <text x={cx} y={H + 15} textAnchor="middle" className="vz-ax">{c.label}</text>
              <text x={cx} y={H + 34} textAnchor="middle" className={`vz-net${c.net < 0 ? " risk" : ""}`}>{c.net < 0 ? "▼ " : ""}{fmt(c.net)}<title>{`${c.label} · ${netLabel}: ${fmt(c.net)}`}</title></text>
            </g>
          );
        })}
      </svg>
      <ul className="vz-legend">
        <li><i className="ok" />{inLabel}</li>
        <li><i className="wait" />{outLabel}</li>
        <li><span className="n">{netLabel}</span></li>
      </ul>
    </figure>
  );
}

/** A bar inside a table cell, behind nothing: figure on the left, bar on the right, shared scale `max`. */
export function CellBar({ value, max, tone = "info", tip }: { value: number; max: number; tone?: Tone; tip: string }) {
  const w = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  return <span className="vz-cell" title={tip} aria-hidden="true"><i className={tone} style={{ width: `${w}%` }} /></span>;
}
