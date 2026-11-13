import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { invoiceBlockers, invoiceCash } from "@/lib/domain";
import { blockerLabel } from "@/lib/labels";
import { updateDelivery } from "../../actions";
import { issueInvoice } from "../../../administracion/actions";
import { lineAmount, linesTotal } from "@/lib/money";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const d = await db.delivery.findUnique({
    where: { id },
    include: {
      lines: { include: { dealItem: true } },
      invoice: { include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } },
      deal: { include: { account: true, owner: { select: { name: true } } } },
    },
  });
  if (!d) notFound();
  const editable = canEditOps(user, d.deal.ownerId);
  const blockers = invoiceBlockers(d, d.deal, d.deal.account);
  const amount = linesTotal(d.lines, (l) => l.qty, (l) => l.dealItem.unitPrice);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/operaciones/remisiones">{t("Remisiones", "Delivery notes")}</Link> · {d.code}</div>
          <h1>{t("Remisión", "Delivery note")} {d.code}</h1>
          <p>{d.deal.account.name} · <Link href={`/deals/${d.deal.id}`}>{d.deal.code} · {d.deal.title}</Link> · {t("OC", "PO")} {d.deal.customerPo ?? "—"}</p>
        </div>
      </div>

      <div className="two">
        <div className="stack-lg">
          <div className="card">
            <h2>{t("Productos entregados", "Products delivered")}</h2>
            {d.lines.length === 0 ? (
              <p className="small muted">{t("Entrega completa de la Necesidad (sin líneas de producto).", "Full Necessity delivery (no product lines).")}</p>
            ) : (
              <table>
                <thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Producto", "Product")}</th><th>{t("Seriales", "Serials")}</th><th className="n">{t("Valor", "Amount")}</th></tr></thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="val">{l.qty} / {l.dealItem.qty}</td>
                      <td><b>{l.dealItem.description}</b><span className="src mono">{l.dealItem.code}</span></td>
                      <td className="mono small">{l.serials ?? "—"}</td>
                      <td className="n val">{i.n2(lineAmount(l.qty, l.dealItem.unitPrice))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <h2>{t("Entrega", "Delivery")}</h2>
            <dl className="facts">
              <dt>{t("Fecha", "Date")}</dt><dd>{i.date(d.deliveredAt)}</dd>
              <dt>{t("Lugar", "Place")}</dt><dd>{d.place ?? "—"}</dd>
              <dt>{t("Entregó", "Delivered by")}</dt><dd>{d.deliveredBy ?? "—"}</dd>
              <dt>{t("Recibió", "Received by")}</dt><dd>{d.receivedByName ?? "—"}</dd>
              <dt>{t("Prueba de entrega", "Proof of delivery")}</dt><dd>{d.podReceived ? t("Remisión firmada", "Signed note") : t("Falta", "Missing")}</dd>
              {d.deal.account.requiresReceptionCode && (<><dt>{t("Código de recepción", "Receipt code")}</dt><dd className="mono">{d.receptionCode ?? "—"}</dd></>)}
              <dt>{t("Observaciones", "Notes")}</dt><dd>{d.notes ?? "—"}</dd>
            </dl>
            {editable && !d.invoice && (
              <details style={{ marginTop: 12 }}>
                <summary>{t("Actualizar entrega", "Update delivery")}</summary>
                <form action={updateDelivery.bind(null, d.id)} className="stack">
                  <label>{t("Lugar", "Place")}<input name="place" defaultValue={d.place ?? ""} /></label>
                  <label>{t("Recibió", "Received by")}<input name="receivedByName" defaultValue={d.receivedByName ?? ""} /></label>
                  <label>{t("Código de recepción de mercancía", "Goods-receipt code")}<input name="receptionCode" defaultValue={d.receptionCode ?? ""} /></label>
                  <label className="check"><input type="checkbox" name="podReceived" defaultChecked={d.podReceived} /> {t("Tenemos la remisión firmada", "We have the signed delivery note")}</label>
                  <label>{t("Observaciones", "Notes")}<textarea name="notes" defaultValue={d.notes ?? ""} /></label>
                  <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
                </form>
              </details>
            )}
          </div>
          <p className="note">{t("Entregar no es resolver: la Necesidad se cierra cuando el cliente confirma su resultado.", "Delivering is not solving: the Necessity closes when the customer confirms the result.")}</p>
        </div>

        <aside className="rail">
          <div className="card">
            {d.invoice ? (
              <>
                <span className="k">{t("Factura emitida", "Invoice issued")}</span>
                <p style={{ margin: "6px 0" }}><b className="val">{d.invoice.number}</b> · {i.money2(d.invoice.amount)}</p>
                <p className="src">{t("Vence", "Due")} {i.date(d.invoice.dueAt)} · {t("saldo", "balance")} {i.money2(invoiceCash(d.invoice).balance)}</p>
                <Link className="btn secondary wide" style={{ marginTop: 10 }} href={`/administracion/cobrar?f=${d.invoice.id}`}>{t("Ver en cuentas por cobrar", "View in receivables")}</Link>
              </>
            ) : blockers.length === 0 ? (
              <>
                <span className="k">{t("Lista para facturar", "Ready to invoice")}</span>
                <p style={{ margin: "6px 0 10px" }}>{t("Todo lo que el cliente exige está completo.", "Everything the customer requires is complete.")} {amount > 0 && <b>{i.money2(amount)}</b>}</p>
                {editable && <form action={issueInvoice.bind(null, d.id)}><button className="wide" type="submit">{t("Emitir factura", "Issue invoice")}</button></form>}
              </>
            ) : (
              <>
                <span className="k">{t("Qué falta para facturar", "What's missing to invoice")}</span>
                <div className="items" style={{ marginTop: 6 }}>
                  {blockers.map((b) => {
                    const l = blockerLabel(i, b);
                    return (
                      <div className="item" key={b} style={{ gridTemplateColumns: "1fr" }}>
                        <div className="t">{l.label}</div>
                        <div className="d small">{l.why}</div>
                      </div>
                    );
                  })}
                </div>
                <p className="src">{t("Los datos del cliente (portal, tributarios, código) se completan en su ficha; la OC en la Necesidad.", "Customer data (portal, tax, code) is completed on the customer record; the PO on the Necessity.")}</p>
                <div className="row" style={{ marginTop: 8 }}>
                  <Link className="btn secondary sm" href={`/accounts/${d.deal.accountId}`}>{t("Ficha del cliente", "Customer record")}</Link>
                  <Link className="btn secondary sm" href={`/deals/${d.deal.id}`}>{t("Necesidad", "Necessity")}</Link>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
