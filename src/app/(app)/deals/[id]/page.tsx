import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput, esagra, invoiceCash, today } from "@/lib/domain";
import { stageLabel } from "@/lib/labels";
import { logActivity } from "../../activities/actions";
import {
  acceptCustomerPo,
  addItem,
  completeNextMove,
  deleteDeal,
  markResultAchieved,
  removeItem,
  setNextMove,
  setWaiting,
  updateJourney,
} from "../actions";
import { createSupplierPo, markSupplierPo } from "../../operaciones/actions";
import { requestSupplierPayment } from "../../administracion/actions";

export default async function JourneyPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const now = today();

  const deal = await db.deal.findUnique({
    where: { id },
    include: {
      account: true,
      contact: true,
      owner: { select: { id: true, name: true } },
      items: { include: { deliveryLines: { select: { qty: true } } }, orderBy: { id: "asc" } },
      supplierPos: {
        include: { supplier: true, payments: { orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "asc" },
      },
      deliveries: { include: { lines: true, invoice: { select: { id: true, number: true } } }, orderBy: { deliveredAt: "asc" } },
      invoices: {
        include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } },
        orderBy: { issuedAt: "asc" },
      },
      tasks: { where: { status: "OPEN" }, include: { assignee: { select: { name: true } } }, orderBy: { dueDate: "asc" } },
      activities: { orderBy: { occurredAt: "desc" }, take: 30, include: { user: { select: { name: true } } } },
    },
  });
  if (!deal) notFound();
  const suppliers = await db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } });

  const editable = canEdit(user, deal.ownerId);
  const eg = esagra(deal);
  const won = deal.stage === "WON";
  const ordered = deal.items.reduce((s, it) => s + it.qty, 0);
  const delivered = deal.items.reduce((s, it) => s + it.deliveryLines.reduce((x, l) => x + l.qty, 0), 0);
  const invoiced = deal.invoices.reduce((s, inv) => s + Number(inv.amount), 0);
  const cash = deal.invoices.map(invoiceCash);
  const reconciled = cash.reduce((s, c) => s + c.reconciled, 0);
  const anyPayment = deal.supplierPos.some((p) => p.payments.length > 0);
  const allPaid = deal.supplierPos.length > 0 && deal.supplierPos.every((p) => p.payments.some((x) => x.executedAt));
  const anyShipped = deal.supplierPos.some((p) => p.shippedAt);
  const fullyDelivered = ordered > 0 ? delivered >= ordered : deal.deliveries.length > 0;
  const fullyInvoiced = Number(deal.amount) > 0 && invoiced >= Number(deal.amount) - 0.5;
  const fullyCollected = fullyInvoiced && cash.every((c) => c.balance <= 0.005);

  // Journey genealogy: Need → Customer PO → Purchase → Payment → Shipment → Delivery → Invoice → Cash → Result
  type Step = { label: string; state: "done" | "part" | "todo" };
  const steps: Step[] = [
    { label: t("Necesidad", "Need"), state: "done" },
    { label: t("OC cliente", "Customer PO"), state: deal.customerPo ? "done" : "todo" },
    { label: t("Compra", "Purchase"), state: deal.supplierPos.length ? (deal.supplierPos.every((p) => p.confirmedAt) ? "done" : "part") : "todo" },
    { label: t("Pago", "Payment"), state: allPaid ? "done" : anyPayment ? "part" : "todo" },
    { label: t("Envío", "Shipment"), state: deal.supplierPos.length && deal.supplierPos.every((p) => p.receivedAt) ? "done" : anyShipped ? "part" : "todo" },
    { label: t("Entrega", "Delivery"), state: fullyDelivered ? "done" : delivered > 0 ? "part" : "todo" },
    { label: t("Factura", "Invoice"), state: fullyInvoiced ? "done" : invoiced > 0 ? "part" : "todo" },
    { label: t("Cobro", "Cash"), state: fullyCollected ? "done" : reconciled > 0 ? "part" : "todo" },
    { label: t("Resultado", "Result"), state: deal.resultAchievedAt ? "done" : "todo" },
  ];

  const waiting = !!deal.waitingFor;
  const moveLate = deal.nextMoveDate && deal.nextMoveDate < now;
  const closed = deal.stage === "LOST" || (!!deal.resultAchievedAt && fullyCollected);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link> · {t("Journey", "Journey")}</div>
          <h1>{deal.code ? `${deal.code} · ` : ""}{deal.title}</h1>
          <p>
            <Link href={`/accounts/${deal.account.id}`}>{deal.account.name}</Link>
            {deal.contact && <> · {deal.contact.firstName} {deal.contact.lastName}</>}
            {" · "}{t("Responsable", "Owner")}: {deal.owner.name}
            {" · "}<span className={`badge ${deal.stage === "WON" ? "won" : deal.stage === "LOST" ? "lost" : ""}`}>{stageLabel(i, deal.stage)}</span>
          </p>
        </div>
      </div>

      <section className="sum" aria-label={t("Resumen", "Summary")}>
        <div>
          <span className="k">{t("Resultado deseado", "Desired result")}</span>
          <span className="s" style={{ fontSize: 13, color: "var(--ink)" }}>{deal.desiredResult ?? t("Aún sin definir", "Not defined yet")}</span>
        </div>
        <div>
          <span className="k">{t("Promesa al cliente", "Customer promise")}</span>
          <span className="s" style={{ fontSize: 13, color: "var(--ink)" }}>{deal.promiseText ?? "—"}</span>
          <span className="s">{deal.promisedDate ? i.dateShort(deal.promisedDate) : ""}</span>
        </div>
        <div>
          <span className="k">{t("Venta", "Sale")}</span>
          <span className="v">{i.n(deal.amount)}</span>
          <span className="s">USD</span>
        </div>
        <div title={t("Esagra = venta − costo del proveedor − fletes − otros costos", "Esagra = sale − supplier cost − freight − other costs")}>
          <span className="k">{t("Esagra", "Esagra")}</span>
          <span className="v">{i.n(eg.value)}</span>
          <span className="s">{i.pct(eg.pct)} · {t("calculada", "calculated")}</span>
        </div>
      </section>

      <div className="two">
        <div className="stack-lg">
          <div className="card">
            <div className="bhead"><h2>{t("Cadena del Journey", "Journey chain")}</h2></div>
            <div className="row" style={{ gap: 4 }}>
              {steps.map((s, k) => (
                <span key={s.label} className="row" style={{ gap: 4 }}>
                  <span className={`sig ${s.state === "done" ? "ok" : s.state === "part" ? "attn" : "wait"}`}>
                    {s.state === "done" ? "✓ " : ""}{s.label}
                  </span>
                  {k < steps.length - 1 && <span className="muted">→</span>}
                </span>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="bhead"><h2>{t("Productos", "Products")}</h2><span className="grow" /><span className="src">{t("Entregado", "Delivered")} {delivered} / {ordered}</span></div>
            {deal.items.length === 0 ? (
              <p className="small muted">{t("Sin productos. Agrégalos para poder remisionar entregas parciales.", "No products yet. Add them to allow partial deliveries.")}</p>
            ) : (
              <table>
                <thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th className="n">Total</th><th>{t("Entregado", "Delivered")}</th><th /></tr></thead>
                <tbody>
                  {deal.items.map((it) => {
                    const d = it.deliveryLines.reduce((s, l) => s + l.qty, 0);
                    return (
                      <tr key={it.id}>
                        <td className="val">{it.qty}</td>
                        <td className="mono small">{it.code ?? "—"}</td>
                        <td>{it.description}</td>
                        <td className="n val">{i.n2(it.unitPrice)}</td>
                        <td className="n val">{i.n2(Number(it.unitPrice) * it.qty)}</td>
                        <td><span className={`sig ${d >= it.qty ? "ok" : d > 0 ? "attn" : "wait"}`}>{d} / {it.qty}</span></td>
                        <td>
                          {editable && d === 0 && (
                            <form action={removeItem.bind(null, deal.id, it.id)}><button className="link small" type="submit">{t("Quitar", "Remove")}</button></form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {editable && (
              <details style={{ marginTop: 10 }}>
                <summary>{t("Agregar producto", "Add product")}</summary>
                <form action={addItem.bind(null, deal.id)} className="inline">
                  <label>{t("Cant.", "Qty")}<input name="qty" type="number" min="1" defaultValue="1" required style={{ width: 70 }} /></label>
                  <label>{t("Código", "Code")}<input name="code" style={{ width: 120 }} /></label>
                  <label style={{ flex: 1 }}>{t("Descripción", "Description")}<input name="description" required /></label>
                  <label>{t("Precio unit. USD", "Unit price USD")}<input name="unitPrice" type="number" min="0" step="0.01" required style={{ width: 120 }} /></label>
                  <button type="submit">{t("Agregar", "Add")}</button>
                </form>
              </details>
            )}
          </div>

          <div className="card">
            <div className="bhead"><h2>{t("Compra a proveedores", "Supplier purchasing")}</h2></div>
            {deal.supplierPos.length === 0 ? (
              <p className="small muted">{t("Aún no hay Supplier PO para este Journey.", "No supplier PO for this Journey yet.")}</p>
            ) : (
              <table>
                <thead><tr><th>Supplier PO</th><th>{t("Proveedor", "Supplier")}</th><th className="n">{t("Valor", "Amount")}</th><th>{t("Estado derivado", "Derived state")}</th><th>{t("Pago", "Payment")}</th><th /></tr></thead>
                <tbody>
                  {deal.supplierPos.map((p) => {
                    const pay = p.payments[0];
                    const st = p.receivedAt
                      ? { c: "ok", x: t(`Recibido ${i.day(p.receivedAt)}`, `Received ${i.day(p.receivedAt)}`) }
                      : p.shippedAt
                        ? { c: "wait", x: t(`En tránsito · ETA ${i.day(p.eta)}`, `In transit · ETA ${i.day(p.eta)}`) }
                        : p.confirmedAt
                          ? { c: "info", x: t("Confirmada por el proveedor", "Confirmed by supplier") }
                          : { c: "attn", x: t("Sin confirmar", "Not confirmed") };
                    return (
                      <tr key={p.id}>
                        <td className="val">{p.code}</td>
                        <td><Link href={`/suppliers#${p.supplier.id}`}>{p.supplier.name}</Link></td>
                        <td className="n val">{p.currency} {i.n2(p.amount)}</td>
                        <td><span className={`sig ${st.c}`}>{st.x}</span></td>
                        <td>
                          {pay ? (
                            <Link href={`/administracion/pagos-proveedores/${pay.id}`} className="small">
                              {pay.executedAt ? t("Pagado", "Paid") : t("Ver pago", "View payment")}
                            </Link>
                          ) : editable ? (
                            <details>
                              <summary className="small">{t("Solicitar pago", "Request payment")}</summary>
                              <form action={requestSupplierPayment.bind(null, p.id)} className="stack" style={{ minWidth: 280 }}>
                                <div className="row">
                                  <label>{t("Monto", "Amount")}<input name="amount" type="number" step="0.01" min="0" defaultValue={Number(p.amount)} required style={{ width: 110 }} /></label>
                                  <label>{t("Moneda", "Currency")}<input name="currency" defaultValue={p.currency} style={{ width: 60 }} /></label>
                                  <label>≈ USD<input name="amountUsd" type="number" step="0.01" min="0" style={{ width: 100 }} /></label>
                                </div>
                                <label>{t("Por qué debe moverse este dinero", "Why this money must move")}<input name="reason" required placeholder={t("Ej.: el proveedor despacha al confirmar el pago", "E.g. supplier ships on payment")} /></label>
                                <label>{t("Pagar a más tardar", "Pay by")}<input name="dueBy" type="date" /></label>
                                <span className="src">{t("Datos bancarios tal como vienen en la proforma o instrucción del proveedor:", "Bank data exactly as on the supplier's proforma or instruction:")}</span>
                                <label>{t("Beneficiario", "Beneficiary")}<input name="docBeneficiary" /></label>
                                <label>{t("Banco", "Bank")}<input name="docBankName" /></label>
                                <label>{t("Cuenta / IBAN", "Account / IBAN")}<input name="docAccount" /></label>
                                <label>SWIFT<input name="docSwift" /></label>
                                <label>{t("Documento de origen", "Source document")}<input name="docSource" placeholder={t("Proforma PF-…", "Proforma PF-…")} /></label>
                                <button type="submit">{t("Preparar pago", "Prepare payment")}</button>
                              </form>
                            </details>
                          ) : "—"}
                        </td>
                        <td>
                          {editable && !p.receivedAt && (
                            <form action={markSupplierPo.bind(null, p.id, !p.confirmedAt ? "confirmedAt" : !p.shippedAt ? "shippedAt" : "receivedAt")} className="stack" style={{ alignItems: "flex-end" }}>
                              {p.confirmedAt && !p.shippedAt && <input name="eta" type="date" aria-label="ETA" title="ETA" style={{ width: 140 }} />}
                              <button className="secondary sm" type="submit">
                                {!p.confirmedAt ? t("Confirmó", "Confirmed") : !p.shippedAt ? t("Despachó", "Shipped") : t("Llegó a bodega", "Received")}
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {editable && (
              <details style={{ marginTop: 10 }}>
                <summary>{t("Nueva Supplier PO", "New supplier PO")}</summary>
                {suppliers.length === 0 ? (
                  <p className="small">{t("Primero crea el proveedor en ", "First create the supplier in ")}<Link href="/suppliers">{t("Proveedores", "Suppliers")}</Link>.</p>
                ) : (
                  <form action={createSupplierPo.bind(null, deal.id)} className="inline">
                    <label>{t("Proveedor", "Supplier")}
                      <select name="supplierId" required defaultValue="">
                        <option value="" disabled>{t("Elegir…", "Choose…")}</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>
                    <label>{t("Valor", "Amount")}<input name="amount" type="number" min="0" step="0.01" required style={{ width: 120 }} /></label>
                    <label>{t("Moneda", "Currency")}<input name="currency" defaultValue="USD" style={{ width: 70 }} /></label>
                    <label>ETA<input name="eta" type="date" /></label>
                    <button type="submit">{t("Crear", "Create")}</button>
                  </form>
                )}
              </details>
            )}
          </div>

          <div className="card">
            <div className="bhead">
              <h2>{t("Entregas y facturas", "Deliveries and invoices")}</h2><span className="grow" />
              {editable && won && !fullyDelivered && (
                <Link className="btn secondary sm" href={`/operaciones/remisiones/nueva?deal=${deal.id}`}>{t("Nueva remisión", "New delivery note")}</Link>
              )}
            </div>
            {deal.deliveries.length === 0 && deal.invoices.length === 0 ? (
              <p className="small muted">{won ? t("Aún no hay entregas.", "No deliveries yet.") : t("Las entregas se registran cuando la OC del cliente está aceptada.", "Deliveries are recorded once the customer PO is accepted.")}</p>
            ) : (
              <table>
                <thead><tr><th>{t("Remisión", "Delivery note")}</th><th>{t("Fecha", "Date")}</th><th>{t("Unidades", "Units")}</th><th>{t("Factura", "Invoice")}</th><th className="n">{t("Saldo", "Balance")}</th></tr></thead>
                <tbody>
                  {deal.deliveries.map((d) => {
                    const inv = deal.invoices.find((x) => x.deliveryId === d.id);
                    const c = inv ? invoiceCash(inv) : null;
                    return (
                      <tr key={d.id}>
                        <td><Link href={`/operaciones/remisiones/${d.id}`} className="val">{d.code}</Link></td>
                        <td>{i.date(d.deliveredAt)}</td>
                        <td className="val">{d.lines.reduce((s, l) => s + l.qty, 0) || "—"}</td>
                        <td>{inv ? <span className="val">{inv.number}</span> : <span className="sig attn">{t("Sin facturar", "Not invoiced")}</span>}</td>
                        <td className="n val">{c ? i.n2(c.balance) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="bhead"><h2>{t("Actividad", "Activity")}</h2></div>
            <form action={logActivity} className="inline" style={{ marginBottom: 8 }}>
              <input type="hidden" name="accountId" value={deal.accountId} />
              <input type="hidden" name="dealId" value={deal.id} />
              <select name="type" defaultValue="NOTE" aria-label={t("Tipo", "Type")}>
                <option value="CALL">{t("Llamada", "Call")}</option>
                <option value="MEETING">{t("Reunión", "Meeting")}</option>
                <option value="EMAIL">{t("Correo", "Email")}</option>
                <option value="NOTE">{t("Nota", "Note")}</option>
              </select>
              <input name="subject" required placeholder={t("Qué pasó", "What happened")} style={{ flex: 1 }} />
              <button type="submit" className="secondary">{t("Registrar", "Log")}</button>
            </form>
            <ul className="timeline">
              {deal.activities.map((a) => (
                <li key={a.id}>
                  <b>{a.subject}</b> {a.body && <span className="small">{a.body}</span>}
                  <div className="src">{a.user.name} · {i.date(a.occurredAt)}</div>
                </li>
              ))}
              {deal.activities.length === 0 && <li className="small muted">{t("Sin actividad todavía.", "No activity yet.")}</li>}
            </ul>
          </div>
        </div>

        <aside className="rail">
          {!closed && (
            <div className="card">
              <span className="k">{waiting ? t("Esperando con control", "Waiting with control") : t("Siguiente movimiento", "Next movement")}</span>
              {waiting ? (
                <p style={{ margin: "6px 0 10px" }}><b>{deal.waitingFor}</b><span className="src block">{t("Revisar el", "Check on")} {i.dateShort(deal.waitingUntil)}</span></p>
              ) : deal.nextMove ? (
                <p style={{ margin: "6px 0 10px" }}>
                  <b>{deal.nextMove}</b>
                  <span className={`src block ${moveLate ? "attn-t" : ""}`}>{deal.nextMoveDate ? i.dateShort(deal.nextMoveDate) : t("sin fecha", "no date")}{moveLate ? t(" · se pasó la fecha", " · date has passed") : ""}</span>
                </p>
              ) : won ? (
                <p style={{ margin: "6px 0 10px" }}>
                  <b>{t("Lo marca la cadena", "Set by the chain")}: {steps.find((s) => s.state !== "done")?.label ?? t("Resultado", "Result")}</b>
                  <span className="src block">{t("SOLU sigue la compra, el pago, la entrega y el cobro. Define un movimiento solo si hace falta algo extra.", "SOLU follows purchase, payment, delivery and cash. Set a movement only if something extra is needed.")}</span>
                </p>
              ) : (
                <p className="note attn" style={{ margin: "6px 0 10px" }}>{t("Este Journey no tiene siguiente movimiento ni espera con control. Conviene definir uno para que no se quede quieto.", "This Journey has no next movement or controlled wait. Worth setting one so it keeps moving.")}</p>
              )}
              {editable && (
                <>
                  {deal.nextMove && (
                    <form action={completeNextMove.bind(null, deal.id)} style={{ marginBottom: 10 }}>
                      <button className="wide" type="submit">{t("Hecho", "Done")}</button>
                    </form>
                  )}
                  <details>
                    <summary>{t("Definir siguiente movimiento", "Set next movement")}</summary>
                    <form action={setNextMove.bind(null, deal.id)} className="stack">
                      <input name="nextMove" required placeholder={t("Ej.: Enviar cotización revisada", "E.g. Send revised quote")} defaultValue={deal.nextMove ?? ""} />
                      <input name="nextMoveDate" type="date" defaultValue={dayInput(deal.nextMoveDate)} />
                      <button className="secondary" type="submit">{t("Guardar", "Save")}</button>
                    </form>
                  </details>
                  <details style={{ marginTop: 8 }}>
                    <summary>{t("Esperar con control", "Wait with control")}</summary>
                    <form action={setWaiting.bind(null, deal.id)} className="stack">
                      <input name="waitingFor" required placeholder={t("Ej.: Que el cliente apruebe el presupuesto", "E.g. Customer budget approval")} />
                      <label>{t("Revisar el", "Check on")}<input name="waitingUntil" type="date" required /></label>
                      <button className="secondary" type="submit">{t("Guardar", "Save")}</button>
                    </form>
                  </details>
                </>
              )}
            </div>
          )}

          {editable && !deal.customerPo && deal.stage !== "LOST" && (
            <div className="card">
              <span className="k">{t("OC del cliente", "Customer PO")}</span>
              <p className="small" style={{ margin: "6px 0 10px" }}>{t("Al registrar la OC, el Journey pasa a OC aceptada y comienza la compra.", "Recording the PO moves the Journey to PO accepted and starts purchasing.")}</p>
              <form action={acceptCustomerPo.bind(null, deal.id)} className="stack">
                <label>{t("Número de OC", "PO number")}<input name="customerPo" required /></label>
                <label>{t("Fecha de aceptación", "Accepted on")}<input name="poAcceptedAt" type="date" defaultValue={dayInput(now)} /></label>
                <button type="submit">{t("Registrar OC", "Record PO")}</button>
              </form>
            </div>
          )}
          {deal.customerPo && (
            <div className="card">
              <dl className="facts">
                <dt>{t("OC del cliente", "Customer PO")}</dt><dd className="mono">{deal.customerPo}</dd>
                <dt>{t("Aceptada", "Accepted")}</dt><dd>{i.date(deal.poAcceptedAt)}</dd>
                <dt>{t("Facturado", "Invoiced")}</dt><dd className="mono">{i.n2(invoiced)} / {i.n2(deal.amount)}</dd>
                <dt>{t("Cobrado y conciliado", "Collected & reconciled")}</dt><dd className="mono">{i.n2(reconciled)}</dd>
              </dl>
              {editable && fullyDelivered && !deal.resultAchievedAt && (
                <form action={markResultAchieved.bind(null, deal.id)} style={{ marginTop: 10 }}>
                  <button className="secondary wide" type="submit">{t("El cliente logró su resultado", "Customer achieved the result")}</button>
                  <span className="src block">{t("Entregar no es resolver: confírmalo con el cliente.", "Delivering is not solving: confirm with the customer.")}</span>
                </form>
              )}
              {deal.resultAchievedAt && <p className="sig ok" style={{ marginTop: 10 }}>✓ {t("Resultado logrado", "Result achieved")} · {i.day(deal.resultAchievedAt)}</p>}
            </div>
          )}

          {editable && (
            <div className="card">
              <details>
                <summary>{t("Datos comerciales y costos", "Commercial data and costs")}</summary>
                <form action={updateJourney.bind(null, deal.id)} className="stack">
                  <label>{t("Título", "Title")}<input name="title" defaultValue={deal.title} required /></label>
                  <label>{t("Resultado deseado por el cliente", "Customer's desired result")}<textarea name="desiredResult" defaultValue={deal.desiredResult ?? ""} /></label>
                  <label>{t("Promesa al cliente", "Customer promise")}<input name="promiseText" defaultValue={deal.promiseText ?? ""} /></label>
                  <label>{t("Fecha prometida", "Promised date")}<input name="promisedDate" type="date" defaultValue={dayInput(deal.promisedDate)} /></label>
                  <label>{t("Venta USD", "Sale USD")}<input name="amount" type="number" min="0" step="0.01" defaultValue={Number(deal.amount)} /></label>
                  <label>{t("Costo del proveedor USD", "Supplier cost USD")}<input name="supplierCost" type="number" min="0" step="0.01" defaultValue={Number(deal.supplierCost)} /></label>
                  <label>{t("Fletes USD", "Freight USD")}<input name="freightCost" type="number" min="0" step="0.01" defaultValue={Number(deal.freightCost)} /></label>
                  <label>{t("Otros costos USD (aranceles, bancos)", "Other costs USD (duties, bank)")}<input name="otherCosts" type="number" min="0" step="0.01" defaultValue={Number(deal.otherCosts)} /></label>
                  <label>{t("Cierre esperado", "Expected close")}<input name="closeDate" type="date" defaultValue={dayInput(deal.closeDate)} /></label>
                  <label>{t("Oferta vigente hasta", "Offer valid until")}<input name="offerValidUntil" type="date" defaultValue={dayInput(deal.offerValidUntil)} /></label>
                  <button type="submit">{t("Guardar", "Save")}</button>
                </form>
              </details>
            </div>
          )}

          <div className="card">
            <div className="bhead"><h2>{t("Pendientes", "To-dos")}</h2></div>
            <ul className="timeline">
              {deal.tasks.map((tk) => (
                <li key={tk.id}>{tk.title}<span className="src block">{tk.assignee.name} · {i.dateShort(tk.dueDate)}</span></li>
              ))}
              {deal.tasks.length === 0 && <li className="small muted">{t("Nada pendiente.", "Nothing pending.")}</li>}
            </ul>
          </div>

          {editable && deal.invoices.length === 0 && (
            <details>
              <summary className="small">{t("Eliminar este Journey", "Delete this Journey")}</summary>
              <form action={deleteDeal.bind(null, deal.id)}>
                <button className="danger sm" type="submit">{t("Eliminar definitivamente", "Delete permanently")}</button>
              </form>
            </details>
          )}
        </aside>
      </div>
    </>
  );
}
