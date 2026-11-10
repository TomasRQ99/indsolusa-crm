"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { money2, mulMoney, sumMoney } from "@/lib/money";
import { quoteNo } from "@/lib/quote";
import { quoteFloor } from "@/lib/esagara-gate";
import { ACKABLE, buildPo, poInclude, type Ack } from "@/lib/po";
import { acceptCtx } from "@/lib/po-accept";
import { saleOf } from "@/lib/quote";
import { canEdit } from "@/lib/permissions";

const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const txt = (fd: FormData, k: string, max = 300) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const back = (id: string, qs: string): never => {
  refreshApp();
  redirect(`/po/${id}?${qs}`);
};

async function loadPo(id: string) {
  const user = await requireUser();
  const po = await db.customerPO.findUniqueOrThrow({ where: { id }, include: poInclude });
  assertCanEdit(user, po.deal.ownerId);
  return { user, po };
}

/** Record the PO exactly as the customer sent it, against the quote it answers. Nothing is accepted here. */
export async function registerPo(quoteId: string, fd: FormData) {
  const user = await requireUser();
  const q = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: { orderBy: { position: "asc" } }, deal: { select: { id: true, ownerId: true } } } });
  assertCanEdit(user, q.deal.ownerId);
  const number = txt(fd, "number", 80);
  if (!number) redirect(`/cotizaciones/${quoteId}?err=sin-oc`);
  // AC17: the same PO arriving twice (resend, second tab) is the same PO, never a second Deal.
  const dup = await db.customerPO.findFirst({ where: { dealId: q.deal.id, number: { equals: number!, mode: "insensitive" }, rejectedAt: null }, select: { id: true } });
  if (dup) back(dup.id, "ok=duplicada");
  // A quote shown in pesos gets its PO in pesos: each price is kept as written and compared in USD at the quote's
  // fixed rate (an unchanged peso price converts back to exactly the quoted USD price).
  const rate = q.currency === "COP" && Number(q.docFxRate ?? 0) > 0 ? Number(q.docFxRate) : null;
  const lines = q.lines.map((l, n) => {
    const raw = fd.get(`price_${n}`);
    const typed = raw == null ? null : Math.max(0, Number(String(raw).trim().replace(",", ".")) || 0);
    return {
      position: n,
      qty: Math.max(0, Math.round(Number(fd.get(`qty_${n}`) ?? l.qty) || 0)),
      code: txt(fd, `code_${n}`, 60) ?? l.code,
      description: txt(fd, `desc_${n}`, 300) ?? l.description,
      unitPrice: typed == null ? money2(l.unitPrice) : rate ? mulMoney(typed, 1 / rate) : money2(typed),
      ...(rate && typed != null ? { docUnitPrice: Math.round(typed) } : {}),
    };
  }).filter((l) => l.qty > 0);
  const po = await db.customerPO.create({
    data: {
      dealId: q.deal.id, quoteId, number,
      receivedAt: dayOf(fd.get("receivedAt")) ?? today(),
      requiredBy: dayOf(fd.get("requiredBy")),
      incoterm: txt(fd, "incoterm", 80), paymentTerms: txt(fd, "paymentTerms", 120), shipTo: txt(fd, "shipTo", 200),
      quoteRef: txt(fd, "quoteRef", 80), source: txt(fd, "source", 200),
      ...poTerms(fd),
      ...(rate ? { currency: "COP", docFxRate: rate } : {}),
      createdById: user.id, createdByName: user.name,
      lines: { create: lines },
    },
  });
  await db.activity.create({ data: { type: "NOTE", subject: `PO ${number} recibida · por comparar con cotización ${quoteNo(q)}`, userId: user.id, dealId: q.deal.id, accountId: (await db.deal.findUniqueOrThrow({ where: { id: q.deal.id }, select: { accountId: true } })).accountId, phase: "quote", source: txt(fd, "source", 200) ?? "PO del cliente" } });
  back(po.id, "ok=registrada");
}

const IVA = new Set(["INCLUDED", "ADDED", "EXEMPT", "NOT_STATED"]);
function poTerms(fd: FormData) {
  const iva = String(fd.get("ivaMode") ?? "");
  return {
    legalEntity: txt(fd, "legalEntity", 160), taxIdOnPo: txt(fd, "taxIdOnPo", 40), billTo: txt(fd, "billTo", 300),
    ivaMode: IVA.has(iva) ? iva : null, warranty: txt(fd, "warranty", 300), documents: txt(fd, "documents", 400),
    penalties: txt(fd, "penalties", 400), otherConditions: txt(fd, "otherConditions", 400),
  };
}

/** C6 §22: complete what the PO says (entity, tax, conditions) while it's open. The original fields stay as received. */
export async function savePoTerms(id: string, fd: FormData) {
  const { po } = await loadPo(id);
  if (po.acceptance || po.rejectedAt) back(id, "err=cerrada");
  await db.customerPO.update({ where: { id }, data: { ...poTerms(fd), ...(fd.has("shipTo") ? { shipTo: txt(fd, "shipTo", 200) } : {}) } });
  back(id, "ok=terminos");
}

/** A new condition (documents, penalties, warranty, IVA, entity name) is accepted only with a note of who and why. */
export async function ackCondition(id: string, key: string, fd: FormData) {
  const { user, po } = await loadPo(id);
  if (po.acceptance || po.rejectedAt) back(id, "err=cerrada");
  const note = txt(fd, "note", 300);
  if (!note || !ACKABLE.has(key)) back(id, "err=nota");
  const ack = { ...((po.conditionsAck ?? {}) as Ack), [key]: { by: user.name, at: new Date().toISOString(), note: note! } };
  await db.customerPO.update({ where: { id }, data: { conditionsAck: ack } });
  await db.activity.create({ data: { type: "NOTE", subject: `PO ${po.number}: condición «${key}» revisada y aceptada · ${note}`.slice(0, 200), userId: user.id, accountId: po.deal.accountId, dealId: po.dealId, phase: "quote", source: "Comparación PO vs cotización" } });
  back(id, "ok=condicion");
}

/** C-12 / AC15: stock and price confirmed again with the supplier, with its evidence. */
export async function revalidateSupply(id: string, fd: FormData) {
  const { user, po } = await loadPo(id);
  if (po.acceptance || po.rejectedAt) back(id, "err=cerrada");
  const evidence = txt(fd, "evidence", 300);
  if (!evidence) back(id, "err=evidencia");
  await db.customerPO.update({ where: { id }, data: { supplyRevalidatedAt: today(), supplyRevalidation: evidence, supplyRevalidatedBy: user.name } });
  await db.activity.create({ data: { type: "NOTE", subject: `Stock y precio revalidados para la PO ${po.number}: ${evidence}`.slice(0, 200), userId: user.id, accountId: po.deal.accountId, dealId: po.dealId, phase: "source", source: evidence } });
  back(id, "ok=revalidado");
}

/** §22: part of this PO covers another Journey of the same customer. Never more than the PO total. */
export async function addAllocation(id: string, fd: FormData) {
  const { user, po } = await loadPo(id);
  const dealId = txt(fd, "dealId", 40);
  const amount = money2(String(fd.get("amount") ?? "").trim().replace(",", "."));
  if (!dealId || dealId === po.dealId || !(amount > 0)) back(id, "err=asignacion");
  const target = await db.deal.findFirst({ where: { id: dealId!, accountId: po.deal.accountId }, select: { id: true, ownerId: true, title: true } });
  if (!target || !canEdit(user, target.ownerId)) back(id, "err=asignacion");
  const others = await db.poAllocation.aggregate({ where: { poId: id, dealId: { not: dealId! } }, _sum: { amount: true } });
  if (sumMoney([others._sum.amount ?? 0, amount]) > saleOf(po.lines) + 0.005) back(id, "err=excede");
  await db.poAllocation.upsert({ where: { poId_dealId: { poId: id, dealId: dealId! } }, create: { poId: id, dealId: dealId!, amount, lineRef: txt(fd, "lineRef", 120), note: txt(fd, "note", 300), createdByName: user.name }, update: { amount, lineRef: txt(fd, "lineRef", 120), note: txt(fd, "note", 300) } });
  await db.activity.create({ data: { type: "NOTE", subject: `PO ${po.number}: USD ${amount.toFixed(2)} asignados a «${target!.title}»`.slice(0, 200), userId: user.id, accountId: po.deal.accountId, dealId: target!.id, phase: "quote", source: `PO ${po.number}` } });
  back(id, "ok=asignada");
}

export async function removeAllocation(id: string, allocationId: string) {
  const { user, po } = await loadPo(id);
  const a = await db.poAllocation.findFirst({ where: { id: allocationId, poId: id }, include: { deal: { select: { id: true, title: true } } } });
  if (!a) back(id, "err=asignacion");
  await db.poAllocation.delete({ where: { id: allocationId } });
  await db.activity.create({ data: { type: "NOTE", subject: `PO ${po.number}: se quitó la asignación a «${a!.deal.title}»`.slice(0, 200), userId: user.id, accountId: po.deal.accountId, dealId: a!.deal.id, phase: "quote", source: `PO ${po.number}` } });
  back(id, "ok=asignada");
}

/** Choose how to resolve the material date difference. It still needs its confirmation to count. */
export async function chooseResolution(id: string, option: "AMEND_DATE" | "EXPEDITE_ABSORB" | "EXPEDITE_CHARGE") {
  const { user, po } = await loadPo(id);
  if (po.acceptance || po.rejectedAt) back(id, "err=cerrada");
  const policy = await quoteFloor(po.quoteId);
  const B = buildPo(po, makeI18n(user.lang), policy.floorPct);
  const o = B.options.find((x) => x.option === option);
  if (!o) back(id, "err=opcion");
  await db.$transaction([
    db.poResolution.updateMany({ where: { poId: id, state: { not: "WITHDRAWN" } }, data: { state: "WITHDRAWN" } }),
    db.poResolution.create({
      data: { poId: id, field: "date", option, promiseDate: o!.promiseDate, costDelta: o!.costDelta, priceDelta: o!.priceDelta, scenarioLabel: o!.scenarioLabel, message: o!.message, chosenById: user.id, chosenByName: user.name },
    }),
  ]);
  back(id, "ok=elegida");
}

/** The resolution becomes real only with evidence (who confirmed what, and where). */
export async function confirmResolution(id: string, resolutionId: string, fd: FormData) {
  const { user, po } = await loadPo(id);
  if (po.acceptance || po.rejectedAt) back(id, "err=cerrada");
  const evidence = txt(fd, "evidence", 300);
  if (!evidence) back(id, "err=evidencia");
  await db.poResolution.update({ where: { id: resolutionId, poId: id, state: "REQUESTED" }, data: { state: "CONFIRMED", evidence, confirmedByName: user.name, confirmedAt: new Date() } });
  back(id, "ok=confirmada");
}

export async function withdrawResolution(id: string, resolutionId: string) {
  const { po } = await loadPo(id);
  if (po.acceptance) back(id, "err=cerrada");
  await db.poResolution.update({ where: { id: resolutionId, poId: id }, data: { state: "WITHDRAWN" } });
  back(id, "ok=retirada");
}

/**
 * COMMAND: Accept PO.
 * Preconditions are evaluated here, on the server, at the moment of execution (the button is only a hint).
 * Effects, in one transaction: immutable PoAcceptance with a snapshot, the quote accepted, the customer PO
 * and the protected promise on the Journey, the economics of the chosen resolution, and the record.
 */
export async function acceptPo(id: string) {
  const { user, po } = await loadPo(id);
  const policy = await quoteFloor(po.quoteId);
  const i = makeI18n("ES");
  // Preconditions re-evaluated now, with fresh stock/credit/import data (C6 §23), never trusted from the page.
  const ctx = await acceptCtx(po);
  const B = buildPo(po, i, policy.floorPct, ctx);
  if (!B.canAccept || !po.quote || !B.promiseDate) back(id, "err=precondicion");
  const [scope, basis, allocations] = await Promise.all([
    db.scopeLine.findMany({ where: { dealId: po.dealId }, orderBy: { position: "asc" }, select: { component: true, code: true, qty: true, status: true } }),
    db.supplyBasis.findFirst({ where: { dealId: po.dealId, supersededAt: null }, select: { reason: true, primary: { select: { label: true, supplier: { select: { name: true } } } }, paymentOption: { select: { method: true, daysToRelease: true } } } }),
    db.poAllocation.findMany({ where: { poId: id }, select: { amount: true, deal: { select: { code: true, title: true } } } }),
  ]);
  const r = B.chosen?.state === "CONFIRMED" ? B.chosen : null;
  const costDelta = r ? money2(r.costDelta) : 0;
  const priceDelta = r && r.option === "EXPEDITE_CHARGE" ? money2(r.priceDelta) : 0;
  const deal = po.deal;
  const effects = [
    `Cotización ${quoteNo(po.quote!)} aceptada`,
    `OC del cliente ${po.number} registrada en el Journey`,
    `Promesa al cliente: entrega el ${i.date(B.promiseDate)}`,
    ...(costDelta ? [`Costo esperado +USD ${costDelta.toFixed(2)} (${r!.scenarioLabel ?? "envío acelerado"})`] : []),
    ...(priceDelta ? [`Venta +USD ${priceDelta.toFixed(2)} aprobada por el cliente`] : []),
    "Siguiente movimiento: colocar la compra al proveedor y emitir la instrucción de despacho",
    "No se compra ni se paga nada automáticamente",
  ];
  try {
    await db.$transaction(async (tx) => {
      await tx.poAcceptance.create({
        data: {
          poId: id, acceptedById: user.id, acceptedByName: user.name, promiseDate: B.promiseDate!, resolutionId: r?.id ?? null,
          snapshot: {
            quote: quoteNo(po.quote!), po: po.number,
            differences: B.diffs.filter((d) => d.state !== "match").map((d) => ({ field: d.label, quote: d.quote, po: d.po, state: d.state })),
            resolution: r ? { option: r.option, evidence: r.evidence, confirmedBy: r.confirmedByName } : null,
            preconditions: B.pre.map((p) => ({ text: p.text, ok: p.ok })),
            effects,
            // §23 Deal snapshot: what was committed, exactly as it was (Original Commitment; later changes are new versions).
            commitment: {
              desiredResult: deal.desiredResult,
              lines: po.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) })),
              total: saleOf(po.lines),
              protected: po.quote!.protSale != null ? { sale: Number(po.quote!.protSale), cost: Number(po.quote!.protCost), esagra: Number(po.quote!.protEsagra), policy: po.quote!.protPolicy } : null,
              promiseDate: B.promiseDate!.toISOString().slice(0, 10),
              scope,
              supplyBasis: basis ? { option: basis.primary.label, supplier: basis.primary.supplier.name, reason: basis.reason, pay: basis.paymentOption ? { method: basis.paymentOption.method, daysToRelease: basis.paymentOption.daysToRelease } : null } : null,
              terms: { incoterm: po.incoterm, paymentTerms: po.paymentTerms, ivaMode: po.ivaMode, documents: po.documents, penalties: po.penalties, warranty: po.warranty },
              conditionsAccepted: po.conditionsAck ?? null,
              revalidation: { supply: ctx.supply?.text.es ?? null, credit: ctx.credit?.text.es ?? null, import: ctx.importFeas?.text.es ?? null },
              allocations: allocations.map((a) => ({ journey: a.deal.code ?? a.deal.title, amount: Number(a.amount) })),
            },
          } as Prisma.InputJsonValue,
        },
      });
      await tx.quote.update({ where: { id: po.quote!.id }, data: { status: "ACCEPTED", decidedAt: B.base } });
      await tx.deal.update({
        where: { id: deal.id },
        data: {
          customerPo: po.number, poAcceptedAt: B.base, stage: "WON",
          promisedDate: B.promiseDate, promiseText: `Entrega de la PO ${po.number}`,
          ...(deal.originalPromisedDate ? {} : { originalPromisedDate: B.promiseDate }),
          waitingFor: null, waitingUntil: null,
          nextMove: `Colocar la compra al proveedor${r?.scenarioLabel ? ` (${r.scenarioLabel})` : ""} para cumplir el ${i.date(B.promiseDate)}`.slice(0, 200),
          nextMoveDate: today(),
          ...(costDelta ? { freightCost: sumMoney([deal.freightCost, costDelta]) } : {}),
          ...(priceDelta ? { amount: sumMoney([deal.amount, priceDelta]) } : {}),
        },
      });
      await tx.activity.create({ data: { type: "NOTE", subject: `PO ${po.number} aceptada · promesa ${i.date(B.promiseDate)}`.slice(0, 200), body: effects.join("\n"), userId: user.id, accountId: deal.accountId, dealId: deal.id, phase: "execute", source: r?.evidence ?? "Comparación PO vs cotización sin diferencias materiales" } });
    });
  } catch (e) {
    // Unique poId: the command already ran (double click, second tab). Idempotent.
    if ((e as { code?: string }).code === "P2002") back(id, "ok=ya-aceptada");
    throw e;
  }
  back(id, "ok=aceptada");
}

/** COMMAND: do not accept this PO (the customer must send a new one). */
export async function rejectPo(id: string, fd: FormData) {
  const { user, po } = await loadPo(id);
  if (po.acceptance || po.rejectedAt) back(id, "err=cerrada");
  const reason = txt(fd, "reason", 300);
  if (!reason) back(id, "err=motivo");
  await db.customerPO.update({ where: { id }, data: { rejectedAt: new Date(), rejectedByName: user.name, rejectReason: reason } });
  await db.activity.create({ data: { type: "NOTE", subject: `PO ${po.number} no aceptada: ${reason}`.slice(0, 200), userId: user.id, accountId: po.deal.accountId, dealId: po.dealId, phase: "quote", source: "Comparación PO vs cotización" } });
  back(id, "ok=rechazada");
}
