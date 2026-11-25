import Link from "next/link";
import type { Batting } from "@/lib/batting";
import { DEV_ROWS, HEALTHY_COVER, OTHERS, POTENTIALS, QUALITY_ROWS, RATE_ROWS, type Coach, type Cover, type Finding, type Ratio } from "@/lib/batting-coach";
import { fmtStat, monthLabel } from "@/lib/customer-stats";
import "./bateo.css";

// The team's document of 2026-11-25 beyond the table: the scoreboard with SOLU's diagnosis, required pace and
// coverage (points 10, 7, 8, 6); the batting percentages, quality and consistency (2, 5, 12); goals per company (1);
// portfolio development (9). Server components; every figure compares the person with themselves.

type Fmt = { es: boolean; n: (v: unknown) => string; money: (v: unknown) => string };
export type Goal = { value: number; fromRecipe: boolean; fromCompanies?: boolean };
export type PaceLine = { k: string; es: string; en: string; unit: "usd" | "n"; remaining: number; perDay: number | null; days: number };

const tx = (i: Fmt) => (a: string, b: string) => (i.es ? a : b);
const ratioText = (i: Fmt, r: Ratio, money?: boolean) => (r.pct == null ? (i.es ? "— (sin casos)" : "— (no cases)") : `${r.pct} % (${money ? i.money(r.hit) : r.hit} ${i.es ? "de" : "of"} ${money ? i.money(r.of) : r.of})`);

// ---------- 10 · scoreboard, 7 · diagnosis, 8 · pace, 6 · coverage ----------

export function Marcador({ i, name, bat, coach, goals, cover, paces, findings, future, isCurrent }: {
  i: Fmt; name: string; bat: Batting; coach: Coach; goals: Partial<Record<string, Goal>>; cover: Cover | null; paces: PaceLine[]; findings: Finding[]; future: boolean; isCurrent: boolean;
}) {
  const t = tx(i);
  const L = bat.lines;
  const share = (k: keyof typeof L) => { const g = goals[k]?.value; return g && g > 0 ? `${Math.round((L[k].actual / g) * 100)} % ${t("de la meta", "of goal")}` : `${k.endsWith("USD") || k === "BAT_ESAGARA" ? i.money(L[k].actual) : i.n(L[k].actual)} · ${t("sin meta", "no goal")}`; };
  const qo = coach.rates.quoteOrder;
  const sq = bat.speed.BAT_SPD_QUOTE;
  const one = new Intl.NumberFormat(i.es ? "es-CO" : "en-US", { maximumFractionDigits: 1 });
  const coverText = !cover ? t("Sin meta de ventas", "No sales goal") : cover.times == null ? t("Meta cumplida", "Goal met") : `${one.format(cover.times)}X`;
  return (
    <section className="card bt" id="marcador">
      <div className="bt-head"><span className="rc-pill">{t("MI MARCADOR", "MY SCOREBOARD")} · {name.toUpperCase()}</span><span className="src">{t("Tú frente a ti: tu meta, tu promedio y tu mejor marca. No te compara con nadie.", "You against yourself: your goal, your average and your best mark. It compares you with nobody.")}</span></div>
      <div className="bt-score">
        <article data-s="resultado"><b>{t("RESULTADO", "RESULT")}</b>
          <span>{t("Ventas (valor OC)", "Sales (PO value)")}: <b>{future ? "—" : share("BAT_PO_USD")}</b></span>
          <span>{t("Eságara", "Eságara")}: <b>{future ? "—" : share("BAT_ESAGARA")}</b></span>
        </article>
        <article data-s="bateo"><b>{t("BATEO", "BATTING")}</b>
          <span>{t("Cotización → OC", "Quote → PO")}: <b>{qo.month.pct == null ? "—" : `${qo.month.pct} %`}</b></span>
          <span>{t("Promedio personal (12 meses)", "Personal average (12 months)")}: <b>{qo.year.pct == null ? "—" : `${qo.year.pct} %`}</b></span>
          <span>{t("Mejor histórico", "Best ever")}: <b>{coach.bestOrder ? `${coach.bestOrder.pct} %` : "—"}</b>{coach.bestOrder && <span className="src"> · {monthLabel(i.es, coach.bestOrder.month)}</span>}</span>
        </article>
        <article data-s="produccion"><b>{t("PRODUCCIÓN", "PRODUCTION")}</b>
          <span>{t("Solicitudes", "Requests")}: <b>{future ? "—" : share("BAT_REQ_N")}</b></span>
          <span>{t("Cotizaciones", "Quotes")}: <b>{future ? "—" : share("BAT_QUOTE_N")}</b></span>
        </article>
        <article data-s="velocidad"><b>{t("VELOCIDAD", "SPEED")}</b>
          <span>{t("Tiempo de cotización", "Time to quote")}: <b>{fmtStat(i, "days", future ? null : sq.actual)}</b></span>
          <span>{t("Promedio (12 meses)", "Average (12 months)")}: <b>{fmtStat(i, "days", sq.avg12)}</b></span>
        </article>
        <article data-s="cobertura"><b>{t("COBERTURA", "COVERAGE")}</b>
          <span>{t("Cotizaciones abiertas / faltante", "Open quotes / missing")}: <b>{isCurrent ? coverText : "—"}</b></span>
          <span className="src">{t(`Sana desde ${HEALTHY_COVER}X`, `Healthy from ${HEALTHY_COVER}X`)}</span>
        </article>
      </div>

      {isCurrent && (
        <div className="bt-diag" id="diagnostico">
          <b>{t("Diagnóstico SOLU", "SOLU diagnosis")}</b>
          <ul>{findings.map((f) => <li key={f.key} data-f={f.key}><span className={`sig ${f.tone}`}>{f.tone === "ok" ? t("Bien", "Good") : f.tone === "risk" ? t("Trabaja aquí", "Work here") : t("Atención", "Attention")}</span> {t(f.es, f.en)}</li>)}</ul>
          <span className="src">{t("Sale de reglas fijas sobre tus propias cifras, sin IA. «Cómo se cuenta el marcador», abajo, las explica.", "It comes from fixed rules on your own figures, with no AI. «How the scoreboard is counted», below, explains them.")}</span>
        </div>
      )}

      {isCurrent && (
        <div className="bt-two">
          <div className="bt-box" id="ritmo">
            <b>{t("Ritmo requerido", "Required pace")}</b>
            {paces.length === 0 ? <span className="small muted">{t("Aparece cuando hay meta de órdenes de compra o de Eságara.", "It shows once there is a purchase-order or Eságara goal.")}</span> : paces.map((p) => (
              <span key={p.k} data-p={p.k}>{p.remaining <= 0 ? t(`${p.es}: meta cumplida.`, `${p.en}: goal met.`) : p.perDay == null ? t(`${p.es}: faltan ${p.unit === "usd" ? i.money(p.remaining) : i.n(p.remaining)} y no quedan días hábiles.`, `${p.en}: ${p.unit === "usd" ? i.money(p.remaining) : i.n(p.remaining)} missing and no working days left.`) : (
                <>{t(`${p.es}: faltan`, `${p.en}: missing`)} <b>{p.unit === "usd" ? i.money(p.remaining) : i.n(p.remaining)}</b>. {t("Necesitas", "You need")} <b>{p.unit === "usd" ? i.money(p.perDay) : one.format(p.perDay)}</b> {t(`por día hábil (quedan ${p.days}).`, `per working day (${p.days} left).`)}</>
              )}</span>
            ))}
          </div>
          <div className="bt-box" id="cobertura">
            <b>{t("Cobertura de la meta", "Goal coverage")}</b>
            {!cover ? <span className="small muted">{t("Aparece cuando hay meta de ventas (valor de órdenes de compra).", "It shows once there is a sales goal (purchase-order value).")}</span> : (
              <>
                <span>{t("Meta de ventas", "Sales goal")}: <b>{i.money(cover.goal)}</b> · {t("ya vendido", "already sold")}: <b>{i.money(cover.sold)}</b> · {t("faltante", "missing")}: <b>{i.money(cover.missing)}</b></span>
                <span>{t("Cotizaciones presentadas sin decisión", "Quotes presented without a decision")}: <b>{i.money(cover.pipeline)}</b> ({cover.n})</span>
                <span>{t("Cobertura del faltante", "Coverage of what is missing")}: <b>{cover.times == null ? t("no falta nada", "nothing missing") : `${Math.round(cover.times * 100)} % (${one.format(cover.times)}X)`}</b></span>
              </>
            )}
          </div>
        </div>
      )}
      {!isCurrent && <p className="src">{t("El diagnóstico, el ritmo requerido y la cobertura se muestran solo en el mes en curso.", "The diagnosis, the required pace and the coverage show only for the current month.")}</p>}

      <details className="rc-how">
        <summary className="small">{t("Cómo se cuenta el marcador", "How the scoreboard is counted")}</summary>
        <ul className="mk-ul small">
          <li>{t("Resultado y producción: el mes actual frente a su meta, con las mismas cifras de la tabla de bateo.", "Result and production: the current month against its goal, with the same figures as the batting table.")}</li>
          <li>{t("Mejor histórico del bateo: tu mejor mes anterior con al menos 3 cotizaciones decididas.", "Best ever batting: your best earlier month with at least 3 decided quotes.")}</li>
          <li>{t("Cobertura: las cotizaciones presentadas que siguen sin decisión, en Necesidades abiertas, frente a lo que falta de la meta de ventas. SOLU no les pone probabilidad: cuentan todas.", "Coverage: the quotes presented that are still undecided, on open Needs, against what is missing of the sales goal. SOLU gives them no probability: all of them count.")}</li>
          <li>{t("Ritmo requerido: lo que falta dividido entre los días hábiles que quedan (lunes a viernes, sin festivos de Colombia).", "Required pace: what is missing divided by the working days left (Monday to Friday, skipping Colombian holidays).")}</li>
          <li>{t("Diagnóstico: cada cifra se compara con su meta (o con tu promedio de 12 meses si no hay meta), en proporción a los días hábiles que ya pasaron; «bajo» es menos del 85 %. Con solicitudes o cotizaciones al ritmo y pocas órdenes de compra, el problema es de bateo. Con 5 o más solicitudes en el mes y menos de la mitad cotizadas (y menos que en tus 12 meses), avisa que hay solicitudes sin cotizar. Con pocas solicitudes, de volumen. Con órdenes de compra al ritmo y margen 3 puntos por debajo de tus 12 meses (o Eságara baja), de calidad económica. Con ventas al ritmo y menos clientes comprando en 3 meses que en los 3 anteriores, de sostenibilidad.", "Diagnosis: each figure is compared with its goal (or your 12-month average when there is no goal), in proportion to the working days already gone; «low» is under 85 %. With requests or quotes on pace and few purchase orders, the problem is batting. With 5 or more requests in the month and under half of them quoted (and under your 12 months), it warns there are requests not yet quoted. With few requests, volume. With purchase orders on pace and a margin 3 points under your 12 months (or low Eságara), economic quality. With sales on pace and fewer customers buying in 3 months than in the 3 before, sustainability.")}</li>
        </ul>
      </details>
    </section>
  );
}

// ---------- 2 · batting percentages, 5 · quality, 12 · consistency (inside the batting table block) ----------

export function BateoMas({ i, coach, future }: { i: Fmt; coach: Coach; future: boolean }) {
  const t = tx(i);
  const H = { now: t("Este mes", "This month"), year: t("12 meses", "12 months") };
  const qv = (unit: "usd" | "pct", v: number | null) => (v == null ? "—" : unit === "usd" ? i.money(v) : `${v.toLocaleString(i.es ? "es-CO" : "en-US", { maximumFractionDigits: 1 })} %`);
  const arrow = { up: "↑", flat: "→", down: "↓" } as const;
  const months = (n: number) => t(`${n} ${n === 1 ? "mes" : "meses"}`, `${n} ${n === 1 ? "month" : "months"}`);
  return (
    <>
      <div className="bt-scroll" id="porcentajes">
        <table className="bt-table bt-speed">
          <thead><tr><th>{t("Tu bateo", "Your batting")}</th><th>{H.now}</th><th>{H.year}</th></tr></thead>
          <tbody>
            {RATE_ROWS.map((r) => (
              <tr key={r.k} data-k={r.k}>
                <th scope="row">{t(r.label.es, r.label.en)}<span className="src block bt-how">{t(r.how.es, r.how.en)}</span></th>
                <td data-l={H.now}>{future ? "—" : ratioText(i, coach.rates[r.k].month, r.money)}</td>
                <td data-l={H.year}>{ratioText(i, coach.rates[r.k].year, r.money)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="src">{t("Se mide por grupo de origen, no mes contra mes: cada porcentaje toma lo que nació en el periodo y mira en qué terminó. Lo que sigue sin decisión no entra todavía. «12 meses» incluye este mes.", "Measured by origin group, not month against month: each percentage takes what was born in the period and looks at how it ended. What is still undecided is not in yet. «12 months» includes this month.")}</p>

      <div className="bt-scroll" id="calidad">
        <table className="bt-table bt-speed">
          <thead><tr><th>{t("Calidad del bateo", "Batting quality")}</th><th>{H.now}</th><th>{t("12 meses anteriores", "12 months before")}</th></tr></thead>
          <tbody>
            {QUALITY_ROWS.map((r) => (
              <tr key={r.k} data-k={r.k}>
                <th scope="row">{t(r.label.es, r.label.en)}<span className="src block bt-how">{t(r.how.es, r.how.en)}</span></th>
                <td data-l={H.now}>{future ? "—" : qv(r.unit, coach.quality[r.k].month)}</td>
                <td data-l={t("12 meses anteriores", "12 months before")}>{qv(r.unit, coach.quality[r.k].year)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bt-scroll" id="consistencia">
        <table className="bt-table bt-speed">
          <thead><tr><th>{t("Consistencia", "Consistency")}</th>{coach.trend[0].points.map((p) => <th key={p.month}>{monthLabel(i.es, p.month)}</th>)}<th>{t("Meses seguidos sobre tu promedio", "Months in a row above your average")}</th><th>{t("Meses seguidos cumpliendo la meta", "Months in a row meeting the goal")}</th></tr></thead>
          <tbody>
            {coach.trend.map((r) => {
              const above = r.k === "batting" ? null : coach.streak.aboveAvg[r.k];
              const goal = r.k === "batting" ? null : coach.streak.goal[r.k];
              return (
                <tr key={r.k} data-k={r.k}>
                  <th scope="row">{t(r.label.es, r.label.en)}</th>
                  {r.points.map((p) => <td key={p.month} data-l={monthLabel(i.es, p.month)}>{p.value == null ? "—" : <>{r.unit === "usd" ? i.money(p.value) : `${p.value} %`}{p.arrow && <span className={`bt-arrow ${p.arrow}`} title={p.arrow === "up" ? t("Subió frente al mes anterior", "Up on the month before") : p.arrow === "down" ? t("Bajó frente al mes anterior", "Down on the month before") : t("Igual al mes anterior", "Level with the month before")}> {arrow[p.arrow]}</span>}</>}</td>)}
                  <td data-l={t("Meses seguidos sobre tu promedio", "Months in a row above your average")}>{above == null ? "—" : months(above)}</td>
                  <td data-l={t("Meses seguidos cumpliendo la meta", "Months in a row meeting the goal")}>{goal == null ? <span className="muted">{t("Sin metas anteriores", "No earlier goals")}</span> : months(goal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="src">{t("Los tres últimos meses completos; la flecha compara cada mes con el anterior (↑ más de 5 % arriba, ↓ más de 5 % abajo). «Sobre tu promedio» compara cada mes con el promedio de los 12 anteriores a él. Un buen mes puede ser suerte; una tendencia sostenida empieza a parecer método.", "The last three complete months; the arrow compares each month with the one before (↑ more than 5 % up, ↓ more than 5 % down). «Above your average» compares each month with the average of the 12 before it. One good month can be luck; a sustained trend starts to look like method.")}</p>
    </>
  );
}

// ---------- 1 · goals per company ----------

export function MetasEmpresa({ i, name, coach, typedGoal, future, closed, canEdit, action, statsBase }: {
  i: Fmt; name: string; coach: Coach; typedGoal: number | null; future: boolean; closed: boolean; canEdit: boolean; action: (fd: FormData) => void | Promise<void>; statsBase: string;
}) {
  const t = tx(i);
  const c = coach.companies;
  if (!c) return null;
  const edit = canEdit && !closed;
  const done = (actual: number, goal: number | null) => (goal && goal > 0 && !future ? `${Math.round((actual / goal) * 100)} %` : "—");
  const H = { avg: t("Promedio mensual de venta (12 meses)", "Average monthly sale (12 months)"), pot: t("Potencial", "Potential"), goal: t("Meta del mes (USD)", "Month goal (USD)"), now: t("Mes actual", "This month"), done: t("Cumplimiento", "Achievement") };
  const totalAvg = c.rows.filter((r) => r.goal != null).reduce((s, r) => s + r.avg12, 0) + c.others.avg12;
  const totalNow = c.rows.filter((r) => r.goal != null).reduce((s, r) => s + r.actual, 0) + c.others.actual;
  const body = (
    <div className="bt-scroll">
      <table className="bt-table bt-co">
        <thead><tr><th>{t("Empresa", "Company")}</th><th>{H.avg}</th><th>{H.pot}</th><th>{H.goal}</th><th>{H.now}</th><th>{H.done}</th></tr></thead>
        <tbody>
          {c.rows.map((r) => (
            <tr key={r.id} data-a={r.id}>
              <th scope="row"><Link href={`${statsBase}&c=${r.id}#bateo`}>{r.name}</Link></th>
              <td data-l={H.avg}>{i.money(r.avg12)}</td>
              <td data-l={H.pot}>{edit ? (
                <select name={`pot_${r.id}`} defaultValue={r.potential ?? ""} aria-label={`${H.pot} · ${r.name}`}><option value="">—</option>{[3, 2, 1].map((p) => <option key={p} value={p}>{t(POTENTIALS[p].es, POTENTIALS[p].en)}</option>)}</select>
              ) : r.potential && POTENTIALS[r.potential] ? t(POTENTIALS[r.potential].es, POTENTIALS[r.potential].en) : "—"}</td>
              <td data-l={H.goal}>{edit ? <input name={`acc_${r.id}`} type="number" min={0} step="0.01" defaultValue={r.goal ?? ""} placeholder={r.lastGoal != null ? String(r.lastGoal) : undefined} aria-label={`${H.goal} · ${r.name}`} /> : r.goal != null ? i.money(r.goal) : <span className="muted">{t("Sin meta", "No goal")}</span>}</td>
              <td data-l={H.now}>{future ? "—" : i.money(r.actual)}</td>
              <td data-l={H.done}>{done(r.actual, r.goal)}</td>
            </tr>
          ))}
          <tr data-a={OTHERS}>
            <th scope="row">{t("Otros", "Others")}<span className="src block bt-how">{t("Todo lo que no tiene meta propia arriba.", "Everything without its own goal above.")}</span></th>
            <td data-l={H.avg}>{i.money(c.others.avg12)}</td>
            <td data-l={H.pot}>—</td>
            <td data-l={H.goal}>{edit ? <input name={`acc_${OTHERS}`} type="number" min={0} step="0.01" defaultValue={c.others.goal ?? ""} placeholder={c.others.lastGoal != null ? String(c.others.lastGoal) : undefined} aria-label={`${H.goal} · ${t("Otros", "Others")}`} /> : c.others.goal != null ? i.money(c.others.goal) : <span className="muted">{t("Sin meta", "No goal")}</span>}</td>
            <td data-l={H.now}>{future ? "—" : i.money(c.others.actual)}</td>
            <td data-l={H.done}>{done(c.others.actual, c.others.goal)}</td>
          </tr>
          <tr className="bt-total" data-a="TOTAL">
            <th scope="row">{t(`Total ${name}`, `Total ${name}`)}</th>
            <td data-l={H.avg}>{i.money(totalAvg)}</td>
            <td data-l={H.pot} />
            <td data-l={H.goal}><b>{c.total != null ? i.money(c.total) : t("Sin metas por empresa", "No goals per company")}</b></td>
            <td data-l={H.now}>{future ? "—" : i.money(totalNow)}</td>
            <td data-l={H.done}>{done(totalNow, c.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <section className="card bt" id="empresas">
      <div className="bt-head"><span className="rc-pill">{t("METAS POR EMPRESA", "GOALS PER COMPANY")} · {name.toUpperCase()}</span><span className="src">{t("Meta de cada cliente → suma la meta del negociador → suma la meta del equipo.", "Each customer's goal → adds up to the negotiator's goal → adds up to the team's goal.")}</span></div>
      {edit ? (
        <form action={action} className="bt-coform">
          {body}
          <button type="submit">{t("Guardar metas por empresa", "Save goals per company")}</button>
          <span className="src block">{t("La meta es de ventas del mes (valor de órdenes de compra, USD). No salga solo del promedio: piensa en histórico, potencial, tendencia y estrategia. Vacío o cero = sin meta; en gris, la meta del mes pasado. Cada mes tiene sus metas.", "The goal is the month's sales (purchase-order value, USD). Don't take it from the average alone: think history, potential, trend and strategy. Empty or zero = no goal; in grey, last month's goal. Each month has its own goals.")}</span>
        </form>
      ) : body}
      {c.total != null && <p className="src" data-sum>{typedGoal != null ? t(`La suma de tus metas por empresa es ${i.money(c.total)}. En la tabla de bateo escribiste ${i.money(typedGoal)} como «$ Meta Órdenes de Compra Mes»: esa es la que cuenta. Deja esa casilla vacía para que SOLU use la suma.`, `Your goals per company add up to ${i.money(c.total)}. In the batting table you typed ${i.money(typedGoal)} as «$ Purchase orders goal for the month»: that one counts. Leave that box empty for SOLU to use the sum.`) : t(`La suma, ${i.money(c.total)}, es tu meta de «$ Órdenes de compra» en la tabla de bateo, el marcador y la cobertura.`, `The sum, ${i.money(c.total)}, is your «$ Purchase orders» goal in the batting table, the scoreboard and the coverage.`)}</p>}
      {c.hidden > 0 && <p className="src">{t(`Hay ${c.hidden} empresas más sin movimiento reciente: entran en «Otros».`, `There are ${c.hidden} more companies with no recent movement: they are in «Others».`)}</p>}
      <p className="src">{t("Aparecen las empresas con Necesidades tuyas en los últimos 12 meses, con órdenes de compra o con meta. El nombre abre la tabla de bateo solo de esa empresa. La suma de todo el equipo está en EQUIPO → Mi equipo → Organizar metas del equipo.", "The companies with Needs of yours in the last 12 months, with purchase orders or with a goal are shown. The name opens the batting table for that company only. The whole team's sum is in EQUIPO → Mi equipo → Organizar metas del equipo.")}</p>
    </section>
  );
}

// ---------- 9 · portfolio development ----------

export function Desarrollo({ i, name, coach, goals, future, closed, canEdit, action }: {
  i: Fmt; name: string; coach: Coach; goals: Partial<Record<string, Goal>>; future: boolean; closed: boolean; canEdit: boolean; action: (fd: FormData) => void | Promise<void>;
}) {
  const t = tx(i);
  if (!coach.dev) return null;
  const H = { goal: t("Meta del mes", "Month goal"), now: t("Mes actual", "This month"), done: t("Cumplimiento", "Achievement") };
  return (
    <section className="card bt" id="desarrollo">
      <div className="bt-head"><span className="rc-pill">{t("DESARROLLO DE CARTERA", "PORTFOLIO DEVELOPMENT")} · {name.toUpperCase()}</span><span className="src">{t("Parte del trabajo comercial es conseguir que existan más razones para que nos envíen solicitudes.", "Part of the commercial job is making sure there are more reasons for them to send us requests.")}</span></div>
      <div className="bt-scroll">
        <table className="bt-table bt-speed">
          <thead><tr><th>{t("Desarrollo", "Development")}</th><th>{H.goal}</th><th>{H.now}</th><th>{H.done}</th></tr></thead>
          <tbody>
            {DEV_ROWS.map((r) => {
              const g = goals[r.k]?.value ?? null, v = coach.dev![r.k];
              return (
                <tr key={r.k} data-k={r.k}>
                  <th scope="row">{t(r.label.es, r.label.en)}<span className="src block bt-how">{t(r.how.es, r.how.en)}</span></th>
                  <td data-l={H.goal}>{g != null ? i.n(g) : <span className="muted">{t("Sin meta", "No goal")}</span>}</td>
                  <td className="bt-now" data-l={H.now}><b>{future ? "—" : i.n(v)}</b></td>
                  <td data-l={H.done}>{g && !future ? `${Math.round((v / g) * 100)} %` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && !closed && (
        <form action={action} className="qa-form cols rc-form">
          <input type="hidden" name="grp" value="desarrollo" />
          {DEV_ROWS.map((r) => (
            <label key={r.k}>{t(r.goal.es, r.goal.en)}
              <input name={r.k} type="number" min={0} step="1" defaultValue={goals[r.k]?.value ?? ""} />
            </label>
          ))}
          <button type="submit">{t("Guardar metas de desarrollo", "Save development goals")}</button>
          <span className="src block wide">{t("Vacío o cero = sin meta. Solo cuenta lo que se registra en SOLU.", "Empty or zero = no goal. Only what is recorded in SOLU counts.")}</span>
        </form>
      )}
    </section>
  );
}
