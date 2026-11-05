import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { createAccount } from "./actions";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const { q = "" } = await searchParams;

  const accounts = await db.account.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    take: 200,
    include: { owner: { select: { name: true } }, _count: { select: { contacts: true, deals: true } } },
  });

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
      <details className="card">
        <summary>{t("Nuevo cliente", "New customer")}</summary>
        <form action={createAccount} className="inline">
          <label>{t("Nombre", "Name")}<input name="name" required /></label>
          <label>{t("Industria", "Industry")}<input name="industry" /></label>
          <label>{t("Sitio web", "Website")}<input name="website" type="url" placeholder="https://" /></label>
          <label>{t("Teléfono", "Phone")}<input name="phone" /></label>
          <button type="submit">{t("Crear", "Create")}</button>
        </form>
      </details>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Nombre", "Name")}</th><th>{t("Industria", "Industry")}</th><th>{t("Responsable", "Owner")}</th><th className="n">{t("Contactos", "Contacts")}</th><th className="n">Journeys</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/accounts/${a.id}`}><b>{a.name}</b></Link></td>
                <td>{a.industry ?? "—"}</td>
                <td>{a.owner.name}</td>
                <td className="n val">{a._count.contacts}</td>
                <td className="n val">{a._count.deals}</td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={5} className="empty"><b>{t("No hay clientes", "No customers found")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
