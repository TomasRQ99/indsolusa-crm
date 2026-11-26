import Link from "next/link";
import { BAT_GOAL_FIELDS, BAT_GROUPS, BAT_ROWS, SPEED_ROWS, type Batting } from "@/lib/batting";
import { fmtStat, monthLabel, shortStat } from "@/lib/customer-stats";
import type { Coach } from "@/lib/batting-coach";
import { BateoMas } from "./Coach";
import "./bateo.css";

// Tabla de bateo (owner, 2026-11-25): requests, quotes and purchase orders of the month against the goal and against
// the person's own past, with the same figures for one company when they search it. Server component.

type Fmt = { es: boolean; n: (v: unknown) => string; money: (v: unknown) => string };
export type BatTarget = { value: number; fromRecipe: boolean; fromCompanies?: boolean; /** From the approved commercial budget: what it says, for the note under the figure. */ fromBudget?: string };

/** Thirteen months of one figure: bars from zero, the chosen month darker, the goal as a dashed line. */
function Spark({ months, goal, title, short, es }: { months: { key: string; value: number }[]; goal: number | null; title: string; short: (v: number) => string; es: boolean }) {
  const W = 234, H = 54, T = 12, B = 11, col = W / months.length, bw = col - 5;
  const max = Math.max(...months.map((m) => m.value), goal ?? 0);
  const y = (v: number) => T + (1 - v / (max || 1)) * (H - T - B);
  const last = months.length - 1;
  const best = Math.max(...months.map((m) => m.value));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bt-chart" role="img" aria-label={title}>
      <line x1={0} x2={W} y1={H - B} y2={H - B} className="bt-base" />
      {months.map((m, k) => {
        const cx = k * col + col / 2;
        const h = max > 0 && m.value > 0 ? Math.max(2, H - B - y(m.value)) : 0;
        // The figure is written on the chosen month and on the best earlier one when it stands far enough not to collide.
        const labelled = m.value > 0 && (k === last || (m.value === best && k < last - 2 && months.findIndex((x) => x.value === best) === k));
        const tx = k === last ? W : Math.max(12, cx);
        return (
          <g key={m.key}>
            {h > 0 && <rect x={cx - bw / 2} y={H - B - h} width={bw} height={h} rx={2} className={`bt-bar${k === last ? " now" : ""}`} />}
            {labelled && <text x={tx} y={H - B - h - 2} textAnchor={k === last ? "end" : "middle"} className="bt-v">{short(m.value)}</text>}
            {(k === 0 || k === 6 || k === last) && <text x={k === 0 ? 0 : k === last ? W : cx} y={H - 2} textAnchor={k === 0 ? "start" : k === last ? "end" : "middle"} className="bt-ax">{monthLabel(es, m.key, k !== last)}</text>}
            <title>{`${monthLabel(es, m.key)}: ${short(m.value)}`}</title>
          </g>
        );
      })}
      {goal != null && max > 0 && <line x1={0} x2={W} y1={y(goal)} y2={y(goal)} className="bt-goal" />}
    </svg>
  );
}

export default function Bateo({ i, name, bat, coach, days, targets, company, matches, q, future, closed, canEdit, action, baseHref, hidden, statsHref }: {
  i: Fmt; name: string; bat: Batting; coach: Coach;
  /** Working days of the month: gone, in all, and from which one a projection is shown. */
  days: { elapsed: number; total: number; min: number }; targets: Partial<Record<string, BatTarget>>; company: { id: string; name: string } | null;
  matches: { id: string; name: string }[] | null; q: string; future: boolean; closed: boolean; canEdit: boolean;
  action: (fd: FormData) => void | Promise<void>; baseHref: string; hidden: Record<string, string>; statsHref: string | null;
}) {
  const t = (a: string, b: string) => (i.es ? a : b);
  const show = (unit: "n" | "usd", v: number | null) => (v == null ? "—" : unit === "usd" ? i.money(v) : i.n(v));
  // An average of counts keeps one decimal (1,3 requests a month), a count of the month is a whole number.
  const one = new Intl.NumberFormat(i.es ? "es-CO" : "en-US", { maximumFractionDigits: 1 });
  const avg = (unit: "n" | "usd", v: number | null) => (v == null ? "—" : unit === "usd" ? i.money(v) : one.format(v));
  const H = { goal: t("Meta del mes", "Month goal"), now: t("Mes actual", "This month"), prev: t("Mes anterior", "Previous month"), a3: t("Promedio 3 meses", "3-month average"), a6: t("Promedio 6 meses", "6-month average"), a12: t("Promedio 12 meses", "12-month average"), best: t("Mi mejor marca", "My best mark"), vary: t("Variación", "Change"), done: t("Cumplimiento", "Achievement"), plot: t("Últimos 12 meses y este", "Last 12 months and this one") };
  // "27 % (4 de 15)": the percentage with its hits and at-bats, so nobody reads much into two cases.
  const rate = (k: "quoteMonth" | "orderMonth" | "quoteYear" | "orderYear") => (bat.rates[k] == null ? t("— (sin casos)", "— (no cases)") : `${bat.rates[k]} % (${bat.rates.n[k][0]} ${t("de", "of")} ${bat.rates.n[k][1]})`);
  const groups = Object.keys(BAT_GROUPS) as (keyof typeof BAT_GROUPS)[];
  const cols = company ? 9 : 11;
  // Projection "if the current pace holds": only while the month is running and after the first working days.
  const running = !future && !closed && days.elapsed < days.total;
  const project = (v: number) => (running ? (days.elapsed >= days.min ? (v / days.elapsed) * days.total : null) : v);

  return (
    <section className="card bt" id="bateo">
      <div className="bt-head">
        <span className="rc-pill">{t("TABLA DE BATEO", "BATTING TABLE")} · {name.toUpperCase()}</span>
        {company && <span className="sig attn">{t(`Solo ${company.name}`, `Only ${company.name}`)}</span>}
        <span className="grow" />
        <form method="get" action="/comercial/metas#bateo" className="bt-find" role="search">
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <label>{t("Buscar empresa", "Search company")}
            <input name="q" type="search" defaultValue={company ? company.name : q} placeholder={t("Nombre de la empresa", "Company name")} maxLength={80} />
          </label>
          <button type="submit" className="secondary">{t("Buscar", "Search")}</button>
          {(company || q) && <Link className="qa-btn" href={`${baseHref}#bateo`}>{t("Ver todas las empresas", "See all companies")}</Link>}
        </form>
      </div>

      {matches && matches.length === 0 && <p className="note risk">{t(`No hay ninguna empresa con «${q}» en el nombre. Revisa cómo está escrito.`, `No company has «${q}» in its name. Check the spelling.`)}</p>}
      {matches && matches.length > 1 && (
        <p className="bt-pick">{t(`Varias empresas tienen «${q}» en el nombre. Elige una:`, `Several companies have «${q}» in their name. Choose one:`)}{" "}
          {matches.slice(0, 8).map((m) => <Link key={m.id} className="cs-chip" href={`${baseHref}&c=${m.id}#bateo`}>{m.name}</Link>)}
          {matches.length > 8 && <span className="src"> {t("Hay más: escribe más letras del nombre.", "There are more: type more of the name.")}</span>}
        </p>
      )}

      <div className="bt-scroll">
        <table className="bt-table">
          <thead>
            <tr>
              <th />
              {!company && <th>{H.goal}</th>}
              <th>{H.prev}</th>
              <th>{H.a3}</th>
              <th>{H.a6}</th>
              <th>{H.a12}</th>
              <th>{H.best}</th>
              <th>{H.now}</th>
              <th>{H.vary}</th>
              {!company && <th>{H.done}</th>}
              <th>{H.plot}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g} className="bt-g"><td colSpan={cols}>{t(BAT_GROUPS[g].es, BAT_GROUPS[g].en)}</td></tr>,
              ...BAT_ROWS.filter((r) => r.group === g).map((r) => {
                const l = bat.lines[r.k];
                const tg = company ? null : targets[r.k] ?? null;
                const share = tg && tg.value > 0 ? Math.round((l.actual / tg.value) * 100) : null;
                const short = (v: number) => shortStat(i, r.unit, v);
                // Variación: the month (its projection while it runs) against the person's own 12-month average.
                const proj = future ? null : project(l.actual);
                const vary = proj != null && l.avg12 != null && l.avg12 > 0 ? Math.round((proj / l.avg12 - 1) * 100) : null;
                return (
                  <tr key={r.k} data-k={r.k}>
                    <th scope="row">{t(r.label.es, r.label.en)}</th>
                    {!company && <td data-l={H.goal}>{tg ? <>{show(r.unit, tg.value)}{tg.fromRecipe && <span className="src block">{t("de tu recetario", "from your recipe")}</span>}{tg.fromCompanies && <span className="src block">{t("suma de tus metas por empresa", "sum of your goals per company")}</span>}{tg.fromBudget && <span className="src block" data-from="budget">{tg.fromBudget}</span>}</> : <span className="muted">{t("Sin meta", "No goal")}</span>}</td>}
                    <td data-l={H.prev}>{show(r.unit, l.prev)}</td>
                    <td data-l={H.a3}>{avg(r.unit, l.avg3)}</td>
                    <td data-l={H.a6}>{avg(r.unit, l.avg6)}</td>
                    <td data-l={H.a12}>{avg(r.unit, l.avg12)}</td>
                    <td className="bt-best" data-l={H.best}>{l.best ? <>{show(r.unit, l.best.value)}<span className="src block">{monthLabel(i.es, l.best.month)}</span></> : "—"}</td>
                    <td className="bt-now" data-l={H.now}><b>{future ? "—" : show(r.unit, l.actual)}</b>
                      {!future && l.actual > 0 && l.best && l.actual > l.best.value && <span className="sig ok">{t("Nueva mejor marca", "New best mark")}</span>}
                      {running && proj != null && <span className="src block" data-proj>{t("Proyección", "Projection")}: ≈ {r.unit === "usd" ? i.money(Math.round(proj)) : one.format(proj)}</span>}
                    </td>
                    <td className="bt-vary" data-l={H.vary}>{vary == null ? "—" : <span className={vary > 0 ? "bt-arrow up" : vary < 0 ? "bt-arrow down" : "bt-arrow flat"}>{vary > 999 ? t("↑ más de 999 %", "↑ over 999 %") : <>{vary > 0 ? "↑ +" : vary < 0 ? "↓ " : "→ "}{vary} %</>}</span>}</td>
                    {!company && <td className="bt-done" data-l={H.done}>{share != null && !future ? (
                      <><b>{share} %</b><span className="bt-meter" role="img" aria-label={t(`${share} % de la meta`, `${share} % of the goal`)}><span style={{ width: `${Math.min(100, share)}%` }} /></span></>
                    ) : "—"}</td>}
                    <td className="bt-plot" data-l={H.plot}><Spark months={l.months} goal={tg?.value ?? null} es={i.es} short={short} title={t(`${r.label.es}: últimos 12 meses y este`, `${r.label.en}: last 12 months and this one`)} /></td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>

      <p className="bt-legend src"><span className="bt-key now" /> {t("Mes actual", "This month")} <span className="bt-key" /> {t("Meses anteriores", "Earlier months")}{!company && <> <span className="bt-key goal" /> {t("Meta del mes", "Month goal")}</>}</p>

      <BateoMas i={i} coach={coach} future={future} />

      <div className="bt-scroll" id="velocidad">
        <table className="bt-table bt-speed">
          <thead><tr><th>{t("Tu velocidad", "Your speed")}</th>{!company && <th>{H.goal}</th>}<th>{H.now}</th><th>{H.a12}</th></tr></thead>
          <tbody>
            {SPEED_ROWS.map((r) => {
              const l = bat.speed[r.k];
              const tg = company ? null : targets[r.k] ?? null;
              const tone = tg && l.actual != null && !future ? (l.actual <= tg.value ? "ok" : "risk") : null;
              const cases = (n: number) => (n ? <span className="src block">{t(`${n} ${n === 1 ? "caso" : "casos"}`, `${n} ${n === 1 ? "case" : "cases"}`)}</span> : null);
              return (
                <tr key={r.k} data-k={r.k}>
                  <th scope="row">{t(r.label.es, r.label.en)}</th>
                  {!company && <td data-l={H.goal}>{tg ? `< ${fmtStat(i, r.unit, tg.value)}` : <span className="muted">{t("Sin meta", "No goal")}</span>}</td>}
                  <td className="bt-now" data-l={H.now}><b>{future ? "—" : fmtStat(i, r.unit, l.actual)}</b>{tone && <span className={`sig ${tone}`}>{tone === "ok" ? t("Dentro de la meta", "Within the goal") : t("Por encima de la meta", "Above the goal")}</span>}{!future && cases(l.n)}</td>
                  <td data-l={H.a12}>{fmtStat(i, r.unit, l.avg12)}{cases(l.n12)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {bat.history < 12 && <p className="src">{bat.history === 0 ? t("Todavía no hay meses anteriores con registros: los promedios aparecen desde el segundo mes.", "There are no earlier months with records yet: the averages show from the second month.") : t(`SOLU tiene ${bat.history} ${bat.history === 1 ? "mes anterior" : "meses anteriores"} con registros: los promedios se calculan con esos meses.`, `SOLU has ${bat.history} earlier ${bat.history === 1 ? "month" : "months"} with records: the averages use those months.`)}</p>}
      {company && statsHref && <p className="src">{t("Aquí ves solo tus Necesidades con esta empresa. Todo lo de la empresa, de todo el equipo, está en", "Here you see only your Needs with this company. Everything about the company, across the team, is in")} <Link href={statsHref}>{t("Estadísticas de la empresa", "Company statistics")} →</Link></p>}

      <details className="rc-how">
        <summary className="small">{t("Cómo se cuenta la tabla de bateo", "How the batting table is counted")}</summary>
        <ul className="mk-ul small">
          {BAT_ROWS.map((r) => <li key={r.k}>{t(r.how.es, r.how.en)}</li>)}
          {SPEED_ROWS.map((r) => <li key={r.k}>{t(r.how.es, r.how.en)}</li>)}
          <li>{t("Tu velocidad: cada tiempo es el promedio de los casos que terminaron ese paso en el mes; «Promedio 12 meses» es el de los casos de los 12 meses anteriores. Menos es mejor.", "Your speed: each time is the average of the cases that finished that step in the month; «12-month average» is that of the cases of the 12 months before. Less is better.")}</li>
          <li>{t(`Proyección: lo que llevas dividido entre los días hábiles que ya pasaron, por los días hábiles del mes («si sigue el ritmo actual»). Aparece desde el día hábil ${days.min} y solo en el mes en curso.`, `Projection: what you have so far divided by the working days already gone, times the month's working days («if the current pace holds»). It shows from working day ${days.min} and only for the current month.`)}</li>
          <li>{t("Variación: la proyección del mes (o el mes completo, si ya cerró) frente a tu promedio de 12 meses.", "Change: the month's projection (or the whole month, once closed) against your 12-month average.")}</li>
          <li>{t("Mi mejor marca: tu mejor mes completo antes del que estás viendo, en toda tu historia en SOLU.", "My best mark: your best complete month before the one you are viewing, in all your history in SOLU.")}</li>
          <li>{t("Mes anterior y promedios: los meses completos antes del mes que estás viendo. El mes actual va hasta hoy.", "Previous month and averages: the complete months before the month you are viewing. The current month runs up to today.")}</li>
        </ul>
      </details>

      {!company && canEdit && !closed && (
        <form action={action} className="qa-form cols rc-form">
          <input type="hidden" name="grp" value="tabla" />
          {BAT_GOAL_FIELDS.filter((r) => r.grp === "tabla").map((r) => (
            <label key={r.k}>{t(r.goal.es, r.goal.en)}
              <input name={r.k} type="number" min={0} step={r.unit === "n" ? "1" : r.unit === "usd" ? "0.01" : "0.1"} defaultValue={targets[r.k] && !targets[r.k]!.fromRecipe && !targets[r.k]!.fromBudget ? targets[r.k]!.value : ""} placeholder={targets[r.k]?.fromRecipe || targets[r.k]?.fromBudget ? String(targets[r.k]!.value) : undefined} />
            </label>
          ))}
          <button type="submit">{t("Guardar metas de la tabla", "Save table goals")}</button>
          <span className="src block wide">{t("Vacío o cero = sin meta. Si tienes un presupuesto comercial aprobado para este mes y dejas vacías las metas de solicitudes, cotizaciones y órdenes de compra, SOLU usa las de ese presupuesto (el valor, pasado a dólares con la TRM de hoy). Si no, y dejas vacía la de «$ Órdenes de compra», SOLU usa la suma de tus metas por empresa; si no hay, y para cotizaciones y número de órdenes, las de tu recetario del mes. La meta de Eságara es la «Eságara ganada» que fijan Gerencia o la Dirección Comercial. En las de tiempo, la meta es el máximo: menos es mejor.", "Empty or zero = no goal. If you have an approved commercial budget for this month and leave the goals for requests, quotes and purchase orders empty, SOLU uses that budget's (the value, turned into dollars at today's TRM). Otherwise, if you leave the «$ Purchase orders» one empty, SOLU uses the sum of your goals per company; if there is none, and for quotes and number of orders, those of your recipe for the month. The Eságara goal is the «Eságara won» set by Management or the Commercial Director. For the times, the goal is the maximum: less is better.")}</span>
        </form>
      )}
    </section>
  );
}
