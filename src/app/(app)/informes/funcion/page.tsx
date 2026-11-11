import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { GOAL_METRICS, METRIC_KEYS, periodOf, shiftPeriod, validPeriod } from "@/lib/goal-rules";
import { periodStatus } from "@/lib/metric-dictionary";
import { commercialFunction, insightsFor } from "@/lib/report-insights";
import { HowCalc } from "@/components/HowCalc";

// Módulo 13 §4.4, §13–14 · Functional review for Dirección: how the Commercial function did in the month, why Eságara
// is where it is against its goal, what SOLU noticed (facts with evidence), and the people behind the figures.

export default async function FunctionReviewPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canManageAll(user) && !canFinance(user)) return <div className="note risk">{t("La revisión de función es para Gerencia, Dirección, Finanzas y Administración.", "The functional review is for Management, Direction, Finance and Administration.")}</div>;
  const sp = await searchParams;
  const now = new Date();
  const period = sp.mes && validPeriod(sp.mes) ? sp.mes : periodOf(now);
  const [f, insights] = await Promise.all([commercialFunction(period), insightsFor(period)]);
  const status = periodStatus(period, now);
  const val = (k: (typeof METRIC_KEYS)[number], n: number) => (GOAL_METRICS[k].unit === "usd" ? `USD ${i.n2(n)}` : String(Math.round(n)));
  const usd = (n: number) => `USD ${i.n2(n)}`;
  const g = f.gap;

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Revisión de la función Comercial", "Commercial function review")}</h1>
        <p>{t("Cómo le fue a Comercial en el mes, por qué la Eságara está donde está frente a su meta, lo que SOLU encontró en los datos y las personas detrás de las cifras.", "How Commercial did in the month, why Eságara is where it is against its goal, what SOLU found in the data and the people behind the figures.")}</p>
        <p className="small"><span className="mono">{period}</span> · <span className={`sig ${status === "CLOSED" ? "ok" : "wait"}`}>{status === "CLOSED" ? t("Mes cerrado", "Month closed") : t("Provisional: el mes sigue abierto", "Provisional: the month is still open")}</span> · {t("calculado", "as of")} {i.day(now)} · <Link href={`/informes/funcion?mes=${shiftPeriod(period, -1)}`}>← {shiftPeriod(period, -1)}</Link>{period < periodOf(now) && <> · <Link href={`/informes/funcion?mes=${shiftPeriod(period, 1)}`}>{shiftPeriod(period, 1)} →</Link></>}</p>
      </div></div>

      <section className="card" id="hallazgos">
        <b>{t("LO QUE SOLU ENCONTRÓ", "WHAT SOLU FOUND")} · {insights.length}</b>
        {insights.length === 0 ? <p className="small muted">{t("Nada que señalar este mes.", "Nothing to point out this month.")}</p> : insights.map((x) => (
          <article key={x.key} className="exc-item">
            <header className="exc-head"><span className={`sig ${x.kind === "FACT" ? "ok" : "wait"}`}>{x.kind === "FACT" ? t("Hecho", "Fact") : t("Hecho e inferencia", "Fact and inference")}</span> <b>{t(x.headline.es, x.headline.en)}</b></header>
            <p className="small">{t(x.detail.es, x.detail.en)} <Link href={x.href}>{t("Ver la evidencia", "See the evidence")}</Link></p>
          </article>
        ))}
        <p className="src">{t("Cada hallazgo se cuenta de registros de SOLU. Nada de esto se envía a nadie: es para decidir.", "Each finding is counted from SOLU records. None of this is sent to anyone: it is for deciding.")}</p>
      </section>

      <section className="card" id="funcion">
        <b>{t("LA FUNCIÓN EN EL MES", "THE FUNCTION IN THE MONTH")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Qué", "What")}</th><th className="n">{t("Este mes", "This month")}</th><th className="n">{t("Meta (suma de las personas)", "Goal (sum of people's)")}</th><th className="n">{t("Mes anterior", "Previous month")}</th></tr></thead>
          <tbody>{METRIC_KEYS.map((k) => (
            <tr key={k}><td><b>{t(GOAL_METRICS[k].es, GOAL_METRICS[k].en)}</b><span className="block"><HowCalc id={k} es={i.es} /></span></td>
              <td className="n mono"><b>{val(k, f.total[k])}</b>{k === "ESAGARA_AMOUNT" && f.esagaraPct != null && <span className="src block">{i.pct(f.esagaraPct)} {t("de", "of")} {usd(f.sale)}</span>}</td>
              <td className="n mono">{f.goal[k] != null ? <>{val(k, f.goal[k]!)}<span className="src block">{i.pct((f.total[k] / f.goal[k]!) * 100)}</span></> : <span className="muted">{t("sin metas", "no goals")}</span>}</td>
              <td className="n mono">{val(k, f.prev[k])}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="card" id="causa">
        <b>{t("POR QUÉ LA ESÁGARA ESTÁ BAJO LA META", "WHY ESÁGARA IS BELOW GOAL")}</b>
        {!g ? <p className="small muted">{t("No hay meta de Eságara para este mes: sin meta no hay diferencia que explicar.", "There is no Eságara goal for this month: without a goal there is no difference to explain.")} <Link href="/comercial/metas">{t("Fijar metas", "Set goals")}</Link></p>
          : g.gap <= 0 ? <p className="small"><span className="sig ok">{t("La meta se cumplió", "The goal was met")}</span></p> : (
            <>
              <div className="tscroll"><table>
                <thead><tr><th>{t("Causa", "Cause")}</th><th className="n">USD</th><th className="n">{t("Parte de la diferencia", "Share of the difference")}</th></tr></thead>
                <tbody>
                  {g.causes.map((c) => <tr key={c.key}><td>{t(c.text.es, c.text.en)}<span className="src block">{c.deals.map((d) => <Link key={d.id} href={`/deals/${d.id}`} style={{ marginRight: 10 }}>{d.code} · {d.account} ({i.pct(d.sale > 0 ? (d.esagara / d.sale) * 100 : 0)})</Link>)}</span></td><td className="n mono risk-t">−{i.n2(c.usd)}</td><td className="n mono">{i.pct((c.usd / g.gap) * 100)}</td></tr>)}
                  <tr><td>{t("Sin explicar por Eságara baja (faltan ventas o son más pequeñas)", "Not explained by low Eságara (sales missing or smaller)")}</td><td className="n mono">−{i.n2(g.unexplained)}</td><td className="n mono">{i.pct((g.unexplained / g.gap) * 100)}</td></tr>
                  <tr><td><b>{t("Diferencia frente a la meta", "Difference against goal")}</b></td><td className="n mono"><b>−{i.n2(g.gap)}</b></td><td /></tr>
                </tbody>
              </table></div>
              <p className="src">{t(`Umbral de Eságara: ${f.floorPct} % (política versión ${f.floorVersion}). Para cada venta bajo el umbral se cuenta lo que habría dejado al ${f.floorPct} % menos lo que dejó.`, `Eságara threshold: ${f.floorPct} % (policy version ${f.floorVersion}). For each sale under the threshold, what it would have left at ${f.floorPct} % minus what it left is counted.`)} <Link href="/comercial/esagara">{t("Ver las excepciones aprobadas", "See the approved exceptions")}</Link></p>
            </>
          )}
      </section>

      <section className="card" id="personas">
        <b>{t("LAS PERSONAS", "THE PEOPLE")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Persona", "Person")}</th>{METRIC_KEYS.map((k) => <th key={k} className="n">{t(GOAL_METRICS[k].es, GOAL_METRICS[k].en)}</th>)}</tr></thead>
          <tbody>{f.people.map((p) => <tr key={p.id}><td><Link href={`/informes?u=${p.id}&mes=${period}`}><b>{p.name}</b></Link>{!p.hasGoal && <span className="src block">{t("sin metas este mes", "no goals this month")}</span>}</td>{METRIC_KEYS.map((k) => <td key={k} className="n mono">{GOAL_METRICS[k].unit === "usd" ? i.n2(p.values[k]) : Math.round(p.values[k])}</td>)}</tr>)}</tbody>
        </table></div>
        <p className="src">{t("En orden alfabético: es para ver quién construye qué, no un ranking. La suma de las personas es la cifra de la función.", "In alphabetical order: it shows who is building what, not a ranking. The people add up to the function's figure.")} <Link href="/informes/equipo">{t("Ver por equipo", "See by team")}</Link></p>
      </section>
      <p className="src">{t("Hoy solo existe la función Comercial como revisión. Operaciones tiene sus métricas en Operaciones → Métricas, y Administración su vista en Informes → Administración.", "Today only the Commercial function has a review. Operations has its metrics in Operations → Metrics, and Administration its view in Reports → Administration.")}</p>
    </>
  );
}
