"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { optionalDate, optionalId, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";

const taskSchema = z.object({
  title: requiredText,
  dueDate: optionalDate,
  assigneeId: optionalId,
  accountId: optionalId,
  contactId: optionalId,
  dealId: optionalId,
  estimateMinutes: z.coerce.number().int().min(5).max(600).optional().or(z.literal("").transform(() => undefined)),
});

export async function createTask(formData: FormData) {
  const user = await requireUser();
  const { assigneeId, ...data } = parseForm(taskSchema, formData);
  await db.task.create({ data: { ...data, assigneeId: assigneeId ?? user.id } });
  refreshApp();
}

export async function toggleTask(id: string) {
  const user = await requireUser();
  const task = await db.task.findUniqueOrThrow({ where: { id }, select: { assigneeId: true, status: true } });
  assertCanEdit(user, task.assigneeId);
  const done = task.status === "OPEN";
  await db.task.update({
    where: { id },
    data: { status: done ? "DONE" : "OPEN", completedAt: done ? new Date() : null },
  });
  refreshApp();
}

export async function deleteTask(id: string) {
  const user = await requireUser();
  const task = await db.task.findUniqueOrThrow({ where: { id }, select: { assigneeId: true } });
  assertCanEdit(user, task.assigneeId);
  await db.task.delete({ where: { id } });
  refreshApp();
}
