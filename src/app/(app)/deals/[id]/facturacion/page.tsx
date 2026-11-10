import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditMoney, canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { addDays, dayInput, invoiceCash, today } from "@/lib/domain";
import { getPayRules } from "@/lib/pay-behavior";
import { billingInclude, DEAL_LEVEL, cashTimeline, cashViewOf, deliveryAmount, partialOf, payHistory, pendingDeliveries, readinessOf, syncLabel, unallocatedOf, type Req } from "@/lib/billing";
import { Popovers } from "@/components/Popovers";
import { sellerOf } from "@/lib/sellers";
import { accountingBridge, allocateCash, recordExternalInvoice, issueFromReadiness, markShortPay, recordEvidence, recordPayPromise, reconcileCash, requestEvidence } from "./actions";

export default async function BillingReadinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; n?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const deal = await db.deal.findUnique({ where: { id }, include: billingInclude });
  if (!deal) notFound();
  const editable = canEditMoney(user, deal.ownerId);
  const manager = canFinance(user);
  const now = today();
  const a = deal.account;
  const seller = await sellerOf(deal.sellerKey);

  const [acctInvoices, openPayments, payRules] = await Promise.all([
    db.invoice.findMany({
      where: { accountId: a.id },
      orderBy: { issuedAt: "asc" },
      include: { deal: { select: { id: true, code: true } }, applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } } },
    }),
    db.customerPayment.findMany({ where: { accountId: a.id, reconciledAt: null }, orderBy: { receivedAt: "desc" }, include: { applications: { select: { amount: true } } } }),
    getPayRules(),
  ]);
  const hist = payHistory(acctInvoices, payRules.value, a.paymentTermsDays, now);
  const openInv = acctInvoices
    .map((inv) => { const c = invoiceCash(inv); return { inv, room: c.balance - c.pendingReconcile }; })
    .filter((x) => x.room > 0.005)
    .sort((x, y) => (x.inv.dealId === deal.id ? 0 : 1) - (y.inv.dealId === deal.id ? 0 : 1));
  const unalloc = unallocatedOf(openPayments, openInv.reduce((s, x) => s + x.room, 0));

  const pending = pendingDeliveries(deal).map((d) => {
    const reqs = readinessOf(deal, d, i, now);
    const missing = reqs.filter((r) => r.state === "missing");
    return { d, reqs, missing, amount: deliveryAmount(deal, d), part: partialOf(deal, d) };
  });
  const nothingYet = deal.deliveries.length === 0 && deal.invoices.length === 0;
  const preview = nothingYet ? readinessOf(deal, null, i, now) : null;
  const ready = pending.filter((p) => p.missing.length === 0);
  const views = deal.invoices.map((inv) => cashViewOf(inv, hist, a.paymentTermsDays, i, now));
  const tl = views.length ? cashTimeline(views, now) : null;

  const verdict =
    pending.length === 0
      ? nothingYet
        ? { cls: "dash", text: t("Aún no · nada entregado", "Not yet · nothing delivered") }
        : { cls: "ok", text: t("Todo lo entregado está facturado", "Everything delivered is invoiced") }
      : ready.length
        ? { cls: "ok", text: t(`Sí · ${ready.length} ${ready.length === 1 ? "entrega lista" : "entregas listas"}`, `Yes · ${ready.length} ${ready.length === 1 ? "delivery" : "deliveries"} ready`) }
        : { cls: "attn", text: t(`Aún no · faltan ${pending.reduce((s, p) => s + p.missing.length, 0)} requisitos`, `Not yet · ${pending.reduce((s, p) => s + p.missing.length, 0)} requirements missing`) };

  const okMsg: Record<string, string> = {
    dian: t("Factura DIAN registrada. El cobro ya corre desde su fecha.", "DIAN invoice recorded. Collection now runs from its date."),
    solicitado: t("Solicitud registrada. El requisito sigue faltando hasta que llegue la evidencia.", "Request recorded. The requirement stays missing until the evidence arrives."),
    evidencia: t("Evidencia registrada. SOLU recalculó si está listo para facturar.", "Evidence recorded. SOLU recalculated whether it's ready to bill."),
    emitida: t("Factura emitida en SOLU. Contabilidad: no enviada todavía.", "Invoice issued in SOLU. Accounting: not sent yet."),
    "ya-emitida": t("Esa entrega ya tenía factura.", "That delivery already had an invoice."),
    "contable-sent": t("Marcada como enviada a contabilidad. Falta que contabilidad devuelva su ID.", "Marked as sent to accounting. Waiting for accounting to return its ID."),
    "contable-confirmed": t("ID contable confirmado.", "Accounting ID confirmed."),
    "contable-uncertain": t("Marcada como incierta. No la reenvíes hasta revisar el sistema contable.", "Marked uncertain. Don't resend until someone checks the accounting system."),
    promesa: t("Promesa del cliente registrada. Es una verdad aparte del vencimiento.", "Customer promise recorded. It's a separate truth from the due date."),
    asignado: t("Dinero asignado a las facturas. Aún no es «pagada»: falta conciliar.", "Cash allocated to the invoices. Not “paid” yet: reconciliation pending."),
    residuo: t("Decisión sobre el sobrante registrada.", "Decision on the leftover recorded."),
    conciliado: t("Conciliado. Ahora sí cuenta como cobrado.", "Reconciled. Now it counts as collected."),
    corto: t("Motivo del pago corto registrado. El saldo sigue abierto.", "Short-payment reason recorded. The balance stays open."),
  };
  const errMsg: Record<string, string> = {
    "dian-datos": t("Escribe el número y la fecha de la factura electrónica.", "Type the electronic invoice number and date."),
    "dian-fecha": t("La fecha de la factura no puede ser futura.", "The invoice date can't be in the future."),
    "dian-repetida": t("Ya hay una factura con ese número en SOLU.", "There's already an invoice with that number in SOLU."),
    "dian-total": t("Escribe el total de la factura con IVA.", "Type the invoice total including IVA."),
    dato: t("Falta el dato.", "The value is missing."),
    fecha: t("Elige una fecha de vigencia futura.", "Pick a future validity date."),
    "no-listo": t("Aún faltan requisitos: no se emite la factura.", "Requirements are still missing: the invoice isn't issued."),
    monto: t("Nada por facturar.", "Nothing to invoice."),
    id: t("Escribe el ID que devolvió el sistema contable.", "Write the ID the accounting system returned."),
    "id-dup": t(`Ese ID contable ya está en la factura ${sp.n ?? ""}. Revisa antes de confirmar.`, `That accounting ID is already on invoice ${sp.n ?? ""}. Check before confirming.`),
    promesa: t("Fecha, quién promete y fuente son obligatorios.", "Date, who promises and source are required."),
    conciliado: t("Ese pago ya está conciliado.", "That payment is already reconciled."),
    excede: t("Se asignó más de lo recibido.", "More was allocated than received."),
    "otro-cliente": t("Esa factura es de otro cliente.", "That invoice belongs to another customer."),
    tope: t(`La factura ${sp.n ?? ""} no tiene tanto saldo abierto.`, `Invoice ${sp.n ?? ""} doesn't have that much open balance.`),
    nada: t("Escribe un monto o una decisión sobre el sobrante.", "Enter an amount or a decision on the leftover."),
    gerencia: t("Concilian Gerencia, Director Comercial o Finanzas.", "Management, Commercial Director or Finance reconcile."),
    "sin-asignar": t("Primero asigna el dinero a sus facturas.", "Allocate the cash to its invoices first."),
    "residuo-pendiente": t("Queda dinero sin asignar: decide qué hacer con el sobrante antes de conciliar.", "Some cash is unallocated: decide what to do with the leftover before reconciling."),
  };

  const contactDefault = a.billingContact ?? deal.contact?.email ?? "";
  const ReqRow = ({ r, deliveryId }: { r: Req; deliveryId: string | null }) => (
    <li className={r.state === "ok" ? "ok" : r.state === "na" ? "no info" : "no"}>
      <span className="ic" aria-hidden>{r.state === "ok" ? "✓" : r.state === "na" ? "–" : "!"}</span>
      <span className="brq">
        <span><b>{r.label}</b>{r.state === "na" && <span className="src"> · {t("no aplica", "n/a")}</span>}</span>
        <span className="small">{r.detail}</span>
        {r.request && <span className="src block">{t(`Solicitado ${i.day(r.request.at)} por ${r.request.by}${r.request.sentTo ? ` a ${r.request.sentTo}` : ""} · sigue faltando`, `Requested ${i.day(r.request.at)} by ${r.request.by}${r.request.sentTo ? ` to ${r.request.sentTo}` : ""} · still missing`)}</span>}
        {editable && r.state === "missing" && (deliveryId || DEAL_LEVEL.includes(r.key)) && (
          <span className="brq-act">
            {!r.request && (
              <details className="qa"><summary className="qa-btn">{t("Pedir al cliente", "Request from customer")}</summary><div className="qa-pop wide">
                <form action={requestEvidence.bind(null, deal.id, deliveryId ?? "", r.key)} className="qa-form">
                  <label>{t("A quién", "To whom")}<input name="sentTo" defaultValue={contactDefault} /></label>
                  <label>{t("Nota", "Note")}<input name="note" placeholder={t("Ej.: por correo, con copia a compras", "E.g.: by email, cc purchasing")} /></label>
                  <span className="src">{t("Queda registrado; el requisito sigue faltando hasta que llegue.", "It's logged; the requirement stays missing until it arrives.")}</span>
                  <button type="submit">{t("Registrar solicitud", "Record request")}</button>
                </form>
              </div></details>
            )}
            {(
              <details className="qa"><summary className="qa-btn">{t("Llegó: registrar", "Arrived: record it")}</summary><div className="qa-pop wide">
                <form action={recordEvidence.bind(null, deal.id, deliveryId ?? "", r.key)} className="qa-form">
                  {r.key === "PORTAL"
                    ? <label>{t("Registro vigente hasta", "Registration valid until")}<input name="date" type="date" required /></label>
                    : <label>{({ PO: t("Número de OC", "PO number"), POD: t("Quién firmó la entrega", "Who signed the delivery"), RECEPTION_CODE: t("Código de entrada de mercancía", "Goods-receipt code"), TAX: t("NIT / Tax ID", "Tax ID"), PARTIAL: t("Quién aprobó y dónde", "Who approved, and where") })[r.key]}<input name="value" required /></label>}
                  <button type="submit">{t("Registrar evidencia", "Record evidence")}</button>
                </form>
              </div></details>
            )}
          </span>
        )}
      </span>
    </li>
  );

  return (
    <div className="jw bil">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${deal.id}?tab=finance`}>{deal.code ?? deal.title}</Link> · <Link href={`/accounts/${a.id}`}>{a.name}</Link></p>
          <span className="jid">{t("Facturación y cobro", "Billing & cash")}</span>
          <span className="grow" />
        </div>
        <div className="jh-title">
          <h1>{t("¿Listo para facturar?", "Ready to Bill?")}</h1>
          <span className={`sig ${verdict.cls}`}>{verdict.text}</span>
        </div>
        <p className="jh-sub">{deal.title} · {t("OC", "PO")} {deal.customerPo ?? "—"} · {t("Facturado", "Invoiced")} USD {i.n2(deal.invoices.reduce((s, x) => s + Number(x.amount), 0))} / {i.n2(deal.amount)}</p>
      </header>

      {/* 1. Ready to bill? — requirements first, the invoice button last */}
      <section className="jblock">
        <div className="jbh"><b>{t("REQUISITOS PARA FACTURAR", "BILLING REQUIREMENTS")}</b><span className="grow" /><span className="src">{t("según el perfil de facturación del cliente y la evidencia registrada", "from the customer's billing profile and the evidence on file")}</span></div>
        {preview && (
          <>
            <p className="quiet-p">{t("Aún no hay entregas. Esto es lo que el cliente pedirá para aceptar la factura:", "Nothing delivered yet. This is what the customer will require to accept the invoice:")}</p>
            <ul className="qv-checks">{preview.map((r) => <ReqRow key={r.key} r={r} deliveryId={null} />)}</ul>
          </>
        )}
        {!preview && pending.length === 0 && <p className="quiet-p">{t("Todas las entregas tienen factura. Lo que sigue es el cobro.", "Every delivery has an invoice. What follows is collection.")}</p>}
        <div className="bil-dels">
          {pending.map(({ d, reqs, missing, amount, part }) => (
            <div key={d.id} className={`bil-del ${missing.length ? "no" : "ok"}`}>
              <div className="bil-del-h">
                <Link href={`/operaciones/remisiones/${d.id}`} className="val">{d.code}</Link>
                <span className="src">{i.day(d.deliveredAt)} · {part.thisOne}{part.ordered ? ` / ${part.ordered}` : ""} {t("unid.", "units")} · USD {i.n2(amount)}</span>
                {part.partial && <span className="sig info">{t("Parcial", "Partial")}</span>}
                <span className="grow" />
                <span className={`sig ${missing.length ? "attn" : "ok"}`}>{missing.length ? t(`Faltan ${missing.length}`, `${missing.length} missing`) : t("Listo para facturar", "Ready to bill")}</span>
              </div>
              <ul className="qv-checks">{reqs.map((r) => <ReqRow key={r.key} r={r} deliveryId={d.id} />)}</ul>
              <div className="bil-issue">
                {missing.length === 0 ? (
                  editable ? (
                    seller.invoiceMode === "EXTERNAL" ? (
                      <form action={recordExternalInvoice.bind(null, deal.id, d.id)} className="qa-form" style={{ maxWidth: 620 }}>
                        <b className="small">{t(`Vende ${seller.legalName}: la factura legal se emite por DIAN en el sistema contable. Regístrala aquí.`, `${seller.legalName} sells: the legal invoice is issued through DIAN in the accounting system. Record it here.`)}</b>
                        <div className="qa-row">
                          <label>{t("Número de la factura electrónica", "Electronic invoice number")}<input name="number" required maxLength={40} placeholder="FE-1234" /></label>
                          <label style={{ flex: "0 0 auto" }}>{t("Fecha", "Date")}<input name="issuedAt" type="date" required defaultValue={dayInput(today())} /></label>
                        </div>
                        <div className="qa-row">
                          <label style={{ flex: "0 0 130px" }}>{t("Moneda", "Currency")}<select name="docCurrency" defaultValue="COP"><option value="COP">COP</option><option value="USD">USD</option></select></label>
                          <label>{t("Total de la factura, con IVA", "Invoice total, with IVA")}<input name="docTotal" type="number" min={0} step="0.01" required /></label>
                        </div>
                        <button type="submit">{t(`Registrar factura · USD ${i.n2(amount)} antes de IVA`, `Record invoice · USD ${i.n2(amount)} before IVA`)}</button>
                        <span className="src">{t(`Vence a ${a.paymentTermsDays} días desde esa fecha. En SOLU el cobro y la Eságara se llevan en USD antes de IVA; el total legal queda como referencia.`, `Due in ${a.paymentTermsDays} days from that date. In SOLU collection and Eságara are kept in USD before IVA; the legal total is kept for reference.`)}</span>
                      </form>
                    ) : (
                    <form action={issueFromReadiness.bind(null, deal.id, d.id)} className="qa-row">
                      <button type="submit">{t(`Emitir factura · USD ${i.n2(amount)}`, `Issue invoice · USD ${i.n2(amount)}`)}</button>
                      <span className="src">{t(`Vence a ${a.paymentTermsDays} días. Se crea en SOLU; el envío a contabilidad es un paso aparte y confirmado.`, `Due in ${a.paymentTermsDays} days. Created in SOLU; sending it to accounting is a separate, confirmed step.`)}</span>
                    </form>
                    )
                  ) : <span className="src">{t("Listo. Lo emite el responsable del Journey.", "Ready. The Journey owner issues it.")}</span>
                ) : (
                  <span className="src">{t(`La factura se habilita cuando estén los ${missing.length} requisitos que faltan: ${missing.map((m) => m.label).join(", ")}.`, `The invoice unlocks once the ${missing.length} missing requirements are on file: ${missing.map((m) => m.label).join(", ")}.`)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Cash that arrived without allocation: never "Invoice paid" */}
      {unalloc.map(({ p, rest, kind, applied }) => (
        <section key={p.id} className={`fwd-banner ${kind === "OVERPAYMENT" ? "attn" : "info"} bil-cash`}>
          <span className="k">{kind === "OVERPAYMENT" ? t("Sobrepago · dinero sin factura abierta", "Overpayment · cash with no open invoice") : t("Dinero recibido / asignación pendiente", "Cash received / allocation pending")}</span>
          <b>{t(`USD ${i.n2(rest)} recibidos el ${i.day(p.receivedAt)}${p.reference ? ` · ref. ${p.reference}` : " · sin referencia"}`, `USD ${i.n2(rest)} received on ${i.day(p.receivedAt)}${p.reference ? ` · ref. ${p.reference}` : " · no reference"}`)}</b>
          <p>{kind === "OVERPAYMENT"
            ? t(`De un pago de USD ${i.n2(p.amount)}, USD ${i.n2(applied)} ya están asignados y no quedan facturas abiertas de ${a.name}. Decide: saldo a favor del cliente, devolución o confirmar con el cliente.`, `Of a USD ${i.n2(p.amount)} payment, USD ${i.n2(applied)} is already allocated and ${a.name} has no open invoices left. Decide: customer credit, refund, or confirm with the customer.`)
            : t(`Está en el banco, pero ninguna factura queda pagada hasta asignarlo y conciliarlo. ${a.name} tiene ${openInv.length} ${openInv.length === 1 ? "factura abierta" : "facturas abiertas"}; un pago puede cubrir varias.`, `It's in the bank, but no invoice is paid until it's allocated and reconciled. ${a.name} has ${openInv.length} open ${openInv.length === 1 ? "invoice" : "invoices"}; one payment can cover several.`)}</p>
          {p.residualNote && <p className="src">{t("Decisión sobre el sobrante", "Decision on the leftover")}: {p.residualNote}</p>}
          <div className="qa-row">
            <details className="qa"><summary className="qa-btn">{kind === "OVERPAYMENT" ? t("Decidir sobre el sobrante", "Decide on the leftover") : t("Asignar a facturas", "Allocate to invoices")}</summary><div className="qa-pop wide">
              <form action={allocateCash.bind(null, deal.id, p.id)} className="qa-form">
                {openInv.length > 0 && (
                  <table className="bil-alloc">
                    <thead><tr><th>{t("Factura", "Invoice")}</th><th className="n">{t("Abierto", "Open")}</th><th className="n">{t("Asignar", "Allocate")}</th></tr></thead>
                    <tbody>{openInv.map((x) => (
                      <tr key={x.inv.id}>
                        <td><span className="mono">{x.inv.number}</span> <span className="src">{x.inv.deal.code}{x.inv.dealId === deal.id ? ` · ${t("este Journey", "this Journey")}` : ""} · {t("vence", "due")} {i.dateShort(x.inv.dueAt)}</span></td>
                        <td className="n mono">{i.n2(x.room)}</td>
                        <td className="n"><input name={`apply_${x.inv.id}`} type="number" step="0.01" min="0" max={Math.min(x.room, rest).toFixed(2)} aria-label={`${t("Asignar a", "Allocate to")} ${x.inv.number}`} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                <label>{t("Qué hacer con lo que sobre", "What to do with any leftover")}<input name="residualNote" placeholder={t("Ej.: saldo a favor; confirmado con Tesorería del cliente", "E.g.: customer credit; confirmed with their treasury")} /></label>
                <span className="src">{t("Asignar no es conciliar: la factura sigue abierta hasta que Tesorería concilie.", "Allocating isn't reconciling: the invoice stays open until Treasury reconciles.")}</span>
                <button type="submit">{t("Guardar", "Save")}</button>
              </form>
            </div></details>
            {manager && applied > 0.005 && p.residualNote && <form action={reconcileCash.bind(null, deal.id, p.id)}><button type="submit" className="qa-btn">{t("Conciliar", "Reconcile")}</button></form>}
          </div>
        </section>
      ))}

      <div className="jbody">
        <div className="jmain">
          {/* 2. Invoices: four separate dates */}
          <section className="jblock">
            <div className="jbh"><b>{t("FACTURAS · CUATRO VERDADES DEL COBRO", "INVOICES · FOUR CASH TRUTHS")}</b><span className="grow" /><span className="src">{t("vencimiento ≠ esperado ≠ prometido ≠ cobrado", "due ≠ expected ≠ promised ≠ collected")}</span></div>
            {views.length === 0 ? <p className="quiet-p">{t("Aún no hay facturas en este Journey.", "No invoices on this Journey yet.")}</p> : (
              <div className="bil-invs">
                {views.map((v) => {
                  const S = syncLabel(i, v.inv.syncState);
                  const dueGap = v.paid ? null : (v.expected.date ? Math.round((v.expected.date.getTime() - v.due.getTime()) / 864e5) : null);
                  return (
                    <div key={v.inv.id} id={`inv-${v.inv.id}`} className="bil-inv">
                      <div className="bil-inv-h">
                        <b className="mono">{v.inv.number}</b>
                        <span className="src">USD {i.n2(v.c.amount)}{v.inv.delivery ? ` · ${v.inv.delivery.code}` : ""} · {t("emitida", "issued")} {i.day(v.inv.issuedAt)}</span>
                        {v.inv.partial && <span className="sig info">{t("Parcial", "Partial")}</span>}
                        {v.inv.external ? <span className="sig info">{t(`Factura DIAN${v.inv.docTotal != null ? ` · ${v.inv.docCurrency} ${v.inv.docCurrency === "COP" ? i.n(v.inv.docTotal) : i.n2(v.inv.docTotal)} con IVA` : ""}`, `DIAN invoice${v.inv.docTotal != null ? ` · ${v.inv.docCurrency} ${v.inv.docCurrency === "COP" ? i.n(v.inv.docTotal) : i.n2(v.inv.docTotal)} with IVA` : ""}`)}</span> : <a className="small" href={`/documentos/factura/${v.inv.id}`} target="_blank" rel="noopener">PDF</a>}
                        <span className="grow" />
                        <span className={`sig ${v.status.tone}`}>{v.status.label}</span>
                      </div>
                      <div className="ftruths four">
                        <div className="ft"><span className="k">{t("VENCIMIENTO CONTRACTUAL", "CONTRACTUAL DUE")}</span><b className="mono">{i.dateShort(v.due)}</b><span className="src">{t(`${a.paymentTermsDays} días desde la emisión`, `${a.paymentTermsDays} days from issue`)}{!v.paid && v.due < now ? t(` · vencida hace ${Math.round((now.getTime() - v.due.getTime()) / 864e5)} d`, ` · ${Math.round((now.getTime() - v.due.getTime()) / 864e5)} d past due`) : ""}</span></div>
                        <div className="ft solu"><span className="k">{t("SOLU ESPERA EL DINERO", "SOLU EXPECTED CASH")}</span><b className="mono">{v.expected.date ? `${v.paid ? "" : "≈ "}${i.dateShort(v.expected.date)}` : t("Sin fecha", "No date")}</b><span className="src">{v.expected.basis}{dueGap ? t(` · ${dueGap > 0 ? "+" : ""}${dueGap} d vs vencimiento`, ` · ${dueGap > 0 ? "+" : ""}${dueGap} d vs due`) : ""}</span></div>
                        <div className={`ft prom${v.promise?.broken ? " broken" : ""}`}><span className="k">{t("PROMETIDO POR EL CLIENTE", "CUSTOMER PROMISED")}</span><b className="mono">{v.promise ? i.dateShort(v.promise.date) : "—"}</b><span className="src">{v.promise ? `${v.promise.broken ? t("incumplida · ", "broken · ") : ""}${v.promise.by} · ${v.promise.source}` : t("sin promesa registrada", "no promise recorded")}</span></div>
                        <div className={`ft act ${v.actual.tone}`}><span className="k">{t("COBRO REAL", "ACTUAL CASH")}</span><b className="mono">{v.actual.date ? i.dateShort(v.actual.date) : "—"}</b><span className="src">{v.actual.label}</span></div>
                      </div>

                      {v.inv.applications.length > 0 && (
                        <ul className="bil-apps">
                          {v.inv.applications.map((ap) => (
                            <li key={ap.id}>
                              <span className="mono">{i.day(ap.payment.receivedAt)}</span>
                              <span>USD {i.n2(ap.amount)}{Number(ap.payment.amount) - Number(ap.amount) > 0.005 ? t(` de un pago de ${i.n2(ap.payment.amount)}`, ` of a ${i.n2(ap.payment.amount)} payment`) : ""} · {ap.payment.reference ? `ref. ${ap.payment.reference}` : t("sin referencia", "no reference")}</span>
                              {ap.payment.reconciledAt
                                ? <span className="sig ok">{t(`Conciliado ${i.day(ap.payment.reconciledAt)}`, `Reconciled ${i.day(ap.payment.reconciledAt)}`)}</span>
                                : <span className="sig info">{t("Recibido · conciliación pendiente", "Received · reconciliation pending")}</span>}
                              {!ap.payment.reconciledAt && manager && <form action={reconcileCash.bind(null, deal.id, ap.paymentId)}><button type="submit" className="linkb">{t("Conciliar", "Reconcile")}</button></form>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {v.shortPay && (
                        <p className="small attn-t">{t(`El cliente pagó USD ${i.n2(v.shortPay.amount)} menos.`, `The customer paid USD ${i.n2(v.shortPay.amount)} less.`)} {v.shortPay.note ? `${t("Motivo", "Reason")}: ${v.shortPay.note}.` : t("Falta el motivo (retención, descuento, comisión bancaria).", "Reason missing (withholding, deduction, bank fee).")} {t("El saldo sigue abierto hasta una nota crédito o el pago del resto.", "The balance stays open until a credit note or the rest is paid.")}</p>
                      )}

                      <div className="bil-sync">
                        <span className={`sig ${S.cls}`}>{S.text}</span>
                        {v.inv.externalId && <span className="mono small">{v.inv.externalSystem ? `${v.inv.externalSystem} · ` : ""}{v.inv.externalId}</span>}
                        {v.inv.syncAt && <span className="src">{i.day(v.inv.syncAt)}</span>}
                        {v.inv.syncNote && <span className="src">· {v.inv.syncNote}</span>}
                      </div>
                      {v.inv.syncState === "UNCERTAIN" && <p className="small risk-t">{t("No sabemos si el sistema contable creó la factura. No la reenvíes: búscala primero por número y monto, y registra su ID si existe.", "We don't know whether the accounting system created the invoice. Don't resend it: search for it by number and amount first, and record its ID if it exists.")}</p>}

                      {editable && (
                        <div className="qa-bar">
                          {!v.paid && (
                            <details className="qa"><summary className="qa-btn">{t("Registrar promesa de pago", "Record payment promise")}</summary><div className="qa-pop wide">
                              <form action={recordPayPromise.bind(null, v.inv.id)} className="qa-form">
                                <label>{t("Fecha que promete", "Promised date")}<input name="promisedFor" type="date" required defaultValue={addDays(now, 1).toISOString().slice(0, 10)} /></label>
                                <label>{t("Quién lo promete", "Who promises")}<input name="promisedBy" required defaultValue={v.promise?.by ?? ""} /></label>
                                <label>{t("Fuente", "Source")}<input name="source" required placeholder={t("Ej.: llamada de hoy", "E.g.: today's call")} /></label>
                                <span className="src">{t("No cambia el vencimiento: se guarda como una verdad aparte.", "It doesn't change the due date: it's kept as a separate truth.")}</span>
                                <button type="submit">{t("Guardar promesa", "Save promise")}</button>
                              </form>
                            </div></details>
                          )}
                          {v.inv.syncState !== "CONFIRMED" && (
                            <details className="qa"><summary className="qa-btn">{t("Puente contable", "Accounting bridge")}</summary><div className="qa-pop wide">
                              <form action={accountingBridge.bind(null, v.inv.id, "CONFIRMED")} className="qa-form">
                                <label>{t("Sistema contable", "Accounting system")}<input name="externalSystem" defaultValue={v.inv.externalSystem ?? ""} placeholder="QuickBooks, Siigo…" /></label>
                                <label>{t("ID que devolvió", "ID it returned")}<input name="externalId" required /></label>
                                <button type="submit">{t("Confirmar ID contable", "Confirm accounting ID")}</button>
                              </form>
                              {v.inv.syncState === "NOT_SENT" && (
                                <form action={accountingBridge.bind(null, v.inv.id, "SENT")} className="qa-form" style={{ marginTop: 8 }}>
                                  <input type="hidden" name="externalSystem" value={v.inv.externalSystem ?? ""} />
                                  <button type="submit" className="secondary">{t("Enviada, esperando su ID", "Sent, waiting for its ID")}</button>
                                </form>
                              )}
                              {v.inv.syncState !== "UNCERTAIN" && (
                                <form action={accountingBridge.bind(null, v.inv.id, "UNCERTAIN")} className="qa-form" style={{ marginTop: 8 }}>
                                  <label>{t("Qué pasó", "What happened")}<input name="note" placeholder={t("Ej.: error de conexión al enviar", "E.g.: connection error while sending")} /></label>
                                  <button type="submit" className="secondary">{t("No sabemos si se creó", "Unsure whether it was created")}</button>
                                </form>
                              )}
                            </div></details>
                          )}
                          {!v.paid && (v.shortPay || v.c.reconciled > 0.005) && (
                            <details className="qa"><summary className="qa-btn">{t("Motivo del pago corto", "Short-payment reason")}</summary><div className="qa-pop wide">
                              <form action={markShortPay.bind(null, v.inv.id)} className="qa-form">
                                <label>{t("Por qué pagó menos", "Why they paid less")}<input name="note" required defaultValue={v.inv.shortPayNote ?? ""} placeholder={t("Ej.: retención en la fuente 2 %", "E.g.: 2 % withholding tax")} /></label>
                                <button type="submit">{t("Guardar", "Save")}</button>
                              </form>
                            </div></details>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 3. Cash future timeline */}
          {tl && (
            <section className="jblock">
              <div className="jbh"><b>{t("DINERO HACIA ADELANTE", "CASH FUTURE")}</b><span className="grow" /><span className="src">{i.dateShort(tl.start)} → {i.dateShort(tl.end)}</span></div>
              <div className="ctl" role="img" aria-label={t("Línea de cobro por factura", "Cash timeline per invoice")}>
                {views.map((v) => (
                  <div key={v.inv.id} className="ctl-row">
                    <span className="ctl-lb"><span className="mono">{v.inv.number.slice(-4)}</span><span className="src">USD {i.n(v.c.balance > 0.005 ? v.c.balance : v.c.amount)}</span></span>
                    <div className="ctl-track">
                      <span className="ctl-today" style={{ left: `${tl.nowPos}%` }} />
                      {!v.paid && <span className="ctl-mk due" style={{ left: `${tl.pos(v.due)}%` }} title={`${t("Vencimiento", "Due")} · ${i.day(v.due)}`} />}
                      {!v.paid && v.promise && <span className={`ctl-mk prom${v.promise.broken ? " broken" : ""}`} style={{ left: `${tl.pos(v.promise.date)}%` }} title={`${t("Promesa", "Promise")} · ${i.day(v.promise.date)}${v.promise.broken ? ` · ${t("incumplida", "broken")}` : ""}`} />}
                      {v.expected.date && <span className={`ctl-mk ${v.paid ? "paid" : "exp"}`} style={{ left: `${tl.pos(v.expected.date)}%` }} title={`${v.paid ? t("Cobrada", "Collected") : t("SOLU espera", "SOLU expects")} · ${i.day(v.expected.date)}`}>{v.paid ? "✓" : ""}</span>}
                      {!v.paid && !v.expected.date && <span className="ctl-none" style={{ left: `${tl.nowPos}%` }}>{t("sin fecha creíble", "no credible date")}</span>}
                    </div>
                  </div>
                ))}
                <div className="ctl-axis"><span>{i.dateShort(tl.start)}</span><span className="ctl-now" style={{ left: `calc(86px + (100% - 96px) * ${tl.nowPos / 100})` }}>{t("Hoy", "Today")}</span><span>{i.dateShort(tl.end)}</span></div>
              </div>
              <div className="ctl-legend src">
                <span><i className="ctl-mk due" /> {t("vencimiento", "due")}</span>
                <span><i className="ctl-mk prom" /> {t("promesa del cliente", "customer promise")}</span>
                <span><i className="ctl-mk exp" /> {t("SOLU espera", "SOLU expects")}</span>
                <span><i className="ctl-mk paid" /> {t("cobrado y conciliado", "collected & reconciled")}</span>
              </div>
            </section>
          )}
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("PERFIL DE FACTURACIÓN", "BILLING PROFILE")}</b><span className="grow" /><Link href={`/accounts/${a.id}`} className="small">{t("Cliente", "Customer")}</Link></div>
            <dl className="filedl">
              <dt>{t("Plazo", "Terms")}</dt><dd>{a.paymentTermsDays} {t("días", "days")}</dd>
              <dt>{t("Parciales", "Partials")}</dt><dd>{a.allowsPartialBilling ? t("Acepta facturas parciales", "Accepts partial invoices") : t("Solo factura completa", "Full invoice only")}</dd>
              <dt>{t("Cód. recepción", "Receiving code")}</dt><dd>{a.requiresReceptionCode ? t("Obligatorio", "Required") : t("No", "No")}</dd>
              <dt>Portal</dt><dd>{a.requiresPortal ? (a.portalValidUntil ? (a.portalValidUntil >= now ? t(`Sí · vigente hasta ${i.day(a.portalValidUntil)}`, `Yes · valid until ${i.day(a.portalValidUntil)}`) : <span className="attn-t">{t(`Sí · venció el ${i.day(a.portalValidUntil)}`, `Yes · expired ${i.day(a.portalValidUntil)}`)}</span>) : <span className="attn-t">{t("Sí · sin registro", "Yes · not registered")}</span>) : t("No", "No")}</dd>
              <dt>{t("Tributario", "Tax")}</dt><dd>{a.taxDataComplete ? (a.taxId ?? t("Completo", "Complete")) : <span className="attn-t">{t("Incompleto", "Incomplete")}</span>}</dd>
              <dt>{t("Factura a", "Invoices to")}</dt><dd>{a.billingContact ?? deal.contact?.email ?? "—"}</dd>
              <dt>{t("Historial", "History")}</dt><dd>{hist.n ? (hist.avg > 0 ? t(`paga ~${hist.avg} d tarde`, `pays ~${hist.avg} d late`) : t("paga a tiempo", "pays on time")) : t("sin historial", "no history")}</dd>
            </dl>
          </div>
          {deal.billingRequests.length > 0 && (
            <div>
              <div className="jbh"><b>{t("SOLICITUDES DE EVIDENCIA", "EVIDENCE REQUESTS")}</b></div>
              <ul className="plain small">
                {deal.billingRequests.slice(0, 8).map((r) => (
                  <li key={r.id}><b>{({ PO: t("OC", "PO"), POD: "POD", RECEPTION_CODE: t("Cód. recepción", "Receiving code"), PORTAL: "Portal", TAX: t("Tributario", "Tax"), PARTIAL: t("Parcial", "Partial") } as Record<string, string>)[r.kind] ?? r.kind}</b> · {r.resolvedAt ? <span className="ok-t">{t(`recibido ${i.day(r.resolvedAt)}`, `received ${i.day(r.resolvedAt)}`)}</span> : <span className="attn-t">{t(`pedido ${i.day(r.requestedAt)}`, `requested ${i.day(r.requestedAt)}`)}</span>}<span className="src block">{r.requestedBy.name}{r.sentTo ? ` → ${r.sentTo}` : ""}{r.note ? ` · ${r.note}` : ""}</span></li>
                ))}
              </ul>
            </div>
          )}
          <div className="qa-bar col">
            <Link className="qa-btn" href="/administracion/pagos-recibidos">{t("Registrar dinero recibido en el banco", "Record cash received in the bank")}</Link>
            <Link className="qa-btn" href="/administracion/cobrar">{t("Ver todas las cuentas por cobrar", "See all receivables")}</Link>
          </div>
          <p className="note ai">{t("Un ingreso en el banco nunca marca una factura como pagada por sí solo. Queda «pagada» cuando el dinero se asigna a ella y Tesorería lo concilia.", "A bank receipt never marks an invoice paid on its own. It's “paid” once the cash is allocated to it and Treasury reconciles it.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
