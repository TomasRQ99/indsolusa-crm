import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { VISIT_STATUS } from "@/lib/visits";
import { BUDGET_STATUS, EXPENSES_STATUS, EXPENSE_CATS, canDecideBudget, canEditExpenses, canReconcile, canRequestBudget, travelSummary } from "@/lib/travel-rules";
import { ShrinkFileInput } from "@/components/ShrinkFileInput";
import { addExpense, decideBudget, reconcileExpenses, removeExpense, requestBudget, submitExpenses } from "../actions";

// Comercial C8e · one mission: its visits, the travel budget (asked → decided by someone else) and the expenses
// (listed with receipts → checked against the budget by Finanzas or Gerencia). Interim rules until Module 14.

export default async function MissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const m = await db.commercialMission.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, role: true } },
      visits: { orderBy: { plannedAt: "asc" }, select: { id: true, status: true, plannedAt: true, account: { select: { name: true } } } },
      expenses: { orderBy: [{ spentOn: "asc" }, { createdAt: "asc" }], select: { id: true, spentOn: true, category: true, description: true, amount: true, originalNote: true, receiptName: true, noReceiptReason: true } },
    },
  });
  if (!m) notFound();
  const who = { ownerId: m.ownerId, ownerRole: m.owner.role };
  const mine = canEdit(user, m.ownerId);
  const decider = canDecideBudget(user, who);
  const checker = canReconcile(user, who);
  if (!mine && !decider && !checker) notFound();
  const editExp = mine && canEditExpenses(m);
  const s = travelSummary(m.budgetApproved, m.expenses.map((e) => ({ amount: e.amount, category: e.category, hasReceipt: !!e.receiptName })));
  const money = (v: unknown) => i.money2(v);
  const bs = BUDGET_STATUS[m.budgetStatus] ?? BUDGET_STATUS.NOT_REQUESTED;
  const es = EXPENSES_STATUS[m.expensesStatus] ?? EXPENSES_STATUS.OPEN;
  const lang = i.es ? "ES" : "EN";

  const okMsg: Record<string, string> = {
    pedido: t("Presupuesto pedido. Lo decide Gerencia.", "Budget requested. Management decides it."), creada: t("Misión creada.", "Mission created."),
    aprobado: t("Presupuesto aprobado.", "Budget approved."), rechazado: t("Presupuesto rechazado.", "Budget rejected."),
    gasto: t("Gasto agregado.", "Expense added."), "gasto-quitado": t("Gasto quitado.", "Expense removed."),
    enviado: t("Gastos enviados a revisión. Los revisa Finanzas o Gerencia.", "Expenses sent for review. Finance or Management checks them."),
    devuelto: t("Gastos devueltos con tu pregunta.", "Expenses returned with your question."), legalizado: t("Gastos legalizados.", "Expenses reconciled."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Solo quien viaja o la dirección cambian esta misión.", "Only the traveller or management change this mission."),
    autoridad: t("Esta decisión no es tuya: nadie aprueba su propio viaje ni revisa sus propios gastos.", "This decision isn't yours: nobody approves their own trip or checks their own expenses."),
    estado: t("Ya no está en un estado que permita ese paso.", "It's no longer in a state that allows that step."),
    monto: t("Indica un monto mayor que cero.", "Give an amount above zero."),
    nota: t("Escribe el motivo: quien viaja necesita entenderlo.", "Write the reason: the traveller needs to understand it."),
    "nota-monto": t("Vas a aprobar un monto distinto al pedido: escribe por qué.", "You're approving a different amount than requested: write why."),
    "nota-exceso": t("Hay gasto por encima del presupuesto o sin soporte: escribe por qué se acepta.", "There's spending over budget or without a receipt: write why it's accepted."),
    "gastos-estado": t("Los gastos se cargan con el presupuesto aprobado y antes de enviarlos a revisión.", "Expenses are entered once the budget is approved and before sending them for review."),
    gasto: t("Cada gasto necesita fecha, tipo, descripción y monto.", "Each expense needs a date, type, description and amount."),
    soporte: t("Adjunta el soporte, o escribe por qué no lo hay.", "Attach the receipt, or write why there isn't one."),
    "soporte-tipo": t("El soporte debe ser foto (JPG, PNG, WEBP) o PDF de hasta 5 MB.", "The receipt must be a photo (JPG, PNG, WEBP) or PDF up to 5 MB."),
    "sin-gastos": t("Agrega al menos un gasto antes de enviar.", "Add at least one expense before sending."),
    cargaste: t("Tú cargaste alguno de estos gastos: los debe revisar otra persona de Finanzas o Gerencia.", "You entered some of these expenses: another person from Finance or Management must check them."),
    muchos: t("Esta misión ya tiene el máximo de gastos.", "This mission already has the maximum number of expenses."),
  };

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/visitas#misiones">{t("Visitas y misiones", "Visits and missions")}</Link></p>
          <span className="grow" />
          <span className={`sig ${bs.tone}`}>{t(bs.es, bs.en)}</span>
          {m.budgetStatus === "APPROVED" && <span className={`sig ${es.tone}`}>{t(es.es, es.en)}</span>}
        </div>
        <div className="jh-title"><h1>{m.title}</h1></div>
        <p className="jh-sub">{m.destination} · {i.day(m.startDate)} – {i.date(m.endDate)} · {m.owner.name}</p>
      </header>

      <section className="jblock">
        <div className="jbh"><b>{t("PARA QUÉ ES EL VIAJE", "WHAT THE TRIP IS FOR")}</b></div>
        <p className="pre">{m.purpose}</p>
        {m.travelNote && <p className="small muted">{m.travelNote}</p>}
        <p className="small">{m.visits.length === 0 ? t("Aún sin visitas: al planear una visita, elige esta misión.", "No visits yet: when planning a visit, choose this mission.") : m.visits.map((v, k) => <span key={v.id}>{k > 0 && " · "}<Link href={`/visitas/${v.id}`}>{v.account.name}</Link> <span className="muted">({t(VISIT_STATUS[v.status].es, VISIT_STATUS[v.status].en).toLowerCase()}{v.plannedAt ? `, ${i.day(v.plannedAt)}` : ""})</span></span>)}</p>
      </section>

      <section className="jblock" id="presupuesto">
        <div className="jbh"><b>{t("PRESUPUESTO DE VIAJE", "TRAVEL BUDGET")}</b><span className="grow" /><span className="src">{t("Lo aprueba Gerencia, nunca quien viaja", "Approved by Management, never by the traveller")}</span></div>
        <dl className="qv-dl tight">
          <dt>{t("Pedido", "Requested")}</dt><dd className="mono">{m.budgetAmount != null ? money(m.budgetAmount) : "—"}{m.budgetRequestedAt && <span className="muted"> · {i.day(m.budgetRequestedAt)}</span>}</dd>
          {m.budgetStatus === "APPROVED" && <><dt>{t("Aprobado", "Approved")}</dt><dd className="mono"><b>{money(m.budgetApproved)}</b><span className="muted"> · {m.budgetDecidedByName} · {i.day(m.budgetDecidedAt)}</span></dd></>}
          {m.budgetStatus === "REJECTED" && <><dt>{t("Rechazado", "Rejected")}</dt><dd><span className="muted">{m.budgetDecidedByName} · {i.day(m.budgetDecidedAt)}</span></dd></>}
          {m.budgetNote && <><dt>{m.budgetStatus === "REQUESTED" ? t("Justificación", "Justification") : t("Nota", "Note")}</dt><dd>«{m.budgetNote}»</dd></>}
        </dl>
        {mine && canRequestBudget(m.budgetStatus) && (
          <form action={requestBudget.bind(null, m.id)} className="qa-form" style={{ maxWidth: 520 }}>
            <label>{t("Monto estimado (USD)", "Estimated amount (USD)")}<input name="budgetAmount" type="number" min={0} step="0.01" required defaultValue={m.budgetAmount != null ? Number(m.budgetAmount) : ""} /></label>
            <label>{t("En qué se va a gastar", "What it will be spent on")}<input name="budgetNote" maxLength={500} placeholder={t("Ej.: vuelo, 2 noches de hotel, taxis", "E.g.: flight, 2 hotel nights, taxis")} /></label>
            <button type="submit">{m.budgetStatus === "REJECTED" ? t("Volver a pedir presupuesto", "Request the budget again") : t("Pedir presupuesto", "Request budget")}</button>
          </form>
        )}
        {m.budgetStatus === "REQUESTED" && (decider ? (
          <form action={decideBudget.bind(null, m.id)} className="qa-form exc-decide" style={{ maxWidth: 620 }}>
            <label>{t("Monto a aprobar (USD)", "Amount to approve (USD)")}<input name="approved" type="number" min={0} step="0.01" defaultValue={m.budgetAmount != null ? Number(m.budgetAmount) : ""} /></label>
            <label>{t("Nota (obligatoria para rechazar o cambiar el monto)", "Note (required to reject or change the amount)")}<textarea name="note" rows={2} maxLength={500} /></label>
            <div className="qa-row">
              <button type="submit" name="action" value="APPROVE">{t("Aprobar presupuesto", "Approve budget")}</button>
              <button type="submit" name="action" value="REJECT" className="secondary">{t("Rechazar", "Reject")}</button>
            </div>
          </form>
        ) : <p className="src">{mine ? t("Esperando la decisión de Gerencia (otra persona).", "Waiting for Management's decision (someone else).") : t("La decide Gerencia.", "Management decides it.")}</p>)}
      </section>

      {m.budgetStatus === "APPROVED" && (
        <section className="jblock" id="gastos">
          <div className="jbh"><b>{t("GASTOS DEL VIAJE", "TRIP EXPENSES")}</b><span className="grow" /><span className="src">{t("Los revisa Finanzas o Gerencia, nunca quien viaja", "Checked by Finance or Management, never by the traveller")}</span></div>
          <div className="goal-grid">
            <div className="goal-card"><span className="small muted">{t("Aprobado", "Approved")}</span><b className="tv">{money(s.budget)}</b></div>
            <div className="goal-card"><span className="small muted">{t("Gastado", "Spent")}</span><b className="tv">{money(s.spent)}</b><span className="small">{i.pct(s.usedPct)} {t("del presupuesto", "of budget")}</span></div>
            <div className="goal-card"><span className="small muted">{s.over ? t("Por encima del presupuesto", "Over budget") : t("Queda", "Left")}</span><b className={`tv${s.over ? " risk-t" : ""}`}>{money(Math.abs(s.diff ?? 0))}</b>{s.withoutReceipt > 0 && <span className="small risk-t">{t(`${s.withoutReceipt} sin soporte · ${money(s.withoutReceiptAmount)}`, `${s.withoutReceipt} without receipt · ${money(s.withoutReceiptAmount)}`)}</span>}</div>
          </div>
          {m.expenses.length === 0 ? <p className="quiet-p">{t("Aún no hay gastos. Agrégalos durante el viaje, con la foto del soporte.", "No expenses yet. Add them during the trip, with a photo of the receipt.")}</p> : (
            <div className="tscroll"><table>
              <thead><tr><th>{t("Fecha", "Date")}</th><th>{t("Tipo", "Type")}</th><th>{t("Descripción", "Description")}</th><th className="n">USD</th><th>{t("Soporte", "Receipt")}</th>{editExp && <th />}</tr></thead>
              <tbody>{m.expenses.map((e) => (
                <tr key={e.id}>
                  <td className="mono small">{i.day(e.spentOn)}</td>
                  <td className="small">{t(EXPENSE_CATS[e.category]?.es ?? e.category, EXPENSE_CATS[e.category]?.en ?? e.category)}</td>
                  <td>{e.description}{e.originalNote && <span className="muted small"> · {e.originalNote}</span>}</td>
                  <td className="n mono">{i.n2(e.amount)}</td>
                  <td className="small">{e.receiptName ? <a href={`/visitas/soporte/${e.id}`} target="_blank" rel="noreferrer">{t("Ver soporte", "View receipt")}</a> : <span className="risk-t">{t("Sin soporte", "No receipt")}: {e.noReceiptReason}</span>}</td>
                  {editExp && <td><form action={removeExpense.bind(null, e.id)}><button type="submit" className="linkish">{t("Quitar", "Remove")}</button></form></td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {m.reconcileNote && <p className="small"><b>{m.expensesStatus === "RETURNED" ? t("Pregunta de quien revisa", "Reviewer's question") : t("Nota de la revisión", "Review note")}:</b> «{m.reconcileNote}» · {m.reconciledByName}{m.reconciledAt ? ` · ${i.day(m.reconciledAt)}` : ""}</p>}

          {editExp && (
            <>
              <details className="qa" open={m.expenses.length === 0 || ["gasto", "soporte", "soporte-tipo"].includes(sp.err ?? "")} style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Agregar gasto", "+ Add expense")}</summary>
                <form action={addExpense.bind(null, m.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 620 }}>
                  <div className="qa-row">
                    <label>{t("Fecha", "Date")}<input name="spentOn" type="date" required defaultValue={dayInput(today())} /></label>
                    <label>{t("Tipo", "Type")}<select name="category" defaultValue="TRANSPORT">{Object.entries(EXPENSE_CATS).map(([k, c]) => <option key={k} value={k}>{t(c.es, c.en)}</option>)}</select></label>
                  </div>
                  <label>{t("Descripción", "Description")}<input name="description" required maxLength={200} placeholder={t("Ej.: taxi aeropuerto – planta", "E.g.: taxi airport – plant")} /></label>
                  <div className="qa-row">
                    <label>{t("Monto en USD", "Amount in USD")}<input name="amount" type="number" min={0} step="0.01" required /></label>
                    <label>{t("Monto original (opcional)", "Original amount (optional)")}<input name="originalNote" maxLength={80} placeholder="COP 180.000" /></label>
                  </div>
                  <label>{t("Soporte (foto o PDF)", "Receipt (photo or PDF)")}<ShrinkFileInput name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf" lang={lang} /></label>
                  <label>{t("Si no hay soporte, por qué", "If there's no receipt, why")}<input name="noReceiptReason" maxLength={200} /></label>
                  <button type="submit">{t("Agregar gasto", "Add expense")}</button>
                </form>
              </details>
              {m.expenses.length > 0 && <form action={submitExpenses.bind(null, m.id)} style={{ marginTop: 10 }}><button type="submit">{m.expensesStatus === "RETURNED" ? t("Volver a enviar a revisión", "Send for review again") : t("Enviar gastos a revisión", "Send expenses for review")}</button><span className="src block">{t("Después de enviar ya no se pueden cambiar, salvo que te los devuelvan.", "After sending they can't be changed, unless they're returned to you.")}</span></form>}
            </>
          )}
          {m.expensesStatus === "SUBMITTED" && (checker ? (
            <form action={reconcileExpenses.bind(null, m.id)} className="qa-form exc-decide" style={{ maxWidth: 620, marginTop: 10 }}>
              {(s.over || s.withoutReceipt > 0) && <p className="qv-alert">{s.over ? t(`El gasto supera el presupuesto en ${money(Math.abs(s.diff ?? 0))}. `, `Spending is over budget by ${money(Math.abs(s.diff ?? 0))}. `) : ""}{s.withoutReceipt > 0 ? t(`${s.withoutReceipt} gasto(s) sin soporte por ${money(s.withoutReceiptAmount)}. `, `${s.withoutReceipt} expense(s) without receipt for ${money(s.withoutReceiptAmount)}. `) : ""}{t("Para legalizar así, escribe por qué se acepta.", "To reconcile as is, write why it's accepted.")}</p>}
              <label>{t("Nota (obligatoria para devolver, o si hay exceso o falta soporte)", "Note (required to return, or when over budget or a receipt is missing)")}<textarea name="note" rows={2} maxLength={500} /></label>
              <div className="qa-row">
                <button type="submit" name="action" value="RECONCILE">{t("Legalizar gastos", "Reconcile expenses")}</button>
                <button type="submit" name="action" value="RETURN" className="secondary">{t("Devolver con pregunta", "Return with a question")}</button>
              </div>
            </form>
          ) : <p className="src" style={{ marginTop: 8 }}>{t("En revisión por Finanzas o Gerencia.", "Under review by Finance or Management.")}</p>)}
        </section>
      )}
      <p className="src">{t("Reglas provisionales de viaje (travel-v1), hasta que llegue el documento oficial de Administración (Módulo 14). Los montos van en USD.", "Interim travel rules (travel-v1), until the official Administration document (Module 14) arrives. Amounts are in USD.")}</p>
    </div>
  );
}
