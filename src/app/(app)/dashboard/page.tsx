import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";

function startOfQuarter(d = new Date()) {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();

  const [open, won, overdue, myTasks, recent] = await Promise.all([
    db.deal.aggregate({ where: { stage: { notIn: ["WON", "LOST"] } }, _sum: { amount: true }, _count: true }),
    db.deal.aggregate({
      where: { stage: "WON", updatedAt: { gte: startOfQuarter(now) } },
      _sum: { amount: true },
      _count: true,
    }),
    db.task.count({ where: { assigneeId: user.id, status: "OPEN", dueDate: { lt: now } } }),
    db.task.findMany({
      where: { assigneeId: user.id, status: "OPEN" },
      orderBy: { dueDate: { sort: "asc", nulls: "last" } },
      take: 8,
      include: { account: { select: { id: true, name: true } } },
    }),
    db.activity.findMany({
      orderBy: { occurredAt: "desc" },
      take: 8,
      include: { user: { select: { name: true } }, account: { select: { id: true, name: true } } },
    }),
  ]);

  return (
    <>
      <h1>Welcome back, {user.name.split(" ")[0]}</h1>

      <div className="grid cols-4">
        <div className="card stat">
          <div className="label">Open pipeline</div>
          <div className="value">{formatMoney(open._sum.amount)}</div>
          <div className="muted small">{open._count} open deals</div>
        </div>
        <div className="card stat">
          <div className="label">Won this quarter</div>
          <div className="value">{formatMoney(won._sum.amount)}</div>
          <div className="muted small">{won._count} deals</div>
        </div>
        <div className="card stat">
          <div className="label">My open tasks</div>
          <div className="value">{myTasks.length}</div>
        </div>
        <div className="card stat">
          <div className="label">My overdue tasks</div>
          <div className="value">{overdue}</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="spread">
            <h2>My next tasks</h2>
            <Link href="/tasks" className="small">All tasks</Link>
          </div>
          {myTasks.length === 0 ? (
            <p className="muted">Nothing open. Nice.</p>
          ) : (
            <table>
              <tbody>
                {myTasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{t.account && <Link href={`/accounts/${t.account.id}`}>{t.account.name}</Link>}</td>
                    <td>
                      {formatDate(t.dueDate)}{" "}
                      {t.dueDate && t.dueDate < now && <span className="badge overdue">overdue</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Recent activity</h2>
          <ul className="timeline">
            {recent.map((a) => (
              <li key={a.id}>
                <span className="badge">{a.type}</span> {a.subject}
                <div className="muted small">
                  {a.user.name} · {formatDate(a.occurredAt)}
                  {a.account && (
                    <>
                      {" · "}
                      <Link href={`/accounts/${a.account.id}`}>{a.account.name}</Link>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
