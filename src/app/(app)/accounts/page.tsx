import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createAccount } from "./actions";

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const { q = "" } = await searchParams;

  const accounts = await db.account.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    take: 200,
    include: {
      owner: { select: { name: true } },
      _count: { select: { contacts: true, deals: true } },
    },
  });

  return (
    <>
      <div className="spread">
        <h1>Accounts</h1>
        <form className="inline">
          <input name="q" defaultValue={q} placeholder="Search accounts" />
          <button className="secondary" type="submit">Search</button>
        </form>
      </div>

      <div className="card">
        <h2>New account</h2>
        <form action={createAccount} className="inline">
          <label>Name<input name="name" required /></label>
          <label>Industry<input name="industry" /></label>
          <label>Website<input name="website" type="url" placeholder="https://" /></label>
          <label>Phone<input name="phone" /></label>
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th>Name</th><th>Industry</th><th>Owner</th><th>Contacts</th><th>Deals</th></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td><Link href={`/accounts/${a.id}`}>{a.name}</Link></td>
                <td>{a.industry ?? "—"}</td>
                <td>{a.owner.name}</td>
                <td>{a._count.contacts}</td>
                <td>{a._count.deals}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={5} className="muted">No accounts found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
