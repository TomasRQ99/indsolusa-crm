import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { prInclude } from "@/lib/pr";
import { ITEM_TYPES, PURPOSES, exposureOf, prTotals } from "@/lib/pr-rules";
import { fullReadiness, getPurchasePolicy } from "@/lib/pr-auth";
import { REASONS, REASON_TEXT, canApprovePurchase } from "@/lib/purchase-auth";
import { ROLES, ROLE_LABEL, isGerencia } from "@/lib/permissions";
import { getSellers } from "@/lib/sellers";
import { createStockPr, savePurchasePolicy } from "./actions";

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
  const rows = await Promise.all(prs.map(async (pr) => { const F = await fullReadiness(pr); return { pr, r: F.readiness, F, tot: prTotals(pr.lines), ex: exposureOf(pr), spo: spos.find((s) => s.id === pr.supplierPoId) ?? null }; }));
  const pol = await getPurchasePolicy();
  const mine = rows.filter((x) => x.F.last?.status === "REQUESTED" && canApprovePurchase(user, x.F.last, pol.value));
  const gerencia = isGerencia(user);
  const errMsg: Record<string, string> = {
    justificacion: t("Una compra para stock debe decir por qué conviene.", "A stock purchase must say why it makes sense."),
    lineas: t("Agrega al menos un producto con cantidad.", "Add at least one product with a quantity."),
    permiso: t("No tienes permiso para crear requerimientos.", "You don't have permission to create requirements."),
    "no-existe": t("Ese requerimiento no existe.", "That requirement doesn't exist."),
    "pol-permiso": t("Solo Gerencia cambia la política de autorización.", "Only Management changes the authorization policy."),
    "pol-valor": t("Revisa el límite y los días.", "Check the limit and the days."),
    "pol-nivel2": t("El nivel 2 necesita al menos un rol: alguien debe poder autorizar por encima del límite.", "Level 2 needs at least one role: someone must be able to approve above the limit."),
  };
  const res = { READY_TO_PURCHASE: [t("Listo para comprar", "Ready to purchase"), "ok"], READY_WITH_APPROVED_EXCEPTION: [t("Listo, con autorización", "Ready, with authorization"), "ok"], NEEDS_RESOLUTION: [t("Falta resolver", "Needs resolution"), "attn"] } as const;

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Requerimientos de compra", "Purchase requirements")}</h1>
          <p>{t("Qué necesitamos comprar y para qué, antes de la orden al proveedor. Lo comprado para un cliente va asignado a su Journey; lo que sobra es inventario y pide su propia autorización.", "What we need to buy and what for, before the order to the supplier. What is bought for a customer is assigned to its Journey; anything beyond that is inventory and needs its own authorization.")}</p>
        </div>
      </div>
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {sp.ok === "pol-guardada" && <div className="note okn">{t("Política guardada como nueva versión. Las decisiones ya tomadas conservan la versión con la que se tomaron.", "Policy saved as a new version. Decisions already made keep the version they were made with.")}</div>}

      {mine.length > 0 && (
        <section className="card" id="decidir">
          <b>{t("Compras esperando tu autorización", "Purchases awaiting your authorization")}</b>
          <ul className="mk-ul">{mine.map(({ pr, F, tot }) => <li key={pr.id}><Link href={`/compras/requerimientos/${pr.id}#autorizacion`}>{pr.code}</Link> · {F.last!.requestedByName} · <span className="mono">{pr.currency} {i.n2(tot.total)}</span>{pr.deal ? ` · ${pr.deal.account.name}` : ""} · <span className="small muted">{(F.last!.reasons as string[]).map((x) => t(REASON_TEXT[x as keyof typeof REASON_TEXT]?.es ?? x, REASON_TEXT[x as keyof typeof REASON_TEXT]?.en ?? x)).join("; ")}</span></li>)}</ul>
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
                <td className="n mono">{ex.qty > 0 ? <>{ex.qty}<span className="block small">{pr.currency} {i.n2(ex.amount)}</span></> : "—"}</td>
                <td><span className={`sig ${res[r.result][1]}`}>{res[r.result][0]}</span>{r.blockers[0] && <span className="src block">{t(r.blockers[0].blocker.es, r.blockers[0].blocker.en)}</span>}</td>
                <td className="small">{spo ? <><Link href={`/compras/${spo.id}`}>{spo.code}</Link>{spo.releasedAt ? "" : t(" (sin liberar)", " (not released)")}</> : pr.purpose === "INVENTORY" ? t("Por crear", "To be created") : "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="politica">
        <b>{t("Política de autorización de compras", "Purchase authorization policy")} · v{pol.version}</b>
        <p className="src">{pol.version ? t(`Guardada por ${pol.by ?? "—"} el ${i.day(pol.at)}.`, `Saved by ${pol.by ?? "—"} on ${i.day(pol.at)}.`) : t("Valores iniciales decididos el 10 de noviembre de 2026. Aún nadie los ha cambiado.", "Starting values decided on 10 November 2026. Nobody has changed them yet.")} {t("Una compra de rutina (respaldada por la PO del cliente y sin nada fuera de lo normal) no pide autorización.", "A routine purchase (backed by the customer's PO with nothing unusual) needs no authorization.")}</p>
        {gerencia ? (
          <form action={savePurchasePolicy} className="qa-form" style={{ maxWidth: 720 }}>
            <label style={{ maxWidth: 320 }}>{t("Límite del nivel 1 (USD, sobre el compromiso relacionado)", "Level-1 limit (USD, on the related commitment)")}<input name="level1LimitUsd" type="number" min={0} step="0.01" required defaultValue={pol.value.level1LimitUsd} /></label>
            <b className="small">{t("Quién autoriza hasta el límite (nivel 1)", "Who approves up to the limit (level 1)")}</b>
            <div className="qa-row" style={{ flexWrap: "wrap" }}>{ROLES.map((r) => <label key={r} className="chk"><input type="checkbox" name={`l1_${r}`} value="1" defaultChecked={pol.value.level1Roles.includes(r)} /> {t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</label>)}</div>
            <b className="small">{t("Quién autoriza por encima del límite (nivel 2, también puede el nivel 1)", "Who approves above the limit (level 2, can also do level 1)")}</b>
            <div className="qa-row" style={{ flexWrap: "wrap" }}>{ROLES.map((r) => <label key={r} className="chk"><input type="checkbox" name={`l2_${r}`} value="1" defaultChecked={pol.value.level2Roles.includes(r)} /> {t(ROLE_LABEL[r].es, ROLE_LABEL[r].en)}</label>)}</div>
            <b className="small">{t("Qué hace que una compra pida autorización", "What makes a purchase need authorization")}</b>
            {REASONS.map((x) => <label key={x} className="chk"><input type="checkbox" name={`t_${x}`} value="1" defaultChecked={pol.value.triggers[x]} /> {t(REASON_TEXT[x].es, REASON_TEXT[x].en)}</label>)}
            <label style={{ maxWidth: 320 }}>{t("Días para sumar compras relacionadas (mismo proveedor y mismo Journey o producto)", "Days to add up related purchases (same supplier and same Journey or product)")}<input name="relatedDays" type="number" min={0} max={365} required defaultValue={pol.value.relatedDays} /></label>
            <button type="submit">{t("Guardar como nueva versión", "Save as new version")}</button>
            <span className="src block">{t("Nadie autoriza una compra que pidió. El límite se compara con el compromiso relacionado, para que dividir una compra no baje el nivel.", "Nobody approves a purchase they requested. The limit is compared with the related commitment, so splitting a purchase doesn't lower the level.")}</span>
          </form>
        ) : <p className="small">{t(`Hasta USD ${i.n2(pol.value.level1LimitUsd)}: ${pol.value.level1Roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.es ?? r).join(", ")} o nivel 2. Por encima: ${pol.value.level2Roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.es ?? r).join(", ")}. La cambia Gerencia.`, `Up to USD ${i.n2(pol.value.level1LimitUsd)}: ${pol.value.level1Roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.en ?? r).join(", ")} or level 2. Above: ${pol.value.level2Roles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.en ?? r).join(", ")}. Management changes it.`)}</p>}
      </section>
    </>
  );
}