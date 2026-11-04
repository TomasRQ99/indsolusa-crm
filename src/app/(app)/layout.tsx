import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">{APP_NAME}</div>
        <nav>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/accounts">Accounts</Link>
          <Link href="/contacts">Contacts</Link>
          <Link href="/deals">Deals</Link>
          <Link href="/tasks">Tasks</Link>
          <Link href="/email">Email</Link>
          {user.role === "ADMIN" && <Link href="/admin/users">Users</Link>}
        </nav>
        <div className="me">
          <div>
            <Link href="/profile" style={{ color: "inherit" }}>{user.name}</Link> <span className="badge">{user.role}</span>
          </div>
          <form action={logout}>
            <button className="link" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
