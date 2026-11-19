import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { createContact, deleteContact, setPromoOptIn } from "./actions";
import { DIAL_CODES } from "@/lib/customer-fields";

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
    db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
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
        <form action={createContact} className="nac">
          <div className="nac-grid">
            <label className="wide">{t("Cliente", "Customer")}
              <select name="accountId" defaultValue="">
                <option value="">{t("— ninguno —", "— none —")}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <div className="nac-grid">
            <label>{t("Nombre", "First name")}<input name="firstName" required /></label>
            <label>{t("Apellido", "Last name")}<input name="lastName" /></label>
            <label>{t("Cargo", "Title")}<input name="title" /></label>
            <label>{t("Correo", "Email")}<input name="email" type="email" placeholder="nombre@empresa.com" /></label>
            <div className="nac-f">
              <span className="nac-l">{t("Teléfono (opcional)", "Phone (optional)")}</span>
              <div className="nac-pair">
                <select name="phoneCode" aria-label={t("Indicativo del país", "Country code")} defaultValue="+57">
                  {DIAL_CODES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input name="phone" type="tel" aria-label={t("Número de teléfono", "Phone number")} />
              </div>
            </div>
          </div>
          <label className="check nac-opt"><input type="checkbox" name="promoOptIn" /> <span>{t("Autorizó recibir información y promociones por correo", "Agreed to receive information and promotions by email")}<span className="src block">{t("Márcala solo si la persona lo aceptó. Necesita un correo.", "Tick it only if the person agreed. It needs an email.")}</span></span></label>
          <div><button type="submit">{t("Crear contacto", "Create contact")}</button></div>
        </form>
      </details>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Nombre", "Name")}</th><th>{t("Cargo", "Title")}</th><th>{t("Cliente", "Customer")}</th><th>{t("Correo", "Email")}</th><th>{t("Teléfono", "Phone")}</th><th>{t("Promociones", "Promotions")}</th><th /></tr></thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td><b>{c.firstName} {c.lastName}</b></td>
                <td>{c.title ?? "—"}</td>
                <td>{c.account ? <Link href={`/accounts/${c.account.id}`}>{c.account.name}</Link> : "—"}</td>
                <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</td>
                <td>{c.phone ?? "—"}</td>
                <td>
                  {!c.email ? <span className="src">{t("sin correo", "no email")}</span> : (
                    <form action={setPromoOptIn.bind(null, c.id, !c.promoOptIn)}>
                      {c.promoOptIn ? t("Autorizó", "Agreed") : t("Sin autorización", "No permission")}
                      {(!c.account || canEdit(user, c.account.ownerId)) && <> · <button className="link small" type="submit">{c.promoOptIn ? t("Quitar", "Remove") : t("Marcar que autorizó", "Mark as agreed")}</button></>}
                    </form>
                  )}
                </td>
                <td>
                  {(!c.account || canEdit(user, c.account.ownerId)) && (
                    <form action={deleteContact.bind(null, c.id)} data-confirm={t(`¿Eliminar a ${c.firstName} ${c.lastName}? No se puede deshacer.`, `Delete ${c.firstName} ${c.lastName}? This can't be undone.`)}><button className="link small" type="submit">{t("Eliminar", "Delete")}</button></form>
                  )}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && <tr><td colSpan={7} className="empty"><b>{t("No hay contactos", "No contacts found")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
