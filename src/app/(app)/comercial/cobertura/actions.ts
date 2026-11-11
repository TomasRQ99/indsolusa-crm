"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { COVERAGE_MAX_DAYS, coverageWindow, handBack, handoverSnapshot } from "@/lib/coverage";

// Comercial C8b · Absence Coverage (v1.3 §59). A person arranges cover for their own planned absence; management
// can also arrange it for anyone, including emergencies. Authority is temporary and ends by itself.

const go = (path: string, qs: string): never => { refreshApp(); redirect(`${path}?${qs}`); };
const txt = (fd: FormData, k: string, max = 600) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null; };

export async function createCoverage(fd: FormData) {
  const user = await requireUser();
  const manage = canManageAll(user);
  const originalUserId = manage ? txt(fd, "originalUserId", 40) ?? user.id : user.id;
  const actingUserId = txt(fd, "actingUserId", 40);
  const P = "/comercial/cobertura";
  if (!actingUserId || actingUserId === originalUserId) go(P, "err=persona");
  const [orig, acting] = await Promise.all([
    db.user.findUnique({ where: { id: originalUserId }, select: { id: true, active: true } }),
    db.user.findUnique({ where: { id: actingUserId! }, select: { id: true, active: true } }),
  ]);
  if (!orig || !acting?.active) go(P, "err=persona");
  const emergency = fd.get("kind") === "EMERGENCY";
  if (emergency && !manage) go(P, "err=permiso");
  const from = emergency ? today() : dayOf(fd, "from");
  const to = dayOf(fd, "to");
  if (!from || !to || to < from) go(P, "err=fechas");
  if (to! < today()) go(P, "err=pasado");
  if ((+to! - +from!) / 864e5 + 1 > COVERAGE_MAX_DAYS) go(P, "err=largo");
  const reason = txt(fd, "reason", 300);
  if (!reason) go(P, "err=motivo");
  const { startsAt, endsAt } = coverageWindow(from!, to!);
  const handover = await handoverSnapshot(originalUserId, endsAt);
  const c = await db.coverageAssignment.create({ data: {
    originalUserId, actingUserId: actingUserId!, startsAt, endsAt, kind: emergency ? "EMERGENCY" : "PLANNED", reason: reason!, instructions: txt(fd, "instructions", 1500), scopeNote: txt(fd, "scopeNote", 300),
    handover: handover as unknown as Prisma.InputJsonValue, createdByName: user.name,
  } });
  go(`${P}/${c.id}`, "ok=creada");
}

/** End a coverage early: management, the absent person or the person covering. */
export async function revokeCoverage(id: string) {
  const user = await requireUser();
  const c = await db.coverageAssignment.findUnique({ where: { id }, select: { id: true, originalUserId: true, actingUserId: true, revokedAt: true, endsAt: true } });
  if (!c) go("/comercial/cobertura", "err=cobertura");
  if (!(canManageAll(user) || user.id === c!.originalUserId || user.id === c!.actingUserId)) go(`/comercial/cobertura/${id}`, "err=permiso");
  if (!c!.revokedAt && c!.endsAt > new Date()) await db.coverageAssignment.update({ where: { id }, data: { revokedAt: new Date(), revokedByName: user.name } });
  go(`/comercial/cobertura/${id}`, "ok=terminada");
}

/** Módulo 16 §8, AC5 · the owner is back: they confirm they read what happened, and the to-dos opened for whoever
 *  covered go back to them. Ownership of Journeys and customers never moved, so there is nothing else to restore. */
export async function returnOwnership(id: string, fd: FormData) {
  const user = await requireUser();
  const P = `/comercial/cobertura/${id}`;
  const c = await db.coverageAssignment.findUnique({ where: { id }, select: { id: true, originalUserId: true, actingUserId: true, startsAt: true, endsAt: true, revokedAt: true, returnedAt: true } });
  if (!c) go("/comercial/cobertura", "err=cobertura");
  if (!(canManageAll(user) || user.id === c!.originalUserId)) go(P, "err=regreso-permiso#regreso");
  if (!(c!.revokedAt || c!.endsAt <= new Date())) go(P, "err=regreso-activa#regreso");
  if (c!.returnedAt) go(P, "ok=devuelto#regreso");
  const tasks = fd.get("keep") === "1" ? [] : await handBack(c!);
  await db.$transaction([
    ...(tasks.length ? [db.task.updateMany({ where: { id: { in: tasks.map((x) => x.id) } }, data: { assigneeId: c!.originalUserId } })] : []),
    db.coverageAssignment.update({ where: { id }, data: { returnedAt: new Date(), returnedByName: user.name, returnNote: `${tasks.length} pendiente(s) devuelto(s)${txt(fd, "note", 300) ? ` · ${txt(fd, "note", 300)}` : ""}` } }),
  ]);
  go(P, "ok=devuelto#regreso");
}

/** Relationship backup for one customer: who can step in when the owner is away. */
export async function setBackup(accountId: string, fd: FormData) {
  const user = await requireUser();
  const a = await db.account.findUnique({ where: { id: accountId }, select: { id: true, ownerId: true } });
  if (!a) go("/comercial/cobertura", "err=cliente");
  if (!canEdit(user, a!.ownerId)) go("/comercial/cobertura", "err=permiso");
  const backupUserId = txt(fd, "backupUserId", 40);
  if (!backupUserId) {
    await db.relationshipBackup.deleteMany({ where: { accountId } });
  } else {
    if (backupUserId === a!.ownerId) go("/comercial/cobertura", "err=mismo");
    await db.relationshipBackup.upsert({ where: { accountId }, create: { accountId, backupUserId, note: txt(fd, "note", 300), setByName: user.name }, update: { backupUserId, note: txt(fd, "note", 300), setByName: user.name } });
  }
  go("/comercial/cobertura", `ok=respaldo#r-${accountId}`);
}
