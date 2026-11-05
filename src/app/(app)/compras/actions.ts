"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays, nextCode, today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { buildSpo, isDomestic, matchSupplier, milestones, purchaseRequirement, spoInclude, spoTotal } from "@/lib/purchasing";

const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const txt = (fd: FormData, k: string, max = 300) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const back = (id: string, qs: string): never => {
  refreshApp();
  redirect(`/compras/${id}?${qs}`);
};

async function loadSpo(id: string) {
  const user = await requireUser();
  const spo = await db.supplierPO.findUniqueOrThrow({ where: { id }, include: spoInclude });
  assertCanEdit(user, spo.deal.ownerId);
  return { user, spo };
}

/** One click: the Supplier PO is prepared from the Supply Basis of the quote + the Purchase Requirement. */
export async function prepareSpo(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: spoInclude.deal.include });
  assertCanEdit(user, deal.ownerId);
  const suppliers = await db.supplier.findMany();
  const supplier = matchSupplier(purchaseRequirement(deal).supply, suppliers);
  if (!supplier) redirect(`/deals/${dealId}?tab=execute&ok=sin-proveedor`);
  const pr = purchaseRequirement(deal, isDomestic(supplier));
  const saleTotal = pr.lines.reduce((s, l) => s + l.sale, 0);
  const target = pr.targetCost ?? 0;
  const lines = pr.lines.map((l, n) => {
    const share = saleTotal > 0 ? l.sale / saleTotal : 1 / pr.lines.length;
    return { position: n, qty: l.qty, code: l.code, description: l.description, unitCost: Math.round(((target * share) / l.qty) * 100) / 100 };
  });
  const total = spoTotal(lines);
  const shipBy = pr.atDestinationBy && supplier!.transitDays != null ? addDays(pr.atDestinationBy, -supplier!.transitDays) : pr.atDestinationBy;
  const plan = milestones(total, supplier!.advancePct, today(), shipBy);
  const spo = await db.$transaction(async (tx) => {
    const code = await nextCode("SPO", "supplierPO", tx);
    return tx.supplierPO.create({
      data: {
        code, dealId, supplierId: supplier!.id, amount: total, currency: pr.currency,
        terms: supplier!.paymentTerms, proformaRef: pr.costSource, shipBy,
        lines: { create: lines },
        requirements: { create: plan.map((m, n) => ({ ...m, position: n })) },
      },
    });
  });
  back(spo.id, "ok=preparada");
}

/** Draft only: the few things a person may still adjust before releasing. */
export async function saveDraft(id: string, fd: FormData) {
  const { spo } = await loadSpo(id);
  if (spo.releasedAt) back(id, "err=liberada");
  const shipBy = dayOf(fd.get("shipBy")) ?? spo.shipBy;
  const lines = spo.lines.map((l, n) => ({ id: l.id, unitCost: Number(String(fd.get(`cost_${n}`) ?? l.unitCost).replace(",", ".")) || 0, qty: l.qty }));
  const total = spoTotal(lines);
  const plan = milestones(total, spo.supplier.advancePct, today(), shipBy);
  await db.$transaction([
    ...lines.map((l) => db.supplierPOLine.update({ where: { id: l.id }, data: { unitCost: l.unitCost } })),
    db.paymentRequirement.deleteMany({ where: { supplierPoId: id, payments: { none: {} } } }),
    db.supplierPO.update({
      where: { id },
      data: {
        shipBy, amount: total, costNote: txt(fd, "costNote"), proformaRef: txt(fd, "proformaRef", 120), incoterm: txt(fd, "incoterm", 80),
        requirements: { create: (await db.paymentRequirement.count({ where: { supplierPoId: id, payments: { some: {} } } })) ? [] : plan.map((m, n) => ({ ...m, position: n })) },
      },
    }),
  ]);
  back(id, "ok=guardada");
}

/** COMMAND: release the Supplier PO. Preconditions re-checked here; released terms are no longer editable. */
export async function releaseSpo(id: string) {
  const { user, spo } = await loadSpo(id);
  if (spo.releasedAt) back(id, "ok=ya-liberada");
  const B = buildSpo(spo, makeI18n("ES"));
  if (B.blocking.length) back(id, "err=precondicion");
  const now = new Date();
  const plan = milestones(B.total, spo.supplier.advancePct, today(), spo.shipBy);
  await db.$transaction(async (tx) => {
    const n = await tx.supplierPO.updateMany({ where: { id, releasedAt: null }, data: { releasedAt: now, releasedByName: user.name, amount: B.total } });
    if (n.count === 0) return;
    // Milestone dates count from the release day.
    for (const r of spo.requirements) {
      const m = plan[r.position];
      if (m && r.payments.length === 0) await tx.paymentRequirement.update({ where: { id: r.id }, data: { dueBy: m.dueBy, amount: m.amount } });
    }
    await tx.activity.create({ data: { type: "NOTE", subject: `Supplier PO ${spo.code} v${spo.version} liberada a ${spo.supplier.name} · ${spo.currency} ${B.total.toFixed(2)}`.slice(0, 200), userId: user.id, accountId: spo.deal.accountId, dealId: spo.dealId, phase: "execute", source: "Release Supplier PO" } });
  });
  back(id, "ok=liberada");
}

/** A released PO is not edited: a change creates the next version and keeps the previous one in its history. */
export async function newVersion(id: string, fd: FormData) {
  const { user, spo } = await loadSpo(id);
  if (!spo.releasedAt) back(id, "err=borrador");
  const reason = txt(fd, "reason");
  if (!reason) back(id, "err=motivo");
  const snap = { version: spo.version, releasedAt: spo.releasedAt, releasedBy: spo.releasedByName, amount: Number(spo.amount), shipBy: spo.shipBy, lines: spo.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitCost: Number(l.unitCost) })), reason };
  const history = [...(((spo.history as unknown[]) ?? []) as object[]), snap];
  await db.supplierPO.update({ where: { id }, data: { version: spo.version + 1, releasedAt: null, releasedByName: null, history: history as Prisma.InputJsonValue } });
  await db.activity.create({ data: { type: "NOTE", subject: `Supplier PO ${spo.code}: versión ${spo.version + 1} en preparación · ${reason}`.slice(0, 200), userId: user.id, accountId: spo.deal.accountId, dealId: spo.dealId, phase: "execute", source: user.name } });
  back(id, "ok=version");
}

/**
 * Payment Request for one milestone, with almost no typing: amount, reason, due date and bank data come
 * from the requirement, the Journey and the verified profile. Only if the supplier's document shows other
 * bank data does the person copy it — and that triggers the hard stop.
 */
export async function requestPayment(requirementId: string, fd: FormData) {
  const user = await requireUser();
  const r = await db.paymentRequirement.findUniqueOrThrow({ where: { id: requirementId }, include: { supplierPo: { include: { supplier: true, deal: { include: { account: true } } } }, payments: true } });
  const spo = r.supplierPo;
  assertCanEdit(user, spo.deal.ownerId);
  if (!spo.releasedAt) back(spo.id, "err=no-liberada");
  if (r.payments.length) redirect(`/administracion/pagos-proveedores/${r.payments[r.payments.length - 1].id}`);
  const s = spo.supplier;
  const other = fd.get("otherBank") === "1";
  const promise = spo.deal.promisedDate ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format(spo.deal.promisedDate) : null;
  const reason = `${r.label}: ${s.name.replace(/ \(ejemplo\)$/, "")} — ${r.trigger.toLowerCase()}. Sin este pago no avanza ${spo.code} y se arriesga la promesa a ${spo.deal.account.name.replace(/ \(ejemplo\)$/, "")}${spo.deal.promiseText ? ` (${spo.deal.promiseText}${promise ? ` · ${promise}` : ""})` : ""}.`;
  const amountUsd = spo.currency === "USD" ? Number(r.amount) : Number(String(fd.get("amountUsd") ?? "").replace(",", ".")) || null;
  const p = await db.supplierPayment.create({
    data: {
      supplierPoId: spo.id, requirementId: r.id, amount: r.amount, currency: spo.currency, amountUsd,
      reason: reason.slice(0, 500), dueBy: r.dueBy, requestedById: user.id,
      docSource: txt(fd, "docSource", 120) ?? spo.proformaRef,
      docBeneficiary: other ? txt(fd, "docBeneficiary", 120) : s.bankBeneficiary,
      docBankName: other ? txt(fd, "docBankName", 120) : s.bankName,
      docAccount: other ? txt(fd, "docAccount", 60) : s.bankAccount,
      docSwift: other ? txt(fd, "docSwift", 20) : s.bankSwift,
    },
  });
  refreshApp();
  redirect(`/administracion/pagos-proveedores/${p.id}?ok=solicitado`);
}
