"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance, isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { currentNumbers } from "@/lib/rentabilidad";
import { cleanNumbers, diffNumbers, touches, type Numbers } from "@/lib/rentabilidad-config";

// Módulo 12 · changing the profitability numbers. Finanzas, Administración or Gerencia propose; only Gerencia
// approves. Approval writes NEW versions (commission policy, cost of money): what was already calculated stays.

const go = (qs: string): never => { refreshApp(); redirect(`/profile/rentabilidad?${qs}`); };

export async function proposeChange(fd: FormData) {
  const user = await requireUser();
  if (!canFinance(user)) go("err=permiso");
  const next = cleanNumbers(Object.fromEntries(fd.entries()));
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 400);
  const d = String(fd.get("effectiveFrom") ?? "");
  const effectiveFrom = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : null;
  if (!next || !reason || !effectiveFrom) go("err=datos");
  // A change never reaches back: it applies from today or later.
  if (effectiveFrom! < today()) go("err=fecha");
  if (await db.policyChangeRequest.count({ where: { status: "PENDING" } })) go("err=pendiente");
  const cur = await currentNumbers();
  if (!diffNumbers(cur.numbers, next!).length) go("err=igual");
  await db.policyChangeRequest.create({ data: { current: cur.numbers as unknown as Prisma.InputJsonValue, proposed: next as unknown as Prisma.InputJsonValue, effectiveFrom: effectiveFrom!, reason, requestedById: user.id, requestedByName: user.name } });
  go("ok=propuesta");
}

export async function decideChange(id: string, fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=gerencia");
  const r = await db.policyChangeRequest.findUnique({ where: { id } });
  if (!r || r.status !== "PENDING") go("err=cerrada");
  const note = String(fd.get("note") ?? "").trim().slice(0, 300) || null;
  if (fd.get("decision") !== "APPROVE") {
    if (!note) go("err=nota");
    await db.policyChangeRequest.update({ where: { id }, data: { status: "REJECTED", decidedByName: user.name, decidedAt: new Date(), decisionNote: note } });
    go("ok=rechazada");
  }
  const next = r!.proposed as unknown as Numbers;
  // Compared with the numbers in force now, not with those of the day it was proposed.
  const cur = await currentNumbers();
  const t = touches(diffNumbers(cur.numbers, next));
  await db.$transaction(async (tx) => {
    const n = await tx.policyChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", decidedByName: user.name, decidedAt: new Date(), decisionNote: note } });
    if (!n.count) return;
    if (t.commission) {
      const last = await tx.commissionPolicy.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
      await tx.commissionPolicy.create({ data: { version: (last?.version ?? 0) + 1, effectiveFrom: r!.effectiveFrom, tiers: [{ min: 0, rate: next.ratePct }], newClientBonus: next.newClientBonus, salePercent: next.salePercent, lossDays: 0, commercialPct: next.commercialPct, operationalPct: 100 - next.commercialPct, proportionalCollection: next.proportional, approvedBy: user.name, notes: `Propuesta de ${r!.requestedByName}: ${r!.reason}`.slice(0, 400) } });
    }
    if (t.finance) {
      const last = await tx.marketSetting.findFirst({ where: { key: "financeRate" }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.marketSetting.create({ data: { key: "financeRate", version: (last?.version ?? 0) + 1, value: { annualPct: next.financeAnnualPct ?? 0, note: `Propuesta de ${r!.requestedByName}: ${r!.reason}`.slice(0, 300) }, updatedByName: user.name } });
    }
  });
  go("ok=aprobada");
}
