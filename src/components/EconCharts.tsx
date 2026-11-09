// Economic patterns across years. Thin marks, direct labels, recessive grid, native tooltips on every mark,
// a table always next to the chart (the chart never carries information alone).

type Pt = { year: number; v: number | null; top?: string; tip: string };

/** One measure per year (e.g. revenue). Bars anchored to zero, rounded data-end, optional label on top. */
export function YearBars({ pts, label }: { pts: Pt[]; label: string }) {
  const W = 560, H = 150, P = 16, top = 18, base0 = H - 20;
  const vs = pts.map((p) => p.v ?? 0);
  const hi = Math.max(0, ...vs), lo = Math.min(0, ...vs);
  const span = hi - lo || 1;
  const y = (v: number) => top + ((hi - v) / span) * (base0 - top);
  const zero = y(0);
  const step = (W - 2 * P) / Math.max(1, pts.length);
  const bw = Math.min(56, step - 14);
  const bar = (x: number, v: number) => {
    const yv = y(v), r = Math.min(4, Math.abs(zero - yv) / 2);
    return v >= 0
      ? `M${x},${zero} V${yv + r} Q${x},${yv} ${x + r},${yv} H${x + bw - r} Q${x + bw},${yv} ${x + bw},${yv + r} V${zero} Z`
      : `M${x},${zero} V${yv - r} Q${x},${yv} ${x + r},${yv} H${x + bw - r} Q${x + bw},${yv} ${x + bw},${yv - r} V${zero} Z`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ich ec" role="img" aria-label={label}>
      <line x1={P} x2={W - P} y1={zero} y2={zero} className="ich-base" />
      {pts.map((p, n) => {
        const x = P + n * step + (step - bw) / 2;
        return (
          <g key={p.year}>
            {p.v != null && <path d={bar(x, p.v)} className={p.v >= 0 ? "ec-bar" : "ec-bar neg"} />}
            {p.top && p.v != null && <text x={x + bw / 2} y={p.v >= 0 ? y(p.v) - 5 : y(p.v) + 12} className="ich-v" textAnchor="middle">{p.top}</text>}
            <text x={x + bw / 2} y={H - 4} className="ich-ax" textAnchor="middle">FY{p.year}</text>
            <rect x={P + n * step} y={0} width={step} height={H} className="ec-hit"><title>{p.tip}</title></rect>
          </g>
        );
      })}
    </svg>
  );
}

type Series = { label: string; cls: string; pts: Pt[] };

/** Several companies on one scale: each indexed to 100 in the base year, so big and small read together.
 *  Lines 2px, markers with a surface ring, the name at the end of each line. */
export function IndexLines({ series, years, label, base = 100, fmt }: { series: Series[]; years: number[]; label: string; base?: number; fmt: (v: number) => string }) {
  const W = 680, H = 240, L = 40, R = 150, top = 14, bottom = 24;
  const vals = series.flatMap((s) => s.pts.map((p) => p.v).filter((v): v is number => v != null));
  if (!vals.length || years.length < 2) return null;
  // Round ticks (20, 50, 100…) that always include the base line.
  const rawLo = Math.min(base, ...vals), rawHi = Math.max(base, ...vals);
  const mag = Math.pow(10, Math.floor(Math.log10((rawHi - rawLo) / 4 || 1)));
  const stepV = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (rawHi - rawLo) / s <= 5) ?? 10 * mag;
  const lo = Math.floor(rawLo / stepV) * stepV, hi = Math.ceil(rawHi / stepV) * stepV;
  const x = (yr: number) => L + ((yr - years[0]) / (years[years.length - 1] - years[0])) * (W - L - R);
  const y = (v: number) => top + ((hi - v) / (hi - lo || 1)) * (H - top - bottom);
  const ticks: number[] = []; for (let v = lo; v <= hi + 1e-9; v += stepV) ticks.push(Math.round(v * 100) / 100);
  if (!ticks.includes(base)) ticks.push(base);
  // End labels: one per series, nudged apart so they never overlap.
  const ends = series.map((s) => { const last = [...s.pts].reverse().find((p) => p.v != null); return last ? { s, last, yy: y(last.v!) } : null; }).filter(Boolean) as { s: Series; last: Pt; yy: number }[];
  ends.sort((a, b) => a.yy - b.yy);
  for (let k = 1; k < ends.length; k++) if (ends[k].yy - ends[k - 1].yy < 14) ends[k].yy = ends[k - 1].yy + 14;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ich ec" role="img" aria-label={label}>
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ich-grid" /><text x={L - 6} y={y(v) + 3} className="ich-ax" textAnchor="end">{fmt(v)}</text></g>)}
      <line x1={L} x2={W - R} y1={y(base)} y2={y(base)} className="ich-zero" />
      {years.map((yr) => <text key={yr} x={x(yr)} y={H - 6} className="ich-ax" textAnchor="middle">FY{yr}</text>)}
      {series.map((s) => {
        const seg: Pt[][] = [[]];
        for (const p of s.pts) { if (p.v == null) { if (seg[seg.length - 1].length) seg.push([]); } else seg[seg.length - 1].push(p); }
        return (
          <g key={s.label}>
            {seg.filter((g) => g.length > 1).map((g, n) => <polyline key={n} points={g.map((p) => `${x(p.year)},${y(p.v!)}`).join(" ")} className={`ec-line ${s.cls}`} />)}
            {s.pts.filter((p) => p.v != null).map((p) => <circle key={p.year} cx={x(p.year)} cy={y(p.v!)} r={4} className={`ec-dot ${s.cls}`}><title>{p.tip}</title></circle>)}
          </g>
        );
      })}
      {ends.map((e) => <text key={e.s.label} x={x(e.last.year) + 10} y={e.yy + 4} className="ich-lb">{e.s.label.length > 22 ? `${e.s.label.slice(0, 21)}…` : e.s.label} · {fmt(e.last.v!)}</text>)}
    </svg>
  );
}

export const SERIES_CLS = ["ec-s1", "ec-s2", "ec-s3", "ec-s4"] as const;
