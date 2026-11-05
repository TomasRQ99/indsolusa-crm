import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { mailConfig } from "@/lib/mail";
import { makeI18n } from "@/lib/i18n";
import { EmailComposer } from "@/components/EmailComposer";

export default async function EmailPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { from, configured } = mailConfig();

  const [contacts, sent] = await Promise.all([
    db.contact.findMany({
      where: { email: { not: null } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, email: true, account: { select: { name: true } } },
    }),
    db.activity.findMany({
      where: { type: "EMAIL" },
      orderBy: { occurredAt: "desc" },
      take: 50,
      include: { user: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } }, account: { select: { id: true, name: true } } },
    }),
  ]);
  const recipients = contacts.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName} <${c.email}>${c.account ? ` · ${c.account.name}` : ""}` }));

  return (
    <>
      <div className="ph"><div><div className="crumb">{t("Mi día", "My day")}</div><h1>{t("Correo", "Email")}</h1></div></div>
      <div className="grid cols-2">
        <div className="card">
          <h2>{t("Nuevo correo", "New email")}</h2>
          {configured ? <EmailComposer recipients={recipients} from={from!} /> : <p className="error">{t("El correo aún no está configurado.", "Email is not configured yet.")}</p>}
        </div>
        <div className="card">
          <h2>{t("Enviados desde SOLU", "Sent from SOLU")}</h2>
          <ul className="timeline">
            {sent.map((a) => (
              <li key={a.id}>
                <b>{a.subject}</b>
                <span className="src block">
                  {t("Para", "To")} {a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : "—"}
                  {a.account && <> · <Link href={`/accounts/${a.account.id}`}>{a.account.name}</Link></>} · {a.user.name} · {i.date(a.occurredAt)}
                </span>
              </li>
            ))}
            {sent.length === 0 && <li className="muted">{t("Nada enviado todavía.", "Nothing sent yet.")}</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
