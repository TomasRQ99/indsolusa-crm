import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { createContact, deleteContact } from "./actions";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const { q = "" } = await searchParams;

  const [contacts, accounts] = await Promise.all([
    db.contact.findMany({
      where: q
        ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
        : undefined,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
      include: { account: { select: { id: true, name: true, ownerId: true } } },
    }),
    db.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <div className="ph">
        <div><div className="crumb">{t("Mercado", "Market")}</div><h1>{t("Contactos", "Contacts")}</h1></div>
        <div className="grow" />
        <form className="inline">
          <input name="q" defaultValue={q} placeholder={t("Buscar nombre o correo", "Search name or email")} />
          <button className="secondary" type="submit">{t("Buscar", "Search")}</button>
        </form>
      </div>
      <details className="card">
        <summary>{t("Nuevo contacto", "New contact")}</summary>
        <form action={createContact} className="inline">
          <label>{t("Nombre", "First name")}<input name="firstName" required /></label>
          <label>{t("Apellido", "Last name")}<input name="lastName" required /></label>
          <label>Email<input name="email" type="email" /></label>
          <label>{t("Teléfono", "Phone")}<input name="phone" /></label>
          <label>{t("Cargo", "Title")}<input name="title" /></label>
          <label>{t("Cliente", "Customer")}
            <select name="accountId" defaultValue="">
              <option value="">{t("— ninguno —", "— none —")}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <button type="submit">{t("Crear", "Create")}</button>
        </form>
      </details>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Nombre", "Name")}</th><th>{t("Cargo", "Title")}</th><th>{t("Cliente", "Customer")}</th><th>Email</th><th>{t("Teléfono", "Phone")}</th><th /></tr></thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td><b>{c.firstName} {c.lastName}</b></td>
                <td>{c.title ?? "—"}</td>
                <td>{c.account ? <Link href={`/accounts/${c.account.id}`}>{c.account.name}</Link> : "—"}</td>
                <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</td>
                <td>{c.phone ?? "—"}</td>
                <td>
                  {(!c.account || canEdit(user, c.account.ownerId)) && (
                    <form action={deleteContact.bind(null, c.id)}><button className="link small" type="submit">{t("Eliminar", "Delete")}</button></form>
                  )}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && <tr><td colSpan={6} className="empty"><b>{t("No hay contactos", "No contacts found")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
