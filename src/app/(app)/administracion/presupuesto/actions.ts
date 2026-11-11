"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canAssignBudgets, canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { fDay, fMoney, fPick, fText } from "@/lib/fd";
import { SCOPE_KINDS } from "@/lib/admin-rules";

// Módulo 14 §2F · Budgets. Gerencia or Finanzas assign the money (user decision 2026-11-11); the owner keeps the forecast; Administración records
// commitments and spend that no other record holds. Committed and spent are never typed as totals.

const go = (qs: string): never => { refreshApp(); redirect(`/administracion/presupuesto?${qs}`); };

export async function createBudget(fd: FormData) {
  const user = await requireUser();
  if (!canAssignBudgets(user)) go("err=gerencia");
  const name = fText(fd, "name", 120), scopeKind = fPick(fd, "scopeKind", SCOPE_KINDS), amount = fMoney(fd, "amount"), from = fDay(fd, "periodFrom"), to = fDay(fd, "periodTo");
  const owner = await db.user.findFirst({ where: { id: String(fd.get("ownerId") ?? ""), active: true }, select: { id: true } });
  if (!name || !scopeKind || !amount || !from || !to || to < from || !owner) go("err=datos#nuevo");
  const b = await db.budget.create({ data: { name: name!, scopeKind: scopeKind!, ownerId: owner!.id, periodFrom: from!, periodTo: to!, amount: amount!, approvedByName: user.name, createdByName: user.name } });
  go(`ok=creado#b-${b.id}`);
}

export async function adjustBudget(id: string, fd: FormData) {
  const user = await requireUser();
  if (!canAssignBudgets(user)) go("err=gerencia");
  const amount = fMoney(fd, "amount");
  if (!amount) go(`err=valor#b-${id}`);
  // The change history keeps who changed the amount, when, and from how much to how much.
  await db.budget.update({ where: { id }, data: { amount: amount!, approvedByName: user.name } });
  go(`ok=ajustado#b-${id}`);
}

async function mine(id: string) {
  const user = await requireUser();
  const b = await db.budget.findUnique({ where: { id }, select: { ownerId: true, closedAt: true } });
  if (!b) go("err=no-existe");
  if (!(canFinance(user) || b!.ownerId === user.id)) go("err=permiso");
  if (b!.closedAt) go(`err=cerrado#b-${id}`);
  return user;
}

/** The owner says where the budget will end. It is their estimate, kept with its date and reason. */
export async function setForecast(id: string, fd: FormData) {
  const user = await mine(id);
  const forecast = fMoney(fd, "forecast"), note = fText(fd, "forecastNote");
  if (forecast == null || !note) go(`err=pronostico#b-${id}`);
  await db.budget.update({ where: { id }, data: { forecast, forecastNote: note, forecastAt: today(), forecastByName: user.name } });
  go(`ok=pronostico#b-${id}`);
}

export async function addBudgetEntry(id: string, fd: FormData) {
  const user = await mine(id);
  const kind = fPick(fd, "kind", { COMMITTED: 1, SPENT: 1 }), amount = fMoney(fd, "amount"), on = fDay(fd, "on") ?? today(), description = fText(fd, "description", 200);
  if (!kind || !amount || !description) go(`err=movimiento#b-${id}`);
  await db.budgetEntry.create({ data: { budgetId: id, kind: kind!, amount: amount!, on, description: description!, evidence: fText(fd, "evidence", 200), createdByName: user.name } });
  go(`ok=movimiento#b-${id}`);
}

/** A commitment that was dropped or already turned into spend: it stops using the budget, and stays as history. */
export async function closeBudgetEntry(entryId: string, fd: FormData) {
  const e = await db.budgetEntry.findUnique({ where: { id: entryId }, select: { budgetId: true, kind: true, closedAt: true } });
  if (!e) go("err=no-existe");
  await mine(e!.budgetId);
  const note = fText(fd, "note");
  if (e!.kind !== "COMMITTED" || e!.closedAt || !note) go(`err=cerrar#b-${e!.budgetId}`);
  await db.budgetEntry.update({ where: { id: entryId }, data: { closedAt: new Date(), closedNote: note } });
  go(`ok=movimiento#b-${e!.budgetId}`);
}

export async function closeBudget(id: string) {
  const user = await requireUser();
  if (!canAssignBudgets(user)) go("err=gerencia");
  await db.budget.updateMany({ where: { id, closedAt: null }, data: { closedAt: new Date() } });
  go("ok=cerrado");
}
