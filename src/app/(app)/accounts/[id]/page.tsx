import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { STAGE_LABEL, STAGES, formatDate, formatMoney } from "@/lib/format";
import { deleteAccount, updateAccount } from "../actions";
import { createContact } from "../../contacts/actions";
import { createDeal } from "../../deals/actions";
import { createTask } from "../../tasks/actions";
import { logActivity } from "../../activities/actions";
import { mailConfig } from "@/lib/mail";
import { EmailComposer } from "@/components/EmailComposer";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const account = await db.account.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      contacts: { orderBy: { lastName: "asc" } },
      deals: { orderBy: { createdAt: "desc" }, include: { owner: { select: { name: true } } } },
      tasks: { where: { status: "OPEN" }, orderBy: { dueDate: "asc" }, include: { assignee: { select: { name: true } } } },
      activities: { orderBy: { occurredAt: "desc" }, take: 50, include: { user: { select: { name: true } } } },
    },
  });
  if (!account) notFound();

  const editable = canEdit(user, account.ownerId);
  const mail = mailConfig();
  const recipients = account.contacts
    .filter((c) => c.email)
    .map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName} <${c.email}>` }));
  const users = canManageAll(user)
    ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];

  return (
    <>
      <div className="spread">
        <div>
          <Link href="/accounts" className="small">← Accounts</Link>
          <h1>{account.name}</h1>
          <p className="muted small">
            {account.industry ?? "No industry"} · Owner: {account.owner.name}
            {account.website && <> · <a href={account.website} target="_blank" rel="noreferrer">{account.website}</a></>}
          </p>
        </div>
        {editable && (
          <form action={deleteAccount.bind(null, account.id)}>
            <button className="danger" type="submit">Delete account</button>
          </form>
        )}
      </div>

      <div className="grid cols-2">
        <div>
          {editable && (
            <div className="card">
              <h2>Details</h2>
              <form action={updateAccount.bind(null, account.id)} className="stack">
                <label>Name<input name="name" defaultValue={account.name} required /></label>
                <label>Industry<input name="industry" defaultValue={account.industry ?? ""} /></label>
                <label>Website<input name="website" type="url" defaultValue={account.website ?? ""} /></label>
                <label>Phone<input name="phone" defaultValue={account.phone ?? ""} /></label>
                <label>Address<textarea name="address" defaultValue={account.address ?? ""} /></label>
                {users.length > 0 && (
                  <label>
                    Owner
                    <select name="ownerId" defaultValue={account.ownerId}>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                )}
                <button type="submit">Save</button>
              </form>
            </div>
          )}

          <div className="card">
            <h2>Contacts</h2>
            <table>
              <tbody>
                {account.contacts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.firstName} {c.lastName}</td>
                    <td className="muted">{c.title}</td>
                    <td>{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form action={createContact} className="inline" style={{ marginTop: "0.75rem" }}>
              <input type="hidden" name="accountId" value={account.id} />
              <label>First<input name="firstName" required /></label>
              <label>Last<input name="lastName" required /></label>
              <label>Email<input name="email" type="email" /></label>
              <label>Title<input name="title" /></label>
              <button type="submit">Add</button>
            </form>
          </div>

          <div className="card">
            <h2>Deals</h2>
            <table>
              <tbody>
                {account.deals.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}</td>
                    <td>{formatMoney(d.amount)}</td>
                    <td><span className={`badge ${d.stage.toLowerCase()}`}>{STAGE_LABEL[d.stage]}</span></td>
                    <td className="muted">{d.owner.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form action={createDeal} className="inline" style={{ marginTop: "0.75rem" }}>
              <input type="hidden" name="accountId" value={account.id} />
              <label>Title<input name="title" required /></label>
              <label>Amount<input name="amount" type="number" min="0" step="100" required /></label>
              <label>
                Stage
                <select name="stage" defaultValue="LEAD">
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
              </label>
              <label>Close date<input name="closeDate" type="date" /></label>
              <button type="submit">Add deal</button>
            </form>
          </div>
        </div>

        <div>
          {mail.configured && (
            <div className="card">
              <h2>Email a contact</h2>
              <EmailComposer recipients={recipients} from={mail.from!} />
            </div>
          )}

          <div className="card">
            <h2>Open tasks</h2>
            <ul className="timeline">
              {account.tasks.map((t) => (
                <li key={t.id}>
                  {t.title}
                  <div className="muted small">{t.assignee.name} · due {formatDate(t.dueDate)}</div>
                </li>
              ))}
            </ul>
            <form action={createTask} className="inline" style={{ marginTop: "0.75rem" }}>
              <input type="hidden" name="accountId" value={account.id} />
              <label>Task<input name="title" required /></label>
              <label>Due<input name="dueDate" type="date" /></label>
              <button type="submit">Add task</button>
            </form>
          </div>

          <div className="card">
            <h2>Activity</h2>
            <form action={logActivity} className="stack">
              <input type="hidden" name="accountId" value={account.id} />
              <div className="row">
                <select name="type" defaultValue="CALL">
                  <option value="CALL">Call</option>
                  <option value="MEETING">Meeting</option>
                  <option value="EMAIL">Email</option>
                  <option value="NOTE">Note</option>
                </select>
                <input name="subject" placeholder="Subject" required style={{ flex: 1 }} />
              </div>
              <textarea name="body" placeholder="Details (optional)" />
              <button type="submit">Log activity</button>
            </form>
            <ul className="timeline">
              {account.activities.map((a) => (
                <li key={a.id}>
                  <span className="badge">{a.type}</span> <strong>{a.subject}</strong>
                  {a.body && <div className="small">{a.body}</div>}
                  <div className="muted small">{a.user.name} · {formatDate(a.occurredAt)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
