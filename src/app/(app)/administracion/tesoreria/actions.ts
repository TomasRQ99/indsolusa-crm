"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { fDay, fMoney, fPick, fText } from "@/lib/fd";
import { CONFIDENCE, PLAN_CATS } from "@/lib/treasury-rules";

// Módulo 14 §2A · Treasury. A person confirms what the bank shows, sets money aside and types what SOLU cannot
// know (payroll, taxes, financing). Nothing is edited afterwards: a newer balance is a new row, a reserve is
// released, a plan item is ended. Finanzas, Administración and management.

const go = (qs: string): never => { refreshApp(); redirect(`/administracion/tesoreria?${qs}`); };
async function finance() { const u = await requireUser(); if (!canFinance(u)) go("err=permiso"); return u; }

export async function confirmBalance(fd: FormData) {
  const user = await finance();
  const acc = await db.bankAccount.findFirst({ where: { id: String(fd.get("bankAccountId") ?? ""), active: true }, select: { id: true } });
  // A balance can be negative (overdraft), so it is read with its sign.
  const raw = String(fd.get("amount") ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const amount = Number(raw);
  const on = fDay(fd, "observedAt");
  const source = fPick(fd, "source", { STATEMENT: 1, BANK_PORTAL: 1, TYPED: 1 });
  if (!acc || !raw || !Number.isFinite(amount) || Math.abs(amount) > 1e10 || !on || on > today() || !source) go("err=saldo#cuentas");
  await db.cashBalance.create({ data: { bankAccountId: acc!.id, amount: money2(amount), observedAt: on!, source: source!, note: fText(fd, "note"), confirmedByName: user.name } });
  go("ok=saldo#cuentas");
}

export async function addReserve(fd: FormData) {
  const user = await finance();
  const kind = fPick(fd, "kind", { RESTRICTED: 1, RESERVED: 1 });
  const purpose = fText(fd, "purpose", 200), amount = fMoney(fd, "amount"), authority = fText(fd, "authorityName", 120);
  // "Todo recurso comprometido debe tener propósito, autoridad y trazabilidad" (§1.3).
  if (!kind || !purpose || !amount || !authority) go("err=reserva#reservas");
  await db.cashReserve.create({ data: { kind: kind!, purpose: purpose!, amount: amount!, authorityName: authority!, until: fDay(fd, "until"), createdByName: user.name } });
  go("ok=reserva#reservas");
}

export async function releaseReserve(id: string, fd: FormData) {
  const user = await finance();
  const note = fText(fd, "note");
  if (!note) go("err=liberar#reservas");
  await db.cashReserve.updateMany({ where: { id, releasedAt: null }, data: { releasedAt: new Date(), releasedByName: user.name, releaseNote: note } });
  go("ok=liberada#reservas");
}

export async function addPlanItem(fd: FormData) {
  const user = await finance();
  const direction = fPick(fd, "direction", { IN: 1, OUT: 1 }), category = fPick(fd, "category", PLAN_CATS), confidence = fPick(fd, "confidence", CONFIDENCE);
  const label = fText(fd, "label", 160), amount = fMoney(fd, "amount"), dueOn = fDay(fd, "dueOn"), source = fText(fd, "source", 200);
  const repeat = fd.get("repeat") === "MONTHLY" ? "MONTHLY" : "NONE";
  // Each figure keeps how sure it is and where it comes from (§8): without a source it is not saved.
  if (!direction || !category || !confidence || !label || !amount || !dueOn || !source) go("err=plan#plan");
  await db.cashPlanItem.create({ data: { direction: direction!, category: category!, label: label!, amount: amount!, dueOn: dueOn!, repeat, repeatUntil: repeat === "MONTHLY" ? fDay(fd, "repeatUntil") : null, confidence: confidence!, source: source!, observedAt: today(), createdByName: user.name } });
  go("ok=plan#plan");
}

export async function endPlanItem(id: string, fd: FormData) {
  const user = await finance();
  await db.cashPlanItem.updateMany({ where: { id, endedAt: null }, data: { endedAt: new Date(), endedByName: user.name, endedNote: fText(fd, "note") ?? "Ya ocurrió o ya no aplica" } });
  go("ok=plan-fin#plan");
}
