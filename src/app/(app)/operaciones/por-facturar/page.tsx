import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canEdit } from "@/lib/permissions";
import { invoiceBlockers } from "@/lib/domain";
import { blockerLabel } from "@/lib/labels";
import { issueInvoice } from "../../administracion/actions";
import { linesTotal } from "@/lib/money";

export default async function DeliveredNotInvoicedPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const deliveries = await db.delivery.findMany({
    where: { invoice: null },
    orderBy: { deliveredAt: "asc" },
    include: {
      lines: { include: { dealItem: { select: { unitPrice: true } } } },
      deal: { include: { account: true, invoices: { select: { amount: true } } } },
    },
  });
  const rows = deliveries.map((d) => {
    const amount = d.lines.length
      ? linesTotal(d.lines, (l) => l.qty, (l) => l.dealItem.unitPrice)
      : Math.max(0, Number(d.deal.amount) - d.deal.invoices.reduce((s, x) => s + Number(x.amount), 0));
    return { d, amount, blockers: invoiceBlockers(d, d.deal, d.deal.account) };
  });
  const ready = rows.filter((r) => r.blockers.length === 0);
  const blocked = rows.filter((r) => r.blockers.length > 0);
  const byBlocker = new Map<string, number>();
  for (const r of blocked) for (const b of r.blockers) byBlocker.set(b, (byBlocker.get(b) ?? 0) + r.amount);

  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <tr>
      <td><Link className="val" href={`/operaciones/remisiones/${r.d.id}`}>{r.d.code}</Link><span className="src">{i.date(r.d.deliveredAt)}</span></td>
      <td><b>{r.d.deal.account.name}</b><span className="src"><Link href={`/deals/${r.d.deal.id}`}>{r.d.deal.code}</Link> · {r.d.deal.title}</span></td>
      <td className="n val">{i.n2(r.amount)}</td>
      <td>
        {r.blockers.length === 0 ? (
          <span className="sig ok">{t("Lista para facturar", "Ready to invoice")}</span>
        ) : (
          <div className="row" style={{ gap: 4 }}>{r.blockers.map((b) => <span key={b} className="sig attn" title={blockerLabel(i, b).why}>{blockerLabel(i, b).label}</span>)}</div>
        )}
      </td>
      <td className="n">
        {r.blockers.length === 0 && canEdit(user, r.d.deal.ownerId) ? (
          <form action={issueInvoice.bind(null, r.d.id)}><button className="sm" type="submit">{t("Emitir factura", "Issue invoice")}</button></form>
        ) : (
          <Link className="btn secondary sm" href={`/deals/${r.d.deal.id}/facturacion`}>{t("Ver requisitos", "See requirements")}</Link>
        )}
      </td>
    </tr>
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Operaciones", "Operations")}</div>
          <h1>{t("Entregado sin facturar", "Delivered, not invoiced")}</h1>
          <p>{t("Lo que ya entregamos y aún no cobramos. SOLU calcula qué falta para facturar a partir de lo que exige cada cliente.", "What we delivered but haven't billed. SOLU works out what's missing from each customer's requirements.")}</p>
        </div>
      </div>
      <section className="sum">
        <div><span className="k">{t("Listo para facturar", "Ready to invoice")}</span><span className="v">{i.n(ready.reduce((s, r) => s + r.amount, 0))}</span><span className="s">USD · {ready.length} {t("remisiones", "notes")}</span></div>
        <div><span className="k">{t("Bloqueado", "Blocked")}</span><span className="v">{i.n(blocked.reduce((s, r) => s + r.amount, 0))}</span><span className="s">USD · {blocked.length} {t("remisiones", "notes")}</span></div>
        {[...byBlocker.entries()].map(([b, v]) => (
          <div key={b}><span className="k">{blockerLabel(i, b as never).label}</span><span className="v" style={{ fontSize: 16 }}>{i.n(v)}</span><span className="s">USD</span></div>
        ))}
      </section>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Remisión", "Delivery note")}</th><th>{t("Cliente · Journey", "Customer · Journey")}</th><th className="n">{t("Valor", "Amount")}</th><th>{t("Qué falta", "What's missing")}</th><th /></tr></thead>
          <tbody>
            {ready.length > 0 && <tr className="grpr"><td colSpan={5}>{t("Listo para facturar", "Ready to invoice")} <span>· {t("nada lo bloquea", "nothing blocks it")}</span></td></tr>}
            {ready.map((r) => <Row key={r.d.id} r={r} />)}
            {blocked.length > 0 && <tr className="grpr"><td colSpan={5}>{t("Bloqueado", "Blocked")} <span>· {t("cada bloqueo trae su llave", "each blocker comes with its key")}</span></td></tr>}
            {blocked.map((r) => <Row key={r.d.id} r={r} />)}
            {rows.length === 0 && <tr><td colSpan={5} className="empty"><b>{t("Todo lo entregado está facturado", "Everything delivered is invoiced")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
