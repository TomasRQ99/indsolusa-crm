import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { createAccount } from "./actions";
import { NewAccountForm } from "@/components/NewAccountForm";

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
