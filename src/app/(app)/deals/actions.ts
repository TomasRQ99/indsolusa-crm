"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { optionalDate, optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";
import { CAUSE_KEYS } from "@/lib/causes";

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
  offerValidUntil: optionalDate,
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
  if (formData.has("tab")) jback(id, formData, "siguiente");
  refreshApp();
}

export async function setWaiting(id: string, formData: FormData) {
  await editableDeal(id);
  const data = parseForm(z.object({ waitingFor: requiredText, waitingUntil: optionalDate }), formData);
  await db.deal.update({ where: { id }, data: { ...data, nextMove: null, nextMoveDate: null } });
  if (formData.has("tab")) jback(id, formData, "espera");
  refreshApp();
}

export async function completeNextMove(id: string, formData?: FormData) {
  await editableDeal(id);
  const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { nextMove: true, accountId: true } });
  const user = await requireUser();
  if (deal.nextMove) {
    await db.activity.create({
      data: { type: "NOTE", subject: deal.nextMove, body: "✓", userId: user.id, accountId: deal.accountId, dealId: id },
    });
  }
  await db.deal.update({ where: { id }, data: { nextMove: null, nextMoveDate: null } });
  if (formData?.has("tab")) jback(id, formData, "hecho");
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

// ---------- Journey Workspace: feed information into each phase ----------

const TABS = ["resumen", "need", "source", "quote", "execute", "finance", "file", "result"] as const;
const PHASES = ["need", "source", "quote", "execute", "finance", "file", "result", "promise"] as const;
const fmtDay = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d) : "—");
const dayOf = (s: FormDataEntryValue | null) => (s && String(s) ? new Date(`${String(s)}T00:00:00Z`) : null);
const txt = (fd: FormData, k: string, max = 2000) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const num = (fd: FormData, k: string) => {
  const raw = String(fd.get(k) ?? "").trim();
  if (!raw) return undefined;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
};

/** Back to the same tab of the Journey with a short confirmation code. */
function jback(id: string, fd: FormData, ok: string): never {
  const tab = String(fd.get("tab") ?? "");
  const t = (TABS as readonly string[]).includes(tab) && tab !== "resumen" ? `tab=${tab}&` : "";
  refreshApp();
  redirect(`/deals/${id}?${t}ok=${ok}`);
}

async function logFact(userId: string, dealId: string, accountId: string, phase: string, subject: string, source: string | null) {
  await db.activity.create({ data: { type: "NOTE", subject: subject.slice(0, 200), userId, accountId, dealId, phase, source } });
}

/** Need: what the customer wants to achieve, specs, by when, how it will be measured, cost of not solving it. */
export async function saveNeed(id: string, fd: FormData) {
  await editableDeal(id);
  await db.deal.update({
    where: { id },
    data: {
      desiredResult: txt(fd, "desiredResult"),
      needSpecs: txt(fd, "needSpecs"),
      neededBy: dayOf(fd.get("neededBy")),
      successMeasure: txt(fd, "successMeasure", 500),
      impactIfNot: txt(fd, "impactIfNot", 500),
    },
  });
  jback(id, fd, "need");
}

/** Customer promise. A change is kept as a fact so "What changed?" shows it. */
export async function savePromise(id: string, fd: FormData) {
  const { user } = await editableDeal(id);
  const before = await db.deal.findUniqueOrThrow({ where: { id }, select: { promiseText: true, promisedDate: true, originalPromisedDate: true, accountId: true } });
  const promiseText = txt(fd, "promiseText", 300);
  const promisedDate = dayOf(fd.get("promisedDate"));
  const was = fmtDay(before.promisedDate);
  const now = fmtDay(promisedDate);
  // The first promise stays as the original; every later date change is a revision with its cause.
  const revised = !!before.promisedDate && !!promisedDate && was !== now;
  const cause = String(fd.get("changeCause") ?? "");
  await db.deal.update({
    where: { id },
    data: {
      promiseText, promisedDate,
      ...(!before.originalPromisedDate && (before.promisedDate || promisedDate) ? { originalPromisedDate: before.promisedDate ?? promisedDate } : {}),
      ...(revised ? { promiseRevisions: { increment: 1 }, promiseRevisedAt: today(), promiseChangeCause: CAUSE_KEYS.includes(cause) ? cause : null } : {}),
    },
  });
  if (was !== now || (before.promiseText ?? "") !== (promiseText ?? "")) {
    await logFact(user.id, id, before.accountId, "promise", `Promesa al cliente: ${was} → ${now}${promiseText ? ` · ${promiseText}` : ""}`, txt(fd, "source", 200) ?? "Cambio registrado en el Journey");
  }
  jback(id, fd, "promise");
}

/** Source: how we will get it (candidates, brand, origin) and the cost structure. */
export async function saveSourcing(id: string, fd: FormData) {
  await editableDeal(id);
  await db.deal.update({
    where: { id },
    data: {
      sourcingNote: txt(fd, "sourcingNote"),
      ...(num(fd, "supplierCost") !== undefined ? { supplierCost: num(fd, "supplierCost") } : {}),
      ...(num(fd, "freightCost") !== undefined ? { freightCost: num(fd, "freightCost") } : {}),
      ...(num(fd, "otherCosts") !== undefined ? { otherCosts: num(fd, "otherCosts") } : {}),
    },
  });
  jback(id, fd, "source");
}

/** Quote: sale value and commercial terms. */
export async function saveQuote(id: string, fd: FormData) {
  await editableDeal(id);
  await db.deal.update({
    where: { id },
    data: {
      ...(num(fd, "amount") !== undefined ? { amount: num(fd, "amount") } : {}),
      incoterm: txt(fd, "incoterm", 60),
      paymentTerms: txt(fd, "paymentTerms", 200),
      offerValidUntil: dayOf(fd.get("offerValidUntil")),
      closeDate: dayOf(fd.get("closeDate")),
    },
  });
  jback(id, fd, "quote");
}

export async function markQuoteSent(id: string, fd: FormData) {
  const { user } = await editableDeal(id);
  const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { accountId: true, stage: true } });
  const sentOn = dayOf(fd.get("sentOn")) ?? today();
  await db.deal.update({
    where: { id },
    data: { quoteSentAt: sentOn, ...(deal.stage === "LEAD" || deal.stage === "QUALIFIED" ? { stage: "PROPOSAL" as const } : {}) },
  });
  await logFact(user.id, id, deal.accountId, "quote", "Cotización enviada al cliente", txt(fd, "source", 200) ?? "Correo al cliente");
  jback(id, fd, "quote-sent");
}

/** Carrier ETA: the carrier's own date, kept apart from SOLU's estimate and the customer promise. */
export async function setCarrierEta(poId: string, fd: FormData) {
  const user = await requireUser();
  const po = await db.supplierPO.findUniqueOrThrow({ where: { id: poId }, include: { deal: { select: { id: true, ownerId: true, accountId: true } } } });
  assertCanEdit(user, po.deal.ownerId);
  const carrierEta = dayOf(fd.get("carrierEta"));
  const source = txt(fd, "carrierEtaSource", 200);
  await db.supplierPO.update({
    where: { id: poId },
    data: {
      carrierName: txt(fd, "carrierName", 120) ?? po.carrierName,
      tracking: txt(fd, "tracking", 120) ?? po.tracking,
      carrierEta,
      carrierEtaAt: new Date(),
      carrierEtaSource: source,
      ...(po.shippedAt || !carrierEta ? {} : { shippedAt: today() }),
    },
  });
  await logFact(user.id, po.deal.id, po.deal.accountId, "execute", `ETA del transportista para ${po.code}: ${carrierEta ? fmtDay(carrierEta) : "sin fecha"}`, source ?? txt(fd, "carrierName", 120));
  jback(po.deal.id, fd, "eta");
}

/** Confirm a fact that was registered as uncertain. */
export async function confirmFact(activityId: string, fd: FormData) {
  const user = await requireUser();
  const a = await db.activity.findUniqueOrThrow({ where: { id: activityId }, include: { deal: { select: { id: true, ownerId: true } } } });
  if (!a.deal) throw new Error("Not a Journey fact");
  assertCanEdit(user, a.deal.ownerId);
  await db.activity.update({ where: { id: activityId }, data: { uncertain: false, source: txt(fd, "source", 200) ?? a.source } });
  jback(a.deal.id, fd, "confirmed");
}

/** Result: what the customer actually achieved, in their words. */
export async function saveResult(id: string, fd: FormData) {
  const { user } = await editableDeal(id);
  const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { accountId: true, resultAchievedAt: true } });
  const achieved = fd.get("achieved") === "1";
  const resultNote = txt(fd, "resultNote");
  await db.deal.update({
    where: { id },
    data: { resultNote, resultAchievedAt: achieved ? deal.resultAchievedAt ?? new Date() : null },
  });
  if (achieved && !deal.resultAchievedAt) await logFact(user.id, id, deal.accountId, "result", "El cliente confirmó que logró su resultado", txt(fd, "source", 200));
  jback(id, fd, "result");
}

/** Business File: administrative data that should not be protagonist elsewhere. */
export async function saveFile(id: string, fd: FormData) {
  await editableDeal(id);
  const title = txt(fd, "title", 200);
  const contactId = String(fd.get("contactId") ?? "");
  await db.deal.update({
    where: { id },
    data: { ...(title ? { title } : {}), contactId: contactId || null, customerPo: txt(fd, "customerPo", 80), poAcceptedAt: dayOf(fd.get("poAcceptedAt")) },
  });
  jback(id, fd, "file");
}

/** Record seen time for "what changed since my last visit". A new visit starts after 2 hours away. */
export async function markJourneySeen(id: string) {
  const user = await requireUser();
  const now = new Date();
  await db.journeyView.upsert({
    where: { userId_dealId: { userId: user.id, dealId: id } },
    create: { userId: user.id, dealId: id, seenAt: now, prevSeenAt: now },
    update: { prevSeenAt: now, seenAt: now },
  });
  refreshApp();
  redirect(`/deals/${id}?ok=seen`);
}
