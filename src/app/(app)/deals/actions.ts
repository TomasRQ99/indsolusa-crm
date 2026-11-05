"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { optionalDate, optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";

const stage = z.enum(["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]);
const money = z.coerce.number().min(0).max(1e12);

const dealSchema = z.object({
  title: requiredText,
  amount: money,
  stage: stage.default("LEAD"),
  closeDate: optionalDate,
  accountId: z.string().min(1, "Pick an account"),
  contactId: optionalId,
  desiredResult: optionalText,
});

async function editableDeal(id: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { ownerId: true, code: true, poAcceptedAt: true } });
  assertCanEdit(user, deal.ownerId);
  return { user, deal };
}

export async function createDeal(formData: FormData) {
  const user = await requireUser();
  const data = parseForm(dealSchema, formData);
  const created = await db.$transaction(async (tx) => {
    const code = await nextCode("J", "deal", tx);
    return tx.deal.create({ data: { ...data, code, ownerId: user.id } });
  });
  refreshApp();
  if (formData.get("open") === "1") redirect(`/deals/${created.id}`);
}

export async function moveDealStage(id: string, formData: FormData) {
  const { deal } = await editableDeal(id);
  const { stage: next } = parseForm(z.object({ stage }), formData);
  await db.deal.update({
    where: { id },
    data: { stage: next, ...(next === "WON" && !deal.poAcceptedAt ? { poAcceptedAt: today() } : {}) },
  });
  refreshApp();
}

export async function deleteDeal(id: string) {
  await editableDeal(id);
  await db.deal.delete({ where: { id } });
  refreshApp();
  redirect("/deals");
}

const journeySchema = z.object({
  title: requiredText,
  amount: money,
  desiredResult: optionalText,
  promisedDate: optionalDate,
  promiseText: optionalText,
  supplierCost: money,
  freightCost: money,
  otherCosts: money,
  closeDate: optionalDate,
});

export async function updateJourney(id: string, formData: FormData) {
  await editableDeal(id);
  const data = parseForm(journeySchema, formData);
  await db.deal.update({ where: { id }, data });
  refreshApp();
}

export async function acceptCustomerPo(id: string, formData: FormData) {
  const { deal } = await editableDeal(id);
  const { customerPo, poAcceptedAt } = parseForm(
    z.object({ customerPo: requiredText, poAcceptedAt: optionalDate }),
    formData,
  );
  await db.$transaction(async (tx) => {
    const code = deal.code ?? (await nextCode("J", "deal", tx));
    await tx.deal.update({
      where: { id },
      data: { customerPo, poAcceptedAt: poAcceptedAt ?? today(), stage: "WON", code },
    });
  });
  refreshApp();
}

export async function setNextMove(id: string, formData: FormData) {
  await editableDeal(id);
  const data = parseForm(z.object({ nextMove: optionalText, nextMoveDate: optionalDate }), formData);
  await db.deal.update({ where: { id }, data: { ...data, waitingFor: null, waitingUntil: null } });
  refreshApp();
}

export async function setWaiting(id: string, formData: FormData) {
  await editableDeal(id);
  const data = parseForm(z.object({ waitingFor: requiredText, waitingUntil: optionalDate }), formData);
  await db.deal.update({ where: { id }, data: { ...data, nextMove: null, nextMoveDate: null } });
  refreshApp();
}

export async function completeNextMove(id: string) {
  await editableDeal(id);
  const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { nextMove: true, accountId: true } });
  const user = await requireUser();
  if (deal.nextMove) {
    await db.activity.create({
      data: { type: "NOTE", subject: deal.nextMove, body: "✓", userId: user.id, accountId: deal.accountId, dealId: id },
    });
  }
  await db.deal.update({ where: { id }, data: { nextMove: null, nextMoveDate: null } });
  refreshApp();
}

export async function markResultAchieved(id: string) {
  await editableDeal(id);
  await db.deal.update({ where: { id }, data: { resultAchievedAt: new Date() } });
  refreshApp();
}

export async function addItem(dealId: string, formData: FormData) {
  await editableDeal(dealId);
  const data = parseForm(
    z.object({
      qty: z.coerce.number().int().min(1).max(1e6),
      code: optionalText,
      description: requiredText,
      unitPrice: money,
    }),
    formData,
  );
  await db.dealItem.create({ data: { ...data, dealId } });
  refreshApp();
}

export async function removeItem(dealId: string, itemId: string) {
  await editableDeal(dealId);
  await db.dealItem.delete({ where: { id: itemId, dealId } });
  refreshApp();
}
