// Small real-data trends for 360 views. Rendered only with enough points (min 3);
// otherwise the caller shows the raw rows. Each mark carries a native tooltip.

type Pt = { label: string; value: number; tip: string };

/** Days late (+) / early (−) per event, around a zero baseline (the promise). */
export function DeltaBars({ pts, title, unit }: { pts: Pt[]; title: string; unit: string }) {
  const W = 360, H = 96, P = 18, base = H / 2;
  const max = Math.max(3, ...pts.map((p) => Math.abs(p.value)));
  const bw = Math.min(26, (W - 2 * P) / pts.length - 4);
  const step = (W - 2 * P) / pts.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="tr" role="img" aria-label={title}>
      <line x1={P} x2={W - P} y1={base} y2={base} className="tr-base" />
      <text x={W - P} y={base - 4} className="tr-ax" textAnchor="end">{unit === "d" ? "0 d" : "0"}</text>
      {pts.map((p, n) => {
        const h = Math.max(2, (Math.abs(p.value) / max) * (base - 8));
        const x = P + n * step + (step - bw) / 2;
        const y = p.value >= 0 ? base - h : base;
        return (
          <g key={n}>
            <rect x={x} y={y} width={bw} height={h} rx={3} className={p.value > 0 ? "tr-late" : "tr-early"}><title>{p.tip}</title></rect>
            {(n === 0 || n === pts.length - 1 || Math.abs(p.value) === max) && <text x={x + bw / 2} y={p.value >= 0 ? y - 3 : y + h + 10} className="tr-v" textAnchor="middle">{p.value > 0 ? "+" : ""}{p.value}</text>}
            <text x={x + bw / 2} y={H + 12} className="tr-ax" textAnchor="middle">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Unit price over time (one series). */
export function PriceLine({ pts, title }: { pts: Pt[]; title: string }) {
  const W = 360, H = 90, P = 22;
  const vs = pts.map((p) => p.value);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.15 || hi * 0.05 || 1;
  const y = (v: number) => H - 8 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 24);
  const x = (n: number) => P + (n * (W - 2 * P)) / Math.max(1, pts.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="tr" role="img" aria-label={title}>
      <polyline points={pts.map((p, n) => `${x(n)},${y(p.value)}`).join(" ")} className="tr-line" />
      {pts.map((p, n) => (
        <g key={n}>
          <circle cx={x(n)} cy={y(p.value)} r={4} className="tr-dot"><title>{p.tip}</title></circle>
          {(n === 0 || n === pts.length - 1) && <text x={x(n)} y={y(p.value) - 8} className="tr-v" textAnchor="middle">{p.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}</text>}
          <text x={x(n)} y={H + 12} className="tr-ax" textAnchor="middle">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
