"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fDay, fText } from "@/lib/fd";

// Módulo 15 §6 · Strategic accounts. Gerencia chooses them and says why. Only the reason, the growth idea and the
// next executive movement are kept here: everything else is read from the customer's own record (AC11).

const go = (qs: string): never => { refreshApp(); redirect(`/gerencia/cuentas?${qs}`); };
async function gerencia() {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=gerencia");
  return user;
}

export async function chooseAccount(fd: FormData) {
  const user = await gerencia();
  const account = await db.account.findFirst({ where: { id: String(fd.get("accountId") ?? ""), internal: false }, select: { id: true } });
  const reason = fText(fd, "reason", 1000);
  if (!account || !reason) go("err=datos#elegir");
  const executive = await db.user.findFirst({ where: { id: String(fd.get("executiveId") ?? ""), active: true }, select: { id: true } });
  const data = { reason: reason!, growthNote: fText(fd, "growthNote", 1000), nextMove: fText(fd, "nextMove", 500), nextMoveOn: fDay(fd, "nextMoveOn"), executiveId: executive?.id ?? null, active: true, endedAt: null, endedNote: null, endedByName: null, setByName: user.name };
  // A customer chosen before and later removed comes back on the same row, so its history stays in one place.
  const row = await db.strategicAccount.upsert({ where: { accountId: account!.id }, create: { accountId: account!.id, ...data }, update: data });
  go(`ok=elegida#a-${row.id}`);
}

export async function updateAccount(id: string, fd: FormData) {
  const user = await requireUser();
  const row = await db.strategicAccount.findUnique({ where: { id }, select: { executiveId: true, active: true } });
  if (!row || !row.active) go("err=no-existe");
  // Gerencia changes everything; the executive in charge keeps the next movement up to date.
  const ger = isGerencia(user);
  if (!ger && row!.executiveId !== user.id) go("err=permiso");
  const nextMove = fText(fd, "nextMove", 500), nextMoveOn = fDay(fd, "nextMoveOn");
  if (!nextMove || !nextMoveOn) go(`err=movimiento#a-${id}`);
  if (!ger) { await db.strategicAccount.update({ where: { id }, data: { nextMove, nextMoveOn } }); go(`ok=guardada#a-${id}`); }
  const reason = fText(fd, "reason", 1000);
  if (!reason) go(`err=datos#a-${id}`);
  const executive = await db.user.findFirst({ where: { id: String(fd.get("executiveId") ?? ""), active: true }, select: { id: true } });
  await db.strategicAccount.update({ where: { id }, data: { reason: reason!, growthNote: fText(fd, "growthNote", 1000), nextMove, nextMoveOn, executiveId: executive?.id ?? null } });
  go(`ok=guardada#a-${id}`);
}

export async function removeAccount(id: string, fd: FormData) {
  const user = await gerencia();
  const note = fText(fd, "note", 500);
  if (!note) go(`err=motivo#a-${id}`);
  await db.strategicAccount.updateMany({ where: { id, active: true }, data: { active: false, endedAt: new Date(), endedNote: note, endedByName: user.name } });
  go("ok=quitada");
}
