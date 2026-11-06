import { headers } from "next/headers";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { addDays, today } from "./domain";
import { bogotaTime, createEvent, findFreeSlot, listEvents, OutlookError } from "./outlook";
import { calendarEvent, calendarTaskInclude, eventHtml } from "./calendar-event";
import { makeI18n } from "./i18n";

/** Standard title + HTML body (C1) for one of the person's tasks. */
export async function taskEventContent(user: SessionUser, taskId: string) {
  const tk = await db.task.findFirstOrThrow({ where: { id: taskId, assigneeId: user.id }, include: calendarTaskInclude });
  const { t } = makeI18n(user.lang);
  const ev = calendarEvent(tk, t, await appBaseUrl());
  return { subject: ev.title, html: eventHtml(ev, t), link: ev.link };
}

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
    include: calendarTaskInclude,
    orderBy: [{ plannedFor: "asc" }, { dueDate: "asc" }],
  });
  if (!tasks.length) return [];
  const base = await appBaseUrl();
  const { t } = makeI18n(user.lang);
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
    const content = calendarEvent(tk, t, base);
    const ev = await createEvent(user.email, {
      subject: content.title,
      start: slot,
      minutes,
      body: "Bloque reservado desde SOLU.",
      html: eventHtml(content, t),
      link: content.link,
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
