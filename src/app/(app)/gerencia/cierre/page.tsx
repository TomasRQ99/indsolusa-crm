import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { closeBounds, closeState, shiftClose, type CloseKind } from "@/lib/focus-rules";
import { getFocusPolicy } from "@/lib/focus";
import { closeReport } from "@/lib/closes";
import { interventionQueue } from "@/lib/future-pulse";
import { peopleCapacity } from "@/lib/gerencia-people";
import { decisionsNeeded } from "@/lib/gerencia-store";

// Módulo 15 §19 · Executive close of a day, a week or a month. It counts what happened inside the period (event
// dates), and it starts with the future: what Gerencia must decide and what is coming, then result, value, risks,
// cash and fulfilment, and capacity. Company totals only: no list of people.

type Kind = CloseKind | "quarter";
const KINDS: Record<string, Kind> = { dia: "day", semana: "week", mes: "month", trimestre: "quarter" };
// The quarter (§10): calendar quarters, end exclusive, in the same UTC days as the other closes.
const quarterBounds = (ref: Date) => { const q = Math.floor(ref.getUTCMonth() / 3) * 3; return { start: new Date(Date.UTC(ref.getUTCFullYear(), q, 1)), end: new Date(Date.UTC(ref.getUTCFullYear(), q + 3, 1)) }; };
const boundsOf = (kind: Kind, ref: Date) => (kind === "quarter" ? quarterBounds(ref) : closeBounds(kind, ref));
const shift = (kind: Kind, ref: Date, n: number) => (kind === "quarter" ? new Date(Date.UTC(ref.getUTCFullYear(), Math.floor(ref.getUTCMonth() / 3) * 3 + n * 3, 1)) : shiftClose(kind, ref, n));

export default async function ExecutiveClosePage({ searchParams }: { searchParams: Promise<{ tipo?: string; ref?: string }> }) {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const tipo = sp.tipo && sp.tipo in KINDS ? sp.tipo : "dia";
  const kind = KINDS[tipo];
  const T = today();
  const ref = sp.ref && /^\d{4}-\d{2}-\d{2}$/.test(sp.ref) && !isNaN(+new Date(`${sp.ref}T00:00:00Z`)) ? new Date(`${sp.ref}T00:00:00Z`) : T;
  const { start, end } = boundsOf(kind, ref);
  const ger = isGerencia(user);
  const fpol = await getFocusPolicy();
  const [rep, needed, queue, decided, deliveries, people] = await Promise.all([
    closeReport(null, start, end), decisionsNeeded(user), interventionQueue(user.id, 5),
    db.managementDecision.findMany({ where: { status: "DECIDED", decidedAt: { gte: start, lt: end } }, orderBy: { decidedAt: "asc" }, select: { id: true, code: true, version: true, question: true, decision: true, kind: true, impactUsd: true } }),
    db.delivery.findMany({ where: { deliveredAt: { gte: start, lt: end }, deal: { internal: false } }, select: { deliveredAt: true, deal: { select: { promisedDate: true } } } }),
    ger ? peopleCapacity(T) : null,
  ]);
  const state = kind === "quarter" ? (new Date() >= end ? "FINAL" as const : new Date() < start ? "FUTURE" as const : "OPEN" as const) : closeState(kind, ref, new Date(), fpol.value.closeTime);
  const priorities = kind === "quarter" ? await db.strategicPriority.findMany({ where: { OR: [{ status: "ACTIVE" }, { closedAt: { gte: start, lt: end } }] }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, status: true, narrative: true, narrativeAt: true, nextReviewOn: true, closedNote: true, owner: { select: { name: true } }, _count: { select: { links: true } } } }) : [];
  const withPromise = deliveries.filter((d) => d.deal.promisedDate), onTime = withPromise.filter((d) => +d.deliveredAt <= +d.deal.promisedDate! + 864e5 - 1);
  const link = (k: string, d: Date) => `/gerencia/cierre?tipo=${k}&ref=${dayInput(d)}`;
  const label = kind === "quarter" ? `T${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}` : kind === "day" ? i.date(start) : kind === "week" ? `${i.day(start)} – ${i.day(new Date(+end - 864e5))}` : new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  const topValue = [...rep.happened.decided].filter((q) => q.status === "ACCEPTED").sort((a, b) => Number(b.protEsagra ?? 0) - Number(a.protEsagra ?? 0)).slice(0, 3);
  const stateTxt = { FINAL: t("Periodo terminado", "Period ended"), DUE: t(`Cierre del día: ya pasaron las ${fpol.value.closeTime}`, `Day close: it is past ${fpol.value.closeTime}`), OPEN: t("Periodo en curso: cifras provisionales", "Period in progress: provisional figures"), FUTURE: t("Periodo futuro", "Future period") }[state];

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Cierre ejecutivo", "Executive close")}</h1>
        <p>{t("Lo que pasó en el periodo, empezando por el futuro: qué hay que decidir y qué viene; después resultado, valor, riesgos, caja y cumplimiento, y capacidad.", "What happened in the period, starting with the future: what must be decided and what is coming; then result, value, risks, cash and fulfilment, and capacity.")}</p>
        <nav className="iv-tabs" aria-label={t("Periodo", "Period")}>{Object.keys(KINDS).map((k) => <Link key={k} href={link(k, ref)} className={k === tipo ? "on" : ""}>{{ dia: t("Día", "Day"), semana: t("Semana", "Week"), mes: t("Mes", "Month"), trimestre: t("Trimestre", "Quarter") }[k]}</Link>)}</nav>
        <p className="small"><Link href={link(tipo, shift(kind, ref, -1))}>← {t("anterior", "previous")}</Link> · <b>{label}</b> · <span className={`sig ${state === "FINAL" ? "ok" : state === "DUE" ? "attn" : "wait"}`}>{stateTxt}</span>{end <= T ? <> · <Link href={link(tipo, shift(kind, ref, 1))}>{t("siguiente", "next")} →</Link></> : null}</p>
      </div></div>

      <section className="card" id="decidir"><b>{t("1 · DECISIONES QUE SE REQUIEREN DE GERENCIA", "1 · DECISIONS REQUIRED FROM MANAGEMENT")}</b> <span className="small muted">{t("hoy, no del periodo", "today, not of the period")}</span>
        {needed.shown.length === 0 ? <p className="small"><span className="sig ok">{t("Nada espera decisión", "Nothing awaits a decision")}</span></p> : <ul className="rp-list">{needed.shown.map((x) => <li key={x.key}><span>{t(x.question.es, x.question.en)}<span className="src block">{x.impact ?? ""}{x.deadline ? ` · ${t("antes del", "before")} ${i.date(x.deadline)}` : ""}</span></span><Link href={x.href}>{t("Decidir", "Decide")}</Link></li>)}</ul>}
        {needed.later.length > 0 && <p className="src">{t(`y ${needed.later.length} más`, `and ${needed.later.length} more`)} · <Link href="/gerencia/decisiones">{t("ver todas", "see all")}</Link></p>}
        {decided.length > 0 && <p className="small">{t("Decidido en el periodo", "Decided in the period")}: {decided.map((d, k) => <span key={d.id}>{k ? " · " : ""}<Link href={`/gerencia/decisiones/${d.id}`}>{d.code}</Link></span>)}</p>}
      </section>

      <section className="card" id="futuro"><b>{t("2 · FUTURO QUE SE CREÓ", "2 · FUTURE CREATED")}</b>
        <dl className="qv-dl">
          <dt>{t("Necesidades nuevas", "New Needs")}</dt><dd><b>{rep.future.needs.length}</b>{rep.future.needs.slice(0, 5).map((n) => <span key={n.id} className="src block"><Link href={`/deals/${n.id}`}>{n.code ?? n.title}</Link> · {n.account.name} · {n.desiredResult}</span>)}</dd>
          <dt>{t("Oportunidades futuras identificadas", "Future opportunities identified")}</dt><dd><b>{rep.future.futures.length}</b>{rep.future.futures.slice(0, 4).map((f) => <span key={f.id} className="src block">{f.account?.name ?? t("Mercado", "Market")} · {f.description}{f.expectedAt ? ` · ${i.date(f.expectedAt)}` : ""}</span>)}</dd>
          <dt>{t("Decisiones de clientes en el periodo siguiente", "Customer decisions in the next period")}</dt><dd><b>{rep.future.decisionsNext.length}</b>{rep.future.decisionsNext.slice(0, 5).map((q) => <span key={q.id} className="src block"><Link href={`/cotizaciones/${q.id}`}>{q.deal.account.name} · {q.deal.title}</Link> · {i.date(q.decisionAt)}{q.protEsagra != null ? ` · Eságara ${i.money(q.protEsagra)}` : ""}</span>)}</dd>
        </dl>
      </section>

      <section className="card" id="resultado"><b>{t("3 · RESULTADO", "3 · RESULT")}</b>
        <dl className="qv-dl">
          <dt>{t("Venta aceptada", "Sales accepted")}</dt><dd className="mono"><b>{i.money(rep.happened.sale)}</b></dd>
          <dt>{t("Eságara ganada", "Eságara won")}</dt><dd className="mono"><b>{i.money(rep.happened.esagara)}</b>{rep.happened.pct != null ? ` · ${i.pct(rep.happened.pct)}` : ""}</dd>
          <dt>{t("Decisiones de clientes", "Customer decisions")}</dt><dd>{t(`${rep.happened.accepted} sí · ${rep.happened.declined} no`, `${rep.happened.accepted} yes · ${rep.happened.declined} no`)} · {t(`${rep.happened.presented.length} cotización(es) presentada(s)`, `${rep.happened.presented.length} quote(s) presented`)}</dd>
          <dt>{t("Órdenes de compra recibidas", "Purchase orders received")}</dt><dd>{rep.happened.pos.length}</dd>
        </dl>
      </section>

      <section className="card" id="valor"><b>{t("4 · MAYOR VALOR DEL PERIODO", "4 · TOP VALUE OF THE PERIOD")}</b>
        {topValue.length === 0 ? <p className="quiet-p">{t("Ningún cliente aceptó una cotización en el periodo.", "No customer accepted a quote in the period.")}</p> : <ul className="rp-list">{topValue.map((q) => <li key={q.id}><span><Link href={`/cotizaciones/${q.id}`}>{q.deal.account.name} · {q.deal.title}</Link></span><span className="mono small">Eságara {i.money(q.protEsagra)} · {t("venta", "sale")} {i.money(q.protSale)}</span></li>)}</ul>}
      </section>

      <section className="card" id="riesgos"><b>{t("5 · RIESGOS", "5 · RISKS")}</b> <span className="small muted">{t("como están hoy", "as they stand today")}</span>
        {queue.length === 0 ? <p className="small"><span className="sig ok">{t("Ninguna excepción material", "No material exception")}</span></p> : <ul className="rp-list">{queue.map((q) => <li key={q.key}><span><span className="sig attn">{t(q.kind.es, q.kind.en)}</span> {q.headline}<span className="src block">{q.impact ?? ""}{q.owner ? ` · ${q.owner}` : ""}</span></span><Link href={q.href}>{t("Abrir", "Open")}</Link></li>)}</ul>}
      </section>

      <section className="card" id="caja"><b>{t("6 · CAJA Y CUMPLIMIENTO", "6 · CASH AND FULFILMENT")}</b>
        <dl className="qv-dl">
          <dt>{t("Facturado", "Invoiced")}</dt><dd className="mono">{i.money(rep.happened.invoiced)}</dd>
          <dt>{t("Cobrado", "Collected")}</dt><dd className="mono">{i.money(rep.happened.collected)} <span className="src">{t("pagos recibidos en el periodo", "payments received in the period")}</span></dd>
          <dt>{t("Entregas al cliente", "Customer deliveries")}</dt><dd>{deliveries.length}{withPromise.length ? ` · ${t(`${onTime.length} de ${withPromise.length} dentro de la promesa`, `${onTime.length} of ${withPromise.length} within the promise`)}` : ""}</dd>
        </dl>
      </section>

      {people && (
        <section className="card" id="capacidad"><b>{t("7 · CAPACIDAD", "7 · CAPACITY")}</b> <span className="small muted">{t("como está hoy", "as it stands today")}</span>
          <dl className="qv-dl">
            <dt>{t("Ausentes hoy", "Away today")}</dt><dd>{people.away.filter((a) => a.now).length ? people.away.filter((a) => a.now).map((a) => `${a.name}${a.coveredBy ? ` (${t("cubre", "covered by")} ${a.coveredBy})` : ` (${t("sin cubrir", "uncovered")})`}`).join(" · ") : t("Nadie", "Nobody")}</dd>
            <dt>{t("Ausencias próximas sin cubrir", "Upcoming absences uncovered")}</dt><dd>{people.uncovered.length}</dd>
            <dt>{t("Relaciones clave sin respaldo", "Key relationships with no backup")}</dt><dd>{people.noBackup.length} · <Link href="/gerencia/personas">{t("Personas y capacidad", "People and capacity")}</Link></dd>
          </dl>
        </section>
      )}
      {kind === "quarter" && (
        <section className="card" id="trimestre"><b>{t("REVISIÓN DEL TRIMESTRE: DIRECCIÓN Y RECURSOS", "QUARTERLY REVIEW: DIRECTION AND RESOURCES")}</b>
          <dl className="qv-dl">
            <dt>{t("Estrategia", "Strategy")}</dt><dd>{priorities.length === 0 ? <span className="muted">{t("No hay prioridades estratégicas definidas.", "No strategic priorities defined.")} <Link href="/gerencia/prioridades">{t("Definirlas", "Define them")}</Link></span> : <ul className="plain">{priorities.map((p) => <li key={p.id}><Link href={`/gerencia/prioridades?ver=todas#p-${p.id}`}><b>{p.title}</b></Link> · {p.owner.name} · {p.status === "ACTIVE" ? (p.narrativeAt && p.narrativeAt >= start ? t("revisada este trimestre", "reviewed this quarter") : <b className="attn-t">{t("sin revisar este trimestre", "not reviewed this quarter")}</b>) : p.status === "ACHIEVED" ? t("lograda", "achieved") : t("abandonada", "dropped")}{p._count.links === 0 ? <b className="attn-t"> · {t("sin registros vinculados", "no linked records")}</b> : null}<span className="src block">{p.status === "ACTIVE" ? p.narrative ?? t("Nadie ha escrito cómo va.", "Nobody has written how it is going.") : p.closedNote}</span></li>)}</ul>}</dd>
            <dt>{t("Asignación de recursos", "Resource allocation")}</dt><dd>{decided.filter((d) => d.kind === "RESOURCE_ALLOCATION").length === 0 ? <span className="muted">{t("Ninguna decisión de asignación de recursos en el trimestre.", "No resource-allocation decision in the quarter.")}</span> : <ul className="plain">{decided.filter((d) => d.kind === "RESOURCE_ALLOCATION").map((d) => <li key={d.id}><Link href={`/gerencia/decisiones/${d.id}`}><b className="mono">{d.code}</b></Link> {d.question}{d.impactUsd != null ? <span className="mono"> · {i.money(d.impactUsd)}</span> : null}<span className="src block">{d.decision}</span></li>)}</ul>}</dd>
            <dt>{t("Tendencias", "Trends")}</dt><dd><Link href="/gerencia/sistema">{t("Desempeño del sistema: 90 días frente a los 270 anteriores", "System performance: 90 days against the 270 before")}</Link> · <Link href="/gerencia/revisiones">{t("Revisión por función", "Functional review")}</Link></dd>
            <dt>{t("Capacidad", "Capability")}</dt><dd>{ger ? <Link href="/gerencia/personas">{t("Personas y capacidad", "People and capacity")}</Link> : null}{ger ? " · " : ""}<Link href="/gerencia/funciones#huecos">{t("Huecos en la estructura de funciones", "Holes in the function structure")}</Link></dd>
            <dt>{t("Concentración del riesgo", "Risk concentration")}</dt><dd><Link href="/gerencia/futuro#concentracion">{t("Qué parte depende de un solo cliente o proveedor", "What share depends on a single customer or supplier")}</Link> · <Link href="/gerencia/politicas#patrones">{t("Excepciones que se repiten", "Exceptions that repeat")}</Link></dd>
          </dl>
        </section>
      )}
      {rep.improve.length > 0 && <section className="card" id="mejora"><b>{t("QUÉ MEJORAR", "WHAT TO IMPROVE")}</b><ul className="plain small">{rep.improve.map((x, k) => <li key={k}>{t(x.es, x.en)}</li>)}</ul></section>}
      <p className="src">{t("Los bloques 2, 3, 4 y 6 cuentan lo que ocurrió dentro del periodo. Los bloques 1, 5 y 7 muestran cómo están las cosas hoy: SOLU no guarda la historia de esos estados.", "Blocks 2, 3, 4 and 6 count what happened inside the period. Blocks 1, 5 and 7 show how things stand today: SOLU keeps no history of those states.")}</p>
    </>
  );
}
