"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditOps, canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { money2 } from "@/lib/money";
import { nextPrCode, prInclude } from "@/lib/pr";
import { ITEM_TYPES, canDecideStock, exposureOf } from "@/lib/pr-rules";

// Operaciones O1 · Purchase Requirement actions. Quantities and assignments change only while the Supplier PO is
// not released; the stock authorization is decided by Finanzas or Gerencia, never by whoever asked (interim, O-02).

const go = (id: string | null, qs: string): never => { refreshApp(); redirect(id ? `/compras/requerimientos/${id}?${qs}` : `/compras/requerimientos?${qs}`); };
const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const int = (fd: FormData, k: string) => { const n = Math.round(Number(fd.get(k))); return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null; };
const cost = (fd: FormData, k: string) => { const n = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(n) && n >= 0 && n < 1e9 ? money2(n) : null; };

type U = { id: string; role: string; covering?: string[] };
const canEditPr = (u: U, pr: { requesterId: string; deal: { ownerId: string } | null }) => (pr.deal ? canEditOps(u as never, pr.deal.ownerId) : u.id === pr.requesterId || canManageAll(u as never) || u.role === "NEGOCIADOR_OPERATIVO");

async function load(id: string) {
  const user = await requireUser();
  const pr = await db.purchaseRequirement.findUnique({ where: { id }, include: prInclude });
  if (!pr) go(null, "err=no-existe");
  const spo = pr!.supplierPoId ? await db.supplierPO.findUnique({ where: { id: pr!.supplierPoId }, select: { id: true, releasedAt: true } }) : null;
  return { user, pr: pr!, spo, locked: !!spo?.releasedAt || !!pr!.cancelledAt };
}

/** A purchase for stock: no Journey behind it, so it must say why (AC1–2). */
export async function createStockPr(fd: FormData) {
  const user = await requireUser();
  if (!(canManageAll(user) || user.role === "NEGOCIADOR_OPERATIVO" || user.role === "NEGOCIADOR_COMERCIAL" || user.role === "FINANZAS")) go(null, "err=permiso");
  const justification = txt(fd, "justification", 500);
  const lines = [0, 1, 2, 3].map((k) => ({ position: k, manufacturer: txt(fd, `mfr_${k}`, 80), code: txt(fd, `code_${k}`, 80), description: txt(fd, `desc_${k}`, 300) ?? "", qty: int(fd, `qty_${k}`) ?? 0, expectedUnitCost: cost(fd, `cost_${k}`) ?? 0 })).filter((l) => l.description && l.qty > 0);
  if (!justification) go(null, "err=justificacion#nuevo");
  if (!lines.length) go(null, "err=lineas#nuevo");
  const supplierId = txt(fd, "supplierId", 40);
  const supplier = supplierId ? await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }) : null;
  const day = String(fd.get("neededBy") ?? "");
  const itemType = String(fd.get("itemType") ?? "PRODUCT");
  const pr = await db.$transaction(async (tx) => tx.purchaseRequirement.create({ data: {
    code: await nextPrCode(tx), purpose: "INVENTORY", itemType: ITEM_TYPES[itemType] ? itemType : "PRODUCT", sellerKey: fd.get("sellerKey") === "CO" ? "CO" : "USA", requesterId: user.id, supplierId: supplier?.id ?? null,
    neededBy: /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null, urgent: fd.get("urgent") === "1", justification, sourceEvidence: txt(fd, "sourceEvidence", 300), createdByName: user.name,
    lines: { create: lines.map((l, n) => ({ ...l, position: n })) },
  } }));
  go(pr.id, "ok=creado");
}

export async function saveHeader(id: string, fd: FormData) {
  const { user, pr, locked } = await load(id);
  if (!canEditPr(user, pr)) go(id, "err=permiso");
  if (locked) go(id, "err=liberada");
  const supplierId = txt(fd, "supplierId", 40);
  const supplier = supplierId ? await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }) : null;
  await db.purchaseRequirement.update({ where: { id }, data: { justification: txt(fd, "justification", 500), nextMove: txt(fd, "nextMove", 300), ...(pr.supplierPoId ? {} : { supplierId: supplier?.id ?? null }) } });
  go(id, "ok=guardado");
}

/** Quantity to buy on a line (e.g. the supplier's minimum is above what was sold). Keeps the draft Supplier PO in step. */
export async function setLineQty(lineId: string, fd: FormData) {
  const line = await db.purchaseRequirementLine.findUnique({ where: { id: lineId }, select: { prId: true, position: true } });
  if (!line) go(null, "err=no-existe");
  const { user, pr, spo, locked } = await load(line!.prId);
  if (!canEditPr(user, pr)) go(pr.id, "err=permiso");
  if (locked) go(pr.id, "err=liberada");
  const qty = int(fd, "qty");
  if (qty == null || qty <= 0) go(pr.id, "err=cantidad");
  await db.$transaction(async (tx) => {
    await tx.purchaseRequirementLine.update({ where: { id: lineId }, data: { qty: qty! } });
    if (spo) await tx.supplierPOLine.updateMany({ where: { supplierPoId: spo.id, position: line!.position }, data: { qty: qty! } });
  });
  go(pr.id, "ok=cantidad");
}

/** Assign units of a line to a Journey (one purchase can serve several). */
export async function setAllocation(lineId: string, fd: FormData) {
  const line = await db.purchaseRequirementLine.findUnique({ where: { id: lineId }, select: { prId: true } });
  if (!line) go(null, "err=no-existe");
  const { user, pr, locked } = await load(line!.prId);
  if (!canEditPr(user, pr)) go(pr.id, "err=permiso");
  if (locked) go(pr.id, "err=liberada");
  const dealId = txt(fd, "dealId", 40);
  const qty = int(fd, "qty");
  const deal = dealId ? await db.deal.findFirst({ where: { id: dealId, poAcceptedAt: { not: null }, stage: { not: "LOST" } }, select: { id: true } }) : null;
  // Units are assigned only to a Journey with an accepted customer PO: a real sale, not a hope.
  if (!deal || qty == null) go(pr.id, "err=asignacion");
  if (qty === 0) await db.purchaseAllocation.deleteMany({ where: { lineId, dealId: deal!.id } });
  else await db.purchaseAllocation.upsert({ where: { lineId_dealId: { lineId, dealId: deal!.id } }, create: { lineId, dealId: deal!.id, qty: qty! }, update: { qty: qty! } });
  go(pr.id, "ok=asignacion");
}

export async function requestStock(id: string, fd: FormData) {
  const { user, pr } = await load(id);
  if (!canEditPr(user, pr)) go(id, "err=permiso");
  if (pr.cancelledAt) go(id, "err=liberada");
  const ex = exposureOf(pr);
  if (ex.qty <= 0) go(id, "err=sin-stock");
  const why = txt(fd, "justification", 500) ?? pr.justification;
  if (!why) go(id, "err=justificacion");
  await db.purchaseRequirement.update({ where: { id }, data: { stockStatus: "REQUESTED", stockRequestedAt: new Date(), stockQtyApproved: null, stockAmount: null, stockDecidedAt: null, stockDecidedByName: null, stockNote: null, justification: why } });
  go(id, "ok=stock-pedido");
}

export async function decideStock(id: string, fd: FormData) {
  const { user, pr } = await load(id);
  if (!canDecideStock(user, pr)) go(id, "err=autoridad");
  if (pr.stockStatus !== "REQUESTED") go(id, "err=estado");
  const note = txt(fd, "note", 400);
  const approve = fd.get("action") === "APPROVE";
  if (!approve && !note) go(id, "err=nota");
  const ex = exposureOf(pr);
  // The authorization covers exactly the quantity and value in front of the approver; more later needs a new one.
  await db.purchaseRequirement.update({ where: { id }, data: { stockStatus: approve ? "APPROVED" : "REJECTED", stockQtyApproved: approve ? ex.qty : null, stockAmount: approve ? ex.amount : null, stockDecidedAt: new Date(), stockDecidedByName: user.name, stockNote: note } });
  go(id, approve ? "ok=stock-aprobado" : "ok=stock-rechazado");
}
