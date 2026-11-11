"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia, isMoneyRole } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { computeCommissions } from "@/lib/commission";
import { settlementPreview, validPeriod } from "@/lib/settlement";

// Módulo 12 R4 · monthly settlement (§21). Approving a run freezes what was payable and how it was calculated.
// Approving twice creates nothing twice: once a half has its entry it is no longer payable.

const go = (qs: string): never => { refreshApp(); redirect(`/gerencia/liquidacion?${qs}`); };

export async function approveRun(fd: FormData) {
  const user = await requireUser();
  if (!canManageAll(user)) go("err=permiso");
  const period = String(fd.get("period") ?? "");
  if (!validPeriod(period)) go("err=periodo");
  const { rows } = await computeCommissions();
  const p = settlementPreview(rows, user.id);
  if (!p.lines.length) go(`mes=${period}&err=nada`);
  const run = await db.$transaction(async (tx) => {
    const last = await tx.commissionSettlementRun.findFirst({ where: { period }, orderBy: { version: "desc" }, select: { version: true } });
    const run = await tx.commissionSettlementRun.create({ data: { period, version: (last?.version ?? 0) + 1, lines: [] as unknown as Prisma.InputJsonValue, total: 0, approvedByName: user.name } });
    const done: typeof p.lines = [];
    for (const l of p.lines) {
      // The unique key (invoice, half, person, part) is the idempotency key: a line that already has its entry is skipped.
      const exists = await tx.commissionEntry.findUnique({ where: { invoiceId_half_userId_seq: { invoiceId: l.invoiceId, half: l.half, userId: l.userId, seq: l.seq } }, select: { id: true } });
      if (exists) continue;
      await tx.commissionEntry.create({ data: { invoiceId: l.invoiceId, half: l.half, userId: l.userId, seq: l.seq, amount: l.amount, calculation: `v${l.policyVersion ?? "?"} · ${l.calc}`, approvedById: user.id, runId: run.id } });
      done.push(l);
    }
    return tx.commissionSettlementRun.update({ where: { id: run.id }, data: { lines: done as unknown as Prisma.InputJsonValue, total: Math.round(done.reduce((s, l) => s + l.amount, 0) * 100) / 100 } });
  });
  go(`mes=${period}&ok=aprobada&run=${run.id}`);
}

/** Payroll confirms the payment of a run, with its reference. Paid lines never change afterwards. */
export async function payRun(runId: string, fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user) && !isMoneyRole(user.role)) go("err=permiso-pago");
  const ref = String(fd.get("payrollRef") ?? "").trim().slice(0, 120);
  const run = await db.commissionSettlementRun.findUnique({ where: { id: runId }, select: { status: true, period: true } });
  if (!run || run.status !== "APPROVED") go("err=corrida");
  if (!ref) go(`mes=${run!.period}&err=referencia`);
  await db.$transaction([
    db.commissionEntry.updateMany({ where: { runId, paidAt: null }, data: { paidAt: today(), payrollRef: ref } }),
    db.commissionSettlementRun.update({ where: { id: runId }, data: { status: "PAID", paidAt: new Date(), paidByName: user.name, payrollRef: ref } }),
  ]);
  go(`mes=${run!.period}&ok=pagada`);
}
