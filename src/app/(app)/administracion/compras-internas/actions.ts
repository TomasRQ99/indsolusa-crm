"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { fDay, fInt, fMoney, fPick, fText } from "@/lib/fd";
import { PURPOSES } from "@/lib/admin-rules";
import { nextInternalCode } from "@/lib/admin-store";
import { getPurchasePolicy } from "@/lib/pr-auth";
import { levelOf } from "@/lib/purchase-auth";
import { ipAuthority } from "@/lib/internal-purchase";

// Módulo 14 §2G · Internal purchases (Operaciones decision O-05 left them for this module). The need comes first;
// then budget and authority; buying is a later, separate fact. Anyone may ask; nobody decides their own request.

const list = (qs: string): never => { refreshApp(); redirect(`/administracion/compras-internas?${qs}`); };
const one = (id: string, qs: string): never => { refreshApp(); redirect(`/administracion/compras-internas/${id}?${qs}`); };

function read(fd: FormData) {
  const purpose = fPick(fd, "purpose", PURPOSES), need = fText(fd, "need", 500), description = fText(fd, "description", 200), amount = fMoney(fd, "amount");
  const currency = (fText(fd, "currency", 3) ?? "USD").toUpperCase();
  const amountUsd = currency === "USD" ? amount : fMoney(fd, "amountUsd");
  const years = fInt(fd, "tcoYears", 1, 50);
  const tco = purpose === "CAPITAL_ASSET" && years ? { years, yearlyCost: fMoney(fd, "tcoYearly") ?? 0, endValue: fMoney(fd, "tcoEnd") ?? 0, note: fText(fd, "tcoNote", 300) } : null;
  return { ok: !!(purpose && need && description && amount && amountUsd && /^[A-Z]{3}$/.test(currency)), purpose, need, description, amount, currency, amountUsd, tco, neededBy: fDay(fd, "neededBy"), supplierId: fText(fd, "supplierId", 40), supplierName: fText(fd, "supplierName", 160), budgetId: fText(fd, "budgetId", 40) };
}

export async function requestInternalPurchase(fd: FormData) {
  const user = await requireUser();
  const r = read(fd);
  if (!r.ok) list("err=datos#pedir");
  const [pol, budget, supplier] = await Promise.all([
    getPurchasePolicy(),
    r.budgetId ? db.budget.findFirst({ where: { id: r.budgetId, closedAt: null }, select: { id: true } }) : null,
    r.supplierId ? db.supplier.findUnique({ where: { id: r.supplierId }, select: { id: true } }) : null,
  ]);
  const p = await db.$transaction(async (tx) => tx.internalPurchase.create({ data: {
    code: await nextInternalCode("IP", tx), purpose: r.purpose!, need: r.need!, description: r.description!, amount: r.amount!, currency: r.currency, amountUsd: r.amountUsd!,
    supplierId: supplier?.id ?? null, supplierName: supplier ? null : r.supplierName, budgetId: budget?.id ?? null, requesterId: user.id, neededBy: r.neededBy,
    tco: (r.tco ?? undefined) as Prisma.InputJsonValue | undefined, level: levelOf(r.amountUsd!, pol.value), policyVersion: pol.version,
  } }));
  one(p.id, "ok=pedida");
}

async function load(id: string) {
  const user = await requireUser();
  const p = await db.internalPurchase.findUnique({ where: { id } });
  if (!p) list("err=no-existe");
  return { user, p: p! };
}

/** Approve, return with a question, or reject. Outside its budget it is an exception: higher level and a reason. */
export async function decideInternalPurchase(id: string, fd: FormData) {
  const { user, p } = await load(id);
  if (p.status !== "REQUESTED") one(id, "err=estado");
  const a = await ipAuthority(user, p);
  if (!a.ok) one(id, "err=autoridad");
  const action = String(fd.get("action") ?? ""), note = fText(fd, "note", 500);
  if (!["APPROVE", "RETURN", "REJECT"].includes(action)) one(id, "err=estado");
  if ((action !== "APPROVE" || a.check.exception) && !note) one(id, a.check.exception && action === "APPROVE" ? "err=razon" : "err=nota");
  const who = a.fromName ? `${user.name} (autoridad prestada por ${a.fromName})` : user.name;
  await db.internalPurchase.updateMany({ where: { id, status: "REQUESTED" }, data: {
    status: action === "APPROVE" ? "APPROVED" : action === "RETURN" ? "RETURNED" : "REJECTED", decidedById: user.id, decidedByName: who, decidedAt: new Date(), decisionNote: note, delegationId: a.delegationId,
    level: a.level, policyVersion: a.policyVersion,
    ...(action === "APPROVE" && a.check.exception ? { overBudget: a.check.over, exceptionReason: note } : {}),
  } });
  one(id, `ok=${action === "APPROVE" ? "aprobada" : action === "RETURN" ? "devuelta" : "rechazada"}`);
}

/** The requester answers a returned request (and may correct it); it goes back to whoever decides. */
export async function resubmitInternalPurchase(id: string, fd: FormData) {
  const { user, p } = await load(id);
  if (p.requesterId !== user.id || p.status !== "RETURNED") one(id, "err=estado");
  const r = read(fd);
  if (!r.ok) one(id, "err=datos");
  const pol = await getPurchasePolicy();
  await db.internalPurchase.update({ where: { id }, data: { status: "REQUESTED", need: r.need!, description: r.description!, amount: r.amount!, currency: r.currency, amountUsd: r.amountUsd!, neededBy: r.neededBy, level: levelOf(r.amountUsd!, pol.value), policyVersion: pol.version, decidedById: null, decidedByName: null, decidedAt: null } });
  one(id, "ok=reenviada");
}

/** Bought: from here the budget counts it as spent, not as committed. */
export async function markBought(id: string, fd: FormData) {
  const { user, p } = await load(id);
  if (!(p.requesterId === user.id || canFinance(user))) one(id, "err=permiso");
  const at = fDay(fd, "boughtAt") ?? today();
  if (p.status !== "APPROVED" || p.boughtAt || at > today()) one(id, "err=estado");
  await db.internalPurchase.update({ where: { id }, data: { boughtAt: at, boughtNote: fText(fd, "note") } });
  one(id, "ok=comprada");
}

export async function cancelInternalPurchase(id: string, fd: FormData) {
  const { user, p } = await load(id);
  if (!(p.requesterId === user.id || canFinance(user))) one(id, "err=permiso");
  const note = fText(fd, "note");
  if (p.boughtAt || p.status === "CANCELLED" || p.status === "REJECTED" || !note) one(id, "err=cancelar");
  await db.internalPurchase.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote: note } });
  one(id, "ok=cancelada");
}
