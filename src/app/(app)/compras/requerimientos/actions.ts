"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ROLES, canEditOps, canManageAll, isGerencia, isMoneyRole } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { money2 } from "@/lib/money";
import { nextPrCode, prInclude } from "@/lib/pr";
import { ITEM_TYPES } from "@/lib/pr-rules";
import type { Prisma } from "@prisma/client";
import { fullReadiness, getPurchasePolicy } from "@/lib/pr-auth";
import { PURCHASE_POLICY_KEY, REASONS, canApprovePurchase, type PurchasePolicy } from "@/lib/purchase-auth";

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
  if (!(canManageAll(user) || user.role === "NEGOCIADOR_OPERATIVO" || user.role === "NEGOCIADOR_COMERCIAL" || isMoneyRole(user.role))) go(null, "err=permiso");
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

/** Ask for the purchase authorization. The request freezes what the approver will see and the policy version. */
export async function requestApproval(id: string, fd: FormData) {
  const { user, pr } = await load(id);
  if (!canEditPr(user, pr)) go(id, "err=permiso");
  if (pr.cancelledAt) go(id, "err=liberada");
  const f = await fullReadiness(pr);
  if (f.auth.reasons.length === 0) go(id, "err=sin-motivo");
  if (f.last?.status === "REQUESTED") go(id, "ok=ya-pedida#autorizacion");
  const note = txt(fd, "note", 500) ?? pr.justification;
  // Stock is never authorized without its reason written down.
  if (f.auth.reasons.includes("STOCK") && !note) go(id, "err=justificacion#autorizacion");
  await db.$transaction([
    db.purchaseApproval.create({ data: {
      prId: id, reasons: f.auth.reasons, amount: f.auth.facts.amount, relatedTotal: f.auth.facts.relatedTotal, stockQty: f.auth.facts.stockQty, stockAmount: f.auth.facts.stockAmount,
      level: f.auth.level, requestedById: user.id, requestedByName: user.name, requestNote: note, context: f.auth.context as unknown as Prisma.InputJsonValue, policyVersion: f.policy.version,
    } }),
    db.purchaseRequirement.update({ where: { id }, data: { ...(f.auth.reasons.includes("STOCK") ? { stockStatus: "REQUESTED", stockRequestedAt: new Date(), justification: note } : {}) } }),
  ]);
  go(id, "ok=pedida#autorizacion");
}

/** Approve, return with a question, reject, or send up to level 2. Never by the person who asked. */
export async function decideApproval(approvalId: string, fd: FormData) {
  const user = await requireUser();
  const a = await db.purchaseApproval.findUnique({ where: { id: approvalId } });
  if (!a) go(null, "err=no-existe");
  const id = a!.prId;
  const pol = await getPurchasePolicy();
  if (!canApprovePurchase(user, a!, pol.value)) go(id, "err=autoridad#autorizacion");
  if (a!.status !== "REQUESTED") go(id, "err=estado#autorizacion");
  const action = String(fd.get("action") ?? "");
  const note = txt(fd, "note", 500);
  if (action === "ESCALATE") {
    if (a!.level >= 2) go(id, "err=estado#autorizacion");
    await db.purchaseApproval.update({ where: { id: approvalId }, data: { level: 2, escalatedByName: user.name, decisionNote: note } });
    go(id, "ok=escalada#autorizacion");
  }
  if ((action === "RETURN" || action === "REJECT") && !note) go(id, "err=nota#autorizacion");
  if (!["APPROVE", "RETURN", "REJECT"].includes(action)) go(id, "err=estado#autorizacion");
  const status = action === "APPROVE" ? "APPROVED" : action === "RETURN" ? "RETURNED" : "REJECTED";
  const reasons = Array.isArray(a!.reasons) ? (a!.reasons as string[]) : [];
  const stock = reasons.includes("STOCK");
  await db.$transaction([
    db.purchaseApproval.update({ where: { id: approvalId }, data: { status, decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), decisionNote: note } }),
    db.purchaseRequirement.update({ where: { id }, data: stock ? { stockStatus: status === "APPROVED" ? "APPROVED" : status === "REJECTED" ? "REJECTED" : "NONE", stockQtyApproved: status === "APPROVED" ? a!.stockQty : null, stockAmount: status === "APPROVED" ? a!.stockAmount : null, stockDecidedAt: new Date(), stockDecidedByName: user.name, stockNote: note } : {} }),
  ]);
  go(id, `ok=${status === "APPROVED" ? "aprobada" : status === "RETURNED" ? "devuelta" : "rechazada"}#autorizacion`);
}

/** Purchase authorization policy: who approves at each level, the limit and what makes a purchase non-routine.
 *  Gerencia only; every change is a new version, and past decisions keep the version they were made with. */
export async function savePurchasePolicy(fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`/compras/requerimientos?${qs}#politica`); };
  if (!isGerencia(user)) back("err=pol-permiso");
  const roles = (lvl: string) => ROLES.filter((r) => fd.get(`${lvl}_${r}`) === "1") as string[];
  const limit = Number(String(fd.get("level1LimitUsd") ?? "").replace(",", "."));
  const days = Math.round(Number(fd.get("relatedDays")));
  const value: PurchasePolicy = {
    level1Roles: roles("l1"), level2Roles: roles("l2"), level1LimitUsd: Math.round(limit * 100) / 100, relatedDays: days,
    triggers: Object.fromEntries(REASONS.map((r) => [r, fd.get(`t_${r}`) === "1"])) as PurchasePolicy["triggers"],
  };
  if (!Number.isFinite(limit) || limit < 0 || limit > 1e8 || !Number.isFinite(days) || days < 0 || days > 365) back("err=pol-valor");
  // There must always be someone above the limit, or large purchases could never be approved.
  if (value.level2Roles.length === 0) back("err=pol-nivel2");
  const cur = await getPurchasePolicy();
  if (JSON.stringify(cur.value) === JSON.stringify(value)) back("ok=pol-igual");
  await db.marketSetting.create({ data: { key: PURCHASE_POLICY_KEY, version: cur.version + 1, value, updatedByName: user.name } });
  back("ok=pol-guardada");
}