"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { money2, sumMoney } from "@/lib/money";
import { policyFloor, quoteNo } from "@/lib/quote";
import { buildPo, poInclude } from "@/lib/po";

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
  const lines = q.lines.map((l, n) => ({
    position: n,
    qty: Math.max(0, Math.round(Number(fd.get(`qty_${n}`) ?? l.qty) || 0)),
    code: txt(fd, `code_${n}`, 60) ?? l.code,
    description: txt(fd, `desc_${n}`, 300) ?? l.description,
    unitPrice: Math.max(0, money2(String(fd.get(`price_${n}`) ?? l.unitPrice).trim().replace(",", "."))),
  })).filter((l) => l.qty > 0);
  const po = await db.customerPO.create({
    data: {
      dealId: q.deal.id, quoteId, number,
      receivedAt: dayOf(fd.get("receivedAt")) ?? today(),
      requiredBy: dayOf(fd.get("requiredBy")),
      incoterm: txt(fd, "incoterm", 80), paymentTerms: txt(fd, "paymentTerms", 120), shipTo: txt(fd, "shipTo", 200),
      quoteRef: txt(fd, "quoteRef", 80), source: txt(fd, "source", 200),
      createdById: user.id, createdByName: user.name,
      lines: { create: lines },
    },
  });
  await db.activity.create({ data: { type: "NOTE", subject: `PO ${number} recibida · por comparar con cotización ${quoteNo(q)}`, userId: user.id, dealId: q.deal.id, accountId: (await db.deal.findUniqueOrThrow({ where: { id: q.deal.id }, select: { accountId: true } })).accountId, phase: "quote", source: txt(fd, "source", 200) ?? "PO del cliente" } });
  back(po.id, "ok=registrada");
}

/** Choose how to resolve the material date difference. It still needs its confirmation to count. */
export async function chooseResolution(id: string, option: "AMEND_DATE" | "EXPEDITE_ABSORB" | "EXPEDITE_CHARGE") {
  const { user, po } = await loadPo(id);
  if (po.acceptance || po.rejectedAt) back(id, "err=cerrada");
  const policy = await policyFloor();
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
  const policy = await policyFloor();
  const i = makeI18n("ES");
  const B = buildPo(po, i, policy.floorPct);
  if (!B.canAccept || !po.quote || !B.promiseDate) back(id, "err=precondicion");
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
    "Siguiente movimiento: colocar la compra al proveedor",
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
