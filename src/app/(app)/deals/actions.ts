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
import { esagaraPctOf, otherTotal, priceForEsagara, repriceLines } from "@/lib/cost-lines";
import { linesTotal, sumMoney } from "@/lib/money";
import { remindQuoteAdjust } from "@/lib/quote-reminder";
import { partKey } from "@/lib/parts";
import { addWorkingDays } from "@/lib/holidays";

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

const TABS = ["resumen", "need", "locate", "source", "quote", "execute", "finance", "file", "result"] as const;
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

/** Localizar: the exact piece is identified. It needs a product, and its part number or a photo; the note says which
 *  piece it is, and the supplier (one the company already worked with) where it will be looked for is optional. */
export async function markLocated(id: string, fd: FormData) {
  const { user } = await editableDeal(id);
  const d = await db.deal.findUniqueOrThrow({ where: { id }, select: { accountId: true, items: { select: { code: true } }, _count: { select: { files: true } } } });
  if (d.items.length === 0 || !(d.items.some((x) => !!x.code?.trim()) || d._count.files > 0)) { refreshApp(); redirect(`/deals/${id}?tab=locate&ok=sin-pieza#pieza`); }
  const supplierId = txt(fd, "supplierId", 40);
  const supplier = supplierId ? await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }) : null;
  const note = txt(fd, "locatedNote", 500);
  await db.deal.update({ where: { id }, data: { locatedAt: new Date(), locatedByName: user.name, locatedNote: note, locatedSupplierId: supplier?.id ?? null } });
  await logFact(user.id, id, d.accountId, "source", `Pieza localizada${note ? `: ${note}` : ""}${supplier ? ` · se buscará con ${supplier.name}` : ""}`, "Localizar");
  refreshApp();
  redirect(`/deals/${id}?tab=locate&ok=localizada#localizada`);
}

/** Back to "not located yet" (the piece turned out to be another one). */
export async function unmarkLocated(id: string) {
  await editableDeal(id);
  await db.deal.update({ where: { id }, data: { locatedAt: null, locatedByName: null } });
  refreshApp();
  redirect(`/deals/${id}?tab=locate&ok=sin-localizar#localizada`);
}

/** A product added from the Localizar tab: what the customer asks for, with no price yet (the quote sets it). */
export async function addLocateItem(id: string, fd: FormData) {
  await editableDeal(id);
  const description = txt(fd, "description", 300), code = txt(fd, "code", 60);
  const qty = Math.max(1, Math.round(Number(fd.get("qty") ?? 1)) || 1);
  if (description || code) await db.dealItem.create({ data: { dealId: id, qty, code, description: description ?? code!, unitPrice: 0 } });
  refreshApp();
  redirect(`/deals/${id}?tab=locate&ok=${description || code ? "pieza" : "sin-pieza"}#pieza`);
}

/** The part number of a product, typed once it is known. */
export async function setItemCode(id: string, itemId: string, fd: FormData) {
  await editableDeal(id);
  await db.dealItem.updateMany({ where: { id: itemId, dealId: id }, data: { code: txt(fd, "code", 60) } });
  refreshApp();
  redirect(`/deals/${id}?tab=locate&ok=pieza#pieza`);
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
      ...(fd.has("machine") ? { machine: txt(fd, "machine", 200) } : {}),
      ...(fd.has("internalNotes") ? { internalNotes: txt(fd, "internalNotes") } : {}),
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
    await logFact(user.id, id, before.accountId, "promise", `Promesa al cliente: ${was} → ${now}${promiseText ? ` · ${promiseText}` : ""}`, txt(fd, "source", 200) ?? "Cambio registrado en la Necesidad");
  }
  jback(id, fd, "promise");
}

/** Source: how we will get it (candidates, brand, origin) and the cost structure. */
export async function saveSourcing(id: string, fd: FormData) {
  const { user } = await editableDeal(id);
  // Cost settlement sheet (same lines as the quote): the other costs are typed one by one; otherCosts is their total.
  const parts = { tax: num(fd, "taxCost") ?? 0, customs: num(fd, "customsCost") ?? 0, packing: num(fd, "packingCost") ?? 0, wire: num(fd, "wireCost") ?? 0, misc: num(fd, "miscCost") ?? 0, credit: num(fd, "creditAmount") ?? 0 };
  const creditSrc = txt(fd, "creditSrc", 200);
  const sheet = fd.has("taxCost");
  // A credit in our favor lowers the cost: it must say where it comes from.
  if (sheet && parts.credit > 0 && !creditSrc) {
    refreshApp();
    redirect(`/deals/${id}?tab=source&err=credito-fuente`);
  }
  const days = num(fd, "transitDays");
  // The Eságara the person typed decides the price (owner, 2026-11-19): price = total cost ÷ (1 − Eságara %).
  // Same rule as the quote's sheet (cotizaciones/actions.ts saveCosts). Never once the price is with the customer.
  const cur = await db.deal.findUniqueOrThrow({ where: { id }, select: { amount: true, supplierCost: true, freightCost: true, otherCosts: true, quoteSentAt: true, stage: true, items: { orderBy: { id: "asc" }, select: { id: true, qty: true, unitPrice: true } } } });
  const newCost = sumMoney([num(fd, "supplierCost") ?? cur.supplierCost, num(fd, "freightCost") ?? cur.freightCost, sheet ? otherTotal(parts) : num(fd, "otherCosts") ?? cur.otherCosts]);
  const rawPct = String(fd.get("esagaraPct") ?? "").trim().replace(",", ".");
  const wantPct = rawPct === "" ? null : Number(rawPct);
  const target = cur.quoteSentAt || cur.stage === "WON" || cur.stage === "LOST" ? null : priceForEsagara(newCost, wantPct);
  const reprice = target != null && esagaraPctOf(cur.amount, newCost) !== Math.round(wantPct! * 100) / 100;
  const prices = reprice ? repriceLines(cur.items, target!) : [];
  const newAmount = reprice ? (cur.items.length ? linesTotal(cur.items.map((it, n) => ({ qty: it.qty, p: prices[n] })), (l) => l.qty, (l) => l.p) : target!) : null;
  if (reprice) await db.$transaction(cur.items.flatMap((it, n) => (prices[n] !== Number(it.unitPrice) ? [db.dealItem.update({ where: { id: it.id }, data: { unitPrice: prices[n] } })] : [])));
  await db.deal.update({
    where: { id },
    data: {
      ...(newAmount != null ? { amount: newAmount } : {}),
      sourcingNote: txt(fd, "sourcingNote"),
      ...(num(fd, "supplierCost") !== undefined ? { supplierCost: num(fd, "supplierCost") } : {}),
      ...(num(fd, "freightCost") !== undefined ? { freightCost: num(fd, "freightCost") } : {}),
      ...(sheet
        ? { otherCosts: otherTotal(parts), taxCost: parts.tax, customsCost: parts.customs, packingCost: parts.packing, wireCost: parts.wire, creditAmount: parts.credit, creditSrc: parts.credit > 0 ? creditSrc : null, transitDays: days === undefined ? null : Math.min(365, Math.round(days)) }
        : num(fd, "otherCosts") !== undefined ? { otherCosts: num(fd, "otherCosts") } : {}),
    },
  });
  // A quote already open as a draft does not follow the Need: leave the person a reminder to adjust it there.
  if (reprice || newCost !== sumMoney([cur.supplierCost, cur.freightCost, cur.otherCosts])) await remindQuoteAdjust(id, user.lang === "EN" ? "EN" : "ES");
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
  if (!a.deal) throw new Error("Not a Need fact");
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

// ---------- New request (the first step of an order) and the files of a Need ----------

const FILE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 6;

async function storeFiles(dealId: string, fd: FormData, by: string, room = MAX_FILES) {
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, Math.max(0, room));
  let saved = 0, skipped = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES || !FILE_MIMES.includes(file.type)) { skipped++; continue; }
    await db.needFile.create({ data: { dealId, name: file.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "archivo", mime: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()), uploadedByName: by } });
    saved++;
  }
  return { saved, skipped };
}

/** A customer asks for something: the Need is created with who asks, what they need, the product or spare part
 *  (registered in the parts catalogue so it is not typed again), the customer's machine, notes for internal use,
 *  photos, and the date of the next contact. With "send the email" ticked, the person lands on the confirmation
 *  email already written, to review and send it. */
export async function createNeed(fd: FormData) {
  const user = await requireUser();
  const accountId = String(fd.get("accountId") ?? "");
  const title = txt(fd, "title", 150);
  if (!accountId || !title) redirect("/deals?err=nueva");
  const account = await db.account.findFirst({ where: { id: accountId, internal: false }, select: { id: true } });
  if (!account) redirect("/deals?err=nueva");
  const contactId = String(fd.get("contactId") ?? "");
  const contact = contactId ? await db.contact.findFirst({ where: { id: contactId, accountId }, select: { id: true } }) : null;
  const itemDescription = txt(fd, "itemDescription", 300);
  const itemCode = txt(fd, "itemCode", 60);
  const qty = Math.max(1, Math.min(100000, Math.round(num(fd, "itemQty") ?? 1)));
  // Next contact: the date the person chose; with none, two working days from today (what the email promises).
  const nextContact = dayOf(fd.get("nextContact")) ?? addWorkingDays(today(), 2);
  const created = await db.$transaction(async (tx) => {
    const code = await nextCode("J", "deal", tx);
    const deal = await tx.deal.create({
      data: {
        title: title!, amount: 0, stage: "LEAD", accountId, contactId: contact?.id ?? null, code, ownerId: user.id,
        needSpecs: txt(fd, "needSpecs"), desiredResult: txt(fd, "desiredResult", 300), internalNotes: txt(fd, "internalNotes"), machine: txt(fd, "machine", 200),
        nextMove: "Contactar al cliente: avance de su solicitud", nextMoveDate: nextContact,
      },
    });
    if (itemDescription || itemCode) {
      await tx.dealItem.create({ data: { dealId: deal.id, qty, code: itemCode, description: itemDescription ?? itemCode!, unitPrice: 0 } });
      // A new code is registered right away, so the next request picks it from the list.
      const key = itemCode ? partKey(itemCode) : "";
      if (key.length >= 3 && !(await tx.part.findUnique({ where: { mpnKey: key }, select: { id: true } }))) {
        await tx.part.create({ data: { mpn: itemCode!, mpnKey: key, name: itemDescription ?? itemCode!, createdByName: user.name } });
      }
    }
    await tx.activity.create({ data: { type: "NOTE", subject: `Solicitud recibida: ${title}`.slice(0, 200), userId: user.id, accountId, dealId: deal.id, phase: "need", source: "Nueva Necesidad" } });
    return deal;
  });
  await storeFiles(created.id, fd, user.name);
  refreshApp();
  redirect(fd.get("sendAck") === "1" ? `/correo/nuevo?tpl=ACK&id=${created.id}` : `/deals/${created.id}?tab=need&ok=creada`);
}

export async function addNeedFiles(id: string, fd: FormData) {
  const { user } = await editableDeal(id);
  const have = await db.needFile.count({ where: { dealId: id } });
  const r = await storeFiles(id, fd, user.name, 20 - have);
  refreshApp();
  const where = fd.get("back") === "locate" ? "tab=locate" : "tab=need";
  redirect(`/deals/${id}?${where}&ok=${r.saved ? (r.skipped ? "archivos-parte" : "archivos") : "archivos-nada"}#${where === "tab=locate" ? "fotos" : "archivos"}`);
}

export async function removeNeedFile(id: string, fileId: string) {
  await editableDeal(id);
  await db.needFile.deleteMany({ where: { id: fileId, dealId: id } });
  refreshApp();
  redirect(`/deals/${id}?tab=need&ok=archivo-quitado#archivos`);
}
