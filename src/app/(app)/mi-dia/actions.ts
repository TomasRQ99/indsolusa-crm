"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { addDays, today } from "@/lib/domain";
import { refreshApp } from "@/lib/revalidate";
import { bogotaInput, createEvent, deleteEvent, hhmm, moveEvent } from "@/lib/outlook";
import { appBaseUrl, outlookErrorCode, placeTasksInOutlook } from "@/lib/outlook-sync";

// Everything a negotiator needs to act from Mi Día without leaving it:
// done → what's next, postpone, schedule (first free slot or a chosen time), wait,
// log what happened, and manage today's calendar blocks.

const back = (msg: string, extra = "") => redirect(`/mi-dia?ok=${encodeURIComponent(msg)}${extra}`);
const loc = (u: SessionUser) => (u.lang === "ES" ? "es-CO" : "en-US");
const day = (s: FormDataEntryValue | null) => (s && String(s) ? new Date(`${String(s)}T00:00:00Z`) : null);

async function editable(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId } });
  assertCanEdit(user, deal.ownerId);
  return { user, deal };
}

/** "Agendar en Outlook": the next move goes into the first free 30-minute gap. */
export async function scheduleMove(dealId: string, title: string) {
  const { user, deal } = await editable(dealId);
  if (!user.outlookConnectedAt) redirect("/profile?cal=connect");
  let task = await db.task.findFirst({ where: { dealId, assigneeId: user.id, status: "OPEN", title } });
  task ??= await db.task.create({
    data: { title, dealId, accountId: deal.accountId, assigneeId: user.id, dueDate: deal.nextMoveDate ?? today(), estimateMinutes: 30, plannedFor: today() },
  });
  if (task.outlookEventId && task.scheduledAt) back("agendado", `&t=${encodeURIComponent(hhmm(task.scheduledAt, loc(user)))}`);

  let target = "/mi-dia";
  try {
    const placed = await placeTasksInOutlook(user, [task.id]);
    target = placed.length ? `/mi-dia?ok=agendado&t=${encodeURIComponent(hhmm(placed[0].start, loc(user)))}` : "/mi-dia?cal=FULL";
  } catch (e) {
    target = `/mi-dia?cal=${outlookErrorCode(e)}`;
  }
  refreshApp();
  redirect(target);
}

/** Reserve time at a chosen date/hour (with or without a Journey). Goes to Outlook when connected. */
export async function reserveTime(formData: FormData) {
  const user = await requireUser();
  const f = z
    .object({
      title: z.string().trim().min(1).max(200),
      date: z.string().min(10),
      time: z.string().min(4),
      minutes: z.coerce.number().int().min(5).max(480),
      dealId: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  let accountId: string | null = null;
  let dealId: string | null = null;
  let dealCode: string | null = null;
  if (f.dealId) {
    const { deal } = await editable(f.dealId);
    dealId = deal.id;
    accountId = deal.accountId;
    dealCode = deal.code;
  }
  const start = bogotaInput(f.date, f.time);
  const planned = new Date(`${f.date}T00:00:00Z`);
  const task = await db.task.create({
    data: { title: f.title, dealId, accountId, assigneeId: user.id, dueDate: planned, plannedFor: planned, estimateMinutes: f.minutes, scheduledAt: start },
  });
  let extra = "";
  if (user.outlookConnectedAt) {
    try {
      const base = await appBaseUrl();
      const ev = await createEvent(user.email, {
        subject: `SOLU · ${dealCode ? `${dealCode} · ` : ""}${f.title}`,
        start,
        minutes: f.minutes,
        body: "Bloque reservado desde Mi Día.",
        link: dealId ? `${base}/deals/${dealId}` : `${base}/mi-dia`,
        transactionId: `solu-task-${task.id}`,
      });
      await db.task.update({ where: { id: task.id }, data: { outlookEventId: ev.id } });
    } catch (e) {
      extra = `&cal=${outlookErrorCode(e)}`;
    }
  }
  refreshApp();
  back("reservado", `&t=${encodeURIComponent(hhmm(start, loc(user)))}${extra}`);
}

/** Schedule a Journey move at a chosen time (instead of the first free slot). */
export async function scheduleMoveAt(dealId: string, title: string, formData: FormData) {
  const fd = new FormData();
  fd.set("title", title);
  fd.set("dealId", dealId);
  for (const k of ["date", "time", "minutes"]) fd.set(k, String(formData.get(k) ?? ""));
  // Replace an earlier open block for the same move so it isn't duplicated.
  const user = await requireUser();
  const old = await db.task.findMany({ where: { dealId, assigneeId: user.id, status: "OPEN", title } });
  for (const tk of old) {
    if (tk.outlookEventId && user.outlookConnectedAt) await deleteEvent(user.email, tk.outlookEventId).catch(() => {});
    await db.task.delete({ where: { id: tk.id } });
  }
  return reserveTime(fd);
}

/** Done → what's next: logs the finished move and sets the next move or a controlled wait in one step. */
export async function doneAndNext(dealId: string, formData: FormData) {
  const { user, deal } = await editable(dealId);
  const note = String(formData.get("note") ?? "").trim();
  const nextMove = String(formData.get("nextMove") ?? "").trim();
  const waitingFor = String(formData.get("waitingFor") ?? "").trim();
  const nextDate = day(formData.get("nextDate"));
  const finished = deal.nextMove ?? (deal.waitingFor ? `Llegó: ${deal.waitingFor}` : "Movimiento hecho");
  await db.activity.create({ data: { type: "NOTE", subject: `✓ ${finished}`, body: note || null, userId: user.id, accountId: deal.accountId, dealId } });
  await db.task.updateMany({ where: { dealId, assigneeId: user.id, status: "OPEN", title: finished }, data: { status: "DONE", completedAt: new Date() } });
  if (waitingFor) {
    await db.deal.update({ where: { id: dealId }, data: { waitingFor, waitingUntil: nextDate ?? addDays(today(), 3), nextMove: null, nextMoveDate: null } });
  } else {
    await db.deal.update({ where: { id: dealId }, data: { nextMove: nextMove || null, nextMoveDate: nextMove ? nextDate ?? today() : null, waitingFor: null, waitingUntil: null } });
  }
  refreshApp();
  back(waitingFor ? "espera" : nextMove ? "siguiente" : "hecho");
}

/** Define what's next on a Journey that has nothing defined (no "done" logged). */
export async function defineNext(dealId: string, formData: FormData) {
  await editable(dealId);
  const nextMove = String(formData.get("nextMove") ?? "").trim();
  const waitingFor = String(formData.get("waitingFor") ?? "").trim();
  const date = day(formData.get("nextDate"));
  if (waitingFor) await db.deal.update({ where: { id: dealId }, data: { waitingFor, waitingUntil: date ?? addDays(today(), 3), nextMove: null, nextMoveDate: null } });
  else if (nextMove) await db.deal.update({ where: { id: dealId }, data: { nextMove, nextMoveDate: date ?? today(), waitingFor: null, waitingUntil: null } });
  else back("sin-dato");
  refreshApp();
  back(waitingFor ? "espera" : "siguiente");
}

/** Postpone the move (or the wait) to another day. */
export async function postpone(dealId: string, formData: FormData) {
  const { deal } = await editable(dealId);
  const days = Number(formData.get("days") || 0);
  const to = days > 0 ? addDays(today(), days) : day(formData.get("date"));
  if (!to) back("sin-fecha");
  if (deal.waitingFor) await db.deal.update({ where: { id: dealId }, data: { waitingUntil: to } });
  else await db.deal.update({ where: { id: dealId }, data: { nextMoveDate: to } });
  refreshApp();
  back("pospuesto", `&d=${to!.toISOString().slice(0, 10)}`);
}

/** Log what happened (call, email, meeting, note) without leaving Mi Día. */
export async function logHappened(dealId: string, formData: FormData) {
  const { user, deal } = await editable(dealId);
  const type = z.enum(["CALL", "MEETING", "EMAIL", "NOTE"]).parse(formData.get("type") ?? "NOTE");
  const subject = z.string().trim().min(1).max(200).parse(formData.get("subject"));
  await db.activity.create({ data: { type, subject, userId: user.id, accountId: deal.accountId, contactId: deal.contactId, dealId } });
  refreshApp();
  back("registrado");
}

/** New payment promise straight from the card. */
export async function newPromise(invoiceId: string, formData: FormData) {
  const user = await requireUser();
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { deal: { select: { ownerId: true } } } });
  if (inv.deal) assertCanEdit(user, inv.deal.ownerId);
  const f = z.object({ promisedFor: z.string().min(10), promisedBy: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(500) }).parse(Object.fromEntries(formData));
  await db.paymentPromise.create({ data: { invoiceId, promisedFor: new Date(`${f.promisedFor}T00:00:00Z`), promisedBy: f.promisedBy, source: f.source, recordedById: user.id } });
  refreshApp();
  back("promesa");
}

// ---------- Calendar blocks ----------

async function ownTask(taskId: string) {
  const user = await requireUser();
  const task = await db.task.findFirstOrThrow({ where: { id: taskId, assigneeId: user.id } });
  return { user, task };
}

export async function moveBlock(taskId: string, formData: FormData) {
  const { user, task } = await ownTask(taskId);
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const start = bogotaInput(date, time);
  const minutes = Number(formData.get("minutes") || task.estimateMinutes || 30);
  let extra = "";
  if (task.outlookEventId && user.outlookConnectedAt) {
    try {
      await moveEvent(user.email, task.outlookEventId, start, minutes);
    } catch (e) {
      extra = `&cal=${outlookErrorCode(e)}`;
    }
  }
  await db.task.update({ where: { id: taskId }, data: { scheduledAt: start, plannedFor: new Date(`${date}T00:00:00Z`), estimateMinutes: minutes } });
  refreshApp();
  back("movido", `&t=${encodeURIComponent(hhmm(start, loc(user)))}${extra}`);
}

export async function removeBlock(taskId: string) {
  const { user, task } = await ownTask(taskId);
  if (task.outlookEventId && user.outlookConnectedAt) await deleteEvent(user.email, task.outlookEventId).catch(() => {});
  await db.task.update({ where: { id: taskId }, data: { scheduledAt: null, outlookEventId: null, plannedFor: null } });
  refreshApp();
  back("quitado");
}

export async function blockDone(taskId: string) {
  const { task } = await ownTask(taskId);
  await db.task.update({ where: { id: taskId }, data: { status: "DONE", completedAt: new Date() } });
  refreshApp();
  // A block that was a Journey's next move: ask what's next on that card.
  back("bloque-hecho", task.dealId ? `&j=${task.dealId}` : "");
}
