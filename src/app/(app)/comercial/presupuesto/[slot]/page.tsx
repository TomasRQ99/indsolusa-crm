import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { monthOf } from "@/lib/customer-stats";
import { workPeople } from "@/lib/team-store";
import { KPIS, PROSPECTS, defaultAssumptions, isEditable, marginOf, readAssumptions, shownState, sum, type Kpi } from "@/lib/sales-budget-rules";
import { approverIdsOf, basisFor, basisPick, budgetScope, budgetYears, canWriteBudget, lastMonths, loadFacts, matrixOf, numbers, readYear, totals, yearRow } from "@/lib/sales-budget";
import { askReconcile, decideBudget, discardDraft, newVersion, saveBudget, withdrawBudget } from "../actions";
import Editor, { type EditorSaved } from "../Editor";
import { BudgetNav, StateChip, budgetFmt } from "../ui";
import "../presupuesto.css";

// Presupuesto comercial · one company of one negotiator: P02 Empresa 360 (history and its sources), P03 Propuesta,
// P04 Simulador and the approval trail (spec §5, §6). `slot` = the company's id, or "prospectos".

const EVENT: Record<string, { es: string; en: string }> = {
  CREATED: { es: "Creó el borrador", en: "Created the draft" }, SAVED: { es: "Cambió las cifras", en: "Changed the figures" }, SUBMITTED: { es: "Envió a aprobación", en: "Sent for approval" },
  WITHDRAWN: { es: "Retiró el envío", en: "Withdrew the submission" }, RETURNED: { es: "Devolvió la propuesta", en: "Returned the proposal" }, APPROVED: { es: "Aprobó", en: "Approved" },
  NEW_VERSION: { es: "Abrió una versión nueva", en: "Opened a new version" }, RECONCILE: { es: "Pidió conciliación", en: "Asked for reconciliation" },
};

export default async function BudgetCompany({ params, searchParams }: { params: Promise<{ slot: string }>; searchParams: Promise<{ y?: string; u?: string; v?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = budgetFmt(i);
  const [{ slot: rawSlot }, sp] = await Promise.all([params, searchParams]);
  const prospects = rawSlot === "prospectos";
  const slot = prospects ? PROSPECTS : rawSlot;
  const now = new Date();
  const year = readYear(sp.y, now), base = year - 1;
  const { years } = budgetYears(now);
  const scope = await budgetScope(user);
  const everyone = await workPeople();
  const personId = sp.u && (scope.all || scope.ids.has(sp.u)) && everyone.some((p) => p.id === sp.u) ? sp.u : user.id;
  const person = everyone.find((p) => p.id === personId) ?? { id: user.id, name: user.name };
  const own = personId === user.id;
  const write = canWriteBudget(user, personId);

  const account = prospects ? null : await db.account.findUnique({ where: { id: slot }, select: { id: true, name: true, industry: true, ownerId: true, internal: true, owner: { select: { name: true } } } });
  if (!prospects && (!account || account.internal)) notFound();

  const [versions, yr, otherRows, set, approvers] = await Promise.all([
    db.salesBudget.findMany({ where: { year, slot, userId: personId }, orderBy: { version: "desc" }, include: { lines: true, events: { orderBy: { at: "asc" } } } }),
    yearRow(year),
    prospects ? [] : db.salesBudget.findMany({ where: { year, slot }, distinct: ["userId"], orderBy: { createdAt: "asc" }, select: { userId: true, user: { select: { name: true } } } }),
    loadFacts(prospects ? { ownerId: personId } : { OR: [{ accountId: slot }, { ownerId: personId }] }),
    approverIdsOf(personId),
  ]);
  const latest = versions[0] ?? null;
  const chosen = (sp.v && versions.find((b) => String(b.version) === sp.v)) || latest;
  const published = !!yr?.publishedAt;
  const state = shownState(chosen, published);
  const pick = prospects ? () => false : basisPick(slot, personId, account!.ownerId, otherRows.map((o) => o.userId));
  const basis = basisFor(set, year, now, pick, (x) => x.ownerId === personId);
  const start = defaultAssumptions(basis);
  const editable = write && (!chosen || (chosen.id === latest?.id && isEditable(chosen.state)));
  const m = matrixOf(chosen);
  const saved: EditorSaved | null = chosen ? {
    oc: numbers(m.OC_COP), fact: numbers(m.FACT_COP),
    ocN: Array.from({ length: 12 }, (_, k) => { const l = chosen.lines.find((x) => x.kpi === "OC_N" && x.month === k + 1 && x.origin === "MANUAL"); return l ? Number(l.value) : null; }),
    a: readAssumptions(chosen.assumptions, { ...start, ticket: null, convSC: null, bateoN: null, bateoV: null, marginPct: null }),
    potential: chosen.potential, strategy: chosen.strategy, justification: chosen.justification,
  } : null;
  const approverNames = everyone.filter((p) => approvers.ids.includes(p.id)).map((p) => p.name);
  const canDecide = !!chosen && chosen.state === "SUBMITTED" && approvers.ids.includes(user.id);
  const sentBefore = !!chosen && chosen.events.some((e) => e.kind === "SUBMITTED");

  // History of the whole company (every negotiator), and the part that feeds this person's budget.
  const all = totals(set, (x) => x.accountId === slot), mine = totals(set, pick);
  const histYears = [base - 2, base - 1, base];
  const current = monthOf(now);
  const HIST: Kpi[] = ["SOL_N", "COT_N", "COT_COP", "OC_N", "OC_COP", "ESA_COP", "FACT_COP"];
  const avg = (kpi: Kpi, n: number) => { const ms = lastMonths(current, n).filter((k) => all.first != null && k >= all.first); return ms.length ? sum(ms.map((k) => all.of(kpi, k))) / ms.length : null; };
  const chartMonths = lastMonths(current, 36).filter((k) => all.first != null && k >= all.first);
  const chartMax = Math.max(1, ...chartMonths.map((k) => Math.max(all.of("OC_COP", k), all.of("FACT_COP", k))));
  const sources = prospects ? [] : set.facts.filter((x) => x.accountId === slot && (x.kpi === "OC_COP" || x.kpi === "FACT_COP" || x.kpi === "COT_COP" || x.kpi === "SOL_N")).sort((a, b) => +b.at - +a.at).slice(0, 80);
  const sharedWith = otherRows.filter((o) => o.userId !== personId).map((o) => o.user.name);

  const title = prospects ? t("Reactivaciones y prospectos", "Reactivations and prospects") : account!.name;
  const self = `/comercial/presupuesto/${rawSlot}?y=${year}&u=${personId}`;
  const okMsg: Record<string, string> = {
    guardado: t("Borrador guardado.", "Draft saved."), enviado: t("Propuesta enviada a aprobación.", "Proposal sent for approval."), aprobado: t("Presupuesto aprobado. Queda bloqueado: un cambio necesita una versión nueva.", "Budget approved. It is locked: a change needs a new version."),
    devuelto: t("Propuesta devuelta al negociador con tu motivo.", "Proposal returned to the negotiator with your reason."), retirado: t("Envío retirado: la propuesta vuelve a borrador.", "Submission withdrawn: the proposal is a draft again."),
    version: t("Versión nueva abierta como borrador. La versión aprobada sigue vigente hasta que se apruebe esta.", "New version opened as a draft. The approved version stays in force until this one is approved."),
    descartado: t("Borrador descartado.", "Draft discarded."), conciliar: t("Conciliación pedida. El negociador y su líder la ven en esta pantalla.", "Reconciliation requested. The negotiator and their leader see it on this screen."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("La propuesta la escribe su negociador, Gerencia o la Dirección Comercial.", "The proposal is written by its negotiator, Management or the Commercial Director."),
    anio: t("Ese año no está abierto para presupuestar.", "That year is not open for budgeting."), persona: t("Esa persona no está activa.", "That person isn't active."), empresa: t("Esa empresa no existe.", "That company doesn't exist."),
    enviado: t("La propuesta ya se envió: retira el envío para cambiarla.", "The proposal was already sent: withdraw it to change it."),
    aprobado: t("El presupuesto aprobado no se cambia: abre una versión nueva con su motivo.", "The approved budget doesn't change: open a new version with its reason."),
    valor: t("Falta corregir una cifra en «Meta OC» o «Meta facturación»: son números en millones, de cero en adelante.", "A figure in «PO goal» or «Invoicing goal» needs fixing: they are numbers in millions, from zero up."),
    numero: t("Falta corregir «# OC objetivo»: son números enteros.", "«# POs objective» needs fixing: whole numbers only."),
    supuesto: t("Falta corregir un supuesto: escribe solo números (los porcentajes, sin el signo %).", "An assumption needs fixing: type numbers only (percentages without the % sign)."),
    vacio: t("Falta la meta: escribe al menos un mes de «Meta OC» o de «Meta facturación» mayor que cero. El borrador quedó guardado.", "The goal is missing: type at least one month of «PO goal» or «Invoicing goal» above zero. The draft was saved."),
    justificacion: t("Falta la «Justificación»: tus cifras no son la sugerencia de SOLU (o no hay sugerencia), así que tu líder necesita saber de dónde salen. El borrador quedó guardado.", "The «Justification» is missing: your figures are not SOLU's suggestion (or there is none), so your leader needs to know where they come from. The draft was saved."),
    "sin-aprobador": t("Nadie puede aprobar esta propuesta todavía: la persona no tiene líder asignado y no hay otra persona de Gerencia o Dirección Comercial. El borrador quedó guardado.", "Nobody can approve this proposal yet: the person has no assigned leader and there is no other person in Management or Commercial Direction. The draft was saved."),
    "no-aprueba": t("Solo el líder asignado aprueba o devuelve esta propuesta.", "Only the assigned leader approves or returns this proposal."), estado: t("La propuesta ya no está en ese estado. Mira su estado actual abajo.", "The proposal is no longer in that state. See its current state below."),
    "motivo-devolver": t("Falta el motivo: para devolver, escribe qué debe revisar el negociador.", "The reason is missing: to return it, write what the negotiator must review."),
    "motivo-version": t("Falta el motivo de la versión nueva.", "The reason for the new version is missing."), "ya-hay-version": t("Ya hay una versión más nueva en curso.", "A newer version is already in progress."),
    "motivo-conciliar": t("Falta escribir qué se debe conciliar.", "Write what must be reconciled."),
  };
  const bad = sp.err && ["valor", "numero", "supuesto", "vacio", "justificacion"].includes(sp.err) ? sp.err : null;
  const val = (kpi: Kpi, v: number) => (KPIS[kpi].unit === "cop" ? f.bare(v) : i.n(v));

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href={`/comercial/presupuesto?y=${year}${own ? "" : `&u=${personId}`}`}>{t(`Presupuesto comercial ${year}`, `Commercial budget ${year}`)}</Link></div>
        <h1>{title} <StateChip i={i} state={state} /></h1>
        <p>{t(`Presupuesto ${year} · Negociador: ${person.name}`, `Budget ${year} · Negotiator: ${person.name}`)}{chosen ? ` · ${t("versión", "version")} ${chosen.version}` : ""}{account?.industry ? ` · ${account.industry}` : ""}{account ? <> · <Link href={`/accounts/${account.id}`}>{t("Ficha del cliente", "Customer page")}</Link> · <Link href={`/accounts/${account.id}/estadisticas`}>{t("Estadísticas", "Statistics")}</Link></> : null}</p>
      </div></div>
      <BudgetNav i={i} active="empresas" year={year} years={years} personId={own ? null : personId} />
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}{bad ? <> <a href={bad === "justificacion" ? "#justificacion" : bad === "supuesto" ? "#supuestos" : "#propuesta"}>{t("Ir a lo que falta", "Go to what is missing")} ↓</a></> : null}</div>}
      {chosen?.reconcileNote && <div className="note attn"><b>{t("Conciliación pedida", "Reconciliation requested")}</b> · {chosen.reconcileByName} · {i.day(chosen.reconcileAt)}: «{chosen.reconcileNote}»</div>}
      {chosen?.state === "RETURNED" && chosen.decisionNote && <div className="note risk"><b>{t("Devuelto", "Returned")}</b> · {chosen.decidedByName} · {i.day(chosen.decidedAt)}: «{chosen.decisionNote}»</div>}
      {sharedWith.length > 0 && <div className="note">{t(`Esta empresa también la presupuesta: ${sharedWith.join(", ")}. Cada uno ve y propone solo lo de sus Necesidades; nada se cuenta dos veces.`, `This company is also budgeted by: ${sharedWith.join(", ")}. Each one sees and proposes only their own Needs; nothing is counted twice.`)}</div>}

      {!prospects && (
        <section className="card" id="historial">
          <b>{t(`HISTORIAL DE ${title.toUpperCase()}`, `HISTORY OF ${title.toUpperCase()}`)}</b>
          {all.first == null ? <p className="small muted">{t("SOLU no tiene registros de esta empresa todavía: no hay historial ni sugerencia. Escribe las metas mes a mes y explica de dónde salen.", "SOLU has no records of this company yet: there is no history and no suggestion. Type the goals month by month and explain where they come from.")}</p> : (
            <>
              <div className="pc-scroll">
                <table className="pc-table pc-cards" id="tabla-historial">
                  <thead><tr><th>{t("Indicador", "Indicator")}</th>{histYears.map((y) => <th key={y}>{y}{y === base ? t(" (a hoy)", " (so far)") : ""}</th>)}<th>{t(`Cierre ${base} proyectado`, `Projected ${base} close`)}</th><th>{t("Promedio mensual 3 meses", "Monthly average 3 months")}</th><th>{t("6 meses", "6 months")}</th><th>{t("12 meses", "12 months")}</th></tr></thead>
                  <tbody>
                    {HIST.map((k) => (
                      <tr key={k} data-k={k}>
                        <th scope="row">{t(KPIS[k].es, KPIS[k].en)}{KPIS[k].unit === "cop" ? " · $ M" : ""}</th>
                        {histYears.map((y) => <td key={y} data-l={String(y)}>{val(k, sum(all.year(k, y)))}</td>)}
                        <td data-l={t(`Cierre ${base} proyectado`, `Projected ${base} close`)}>{k === "OC_COP" ? (basis.ocClose != null ? f.bare(basis.ocClose) : <span className="muted">{t("sin base", "no basis")}</span>) : k === "FACT_COP" ? (basis.factClose != null ? f.bare(basis.factClose) : <span className="muted">{t("sin base", "no basis")}</span>) : "—"}</td>
                        {[3, 6, 12].map((n) => { const a = avg(k, n); return <td key={n} data-l={t(`Promedio ${n} meses`, `Average ${n} months`)}>{a == null ? "—" : KPIS[k].unit === "cop" ? f.bare(a) : i.n2(a)}</td>; })}
                      </tr>
                    ))}
                    <tr data-k="MARGEN"><th scope="row">{t("Eságara sobre OC (%)", "Eságara on POs (%)")}</th>{histYears.map((y) => <td key={y} data-l={String(y)}>{f.pct(marginOf(sum(all.year("ESA_COP", y)), sum(all.year("OC_COP", y))))}</td>)}<td>—</td><td>—</td><td>—</td><td>—</td></tr>
                  </tbody>
                </table>
              </div>
              <p className="src">{t("Toda la empresa, todos los negociadores. Cifras en millones de pesos; el cierre proyectado usa solo lo que entra en el presupuesto de este negociador.", "The whole company, every negotiator. Figures in millions of pesos; the projected close uses only what enters this negotiator's budget.")}{sum(mine.year("OC_COP", base)) !== sum(all.year("OC_COP", base)) ? t(` De las OC de ${base}, ${f.m(sum(mine.year("OC_COP", base)))} entran en este presupuesto.`, ` Of the ${base} POs, ${f.m(sum(mine.year("OC_COP", base)))} enter this budget.`) : ""}</p>
              {chartMonths.length >= 3 && (
                <>
                  <svg className="pc-chart" viewBox={`0 0 ${chartMonths.length * 20 + 10} 120`} role="img" aria-label={t("Órdenes de compra y facturación por mes", "Purchase orders and invoicing by month")}>
                    <line className="base" x1="0" x2={chartMonths.length * 20 + 10} y1="100" y2="100" />
                    {chartMonths.map((k, n) => { const oc = all.of("OC_COP", k), fa = all.of("FACT_COP", k); return (
                      <g key={k}>
                        <rect className="oc" x={5 + n * 20} width="8" y={100 - (oc / chartMax) * 92} height={(oc / chartMax) * 92}><title>{`${k} · OC ${f.m(oc)}`}</title></rect>
                        <rect className="fa" x={13 + n * 20} width="8" y={100 - (fa / chartMax) * 92} height={(fa / chartMax) * 92}><title>{`${k} · ${t("Facturación", "Invoicing")} ${f.m(fa)}`}</title></rect>
                        {(k.endsWith("-01") || n === 0) && <text className="ax" x={5 + n * 20} y="112">{k}</text>}
                      </g>
                    ); })}
                  </svg>
                  <p className="src"><span className="pc-key oc" />{t("Órdenes de compra aceptadas", "Purchase orders accepted")}<span className="pc-key fa" />{t("Facturación", "Invoicing")} · {t(`hasta ${chartMonths.length} meses completos; el más alto: ${f.m(chartMax)}`, `up to ${chartMonths.length} complete months; the highest: ${f.m(chartMax)}`)}</p>
                </>
              )}
              <details className="small" id="fuentes">
                <summary>{t("Ver las fuentes de estas cifras", "See the sources of these figures")}</summary>
                <div className="pc-scroll">
                  <table className="pc-table pc-cards">
                    <thead><tr><th>{t("Registro", "Record")}</th><th className="l">{t("Indicador", "Indicator")}</th><th>{t("Fecha", "Date")}</th><th>{t("Valor original", "Original value")}</th><th>{t("Tasa aplicada", "Rate applied")}</th><th>{t("En pesos", "In pesos")}</th></tr></thead>
                    <tbody>
                      {sources.map((x, n) => (
                        <tr key={n}>
                          <th scope="row"><Link href={x.href}>{x.text}</Link></th>
                          <td className="l" data-l={t("Indicador", "Indicator")}>{t(KPIS[x.kpi].es, KPIS[x.kpi].en)}</td>
                          <td data-l={t("Fecha", "Date")}>{i.date(x.at)}</td>
                          <td data-l={t("Valor original", "Original value")}>{x.currency ? i.money(x.orig, x.currency) : "1"}</td>
                          <td data-l={t("Tasa aplicada", "Rate applied")}>{x.rate ? <>{i.n2(x.rate)}<span className="src block">{x.rateSource ? t(x.rateSource.es, x.rateSource.en) : ""}{x.rateDay ? ` · ${x.rateDay}` : ""}</span></> : x.currency === "USD" ? <span className="pc-nobase">{t("sin tasa", "no rate")}</span> : "—"}</td>
                          <td data-l={t("En pesos", "In pesos")}>{x.currency ? (x.cop != null ? i.money(x.cop, "COP") : "—") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="src">{t("Los 80 registros más recientes de esta empresa. Cada uno abre su Necesidad, cotización, orden de compra o factura.", "The 80 most recent records of this company. Each one opens its Need, quote, purchase order or invoice.")}</p>
              </details>
            </>
          )}
        </section>
      )}

      <section className="card" id="editor">
        <b>{t(`PROPUESTA ${year}`, `PROPOSAL ${year}`)}{chosen && chosen.id !== latest?.id ? t(` · versión ${chosen.version} (anterior)`, ` · version ${chosen.version} (earlier)`) : ""}</b>
        {!editable && <p className="small muted">{!write ? t("Solo lectura: la propuesta la escribe su negociador.", "Read-only: the proposal is written by its negotiator.") : chosen?.state === "SUBMITTED" ? t("Enviada: espera la decisión del líder. Para cambiarla, retira el envío abajo.", "Submitted: it waits for the leader's decision. To change it, withdraw it below.") : chosen && chosen.id !== latest?.id ? t("Es una versión anterior: se conserva para comparar.", "This is an earlier version: it is kept to compare.") : t("Aprobada y bloqueada. Para corregirla, abre una versión nueva abajo.", "Approved and locked. To correct it, open a new version below.")}</p>}
        <Editor key={`${chosen?.id ?? "new"}-${chosen?.updatedAt.getTime() ?? 0}`} es={i.es} year={year} editable={editable} prospects={prospects} basis={{ baseYear: basis.baseYear, ocClose: basis.ocClose, factClose: basis.factClose, monthsUsed: basis.monthsUsed, seasonOc: basis.seasonOc, seasonFact: basis.seasonFact, backlog: basis.backlog, ticket: basis.ticket, convSC: basis.convSC, bateoN: basis.bateoN, bateoV: basis.bateoV, margin: basis.margin }} start={start} saved={saved}
          save={saveBudget.bind(null, year, slot, personId, false)} send={saveBudget.bind(null, year, slot, personId, true)} bad={bad} />
      </section>

      <section className="card" id="aprobacion">
        <b>{t("APROBACIÓN Y TRAZABILIDAD", "APPROVAL AND TRAIL")}</b>
        <p className="small">{t("Estado", "State")}: <StateChip i={i} state={state} /> · {approverNames.length ? (approvers.byLeader ? t(`Aprueba su líder: ${approverNames.join(", ")}.`, `Approved by their leader: ${approverNames.join(", ")}.`) : t(`${person.name} no tiene líder asignado: aprueba Gerencia o la Dirección Comercial (${approverNames.join(", ")}).`, `${person.name} has no assigned leader: Management or the Commercial Director approve (${approverNames.join(", ")}).`)) : t("Nadie puede aprobar todavía: asigna un líder en EQUIPO.", "Nobody can approve yet: assign a leader in TEAM.")}{state === "APPROVED" ? t(" Será «Vigente» cuando Gerencia o la Dirección Comercial publiquen el presupuesto del año.", " It becomes «In force» when Management or the Commercial Director publish the year's budget.") : ""}</p>

        {canDecide && (
          <div className="pc-two">
            <form action={decideBudget.bind(null, chosen!.id, true)} className="qa-form">
              <label>{t("Comentario (opcional)", "Comment (optional)")}<textarea name="note" rows={2} maxLength={1000} /></label>
              <button type="submit">{t("Aprobar presupuesto", "Approve budget")}</button>
              <span className="src block">{t("Revisa la suma anual, el crecimiento, la estacionalidad y si la persona puede ejecutarlo. Al aprobar queda bloqueado.", "Check the annual sum, the growth, the seasonality and whether the person can deliver it. Approving locks it.")}</span>
            </form>
            <form action={decideBudget.bind(null, chosen!.id, false)} className="qa-form">
              <label>{t("Qué debe revisar (obligatorio para devolver)", "What must be reviewed (required to return)")} *<textarea name="note" rows={2} maxLength={1000} required /></label>
              <button type="submit" className="secondary">{t("Devolver al negociador", "Return to the negotiator")}</button>
            </form>
          </div>
        )}
        {write && chosen?.state === "SUBMITTED" && <form action={withdrawBudget.bind(null, chosen.id)} className="pc-actions"><button type="submit" className="secondary">{t("Retirar el envío", "Withdraw the submission")}</button><span className="src">{t("Vuelve a borrador para seguir cambiándola.", "It goes back to a draft so you can keep changing it.")}</span></form>}
        {write && chosen && chosen.id === latest?.id && chosen.state === "DRAFT" && !sentBefore && <form action={discardDraft.bind(null, chosen.id)} className="pc-actions"><button type="submit" className="secondary" data-confirm={t("¿Descartar este borrador? No se puede deshacer.", "Discard this draft? This cannot be undone.")}>{t("Descartar borrador", "Discard draft")}</button></form>}
        {write && chosen && chosen.id === latest?.id && chosen.state === "APPROVED" && !chosen.supersededAt && (
          <form action={newVersion.bind(null, chosen.id)} className="qa-form" id="version" style={{ maxWidth: 620 }}>
            <label>{t("Motivo de la versión nueva (obligatorio)", "Reason for the new version (required)")} *<textarea name="reason" rows={2} maxLength={1000} required /></label>
            <button type="submit" className="secondary">{t("Abrir versión nueva", "Open a new version")}</button>
            <span className="src block">{t("La versión aprobada no cambia y sigue siendo la oficial hasta que se apruebe la nueva.", "The approved version does not change and stays official until the new one is approved.")}</span>
          </form>
        )}
        {canManageAll(user) && chosen && (
          <details className="small" id="conciliar" style={{ marginTop: 10 }}>
            <summary>{t("Pedir conciliación con el objetivo de la empresa", "Ask to reconcile with the company objective")}</summary>
            <form action={askReconcile.bind(null, chosen.id)} className="qa-form" style={{ maxWidth: 620 }}>
              <label>{t("Qué se debe conciliar", "What must be reconciled")} *<textarea name="note" rows={2} maxLength={1000} required /></label>
              <button type="submit" className="secondary">{t("Pedir conciliación", "Ask for reconciliation")}</button>
              <span className="src block">{t("No cambia ninguna meta: deja el pedido a la vista del negociador y de su líder.", "It changes no goal: it leaves the request in view of the negotiator and their leader.")}</span>
            </form>
          </details>
        )}

        {versions.length > 0 && (
          <>
            <h3>{t("Versiones", "Versions")}</h3>
            <div className="pc-scroll">
              <table className="pc-table pc-cards" id="versiones">
                <thead><tr><th>{t("Versión", "Version")}</th><th className="l">{t("Estado", "State")}</th><th>{t("OC anual", "Annual POs")}</th><th>{t("Facturación anual", "Annual invoicing")}</th><th>{t("Eságara anual", "Annual Eságara")}</th><th className="l">{t("Motivo / decisión", "Reason / decision")}</th></tr></thead>
                <tbody>
                  {versions.map((b) => { const x = matrixOf(b); return (
                    <tr key={b.id} data-v={b.version}>
                      <th scope="row"><Link href={`${self}&v=${b.version}`}>v{b.version}</Link>{b.id === chosen?.id ? t(" · en pantalla", " · on screen") : ""}</th>
                      <td className="l" data-l={t("Estado", "State")}><StateChip i={i} state={shownState(b, published)} /></td>
                      <td data-l={t("OC anual", "Annual POs")}>{f.m(sum(x.OC_COP))}</td>
                      <td data-l={t("Facturación anual", "Annual invoicing")}>{f.m(sum(x.FACT_COP))}</td>
                      <td data-l={t("Eságara anual", "Annual Eságara")}>{f.m(sum(x.ESA_COP))}</td>
                      <td className="l" data-l={t("Motivo / decisión", "Reason / decision")} style={{ whiteSpace: "normal" }}>{[b.versionReason ? `«${b.versionReason}»` : null, b.decidedByName ? `${b.state === "APPROVED" ? t("Aprobó", "Approved by") : t("Devolvió", "Returned by")} ${b.decidedByName} · ${i.day(b.decidedAt)}` : null].filter(Boolean).join(" · ") || "—"}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {chosen && chosen.events.length > 0 && (
          <>
            <h3>{t(`Lo que pasó con la versión ${chosen.version}`, `What happened to version ${chosen.version}`)}</h3>
            <ul className="pc-events">
              {chosen.events.map((e) => { const d = (e.detail ?? {}) as { before?: Record<string, number>; after?: Record<string, number> }; return (
                <li key={e.id}><b>{t(EVENT[e.kind]?.es ?? e.kind, EVENT[e.kind]?.en ?? e.kind)}</b> · {e.byName} · {i.date(e.at)}{e.note ? <> · «{e.note}»</> : null}
                  {d.after && <span className="src block">{d.before ? t(`OC ${f.m(d.before.OC_COP)} → ${f.m(d.after.OC_COP)} · Facturación ${f.m(d.before.FACT_COP)} → ${f.m(d.after.FACT_COP)} · Eságara ${f.m(d.before.ESA_COP)} → ${f.m(d.after.ESA_COP)}`, `POs ${f.m(d.before.OC_COP)} → ${f.m(d.after.OC_COP)} · Invoicing ${f.m(d.before.FACT_COP)} → ${f.m(d.after.FACT_COP)} · Eságara ${f.m(d.before.ESA_COP)} → ${f.m(d.after.ESA_COP)}`) : t(`OC ${f.m(d.after.OC_COP)} · Facturación ${f.m(d.after.FACT_COP)} · Eságara ${f.m(d.after.ESA_COP)}`, `POs ${f.m(d.after.OC_COP)} · Invoicing ${f.m(d.after.FACT_COP)} · Eságara ${f.m(d.after.ESA_COP)}`)}</span>}
                </li>
              ); })}
            </ul>
          </>
        )}
        {!chosen && <p className="small muted">{t("Sin iniciar: al guardar el primer borrador empieza la trazabilidad.", "Not started: the trail begins when the first draft is saved.")}</p>}
      </section>
    </>
  );
}
