import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { mailConfig } from "@/lib/mail";
import { formatDate } from "@/lib/format";
import { EmailComposer } from "@/components/EmailComposer";

export default async function EmailPage() {
  await requireUser();
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
      include: {
        user: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        account: { select: { id: true, name: true } },
      },
    }),
  ]);

  const recipients = contacts.map((c) => ({
    id: c.id,
    label: `${c.firstName} ${c.lastName} <${c.email}>${c.account ? ` · ${c.account.name}` : ""}`,
  }));

  return (
    <>
      <h1>Email</h1>
      <div className="grid cols-2">
        <div className="card">
          <h2>New email</h2>
          {configured ? (
            <EmailComposer recipients={recipients} from={from!} />
          ) : (
            <p className="error">Email is not configured yet. An admin needs to set the email settings in .env.</p>
          )}
        </div>
        <div className="card">
          <h2>Sent from the CRM</h2>
          <ul className="timeline">
            {sent.map((a) => (
              <li key={a.id}>
                <strong>{a.subject}</strong>
                <div className="muted small">
                  To {a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : "—"}
                  {a.account && <> · <Link href={`/accounts/${a.account.id}`}>{a.account.name}</Link></>}
                  {" · "}{a.user.name} · {formatDate(a.occurredAt)}
                </div>
              </li>
            ))}
            {sent.length === 0 && <li className="muted">Nothing sent yet.</li>}
          </ul>
        </div>
      </div>
    </>
  );
}
