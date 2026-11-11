"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fDay, fInt, fMoney, fPick, fText } from "@/lib/fd";
import { FREQUENCIES, OBLIGATION_KINDS, RENEWALS, dueDates } from "@/lib/admin-rules";

// Módulo 14 §2I · Contracts & obligations register. Each one has an owner and its evidence. A renewal moves the
// end date and opens a new term; ending keeps the row. Every change is in the audit trail.

const go = (qs: string): never => { refreshApp(); redirect(`/administracion/obligaciones?${qs}`); };

export async function createObligation(fd: FormData) {
  const user = await requireUser();
  if (!canFinance(user)) go("err=permiso");
  const kind = fPick(fd, "kind", OBLIGATION_KINDS), renewal = fPick(fd, "renewal", RENEWALS) ?? "NONE", party = fText(fd, "party", 160), purpose = fText(fd, "purpose", 300);
  const owner = await db.user.findFirst({ where: { id: String(fd.get("ownerId") ?? ""), active: true }, select: { id: true } });
  const startsOn = fDay(fd, "startsOn"), endsOn = fDay(fd, "endsOn");
  if (!kind || !party || !purpose || !owner || (startsOn && endsOn && endsOn < startsOn)) go("err=datos#nueva");
  const dir = fPick(fd, "moneyDirection", { PAY: 1, COLLECT: 1, NONE: 1 }) ?? "NONE";
  const amount = dir === "NONE" ? null : fMoney(fd, "amount");
  const o = await db.obligation.create({ data: {
    kind: kind!, party: party!, purpose: purpose!, startsOn, endsOn, renewal, noticeDays: fInt(fd, "noticeDays", 0, 730), moneyDirection: amount ? dir : "NONE", amount,
    currency: (fText(fd, "currency", 3) ?? "USD").toUpperCase(), frequency: amount ? fPick(fd, "frequency", FREQUENCIES) ?? "ONCE" : null, nextDueOn: amount ? fDay(fd, "nextDueOn") : null,
    material: fd.get("material") === "1", ownerId: owner!.id, evidence: fText(fd, "evidence", 300), notes: fText(fd, "notes", 800), createdByName: user.name,
  } });
  go(`ok=creada#o-${o.id}`);
}

async function load(id: string) {
  const user = await requireUser();
  const o = await db.obligation.findUnique({ where: { id } });
  if (!o) go("err=no-existe");
  if (!(canFinance(user) || o!.ownerId === user.id)) go("err=permiso");
  if (o!.status !== "ACTIVE") go(`err=terminada#o-${id}`);
  return { user, o: o! };
}

/** Renew (with the new end date: a new term starts and the decision is open again) or decide to end. */
export async function decideObligation(id: string, fd: FormData) {
  const { user, o } = await load(id);
  const decision = fPick(fd, "decision", { RENEW: 1, END: 1 }), note = fText(fd, "note", 500);
  if (!decision || !note) go(`err=decision#o-${id}`);
  if (decision === "RENEW") {
    const newEnd = fDay(fd, "newEndsOn");
    if (!newEnd || (o.endsOn && newEnd <= o.endsOn)) go(`err=fecha#o-${id}`);
    await db.obligation.update({ where: { id }, data: { startsOn: o.endsOn ?? o.startsOn, endsOn: newEnd, decision: null, decisionNote: `Renovada: ${note}`, decidedAt: new Date(), decidedByName: user.name } });
    go(`ok=renovada#o-${id}`);
  }
  await db.obligation.update({ where: { id }, data: { decision: "END", decisionNote: note, decidedAt: new Date(), decidedByName: user.name } });
  go(`ok=decidida#o-${id}`);
}

/** This instalment was paid or collected: move to the next date of the frequency (or none, for a one-off). */
export async function advanceDue(id: string) {
  const { o } = await load(id);
  if (!o.nextDueOn) go(`err=decision#o-${id}`);
  const step = FREQUENCIES[o.frequency ?? "ONCE"]?.months ?? 0;
  // The second date of the series from the current one, never past the end.
  const next = step ? dueDates({ ...o, amount: o.amount == null ? null : Number(o.amount) }, o.nextDueOn!, new Date(Date.UTC(2100, 0, 1)), 2)[1] ?? null : null;
  await db.obligation.update({ where: { id }, data: { nextDueOn: next } });
  go(`ok=avanzada#o-${id}`);
}

export async function endObligation(id: string, fd: FormData) {
  const { o } = await load(id);
  const note = fText(fd, "note", 500);
  if (!note) go(`err=decision#o-${o.id}`);
  await db.obligation.update({ where: { id }, data: { status: "ENDED", endedAt: new Date(), endedNote: note } });
  go("ok=terminada");
}
