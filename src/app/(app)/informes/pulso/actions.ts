"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { periodOf, validPeriod } from "@/lib/goal-rules";
import { computePulse } from "@/lib/pulse";

// Módulo 13 §24 · closing a month of the pulse. Only a month that has already ended can be closed; reopening needs
// Gerencia and a reason, and the earlier close is kept.

const go = (period: string, qs: string): never => { refreshApp(); redirect(`/informes/pulso?mes=${period}&${qs}`); };

export async function closePulse(fd: FormData) {
  const user = await requireUser();
  const period = String(fd.get("period") ?? "");
  if (!validPeriod(period)) redirect("/informes/pulso");
  if (!isGerencia(user)) go(period, "err=permiso");
  if (period >= periodOf(new Date())) go(period, "err=abierto");
  const last = await db.pulseSnapshot.findFirst({ where: { period }, orderBy: { version: "desc" }, select: { version: true, reopenedAt: true } });
  if (last && !last.reopenedAt) go(period, "err=ya");
  const data = await computePulse(period);
  await db.pulseSnapshot.create({ data: { period, version: (last?.version ?? 0) + 1, data: data as unknown as Prisma.InputJsonValue, closedByName: user.name } });
  go(period, "ok=cerrado");
}

export async function reopenPulse(fd: FormData) {
  const user = await requireUser();
  const period = String(fd.get("period") ?? "");
  if (!validPeriod(period)) redirect("/informes/pulso");
  if (!isGerencia(user)) go(period, "err=permiso");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300);
  if (!reason) go(period, "err=motivo");
  const n = await db.pulseSnapshot.updateMany({ where: { period, reopenedAt: null }, data: { reopenedAt: new Date(), reopenedByName: user.name, reopenReason: reason } });
  go(period, n.count ? "ok=reabierto" : "err=sin-cierre");
}
