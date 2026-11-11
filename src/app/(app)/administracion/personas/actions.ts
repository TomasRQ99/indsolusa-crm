"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canAdminPeople, canManageAll, canSetPay } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { fDay, fMoney, fPick, fText } from "@/lib/fd";
import { ABSENCE_KINDS, GAP_KINDS, overlaps } from "@/lib/admin-rules";

// Módulo 14 §2K, §15, §23–25 · People administration. Only administrative facts: bond, formal assignment, pay,
// absences and the support the company owes. Nothing about development, character or evaluations lives here.
// Pay is set by Gerencia only. Nobody decides their own absence.

const go = (userId: string, qs: string): never => { refreshApp(); redirect(`/administracion/personas/${userId}?${qs}`); };

export async function savePersonAdmin(userId: string, fd: FormData) {
  const user = await requireUser();
  if (!canAdminPeople(user)) go(userId, "err=permiso");
  const start = fDay(fd, "contractStart"), end = fDay(fd, "contractEnd");
  if (start && end && end < start) go(userId, "err=fechas#vinculo");
  const raw = String(fd.get("vacationDaysPerYear") ?? "").trim().replace(",", ".");
  const vac = raw && Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 365 ? Math.round(Number(raw) * 10) / 10 : null;
  const data = { legalName: fText(fd, "legalName", 160), bond: fPick(fd, "bond", { EMPLOYEE: 1, CONTRACTOR: 1, PARTNER: 1, OTHER: 1 }), employer: fText(fd, "employer", 160), contractStart: start, contractEnd: end, location: fText(fd, "location", 120), vacationDaysPerYear: vac, documentsNote: fText(fd, "documentsNote", 600), updatedByName: user.name };
  await db.personAdmin.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  go(userId, "ok=vinculo#vinculo");
}

/** A new formal assignment closes the current one on the same day, so the history has no gaps or overlaps. */
export async function addRoleAssignment(userId: string, fd: FormData) {
  const user = await requireUser();
  if (!canAdminPeople(user)) go(userId, "err=permiso");
  const title = fText(fd, "contractualTitle", 160), from = fDay(fd, "effectiveFrom"), reason = fText(fd, "reason", 300);
  const person = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!person || !title || !from || !reason) go(userId, "err=cargo#cargo");
  const current = await db.personRoleAssignment.findFirst({ where: { userId, effectiveTo: null }, orderBy: { effectiveFrom: "desc" } });
  if (current && from! <= current.effectiveFrom) go(userId, "err=cargo-fecha#cargo");
  const leaderId = fText(fd, "leaderId", 40);
  const leader = leaderId && leaderId !== userId ? await db.user.findFirst({ where: { id: leaderId, active: true }, select: { id: true } }) : null;
  await db.$transaction([
    ...(current ? [db.personRoleAssignment.update({ where: { id: current.id }, data: { effectiveTo: from! } })] : []),
    // The operating role is the role the person has in SOLU that day: written down so the history shows both identities.
    db.personRoleAssignment.create({ data: { userId, contractualTitle: title!, operatingRole: person!.role, unit: fText(fd, "unit", 120), leaderId: leader?.id ?? null, location: fText(fd, "location", 120), effectiveFrom: from!, reason: reason!, setByName: user.name } }),
  ]);
  go(userId, "ok=cargo#cargo");
}

export async function setCompensation(userId: string, fd: FormData) {
  const user = await requireUser();
  if (!canSetPay(user)) go(userId, "err=permiso");
  const amount = fMoney(fd, "amount", 1e12), from = fDay(fd, "effectiveFrom"), period = fPick(fd, "period", { MONTHLY: 1, YEARLY: 1, HOURLY: 1 });
  const currency = (fText(fd, "currency", 3) ?? "").toUpperCase();
  if (!amount || !from || !period || !/^[A-Z]{3}$/.test(currency)) go(userId, "err=pago#pago");
  await db.personCompensation.create({ data: { userId, amount: amount!, currency, period: period!, effectiveFrom: from!, benefitsNote: fText(fd, "benefitsNote", 500), setByName: user.name } });
  go(userId, "ok=pago#pago");
}

export async function requestAbsence(userId: string, fd: FormData) {
  const user = await requireUser();
  const self = user.id === userId;
  if (!self && !canAdminPeople(user)) go(userId, "err=permiso");
  const kind = fPick(fd, "kind", ABSENCE_KINDS), s = fDay(fd, "startsOn"), e = fDay(fd, "endsOn");
  if (!kind || !s || !e || e < s || (+e - +s) / 864e5 > 180) go(userId, "err=ausencia#ausencias");
  const existing = await db.absenceRecord.findMany({ where: { userId, status: { in: ["REQUESTED", "APPROVED"] } }, select: { status: true, startsOn: true, endsOn: true } });
  if (overlaps(existing, s!, e!)) go(userId, "err=cruza#ausencias");
  // Recorded by Administración for someone else (e.g. a sick leave): it is already their decision. Asked by the
  // person: it waits for someone else to decide.
  await db.absenceRecord.create({ data: { userId, kind: kind!, startsOn: s!, endsOn: e!, note: fText(fd, "note", 400), evidence: self ? null : fText(fd, "evidence", 200), requestedByName: user.name, ...(self ? {} : { status: "APPROVED", decidedById: user.id, decidedByName: user.name, decidedAt: new Date() }) } });
  go(userId, `ok=${self ? "ausencia-pedida" : "ausencia"}#ausencias`);
}

export async function decideAbsence(id: string, fd: FormData) {
  const user = await requireUser();
  const a = await db.absenceRecord.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!a) redirect("/administracion/personas");
  if (!canAdminPeople(user) || a!.userId === user.id) go(a!.userId, "err=ausencia-autoridad#ausencias");
  const ok = fd.get("action") === "APPROVE", note = fText(fd, "note", 300);
  if (a!.status !== "REQUESTED" || (!ok && !note)) go(a!.userId, "err=ausencia-decision#ausencias");
  await db.absenceRecord.update({ where: { id }, data: { status: ok ? "APPROVED" : "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), decisionNote: note, evidence: fText(fd, "evidence", 200) } });
  go(a!.userId, "ok=ausencia-decidida#ausencias");
}

export async function cancelAbsence(id: string) {
  const user = await requireUser();
  const a = await db.absenceRecord.findUnique({ where: { id }, select: { userId: true, status: true, endsOn: true } });
  if (!a) redirect("/administracion/personas");
  if (!(a!.userId === user.id || canAdminPeople(user))) go(a!.userId, "err=permiso");
  // An absence that already happened is a fact: it is not cancelled.
  if (!(a!.status === "REQUESTED" || a!.status === "APPROVED") || a!.endsOn < today()) go(a!.userId, "err=ausencia-decision#ausencias");
  await db.absenceRecord.update({ where: { id }, data: { status: "CANCELLED", decisionNote: `Cancelada por ${user.name}` } });
  go(a!.userId, "ok=ausencia-cancelada#ausencias");
}

/** Something the company owes the person to do the role well. Raised by the person, their management or Administración. */
export async function raiseSupportGap(userId: string, fd: FormData) {
  const user = await requireUser();
  if (!(user.id === userId || canAdminPeople(user) || canManageAll(user))) go(userId, "err=permiso");
  const kind = fPick(fd, "kind", GAP_KINDS), what = fText(fd, "what", 300), next = fText(fd, "nextMovement", 300);
  const owner = await db.user.findFirst({ where: { id: String(fd.get("ownerId") ?? ""), active: true }, select: { id: true } });
  if (!kind || !what || !next || !owner) go(userId, "err=soporte#soporte");
  await db.supportGap.create({ data: { userId, kind: kind!, what: what!, impact: fText(fd, "impact", 300), ownerId: owner!.id, nextMovement: next!, dueOn: fDay(fd, "dueOn"), raisedByName: user.name } });
  go(userId, "ok=soporte#soporte");
}

export async function updateSupportGap(id: string, fd: FormData) {
  const user = await requireUser();
  const g = await db.supportGap.findUnique({ where: { id }, select: { userId: true, ownerId: true, status: true } });
  if (!g) redirect("/administracion/personas");
  const action = String(fd.get("action") ?? ""), note = fText(fd, "note", 300);
  const involved = g!.userId === user.id || g!.ownerId === user.id || canAdminPeople(user) || canManageAll(user);
  if (!involved || g!.status === "RESOLVED" || !note) go(g!.userId, "err=soporte-nota#soporte");
  if (action === "RESOLVE") await db.supportGap.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedNote: `${note} · ${user.name}` } });
  else if (action === "ESCALATE") await db.supportGap.update({ where: { id }, data: { status: "ESCALATED", escalatedAt: new Date(), escalatedNote: `${note} · ${user.name}` } });
  else await db.supportGap.update({ where: { id }, data: { nextMovement: note!, dueOn: fDay(fd, "dueOn") } });
  go(g!.userId, "ok=soporte#soporte");
}
