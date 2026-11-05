import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { loadForeignPayments, type ForeignFilters } from "@/lib/foreign-payments";
import { paymentStateLabel } from "@/lib/labels";

export default async function ForeignPaymentsPage({ searchParams }: { searchParams: Promise<ForeignFilters> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = await searchParams;
  const [{ rows, byCurrency, usd, usdMissing }, suppliers] = await Promise.all([
    loadForeignPayments(f),
    db.supplier.findMany({ select: { country: true, currency: true } }),
  ]);
  const countries = [...new Set(suppliers.map((s) => s.country).filter(Boolean))] as string[];
  const currencies = [...new Set(["USD", ...suppliers.map((s) => s.currency)])];
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Administración", "Administration")}</div>
          <h1>{t("Informe de pagos al exterior", "Foreign payments report")}</h1>
          <p>{t("Pagos a proveedores con su Supplier PO, Journey y estado. Filtra y exporta para contabilidad.", "Supplier payments with their supplier PO, Journey and state. Filter and export for accounting.")}</p>
        </div>
        <div className="grow" />
        <a className="btn" href={`/administracion/pagos-exterior/csv${qs ? `?${qs}` : ""}`}>{t("Exportar · Excel o CSV", "Export · Excel or CSV")}</a>
      </div>
      <form className="card inline" style={{ alignItems: "flex-end" }}>
        <label>{t("Mes", "Month")}<input type="month" name="month" defaultValue={f.month ?? ""} /></label>
        <label>{t("Moneda", "Currency")}
          <select name="currency" defaultValue={f.currency ?? ""}><option value="">{t("Todas", "All")}</option>{currencies.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>{t("País", "Country")}
          <select name="country" defaultValue={f.country ?? ""}><option value="">{t("Todos", "All")}</option>{countries.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label>{t("Estado", "State")}
          <select name="state" defaultValue={f.state ?? ""}><option value="">{t("Todos", "All")}</option><option value="paid">{t("Pagados", "Paid")}</option><option value="pending">{t("Pendientes", "Pending")}</option></select>
        </label>
        <button type="submit" className="secondary">{t("Filtrar", "Filter")}</button>
        {qs && <Link href="/administracion/pagos-exterior" className="small">{t("Quitar filtros", "Clear filters")}</Link>}
      </form>
      <section className="sum">
        <div><span className="k">{t("Pagos", "Payments")}</span><span className="v">{rows.length}</span></div>
        <div><span className="k">{t("Total ≈ USD", "Total ≈ USD")}</span><span className="v">{i.n(usd)}</span><span className="s">{usdMissing ? t(`${usdMissing} sin equivalente en USD`, `${usdMissing} without USD equivalent`) : t("equivalente registrado", "recorded equivalent")}</span></div>
        {[...byCurrency.entries()].map(([c, v]) => <div key={c}><span className="k">{c}</span><span className="v" style={{ fontSize: 18 }}>{i.n(v)}</span></div>)}
      </section>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Fecha", "Date")}</th><th>{t("Proveedor", "Supplier")}</th><th>Supplier PO · Journey</th><th className="n">{t("Monto", "Amount")}</th><th className="n">≈ USD</th><th>{t("Estado", "State")}</th><th>{t("Referencia", "Reference")}</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const l = paymentStateLabel(i, p.state);
              return (
                <tr key={p.id}>
                  <td>{i.date(p.executedAt ?? p.createdAt)}</td>
                  <td><b>{p.supplierPo.supplier.name}</b><span className="src">{p.supplierPo.supplier.country ?? ""}</span></td>
                  <td className="mono small"><Link href={`/administracion/pagos-proveedores/${p.id}`}>{p.supplierPo.code}</Link><span className="src">{p.supplierPo.deal.code} · {p.supplierPo.deal.account.name}</span></td>
                  <td className="n val">{p.currency} {i.n2(p.amount)}</td>
                  <td className="n val">{p.currency === "USD" ? i.n2(p.amount) : p.amountUsd ? i.n2(p.amountUsd) : "—"}</td>
                  <td><span className={`sig ${l.cls}`}>{l.text}</span></td>
                  <td className="mono small">{p.executedRef ?? "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="empty"><b>{t("Sin pagos para estos filtros", "No payments for these filters")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
