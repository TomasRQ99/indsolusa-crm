import { headers } from "next/headers";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { addDays, today } from "./domain";
import { bogotaTime, createEvent, findFreeSlot, listEvents, OutlookError } from "./outlook";

export async function appBaseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const isWorkday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/**
 * Put open tasks into the person's Outlook calendar, each in the first free gap of its
 * planned day (or today onward). Tasks already in Outlook are skipped. Returns what was placed.
 */
export async function placeTasksInOutlook(user: SessionUser, taskIds: string[]) {
  if (!user.outlookConnectedAt) throw new OutlookError("NOT_CONFIGURED", "Outlook is not connected for this person.");
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds }, assigneeId: user.id, status: "OPEN", outlookEventId: null },
    include: { deal: { select: { id: true, code: true } } },
    orderBy: [{ plannedFor: "asc" }, { dueDate: "asc" }],
  });
  if (!tasks.length) return [];
  const base = await appBaseUrl();
  const start = today();
  const events = await listEvents(user.email, bogotaTime(start, 0), bogotaTime(addDays(start, 14), 0));
  const reserved: { start: Date; end: Date }[] = [];
  const placed: { taskId: string; start: Date }[] = [];

  for (const tk of tasks) {
    const minutes = tk.estimateMinutes ?? 30;
    let day = tk.plannedFor && tk.plannedFor >= start ? tk.plannedFor : start;
    let slot: Date | null = null;
    for (let k = 0; k < 10 && !slot; k++) {
      if (isWorkday(day)) slot = findFreeSlot(events, day, minutes, user.workdayMinutes, reserved);
      if (!slot) day = addDays(day, 1);
    }
    if (!slot) continue;
    const ev = await createEvent(user.email, {
      subject: `SOLU · ${tk.deal?.code ? `${tk.deal.code} · ` : ""}${tk.title}`,
      start: slot,
      minutes,
      body: "Bloque reservado desde SOLU.",
      link: tk.deal ? `${base}/deals/${tk.deal.id}` : `${base}/mi-plan`,
      transactionId: `solu-task-${tk.id}`,
    });
    reserved.push({ start: ev.start, end: ev.end });
    await db.task.update({ where: { id: tk.id }, data: { outlookEventId: ev.id, scheduledAt: ev.start, plannedFor: day } });
    placed.push({ taskId: tk.id, start: ev.start });
  }
  return placed;
}

export function outlookErrorCode(e: unknown) {
  return e instanceof OutlookError ? e.code : "OTHER";
}
