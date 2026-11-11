"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { cmpMoney, money2 } from "@/lib/money";
import { TRM_SOURCE, copToUsd, impliedRate, trmFor } from "@/lib/fx";
import { EXPENSE_CATS, MAX_EXPENSES, MAX_RECEIPT_BYTES, RECEIPT_MIMES, canDecideBudget, canEditExpenses, canReconcile, canRequestBudget, travelSummary } from "@/lib/travel-rules";
import { travelSettlement } from "@/lib/admin-rules";
import { today } from "@/lib/domain";

// Travel budget and expenses of a mission. Started as Comercial C8e (interim rules, decision C-17) and aligned with
// the official Module 14 §14 and §18 on 2026-11-11: the mission gives the purpose; Administración authorises and
// controls the money. Nobody approves their own trip or checks their own expenses; no expense counts until a person
// checked it against its evidence; the advance is settled into what the company owes or the traveller returns.

const go = (id: string, qs: string): never => { refreshApp(); redirect(`/visitas/mision/${id}?${qs}`); };
const txt = (fd: FormData, k: string, max = 500) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null; };
const amountOf = (fd: FormData, k: string) => { const n = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 && n < 1e7 ? money2(n) : null; };

async function load(id: string) {
  const user = await requireUser();
  const m = await db.commercialMission.findUnique({ where: { id }, select: { id: true, ownerId: true, budgetStatus: true, budgetAmount: true, budgetApproved: true, expensesStatus: true, advanceAmount: true, advanceGivenAt: true, settledAt: true, owner: { select: { role: true } } } });
  if (!m) { refreshApp(); redirect("/visitas?err=mision-no"); }
  return { user, m: m!, who: { ownerId: m!.ownerId, ownerRole: m!.owner.role } };
}

export async function requestBudget(id: string, fd: FormData) {
  const { user, m } = await load(id);
  if (!canEdit(user, m.ownerId)) go(id, "err=permiso");
  if (!canRequestBudget(m.budgetStatus)) go(id, "err=estado");
  const amount = amountOf(fd, "budgetAmount");
  if (amount == null) go(id, "err=monto");
  await db.commercialMission.update({ where: { id }, data: { budgetStatus: "REQUESTED", budgetAmount: amount, budgetRequestedAt: new Date(), budgetApproved: null, budgetDecidedAt: null, budgetDecidedByName: null, budgetNote: txt(fd, "budgetNote") } });
  go(id, "ok=pedido");
}

export async function decideBudget(id: string, fd: FormData) {
  const { user, m, who } = await load(id);
  if (!canDecideBudget(user, who)) go(id, "err=autoridad");
  if (m.budgetStatus !== "REQUESTED") go(id, "err=estado");
  const approve = fd.get("action") === "APPROVE";
  const note = txt(fd, "note");
  if (!approve) {
    if (!note) go(id, "err=nota");
    await db.commercialMission.update({ where: { id }, data: { budgetStatus: "REJECTED", budgetApproved: null, budgetDecidedAt: new Date(), budgetDecidedByName: user.name, budgetNote: note } });
    go(id, "ok=rechazado");
  }
  const approved = amountOf(fd, "approved") ?? (m.budgetAmount != null ? money2(m.budgetAmount) : null);
  if (approved == null) go(id, "err=monto");
  // Approving a different amount than requested needs a reason the traveller can read.
  if (m.budgetAmount != null && cmpMoney(approved, m.budgetAmount) !== 0 && !note) go(id, "err=nota-monto");
  // Módulo 14 §2F: the trip is charged to a budget when the approver names one; from now it is a commitment there.
  const budgetId = String(fd.get("budgetId") ?? "");
  const budget = budgetId ? await db.budget.findFirst({ where: { id: budgetId, closedAt: null }, select: { id: true } }) : null;
  await db.commercialMission.update({ where: { id }, data: { budgetStatus: "APPROVED", budgetApproved: approved, budgetDecidedAt: new Date(), budgetDecidedByName: user.name, budgetNote: note, budgetId: budget?.id ?? null } });
  go(id, "ok=aprobado");
}

export async function addExpense(id: string, fd: FormData) {
  const { user, m } = await load(id);
  if (!canEdit(user, m.ownerId)) go(id, "err=permiso");
  if (!canEditExpenses(m)) go(id, "err=gastos-estado");
  if ((await db.missionExpense.count({ where: { missionId: id } })) >= MAX_EXPENSES) go(id, "err=muchos");
  const spentOn = dayOf(fd, "spentOn");
  const paid = amountOf(fd, "amount");
  const description = txt(fd, "description", 200);
  const category = String(fd.get("category") ?? "");
  if (!spentOn || paid == null || !description || !EXPENSE_CATS[category]) go(id, "err=gasto");
  // USD stays USD. COP is converted the way the person chose: the official TRM of the expense date, or the USD
  // amount they were actually charged (card statement). Both keep the original amount, the rate and its source.
  const cop = fd.get("currency") === "COP";
  let amount = paid!;
  let fx: { currency: string; originalAmount: number | null; fxRate: number | null; fxSource: string | null } = { currency: "USD", originalAmount: null, fxRate: null, fxSource: null };
  if (cop) {
    if (fd.get("fxMode") === "CHARGED") {
      const usd = amountOf(fd, "usdCharged");
      if (usd == null) go(id, "err=usd-cobrado");
      amount = usd!;
      fx = { currency: "COP", originalAmount: paid!, fxRate: impliedRate(paid!, usd!), fxSource: `Monto cobrado en USD, escrito por ${user.name}` };
    } else {
      const trm = await trmFor(spentOn!.toISOString().slice(0, 10));
      if (!trm) go(id, "err=tasa");
      amount = copToUsd(paid!, trm!.rate);
      if (amount <= 0) go(id, "err=gasto");
      fx = { currency: "COP", originalAmount: paid!, fxRate: trm!.rate, fxSource: `${TRM_SOURCE} · vigente ${trm!.validFrom}` };
    }
  }
  const f = fd.get("receipt");
  const file = f instanceof File && f.size > 0 ? f : null;
  if (file && (file.size > MAX_RECEIPT_BYTES || !RECEIPT_MIMES.includes(file.type))) go(id, "err=soporte-tipo");
  const noReceiptReason = file ? null : txt(fd, "noReceiptReason", 200);
  // A receipt, or the reason there isn't one: never neither.
  if (!file && !noReceiptReason) go(id, "err=soporte");
  await db.missionExpense.create({ data: {
    missionId: id, spentOn: spentOn!, category, description: description!, amount, ...fx, noReceiptReason, createdByName: user.name, createdById: user.id,
    ...(file ? { receiptName: file.name.slice(0, 160) || "soporte", receiptMime: file.type, receiptSize: file.size, receiptData: Buffer.from(await file.arrayBuffer()) } : {}),
  } });
  go(id, "ok=gasto#gastos");
}

export async function removeExpense(expenseId: string) {
  const user = await requireUser();
  const e = await db.missionExpense.findUnique({ where: { id: expenseId }, select: { id: true, mission: { select: { id: true, ownerId: true, budgetStatus: true, expensesStatus: true } } } });
  if (!e) { refreshApp(); redirect("/visitas?err=mision-no"); }
  const m = e!.mission;
  if (!canEdit(user, m.ownerId)) go(m.id, "err=permiso");
  if (!canEditExpenses(m)) go(m.id, "err=gastos-estado");
  await db.missionExpense.delete({ where: { id: expenseId } });
  go(m.id, "ok=gasto-quitado#gastos");
}

export async function submitExpenses(id: string) {
  const { user, m } = await load(id);
  if (!canEdit(user, m.ownerId)) go(id, "err=permiso");
  if (!canEditExpenses(m)) go(id, "err=gastos-estado");
  if ((await db.missionExpense.count({ where: { missionId: id } })) === 0) go(id, "err=sin-gastos");
  await db.commercialMission.update({ where: { id }, data: { expensesStatus: "SUBMITTED", expensesSubmittedAt: new Date() } });
  go(id, "ok=enviado");
}

/** Finanzas / Gerencia check the expenses against the approved budget: reconcile, or return with a question. */
export async function reconcileExpenses(id: string, fd: FormData) {
  const { user, m, who } = await load(id);
  if (!canReconcile(user, who)) go(id, "err=autoridad");
  if (m.expensesStatus !== "SUBMITTED") go(id, "err=estado");
  const note = txt(fd, "note");
  if (fd.get("action") === "RETURN") {
    if (!note) go(id, "err=nota");
    await db.commercialMission.update({ where: { id }, data: { expensesStatus: "RETURNED", reconcileNote: note, reconciledByName: user.name, reconciledAt: null } });
    go(id, "ok=devuelto");
  }
  const rows = await db.missionExpense.findMany({ where: { missionId: id }, select: { amount: true, category: true, receiptName: true, createdById: true, outcome: true } });
  // Whoever typed in any of the expenses doesn't check them either.
  if (rows.some((r) => r.createdById === user.id)) go(id, "err=cargaste");
  // Módulo 14 §18: every expense needs its own outcome before the trip can be reconciled.
  if (rows.some((r) => !r.outcome)) go(id, "err=sin-validar#gastos");
  const valid = rows.filter((r) => r.outcome === "VALID");
  const s = travelSummary(m.budgetApproved, valid.map((r) => ({ amount: r.amount, category: r.category, hasReceipt: !!r.receiptName })));
  // Over budget can still be reconciled, but only with the reason written down.
  if (s.over && !note) go(id, "err=nota-exceso");
  await db.commercialMission.update({ where: { id }, data: { expensesStatus: "RECONCILED", reconcileNote: note, reconciledByName: user.name, reconciledAt: new Date() } });
  go(id, "ok=legalizado");
}

/** Official rate for a day, shown in the form before saving so the person sees the conversion they are choosing. */
export async function previewRate(day: string): Promise<{ ok: true; rate: number; validFrom: string } | { ok: false }> {
  await requireUser();
  const trm = await trmFor(String(day ?? ""));
  return trm ? { ok: true, rate: trm.rate, validFrom: trm.validFrom } : { ok: false };
}

// ---------- Módulo 14 §14, §18 · advance, expense by expense, settlement ----------

/** Money handed to the traveller before the trip. Finanzas or Gerencia, never the traveller; once per trip. */
export async function giveAdvance(id: string, fd: FormData) {
  const { user, m, who } = await load(id);
  if (!canReconcile(user, who)) go(id, "err=autoridad");
  const amount = amountOf(fd, "advanceAmount"), ref = txt(fd, "advanceRef", 120), on = dayOf(fd, "advanceOn") ?? today();
  if (m.budgetStatus !== "APPROVED" || m.advanceGivenAt || m.settledAt || m.expensesStatus === "RECONCILED") go(id, "err=estado");
  if (amount == null || !ref || on > today()) go(id, "err=anticipo#anticipo");
  // An advance never exceeds the approved budget.
  if (m.budgetApproved != null && cmpMoney(amount, m.budgetApproved) > 0) go(id, "err=anticipo-tope#anticipo");
  await db.commercialMission.update({ where: { id }, data: { advanceAmount: amount, advanceGivenAt: on, advanceGivenByName: user.name, advanceRef: ref } });
  go(id, "ok=anticipo#anticipo");
}

/** One expense, checked against its receipt and the travel rules: valid, or not accepted with the reason. */
export async function setExpenseOutcome(expenseId: string, fd: FormData) {
  const user = await requireUser();
  const e = await db.missionExpense.findUnique({ where: { id: expenseId }, select: { id: true, createdById: true, receiptName: true, mission: { select: { id: true, ownerId: true, expensesStatus: true, owner: { select: { role: true } } } } } });
  if (!e) { refreshApp(); redirect("/visitas?err=mision-no"); }
  const m = e!.mission;
  if (!canReconcile(user, { ownerId: m.ownerId, ownerRole: m.owner.role }) || e!.createdById === user.id) go(m.id, "err=autoridad");
  if (m.expensesStatus !== "SUBMITTED") go(m.id, "err=estado");
  const outcome = String(fd.get("outcome") ?? ""), note = txt(fd, "note", 300);
  if (outcome !== "VALID" && outcome !== "REJECTED") go(m.id, "err=estado");
  // Not accepting needs a reason; so does accepting an expense that has no receipt.
  if ((outcome === "REJECTED" || !e!.receiptName) && !note) go(m.id, "err=resultado#gastos");
  await db.missionExpense.update({ where: { id: expenseId }, data: { outcome, outcomeNote: note, outcomeByName: user.name } });
  go(m.id, "ok=resultado#gastos");
}

/** Accept in one step every expense that has its receipt and no outcome yet. The ones without a receipt stay for a person. */
export async function validateWithReceipts(id: string) {
  const { user, m, who } = await load(id);
  if (!canReconcile(user, who)) go(id, "err=autoridad");
  if (m.expensesStatus !== "SUBMITTED") go(id, "err=estado");
  await db.missionExpense.updateMany({ where: { missionId: id, outcome: null, receiptName: { not: null }, NOT: { createdById: user.id } }, data: { outcome: "VALID", outcomeByName: user.name } });
  go(id, "ok=resultado#gastos");
}

/** Close the trip's money: what was validly spent minus the advance. The company pays the difference, or the
 *  traveller returns it. Recorded with the bank reference by Finanzas or Gerencia. */
export async function settleMission(id: string, fd: FormData) {
  const { user, m, who } = await load(id);
  if (!canReconcile(user, who)) go(id, "err=autoridad");
  if (m.expensesStatus !== "RECONCILED" || m.settledAt) go(id, "err=estado");
  const rows = await db.missionExpense.findMany({ where: { missionId: id }, select: { amount: true, outcome: true } });
  const st = travelSettlement(m.advanceGivenAt ? m.advanceAmount : null, rows);
  const ref = txt(fd, "settleRef", 120);
  if (!st.ready) go(id, "err=sin-validar#gastos");
  if (st.direction !== "EVEN" && !ref) go(id, "err=liquidar#liquidacion");
  await db.commercialMission.update({ where: { id }, data: { settleAmount: st.settle, settledAt: new Date(), settledByName: user.name, settleRef: ref } });
  go(id, "ok=liquidado#liquidacion");
}
