import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";

// One search box for customers, Journeys (code, title, customer PO), invoices, supplier POs and suppliers.
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const q = ((await searchParams).q ?? "").trim();
  const like = { contains: q, mode: "insensitive" as const };

  const [accounts, deals, invoices, spos, suppliers] = q
    ? await Promise.all([
        db.account.findMany({ where: { name: like }, take: 10, select: { id: true, name: true } }),
        db.deal.findMany({ where: { OR: [{ code: like }, { title: like }, { customerPo: like }] }, take: 15, include: { account: { select: { name: true } } } }),
        db.invoice.findMany({ where: { number: like }, take: 10, include: { account: { select: { name: true } } } }),
        db.supplierPO.findMany({ where: { code: like }, take: 10, include: { supplier: { select: { name: true } }, deal: { select: { id: true, code: true } } } }),
        db.supplier.findMany({ where: { name: like }, take: 10, select: { id: true, name: true, country: true } }),
      ])
    : [[], [], [], [], []];
  const total = accounts.length + deals.length + invoices.length + spos.length + suppliers.length;

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Buscar", "Search")}</h1>
          <p>{q ? t(`${total} resultados para "${q}"`, `${total} results for "${q}"`) : t("Escribe en la barra superior: cliente, Journey, OC, factura o proveedor.", "Type in the top bar: customer, Journey, PO, invoice or supplier.")}</p>
        </div>
      </div>
      {q && (
        <div className="grid cols-2">
          {deals.length > 0 && (
            <div className="card"><h2>Journeys</h2><ul className="timeline">{deals.map((d) => <li key={d.id}><Link href={`/deals/${d.id}`}><b>{d.code}</b> · {d.title}</Link><span className="src block">{d.account.name}{d.customerPo ? ` · ${t("OC", "PO")} ${d.customerPo}` : ""}</span></li>)}</ul></div>
          )}
          {accounts.length > 0 && (
            <div className="card"><h2>{t("Clientes", "Customers")}</h2><ul className="timeline">{accounts.map((a) => <li key={a.id}><Link href={`/accounts/${a.id}`}>{a.name}</Link></li>)}</ul></div>
          )}
          {invoices.length > 0 && (
            <div className="card"><h2>{t("Facturas", "Invoices")}</h2><ul className="timeline">{invoices.map((v) => <li key={v.id}><Link href={`/administracion/cobrar?f=${v.id}`} className="mono">{v.number}</Link><span className="src block">{v.account.name} · {i.money2(v.amount)}</span></li>)}</ul></div>
          )}
          {spos.length > 0 && (
            <div className="card"><h2>Supplier PO</h2><ul className="timeline">{spos.map((s) => <li key={s.id}><Link href={`/deals/${s.deal.id}`} className="mono">{s.code}</Link><span className="src block">{s.supplier.name} · {s.deal.code}</span></li>)}</ul></div>
          )}
          {suppliers.length > 0 && (
            <div className="card"><h2>{t("Proveedores", "Suppliers")}</h2><ul className="timeline">{suppliers.map((s) => <li key={s.id}><Link href={`/suppliers#${s.id}`}>{s.name}</Link><span className="src block">{s.country}</span></li>)}</ul></div>
          )}
          {total === 0 && <div className="card empty"><b>{t("Sin resultados", "No results")}</b></div>}
        </div>
      )}
    </>
  );
}
