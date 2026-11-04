"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { optionalDate, optionalId, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";

const stage = z.enum(["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]);

const dealSchema = z.object({
  title: requiredText,
  amount: z.coerce.number().min(0).max(1e12),
  stage: stage.default("LEAD"),
  closeDate: optionalDate,
  accountId: z.string().min(1, "Pick an account"),
  contactId: optionalId,
});

export async function createDeal(formData: FormData) {
  const user = await requireUser();
  const data = parseForm(dealSchema, formData);
  await db.deal.create({ data: { ...data, ownerId: user.id } });
  refreshApp();
}

export async function moveDealStage(id: string, formData: FormData) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
  assertCanEdit(user, deal.ownerId);
  const { stage: next } = parseForm(z.object({ stage }), formData);
  await db.deal.update({ where: { id }, data: { stage: next } });
  refreshApp();
}

export async function deleteDeal(id: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
  assertCanEdit(user, deal.ownerId);
  await db.deal.delete({ where: { id } });
  refreshApp();
}
