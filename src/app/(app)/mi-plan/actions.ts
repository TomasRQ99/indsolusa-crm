"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { buildPlan } from "@/lib/plan";
import { refreshApp } from "@/lib/revalidate";

/** Reserve every block in "worth reserving": the same placement the screen shows. */
export async function reservePlan() {
  const user = await requireUser();
  const plan = await buildPlan(user);
  await db.$transaction(async (tx) => {
    for (const day of plan.days) {
      for (const item of day.proposed) {
        if (item.kind === "task" && item.taskId) {
          await tx.task.update({ where: { id: item.taskId, assigneeId: user.id }, data: { plannedFor: day.date } });
        } else if (item.kind === "move" && item.dealId) {
          const deal = await tx.deal.findUniqueOrThrow({ where: { id: item.dealId }, select: { accountId: true, nextMoveDate: true } });
          await tx.task.create({
            data: {
              title: item.title,
              dealId: item.dealId,
              accountId: deal.accountId,
              dueDate: deal.nextMoveDate,
              assigneeId: user.id,
              estimateMinutes: item.minutes,
              plannedFor: day.date,
            },
          });
        }
      }
    }
  });
  refreshApp();
}

export async function unplanTask(taskId: string) {
  const user = await requireUser();
  await db.task.update({ where: { id: taskId, assigneeId: user.id }, data: { plannedFor: null } });
  refreshApp();
}

export async function setEstimate(taskId: string, formData: FormData) {
  const user = await requireUser();
  const minutes = Math.max(5, Math.min(600, Number(formData.get("minutes") || 30)));
  await db.task.update({ where: { id: taskId, assigneeId: user.id }, data: { estimateMinutes: minutes } });
  refreshApp();
}
