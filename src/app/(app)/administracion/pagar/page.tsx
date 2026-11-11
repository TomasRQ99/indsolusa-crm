import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, daysBetween, today } from "@/lib/domain";
import { sumMoney } from "@/lib/money";
import { MATCH_TEXT, discountOf } from "@/lib/admin-rules";
import { getAdminPolicy, loadSupplierInvoices } from "@/lib/admin-store";
import { treasuryView } from "@/lib/treasury";
import { BUCKETS, dirOf } from "@/lib/treasury-rules";
import { acceptException, acceptService, approveInvoicePayment, markInvoicePaid, recordSupplierInvoice } from "./actions";

// Módulo 14 §2D · Cuentas por pagar: what must be paid today, in 7 and in 30 days; each supplier invoice against
// its order and what was received; discounts that are still open.

export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; ver?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const ops = user.role === "NEGOCIADOR_OPERATIVO";
  if (!canFinance(user) && !ops) return <div className="note risk">{t("Cuentas por pagar es para Administración, Finanzas, Operaciones, Dirección y Gerencia.", "Payables is for Administration, Finance, Operations, Direction and Management.")}</div>;
  const sp = await searchParams;
  const T = today();
  const showPaid = sp.ver === "pagadas";
  const [rows, tv, pol, suppliers, pos, ips] = await Promise.all([
    loadSupplierInvoices(showPaid ? {} : { OR: [{ paidAt: null, supplierPoId: null }, { supplierPoId: { not: null }, createdAt: { gte: new Date(+T - 120 * 864e5) } }] }),
    treasuryView(), getAdminPolicy(),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    db.supplierPO.findMany({ where: { releasedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 150, select: { id: true, code: true, amount: true, currency: true, supplier: { select: { name: true } } } }),
    db.internalPurchase.findMany({ where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 80, select: { id: true, code: true, description: true, amount: true, currency: true } }),
  ]);
  const out = tv.items.filter((x) => dirOf(x.bucket) === "OUT");
  const win = (lo: number, hi: number) => out.filter((x) => x.on && daysBetween(T, x.on) > lo && daysBetween(T, x.on) <= hi);
  const windows = [
    { key: "hoy", label: t("Hoy y vencido", "Today and overdue"), xs: out.filter((x) => x.on && daysBetween(T, x.on) <= 0), tone: "risk-t" },
    { key: "7", label: t("Próximos 7 días", "Next 7 days"), xs: win(0, 7), tone: "" },
    { key: "30", label: t("De 8 a 30 días", "8 to 30 days"), xs: win(7, 30), tone: "" },
    { key: "sf", label: t("Sin fecha", "No date"), xs: out.filter((x) => !x.on), tone: "" },
  ];
  const discounts = rows.filter((r) => !r.paidAt).map((r) => ({ r, d: discountOf(r, T) })).filter((x) => x.d?.open);
  const okMsg: Record<string, string> = { registrada: t("Factura registrada. Abajo está comparada con su orden y lo recibido.", "Invoice recorded. Below it is compared with its order and what was received."), servicio: t("Servicio aceptado.", "Service accepted."), excepcion: t("Diferencia aceptada con su motivo.", "Difference accepted with its reason."), aprobada: t("Pago aprobado. Aprobar no es pagar: falta registrar el pago.", "Payment approved. Approving is not paying: the payment still has to be recorded."), pagada: t("Pago registrado.", "Payment recorded.") };
  const errMsg: Record<string, string> = { permiso: t("No tienes permiso para esto.", "You don't have permission for this."), datos: t("Faltan datos: proveedor, número, fecha, valor y de dónde llegó la factura. No se guardó nada.", "Missing data: supplier, number, date, amount and where the invoice came from. Nothing was saved."), repetida: t("Ese número de factura ya está registrado para ese proveedor.", "That invoice number is already recorded for that supplier."), servicio: t("Escribe qué se recibió para aceptar el servicio.", "Write what was received to accept the service."), excepcion: t("Para aceptar una diferencia hay que escribir el motivo.", "Accepting a difference needs a written reason."), autoridad: t("No puedes decidir esto: por el valor le corresponde a otro nivel, o tú registraste la factura.", "You can't decide this: by its amount it belongs to another level, or you recorded the invoice."), estado: t("Esta factura ya no está en ese estado.", "This invoice is no longer in that state."), "sin-cuadrar": t("No se aprueba el pago mientras orden, recibo y factura no coincidan o alguien acepte la diferencia.", "The payment isn't approved until order, receipt and invoice agree or someone accepts the difference."), pago: t("Para registrar el pago falta la aprobación, la referencia del banco o la fecha no es válida.", "To record the payment the approval or the bank reference is missing, or the date is not valid."), "no-existe": t("Esa factura no existe.", "That invoice doesn't exist.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Cuentas por pagar", "Payables")}</h1><p>{t("Lo que hay que pagar y cuándo, y cada factura de proveedor comparada con su orden y con lo que se recibió.", "What must be paid and when, and each supplier invoice compared with its order and with what was received.")}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="calendario">
        <b>{t("CALENDARIO DE PAGOS", "PAYMENT CALENDAR")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Cuándo", "When")}</th><th className="n">{t("Pagos", "Payments")}</th><th className="n">USD</th><th className="n">{t("de eso, ya aprobado", "of which approved")}</th></tr></thead>
          <tbody>{windows.map((w) => <tr key={w.key}><td>{w.label}</td><td className="n mono">{w.xs.length}</td><td className={`n mono ${w.xs.length ? w.tone : ""}`}>{i.n2(sumMoney(w.xs.map((x) => x.amount)))}</td><td className="n mono">{i.n2(sumMoney(w.xs.filter((x) => x.committed).map((x) => x.amount)))}</td></tr>)}</tbody>
        </table></div>
        {windows.filter((w) => w.xs.length).map((w) => (
          <details key={w.key}><summary className="small">{w.label} · {w.xs.length}</summary>
            <ul className="plain small">{w.xs.map((x) => <li key={x.key}>{x.href ? <Link href={x.href}>{x.label}</Link> : x.label} · <span className="mono">{i.n2(x.amount)}</span>{x.on ? ` · ${i.day(x.on)}` : ""} · <span className="muted">{t(BUCKETS[x.bucket].es, BUCKETS[x.bucket].en)}</span></li>)}</ul>
          </details>
        ))}
        <p className="src">{t("Incluye pagos a proveedores pedidos y aprobados, hitos de órdenes, facturas de compras internas, viajes, comisiones, contratos y lo escrito en Tesorería. Una factura de una orden no se suma aparte: su dinero ya está en los hitos de la orden.", "It includes supplier payments requested and approved, order milestones, invoices of internal purchases, trips, commissions, contracts and what is typed in Treasury. An invoice of an order isn't added separately: its money is already in the order's milestones.")} <Link href="/administracion/tesoreria#proyeccion">{t("Ver la caja proyectada", "See projected cash")}</Link></p>
      </section>

      {discounts.length > 0 && <section className="card" id="descuentos">
        <b>{t("DESCUENTOS POR PAGO ANTICIPADO, AÚN ABIERTOS", "EARLY-PAYMENT DISCOUNTS STILL OPEN")}</b>
        <ul className="plain small">{discounts.map(({ r, d }) => <li key={r.id}><a href={`#f-${r.id}`}><b>{r.supplier.name}</b> · {r.number}</a> · {t("ahorro", "saving")} <span className="mono ok-t">{r.currency} {i.n2(d!.saving)}</span> · {t(`pagando antes del ${i.day(d!.until)} (${d!.daysLeft} días)`, `paying before ${i.day(d!.until)} (${d!.daysLeft} days)`)}</li>)}</ul>
      </section>}

      <section className="card" id="facturas">
        <b>{t("FACTURAS DE PROVEEDORES", "SUPPLIER INVOICES")}</b> <span className="small muted">· {showPaid ? <Link href="/administracion/pagar#facturas">{t("ver solo las abiertas", "show open only")}</Link> : <Link href="/administracion/pagar?ver=pagadas#facturas">{t("ver también las pagadas", "also show paid")}</Link>}</span>
        {rows.length === 0 ? <p className="small muted">{t("Aún no hay facturas de proveedores registradas.", "No supplier invoices recorded yet.")}</p> : rows.map((r) => {
          const m = MATCH_TEXT[r.match.kind];
          const d = discountOf(r, T);
          return (
            <div key={r.id} id={`f-${r.id}`} className="card" style={{ marginTop: 10 }}>
              <div><b>{r.supplier.name}</b> · {t("factura", "invoice")} <span className="mono">{r.number}</span> · <span className="mono">{r.currency} {i.n2(r.amount)}</span> {r.paidAt ? <span className="sig ok">{t("Pagada", "Paid")} {i.day(r.paidAt)}</span> : r.late ? <span className="sig risk">{t("Vencida", "Overdue")}</span> : null} <span className={`sig ${r.exceptionAt && !r.match.clean ? "wait" : m.tone}`}>{t(m.es, m.en)}</span></div>
              <dl className="qv-dl">
                <dt>{t("Fechas", "Dates")}</dt><dd>{t("emitida", "issued")} {i.day(r.invoiceDate)} · {t("llegó", "received")} {i.day(r.receivedAt)} ({r.source}) · {r.dueAt ? `${t("vence", "due")} ${i.day(r.dueAt)}` : <span className="sig attn">{t("sin fecha de vencimiento", "no due date")}</span>}</dd>
                <dt>{t("Orden", "Order")}</dt><dd>{r.supplierPo ? <><Link href={`/compras/${r.supplierPo.id}`}>{r.supplierPo.code}</Link> · {r.supplierPo.deal.internal ? t("inventario propio", "own stock") : `${r.supplierPo.deal.code ?? ""} ${r.supplierPo.deal.account.name}`}</> : r.internalPurchase ? <Link href={`/administracion/compras-internas/${r.internalPurchase.id}`}>{r.internalPurchase.code} · {r.internalPurchase.description}</Link> : <span className="muted">{t("ninguna", "none")}</span>}</dd>
                {r.orderAmount != null && <><dt>{t("Orden · recibido · facturado", "Ordered · received · invoiced")}</dt><dd className="mono">{i.n2(r.orderAmount)} · {r.received == null ? "—" : i.n2(r.received)} · {i.n2(r.invoicedTotal)}{r.match.overOrder > 0 ? <span className="risk-t"> ({t("sobre la orden", "over the order")} +{i.n2(r.match.overOrder)})</span> : r.match.overReceived > 0 ? <span className="risk-t"> ({t("sobre lo recibido", "over what was received")} +{i.n2(r.match.overReceived)})</span> : null}</dd></>}
                {r.supplierPo && r.supplierPo.receipts.length > 0 && <><dt>{t("Recibos", "Receipts")}</dt><dd className="small">{r.supplierPo.receipts.map((x) => `${x.code} (${i.day(x.receivedAt)})`).join(" · ")}</dd></>}
                {r.serviceAcceptedAt && <><dt>{t("Servicio aceptado", "Service accepted")}</dt><dd className="small">{r.serviceAcceptedByName} · {i.day(r.serviceAcceptedAt)} · {r.serviceAcceptNote}</dd></>}
                {r.exceptionAt && <><dt>{t("Diferencia aceptada", "Difference accepted")}</dt><dd className="small">{r.exceptionByName} · {i.day(r.exceptionAt)} · {r.exceptionNote}</dd></>}
                {d && <><dt>{t("Descuento", "Discount")}</dt><dd className="small">{i.pct(Number(r.discountPct))} · {r.currency} {i.n2(d.saving)} {d.open ? t(`hasta el ${i.day(d.until)}`, `until ${i.day(d.until)}`) : <span className="muted">{t("ya venció", "already expired")}</span>}</dd></>}
                {r.lateImpact && <><dt>{t("Si se paga tarde", "If paid late")}</dt><dd className="small">{r.lateImpact}</dd></>}
                {r.payApprovedAt && <><dt>{t("Pago aprobado", "Payment approved")}</dt><dd className="small">{r.payApprovedByName} · {i.day(r.payApprovedAt)}</dd></>}
                {r.paidAt && <><dt>{t("Pago", "Payment")}</dt><dd className="small">{r.paidByName} · {r.paidRef}</dd></>}
              </dl>
              {!r.paidAt && (
                <div className="qa-form">
                  {r.kind === "SERVICE" && !r.serviceAcceptedAt && <form action={acceptService.bind(null, r.id)} className="qa-row" style={{ alignItems: "center" }}><input name="note" required placeholder={t("Qué se recibió y quién lo confirma", "What was received and who confirms it")} aria-label={t("Aceptación del servicio", "Service acceptance")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Aceptar el servicio", "Accept the service")}</button></form>}
                  {!r.match.clean && !r.exceptionAt && r.match.kind !== "SERVICE_PENDING" && <form action={acceptException.bind(null, r.id)} className="qa-row" style={{ alignItems: "center" }}><input name="note" required placeholder={t("Por qué se acepta la diferencia", "Why the difference is accepted")} aria-label={t("Motivo", "Reason")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Aceptar la diferencia", "Accept the difference")}</button></form>}
                  {r.supplierPo ? <p className="src">{t("El pago de esta factura se pide y se aprueba en la orden, con sus hitos.", "This invoice is paid through the order, with its milestones.")} <Link href={`/compras/${r.supplierPo.id}`}>{t("Abrir la orden", "Open the order")}</Link></p>
                    : !r.payApprovedAt ? <form action={approveInvoicePayment.bind(null, r.id)}><button type="submit" className="sm" disabled={!r.match.payable || r.recordedById === user.id}>{t("Aprobar el pago", "Approve the payment")}</button> <span className="src">{r.recordedById === user.id ? t("La aprueba alguien distinto de quien la registró.", "Someone other than whoever recorded it approves it.") : !r.match.payable ? t("Primero debe cuadrar o alguien debe aceptar la diferencia.", "It must agree first, or someone must accept the difference.") : t("Aprobar no es pagar.", "Approving is not paying.")}</span></form>
                    : canFinance(user) ? <form action={markInvoicePaid.bind(null, r.id)} className="qa-row" style={{ alignItems: "center" }}><input name="paidRef" required placeholder={t("Referencia del banco", "Bank reference")} aria-label={t("Referencia del banco", "Bank reference")} /><input type="date" name="paidAt" defaultValue={dayInput(T)} max={dayInput(T)} aria-label={t("Fecha del pago", "Payment date")} /><button type="submit" className="sm" style={{ flex: "0 0 auto" }}>{t("Registrar el pago", "Record the payment")}</button></form> : null}
                </div>
              )}
              <p className="src">{t("registró", "recorded by")} {r.recordedByName}</p>
            </div>
          );
        })}
        <p className="src">{t(`Diferencia que se acepta sin pedir excepción: USD ${i.n2(pol.value.apToleranceUsd)}.`, `Difference accepted without an exception: USD ${i.n2(pol.value.apToleranceUsd)}.`)} <Link href="/administracion/politicas#admin">{t("Políticas", "Policies")}</Link></p>
      </section>

      <section className="card" id="nueva">
        <b>{t("REGISTRAR UNA FACTURA DE PROVEEDOR", "RECORD A SUPPLIER INVOICE")}</b>
        <form action={recordSupplierInvoice} className="qa-form">
          <label>{t("De qué orden o compra es", "Which order or purchase it belongs to")}
            <select name="link" defaultValue="">
              <option value="">{t("Ninguna (elige el proveedor abajo)", "None (choose the supplier below)")}</option>
              <optgroup label={t("Órdenes a proveedores", "Supplier orders")}>{pos.map((p) => <option key={p.id} value={`po:${p.id}`}>{p.code} · {p.supplier.name} · {p.currency} {i.n2(p.amount)}</option>)}</optgroup>
              <optgroup label={t("Compras internas aprobadas", "Approved internal purchases")}>{ips.map((p) => <option key={p.id} value={`ip:${p.id}`}>{p.code} · {p.description} · {p.currency} {i.n2(p.amount)}</option>)}</optgroup>
            </select></label>
          <label>{t("Proveedor (si no elegiste una orden)", "Supplier (if no order was chosen)")}<select name="supplierId" defaultValue=""><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <div className="qa-row">
            <label>{t("Número de la factura", "Invoice number")}<input name="number" required maxLength={60} /></label>
            <label>{t("Tipo", "Kind")}<select name="kind"><option value="PRODUCT">{t("Productos", "Products")}</option><option value="SERVICE">{t("Servicio", "Service")}</option></select></label>
            <label>{t("Valor", "Amount")}<input name="amount" inputMode="decimal" required /></label>
            <label>{t("Moneda", "Currency")}<input name="currency" defaultValue="USD" maxLength={3} style={{ width: 70 }} /></label>
          </div>
          <div className="qa-row">
            <label>{t("Fecha de la factura", "Invoice date")}<input type="date" name="invoiceDate" required /></label>
            <label>{t("Vence", "Due")}<input type="date" name="dueAt" /></label>
            <label>{t("Llegó el", "Received on")}<input type="date" name="receivedAt" defaultValue={dayInput(T)} /></label>
            <label>{t("Valor en USD (si es otra moneda)", "USD value (if another currency)")}<input name="amountUsd" inputMode="decimal" /></label>
          </div>
          <label>{t("Cómo llegó", "How it arrived")}<input name="source" required maxLength={160} placeholder={t("Ej.: correo de facturacion@proveedor.com", "E.g. email from billing@supplier.com")} /></label>
          <div className="qa-row">
            <label>{t("Descuento por pago anticipado (%)", "Early-payment discount (%)")}<input name="discountPct" inputMode="decimal" /></label>
            <label>{t("Descuento válido hasta", "Discount valid until")}<input type="date" name="discountUntil" /></label>
            <label style={{ flex: 2 }}>{t("Qué pasa si se paga tarde", "What happens if paid late")}<input name="lateImpact" maxLength={200} /></label>
          </div>
          <div><button type="submit">{t("Registrar", "Record")}</button></div>
        </form>
      </section>
    </>
  );
}
