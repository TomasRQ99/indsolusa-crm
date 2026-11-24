// Month-by-month bars for one customer statistic (customer stats, 2026-11-24). Server component, no client code.
// Same rules as Viz.tsx: one axis from zero, the exact figure written on the biggest and the last bar, a tooltip on
// every month, and the table one click away on the same page. The muted tick is the same month one year earlier.
// Each month is a link: it opens the records behind that month's figures.

export type BarMonth = { key: string; label: string; value: number | null; prev: number | null; tip: string; href: string; on?: boolean };

export function StatBars({ months, title, short }: { months: BarMonth[]; title: string; short: (v: number) => string }) {
  const W = 360, col = W / Math.max(1, months.length), H = 76, T = 14, B = 14;
  const vals = months.flatMap((m) => [m.value ?? 0, m.prev ?? 0]).map(Math.abs);
  const max = Math.max(...vals, 0);
  const y = (v: number) => T + (1 - Math.abs(v) / (max || 1)) * (H - T - B);
  const bw = Math.max(3, Math.min(16, col - 4));
  const best = Math.max(...months.map((m) => Math.abs(m.value ?? 0)));
  const every = months.length <= 12 ? 1 : months.length <= 24 ? 3 : 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cs-chart" role="img" aria-label={title}>
      <line x1={0} x2={W} y1={H - B} y2={H - B} className="cs-base" />
      {months.map((m, k) => {
        const cx = k * col + col / 2;
        const v = m.value ?? 0;
        const h = max > 0 && v !== 0 ? Math.max(2, H - B - y(v)) : 0;
        const r = Math.min(4, h);
        const labelled = max > 0 && v !== 0 && (Math.abs(v) === best || k === months.length - 1);
        return (
          <a key={m.key} href={m.href} className={`cs-pt${m.on ? " on" : ""}`}>
            <rect x={k * col} y={0} width={col} height={H} className="cs-hit" />
            {h > 0 && <path d={`M${cx - bw / 2},${H - B} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`} className={`cs-bar${v < 0 ? " neg" : ""}`} />}
            {m.prev != null && m.prev !== 0 && max > 0 && <line x1={cx - bw / 2 - 2} x2={cx + bw / 2 + 2} y1={y(m.prev)} y2={y(m.prev)} className="cs-prev" />}
            {labelled && <text x={cx} y={y(v) - 3} textAnchor="middle" className="cs-v">{short(v)}</text>}
            {(k % every === 0 || k === months.length - 1) && <text x={cx} y={H - 3} textAnchor="middle" className="cs-ax">{m.label}</text>}
            <title>{m.tip}</title>
          </a>
        );
      })}
    </svg>
  );
}
