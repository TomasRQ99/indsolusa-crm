import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { GOAL_METRICS, METRIC_KEYS, periodOf, shiftPeriod, validPeriod, type PaceStatus } from "@/lib/goal-rules";
import { periodStatus } from "@/lib/metric-dictionary";
import { personReport, reportScope } from "@/lib/reports";
import { HowCalc } from "@/components/HowCalc";

// Módulo 13 §4.1 · Mi desempeño: how am I doing, what must I move today, and am I building enough future.
// Result, Future, Money to move and Risks side by side. No score: each dimension in its own words.

export default async function MyPerformancePage({ searchParams }: { searchParams: Promise<{ u?: string; mes?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const now = new Date();
  const period = sp.mes && validPeriod(sp.mes) ? sp.mes : periodOf(now);
  const scope = await reportScope(user);
  const personId = sp.u && scope.canSee(sp.u) ? sp.u : user.id;
  const [person, r, people] = await Promise.all([
    db.user.findUnique({ where: { id: personId }, select: { id: true, name: true } }),
    personReport(personId, period, now),
    scope.all ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve(scope.led.flatMap((tm) => tm.members.map((m) => ({ id: m.userId, name: m.user.name })))),
  ]);
  const status = periodStatus(period, now);
  const usd = (n: number) => `USD ${i.n2(n)}`;
  const val = (k: (typeof METRIC_KEYS)[number], n: number) => (GOAL_METRICS[k].unit === "usd" ? usd(n) : String(Math.round(n)));
  const PACE: Record<PaceStatus, { es: string; en: string; tone: string }> = {
    NO_TARGET: { es: "Sin meta", en: "No goal", tone: "wait" }, DONE: { es: "Meta cumplida", en: "Goal met", tone: "ok" }, AHEAD: { es: "Adelante del ritmo", en: "Ahead of pace", tone: "ok" }, ON_PACE: { es: "En ritmo", en: "On pace", tone: "ok" },
    CLOSE: { es: "Cerca del ritmo", en: "Close to pace", tone: "attn" }, BEHIND: { es: "Por debajo del ritmo", en: "Behind pace", tone: "risk" }, EARLY: { es: "El mes apenas empieza", en: "The month is just starting", tone: "wait" },
  };
  const q = (extra: Record<string, string>) => `/informes?${new URLSearchParams({ ...(personId !== user.id ? { u: personId } : {}), mes: period, ...extra }).toString()}`;
  const showComm = scope.seesCommissionOf(personId);
  const c = r.commission;

  return (
    <>
      <div className="ph"><div>
        <h1>{personId === user.id ? t("Mi desempeño", "My performance") : t(`Desempeño de ${person?.name ?? ""}`, `${person?.name ?? ""}'s performance`)}</h1>
        <p>{t("Cómo vas, qué necesita movimiento y si estás construyendo futuro suficiente. Todo sale de lo que ya está en SOLU; nada se escribe para este informe.", "How you are doing, what needs movement and whether you are building enough future. Everything comes from what is already in SOLU; nothing is typed for this report.")}</p>
        <p className="small"><span className="mono">{period}</span> · <span className={`sig ${status === "CLOSED" ? "ok" : "wait"}`}>{status === "CLOSED" ? t("Mes cerrado", "Month closed") : t("Provisional: el mes sigue abierto", "Provisional: the month is still open")}</span> · {t("calculado", "as of")} {i.day(r.asOf)} · <Link href={q({ mes: shiftPeriod(period, -1) })}>← {shiftPeriod(period, -1)}</Link>{period < periodOf(now) && <> · <Link href={q({ mes: shiftPeriod(period, 1) })}>{shiftPeriod(period, 1)} →</Link></>}</p>
        {people.length > 1 && <form action="/informes" className="qa-row" style={{ maxWidth: 420 }}><input type="hidden" name="mes" value={period} /><select name="u" defaultValue={personId} aria-label={t("Persona", "Person")}><option value={user.id}>{t("Yo", "Me")}</option>{people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Ver", "View")}</button></form>}
      </div></div>

      <section className="card" id="resultado">
        <b>{t("RESULTADO Y FUTURO", "RESULT AND FUTURE")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Qué", "What")}</th><th className="n">{t("Este mes", "This month")}</th><th className="n">{t("Meta", "Goal")}</th><th>{t("Ritmo", "Pace")}</th><th className="n">{t("Mes anterior", "Previous month")}</th></tr></thead>
          <tbody>{METRIC_KEYS.map((k) => { const p = r.board.paces[k]; const P = PACE[p.status]; const prev = r.prev.values[k]; return (
            <tr key={k}>
              <td><b>{t(GOAL_METRICS[k].es, GOAL_METRICS[k].en)}</b><span className="block"><HowCalc id={k} es={i.es} /></span></td>
              <td className="n mono"><b>{val(k, p.actual)}</b>{k === "ESAGARA_AMOUNT" && r.board.extras.esagaraPct != null && <span className="src block">{i.pct(r.board.extras.esagaraPct)}</span>}</td>
              <td className="n mono">{p.target != null ? val(k, p.target) : "—"}</td>
              <td><span className={`sig ${P.tone}`}>{t(P.es, P.en)}</span>{p.perDayNeeded != null && <span className="src block">{t(`faltan ${val(k, p.remaining ?? 0)} en ${p.remainingDays} días hábiles`, `${val(k, p.remaining ?? 0)} to go in ${p.remainingDays} working days`)}</span>}</td>
              <td className="n mono">{val(k, prev)}<span className={`src block ${p.actual - prev < 0 ? "risk-t" : ""}`}>{p.actual - prev > 0 ? "+" : p.actual - prev < 0 ? "−" : ""}{val(k, Math.abs(p.actual - prev))}</span></td>
            </tr>
          ); })}</tbody>
        </table></div>
        {r.board.hints.length > 0 && <ul className="plain small">{r.board.hints.map((h, k) => <li key={k}>• {t(h.es, h.en)}</li>)}</ul>}
        <p className="src">{t("El mes anterior se muestra completo; el actual, hasta hoy. La comparación sirve para ver la dirección, no para juzgar un mes a medias.", "The previous month is shown in full; the current one, up to today. The comparison shows direction, not a verdict on a half month.")} <Link href="/comercial/metas">{t("Ver mis metas", "See my goals")}</Link></p>
      </section>

      <section className="card" id="dinero">
        <b>{t("DINERO QUE DEBO MOVER", "MONEY I MUST MOVE")}</b>
        <dl className="qv-dl">
          <dt>{t("Entregado sin facturar", "Delivered, not invoiced")}<span className="block"><HowCalc id="DELIVERED_NOT_INVOICED" es={i.es} /></span></dt><dd><b className="mono">{usd(r.money.notInvoicedUsd)}</b>{r.money.notInvoiced.slice(0, 5).map((x, k) => <span key={k} className="src block"><Link href={`/deals/${x.id}/facturacion`}>{x.code}</Link> · {x.ref} · {i.n2(x.usd)}</span>)}</dd>
          <dt>{t("Por cobrar", "Outstanding")}<span className="block"><HowCalc id="OUTSTANDING" es={i.es} /></span></dt><dd><b className="mono">{usd(r.money.outstandingUsd)}</b><span className="muted small"> · {t(`${r.money.open.length} facturas`, `${r.money.open.length} invoices`)}</span></dd>
          <dt>{t("De eso, vencido", "Of which, overdue")}</dt><dd><b className={`mono ${r.money.overdueUsd > 0 ? "risk-t" : ""}`}>{usd(r.money.overdueUsd)}</b>{r.money.overdue.slice(0, 5).map((x, k) => <span key={k} className="src block"><Link href={`/deals/${x.id}/facturacion`}>{x.number}</Link> · {t("venció", "due")} {i.day(x.due)} · {i.n2(x.usd)}</span>)}</dd>
        </dl>
      </section>

      <section className="card" id="riesgos">
        <b>{t("RIESGOS Y LO QUE VIENE", "RISKS AND WHAT IS COMING")}</b>
        <dl className="qv-dl">
          <dt>{t("Negocios grandes sin movimiento", "Large business with no movement")}</dt><dd><b className="mono">{r.risks.attention.length}</b>{r.risks.attention.slice(0, 4).map((x) => <span key={x.dealId} className="src block"><Link href={`/deals/${x.dealId}`}>{x.code ?? x.solution}</Link> · {x.account} · {t(`${x.daysQuiet} días`, `${x.daysQuiet} days`)}</span>)}</dd>
          <dt>{t("Journeys sin próximo paso", "Journeys with no next step")}</dt><dd><b className="mono">{r.risks.noNextMove.length}</b><span className="muted small"> · {t(`de ${r.future.openJourneys} abiertos`, `of ${r.future.openJourneys} open`)}</span></dd>
          <dt>{t("Decisiones del cliente vencidas", "Customer decisions overdue")}</dt><dd><b className="mono">{r.risks.decisionOverdue.length}</b></dd>
          <dt>{t("Ventas del mes con Eságara bajo el umbral", "This month's sales with Eságara under the threshold")}</dt><dd><b className="mono">{r.risks.lowEsagara}</b></dd>
          <dt>{t("Decisiones que vienen", "Decisions coming")}</dt><dd>{r.future.decisionsComing.length === 0 ? <span className="muted">{t("Ninguna con fecha", "None with a date")}</span> : r.future.decisionsComing.map((x) => <span key={x.dealId} className="small block"><span className="mono">{i.day(x.nextDecision!)}</span> · <Link href={`/deals/${x.dealId}`}>{x.code ?? x.solution}</Link> · {x.account}{x.esagara != null ? ` · Eságara ${i.n2(x.esagara)}` : ""}</span>)}</dd>
        </dl>
        <p className="src"><Link href="/comercial/foco">{t("Foco de alto valor", "High-value focus")}</Link> · <Link href="/comercial/dinero">{t("Dinero por mover", "Money to move")}</Link> · <Link href="/comercial/mejora">{t("Mi mejora", "My improvement")}</Link></p>
      </section>

      {showComm && (
        <section className="card" id="comision">
          <b>{t("MI COMISIÓN", "MY COMMISSION")}</b> <HowCalc id="COMMISSION" es={i.es} />
          <dl className="qv-dl">
            <dt>{t("Estimada (aún no ganada)", "Estimated (not earned yet)")}</dt><dd className="mono">{usd(c.estimated.hi)}</dd>
            <dt>{t("Ganada, por aprobar", "Earned, to approve")}</dt><dd className="mono">{usd(c.earned.hi)}</dd>
            <dt>{t("Aprobada, sin pagar", "Approved, not paid")}</dt><dd className="mono">{usd(c.approved.hi)}</dd>
            <dt>{t("Pagada", "Paid")}</dt><dd className="mono">{usd(c.paid.hi)}</dd>
          </dl>
          <p className="src">{t("Son todas tus ventas, no solo las de este mes.", "These cover all your sales, not only this month's.")} <Link href="/gerencia/comisiones">{t("Ver el detalle", "See the detail")}</Link></p>
        </section>
      )}
      <p className="src">{t("Tu desarrollo (SER–HACER–TENER, compromisos y próxima conversación) está en", "Your development (BE–DO–HAVE, commitments and next conversation) is in")} <Link href="/equipo/desarrollo">{t("Equipo → Mi desarrollo", "Team → My development")}</Link> · <Link href="/equipo/mi-rol">{t("Mi rol", "My role")}</Link></p>
    </>
  );
}
