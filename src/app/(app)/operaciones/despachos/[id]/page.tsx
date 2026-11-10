import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit, canEditOps } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { ShrinkFileInput } from "@/components/ShrinkFileInput";
import { ENTRY_KINDS, EVIDENCE_KINDS, FAIL_CAUSES, MAX_DELIVERY_EVIDENCE, PHASES, RESOURCES, STATES, aging, canDeliver, canDispatch, dispatchState, type Line, type StateIn } from "@/lib/dispatch-rules";
import { addEvidence, addRequirement, cancelOrder, markDispatched, recordAttempt, retireRequirement, saveCost, saveEntryRef, scheduleOrder, setCustomerHold, toggleCheck } from "../actions";

// Operaciones O8 · one dispatch order: where it is, what holds it there and the next step.

export default async function DispatchOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const lang = i.es ? "ES" : "EN";
  const { id } = await params;
  const sp = await searchParams;
  const o = await db.dispatchOrder.findUnique({
    where: { id },
    include: {
      deal: { select: { id: true, code: true, title: true, ownerId: true, promisedDate: true, account: { select: { id: true, name: true, ownerId: true, requiresReceptionCode: true, deliveryRequirements: { where: { active: true }, orderBy: { createdAt: "asc" } } } }, dispatches: { where: { supersededAt: null }, orderBy: { version: "desc" }, take: 1 } } },
      delivery: { select: { id: true, code: true, receptionCode: true, receptionKind: true, receptionAt: true, receivedByName: true, invoice: { select: { number: true, issuedAt: true } } } },
      attempts: { orderBy: { createdAt: "asc" } },
      evidence: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, name: true, uploadedByName: true, createdAt: true } },
    },
  });
  if (!o) notFound();
  const d = o.deal;
  const ins = d.dispatches[0] ?? null;
  const editable = canEditOps(user, d.ownerId);
  const profileEdit = user.role === "NEGOCIADOR_OPERATIVO" || canEdit(user, d.account.ownerId);
  const reqs = d.account.deliveryRequirements;
  const checks = (o.checks ?? {}) as Record<string, { by: string; at: string }>;
  const s: StateIn = { cancelled: !!o.cancelledAt, hasInstruction: !!ins, reqs, checks, customerHold: !!o.customerHoldSince, scheduledFor: o.scheduledFor, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, entryRequired: d.account.requiresReceptionCode, entryRef: o.delivery?.receptionCode ?? null, invoiced: !!o.delivery?.invoice };
  const st = dispatchState(s);
  const S = STATES[st.key];
  const lines = o.lines as unknown as Line[];
  const ag = aging({ readyAt: o.createdAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, invoicedAt: o.delivery?.invoice?.issuedAt ?? null, customerHoldSince: o.customerHoldSince }, new Date());
  const here = `/operaciones/despachos/${o.id}`;
  const late = d.promisedDate && !o.deliveredAt && d.promisedDate < today();

  const okMsg: Record<string, string> = {
    creado: t("Despacho creado.", "Dispatch order created."), requisito: t("Requisito actualizado.", "Requirement updated."), programado: t("Programación guardada.", "Schedule saved."), espera: t("Espera del cliente actualizada.", "Customer wait updated."),
    despachado: t("Salió hacia el cliente. Lo comprometido de este Journey salió del inventario.", "On its way to the customer. This Journey's committed stock left the warehouse."), fallido: t("Intento fallido registrado. El despacho vuelve a programarse.", "Failed attempt recorded. The order goes back to scheduling."),
    entregado: t("Entregado. Se creó la remisión.", "Delivered. The delivery note was created."), entrada: t("Entrada del cliente registrada.", "Customer entry recorded."), costo: t("Costo guardado.", "Cost saved."), evidencia: t("Evidencia guardada.", "Evidence saved."), cancelado: t("Despacho cancelado.", "Dispatch order cancelled."), perfil: t("Perfil de entrega del cliente actualizado.", "Customer delivery profile updated."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("No tienes permiso sobre este despacho.", "You don't have permission on this dispatch order."), accion: t("Ese paso no aplica en el estado actual.", "That step doesn't apply in the current state."), recurso: t("Elige cómo se entrega.", "Choose how it is delivered."), motivo: t("Escribe el motivo.", "Write the reason."),
    "no-listo": t("Aún no puede salir: falta la instrucción de Comercial, un requisito de antes de despachar o hay una espera del cliente.", "It can't leave yet: the instruction from Sales, a before-dispatch requirement, or a customer wait is pending."),
    intento: t("Para un intento fallido indica de quién fue la causa y qué pasó.", "For a failed attempt say whose cause it was and what happened."), quien: t("Escribe quién recibió.", "Write who received it."), "al-entregar": t("Marca primero los requisitos de «Al entregar».", "Tick the \"At delivery\" requirements first."),
    entrada: t("Indica el tipo y el número de la entrada del cliente.", "Give the kind and number of the customer entry."), costo: t("Escribe el costo.", "Write the cost."), archivo: t("Elige una foto o PDF de hasta 5 MB.", "Choose a photo or PDF up to 5 MB."), lleno: t(`Ya hay ${MAX_DELIVERY_EVIDENCE} archivos en este despacho.`, `This order already has ${MAX_DELIVERY_EVIDENCE} files.`), requisito: t("Elige la fase y escribe el requisito.", "Choose the phase and write the requirement."),
  };

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/operaciones/despachos">{t("Despachos", "Dispatch")}</Link> · <Link href={`/deals/${d.id}?tab=execute`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{o.code}</span><span className="grow" />
          <Link className="qa-btn" href={`/deals/${d.id}/despacho`}>{t("Instrucción de Comercial", "Instruction from Sales")}</Link>
        </div>
        <div className="jh-title"><h1>{t(RESOURCES[o.resourceKind]?.es ?? o.resourceKind, RESOURCES[o.resourceKind]?.en ?? o.resourceKind)}{o.resourceName ? ` · ${o.resourceName}` : ""}</h1><span className={`sig ${S.tone}`}>{t(S.es, S.en)}</span></div>
        <p className="jh-sub">{lines.map((l) => `${l.qty} × ${l.code ?? l.description}`).join(" · ")}</p>
      </header>

      <section className="jblock" id="estado">
        <div className="jbh"><b>{t("DÓNDE ESTÁ", "WHERE IT IS")}</b><span className="grow" />{late && <span className="sig risk">{t("La promesa al cliente ya pasó", "The customer promise has passed")}</span>}</div>
        <dl className="qv-dl tight">
          <dt>{t("Promesa al cliente", "Customer promise")}</dt><dd className="mono">{d.promisedDate ? i.day(d.promisedDate) : "—"}</dd>
          <dt>{t("Programado para", "Scheduled for")}</dt><dd className="mono">{o.scheduledFor ? i.day(o.scheduledFor) : "—"}{o.scheduledByName && <span className="muted small"> · {o.scheduledByName}</span>}</dd>
          <dt>{t("Despachado", "Dispatched")}</dt><dd className="mono">{o.dispatchedAt ? i.day(o.dispatchedAt) : "—"}{o.dispatchedByName && <span className="muted small"> · {o.dispatchedByName}</span>}{o.tracking && <span className="muted small"> · {t("guía", "tracking")} {o.tracking}</span>}</dd>
          <dt>{t("Entregado", "Delivered")}</dt><dd className="mono">{o.deliveredAt ? i.day(o.deliveredAt) : "—"}{o.delivery && <> · <Link href={`/operaciones/remisiones/${o.delivery.id}`}>{o.delivery.code}</Link><span className="muted small"> · {t("recibió", "received by")} {o.delivery.receivedByName}</span></>}</dd>
          <dt>{t("Entrada del cliente", "Customer entry")}</dt><dd>{o.delivery?.receptionCode ? <><b className="mono">{o.delivery.receptionCode}</b><span className="muted small"> · {o.delivery.receptionKind ? t(ENTRY_KINDS[o.delivery.receptionKind]?.es ?? "", ENTRY_KINDS[o.delivery.receptionKind]?.en ?? "") : ""}{o.delivery.receptionAt ? ` · ${i.day(o.delivery.receptionAt)}` : ""}</span></> : d.account.requiresReceptionCode ? <span className="muted">{t("Este cliente la exige para facturar", "This customer requires it to invoice")}</span> : <span className="muted">{t("No la exige", "Not required")}</span>}</dd>
          <dt>{t("Factura", "Invoice")}</dt><dd>{o.delivery?.invoice ? <span className="mono">{o.delivery.invoice.number} · {i.day(o.delivery.invoice.issuedAt)}</span> : "—"}</dd>
          <dt>{t("Tiempos", "Timing")}</dt><dd className="small">{t(`${ag.readyToDispatch} días de listo a despacho`, `${ag.readyToDispatch} days from ready to dispatch`)}{ag.deliveryToInvoice != null && ` · ${t(`${ag.deliveryToInvoice} días de entrega a factura`, `${ag.deliveryToInvoice} days from delivery to invoice`)}`}{ag.customerWait > 0 && ` · ${t(`${ag.customerWait} días esperando al cliente (no cuentan como demora nuestra)`, `${ag.customerWait} days waiting on the customer (not counted as our delay)`)}`}</dd>
          <dt>{t("Costo de la entrega", "Delivery cost")}</dt><dd className="mono">{o.cost != null ? `${o.costCurrency} ${i.n2(Number(o.cost))}` : "—"}{o.costNote && <span className="muted small"> · {o.costNote}</span>}</dd>
        </dl>
        {o.customerHoldSince && <p className="note attn">{t("Espera del cliente desde", "Customer wait since")} {i.day(o.customerHoldSince)}: {o.customerHoldReason}</p>}
        {o.cancelledAt && <p className="note">{t("Cancelado", "Cancelled")} {i.day(o.cancelledAt)}: {o.cancelReason}</p>}
        {st.key === "INSTRUCTION_PENDING" && <p className="note attn">{t("Comercial aún no ha emitido la instrucción de despacho de este Journey. Sin ella no sale.", "Sales hasn't issued this Journey's dispatch instruction yet. Without it, nothing leaves.")}</p>}
        {st.key === "WAITING_CUSTOMER_ENTRY" && <p className="note attn">{t("Entregado, pero falta la entrada de mercancía del cliente. Quien lleva la relación la pide; mientras tanto no se factura.", "Delivered, but the customer's goods entry is missing. The relationship owner asks for it; meanwhile there is no invoice.")}</p>}
      </section>

      {ins && (
        <section className="jblock">
          <div className="jbh"><b>{t("LO QUE PROMETIMOS", "WHAT WE PROMISED")}</b><span className="grow" /><span className="src">{t(`Instrucción v${ins.version} · ${ins.issuedByName}`, `Instruction v${ins.version} · ${ins.issuedByName}`)}</span></div>
          <dl className="qv-dl tight">
            <dt>{t("Destino", "Destination")}</dt><dd className="pre">{ins.destination}</dd>
            <dt>{t("Recibe", "Receiver")}</dt><dd>{ins.contactName ?? "—"}{ins.contactPhone && ` · ${ins.contactPhone}`}</dd>
            <dt>{t("Ventana", "Window")}</dt><dd className="mono">{ins.windowFrom ? i.day(ins.windowFrom) : "—"} – {ins.windowTo ? i.day(ins.windowTo) : "—"}</dd>
            {ins.documents && <><dt>{t("Documentos", "Documents")}</dt><dd className="small">{ins.documents}</dd></>}
            {ins.restrictions && <><dt>{t("Restricciones", "Restrictions")}</dt><dd className="small">{ins.restrictions}</dd></>}
          </dl>
        </section>
      )}

      <section className="jblock" id="requisitos">
        <div className="jbh"><b>{t("LO QUE EXIGE ESTE CLIENTE", "WHAT THIS CUSTOMER REQUIRES")}</b><span className="grow" /><span className="src">{t("Perfil de entrega del cliente: sirve para todos sus despachos", "Customer delivery profile: used for all its dispatch orders")}</span></div>
        {reqs.length === 0 && <p className="small muted">{t("Aún no hay requisitos registrados para este cliente.", "No requirements recorded for this customer yet.")}</p>}
        {Object.keys(PHASES).map((ph) => { const rs = reqs.filter((r) => r.phase === ph); if (!rs.length) return null; return (
          <div key={ph} style={{ marginTop: 6 }}>
            <span className="k">{t(PHASES[ph].es, PHASES[ph].en)}</span>
            <ul className="qv-checks">{rs.map((r) => { const c = checks[r.id]; return (
              <li key={r.id} className={c ? "ok" : "no"}>
                <span className="ic" aria-hidden>{c ? "✓" : "!"}</span>
                <span>{r.text}{r.site && <span className="muted small"> · {r.site}</span>}{c && <span className="muted small"> · {c.by} · {i.day(new Date(c.at))}</span>}
                  {editable && !o.cancelledAt && <form action={toggleCheck.bind(null, o.id, r.id)} className="inline-f"><button type="submit" className="linkb">{c ? t("desmarcar", "untick") : t("marcar cumplido", "mark done")}</button></form>}
                  {profileEdit && <form action={retireRequirement.bind(null, r.id, here)} className="inline-f"><button type="submit" className="linkb">{t("ya no aplica", "no longer applies")}</button></form>}
                </span>
              </li>
            ); })}</ul>
          </div>
        ); })}
        {profileEdit && (
          <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Agregar requisito del cliente", "+ Add customer requirement")}</summary>
            <form action={addRequirement.bind(null, d.account.id, here)} className="qa-form" style={{ marginTop: 8, maxWidth: 640 }}>
              <div className="qa-row">
                <label style={{ flex: "0 0 200px" }}>{t("Cuándo", "When")}<select name="phase">{Object.entries(PHASES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                <label>{t("Requisito", "Requirement")}<input name="text" required maxLength={200} placeholder={t("Ej.: cita previa con portería", "E.g.: prior appointment with the gate")} /></label>
                <label style={{ flex: "0 0 160px" }}>{t("Sede (opcional)", "Site (optional)")}<input name="site" maxLength={120} /></label>
              </div>
              <button type="submit" className="secondary">{t("Agregar al perfil", "Add to profile")}</button>
            </form>
          </details>
        )}
      </section>

      {editable && !o.cancelledAt && (
        <section className="jblock" id="pasos">
          <div className="jbh"><b>{t("SIGUIENTE PASO", "NEXT STEP")}</b></div>
          {!o.dispatchedAt && !o.deliveredAt && (
            <>
              <form action={scheduleOrder.bind(null, o.id)} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={{ flex: "0 0 220px" }}>{t("Cómo se entrega", "How it is delivered")}<select name="resourceKind" defaultValue={o.resourceKind}>{Object.entries(RESOURCES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                <label>{t("Quién o qué empresa", "Who or which company")}<input name="resourceName" maxLength={120} defaultValue={o.resourceName ?? ""} /></label>
                <label style={{ flex: "0 0 150px" }}>{t("Guía (si hay)", "Tracking (if any)")}<input name="tracking" maxLength={80} defaultValue={o.tracking ?? ""} /></label>
                <label style={{ flex: "0 0 160px" }}>{t("Fecha programada", "Scheduled date")}<input name="scheduledFor" type="date" defaultValue={dayInput(o.scheduledFor)} /></label>
                <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar programación", "Save schedule")}</button>
              </form>
              <form action={markDispatched.bind(null, o.id)} className="qa-row" style={{ alignItems: "flex-end", marginTop: 8 }}>
                <label style={{ flex: "0 0 160px" }}>{t("Fecha de salida", "Departure date")}<input name="at" type="date" defaultValue={dayInput(today())} /></label>
                <button type="submit" disabled={!canDispatch(s)} style={{ flex: "0 0 auto" }}>{t("Salió hacia el cliente", "Left for the customer")}</button>
                {!canDispatch(s) && <span className="small muted">{t("Se habilita con la instrucción emitida y los requisitos de «Antes de despachar» cumplidos.", "Enabled once the instruction is issued and the \"Before dispatch\" requirements are done.")}</span>}
              </form>
              <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{o.customerHoldSince ? t("Terminó la espera del cliente", "Customer wait is over") : t("El cliente pide esperar", "The customer asks to wait")}</summary>
                <form action={setCustomerHold.bind(null, o.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 560 }}>
                  {o.customerHoldSince ? <input type="hidden" name="clear" value="1" /> : <label>{t("Qué pidió el cliente", "What the customer asked")}<input name="reason" required maxLength={300} /></label>}
                  <button type="submit" className="secondary">{o.customerHoldSince ? t("Quitar la espera", "Clear the wait") : t("Registrar espera del cliente", "Record customer wait")}</button>
                </form>
              </details>
              <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("Cancelar este despacho", "Cancel this dispatch order")}</summary>
                <form action={cancelOrder.bind(null, o.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 560 }}><label>{t("Motivo", "Reason")}<input name="reason" required maxLength={300} /></label><button type="submit" className="secondary">{t("Cancelar despacho", "Cancel order")}</button></form>
              </details>
            </>
          )}
          {o.dispatchedAt && !o.deliveredAt && (
            <>
              <form action={recordAttempt.bind(null, o.id)} className="qa-form" style={{ maxWidth: 680 }}>
                <input type="hidden" name="outcome" value="DELIVERED" />
                <div className="qa-row">
                  <label>{t("Quién recibió", "Received by")}<input name="receiverName" required maxLength={120} defaultValue={ins?.contactName ?? ""} /></label>
                  <label style={{ flex: "0 0 160px" }}>{t("Fecha", "Date")}<input name="at" type="date" defaultValue={dayInput(today())} /></label>
                  <label>{t("Lugar", "Place")}<input name="place" maxLength={200} defaultValue={ins?.destination.split("\n")[0].slice(0, 200) ?? ""} /></label>
                </div>
                {lines.map((l) => <label key={l.dealItemId}>{t(`Seriales de ${l.qty} × ${l.code ?? l.description} (opcional)`, `Serials of ${l.qty} × ${l.code ?? l.description} (optional)`)}<input name={`ser_${l.dealItemId}`} maxLength={400} /></label>)}
                <label className="chk"><input type="checkbox" name="pod" value="1" /> {t("Tenemos la remisión firmada o prueba de entrega", "We have the signed delivery note or proof of delivery")}</label>
                <button type="submit" disabled={!canDeliver(s)}>{t("Entregado: crear remisión", "Delivered: create delivery note")}</button>
              </form>
              <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("No se pudo entregar", "Delivery failed")}</summary>
                <form action={recordAttempt.bind(null, o.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 640 }}>
                  <input type="hidden" name="outcome" value="FAILED" />
                  <div className="qa-row">
                    <label style={{ flex: "0 0 260px" }}>{t("De quién fue la causa", "Whose cause")}<select name="cause">{Object.entries(FAIL_CAUSES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                    <label>{t("Qué pasó", "What happened")}<input name="reason" required maxLength={300} /></label>
                  </div>
                  <button type="submit" className="secondary">{t("Registrar intento fallido", "Record failed attempt")}</button>
                </form>
              </details>
            </>
          )}
          {o.deliveredAt && o.delivery && !o.delivery.invoice && (
            <form action={saveEntryRef.bind(null, o.id)} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ flex: "0 0 220px" }}>{t("Entrada del cliente", "Customer entry")}<select name="kind" defaultValue={o.delivery.receptionKind ?? "MIGO"}>{Object.entries(ENTRY_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>{t("Número", "Number")}<input name="ref" required maxLength={80} defaultValue={o.delivery.receptionCode ?? ""} /></label>
              <label style={{ flex: "0 0 160px" }}>{t("Fecha", "Date")}<input name="at" type="date" defaultValue={dayInput(o.delivery.receptionAt ?? today())} /></label>
              <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar entrada", "Save entry")}</button>
            </form>
          )}
          {st.key === "INVOICE_READY" && <p className="small" style={{ marginTop: 8 }}><span className="sig ok">✓</span> {t("Listo para facturar:", "Invoice ready:")} <Link href={`/deals/${d.id}/facturacion`}>{t("abrir facturación del Journey", "open the Journey's billing")}</Link></p>}
          <form action={saveCost.bind(null, o.id)} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
            <label style={{ flex: "0 0 150px" }}>{t("Costo de la entrega", "Delivery cost")}<input name="cost" inputMode="decimal" defaultValue={o.cost != null ? String(o.cost) : ""} /></label>
            <label style={{ flex: "0 0 90px" }}>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue={o.costCurrency} /></label>
            <label>{t("Nota (factura del transportador, peajes…)", "Note (carrier invoice, tolls…)")}<input name="note" maxLength={200} defaultValue={o.costNote ?? ""} /></label>
            <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar costo", "Save cost")}</button>
          </form>
        </section>
      )}

      <section className="jblock" id="intentos">
        <div className="jbh"><b>{t("INTENTOS DE ENTREGA", "DELIVERY ATTEMPTS")}</b><span className="grow" /><span className="src">{t("Un intento registrado no se edita ni se borra", "A recorded attempt is never edited or deleted")}</span></div>
        {o.attempts.length === 0 ? <p className="small muted">{t("Sin intentos todavía.", "No attempts yet.")}</p> : (
          <ul className="plain small">{o.attempts.map((a) => <li key={a.id}><span className="mono">{i.day(a.at)}</span> · {a.outcome === "DELIVERED" ? <><span className="sig ok">{t("Entregado", "Delivered")}</span> {t("recibió", "received by")} {a.receiverName}</> : <><span className="sig risk">{t("Fallido", "Failed")}</span> {a.cause ? `${t(FAIL_CAUSES[a.cause]?.es ?? a.cause, FAIL_CAUSES[a.cause]?.en ?? a.cause)}: ` : ""}{a.reason}</>}<span className="muted"> · {a.recordedByName}</span></li>)}</ul>
        )}
      </section>

      <section className="jblock" id="evidencia">
        <div className="jbh"><b>{t("EVIDENCIA DE ENTREGA", "DELIVERY EVIDENCE")}</b><span className="grow" /><span className="src">{o.evidence.length} / {MAX_DELIVERY_EVIDENCE}</span></div>
        {o.evidence.length === 0 ? <p className="small muted">{t("Sin archivos todavía.", "No files yet.")}</p> : (
          <ul className="plain small">{o.evidence.map((e) => <li key={e.id}><a href={`/operaciones/despachos/evidencia/${e.id}`} target="_blank" rel="noopener">{e.name}</a> · {t(EVIDENCE_KINDS[e.kind]?.es ?? e.kind, EVIDENCE_KINDS[e.kind]?.en ?? e.kind)}<span className="muted"> · {e.uploadedByName} · {i.day(e.createdAt)}</span></li>)}</ul>
        )}
        {editable && o.evidence.length < MAX_DELIVERY_EVIDENCE && (
          <form action={addEvidence.bind(null, o.id)} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
            <label style={{ flex: "0 0 220px" }}>{t("Qué es", "What it is")}<select name="kind">{Object.entries(EVIDENCE_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
            <label>{t("Foto o PDF", "Photo or PDF")}<ShrinkFileInput name="files" accept="image/jpeg,image/png,image/webp,application/pdf" lang={lang} /></label>
            <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar evidencia", "Save evidence")}</button>
          </form>
        )}
      </section>
    </div>
  );
}
