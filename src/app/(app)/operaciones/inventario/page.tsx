import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { LOT_STATES, stockSummary } from "@/lib/stock-rules";
import { moveLot } from "@/app/(app)/compras/recepcion-actions";

// Operaciones O6 · stock (module 11 §34.2–34.3): physical, allocated and available are three different numbers.
// Units in quarantine, damaged or to be returned are physically here and never available.

const FREE_DB_BYTES = 0.5 * 1024 * 1024 * 1024;

export default async function StockPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const [locations, lots, a, b, c, d, e] = await Promise.all([
    db.stockLocation.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.stockLot.findMany({ where: { outAt: null }, orderBy: [{ state: "asc" }, { createdAt: "asc" }], include: { deal: { select: { id: true, code: true, title: true, account: { select: { name: true } } } }, receiptLine: { select: { exceptionKind: true, receipt: { select: { code: true, receivedAt: true, supplierPoId: true } } } } } }),
    db.goodsReceiptPhoto.aggregate({ _sum: { size: true }, _count: true }),
    db.visitAttachment.aggregate({ _sum: { size: true } }),
    db.missionExpense.aggregate({ _sum: { receiptSize: true } }),
    db.accountDocument.aggregate({ _sum: { size: true } }),
    db.profileItem.aggregate({ _sum: { size: true } }),
  ]);
  const sum = stockSummary(lots);
  const blocked = lots.filter((l) => LOT_STATES[l.state]?.blocked);
  const usedFiles = (a._sum.size ?? 0) + (b._sum.size ?? 0) + (c._sum.receiptSize ?? 0) + (d._sum.size ?? 0) + (e._sum.size ?? 0);
  const mb = (n: number) => i.n2(n / 1024 / 1024);
  const errMsg: Record<string, string> = { nota: t("Escribe el motivo.", "Write the reason."), permiso: t("No tienes permiso sobre ese lote.", "You don't have permission on that lot."), bloqueado: t("Unidades en cuarentena o dañadas no salen hacia un cliente.", "Units in quarantine or damaged don't leave towards a customer."), accion: t("Ese cambio no aplica a este lote.", "That change doesn't apply to this lot."), salio: t("Ese lote ya salió.", "That lot already left."), lote: t("Ese lote no existe.", "That lot doesn't exist.") };

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Inventario", "Stock")}</h1>
          <p>{t("Lo que está físicamente en cada bodega, cuánto está comprometido a una Necesidad y cuánto está de verdad disponible. Lo que está en duda no cuenta como disponible.", "What is physically in each warehouse, how much is committed to a Necessity and how much is truly available. Anything in doubt doesn't count as available.")}</p>
        </div>
      </div>
      {sp.ok === "lote" && <div className="note okn">{t("Lote actualizado.", "Lot updated.")}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {blocked.length > 0 && (
        <section className="card" id="duda">
          <b>{t("EN DUDA: NO DISPONIBLE HASTA RESOLVER", "IN DOUBT: NOT AVAILABLE UNTIL RESOLVED")}</b>
          {blocked.map((l) => (
            <article key={l.id} className="exc-item">
              <header className="exc-head"><span className={`sig ${LOT_STATES[l.state].tone}`}>{t(LOT_STATES[l.state].es, LOT_STATES[l.state].en)}</span> <b>{l.qty} × {l.code ?? l.description}</b><span className="grow" /><span className="small muted">{locations.find((x) => x.id === l.locationId)?.name} · <Link href={`/compras/${l.receiptLine.receipt.supplierPoId}#recepcion`}>{l.receiptLine.receipt.code}</Link></span></header>
              <p className="small">{l.stateNote}{l.stateByName ? <span className="muted"> · {l.stateByName} · {i.day(l.stateAt)}</span> : null}</p>
              {l.state === "QUARANTINE" && (
                <form action={moveLot.bind(null, l.id)} className="qa-row" style={{ flexWrap: "wrap" }}>
                  <input name="note" required maxLength={300} placeholder={t("Qué se decidió y por qué", "What was decided and why")} aria-label={t("Motivo", "Reason")} style={{ flex: "1 1 240px" }} />
                  <button type="submit" name="action" value="RELEASE" className="secondary" style={{ flex: "0 0 auto" }}>{t("Liberar: está bien", "Release: it is fine")}</button>
                  <button type="submit" name="action" value="DAMAGED" className="secondary" style={{ flex: "0 0 auto" }}>{t("Dañado", "Damaged")}</button>
                  <button type="submit" name="action" value="RETURN_PENDING" className="secondary" style={{ flex: "0 0 auto" }}>{t("Devolver al proveedor", "Return to supplier")}</button>
                </form>
              )}
            </article>
          ))}
        </section>
      )}

      <section className="card" id="resumen">
        <b>{t("POR BODEGA Y REFERENCIA", "BY WAREHOUSE AND PART")}</b>
        {sum.length === 0 ? <p className="small muted">{t("Aún no hay inventario. Aparece al registrar la recepción de una compra.", "No stock yet. It appears when the receipt of a purchase is recorded.")} <a href="/compras">{t("Abrir Compras para registrar una recepción", "Open Purchases to record a receipt")} →</a></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Bodega", "Warehouse")}</th><th>{t("Referencia", "Part")}</th><th className="n">{t("Físico", "Physical")}</th><th className="n">{t("Comprometido", "Allocated")}</th><th className="n">{t("Disponible", "Available")}</th><th className="n">{t("En duda", "In doubt")}</th></tr></thead>
            <tbody>{sum.map((g, k) => <tr key={k}><td className="small">{locations.find((x) => x.id === g.locationId)?.name ?? "—"}</td><td>{g.code ? <b className="mono">{g.code}</b> : null} <span className="small">{g.description}</span></td><td className="n mono">{g.physical}</td><td className="n mono">{g.allocated}</td><td className="n mono"><b>{g.available}</b></td><td className={`n mono${g.blocked ? " risk-t" : ""}`}>{g.blocked}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="lotes">
        <b>{t("LOTES EN BODEGA", "LOTS IN THE WAREHOUSE")}</b>
        {lots.filter((l) => !LOT_STATES[l.state]?.blocked).length === 0 ? <p className="small muted">{t("Nada comprometido ni disponible por ahora.", "Nothing committed or available for now.")} <Link href="/compras">{t("Abrir Compras", "Open Purchases")} →</Link></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Lote", "Lot")}</th><th>{t("Estado", "State")}</th><th>{t("Para", "For")}</th><th>{t("Salida", "Out")}</th></tr></thead>
            <tbody>{lots.filter((l) => !LOT_STATES[l.state]?.blocked).map((l) => (
              <tr key={l.id}>
                <td><b>{l.qty}</b> × {l.code ?? l.description}<span className="src block">{locations.find((x) => x.id === l.locationId)?.name} · <Link href={`/compras/${l.receiptLine.receipt.supplierPoId}#recepcion`}>{l.receiptLine.receipt.code}</Link> · {i.day(l.receiptLine.receipt.receivedAt)}</span></td>
                <td><span className={`sig ${LOT_STATES[l.state]?.tone ?? "wait"}`}>{t(LOT_STATES[l.state]?.es ?? l.state, LOT_STATES[l.state]?.en ?? l.state)}</span></td>
                <td className="small">{l.deal ? <><Link href={`/deals/${l.deal.id}`}>{l.deal.code ?? l.deal.title}</Link> · {l.deal.account.name}</> : t("Stock libre", "Free stock")}</td>
                <td><form action={moveLot.bind(null, l.id)} className="qa-row"><input type="hidden" name="action" value="OUT" /><input name="note" required maxLength={300} placeholder={t("A quién salió / remisión", "Who it left to / delivery note")} aria-label={t("Salida", "Out")} style={{ minWidth: 150 }} /><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Salió", "Left")}</button></form></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="src">{t("Por ahora la salida se marca a mano; se enlazará sola con el despacho al cliente en la etapa de despacho.", "For now leaving is marked by hand; it will link to customer dispatch by itself in the dispatch stage.")}</p>
      </section>

      <section className="card" id="espacio">
        <b>{t("ESPACIO PARA FOTOS Y DOCUMENTOS", "SPACE FOR PHOTOS AND DOCUMENTS")}</b>
        <p className="small">{t(`${mb(usedFiles)} MB usados por fotos y documentos (${a._count} fotos de recepción). La base de datos gratuita tiene unos 512 MB en total para todo SOLU.`, `${mb(usedFiles)} MB used by photos and documents (${a._count} receipt photos). The free database has about 512 MB in total for all of SOLU.`)} <b>{i.pct((usedFiles / FREE_DB_BYTES) * 100)}</b></p>
        <p className="src">{t("Cuando esto se acerque al 60 %, conviene pasar la base de datos a un plan pago. Esta cifra cuenta solo archivos, no el resto de los datos.", "When this nears 60 %, it is worth moving the database to a paid plan. This figure counts files only, not the rest of the data.")}</p>
      </section>
    </>
  );
}
