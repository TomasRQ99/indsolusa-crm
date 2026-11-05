// Gerencia / Insights charts. Every chart is wrapped in <Q>, which requires the management
// question it answers and the answer in one line. Marks carry native tooltips; every chart
// has the same data as a table or list next to it, so color is never the only carrier.

import type { ReactNode } from "react";

export function Q({ q, a, children, side, id }: { q: string; a: ReactNode; children: ReactNode; side?: ReactNode; id?: string }) {
  return (
    <figure className="iq" id={id}>
      <figcaption>
        <span className="iq-k">?</span>
        <div><b className="iq-q">{q}</b><span className="iq-a">{a}</span></div>
        {side && <span className="iq-side">{side}</span>}
      </figcaption>
      <div className="iq-body">{children}</div>
    </figure>
  );
}

export function Legend({ items }: { items: { cls: string; label: string; shape?: "dot" | "ring" | "diamond" | "bar" }[] }) {
  return (
    <ul className="ilg">
      {items.map((x) => <li key={x.label}><i className={`ilg-${x.shape ?? "bar"} ${x.cls}`} />{x.label}</li>)}
    </ul>
  );
}

/** Stacked bars per month (counts). Segments separated by a 2px surface gap. */
export function StackBars({ cols, segs, label }: { label: string; cols: { label: string; values: number[]; tips: string[]; hl?: boolean }[]; segs: { cls: string }[] }) {
  const W = 520, H = 150, P = 28, top = 14;
  const max = Math.max(1, ...cols.map((c) => c.values.reduce((s, v) => s + v, 0)));
  const step = (W - P * 2) / cols.length;
  const bw = Math.min(44, step - 14);
  const y = (v: number) => (v / max) * (H - top);
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} className="ich" role="img" aria-label={label}>
      <line x1={P} x2={W - P} y1={H} y2={H} className="ich-base" />
      {cols.map((c, n) => {
        let acc = 0;
        const x = P + n * step + (step - bw) / 2;
        const total = c.values.reduce((s, v) => s + v, 0);
        return (
          <g key={n}>
            {c.values.map((v, k) => {
              if (!v) return null;
              const h = y(v);
              const yy = H - y(acc) - h;
              acc += v;
              return <rect key={k} x={x} y={yy + 1} width={bw} height={Math.max(1, h - 2)} rx={k === c.values.length - 1 || c.values.slice(k + 1).every((z) => !z) ? 4 : 0} className={segs[k].cls}><title>{c.tips[k]}</title></rect>;
            })}
            {total > 0 && <text x={x + bw / 2} y={H - y(total) - 4} className="ich-v" textAnchor="middle">{total}</text>}
            <text x={x + bw / 2} y={H + 16} className={`ich-ax${c.hl ? " hl" : ""}`} textAnchor="middle">{c.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** One row per Journey: original promise at 0, revised (diamond), actual (dot), in days. */
export function PromiseStrip({ rows, label, early, late }: { label: string; early: string; late: string; rows: { label: string; href: string; revised: number | null; actual: number | null; cls: string; tip: string }[] }) {
  const W = 600, L = 210, R = 20, rh = 24, top = 22;
  const span = Math.max(5, ...rows.flatMap((r) => [Math.abs(r.revised ?? 0), Math.abs(r.actual ?? 0)]));
  const x = (v: number) => L + ((v + span) / (span * 2)) * (W - L - R);
  const H = top + rows.length * rh + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ich" role="img" aria-label={label}>
      <text x={x(-span)} y={12} className="ich-ax" textAnchor="start">← {early}</text>
      <text x={x(span)} y={12} className="ich-ax" textAnchor="end">{late} →</text>
      <line x1={x(0)} x2={x(0)} y1={top - 6} y2={H - 4} className="ich-zero" />
      {rows.map((r, n) => {
        const cy = top + n * rh + rh / 2;
        return (
          <g key={n}>
            <a href={r.href}><text x={L - 10} y={cy + 4} className="ich-lb" textAnchor="end">{r.label}</text></a>
            <line x1={x(Math.min(0, r.revised ?? 0, r.actual ?? 0))} x2={x(Math.max(0, r.revised ?? 0, r.actual ?? 0))} y1={cy} y2={cy} className="ich-span" />
            <circle cx={x(0)} cy={cy} r={5} className="ich-orig"><title>{r.tip}</title></circle>
            {r.revised != null && <rect x={x(r.revised) - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${x(r.revised)} ${cy})`} className="ich-rev"><title>{r.tip}</title></rect>}
            {r.actual != null && <circle cx={x(r.actual)} cy={cy} r={5.5} className={`ich-act ${r.cls}`}><title>{r.tip}</title></circle>}
          </g>
        );
      })}
    </svg>
  );
}

/** Esagra % per Journey: protected (ring) → current (small dot) → final (filled). */
export function Dumbbell({ rows, label }: { label: string; rows: { label: string; href: string; prot: number | null; cur: number | null; fin: number | null; down: boolean; tip: string }[] }) {
  const W = 600, L = 210, R = 34, rh = 24, top = 20;
  const vals = rows.flatMap((r) => [r.prot, r.cur, r.fin]).filter((v): v is number => v != null);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 3) / 5) * 5), hi = Math.ceil((Math.max(...vals) + 3) / 5) * 5;
  const x = (v: number) => L + ((v - lo) / Math.max(1, hi - lo)) * (W - L - R);
  const H = top + rows.length * rh + 8;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ich" role="img" aria-label={label}>
      {ticks.map((v) => <g key={v}><line x1={x(v)} x2={x(v)} y1={top - 4} y2={H - 4} className="ich-grid" /><text x={x(v)} y={11} className="ich-ax" textAnchor="middle">{v} %</text></g>)}
      {rows.map((r, n) => {
        const cy = top + n * rh + rh / 2;
        const end = r.fin ?? r.cur;
        return (
          <g key={n}>
            <a href={r.href}><text x={L - 10} y={cy + 4} className="ich-lb" textAnchor="end">{r.label}</text></a>
            {r.prot != null && end != null && <line x1={x(r.prot)} x2={x(end)} y1={cy} y2={cy} className={`ich-dl${r.down ? " down" : ""}`} />}
            {r.prot != null && <circle cx={x(r.prot)} cy={cy} r={5} className="ich-prot"><title>{r.tip}</title></circle>}
            {r.cur != null && r.fin == null && <circle cx={x(r.cur)} cy={cy} r={4.5} className="ich-cur"><title>{r.tip}</title></circle>}
            {r.fin != null && <circle cx={x(r.fin)} cy={cy} r={5.5} className={`ich-fin${r.down ? " down" : ""}`}><title>{r.tip}</title></circle>}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal bars with the value written at the end (no color-only meaning). */
export function HBars({ rows, label, unit = "" }: { label: string; unit?: string; rows: { label: string; value: number; tip: string; cls?: string; href?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="ihb" aria-label={label}>
      {rows.map((r) => (
        <li key={r.label} title={r.tip}>
          <span className="ihb-l">{r.href ? <a href={r.href}>{r.label}</a> : r.label}</span>
          <span className="ihb-t"><i className={r.cls ?? ""} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
          <span className="ihb-v">{unit}{r.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
        </li>
      ))}
    </ul>
  );
}

/** Timing of one certainty level. Its own scale; certainty levels are never stacked. */
export function Horizon({ cols, label, money }: { label: string; money: boolean; cols: { label: string; n: number; amount: number; tip: string; cls?: string }[] }) {
  const W = 300, H = 70, P = 6;
  const v = (c: (typeof cols)[number]) => (money ? c.amount : c.n);
  const max = Math.max(1, ...cols.map(v));
  const step = (W - P * 2) / cols.length;
  const bw = step - 10;
  return (
    <svg viewBox={`0 0 ${W} ${H + 28}`} className="ich" role="img" aria-label={label}>
      <line x1={P} x2={W - P} y1={H} y2={H} className="ich-base" />
      {cols.map((c, n) => {
        const h = v(c) ? Math.max(3, (v(c) / max) * (H - 14)) : 0;
        const x = P + n * step + 5;
        return (
          <g key={n}>
            {h > 0 && <rect x={x} y={H - h} width={bw} height={h} rx={4} className={c.cls ?? "ich-fut"}><title>{c.tip}</title></rect>}
            {c.n > 0 && <text x={x + bw / 2} y={H - h - 4} className="ich-v" textAnchor="middle">{money ? `${Math.round(c.amount / 1000)}k` : c.n}</text>}
            <text x={x + bw / 2} y={H + 14} className="ich-ax" textAnchor="middle">{c.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
