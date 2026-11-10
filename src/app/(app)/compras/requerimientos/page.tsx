import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { prContext, prInclude } from "@/lib/pr";
import { ITEM_TYPES, PURPOSES, STOCK_STATUS, canDecideStock, exposureOf, prReadiness, prTotals } from "@/lib/pr-rules";
import { getSellers } from "@/lib/sellers";
import { createStockPr } from "./actions";

// Operaciones O1 · Purchase Requirements: what we need to buy and why, before any order to a supplier.

export default async function PrListPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const [prs, suppliers, sellers] = await Promise.all([
    db.purchaseRequirement.findMany({ where: { cancelledAt: null }, orderBy: { createdAt: "desc" }, take: 60, include: prInclude }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSellers(),
  ]);
  const spos = await db.supplierPO.findMany({ where: { id: { in: prs.map((p) => p.supplierPoId).filter((x): x is string => !!x) } }, select: { id: true, code: true, releasedAt: true } });
  const rows = await Promise.all(prs.map(async (pr) => ({ pr, r: prReadiness(pr, await prContext(pr)), tot: prTotals(pr.lines), ex: exposureOf(pr), spo: spos.find((s) => s.id === pr.supplierPoId) ?? null })));
  const mine = rows.filter((x) => x.pr.stockStatus === "REQUESTED" && canDecideStock(user, x.pr));
  const errMsg: Record<string, string> = {
    justificacion: t("Una compra para stock debe decir por qué conviene.", "A stock purchase must say why it makes sense."),
    lineas: t("Agrega al menos un producto con cantidad.", "Add at least one product with a quantity."),
    permiso: t("No tienes permiso para crear requerimientos.", "You don't have permission to create requirements."),
    "no-existe": t("Ese requerimiento no existe.", "That requirement doesn't exist."),
  };
  const res = { READY_TO_PURCHASE: [t("Listo para comprar", "Ready to purchase"), "ok"], READY_WITH_APPROVED_EXCEPTION: [t("Listo, con stock autorizado", "Ready, with authorized stock"), "ok"], NEEDS_RESOLUTION: [t("Falta resolver", "Needs resolution"), "attn"] } as const;

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Requerimientos de compra", "Purchase requirements")}</h1>
          <p>{t("Qué necesitamos comprar y para qué, antes de la orden al proveedor. Lo comprado para un cliente va asignado a su Journey; lo que sobra es inventario y pide su propia autorización.", "What we need to buy and what for, before the order to the supplier. What is bought for a customer is assigned to its Journey; anything beyond that is inventory and needs its own authorization.")}</p>
        </div>
      </div>
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {mine.length > 0 && (
        <section className="card" id="decidir">
          <b>{t("Stock esperando tu autorización", "Stock awaiting your authorization")}</b>
          <ul className="mk-ul">{mine.map(({ pr, ex }) => <li key={pr.id}><Link href={`/compras/requerimientos/${pr.id}#stock`}>{pr.code}</Link> · {pr.requester.name} · {t(`${ex.qty} unidades`, `${ex.qty} units`)} · <span className="mono">{pr.currency} {i.n2(ex.amount)}</span>{pr.deal ? ` · ${pr.deal.account.name}` : ""}</li>)}</ul>
        </section>
      )}

      <section className="card">
        <div className="jbh"><b>{t("Requerimientos", "Requirements")}</b><span className="grow" />
          <details className="qa" id="nuevo" open={sp.err === "justificacion" || sp.err === "lineas"}><summary className="qa-btn">{t("+ Compra para stock", "+ Stock purchase")}</summary>
            <div className="qa-pop wide right">
              <form action={createStockPr} className="qa-form">
                <label>{t("Por qué conviene tener este stock", "Why holding this stock makes sense")}<textarea name="justification" rows={2} required maxLength={500} placeholder={t("Ej.: rota cada mes, el proveedor exige mínimo de 10", "E.g.: sells every month, supplier requires a minimum of 10")} /></label>
                <div className="qa-row">
                  <label>{t("Empresa que compra", "Buying company")}<select name="sellerKey" defaultValue="USA">{sellers.filter((s) => s.active).map((s) => <option key={s.key} value={s.key}>{s.legalName}</option>)}</select></label>
                  <label>{t("Tipo", "Type")}<select name="itemType" defaultValue="PRODUCT">{Object.entries(ITEM_TYPES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                </div>
                <div className="qa-row">
                  <label>{t("Proveedor (si ya se sabe)", "Supplier (if known)")}<select name="supplierId" defaultValue=""><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                  <label style={{ flex: "0 0 auto" }}>{t("Se necesita para", "Needed by")}<input name="neededBy" type="date" /></label>
                </div>
                <b className="small">{t("Productos", "Products")}</b>
                {[0, 1, 2, 3].map((k) => (
                  <div key={k} className="qa-row">
                    <input name={`qty_${k}`} type="number" min={0} placeholder={t("Cant.", "Qty")} aria-label={t("Cantidad", "Quantity")} style={{ flex: "0 0 70px" }} />
                    <input name={`code_${k}`} maxLength={80} placeholder={t("Referencia", "Part number")} aria-label={t("Referencia", "Part number")} style={{ flex: "0 0 140px" }} />
                    <input name={`desc_${k}`} maxLength={300} placeholder={t("Descripción", "Description")} aria-label={t("Descripción", "Description")} style={{ flex: "1 1 160px" }} />
                    <input name={`cost_${k}`} type="number" min={0} step="0.01" placeholder={t("Costo unit.", "Unit cost")} aria-label={t("Costo unitario", "Unit cost")} style={{ flex: "0 0 110px" }} />
                  </div>
                ))}
                <span className="src block">{t("Una compra para stock siempre pide autorización de Finanzas o Gerencia. Las compras para un cliente nacen solas al preparar la compra desde su Journey.", "A stock purchase always asks Finance or Management for authorization. Customer purchases are created automatically when the purchase is prepared from its Journey.")}</span>
                <button type="submit">{t("Crear requerimiento", "Create requirement")}</button>
              </form>
            </div>
          </details>
        </div>
        {rows.length === 0 ? <p className="small muted">{t("Aún no hay requerimientos. Nacen al preparar una compra desde un Journey con PO aceptada.", "No requirements yet. They are created when a purchase is prepared from a Journey with an accepted PO.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Requerimiento", "Requirement")}</th><th>{t("Para qué", "Purpose")}</th><th className="n">{t("Total previsto", "Expected total")}</th><th className="n">{t("Sin asignar", "Unassigned")}</th><th>{t("Lectura", "Reading")}</th><th>{t("Orden", "Order")}</th></tr></thead>
            <tbody>{rows.map(({ pr, r, tot, ex, spo }) => (
              <tr key={pr.id}>
                <td><Link href={`/compras/requerimientos/${pr.id}`}>{pr.code}</Link><span className="src block">{pr.supplier?.name ?? t("sin proveedor", "no supplier")} · {i.day(pr.createdAt)}</span></td>
                <td className="small">{t(PURPOSES[pr.purpose]?.es ?? pr.purpose, PURPOSES[pr.purpose]?.en ?? pr.purpose)}{pr.deal && <span className="block"><Link href={`/deals/${pr.deal.id}`}>{pr.deal.code ?? pr.deal.title}</Link> · {pr.deal.account.name}</span>}</td>
                <td className="n mono">{pr.currency} {i.n2(tot.total)}</td>
                <td className="n mono">{ex.qty > 0 ? <>{ex.qty}<span className="block small">{pr.currency} {i.n2(ex.amount)}</span></> : "—"}{ex.qty > 0 && <span className={`sig ${STOCK_STATUS[pr.stockStatus]?.tone ?? "wait"}`}>{t(STOCK_STATUS[pr.stockStatus]?.es ?? "", STOCK_STATUS[pr.stockStatus]?.en ?? "")}</span>}</td>
                <td><span className={`sig ${res[r.result][1]}`}>{res[r.result][0]}</span>{r.blockers[0] && <span className="src block">{t(r.blockers[0].blocker.es, r.blockers[0].blocker.en)}</span>}</td>
                <td className="small">{spo ? <><Link href={`/compras/${spo.id}`}>{spo.code}</Link>{spo.releasedAt ? "" : t(" (sin liberar)", " (not released)")}</> : pr.purpose === "INVENTORY" ? t("Llega con inventario", "Arrives with inventory") : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
