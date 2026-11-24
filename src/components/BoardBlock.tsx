import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import type { Board, BoardExtras } from "@/lib/board";
import { RouteStrip, SalesAndCustomers } from "@/components/BoardExtras";
import { CellBar, Delta } from "@/components/Viz";

// MI TABLERO on Mi Día. Server component: the section, the period and Mío/Equipo travel in the address, so a
// filtered view can be bookmarked or shared. Chart rules follow Viz.tsx: one axis from zero, the exact figures
// stay written next to the chart, every point has a tooltip, and the table view is one click away.

function CompareLine({ b, i }: { b: Board; i: I18n }) {
  const { t } = i;
  const W = 640, H = 180, L = 30, R = 34, T = 12, B = 22;
  const max = Math.max(1, ...b.buckets.flatMap((x) => [x.now, x.prev]));
  const step = max <= 4 ? 1 : Math.ceil(max / 4 / (max > 40 ? 10 : max > 16 ? 5 : 1)) * (max > 40 ? 10 : max > 16 ? 5 : 1);
  const top = Math.ceil(max / step) * step;
  const n = b.buckets.length;
  const x = (k: number) => L + (k * (W - L - R)) / Math.max(1, n - 1);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const pts = (key: "now" | "prev") => b.buckets.map((p, k) => `${x(k)},${y(p[key])}`).join(" ");
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step);
  const labelAt = new Set([0, Math.floor((n - 1) / 2), n - 1]);
  const last = b.buckets[n - 1];
  const col = (W - L - R) / Math.max(1, n - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bd-chart" role="img" aria-label={t(`${b.meta.created}: este periodo frente al anterior`, `${b.meta.created}: this period against the previous one`)}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "bd-base" : "bd-grid"} />
          <text x={L - 6} y={y(v) + 3} textAnchor="end" className="bd-ax">{v}</text>
        </g>
      ))}
      <polyline points={pts("prev")} className="bd-prev" />
      <polyline points={pts("now")} className="bd-now" />
      {b.buckets.map((p, k) => (
        <g key={k} className="bd-pt">
          <line x1={x(k)} x2={x(k)} y1={T} y2={H - B} className="bd-cross" />
          <circle cx={x(k)} cy={y(p.prev)} r={3} className="bd-dot-prev" />
          <circle cx={x(k)} cy={y(p.now)} r={4.5} className="bd-dot" />
          {labelAt.has(k) && <text x={x(k)} y={H - 6} textAnchor={k === 0 ? "start" : k === n - 1 ? "end" : "middle"} className="bd-ax">{p.label}</text>}
          <rect x={x(k) - col / 2} y={T} width={col} height={H - T - B} className="bd-hit">
            <title>{t(`${p.range}: ${p.now} · periodo anterior (${p.prevRange}): ${p.prev}`, `${p.range}: ${p.now} · previous period (${p.prevRange}): ${p.prev}`)}</title>
          </rect>
        </g>
      ))}
      <text x={x(n - 1) + 8} y={y(last.now) + (last.now >= last.prev ? -2 : 10)} className="bd-v">{last.now}</text>
      {last.prev !== last.now && <text x={x(n - 1) + 8} y={y(last.prev) + (last.prev > last.now ? -2 : 10)} className="bd-v prev">{last.prev}</text>}
    </svg>
  );
}

export function BoardBlock({ b, x, i }: { b: Board; x?: BoardExtras | null; i: I18n }) {
  const { t } = i;
  const href = (o: { s?: string; p?: string; eq?: boolean }) => {
    const q = new URLSearchParams({ s: o.s ?? b.section, p: o.p ?? b.period });
    if (o.eq ?? b.team) q.set("eq", "1");
    return `/mi-dia?${q}`;
  };
  const periods: [string, string][] = [["7", t("7 días", "7 days")], ["30", t("30 días", "30 days")], ["90", t("3 meses", "3 months")], ["365", t("12 meses", "12 months")]];
  const maxAge = Math.max(1, ...b.ages.map((a) => a.n));
  const pct = b.totalPrev > 0 ? Math.round(((b.totalNow - b.totalPrev) / b.totalPrev) * 100) : null;
  return (
    <section className="mblock bd" data-zone="flow" aria-labelledby="h-bd" id="tablero">
      <div className="bhead">
        <b id="h-bd">{t("MI TABLERO", "MY BOARD")}</b>
        <span>{b.team ? t("todo el equipo", "the whole team") : t("solo lo tuyo", "only yours")} · {t("elige una sección para ver cómo va frente al periodo anterior", "pick a section to see how it is doing against the previous period")}</span>
        <span className="grow" />
        <Link className="bd-team-link" href="/mi-dia/equipo">{t("Comparar equipo →", "Compare the team →")}</Link>
        {b.canTeam && (
          <nav className="seg" aria-label={t("De quién", "Whose")}>
            <Link href={href({ eq: false })} className={!b.team ? "on" : undefined} aria-current={!b.team ? "true" : undefined} scroll={false}>{t("Mío", "Mine")}</Link>
            <Link href={href({ eq: true })} className={b.team ? "on" : undefined} aria-current={b.team ? "true" : undefined} scroll={false}>{t("Equipo", "Team")}</Link>
          </nav>
        )}
      </div>

      {x && <RouteStrip x={x} i={i} />}

      <nav className="bd-cards" aria-label={t("Secciones", "Sections")}>
        {b.cards.map((c) => (
          <Link key={c.key} href={href({ s: c.key })} className={`bd-card${c.key === b.section ? " on" : ""}`} aria-current={c.key === b.section ? "true" : undefined} scroll={false}>
            <span className="bd-k">{c.label}</span>
            <span className="bd-n">{c.active}<small>{c.active === 1 ? t("abierta ahora", "open now") : t("abiertas ahora", "open now")}</small></span>
            <span className="bd-s">
              {c.late > 0 && <span className="sig risk">{c.late} {t("pasaron su fecha", "past their date")}</span>}
              {c.quiet > 0 && <span className="sig attn">{c.quiet} {t("sin seguimiento", "no follow-up")}</span>}
              {c.active > 0 && c.late === 0 && c.quiet === 0 && <span className="sig ok">{t("al día", "up to date")}</span>}
            </span>
          </Link>
        ))}
      </nav>

      <div className="bd-two">
        <div className="bd-pane">
          <div className="bd-ph">
            <b>{b.meta.created}</b>
            <nav className="seg" aria-label={t("Periodo", "Period")}>
              {periods.map(([k, label]) => <Link key={k} href={href({ p: k })} className={k === b.period ? "on" : undefined} aria-current={k === b.period ? "true" : undefined} scroll={false}>{label}</Link>)}
            </nav>
          </div>
          <p className="bd-total">
            <b>{b.totalNow}</b> {t(`del ${i.day(b.start)} al ${i.day(b.end)}`, `from ${i.day(b.start)} to ${i.day(b.end)}`)}
            {" · "}<Delta now={b.totalNow} prev={b.totalPrev} good="up" fmt={(a) => String(a)} same={t("igual que el periodo anterior", "same as the previous period")} />
            {" "}<span className="src">{t(`frente a ${b.totalPrev} del ${i.day(b.prevStart)} al ${i.day(b.prevEnd)}`, `against ${b.totalPrev} from ${i.day(b.prevStart)} to ${i.day(b.prevEnd)}`)}{pct != null && b.totalNow !== b.totalPrev ? ` (${pct > 0 ? "+" : "−"}${Math.abs(pct)} %)` : ""}</span>
          </p>
          {b.totalNow + b.totalPrev === 0 ? (
            <p className="quiet-p">{t("No se creó ninguna en este periodo ni en el anterior. ", "None was created in this period or the previous one. ")}<Link href={b.meta.listHref}>{t("Abrir la lista", "Open the list")}</Link></p>
          ) : (
            <>
              <CompareLine b={b} i={i} />
              <ul className="bd-legend">
                <li><i className="now" />{t("Este periodo", "This period")}</li>
                <li><i className="prev" />{t("Periodo anterior", "Previous period")}</li>
              </ul>
              <details className="bd-table">
                <summary>{t("Ver las cifras en tabla", "See the figures as a table")}</summary>
                <div className="tscroll"><table>
                  <thead><tr><th>{t("Este periodo", "This period")}</th><th className="num">{t("Creadas", "Created")}</th><th>{t("Periodo anterior", "Previous period")}</th><th className="num">{t("Creadas", "Created")}</th></tr></thead>
                  <tbody>{b.buckets.map((p, k) => <tr key={k}><td>{p.range}</td><td className="num">{p.now}</td><td>{p.prevRange}</td><td className="num">{p.prev}</td></tr>)}</tbody>
                </table></div>
              </details>
            </>
          )}
        </div>

        <div className="bd-pane">
          <div className="bd-ph"><b>{t(`Antigüedad de las ${b.active} abiertas`, `Age of the ${b.active} open ones`)}</b></div>
          {b.active === 0 ? (
            <p className="quiet-p"><span className="sig ok">{t("Nada abierto", "Nothing open")}</span> {t("en esta sección.", "in this section.")}</p>
          ) : (
            <>
              <table className="bd-ages">
                <tbody>{b.ages.map((a) => <tr key={a.label}><th scope="row">{a.label}</th><td className="num">{a.n}</td><td><CellBar value={a.n} max={maxAge} tone={a.tone} tip={`${a.label}: ${a.n}`} /></td></tr>)}</tbody>
              </table>
              <div className="bd-ph"><b>{t("Las que llevan más tiempo abiertas", "Open the longest")}</b><span className="grow" /><Link className="small" href={b.meta.listHref}>{t("Ver todas", "See all")}</Link></div>
              <ul className="bd-old">
                {b.oldest.map((r) => (
                  <li key={r.id}>
                    <Link href={r.href}><b>{r.code}</b> {r.who}</Link>
                    <span className="src">{r.what.slice(0, 70)}{b.team ? ` · ${r.owner}` : ""}</span>
                    <span className="bd-tags">
                      <span className="sig wait">{r.age} d</span>
                      {r.late && <span className="sig risk">{b.meta.late}</span>}
                      {r.quiet && <span className="sig attn">{b.meta.quiet}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      {x && <SalesAndCustomers x={x} i={i} />}
    </section>
  );
}
