import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { createTask, deleteTask, toggleTask } from "./actions";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: "all"; done?: string }>;
}) {
  const user = await requireUser();
  const { view, done } = await searchParams;
  const showAll = view === "all" && canManageAll(user);
  const now = new Date();

  const where: Prisma.TaskWhereInput = {
    ...(showAll ? {} : { assigneeId: user.id }),
    ...(done ? {} : { status: "OPEN" }),
  };

  const [tasks, users] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
      take: 300,
      include: {
        assignee: { select: { name: true } },
        account: { select: { id: true, name: true } },
        deal: { select: { title: true } },
      },
    }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <div className="spread">
        <h1>Tasks</h1>
        <div className="row small">
          <Link href="/tasks">My open</Link> · <Link href="/tasks?done=1">Mine incl. done</Link>
          {canManageAll(user) && <> · <Link href="/tasks?view=all">Team</Link></>}
        </div>
      </div>

      <div className="card">
        <h2>New task</h2>
        <form action={createTask} className="inline">
          <label>Task<input name="title" required /></label>
          <label>Due<input name="dueDate" type="date" /></label>
          <label>
            Assignee
            <select name="assigneeId" defaultValue={user.id}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <button type="submit">Add</button>
        </form>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr><th></th><th>Task</th><th>Related to</th><th>Assignee</th><th>Due</th><th></th></tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const editable = canEdit(user, t.assigneeId);
              const overdue = t.status === "OPEN" && t.dueDate && t.dueDate < now;
              return (
                <tr key={t.id}>
                  <td>
                    {editable && (
                      <form action={toggleTask.bind(null, t.id)}>
                        <button className="secondary small" type="submit" aria-label="Toggle done">
                          {t.status === "DONE" ? "↺" : "✓"}
                        </button>
                      </form>
                    )}
                  </td>
                  <td className={t.status === "DONE" ? "done" : undefined}>{t.title}</td>
                  <td>
                    {t.account && <Link href={`/accounts/${t.account.id}`}>{t.account.name}</Link>}
                    {t.deal && <div className="muted small">{t.deal.title}</div>}
                  </td>
                  <td>{t.assignee.name}</td>
                  <td>
                    {formatDate(t.dueDate)} {overdue && <span className="badge overdue">overdue</span>}
                  </td>
                  <td>
                    {editable && (
                      <form action={deleteTask.bind(null, t.id)}>
                        <button className="link small" type="submit">Delete</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {tasks.length === 0 && <tr><td colSpan={6} className="muted">No tasks.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
