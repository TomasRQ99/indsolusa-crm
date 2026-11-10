import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { prView } from "@/lib/pr";
import { PURPOSES, exposureOf, lineSplit, prTotals } from "@/lib/pr-rules";
import { decideApproval, requestApproval, saveHeader, setAllocation, setLineQty } from "../actions";
import { fullReadiness } from "@/lib/pr-auth";
import { REASON_TEXT, canApprovePurchase } from "@/lib/purchase-auth";

// Operaciones O1 · one Purchase Requirement: bought vs assigned per Journey, what is left as inventory exposure,
// the readiness reading with each blocker's way out, and the stock authorization.

export default async function PrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const v = await prView(id);
  if (!v) notFound();
  const { pr } = v;
  const F = await fullReadiness(pr);
  const r = F.readiness;
  const C = F.last?.status === "REQUESTED" ? (F.last.context as unknown as typeof F.auth.context) : F.auth.context;
  const canDecide = !!F.last && canApprovePurchase(user, F.last, F.policy.value);
  const [spo, deals, suppliers] = await Promise.all([
    pr.supplierPoId ? db.supplierPO.findUnique({ where: { id: pr.supplierPoId }, select: { id: true, code: true, releasedAt: true, version: true } }) : null,
    db.deal.findMany({ where: { poAcceptedAt: { not: null }, resultAchievedAt: null, stage: { not: "LOST" } }, orderBy: { poAcceptedAt: "desc" }, take: 80, select: { id: true, code: true, title: true, account: { select: { name: true } } } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const locked = !!spo?.releasedAt || !!pr.cancelledAt;
  const tot = prTotals(pr.lines);
  const ex = exposureOf(pr);
  const money = (n: unknown) => `${pr.currency} ${i.n2(n)}`;
  const res = { READY_TO_PURCHASE: [t("Listo para comprar", "Ready to purchase"), "ok"], READY_WITH_APPROVED_EXCEPTION: [t("Listo, con autorización", "Ready, with authorization"), "ok"], NEEDS_RESOLUTION: [t("Falta resolver", "Needs resolution"), "attn"] } as const;
  const okMsg: Record<string, string> = {
    creado: t("Requerimiento creado.", "Requirement created."), guardado: t("Guardado.", "Saved."), cantidad: t("Cantidad actualizada (también en la orden en borrador).", "Quantity updated (also on the draft order)."),
    asignacion: t("Asignación actualizada.", "Assignment updated."), pedida: t("Autorización pedida. La decide otra persona.", "Authorization requested. Someone else decides it."), "ya-pedida": t("Ya estaba pedida.", "It was already requested."), aprobada: t("Compra autorizada por el valor y las unidades mostradas.", "Purchase authorized for the value and units shown."), devuelta: t("Devuelta con tu pregunta.", "Returned with your question."), rechazada: t("Compra no autorizada.", "Purchase not authorized."), escalada: t("Enviada a Gerencia.", "Sent to Management."),
    "stock-aprobado": t("Stock autorizado por la cantidad y el valor mostrados.", "Stock authorized for the quantity and value shown."), "stock-rechazado": t("Stock no autorizado.", "Stock not authorized."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("No tienes permiso sobre este requerimiento.", "You don't have permission on this requirement."),
    liberada: t("La orden al proveedor ya fue liberada: un cambio se hace con una nueva versión de la orden.", "The supplier order was already released: a change is made with a new version of the order."),
    cantidad: t("La cantidad debe ser mayor que cero.", "The quantity must be above zero."),
    asignacion: t("Elige un Journey con PO del cliente aceptada y una cantidad.", "Choose a Journey with an accepted customer PO and a quantity."),
    "sin-motivo": t("Esta compra es de rutina: no necesita autorización.", "This purchase is routine: it needs no authorization."),
    justificacion: t("Escribe por qué conviene este stock.", "Write why this stock makes sense."),
    autoridad: t("No puedes decidir esta autorización: no es de tu nivel, o la pediste tú.", "You can't decide this authorization: it isn't at your level, or you requested it."),
    estado: t("Ya no está esperando decisión.", "It's no longer awaiting a decision."), nota: t("Para no autorizar, escribe el motivo.", "To decline, write the reason."),
  };

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/compras/requerimientos">{t("Requerimientos de compra", "Purchase requirements")}</Link>{pr.deal && <> · <Link href={`/deals/${pr.deal.id}`}>{pr.deal.code ?? pr.deal.title}</Link> · {pr.deal.account.name}</>}</p>
          <span className="grow" />
          <span className={`sig ${res[r.result][1]}`}>{res[r.result][0]}</span>
        </div>
        <div className="jh-title"><h1>{pr.code}</h1></div>
        <p className="jh-sub">{t(PURPOSES[pr.purpose]?.es ?? pr.purpose, PURPOSES[pr.purpose]?.en ?? pr.purpose)} · {pr.supplier?.name ?? t("sin proveedor", "no supplier")} · {t("pidió", "requested by")} {pr.requester.name}{pr.neededBy ? ` · ${t("para", "by")} ${i.day(pr.neededBy)}` : ""}{spo && <> · <Link href={`/compras/${spo.id}`}>{spo.code} v{spo.version}</Link>{spo.releasedAt ? t(" liberada", " released") : t(" en borrador", " draft")}</>}</p>
      </header>

      <section className="jblock" id="lectura">
        <div className="jbh"><b>{t("¿SE PUEDE COMPRAR?", "CAN IT BE PURCHASED?")}</b></div>
        {r.blockers.length === 0 ? <p className="small">{t("Sí: propósito, producto, cantidades, proveedor y autorización están en orden.", "Yes: purpose, product, quantities, supplier and authorization are in order.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Qué falta", "What's missing")}</th><th>{t("Impacto", "Impact")}</th><th>{t("Cómo se resuelve", "How to resolve")}</th><th>{t("Quién", "Who")}</th><th>{t("Evidencia", "Evidence")}</th></tr></thead>
            <tbody>{r.blockers.map((b) => <tr key={b.key}><td><b>{t(b.blocker.es, b.blocker.en)}</b></td><td className="small">{t(b.impact.es, b.impact.en)}</td><td className="small">{t(b.path.es, b.path.en)}</td><td className="small">{t(b.owner.es, b.owner.en)}</td><td className="small muted">{t(b.evidence.es, b.evidence.en)}</td></tr>)}</tbody>
          </table></div>
        )}
        {r.notes.map((n, k) => <p key={k} className="note attn">{t(n.es, n.en)}</p>)}
      </section>

      <section className="jblock" id="lineas">
        <div className="jbh"><b>{t("QUÉ SE COMPRA Y PARA QUIÉN", "WHAT IS BOUGHT AND FOR WHOM")}</b><span className="grow" /><span className="src">{t(`Total previsto ${money(tot.total)}`, `Expected total ${money(tot.total)}`)}</span></div>
        {pr.lines.map((l) => {
          const s = lineSplit(l);
          return (
            <article key={l.id} className="exc-item">
              <header className="exc-head"><b>{l.code ?? l.description}</b>{l.code && <span className="small"> · {l.description}</span>}<span className="grow" /><span className="mono small">{money(l.expectedUnitCost)} {t("c/u", "each")}</span></header>
              <div className="goal-grid">
                <div className="goal-card"><span className="small muted">{t("Se compra", "Bought")}</span><b className="tv">{l.qty}</b></div>
                <div className="goal-card"><span className="small muted">{t("Asignado a Journeys", "Assigned to Journeys")}</span><b className="tv">{s.allocated}</b></div>
                <div className="goal-card"><span className="small muted">{s.over > 0 ? t("Asignado de más", "Over-assigned") : t("Sin asignar (inventario)", "Unassigned (inventory)")}</span><b className={`tv${s.over > 0 || s.unallocated > 0 ? " risk-t" : ""}`}>{s.over > 0 ? s.over : s.unallocated}</b></div>
              </div>
              {l.allocations.length > 0 && <ul className="mk-ul small">{l.allocations.map((a) => <li key={a.id}><b>{a.qty}</b> → <Link href={`/deals/${a.deal.id}`}>{a.deal.code ?? a.deal.title}</Link> · {a.deal.account.name}</li>)}</ul>}
              {!locked && (
                <div className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                  <form action={setLineQty.bind(null, l.id)} className="qa-row" style={{ flex: "0 0 auto" }}>
                    <label>{t("Cantidad a comprar", "Quantity to buy")}<input name="qty" type="number" min={1} defaultValue={l.qty} style={{ width: 90 }} /></label>
                    <button type="submit" className="secondary">{t("Cambiar", "Change")}</button>
                  </form>
                  <form action={setAllocation.bind(null, l.id)} className="qa-row" style={{ flex: "1 1 320px" }}>
                    <label style={{ flex: "1 1 200px" }}>{t("Asignar a un Journey", "Assign to a Journey")}<select name="dealId" defaultValue=""><option value="" disabled>{t("Elige…", "Choose…")}</option>{deals.map((d) => <option key={d.id} value={d.id}>{d.code ?? d.title} · {d.account.name}</option>)}</select></label>
                    <label style={{ flex: "0 0 90px" }}>{t("Unidades", "Units")}<input name="qty" type="number" min={0} defaultValue={s.unallocated || ""} /></label>
                    <button type="submit" className="secondary">{t("Asignar", "Assign")}</button>
                  </form>
                </div>
              )}
            </article>
          );
        })}
        {!locked && <p className="src">{t("Para quitar una asignación, asigna 0 unidades a ese Journey. Solo se asigna a Journeys con PO del cliente aceptada.", "To remove an assignment, assign 0 units to that Journey. Units are assigned only to Journeys with an accepted customer PO.")}</p>}
      </section>

      {(F.auth.reasons.length > 0 || F.last) && (
        <section className="jblock" id="autorizacion">
          <div className="jbh"><b>{t("AUTORIZACIÓN DE LA COMPRA", "PURCHASE AUTHORIZATION")}</b><span className="grow" />{F.covered ? <span className="sig ok">{t("Autorizada", "Authorized")}</span> : F.last?.status === "REQUESTED" ? <span className="sig attn">{t(`Esperando · nivel ${F.last.level}`, `Awaiting · level ${F.last.level}`)}</span> : F.last?.status === "RETURNED" ? <span className="sig attn">{t("Devuelta", "Returned")}</span> : F.last?.status === "REJECTED" ? <span className="sig risk">{t("No autorizada", "Not authorized")}</span> : F.auth.reasons.length > 0 ? <span className="sig wait">{t("Sin pedir", "Not requested")}</span> : null}</div>
          {F.auth.reasons.length === 0 ? <p className="small muted">{t("Hoy esta compra ya no necesita autorización.", "This purchase no longer needs authorization.")}</p> : (
            <>
              <p className="small"><b>{t("Por qué no es de rutina", "Why it isn't routine")}:</b></p>
              <ul className="mk-ul small">{F.auth.reasons.map((x) => <li key={x}>{t(REASON_TEXT[x].es, REASON_TEXT[x].en)}{x === "STOCK" ? ` · ${ex.qty} ${t("unidades", "units")} · ${money(ex.amount)}` : x === "COST_ABOVE_PROTECTED" ? ` · +${money(F.auth.facts.costOver)}` : ""}</li>)}</ul>
              <p className="src">{t(`Compromiso relacionado ${money(C.purchase.relatedTotal)}${C.purchase.relatedCodes.length ? ` (con ${C.purchase.relatedCodes.join(", ")})` : ""} · límite de nivel 1 USD ${i.n2(F.policy.value.level1LimitUsd)} · decide ${F.auth.level === 2 ? "Gerencia" : "Finanzas, Administración o Gerencia"} · política v${F.policy.version}`, `Related commitment ${money(C.purchase.relatedTotal)}${C.purchase.relatedCodes.length ? ` (with ${C.purchase.relatedCodes.join(", ")})` : ""} · level-1 limit USD ${i.n2(F.policy.value.level1LimitUsd)} · decided by ${F.auth.level === 2 ? "Management" : "Finance, Administration or Management"} · policy v${F.policy.version}`)}</p>
            </>
          )}
          <div className="exc-grid">
            {C.customer && (
              <dl className="qv-dl tight">
                <dt>{t("Cliente", "Customer")}</dt><dd>{C.customer.name}</dd>
                <dt>{t("Venta", "Sale")}</dt><dd className="mono">{C.customer.sale != null ? `USD ${i.n2(C.customer.sale)}` : "—"}</dd>
                <dt>Eságara</dt><dd className="mono">{C.customer.esagara != null ? <><b>USD {i.n2(C.customer.esagara)}</b> · {i.pct(C.customer.pct)}</> : "—"}{C.customer.costOver > 0 && <span className="risk-t block">{t(`bajaría USD ${i.n2(C.customer.costOver)} con este costo`, `would drop USD ${i.n2(C.customer.costOver)} at this cost`)}</span>}</dd>
                <dt>{t("Cupo", "Credit limit")}</dt><dd className="mono">{C.customer.creditLimit != null ? `USD ${i.n2(C.customer.creditLimit)}` : t("Sin cupo definido", "No limit set")}</dd>
                <dt>{t("Cartera abierta", "Open receivables")}</dt><dd className="mono">USD {i.n2(C.customer.openAR)}{C.customer.overdue > 0 && <span className="risk-t"> · {t(`${i.n2(C.customer.overdue)} vencida`, `${i.n2(C.customer.overdue)} overdue`)}</span>}</dd>
                <dt>{t("Ganado sin facturar", "Won, not invoiced")}</dt><dd className="mono">USD {i.n2(C.customer.committed)}</dd>
              </dl>
            )}
            <dl className="qv-dl tight">
              <dt>{t("Proveedor", "Supplier")}</dt><dd>{C.supplier ? <>{C.supplier.name} · {C.supplier.received === 0 ? <span className="risk-t">{t("nuevo", "new")}</span> : t(`${C.supplier.received} compras recibidas`, `${C.supplier.received} purchases received`)}</> : "—"}</dd>
              {C.supplier && <><dt>{t("Condición de pago", "Payment terms")}</dt><dd>{C.supplier.terms ?? "—"}{C.supplier.advancePct != null ? ` · ${t("anticipo", "advance")} ${C.supplier.advancePct} %` : ""}</dd>
              <dt>{t("Ya abierto con él", "Already open with them")}</dt><dd className="mono">USD {i.n2(C.supplier.openPos)}{C.supplier.advanced > 0 && ` · ${t("anticipado", "advanced")} ${i.n2(C.supplier.advanced)}`}</dd></>}
              <dt>{t("Esta compra", "This purchase")}</dt><dd className="mono">{money(C.purchase.total)}{C.purchase.stockQty > 0 && <span className="block">{t(`${C.purchase.stockQty} unidades a inventario · ${money(C.purchase.stockAmount)}`, `${C.purchase.stockQty} units to inventory · ${money(C.purchase.stockAmount)}`)}</span>}</dd>
              <dt>{t("Caja, próximos 14 días", "Cash, next 14 days")}</dt><dd className="mono small">{t(`pagos a proveedores USD ${i.n2(C.cash.upcomingPayments)} · cobros que vencen USD ${i.n2(C.cash.expectedCollections)}`, `supplier payments USD ${i.n2(C.cash.upcomingPayments)} · collections falling due USD ${i.n2(C.cash.expectedCollections)}`)}</dd>
            </dl>
          </div>
          <p className="src">{t("Si algo sale mal", "If something goes wrong")}: {[C.purchase.stockQty > 0 ? t(`quedarían ${C.purchase.stockQty} unidades sin venta`, `${C.purchase.stockQty} units would remain unsold`) : null, C.customer ? t("si el cliente paga tarde o cancela, la empresa ya habrá comprometido esta compra", "if the customer pays late or cancels, the company will already have committed this purchase") : null, C.supplier?.advancePct ? t(`si el proveedor se demora, el anticipo (${C.supplier.advancePct} %) ya estará pagado`, `if the supplier is late, the advance (${C.supplier.advancePct} %) will already be paid`) : null].filter(Boolean).join("; ")}. {t("SOLU no conoce los saldos bancarios: la caja muestra solo lo registrado aquí.", "SOLU doesn't know bank balances: cash shows only what is recorded here.")}</p>
          {F.last && <p className="small">{t(`Pidió ${F.last.requestedByName} el ${i.day(F.last.requestedAt)}`, `Requested by ${F.last.requestedByName} on ${i.day(F.last.requestedAt)}`)}{F.last.requestNote ? ` · «${F.last.requestNote}»` : ""}{F.last.escalatedByName ? t(` · escalada por ${F.last.escalatedByName}`, ` · escalated by ${F.last.escalatedByName}`) : ""}{F.last.decidedAt ? ` · ${F.last.status === "APPROVED" ? t("autorizó", "authorized by") : F.last.status === "RETURNED" ? t("devolvió", "returned by") : t("no autorizó", "declined by")} ${F.last.decidedByName} ${i.day(F.last.decidedAt)}${F.last.decisionNote ? ` «${F.last.decisionNote}»` : ""} · ${t("política", "policy")} v${F.last.policyVersion}` : ""}</p>}
          {F.auth.reasons.length > 0 && !F.covered && F.last?.status !== "REQUESTED" && !pr.cancelledAt && (
            <form action={requestApproval.bind(null, pr.id)} className="qa-form" style={{ maxWidth: 620 }}>
              <label>{t("Contexto para quien autoriza (obligatorio si queda inventario)", "Context for the approver (required when inventory remains)")}<textarea name="note" rows={2} maxLength={500} defaultValue={pr.justification ?? ""} placeholder={t("Ej.: el proveedor solo vende en cajas de 5", "E.g.: the supplier only sells in boxes of 5")} /></label>
              <button type="submit">{t("Pedir autorización", "Request authorization")}</button>
            </form>
          )}
          {F.last?.status === "REQUESTED" && (canDecide ? (
            <form action={decideApproval.bind(null, F.last.id)} className="qa-form exc-decide" style={{ maxWidth: 680 }}>
              <label>{t("Nota (obligatoria para devolver o no autorizar)", "Note (required to return or decline)")}<textarea name="note" rows={2} maxLength={500} /></label>
              <div className="qa-row" style={{ flexWrap: "wrap" }}>
                <button type="submit" name="action" value="APPROVE">{t("Autorizar", "Approve")}</button>
                <button type="submit" name="action" value="RETURN" className="secondary">{t("Devolver con pregunta", "Return with a question")}</button>
                <button type="submit" name="action" value="REJECT" className="secondary">{t("No autorizar", "Decline")}</button>
                {F.last.level === 1 && <button type="submit" name="action" value="ESCALATE" className="secondary">{t("Escalar a Gerencia", "Escalate to Management")}</button>}
              </div>
            </form>
          ) : <p className="src">{user.id === F.last.requestedById ? t("La pediste tú: la decide otra persona.", "You requested it: someone else decides it.") : t(`La decide ${F.last.level === 2 ? "Gerencia" : "Finanzas, Administración o Gerencia"}.`, `Decided by ${F.last.level === 2 ? "Management" : "Finance, Administration or Management"}.`)}</p>)}
        </section>
      )}
      {!locked && (
        <section className="jblock">
          <div className="jbh"><b>{t("DATOS DEL REQUERIMIENTO", "REQUIREMENT DETAILS")}</b></div>
          <form action={saveHeader.bind(null, pr.id)} className="qa-form" style={{ maxWidth: 620 }}>
            {!pr.supplierPoId && <label>{t("Proveedor", "Supplier")}<select name="supplierId" defaultValue={pr.supplierId ?? ""}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
            <label>{t("Justificación", "Justification")}<textarea name="justification" rows={2} maxLength={500} defaultValue={pr.justification ?? ""} /></label>
            <label>{t("Próximo paso", "Next step")}<input name="nextMove" maxLength={300} defaultValue={pr.nextMove ?? ""} /></label>
            <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
          </form>
          {pr.purpose === "INVENTORY" && <p className="src">{t("La orden al proveedor de una compra solo para stock llega con la etapa de inventario; por ahora queda pedida y autorizada aquí.", "The supplier order for a stock-only purchase arrives with the inventory stage; for now it is requested and authorized here.")}</p>}
        </section>
      )}
    </div>
  );
}
