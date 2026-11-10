"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia, isMoneyRole } from "@/lib/permissions";
import { parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { computeCommissions } from "@/lib/commission";
import { today } from "@/lib/domain";

/** Management approves every earned half of one person. Nobody approves their own. */
export async function approveEarned(userId: string) {
  const user = await requireUser();
  if (!canManageAll(user)) throw new Error("Solo Gerencia / Management only.");
  if (user.id === userId) throw new Error("Nadie aprueba sus propias comisiones / Nobody approves their own commissions.");
  const { rows } = await computeCommissions({ userId });
  const data = rows.flatMap((r) =>
    r.invoiceId
      ? ([
          ["SALE", r.saleHalf],
          ["COLLECTION", r.collectionHalf],
        ] as const)
          .filter(([, h]) => h.state === "EARNED")
          .map(([half, h]) => ({
            invoiceId: r.invoiceId!,
            half,
            userId: r.ownerId,
            amount: h.amount,
            calculation: `v${r.policyVersion ?? "?"} · ${h.calc}`,
            approvedById: user.id,
          }))
      : [],
  );
  if (data.length) await db.commissionEntry.createMany({ data, skipDuplicates: true });
  refreshApp();
}

export async function markCommissionsPaid(userId: string, formData: FormData) {
  const user = await requireUser();
  if (!isGerencia(user) && !isMoneyRole(user.role)) throw new Error("Solo Gerencia o Finanzas / Management or Finance only.");
  const { payrollRef } = parseForm(z.object({ payrollRef: requiredText }), formData);
  await db.commissionEntry.updateMany({ where: { userId, paidAt: null }, data: { paidAt: today(), payrollRef } });
  refreshApp();
}

export async function requestCommissionReview(formData: FormData) {
  const user = await requireUser();
  const { note } = parseForm(z.object({ note: requiredText }), formData);
  const managers = await db.user.findMany({ where: { active: true, role: { in: ["GERENCIA", "DIRECTOR_COMERCIAL"] }, id: { not: user.id } }, select: { id: true } });
  const assignee = managers[0]?.id ?? user.id;
  await db.task.create({
    data: { title: `Revisar cálculo de comisión de ${user.name}: ${note}`.slice(0, 200), assigneeId: assignee, dueDate: today() },
  });
  refreshApp();
}

/** A SOLU product defect reported by anyone (re-entry, unneeded warning, missing warning). */
export async function reportProductSignal(formData: FormData) {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (!["REENTRY", "ATTENTION_NOISE", "ATTENTION_MISSED"].includes(kind) || !note) return false;
  const screen = String(formData.get("screen") ?? "").trim().slice(0, 120) || null;
  await db.productSignal.create({ data: { kind, note, screen, reportedByName: user.name } });
  refreshApp();
  return true;
}

const tierLine =/^\s*(\d+(?:[.,]\d+)?)\s*[:=→>-]+\s*(\d+(?:[.,]\d+)?)\s*$/;

/** New policy version. Old versions stay untouched; each Deal uses the version in force on its PO date. */
export async function createPolicyVersion(formData: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) throw new Error("Solo Gerencia / Management only.");
  const data = parseForm(
    z.object({
      effectiveFrom: z.string().min(1).transform((v) => new Date(v)),
      tiers: requiredText,
      newClientBonus: z.coerce.number().min(0).max(20),
      salePercent: z.coerce.number().int().min(0).max(100),
      lossDays: z.coerce.number().int().min(1).max(720),
      approvedBy: requiredText,
      notes: z.string().optional(),
    }),
    formData,
  );
  const tiers = data.tiers
    .split(/[;\n]/)
    .filter((l) => l.trim())
    .map((l) => {
      const m = l.match(tierLine);
      if (!m) throw new Error(`Tramo no válido / Invalid tier: "${l}" (use 12:8)`);
      return { min: Number(m[1].replace(",", ".")), rate: Number(m[2].replace(",", ".")) };
    });
  const last = await db.commissionPolicy.findFirst({ orderBy: { version: "desc" }, select: { version: true } });
  await db.commissionPolicy.create({
    data: { ...data, tiers, version: (last?.version ?? 0) + 1, notes: data.notes || null },
  });
  refreshApp();
}
