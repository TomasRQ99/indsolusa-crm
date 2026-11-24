import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { createAccount } from "./actions";
import { NewAccountForm } from "@/components/NewAccountForm";
import { countryName } from "@/lib/customer-fields";
import "@/components/customer-stats.css";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; err?: string }> }) {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const { q = "", err } = await searchParams;
  const dup = err ? await db.account.findUnique({ where: { id: err }, select: { id: true, name: true } }) : null;

  const accounts = await db.account.findMany({
    where: { internal: false, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
    orderBy: { name: "asc" },
    take: 200,
    include: { owner: { select: { name: true } }, _count: { select: { contacts: true, deals: true } } },
  });
  // Invoiced in the last 12 months (USD before VAT), the same figure as the customer's Estadísticas.
  const since = new Date(); since.setUTCMonth(since.getUTCMonth() - 12);
  const sales = accounts.length ? await db.invoice.groupBy({ by: ["accountId"], where: { accountId: { in: accounts.map((a) => a.id) }, issuedAt: { gte: since } }, _sum: { amount: true } }) : [];
  const soldBy = new Map(sales.map((x) => [x.accountId, Number(x._sum.amount ?? 0)]));
  const i = makeI18n(user.lang);

  return (
    <>
      <div className="ph">
        <div><div className="crumb">{t("Mercado", "Market")}</div><h1>{t("Clientes", "Customers")}</h1></div>
        <div className="grow" />
        <form className="inline">
          <input name="q" defaultValue={q} placeholder={t("Buscar cliente", "Search customers")} />
          <button className="secondary" type="submit">{t("Buscar", "Search")}</button>
        </form>
      </div>
      {dup && (
        <p className="note attn" role="alert">
          {t("Ya existe un cliente con ese RUT/NIT: ", "A customer with that tax ID already exists: ")}
          <Link href={`/accounts/${dup.id}`}><b>{dup.name}</b></Link>
        </p>
      )}
      <details className="card" open={!!dup}>
        <summary>{t("Nuevo cliente", "New customer")}</summary>
        <NewAccountForm action={createAccount} lang={user.lang === "EN" ? "EN" : "ES"} />
      </details>
      <p className="src">{t("Toca un cliente para abrir su perfil; ahí está el botón Estadísticas, con sus cifras mes a mes.", "Tap a customer to open their profile; the Statistics button there has their figures month by month.")}</p>
      <div className="card flush tscroll">
        <table className="cs-rows">
          <thead><tr><th>{t("Nombre", "Name")}</th><th>{t("Industria", "Industry")}</th><th>{t("Ciudad y país", "City and country")}</th><th>{t("Responsable", "Owner")}</th><th className="n">{t("Contactos", "Contacts")}</th><th className="n">{t("Necesidades", "Needs")}</th><th className="n">{t("Facturado · 12 meses", "Invoiced · 12 months")}</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/accounts/${a.id}`}><b>{a.name}</b></Link></td>
                <td>{a.industry ?? "—"}</td>
                <td>{[a.city, countryName(a.country, user.lang !== "EN")].filter(Boolean).join(", ") || "—"}</td>
                <td>{a.owner.name}</td>
                <td className="n val">{a._count.contacts}</td>
                <td className="n val">{a._count.deals}</td>
                <td className="n val">{soldBy.get(a.id) ? i.money(soldBy.get(a.id)) : <span className="muted">—</span>}</td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={7} className="empty"><b>{t("No hay clientes", "No customers found")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
