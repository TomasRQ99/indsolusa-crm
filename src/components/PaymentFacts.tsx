import { db } from "@/lib/db";
import { today, dayInput } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { PAY_METHOD, payCost, payTradeoff } from "@/lib/supply-rules";
import { markPaymentFact } from "@/app/(app)/administracion/actions";

// Operaciones O4 · on a supplier payment: the four separate facts (§21: sent, bank debited, supplier received, order
// released) and the comparison of payment methods the supplier offered (§20). SOLU compares; the authority decides.

export async function PaymentFacts({ paymentId, lang, editable }: { paymentId: string; lang: "ES" | "EN"; editable: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const p = await db.supplierPayment.findUnique({
    where: { id: paymentId },
    select: { id: true, amount: true, currency: true, supplierReceivedAt: true, supplierReceivedNote: true, orderReleasedAt: true, orderReleasedNote: true, executions: { orderBy: { sentAt: "asc" } }, supplierPo: { select: { dealId: true, supplierId: true } } },
  });
  if (!p) return null;
  const opts = await db.supplierPaymentOption.findMany({ where: { option: { dealId: p.supplierPo.dealId, supplierId: p.supplierPo.supplierId } }, orderBy: { createdAt: "asc" } });
  const amount = Number(p.amount);
  const payOpts = opts.map((o) => ({ id: o.id, method: o.method, surchargePct: o.surchargePct != null ? Number(o.surchargePct) : null, fixedFee: o.fixedFee != null ? Number(o.fixedFee) : null, fxSpreadPct: o.fxSpreadPct != null ? Number(o.fxSpreadPct) : null, daysToRelease: o.daysToRelease, confirmed: o.confirmed }));
  const trade = payOpts.length > 1 ? payTradeoff(amount, payOpts, p.currency) : null;
  const sent = p.executions[0] ?? null;
  const debited = p.executions.find((e) => e.state === "CONFIRMED") ?? null;
  const paidWith = debited ?? sent;
  const T = today();
  const fact = (ok: boolean, label: string, detail: string | null) => <li className={ok ? "ok" : "no info"}><span className="ic" aria-hidden>{ok ? "✓" : "·"}</span><span><b>{label}</b>{detail && <span className="muted"> · {detail}</span>}</span></li>;
  const Form = ({ kind, ph }: { kind: "received" | "released"; ph: string }) => (
    <form action={markPaymentFact.bind(null, p.id, kind)} className="qa-row">
      <input name="note" required maxLength={200} placeholder={ph} aria-label={ph} style={{ flex: "1 1 220px" }} />
      <input name="at" type="date" defaultValue={dayInput(T)} aria-label={t("Fecha", "Date")} />
      <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{kind === "received" ? t("El proveedor recibió el dinero", "Supplier received the money") : t("El proveedor liberó el pedido", "Supplier released the order")}</button>
    </form>
  );

  return (
    <>
      {payOpts.length > 0 && !sent && (
        <section className="jblock" id="metodos">
          <div className="jbh"><b>{t("CON QUÉ MÉTODO PAGAR", "WHICH METHOD TO PAY WITH")}</b><span className="grow" /><span className="src">{t("SOLU compara; quien autoriza decide", "SOLU compares; the authority decides")}</span></div>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Método", "Method")}</th><th className="n">{t("Costo extra", "Extra cost")}</th><th className="n">{t("Total", "Total")}</th><th>{t("Libera el pedido en", "Releases the order in")}</th><th>{t("Dato", "Data")}</th></tr></thead>
            <tbody>{payOpts.map((o, k) => { const c = payCost(amount, o); return (
              <tr key={o.id}><td>{t(PAY_METHOD[o.method]?.es ?? o.method, PAY_METHOD[o.method]?.en ?? o.method)}</td><td className="n mono">{c.floor ? "≥ " : ""}{i.n2(c.extra)}</td><td className="n mono">{c.floor ? "≥ " : ""}{p.currency} {i.n2(c.total)}</td><td className="small">{c.days == null ? t("No se sabe", "Unknown") : c.days === 0 ? t("De inmediato", "Immediately") : t(`${c.days} día(s)`, `${c.days} day(s)`)}{opts[k].releaseTrigger ? ` · ${opts[k].releaseTrigger}` : ""}</td><td className="small">{c.confirmed ? t("Confirmado", "Confirmed") : t("Sin confirmar", "Unconfirmed")}{opts[k].source ? <span className="src block">{opts[k].source}</span> : null}</td></tr>
            ); })}</tbody>
          </table></div>
          {trade && <p className="small">{t(trade.es, trade.en)}</p>}
        </section>
      )}

      {sent && (
        <section className="jblock" id="hechos-pago">
          <div className="jbh"><b>{t("QUÉ PASÓ CON EL DINERO", "WHAT HAPPENED TO THE MONEY")}</b><span className="grow" /><span className="src">{t("Enviado no es recibido", "Sent is not received")}</span></div>
          <ul className="qv-checks">
            {fact(true, t("Pago enviado", "Payment sent"), `${i.day(sent.sentAt)} · ${sent.recordedByName}${paidWith?.method ? ` · ${t(PAY_METHOD[paidWith.method]?.es ?? paidWith.method, PAY_METHOD[paidWith.method]?.en ?? paidWith.method)}` : ""}`)}
            {fact(!!debited, t("Debitado por el banco", "Debited by the bank"), debited ? `${i.day(debited.resolvedAt ?? debited.sentAt)}${debited.bankRef ? ` · ref. ${debited.bankRef}` : ""}` : null)}
            {fact(!!p.supplierReceivedAt, t("Recibido por el proveedor", "Received by the supplier"), p.supplierReceivedAt ? `${i.day(p.supplierReceivedAt)} · ${p.supplierReceivedNote}` : null)}
            {fact(!!p.orderReleasedAt, t("Pedido liberado por el proveedor", "Order released by the supplier"), p.orderReleasedAt ? `${i.day(p.orderReleasedAt)} · ${p.orderReleasedNote}` : null)}
          </ul>
          {paidWith && (paidWith.feeUsd != null || paidWith.fxRate != null) && <p className="small">{paidWith.feeUsd != null && <>{t("Comisión real", "Actual fee")}: <b className="mono">USD {i.n2(paidWith.feeUsd)}</b></>}{paidWith.feeUsd != null && paidWith.fxRate != null ? " · " : ""}{paidWith.fxRate != null && <>{t("Tasa de cambio efectiva", "Effective exchange rate")}: <b className="mono">{Number(paidWith.fxRate)}</b></>}</p>}
          {editable && debited && !p.supplierReceivedAt && <Form kind="received" ph={t("Cómo lo sabemos (correo del proveedor, comprobante…)", "How we know (supplier's email, receipt…)")} />}
          {editable && p.supplierReceivedAt && !p.orderReleasedAt && <Form kind="released" ph={t("Cómo lo sabemos (confirmación de despacho, correo…)", "How we know (dispatch confirmation, email…)")} />}
        </section>
      )}
    </>
  );
}
