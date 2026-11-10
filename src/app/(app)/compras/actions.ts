"use server";

import { redirect } from "next/navigation";
import { SAVING_KINDS, compareConfirmation, materialDiffs, readScope, savingOf } from "@/lib/buying-rules";
import { ensurePrForSpo, readinessForSpo } from "@/lib/pr";
import { fullReadiness } from "@/lib/pr-auth";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays, nextCode, today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { money2, mulMoney, sumMoney } from "@/lib/money";
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
  assertCanEditOps(user, spo.deal.ownerId);
  return { user, spo };
}

/** One click: the Supplier PO is prepared from the Supply Basis of the quote + the Purchase Requirement. */
export async function prepareSpo(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: spoInclude.deal.include });
  assertCanEditOps(user, deal.ownerId);
  const suppliers = await db.supplier.findMany();
  const supplier = matchSupplier(purchaseRequirement(deal).supply, suppliers);
  if (!supplier) redirect(`/deals/${dealId}?tab=execute&ok=sin-proveedor`);
  const pr = purchaseRequirement(deal, isDomestic(supplier));
  const saleTotal = sumMoney(pr.lines.map((l) => l.sale));
  const target = pr.targetCost ?? 0;
  const lines = pr.lines.map((l, n) => {
    const share = saleTotal > 0 ? l.sale / saleTotal : 1 / pr.lines.length;
    return { position: n, qty: l.qty, code: l.code, description: l.description, unitCost: mulMoney(target, share / l.qty) };
  });
  const total = spoTotal(lines);
  const shipBy = pr.atDestinationBy && supplier!.transitDays != null ? addDays(pr.atDestinationBy, -supplier!.transitDays) : pr.atDestinationBy;
  const plan = milestones(total, supplier!.advancePct, today(), shipBy);
  const spo = await db.$transaction(async (tx) => {
    const code = await nextCode("SPO", "supplierPO", tx);
    const made = await tx.supplierPO.create({
      data: {
        code, dealId, supplierId: supplier!.id, amount: total, currency: pr.currency,
        terms: supplier!.paymentTerms, proformaRef: pr.costSource, shipBy,
        // O-10: the supplier's first quote is the baseline every saving is measured against.
        firstQuoteAmount: total, firstQuoteRef: pr.costSource,
        lines: { create: lines },
        requirements: { create: plan.map((m, n) => ({ ...m, position: n })) },
      },
    });
    // O1: every customer purchase has its Purchase Requirement, derived here (100 % assigned to this Journey).
    await ensurePrForSpo(tx, { id: made.id, dealId, supplierId: supplier!.id, currency: pr.currency, shipBy, lines }, user, deal.sellerKey);
    return made;
  });
  back(spo.id, "ok=preparada");
}

/** Draft only: the few things a person may still adjust before releasing. */
export async function saveDraft(id: string, fd: FormData) {
  const { spo } = await loadSpo(id);
  if (spo.releasedAt) back(id, "err=liberada");
  const shipBy = dayOf(fd.get("shipBy")) ?? spo.shipBy;
  const lines = spo.lines.map((l, n) => ({ id: l.id, unitCost: Math.max(0, money2(String(fd.get(`cost_${n}`) ?? l.unitCost).trim().replace(",", "."))), qty: l.qty }));
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
  // O1: unassigned quantity (inventory exposure) and other open points of the requirement stop the release.
  const ready = await readinessForSpo(id);
  if (ready && (await fullReadiness(ready.pr)).readiness.result === "NEEDS_RESOLUTION") back(id, "err=requerimiento");
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
  const snap = { version: spo.version, releasedAt: spo.releasedAt, releasedBy: spo.releasedByName, amount: money2(spo.amount), shipBy: spo.shipBy, lines: spo.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitCost: money2(l.unitCost) })), reason };
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
  assertCanEditOps(user, spo.deal.ownerId);
  if (!spo.releasedAt) back(spo.id, "err=no-liberada");
  if (r.payments.length) redirect(`/administracion/pagos-proveedores/${r.payments[r.payments.length - 1].id}`);
  const s = spo.supplier;
  const other = fd.get("otherBank") === "1";
  const promise = spo.deal.promisedDate ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" }).format(spo.deal.promisedDate) : null;
  const reason = `${r.label}: ${s.name.replace(/ \(ejemplo\)$/, "")} — ${r.trigger.toLowerCase()}. Sin este pago no avanza ${spo.code} y se arriesga la promesa a ${spo.deal.account.name.replace(/ \(ejemplo\)$/, "")}${spo.deal.promiseText ? ` (${spo.deal.promiseText}${promise ? ` · ${promise}` : ""})` : ""}.`;
  const amountUsd = spo.currency === "USD" ? money2(r.amount) : money2(String(fd.get("amountUsd") ?? "").trim().replace(",", ".")) || null;
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

// ---------- O3 · order facts, supplier confirmation and savings ----------

const o3day = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null; };
const o3num = (fd: FormData, k: string) => { const n = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null; };

/** §14.2: a released order is not a sent order, and a sent order is not an acknowledged one. */
export async function markOrderFact(id: string, fact: "sent" | "ack", fd: FormData) {
  const { user, spo } = await loadSpo(id);
  if (!spo.releasedAt) back(id, "err=borrador#hechos");
  const note = txt(fd, "note", 200);
  if (fact === "sent") {
    if (!note) back(id, "err=como#hechos");
    await db.supplierPO.update({ where: { id }, data: { sentAt: o3day(fd, "at") ?? today(), sentHow: note, sentByName: user.name } });
  } else {
    if (!spo.sentAt) back(id, "err=sin-enviar#hechos");
    await db.supplierPO.update({ where: { id }, data: { ackAt: o3day(fd, "at") ?? today(), ackNote: note } });
  }
  back(id, "ok=hecho#hechos");
}

/** The baseline for savings, while the order is still a draft. */
export async function setFirstQuote(id: string, fd: FormData) {
  const { spo } = await loadSpo(id);
  if (spo.releasedAt) back(id, "err=liberada");
  const amount = o3num(fd, "firstQuoteAmount");
  if (amount == null || amount <= 0) back(id, "err=cotizacion#antes");
  await db.supplierPO.update({ where: { id }, data: { firstQuoteAmount: money2(amount!), firstQuoteRef: txt(fd, "firstQuoteRef", 120), negotiationNote: txt(fd, "negotiationNote", 300) } });
  back(id, "ok=guardado#antes");
}

/** Record what the supplier confirmed and compare it with the order. No material difference → confirmed. */
export async function recordConfirmation(id: string, fd: FormData) {
  const { user, spo } = await loadSpo(id);
  if (!spo.releasedAt) back(id, "err=borrador#confirmacion");
  const source = txt(fd, "source", 200);
  if (!source) back(id, "err=fuente#confirmacion");
  const receivedAt = o3day(fd, "receivedAt") ?? today();
  const lines = spo.lines.map((l) => ({ position: l.position, qty: Math.round(o3num(fd, `cqty_${l.position}`) ?? l.qty), unitPrice: money2(o3num(fd, `cprice_${l.position}`) ?? Number(l.unitCost)) }));
  const n = Math.min(Number(fd.get("scopeCount") ?? 0) || 0, 30);
  const scope = Array.from({ length: n }, (_, k) => ({ component: txt(fd, `scomp_${k}`, 160) ?? "", state: String(fd.get(`sstate_${k}`) ?? "NOT_STATED") })).filter((x) => x.component);
  const conf = { currency: txt(fd, "currency", 3)?.toUpperCase() ?? null, incoterm: txt(fd, "incoterm", 80), paymentTerms: txt(fd, "paymentTerms", 160), readyDate: o3day(fd, "readyDate"), packaging: txt(fd, "packaging", 200), documents: txt(fd, "documents", 300), warranty: txt(fd, "warranty", 200), newConditions: txt(fd, "newConditions", 300), lines, scope: readScope(scope) };
  const diffs = compareConfirmation(spo, conf, { promiseDependsOnShipBy: !!spo.deal.promisedDate });
  const material = materialDiffs(diffs).length > 0;
  await db.$transaction(async (tx) => {
    await tx.supplierConfirmation.create({ data: {
      supplierPoId: id, poVersion: spo.version, receivedAt, source: source!, lines, scope, diffs: diffs as unknown as Prisma.InputJsonValue,
      currency: conf.currency, incoterm: conf.incoterm, paymentTerms: conf.paymentTerms, readyDate: conf.readyDate, packaging: conf.packaging, documents: conf.documents, warranty: conf.warranty, newConditions: conf.newConditions,
      recordedByName: user.name, ...(material ? {} : { resolvedAt: new Date(), resolvedByName: user.name, resolution: "Sin diferencias materiales" }),
    } });
    if (!material) await tx.supplierPO.update({ where: { id }, data: { confirmedAt: receivedAt, ...(conf.readyDate ? { eta: spo.eta ?? null } : {}) } });
    await tx.activity.create({ data: { type: "NOTE", subject: `Confirmación del proveedor de ${spo.code}: ${material ? `${materialDiffs(diffs).length} diferencia(s) material(es) por resolver` : "coincide con la orden"}`.slice(0, 200), userId: user.id, accountId: spo.deal.accountId, dealId: spo.dealId, phase: "execute", source: source! } });
  });
  back(id, material ? "ok=conf-diferencias#confirmacion" : "ok=conf-coincide#confirmacion");
}

/** Material differences are resolved in writing (accepted, renegotiated, new order version…) before it counts as confirmed. */
export async function resolveConfirmation(confId: string, fd: FormData) {
  const c = await db.supplierConfirmation.findUnique({ where: { id: confId }, select: { id: true, supplierPoId: true, receivedAt: true, resolvedAt: true } });
  if (!c) redirect("/compras");
  const { user } = await loadSpo(c!.supplierPoId);
  const resolution = txt(fd, "resolution", 400);
  if (!resolution) back(c!.supplierPoId, "err=resolucion#confirmacion");
  if (!c!.resolvedAt) await db.$transaction([
    db.supplierConfirmation.update({ where: { id: confId }, data: { resolution, resolvedAt: new Date(), resolvedByName: user.name } }),
    db.supplierPO.update({ where: { id: c!.supplierPoId }, data: { confirmedAt: c!.receivedAt } }),
  ]);
  back(c!.supplierPoId, "ok=conf-resuelta#confirmacion");
}

/** Savings Ledger: a verifiable improvement with its evidence. Supplier savings are measured against the first quote. */
export async function addSaving(id: string, fd: FormData) {
  const { user, spo } = await loadSpo(id);
  const kind = String(fd.get("kind") ?? "");
  const evidence = txt(fd, "evidence", 300);
  const fin = o3num(fd, "finalAmount");
  const supplier = kind === "SUPPLIER_SAVINGS";
  const baseline = supplier ? (spo.firstQuoteAmount != null ? Number(spo.firstQuoteAmount) : null) : o3num(fd, "baselineAmount");
  if (!SAVING_KINDS[kind] || !evidence || fin == null || baseline == null) back(id, "err=ahorro#ahorros");
  const s = savingOf(baseline!, fin!, o3num(fd, "passedToCustomer") ?? 0);
  if (!s.valid) back(id, "err=ahorro-monto#ahorros");
  await db.savingsEntry.create({ data: {
    kind, dealId: spo.dealId, supplierPoId: id, supplierId: spo.supplierId, baselineAmount: money2(baseline!), finalAmount: money2(fin!), savingsAmount: s.gross, passedToCustomer: s.passed, currency: spo.currency,
    baselineSource: supplier ? `Primera cotización del proveedor${spo.firstQuoteRef ? ` · ${spo.firstQuoteRef}` : ""}` : txt(fd, "baselineSource", 160) ?? "Sin fuente indicada",
    evidence: evidence!, note: txt(fd, "note", 300), responsibleId: user.id, responsibleName: user.name, at: o3day(fd, "at") ?? today(),
  } });
  back(id, "ok=ahorro#ahorros");
}