import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit, canEditOps } from "@/lib/permissions";
import { DealDispatchOrders } from "@/components/DealDispatchOrders";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { issueDispatch } from "./actions";

type Item = { code: string | null; description: string; qty: number };

// Comercial C6 · v1.3 §58 Dispatch Instruction: the customer obligation Operations must execute, prefilled from
// the accepted PO, the quote, the customer's payment map and reception rules (no re-typing).
export default async function DispatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; po?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const d = await db.deal.findUnique({
    where: { id },
    select: {
      id: true, code: true, title: true, ownerId: true, promisedDate: true, desiredResult: true,
      account: { select: { id: true, name: true, requiresReceptionCode: true, requiresPortal: true, paymentMap: { select: { documents: true } } } },
      contact: { select: { firstName: true, lastName: true, phone: true } },
      customerPos: { where: { acceptance: { isNot: null } }, orderBy: { receivedAt: "desc" }, include: { lines: { orderBy: { position: "asc" } }, acceptance: { select: { promiseDate: true } }, quote: { select: { shipTo: true } } } },
      poAllocations: { include: { po: { include: { lines: { orderBy: { position: "asc" } }, acceptance: { select: { promiseDate: true } }, quote: { select: { shipTo: true } } } } } },
      dispatches: { orderBy: [{ version: "desc" }], include: { po: { select: { number: true } } } },
    },
  });
  if (!d) notFound();
  const editable = canEdit(user, d.ownerId);
  const pos = [...d.customerPos, ...d.poAllocations.map((a) => a.po).filter((p) => p.acceptance)];
  const po = pos.find((p) => p.id === sp.po) ?? pos[0] ?? null;
  const current = po ? d.dispatches.find((x) => x.poId === po.id && !x.supersededAt) ?? null : null;
  const history = d.dispatches.filter((x) => x.supersededAt);

  const okMsg: Record<string, string> = { emitida: t("Instrucción emitida a Operaciones. La versión anterior queda en el historial.", "Instruction issued to Operations. The previous version stays in history.") };
  const errMsg: Record<string, string> = {
    permiso: t("Solo quien lleva el Journey o la dirección emiten la instrucción.", "Only the Journey owner or management issue the instruction."),
    "sin-po": t("Primero acepta la PO del cliente: sin compromiso aceptado no hay despacho.", "Accept the customer's PO first: no accepted commitment, no dispatch."),
    campos: t("Indica al menos un producto con cantidad y el destino.", "Give at least one product with quantity and the destination."),
    ventana: t("La ventana termina antes de empezar.", "The window ends before it starts."),
    motivo: t("Ya hay una instrucción emitida: escribe por qué cambia.", "An instruction was already issued: write why it changes."),
    recurso: t("Elige cómo se entrega.", "Choose how it is delivered."),
    nada: t("Indica cuántas unidades van en este despacho.", "Say how many units go in this dispatch order."),
    exceso: t("No puedes despachar más unidades de las que faltan por entregar.", "You can't dispatch more units than are still to be delivered."),
  };
  const prefill = po ? {
    items: (current ? (current.items as Item[]) : po.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty }))),
    destination: current?.destination ?? po.shipTo ?? po.quote?.shipTo ?? "",
    contactName: current?.contactName ?? (d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : ""),
    contactPhone: current?.contactPhone ?? d.contact?.phone ?? "",
    windowFrom: current?.windowFrom ?? today(),
    windowTo: current?.windowTo ?? po.acceptance?.promiseDate ?? d.promisedDate ?? null,
    promiseDate: current?.promiseDate ?? po.acceptance?.promiseDate ?? d.promisedDate ?? null,
    documents: current?.documents ?? [po.documents, d.account.paymentMap?.documents].filter(Boolean).join(" · "),
    entryRequirement: current?.entryRequirement ?? [d.account.requiresReceptionCode ? t("Requiere código / entrada de mercancía del cliente para facturar", "Requires the customer's reception code / goods receipt to invoice") : null, d.account.requiresPortal ? t("Factura por portal del cliente", "Invoice through the customer's portal") : null].filter(Boolean).join(" · "),
    restrictions: current?.restrictions ?? "",
  } : null;

  const Show = ({ x }: { x: (typeof d.dispatches)[number] }) => (
    <>
      <div className="tscroll"><table><thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th></tr></thead>
        <tbody>{(x.items as Item[]).map((it, k) => <tr key={k}><td className="val">{it.qty}</td><td className="mono small">{it.code ?? "—"}</td><td>{it.description}</td></tr>)}</tbody></table></div>
      <dl className="qv-dl">
        <dt>{t("Destino", "Destination")}</dt><dd className="pre">{x.destination}</dd>
        <dt>{t("Recibe", "Receiver")}</dt><dd>{x.contactName ?? "—"}{x.contactPhone && ` · ${x.contactPhone}`}</dd>
        <dt>{t("Ventana de entrega", "Delivery window")}</dt><dd>{x.windowFrom ? i.day(x.windowFrom) : "—"} – {x.windowTo ? i.day(x.windowTo) : "—"}</dd>
        <dt>{t("Promesa al cliente", "Customer promise")}</dt><dd><b>{x.promiseDate ? i.date(x.promiseDate) : "—"}</b></dd>
        <dt>{t("Documentos del cliente", "Customer documents")}</dt><dd>{x.documents ?? "—"}</dd>
        <dt>{t("Entrada / recepción", "Entry / receipt")}</dt><dd>{x.entryRequirement ?? "—"}</dd>
        <dt>{t("Restricciones", "Restrictions")}</dt><dd>{x.restrictions ?? "—"}</dd>
        {x.changeReason && <><dt>{t("Por qué cambió", "Why it changed")}</dt><dd>{x.changeReason}</dd></>}
      </dl>
      <p className="src">{t(`v${x.version} · PO ${x.po?.number ?? "—"} · emitida por ${x.issuedByName} el ${i.day(x.issuedAt)}`, `v${x.version} · PO ${x.po?.number ?? "—"} · issued by ${x.issuedByName} on ${i.day(x.issuedAt)}`)}</p>
    </>
  );

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=execute`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{t("Instrucción de despacho", "Dispatch instruction")}</span>
          <span className="grow" />
          {po && <Link className="qa-btn" href={`/po/${po.id}`}>PO {po.number}</Link>}
        </div>
        <div className="jh-title"><h1>{t("¿Qué le prometimos al cliente sobre la entrega?", "What did we promise the customer about delivery?")}</h1>{current ? <span className="sig ok">{t(`Emitida v${current.version}`, `Issued v${current.version}`)}</span> : <span className="sig wait">{t("Sin emitir", "Not issued")}</span>}</div>
        <p className="jh-sub">{t("Comercial define la obligación con el cliente; Operaciones ejecuta lo físico.", "Commercial defines the customer obligation; Operations runs the physical execution.")}</p>
      </header>

      {!po ? <section className="jblock"><p className="quiet-p">{t("Todavía no hay una PO aceptada en este Journey. La instrucción nace al aceptar la PO.", "No accepted PO on this Journey yet. The instruction is born when the PO is accepted.")}</p></section> : (
        <>
          {pos.length > 1 && <p className="small">{t("PO", "PO")}: {pos.map((p) => <Link key={p.id} href={`/deals/${d.id}/despacho?po=${p.id}`} className={p.id === po.id ? "val" : ""} style={{ marginRight: 8 }}>{p.number}</Link>)}</p>}
          {current && <section className="jblock"><div className="jbh"><b>{t("VIGENTE PARA OPERACIONES", "CURRENT FOR OPERATIONS")}</b></div><Show x={current} /></section>}
          {editable && prefill && (
            <section className="jblock">
              <div className="jbh"><b>{current ? t("EMITIR UNA NUEVA VERSIÓN", "ISSUE A NEW VERSION") : t("EMITIR A OPERACIONES", "ISSUE TO OPERATIONS")}</b><span className="grow" /><span className="src">{t("Prellenada con la PO, la cotización y el cliente", "Prefilled from the PO, the quote and the customer")}</span></div>
              <form action={issueDispatch.bind(null, d.id)} className="qa-form">
                <input type="hidden" name="poId" value={po.id} />
                <input type="hidden" name="lines" value={prefill.items.length} />
                {prefill.items.map((it, k) => (
                  <div key={k} className="qa-row">
                    <label style={{ flex: "0 0 80px" }}>{t("Cant.", "Qty")}<input name={`qty_${k}`} type="number" min={0} defaultValue={it.qty} /></label>
                    <label style={{ flex: "0 0 140px" }}>{t("Código", "Code")}<input name={`code_${k}`} maxLength={60} defaultValue={it.code ?? ""} /></label>
                    <label>{t("Descripción", "Description")}<input name={`desc_${k}`} maxLength={300} defaultValue={it.description} /></label>
                  </div>
                ))}
                <label>{t("Destino (dirección, planta, bodega)", "Destination (address, plant, warehouse)")}<textarea name="destination" rows={2} required maxLength={400} defaultValue={prefill.destination} /></label>
                <div className="qa-row">
                  <label>{t("Quién recibe", "Who receives")}<input name="contactName" maxLength={120} defaultValue={prefill.contactName} /></label>
                  <label>{t("Teléfono", "Phone")}<input name="contactPhone" maxLength={60} defaultValue={prefill.contactPhone} /></label>
                </div>
                <div className="qa-row">
                  <label>{t("Ventana desde", "Window from")}<input name="windowFrom" type="date" defaultValue={dayInput(prefill.windowFrom)} /></label>
                  <label>{t("Ventana hasta", "Window to")}<input name="windowTo" type="date" defaultValue={dayInput(prefill.windowTo)} /></label>
                  <label>{t("Promesa al cliente", "Customer promise")}<input name="promiseDate" type="date" defaultValue={dayInput(prefill.promiseDate)} /></label>
                </div>
                <label>{t("Documentos que exige el cliente", "Documents the customer requires")}<input name="documents" maxLength={400} defaultValue={prefill.documents} /></label>
                <label>{t("Entrada de mercancía / recepción", "Goods receipt / reception")}<input name="entryRequirement" maxLength={400} defaultValue={prefill.entryRequirement} /></label>
                <label>{t("Restricciones especiales (horario, EPP, acceso…)", "Special restrictions (hours, PPE, access…)")}<input name="restrictions" maxLength={400} defaultValue={prefill.restrictions} /></label>
                {current && <label>{t("Por qué cambia", "Why it changes")}<input name="changeReason" required maxLength={300} /></label>}
                <button type="submit">{current ? t("Emitir nueva versión", "Issue new version") : t("Emitir a Operaciones", "Issue to Operations")}</button>
              </form>
            </section>
          )}
          {history.length > 0 && (
            <details className="jblock"><summary className="jbh"><b>{t("VERSIONES ANTERIORES", "PREVIOUS VERSIONS")}</b></summary>
              {history.map((x) => <div key={x.id} style={{ marginTop: 10 }}><Show x={x} /></div>)}
            </details>
          )}
        </>
      )}
      <DealDispatchOrders dealId={d.id} lang={i.es ? "ES" : "EN"} canOps={canEditOps(user, d.ownerId)} canOwner={editable} />
    </div>
  );
}
