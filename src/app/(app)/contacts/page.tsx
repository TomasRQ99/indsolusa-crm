import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { createContact, deleteContact } from "./actions";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const { q = "" } = await searchParams;

  const [contacts, accounts] = await Promise.all([
    db.contact.findMany({
      where: q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
      include: { account: { select: { id: true, name: true, ownerId: true } } },
    }),
    db.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <div className="spread">
        <h1>Contacts</h1>
        <form className="inline">
          <input name="q" defaultValue={q} placeholder="Search name or email" />
          <button className="secondary" type="submit">Search</button>
        </form>
      </div>

      <div className="card">
        <h2>New contact</h2>
        <form action={createContact} className="inline">
          <label>First name<input name="firstName" required /></label>
          <label>Last name<input name="lastName" required /></label>
          <label>Email<input name="email" type="email" /></label>
          <label>Phone<input name="phone" /></label>
          <label>Title<input name="title" /></label>
          <label>
            Account
            <select name="accountId" defaultValue="">
              <option value="">— none —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Title</th><th>Account</th><th>Email</th><th>Phone</th><th></th></tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id}>
                <td>{c.firstName} {c.lastName}</td>
                <td>{c.title ?? "—"}</td>
                <td>{c.account ? <Link href={`/accounts/${c.account.id}`}>{c.account.name}</Link> : "—"}</td>
                <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</td>
                <td>{c.phone ?? "—"}</td>
                <td>
                  {(!c.account || canEdit(user, c.account.ownerId)) && (
                    <form action={deleteContact.bind(null, c.id)}>
                      <button className="link small" type="submit">Delete</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && <tr><td colSpan={6} className="muted">No contacts found.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
