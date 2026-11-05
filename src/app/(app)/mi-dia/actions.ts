"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { today } from "@/lib/domain";
import { refreshApp } from "@/lib/revalidate";
import { hhmm } from "@/lib/outlook";
import { outlookErrorCode, placeTasksInOutlook } from "@/lib/outlook-sync";

/** "Agendar en Outlook": turn a Journey's next move into a 30-minute block in the first free gap. */
export async function scheduleMove(dealId: string, title: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true, accountId: true, nextMoveDate: true } });
  assertCanEdit(user, deal.ownerId);
  if (!user.outlookConnectedAt) redirect("/profile?cal=connect");

  let task = await db.task.findFirst({ where: { dealId, assigneeId: user.id, status: "OPEN", title } });
  task ??= await db.task.create({
    data: { title, dealId, accountId: deal.accountId, assigneeId: user.id, dueDate: deal.nextMoveDate ?? today(), estimateMinutes: 30, plannedFor: today() },
  });

  const loc = user.lang === "ES" ? "es-CO" : "en-US";
  if (task.outlookEventId && task.scheduledAt) redirect(`/mi-dia?agendado=${encodeURIComponent(hhmm(task.scheduledAt, loc))}`);

  let target = "/mi-dia";
  try {
    const placed = await placeTasksInOutlook(user, [task.id]);
    target = placed.length ? `/mi-dia?agendado=${encodeURIComponent(hhmm(placed[0].start, loc))}` : "/mi-dia?cal=FULL";
  } catch (e) {
    target = `/mi-dia?cal=${outlookErrorCode(e)}`;
  }
  refreshApp();
  redirect(target);
}
