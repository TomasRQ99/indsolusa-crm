import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { prView } from "@/lib/pr";
import { PURPOSES, STOCK_STATUS, canDecideStock, exposureOf, lineSplit, prTotals } from "@/lib/pr-rules";
import { decideStock, requestStock, saveHeader, setAllocation, setLineQty } from "../actions";

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
  const { pr, readiness: r } = v;
  const [spo, deals, suppliers] = await Promise.all([
    pr.supplierPoId ? db.supplierPO.findUnique({ where: { id: pr.supplierPoId }, select: { id: true, code: true, releasedAt: true, version: true } }) : null,
    db.deal.findMany({ where: { poAcceptedAt: { not: null }, resultAchievedAt: null, stage: { not: "LOST" } }, orderBy: { poAcceptedAt: "desc" }, take: 80, select: { id: true, code: true, title: true, account: { select: { name: true } } } }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const locked = !!spo?.releasedAt || !!pr.cancelledAt;
  const tot = prTotals(pr.lines);
  const ex = exposureOf(pr);
  const decider = canDecideStock(user, pr);
  const money = (n: unknown) => `${pr.currency} ${i.n2(n)}`;
  const res = { READY_TO_PURCHASE: [t("Listo para comprar", "Ready to purchase"), "ok"], READY_WITH_APPROVED_EXCEPTION: [t("Listo, con stock autorizado", "Ready, with authorized stock"), "ok"], NEEDS_RESOLUTION: [t("Falta resolver", "Needs resolution"), "attn"] } as const;
  const ss = STOCK_STATUS[pr.stockStatus] ?? STOCK_STATUS.NONE;
  const okMsg: Record<string, string> = {
    creado: t("Requerimiento creado.", "Requirement created."), guardado: t("Guardado.", "Saved."), cantidad: t("Cantidad actualizada (también en la orden en borrador).", "Quantity updated (also on the draft order)."),
    asignacion: t("Asignación actualizada.", "Assignment updated."), "stock-pedido": t("Autorización de stock pedida a Finanzas o Gerencia.", "Stock authorization requested from Finance or Management."),
    "stock-aprobado": t("Stock autorizado por la cantidad y el valor mostrados.", "Stock authorized for the quantity and value shown."), "stock-rechazado": t("Stock no autorizado.", "Stock not authorized."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("No tienes permiso sobre este requerimiento.", "You don't have permission on this requirement."),
    liberada: t("La orden al proveedor ya fue liberada: un cambio se hace con una nueva versión de la orden.", "The supplier order was already released: a change is made with a new version of the order."),
    cantidad: t("La cantidad debe ser mayor que cero.", "The quantity must be above zero."),
    asignacion: t("Elige un Journey con PO del cliente aceptada y una cantidad.", "Choose a Journey with an accepted customer PO and a quantity."),
    "sin-stock": t("Todo está asignado: no hay stock que autorizar.", "Everything is assigned: there's no stock to authorize."),
    justificacion: t("Escribe por qué conviene este stock.", "Write why this stock makes sense."),
    autoridad: t("Esta autorización la da Finanzas o Gerencia, nunca quien la pidió.", "Finance or Management gives this authorization, never the requester."),
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

      {(ex.qty > 0 || pr.stockStatus !== "NONE") && (
        <section className="jblock" id="stock">
          <div className="jbh"><b>{t("INVENTARIO QUE QUEDARÍA", "INVENTORY THAT WOULD REMAIN")}</b><span className="grow" /><span className={`sig ${ss.tone}`}>{t(ss.es, ss.en)}</span></div>
          <p className="small">{t(`${ex.qty} unidades por ${money(ex.amount)} no tienen un Journey esperándolas. Es capital sin recuperación asegurada: lo autoriza Finanzas o Gerencia, nunca quien lo pide.`, `${ex.qty} units worth ${money(ex.amount)} have no Journey waiting for them. That is capital with no assured recovery: Finance or Management authorizes it, never the requester.`)}</p>
          {pr.justification && <p className="small"><b>{t("Por qué", "Why")}:</b> «{pr.justification}»</p>}
          {pr.stockDecidedAt && <p className="src">{pr.stockStatus === "APPROVED" ? t(`Autorizado por ${pr.stockDecidedByName} el ${i.day(pr.stockDecidedAt)}: hasta ${pr.stockQtyApproved} unidades, ${money(pr.stockAmount)}.`, `Authorized by ${pr.stockDecidedByName} on ${i.day(pr.stockDecidedAt)}: up to ${pr.stockQtyApproved} units, ${money(pr.stockAmount)}.`) : t(`No autorizado por ${pr.stockDecidedByName} el ${i.day(pr.stockDecidedAt)}.`, `Declined by ${pr.stockDecidedByName} on ${i.day(pr.stockDecidedAt)}.`)}{pr.stockNote ? ` «${pr.stockNote}»` : ""}</p>}
          {ex.qty > 0 && pr.stockStatus !== "REQUESTED" && !pr.cancelledAt && !(pr.stockStatus === "APPROVED" && r.blockers.every((b) => b.key !== "stock")) && (
            <form action={requestStock.bind(null, pr.id)} className="qa-form" style={{ maxWidth: 620 }}>
              <label>{t("Por qué conviene comprar estas unidades de más", "Why buying these extra units makes sense")}<textarea name="justification" rows={2} maxLength={500} defaultValue={pr.justification ?? ""} placeholder={t("Ej.: el proveedor solo vende en cajas de 5", "E.g.: the supplier only sells in boxes of 5")} /></label>
              <button type="submit">{t("Pedir autorización de stock", "Request stock authorization")}</button>
            </form>
          )}
          {pr.stockStatus === "REQUESTED" && (decider ? (
            <form action={decideStock.bind(null, pr.id)} className="qa-form exc-decide" style={{ maxWidth: 620 }}>
              <label>{t("Nota (obligatoria para no autorizar)", "Note (required to decline)")}<textarea name="note" rows={2} maxLength={400} /></label>
              <div className="qa-row">
                <button type="submit" name="action" value="APPROVE">{t(`Autorizar ${ex.qty} unidades · ${money(ex.amount)}`, `Authorize ${ex.qty} units · ${money(ex.amount)}`)}</button>
                <button type="submit" name="action" value="REJECT" className="secondary">{t("No autorizar", "Decline")}</button>
              </div>
            </form>
          ) : <p className="src">{t("Esperando la decisión de Finanzas o Gerencia (otra persona).", "Waiting for Finance or Management's decision (someone else).")}</p>)}
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
