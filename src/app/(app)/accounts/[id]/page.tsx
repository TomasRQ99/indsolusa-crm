import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput, invoiceCash } from "@/lib/domain";
import { stageLabel } from "@/lib/labels";
import { deleteAccount, updateAccount, updateBilling } from "../actions";
import { createContact } from "../../contacts/actions";
import { createDeal } from "../../deals/actions";
import { logActivity } from "../../activities/actions";
import { mailConfig } from "@/lib/mail";
import { EmailComposer } from "@/components/EmailComposer";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;

  const account = await db.account.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      contacts: { orderBy: { lastName: "asc" } },
      deals: { orderBy: { createdAt: "desc" }, include: { owner: { select: { name: true } } } },
      invoices: { orderBy: { issuedAt: "desc" }, include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 30, include: { user: { select: { name: true } } } },
    },
  });
  if (!account) notFound();

  const editable = canEdit(user, account.ownerId);
  const mail = mailConfig();
  const recipients = account.contacts.filter((c) => c.email).map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName} <${c.email}>` }));
  const users = canManageAll(user) ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const balance = account.invoices.reduce((s, inv) => s + invoiceCash(inv).balance, 0);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/accounts">{t("Clientes", "Customers")}</Link></div>
          <h1>{account.name}</h1>
          <p>{account.industry ?? t("Sin industria", "No industry")} · {t("Responsable", "Owner")}: {account.owner.name}{account.website && <> · <a href={account.website} target="_blank" rel="noreferrer">{account.website}</a></>}</p>
        </div>
      </div>

      <section className="sum">
        <div><span className="k">Journeys</span><span className="v">{account.deals.length}</span></div>
        <div><span className="k">{t("Saldo por cobrar", "Outstanding")}</span><span className="v">{i.n(balance)}</span><span className="s">USD</span></div>
        <div><span className="k">{t("Cupo de crédito", "Credit limit")}</span><span className="v">{account.creditLimit == null ? "—" : i.n(account.creditLimit)}</span><span className="s"><Link href="/administracion/cupos">{t("Ver cupos", "See limits")}</Link></span></div>
        <div><span className="k">{t("Plazo de pago", "Payment terms")}</span><span className="v">{account.paymentTermsDays}</span><span className="s">{t("días", "days")}</span></div>
      </section>

      <div className="two">
        <div className="stack-lg">
          <div className="card">
            <div className="bhead"><h2>Journeys</h2></div>
            <table>
              <tbody>
                {account.deals.map((d) => (
                  <tr key={d.id}>
                    <td><Link href={`/deals/${d.id}`}><b>{d.title}</b></Link><span className="src mono">{d.code}</span></td>
                    <td className="n val">{i.n(d.amount)}</td>
                    <td><span className={`badge ${d.stage === "WON" ? "won" : d.stage === "LOST" ? "lost" : ""}`}>{stageLabel(i, d.stage)}</span></td>
                    <td className="muted">{d.owner.name}</td>
                  </tr>
                ))}
                {account.deals.length === 0 && <tr><td className="muted">{t("Aún no hay Journeys.", "No Journeys yet.")}</td></tr>}
              </tbody>
            </table>
            <details style={{ marginTop: 10 }}>
              <summary>{t("Nuevo Journey", "New Journey")}</summary>
              <form action={createDeal} className="inline">
                <input type="hidden" name="accountId" value={account.id} />
                <input type="hidden" name="open" value="1" />
                <label style={{ flex: 1 }}>{t("Qué necesita el cliente", "What the customer needs")}<input name="title" required /></label>
                <label>{t("Venta estimada USD", "Estimated sale USD")}<input name="amount" type="number" min="0" step="100" required /></label>
                <button type="submit">{t("Crear y abrir", "Create and open")}</button>
              </form>
            </details>
          </div>

          {account.invoices.length > 0 && (
            <div className="card">
              <div className="bhead"><h2>{t("Facturas", "Invoices")}</h2></div>
              <table>
                <thead><tr><th>{t("Número", "Number")}</th><th>{t("Emitida", "Issued")}</th><th>{t("Vence", "Due")}</th><th className="n">{t("Valor", "Amount")}</th><th className="n">{t("Saldo", "Balance")}</th></tr></thead>
                <tbody>
                  {account.invoices.map((inv) => {
                    const c = invoiceCash(inv);
                    return (
                      <tr key={inv.id}>
                        <td><Link className="val" href={`/administracion/cobrar?f=${inv.id}`}>{inv.number}</Link></td>
                        <td>{i.date(inv.issuedAt)}</td>
                        <td>{i.date(inv.dueAt)}</td>
                        <td className="n val">{i.n2(c.amount)}</td>
                        <td className="n val">{c.balance > 0.005 ? i.n2(c.balance) : <span className="sig ok">{t("Pagada", "Paid")}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <div className="bhead"><h2>{t("Contactos", "Contacts")}</h2></div>
            <table>
              <tbody>
                {account.contacts.map((c) => (
                  <tr key={c.id}><td><b>{c.firstName} {c.lastName}</b></td><td className="muted">{c.title}</td><td>{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}</td><td className="muted">{c.phone}</td></tr>
                ))}
              </tbody>
            </table>
            <details style={{ marginTop: 10 }}>
              <summary>{t("Agregar contacto", "Add contact")}</summary>
              <form action={createContact} className="inline">
                <input type="hidden" name="accountId" value={account.id} />
                <label>{t("Nombre", "First name")}<input name="firstName" required /></label>
                <label>{t("Apellido", "Last name")}<input name="lastName" required /></label>
                <label>{t("Correo", "Email")}<input name="email" type="email" /></label>
                <label>{t("Cargo", "Title")}<input name="title" /></label>
                <button type="submit">{t("Agregar", "Add")}</button>
              </form>
            </details>
          </div>

          <div className="card">
            <div className="bhead"><h2>{t("Actividad", "Activity")}</h2></div>
            <form action={logActivity} className="inline" style={{ marginBottom: 8 }}>
              <input type="hidden" name="accountId" value={account.id} />
              <select name="type" defaultValue="CALL" aria-label={t("Tipo", "Type")}>
                <option value="CALL">{t("Llamada", "Call")}</option>
                <option value="MEETING">{t("Reunión", "Meeting")}</option>
                <option value="EMAIL">{t("Correo", "Email")}</option>
                <option value="NOTE">{t("Nota", "Note")}</option>
              </select>
              <input name="subject" placeholder={t("Qué pasó", "What happened")} required style={{ flex: 1 }} />
              <button type="submit" className="secondary">{t("Registrar", "Log")}</button>
            </form>
            <ul className="timeline">
              {account.activities.map((a) => (
                <li key={a.id}><b>{a.subject}</b>{a.body && <span className="small"> {a.body}</span>}<span className="src block">{a.user.name} · {i.date(a.occurredAt)}</span></li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="rail">
          {editable && (
            <div className="card">
              <span className="k">{t("Requisitos para facturar", "Invoicing requirements")}</span>
              <p className="src" style={{ margin: "4px 0 10px" }}>{t("SOLU usa estos datos para saber qué bloquea una factura.", "SOLU uses this to know what blocks an invoice.")}</p>
              <form action={updateBilling.bind(null, account.id)} className="stack">
                <label>NIT / Tax ID<input name="taxId" defaultValue={account.taxId ?? ""} /></label>
                <label className="check"><input type="checkbox" name="taxDataComplete" defaultChecked={account.taxDataComplete} /> {t("Datos tributarios completos", "Tax data complete")}</label>
                <label>{t("Plazo de pago (días)", "Payment terms (days)")}<input name="paymentTermsDays" type="number" min="0" defaultValue={account.paymentTermsDays} /></label>
                <label className="check"><input type="checkbox" name="requiresReceptionCode" defaultChecked={account.requiresReceptionCode} /> {t("Exige código de recepción de mercancía", "Requires goods-receipt code")}</label>
                <label className="check"><input type="checkbox" name="requiresPortal" defaultChecked={account.requiresPortal} /> {t("Factura por portal de proveedores", "Invoices through supplier portal")}</label>
                <label>{t("Inscripción al portal vigente hasta", "Portal registration valid until")}<input name="portalValidUntil" type="date" defaultValue={dayInput(account.portalValidUntil)} /></label>
                <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
              </form>
            </div>
          )}
          {mail.configured && recipients.length > 0 && (
            <div className="card">
              <details>
                <summary>{t("Escribir a un contacto", "Email a contact")}</summary>
                <EmailComposer recipients={recipients} from={mail.from!} es={i.es} />
              </details>
            </div>
          )}
          {editable && (
            <div className="card">
              <details>
                <summary>{t("Datos del cliente", "Customer details")}</summary>
                <form action={updateAccount.bind(null, account.id)} className="stack">
                  <label>{t("Nombre", "Name")}<input name="name" defaultValue={account.name} required /></label>
                  <label>{t("Industria", "Industry")}<input name="industry" defaultValue={account.industry ?? ""} /></label>
                  <label>{t("Sitio web", "Website")}<input name="website" type="url" defaultValue={account.website ?? ""} /></label>
                  <label>{t("Teléfono", "Phone")}<input name="phone" defaultValue={account.phone ?? ""} /></label>
                  <label>{t("Dirección", "Address")}<textarea name="address" defaultValue={account.address ?? ""} /></label>
                  {users.length > 0 && (
                    <label>{t("Responsable", "Owner")}
                      <select name="ownerId" defaultValue={account.ownerId}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                    </label>
                  )}
                  <button type="submit">{t("Guardar", "Save")}</button>
                </form>
              </details>
              <details style={{ marginTop: 10 }}>
                <summary className="small">{t("Eliminar cliente", "Delete customer")}</summary>
                <form action={deleteAccount.bind(null, account.id)}>
                  <p className="src" style={{ marginBottom: 6 }}>{t("Borra también sus Journeys, facturas y pagos.", "Also deletes its Journeys, invoices and payments.")}</p>
                  <button className="danger sm" type="submit">{t("Eliminar definitivamente", "Delete permanently")}</button>
                </form>
              </details>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
