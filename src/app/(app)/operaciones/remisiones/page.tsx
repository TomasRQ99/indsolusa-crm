import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { invoiceBlockers } from "@/lib/domain";

export default async function DeliveriesPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const [deliveries, openDeals] = await Promise.all([
    db.delivery.findMany({
      orderBy: { deliveredAt: "desc" },
      take: 200,
      include: {
        lines: true,
        invoice: { select: { number: true } },
        deal: { include: { account: true } },
      },
    }),
    db.deal.findMany({
      where: { stage: "WON" },
      include: { account: { select: { name: true } }, items: { include: { deliveryLines: { select: { qty: true } } } }, deliveries: { select: { id: true } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const pendingDeals = openDeals.filter((d) =>
    d.items.length ? d.items.some((it) => it.deliveryLines.reduce((s, l) => s + l.qty, 0) < it.qty) : d.deliveries.length === 0,
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Operaciones", "Operations")}</div>
          <h1>{t("Remisiones", "Delivery notes")}</h1>
          <p>{t("Cada remisión registra qué se entregó, a quién, cuándo y con qué prueba. Puede ser parcial.", "Each delivery note records what was delivered, to whom, when and with what proof. It can be partial.")}</p>
        </div>
        <div className="grow" />
        {pendingDeals.length > 0 && (
          <form action="/operaciones/remisiones/nueva" className="inline">
            <select name="deal" required defaultValue="" aria-label={t("Necesidad", "Necessity")}>
              <option value="" disabled>{t("Necesidad con entregas pendientes…", "Necessity with pending deliveries…")}</option>
              {pendingDeals.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.account.name} · {d.title}</option>)}
            </select>
            <button type="submit">{t("Nueva remisión", "New delivery note")}</button>
          </form>
        )}
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Remisión", "Delivery note")}</th><th>{t("Cliente · Necesidad", "Customer · Necessity")}</th><th>{t("Fecha", "Date")}</th><th>{t("Unidades", "Units")}</th><th>{t("Prueba de entrega", "Proof of delivery")}</th><th>{t("Factura", "Invoice")}</th></tr></thead>
          <tbody>
            {deliveries.map((d) => {
              const blockers = invoiceBlockers(d, d.deal, d.deal.account);
              return (
                <tr key={d.id}>
                  <td><Link className="val" href={`/operaciones/remisiones/${d.id}`}>{d.code}</Link></td>
                  <td><b>{d.deal.account.name}</b><span className="src">{d.deal.code} · {d.deal.title}</span></td>
                  <td>{i.date(d.deliveredAt)}</td>
                  <td className="val">{d.lines.reduce((s, l) => s + l.qty, 0) || "—"}</td>
                  <td>{d.podReceived ? <span className="sig ok">✓ {t("Firmada", "Signed")}</span> : <span className="sig attn">{t("Falta", "Missing")}</span>}</td>
                  <td>{d.invoice ? <span className="val">{d.invoice.number}</span> : blockers.length ? <span className="sig attn">{t(`${blockers.length} bloqueos`, `${blockers.length} blockers`)}</span> : <span className="sig ok">{t("Lista para facturar", "Ready to invoice")}</span>}</td>
                </tr>
              );
            })}
            {deliveries.length === 0 && <tr><td colSpan={6} className="empty"><b>{t("Aún no hay remisiones", "No delivery notes yet")}</b>{t("Se crean desde una Necesidad con OC aceptada.", "They are created from a Necessity with an accepted PO.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
