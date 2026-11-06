import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { createTask, deleteTask, toggleTask } from "./actions";
import { setEstimate } from "../mi-plan/actions";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: "all"; done?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { view, done } = await searchParams;
  const showAll = view === "all" && canManageAll(user);
  const now = today();

  const where: Prisma.TaskWhereInput = { ...(showAll ? {} : { assigneeId: user.id }), ...(done ? {} : { status: "OPEN" }) };
  const [tasks, users] = await Promise.all([
    db.task.findMany({
      where,
      orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
      take: 300,
      include: { assignee: { select: { name: true } }, account: { select: { id: true, name: true } }, deal: { select: { id: true, code: true, title: true } } },
    }),
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mi día", "My day")}</div>
          <h1>{t("Pendientes", "To-dos")}</h1>
          <p>{t("La duración estimada ayuda a Mi Plan a saber cuánto cabe en tu semana.", "The estimated duration helps My Plan know how much fits in your week.")}</p>
        </div>
        <div className="grow" />
        <div className="row small">
          <Link href="/tasks">{t("Míos abiertos", "My open")}</Link> · <Link href="/tasks?done=1">{t("Incluir hechos", "Include done")}</Link>
          {canManageAll(user) && <> · <Link href="/tasks?view=all">{t("Equipo", "Team")}</Link></>}
        </div>
      </div>
      <div className="card">
        <form action={createTask} className="inline">
          <label style={{ flex: 1, minWidth: 220 }}>{t("Pendiente", "To-do")}<input name="title" required /></label>
          <label>{t("Para el", "Due")}<input name="dueDate" type="date" /></label>
          <label>{t("Duración (min)", "Duration (min)")}<input name="estimateMinutes" type="number" min="5" max="600" step="5" placeholder="30" style={{ width: 90 }} /></label>
          <label>{t("Responsable", "Assignee")}
            <select name="assigneeId" defaultValue={user.id}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </label>
          <button type="submit">{t("Agregar", "Add")}</button>
        </form>
      </div>
      <div className="card flush">
        <table>
          <thead><tr><th /><th>{t("Pendiente", "To-do")}</th><th>{t("Relacionado", "Related to")}</th><th>{t("Responsable", "Assignee")}</th><th>{t("Para el", "Due")}</th><th>{t("Duración", "Duration")}</th><th /></tr></thead>
          <tbody>
            {tasks.map((tk) => {
              const editable = canEdit(user, tk.assigneeId);
              const overdue = tk.status === "OPEN" && tk.dueDate && tk.dueDate < now;
              return (
                <tr key={tk.id}>
                  <td>{editable && <form action={toggleTask.bind(null, tk.id)}><button className="secondary sm" type="submit" aria-label={t("Marcar hecho", "Toggle done")}>{tk.status === "DONE" ? "↺" : "✓"}</button></form>}</td>
                  <td className={tk.status === "DONE" ? "done" : undefined}>{tk.title}{tk.plannedFor && <span className="src">{t("En Mi Plan", "In My Plan")} · {i.dateShort(tk.plannedFor)}</span>}</td>
                  <td>{tk.deal && <Link href={`/deals/${tk.deal.id}`} className="mono small">{tk.deal.code}</Link>}{tk.account && <span className="src"><Link href={`/accounts/${tk.account.id}`}>{tk.account.name}</Link></span>}</td>
                  <td>{tk.assignee.name}</td>
                  <td>{i.dateShort(tk.dueDate)} {overdue && <span className="sig attn">{t("se pasó", "past due")}</span>}</td>
                  <td>
                    {editable && tk.status === "OPEN" ? (
                      <form action={setEstimate.bind(null, tk.id)} className="row" style={{ gap: 4 }}>
                        <input name="minutes" type="number" min="5" max="600" step="5" defaultValue={tk.estimateMinutes ?? 30} style={{ width: 70 }} aria-label={t("Minutos", "Minutes")} />
                        <button className="secondary sm" type="submit">✓</button>
                      </form>
                    ) : <span className="val">{tk.estimateMinutes ?? 30}</span>}
                  </td>
                  <td>{editable && <form action={deleteTask.bind(null, tk.id)} data-confirm={t("¿Eliminar esta tarea? No se puede deshacer.", "Delete this task? This can't be undone.")}><button className="link small" type="submit">{t("Eliminar", "Delete")}</button></form>}</td>
                </tr>
              );
            })}
            {tasks.length === 0 && <tr><td colSpan={7} className="empty"><b>{t("Nada pendiente", "Nothing pending")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
