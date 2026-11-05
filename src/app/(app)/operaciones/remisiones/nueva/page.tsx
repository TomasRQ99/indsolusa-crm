import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { createDelivery } from "../../actions";

export default async function NewDeliveryPage({ searchParams }: { searchParams: Promise<{ deal?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { deal: dealId } = await searchParams;
  if (!dealId) notFound();
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    include: { account: true, items: { include: { deliveryLines: { select: { qty: true } } }, orderBy: { id: "asc" } } },
  });
  if (!deal) notFound();

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/operaciones/remisiones">{t("Remisiones", "Delivery notes")}</Link> · {t("Nueva", "New")}</div>
          <h1>{t("Nueva remisión", "New delivery note")}</h1>
          <p>{deal.account.name} · <Link href={`/deals/${deal.id}`}>{deal.code} · {deal.title}</Link> · {t("OC", "PO")} {deal.customerPo ?? "—"}</p>
        </div>
      </div>
      <form action={createDelivery.bind(null, deal.id)} className="two">
        <div className="card">
          <h2>{t("Qué se entrega", "What is delivered")}</h2>
          {deal.items.length === 0 ? (
            <p className="small muted">{t("Este Journey no tiene productos detallados: la remisión cubre la entrega completa.", "This Journey has no product lines: the note covers the full delivery.")}</p>
          ) : (
            <table>
              <thead><tr><th>{t("Producto", "Product")}</th><th className="n">{t("Pendiente", "Pending")}</th><th>{t("Entrega ahora", "Deliver now")}</th><th>{t("Seriales", "Serials")}</th></tr></thead>
              <tbody>
                {deal.items.map((it) => {
                  const pending = it.qty - it.deliveryLines.reduce((s, l) => s + l.qty, 0);
                  return (
                    <tr key={it.id}>
                      <td><b>{it.description}</b><span className="src mono">{it.code}</span></td>
                      <td className="n val">{pending} / {it.qty}</td>
                      <td><input name={`qty_${it.id}`} type="number" min="0" max={pending} defaultValue={pending} disabled={pending === 0} style={{ width: 80 }} /></td>
                      <td><input name={`serials_${it.id}`} placeholder={t("Separados por coma", "Comma separated")} disabled={pending === 0} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>{t("Entrega", "Delivery")}</h2>
          <div className="stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label>{t("Fecha de entrega", "Delivery date")}<input name="deliveredAt" type="date" required defaultValue={dayInput(today())} /></label>
            <label>{t("Lugar", "Place")}<input name="place" defaultValue={deal.account.address ?? ""} /></label>
            <label>{t("Entrega", "Delivered by")}<input name="deliveredBy" placeholder={t("Transportadora o persona", "Carrier or person")} /></label>
            <label>{t("Recibe (nombre)", "Received by (name)")}<input name="receivedByName" /></label>
            {deal.account.requiresReceptionCode && <label>{t("Código de recepción de mercancía", "Goods-receipt code")}<input name="receptionCode" /></label>}
            <label className="check"><input type="checkbox" name="podReceived" /> {t("Tenemos la remisión firmada", "We have the signed delivery note")}</label>
            <label>{t("Observaciones", "Notes")}<textarea name="notes" /></label>
            <button type="submit">{t("Registrar remisión", "Record delivery note")}</button>
          </div>
        </div>
      </form>
    </>
  );
}
