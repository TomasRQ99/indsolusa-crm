import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { freshness, normCode } from "@/lib/x360";

export default async function ProductsPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const now = today();
  const [items, buys, qlines] = await Promise.all([
    db.dealItem.findMany({ where: { code: { not: null } }, select: { code: true, description: true, deal: { select: { accountId: true } } } }),
    db.supplierPOLine.findMany({ where: { code: { not: null } }, select: { code: true, description: true, unitCost: true, supplierPo: { select: { supplierId: true, currency: true, releasedAt: true, createdAt: true } } } }),
    db.quoteLine.findMany({ where: { code: { not: null } }, select: { code: true, description: true } }),
  ]);
  type Row = { code: string; name: string; customers: Set<string>; suppliers: Set<string>; last: Date | null; lastCost: string | null };
  const rows = new Map<string, Row>();
  const get = (c: string, d: string) => { const k = normCode(c); const r = rows.get(k) ?? { code: k, name: d, customers: new Set(), suppliers: new Set(), last: null, lastCost: null }; rows.set(k, r); return r; };
  items.forEach((x) => get(x.code!, x.description).customers.add(x.deal.accountId));
  qlines.forEach((x) => get(x.code!, x.description));
  for (const b of buys) {
    const r = get(b.code!, b.description);
    r.suppliers.add(b.supplierPo.supplierId);
    const at = b.supplierPo.releasedAt ?? b.supplierPo.createdAt;
    if (!r.last || at > r.last) { r.last = at; r.lastCost = `${b.supplierPo.currency} ${i.n2(b.unitCost)}`; }
  }
  const list = [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mercado", "Market")}</div>
          <h1>{t("Productos", "Products")}</h1>
          <p>{t("Cada producto reúne lo que sabemos por su código: quién lo compró, a quién se lo compramos, a qué precio real y si funcionó.", "Each product gathers what we know by its code: who bought it, whom we bought it from, at what actual price and whether it worked.")}</p>
        </div>
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Producto", "Product")}</th><th className="n">{t("Clientes", "Customers")}</th><th className="n">{t("Fuentes", "Sources")}</th><th>{t("Último costo real", "Last actual cost")}</th></tr></thead>
          <tbody>
            {list.map((r) => {
              const f = freshness(i, r.last, 180, now);
              return (
                <tr key={r.code}>
                  <td><Link href={`/productos/${encodeURIComponent(r.code)}`} className="val">{r.code}</Link><span className="src">{r.name}</span></td>
                  <td className="n mono">{r.customers.size}</td>
                  <td className="n mono">{r.suppliers.size}</td>
                  <td>{r.lastCost ? <><span className="mono">{r.lastCost}</span> <span className={`fresh${f.stale ? " stale" : ""}`}>{f.label}</span></> : <span className="src">{t("nunca comprado", "never purchased")}</span>}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={4} className="empty"><b>{t("Aún no hay productos con código", "No products with a code yet")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
