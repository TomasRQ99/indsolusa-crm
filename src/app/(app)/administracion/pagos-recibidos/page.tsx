import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditMoney, canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput, invoiceCash, today } from "@/lib/domain";
import { applyPayment, reconcilePayment, recordCustomerPayment } from "../actions";
import { Withholdings } from "@/components/Withholdings";

export default async function PaymentsReceivedPage({ searchParams }: { searchParams: Promise<{ account?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const manager = canFinance(user);
  const { account: accountId, ok, err } = await searchParams;
  const okMsg: Record<string, string> = { retencion: t("Retención registrada. La factura debe ese valor menos.", "Withholding recorded. The invoice owes that much less."), certificado: t("Certificado guardado.", "Certificate saved."), anulada: t("Retención anulada. La factura vuelve a deber ese valor.", "Withholding voided. The invoice owes that amount again.") };
  const errMsg: Record<string, string> = { permiso: t("No tienes permiso para esto.", "You don't have permission for this."), "ret-type": t("Elige el tipo de retención.", "Choose the withholding type."), "ret-amount": t("Escribe el valor retenido.", "Write the amount withheld."), "ret-exceeds": t("La retención no puede ser mayor que el saldo de la factura.", "The withholding can't exceed the invoice balance."), "ret-note": t("Para «otra deducción» escribe qué es.", "For \"other deduction\" write what it is."), "ret-certificado": t("Escribe el número del certificado.", "Write the certificate number.") };

  const [accounts, payments, account] = await Promise.all([
    db.account.findMany({ where: { invoices: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.customerPayment.findMany({
      where: { kind: "CASH" },
      orderBy: [{ reconciledAt: { sort: "asc", nulls: "first" } }, { receivedAt: "desc" }],
      take: 100,
      include: {
        account: { select: { id: true, name: true } },
        applications: { include: { invoice: { select: { number: true } } } },
        createdBy: { select: { name: true } },
        reconciledBy: { select: { name: true } },
      },
    }),
    accountId
      ? db.account.findUnique({
          where: { id: accountId },
          include: { invoices: { include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } }, orderBy: { dueAt: "asc" } } },
        })
      : null,
  ]);
  const open = account?.invoices.map((inv) => ({ inv, c: invoiceCash(inv) })).filter((x) => x.c.balance - x.c.pendingReconcile > 0.005) ?? [];
  const pending = payments.filter((p) => !p.reconciledAt);
  // Recording or applying cash: the customer's owner, or Finanzas / management (enforced again on the server).
  const canRecord = !!account && canEditMoney(user, account.ownerId);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/administracion/cobrar">{t("Cuentas por cobrar", "Receivables")}</Link> · {t("Pagos recibidos", "Payments received")}</div>
          <h1>{t("Pagos recibidos", "Payments received")}</h1>
          <p>{t("Recibido no es pagado: el pago cuenta en la factura cuando Tesorería lo concilia con el extracto.", "Received is not paid: the payment counts on the invoice once Treasury reconciles it with the bank statement.")}</p>
        </div>
      </div>

      {ok && okMsg[ok] && <div className="note okn">{okMsg[ok]}</div>}
      {err && errMsg[err] && <div className="note risk">{errMsg[err]}</div>}
      <div className="two">
        <div className="card flush">
          <table>
            <thead><tr><th>{t("Cliente", "Customer")}</th><th>{t("Recibido", "Received")}</th><th className="n">{t("Monto", "Amount")}</th><th>{t("Aplicado a", "Applied to")}</th><th>{t("Estado", "State")}</th><th /></tr></thead>
            <tbody>
              {pending.length > 0 && <tr className="grpr"><td colSpan={6}>{t("Pendiente de conciliar", "To reconcile")} <span>· {pending.length}</span></td></tr>}
              {payments.map((p) => {
                const applied = p.applications.reduce((s, a) => s + Number(a.amount), 0);
                const unapplied = Number(p.amount) - applied;
                return (
                  <tr key={p.id}>
                    <td><b>{p.account.name}</b><span className="src">{p.reference ?? ""}</span></td>
                    <td>{i.date(p.receivedAt)}<span className="src">{p.createdBy.name}</span></td>
                    <td className="n val">{i.n2(p.amount)}</td>
                    <td>
                      {p.applications.map((a) => <span key={a.id} className="src block mono">{a.invoice.number} · {i.n2(a.amount)}</span>)}
                      {unapplied > 0.005 && <span className="src block attn-t">{t("Sin aplicar", "Unapplied")} {i.n2(unapplied)}</span>}
                    </td>
                    <td>{p.reconciledAt ? <span className="sig ok">✓ {t("Conciliado", "Reconciled")} {i.day(p.reconciledAt)}</span> : <span className="sig info">{t("Por conciliar", "To reconcile")}</span>}</td>
                    <td className="n">
                      {!p.reconciledAt && unapplied > 0.005 && <Link className="btn secondary sm" href={`/administracion/pagos-recibidos?account=${p.account.id}#apply-${p.id}`}>{t("Aplicar", "Apply")}</Link>}
                      {!p.reconciledAt && manager && applied > 0 && unapplied > 0.005 && !p.residualNote && (
                        <span className="src block">{t("Para conciliar: aplica el resto o explica el sobrante en la pestaña Facturación de la Necesidad.", "To reconcile: apply the rest or explain the leftover in the Necessity's Billing tab.")}</span>
                      )}
                      {!p.reconciledAt && manager && applied > 0 && (unapplied <= 0.005 || !!p.residualNote) && (
                        <form action={reconcilePayment.bind(null, p.id)}><button className="sm" type="submit">{t("Conciliar", "Reconcile")}</button></form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {payments.length === 0 && <tr><td colSpan={6} className="empty"><b>{t("Aún no hay pagos registrados", "No payments recorded yet")}</b></td></tr>}
            </tbody>
          </table>
        </div>

        <aside className="rail">
          <div className="card">
            <h2>{t("Registrar pago recibido", "Record payment received")}</h2>
            <form action="/administracion/pagos-recibidos" className="inline" style={{ marginBottom: 10 }}>
              <select name="account" defaultValue={accountId ?? ""} required aria-label={t("Cliente", "Customer")}>
                <option value="" disabled>{t("Cliente…", "Customer…")}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="secondary sm" type="submit">{t("Ver facturas", "Show invoices")}</button>
            </form>
            {account && !canRecord && <p className="src">{t("Solo el responsable de este cliente, Finanzas o la gerencia pueden registrar o aplicar sus pagos.", "Only this customer's owner, Finance or management can record or apply its payments.")}</p>}
            {account && canRecord && (
              <form action={recordCustomerPayment} className="stack">
                <input type="hidden" name="accountId" value={account.id} />
                <label>{t("Monto USD", "Amount USD")}<input name="amount" type="number" min="0" step="0.01" required /></label>
                <label>{t("Fecha en el banco", "Bank date")}<input name="receivedAt" type="date" required defaultValue={dayInput(today())} /></label>
                <label>{t("Referencia bancaria", "Bank reference")}<input name="reference" /></label>
                {open.length > 0 && <span className="src">{t("Aplicar a facturas (opcional):", "Apply to invoices (optional):")}</span>}
                {open.map(({ inv, c }) => (
                  <label key={inv.id}>
                    <span className="mono">{inv.number}</span> · {t("saldo", "balance")} {i.n2(c.balance - c.pendingReconcile)}
                    <input name={`apply_${inv.id}`} type="number" min="0" step="0.01" max={(c.balance - c.pendingReconcile).toFixed(2)} />
                  </label>
                ))}
                <button type="submit">{t("Registrar", "Record")}</button>
              </form>
            )}
          </div>
          {account && canRecord && payments.filter((p) => p.account.id === account.id && !p.reconciledAt).map((p) => {
            const unapplied = Number(p.amount) - p.applications.reduce((s, a) => s + Number(a.amount), 0);
            if (unapplied <= 0.005 || open.length === 0) return null;
            return (
              <div className="card" key={p.id} id={`apply-${p.id}`}>
                <h2>{t("Aplicar pago del", "Apply payment of")} {i.day(p.receivedAt)}</h2>
                <p className="src" style={{ marginBottom: 8 }}>{t("Sin aplicar", "Unapplied")}: {i.money2(unapplied)}</p>
                <form action={applyPayment.bind(null, p.id)} className="stack">
                  {open.map(({ inv, c }) => (
                    <label key={inv.id}><span className="mono">{inv.number}</span> · {t("saldo", "balance")} {i.n2(c.balance - c.pendingReconcile)}<input name={`apply_${inv.id}`} type="number" min="0" step="0.01" /></label>
                  ))}
                  <button type="submit" className="secondary">{t("Aplicar", "Apply")}</button>
                </form>
              </div>
            );
          })}
        </aside>
      </div>
      <Withholdings accountId={account?.id ?? null} lang={i.es ? "ES" : "EN"} canRecord={canRecord} canVoid={manager} open={open.map(({ inv, c }) => ({ id: inv.id, number: inv.number, balance: c.balance - c.pendingReconcile }))} />
    </>
  );
}
