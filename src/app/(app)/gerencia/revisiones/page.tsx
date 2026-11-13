import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { periodOf, shiftPeriod, validPeriod } from "@/lib/goal-rules";
import { periodStatus } from "@/lib/metric-dictionary";
import { AREAS } from "@/lib/gerencia-rules";
import { REVIEW_AREAS, REVIEW_TOPICS, functionalReview, type ReviewArea } from "@/lib/gerencia-views";
import { fmtFig } from "../ui";

// Módulo 15 §5 · Functional review. For each function the same three questions, in this order (AC10):
// what changed, why, and what needs a decision. A figure with no cause is not enough to decide (principle 3).

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ f?: string; mes?: string }> }) {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  // The team review holds capacity and continuity of people: Gerencia only (§9, §13).
  const areas = REVIEW_AREAS.filter((a) => ger || a !== "EQUIPO");
  const area: ReviewArea = (areas as readonly string[]).includes(sp.f ?? "") ? (sp.f as ReviewArea) : "COMERCIAL";
  const T = today(), cur = periodOf(T);
  const period = sp.mes && validPeriod(sp.mes) && sp.mes <= cur ? sp.mes : cur;
  const r = await functionalReview(area, period, user);
  const link = (a: string, m: string) => `/gerencia/revisiones?f=${a}&mes=${m}`;
  const moved = r.changed.filter((c) => c.prev != null && Math.abs(c.value - c.prev) > 0.005);

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Revisión por función", "Functional review")}</h1>
        <p>{t("El recorrido mensual: mercado → comercial → operaciones → administración → equipo. En cada una: qué cambió, por qué, y qué requiere una decisión.", "The monthly walk: market → commercial → operations → administration → team. In each: what changed, why, and what needs a decision.")}</p>
        <nav className="iv-tabs" aria-label={t("Función", "Function")}>{areas.map((a) => <Link key={a} href={link(a, period)} className={a === area ? "on" : ""}>{t(AREAS[a].es, AREAS[a].en)}</Link>)}</nav>
        <p className="small"><Link href={link(area, shiftPeriod(period, -1))}>← {shiftPeriod(period, -1)}</Link> · <b className="mono">{period}</b> · <span className={`sig ${periodStatus(period, T) === "CLOSED" ? "ok" : "wait"}`}>{periodStatus(period, T) === "CLOSED" ? t("mes terminado", "month ended") : t("mes en curso: provisional", "month in progress: provisional")}</span>{period < cur ? <> · <Link href={link(area, shiftPeriod(period, 1))}>{shiftPeriod(period, 1)} →</Link></> : null}</p>
        <p className="small muted">{t(REVIEW_TOPICS[area].es, REVIEW_TOPICS[area].en)}</p>
      </div></div>

      <section className="card" id="cambio"><b>{t("1 · QUÉ CAMBIÓ", "1 · WHAT CHANGED")}</b> <span className="small muted">{t(`${moved.length} cifra(s) se movieron frente al mes anterior`, `${moved.length} figure(s) moved against the previous month`)}</span>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Qué", "What")}</th><th className="n">{t("En el mes", "In the month")}</th><th className="n">{t("Mes anterior", "Previous month")}</th><th className="n">{t("Cambio", "Change")}</th></tr></thead>
          <tbody>{r.changed.map((c) => { const d = c.prev != null ? Math.round((c.value - c.prev) * 100) / 100 : null; return (
            <tr key={c.key}>
              <td>{c.href ? <Link href={c.href}>{t(c.label.es, c.label.en)}</Link> : t(c.label.es, c.label.en)}{c.state ? <span className="sig wait" style={{ marginLeft: 6 }}>{t("foto de hoy", "today's snapshot")}</span> : null}{c.note ? <span className="src block">{t(c.note.es, c.note.en)}</span> : null}</td>
              <td className="n mono"><b>{fmtFig(i, c.unit, c.value)}</b></td><td className="n mono">{c.prev != null ? fmtFig(i, c.unit, c.prev) : "—"}</td>
              <td className="n mono">{d == null ? "—" : d === 0 ? t("igual", "same") : `${d > 0 ? "+" : "−"}${fmtFig(i, c.unit, Math.abs(d)).replace("USD ", "")}`}</td>
            </tr>
          ); })}</tbody>
        </table></div>
      </section>

      <section className="card" id="porque"><b>{t("2 · POR QUÉ", "2 · WHY")}</b> <span className="small muted">{t("hechos contados de los registros; una inferencia se marca como inferencia", "facts counted from the records; an inference is marked as an inference")}</span>
        {r.why.length === 0 ? <p className="small muted">{t("SOLU no encontró una causa en los registros de este mes. Eso también es información: lo que cambió no tiene todavía una explicación escrita.", "SOLU found no cause in this month's records. That is information too: what changed has no written explanation yet.")}</p> : (
          <ul className="plain">{r.why.map((w) => <li key={w.key} style={{ marginBottom: 8 }}><span className={`sig ${w.kind === "FACT" ? "info" : "dash"}`}>{w.kind === "FACT" ? t("Hecho", "Fact") : t("Inferencia", "Inference")}</span> {w.href ? <Link href={w.href}>{t(w.headline.es, w.headline.en)}</Link> : t(w.headline.es, w.headline.en)}{w.detail ? <span className="src block">{t(w.detail.es, w.detail.en)}</span> : null}</li>)}</ul>
        )}
        {area !== "EQUIPO" && <p className="src">{t("Para ir a la causa de cada Necesidad:", "To reach the cause of each Necessity:")} <Link href="/gerencia/insights?view=causas">{t("Insights → Causalidad", "Insights → Causality")}</Link>{area === "COMERCIAL" ? <> · <Link href={`/informes/funcion?mes=${period}`}>{t("Función Comercial, persona por persona", "Commercial function, person by person")}</Link></> : null}</p>}
      </section>

      <section className="card" id="decidir"><b>{t("3 · QUÉ REQUIERE DECISIÓN", "3 · WHAT NEEDS A DECISION")}</b>
        {r.decide.length === 0 ? <p className="small"><span className="sig ok">{t("Nada de esta función espera una decisión de Gerencia", "Nothing in this function awaits a Management decision")}</span></p> : (
          <ul className="rp-list">{r.decide.map((x) => <li key={x.key}><span>{t(x.question.es, x.question.en)}<span className="src block">{t(x.whyNow.es, x.whyNow.en)}{x.impact ? ` · ${x.impact}` : ""}{x.deadline ? ` · ${t("antes del", "before")} ${i.date(x.deadline)}` : ""}</span></span><Link href={x.href}>{t("Decidir", "Decide")}</Link></li>)}</ul>
        )}
        {r.decided.length > 0 && <p className="small">{t("Decidido este mes", "Decided this month")}: {r.decided.map((d, k) => <span key={d.id}>{k ? " · " : ""}<Link href={`/gerencia/decisiones/${d.id}`}>{d.code}</Link> {d.question.slice(0, 60)}</span>)}</p>}
        <p className="small"><Link href={`/gerencia/decisiones?area=${area}#pedir`}>{t("Abrir una decisión sobre esta función", "Open a decision about this function")}</Link></p>
      </section>
      <p className="src">{t("Las cifras son las mismas del Pulso del negocio (Informes); aquí se ordenan para decidir.", "The figures are the same as the Business pulse (Reports); here they are arranged to decide.")} {area === "EQUIPO" ? t("Desarrollo, sucesión y preparación para el siguiente rol: Equipo → Desarrollo organizacional.", "Development, succession and readiness for the next role: Team → Organizational development.") : ""}</p>
    </>
  );
}
