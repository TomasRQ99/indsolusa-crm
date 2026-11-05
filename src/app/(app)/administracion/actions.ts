"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit, canManageAll } from "@/lib/permissions";
import { optionalDate, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { addDays, bankDiscrepancies, esagra, invoiceBlockers, invoiceCash, nextDocNumber, paymentState, today } from "@/lib/domain";

const money = z.coerce.number().min(0).max(1e12);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter currency code").default("USD");

async function requireManager() {
  const user = await requireUser();
  if (!canManageAll(user)) throw new Error("Solo Gerencia o Administración / Management or admin only.");
  return user;
}

// ---------- Invoices ----------

/** Issue the invoice for a delivery. Only possible when nothing blocks it. Idempotent per delivery. */
export async function issueInvoice(deliveryId: string) {
  const user = await requireUser();
  const d = await db.delivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: {
      invoice: { select: { id: true } },
      lines: { include: { dealItem: { select: { unitPrice: true } } } },
      deal: { include: { account: true, invoices: { select: { amount: true } } } },
    },
  });
  assertCanEdit(user, d.deal.ownerId);
  if (d.invoice) redirect(`/administracion/cobrar?f=${d.invoice.id}`);
  const blockers = invoiceBlockers(d, d.deal, d.deal.account);
  if (blockers.length) throw new Error("La remisión aún tiene bloqueos / The delivery note still has blockers.");

  const invoiced = d.deal.invoices.reduce((s, i) => s + Number(i.amount), 0);
  const amount = d.lines.length
    ? d.lines.reduce((s, l) => s + l.qty * Number(l.dealItem.unitPrice), 0)
    : Math.max(0, Number(d.deal.amount) - invoiced);
  if (amount <= 0) throw new Error("Nada por facturar / Nothing to invoice.");
  const eg = esagra(d.deal);
  const issuedAt = today();
  // The invoice is born from the accepted quote: it references its Nº and inherits its language.
  const quote = await db.quote.findFirst({ where: { dealId: d.dealId, status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, select: { id: true, lang: true } });

  await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx);
    await tx.invoice.create({
      data: {
        number,
        dealId: d.dealId,
        deliveryId: d.id,
        accountId: d.deal.accountId,
        issuedAt,
        dueAt: addDays(issuedAt, d.deal.account.paymentTermsDays),
        amount,
        esagraAtIssue: eg.pct == null ? 0 : Math.round(amount * eg.pct) / 100,
        issuedById: user.id,
        quoteId: quote?.id ?? null,
        docLang: quote?.lang ?? d.deal.account.docLang,
      },
    });
  });
  refreshApp();
}

// ---------- Promises and cash ----------

export async function recordPromise(invoiceId: string, formData: FormData) {
  const user = await requireUser();
  const data = parseForm(
    z.object({
      promisedFor: z.string().min(1).transform((v) => new Date(v)),
      promisedBy: requiredText,
      source: requiredText,
    }),
    formData,
  );
  await db.paymentPromise.create({ data: { ...data, invoiceId, recordedById: user.id } });
  refreshApp();
}

function applicationsFrom(formData: FormData) {
  const out: { invoiceId: string; amount: number }[] = [];
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("apply_")) continue;
    const amount = Number(v || 0);
    if (amount > 0) out.push({ invoiceId: k.slice(6), amount });
  }
  return out;
}

async function checkApplications(accountId: string, apps: { invoiceId: string; amount: number }[]) {
  if (!apps.length) return;
  const invoices = await db.invoice.findMany({
    where: { id: { in: apps.map((a) => a.invoiceId) }, accountId },
    include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } },
  });
  for (const a of apps) {
    const inv = invoices.find((i) => i.id === a.invoiceId);
    if (!inv) throw new Error("Factura de otro cliente / Invoice belongs to another customer.");
    const c = invoiceCash(inv);
    if (a.amount > c.balance - c.pendingReconcile + 0.005) throw new Error(`${inv.number}: max ${(c.balance - c.pendingReconcile).toFixed(2)}`);
  }
}

/** Cash received in the bank. It is not "paid" until Treasury reconciles it. */
export async function recordCustomerPayment(formData: FormData) {
  const user = await requireUser();
  const data = parseForm(
    z.object({
      accountId: z.string().min(1),
      amount: money.refine((v) => v > 0, "Amount"),
      receivedAt: z.string().min(1).transform((v) => new Date(v)),
      reference: optionalText,
    }),
    formData,
  );
  const apps = applicationsFrom(formData);
  if (apps.reduce((s, a) => s + a.amount, 0) > data.amount + 0.005) throw new Error("Se aplicó más de lo recibido / Applied more than received.");
  await checkApplications(data.accountId, apps);
  await db.customerPayment.create({
    data: { ...data, createdById: user.id, applications: { create: apps } },
  });
  refreshApp();
}

export async function applyPayment(paymentId: string, formData: FormData) {
  await requireUser();
  const p = await db.customerPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { applications: true } });
  if (p.reconciledAt) throw new Error("Ya conciliado / Already reconciled.");
  const apps = applicationsFrom(formData);
  const used = p.applications.reduce((s, a) => s + Number(a.amount), 0);
  if (used + apps.reduce((s, a) => s + a.amount, 0) > Number(p.amount) + 0.005) throw new Error("Se aplicó más de lo recibido / Applied more than received.");
  await checkApplications(p.accountId, apps);
  await db.paymentApplication.createMany({ data: apps.map((a) => ({ ...a, paymentId })) });
  refreshApp();
}

export async function reconcilePayment(paymentId: string) {
  const user = await requireManager();
  const p = await db.customerPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { applications: true } });
  if (!p.applications.length) throw new Error("Primero aplica el pago a sus facturas / Apply the payment to its invoices first.");
  await db.customerPayment.updateMany({
    where: { id: paymentId, reconciledAt: null },
    data: { reconciledAt: new Date(), reconciledById: user.id },
  });
  refreshApp();
}

// ---------- Supplier payments ----------

export async function requestSupplierPayment(spoId: string, formData: FormData) {
  const user = await requireUser();
  const spo = await db.supplierPO.findUniqueOrThrow({ where: { id: spoId }, include: { deal: { select: { ownerId: true } } } });
  assertCanEdit(user, spo.deal.ownerId);
  const data = parseForm(
    z.object({
      amount: money.refine((v) => v > 0, "Amount"),
      currency,
      amountUsd: z.coerce.number().min(0).optional(),
      reason: requiredText,
      dueBy: optionalDate,
      docBeneficiary: optionalText,
      docBankName: optionalText,
      docAccount: optionalText,
      docSwift: optionalText,
      docSource: optionalText,
    }),
    formData,
  );
  const created = await db.supplierPayment.create({
    data: {
      ...data,
      amountUsd: data.currency === "USD" ? data.amount : data.amountUsd || null,
      supplierPoId: spoId,
      requestedById: user.id,
    },
  });
  refreshApp();
  redirect(`/administracion/pagos-proveedores/${created.id}`);
}

async function loadPayment(id: string) {
  const p = await db.supplierPayment.findUniqueOrThrow({ where: { id }, include: { supplierPo: { include: { supplier: true } } } });
  const disc = bankDiscrepancies(p.supplierPo.supplier, p);
  return { p, disc, state: paymentState({ ...p, discrepancies: disc.length }) };
}

/**
 * Independent verification: a different person calls the phone registered for the
 * supplier (never one from the document) and confirms the bank data.
 */
export async function verifySupplierPayment(id: string, formData: FormData) {
  const user = await requireUser();
  const { p, state } = await loadPayment(id);
  if (state !== "VERIFY") throw new Error("Este pago no requiere verificación / This payment needs no verification.");
  if (p.requestedById === user.id) throw new Error("Quien solicita el pago no puede verificarlo / The requester cannot verify.");
  const { verificationNote } = parseForm(z.object({ verificationNote: requiredText }), formData);
  const updateProfile = formData.get("updateProfile") === "on";
  await db.$transaction(async (tx) => {
    await tx.supplierPayment.update({
      where: { id },
      data: { verifiedById: user.id, verifiedAt: new Date(), verificationNote },
    });
    if (updateProfile) {
      await tx.supplier.update({
        where: { id: p.supplierPo.supplierId },
        data: {
          bankBeneficiary: p.docBeneficiary ?? p.supplierPo.supplier.bankBeneficiary,
          bankName: p.docBankName ?? p.supplierPo.supplier.bankName,
          bankAccount: p.docAccount ?? p.supplierPo.supplier.bankAccount,
          bankSwift: p.docSwift ?? p.supplierPo.supplier.bankSwift,
          bankVerifiedAt: new Date(),
          bankVerifiedById: user.id,
        },
      });
    }
  });
  refreshApp();
}

export async function approveSupplierPayment(id: string) {
  const user = await requireManager();
  const { p, state } = await loadPayment(id);
  if (state !== "APPROVE") throw new Error("Este pago aún no está listo para aprobar / Not ready for approval.");
  if (p.requestedById === user.id || p.verifiedById === user.id)
    throw new Error("Aprueba una persona distinta de quien solicitó o verificó / Approver must differ from requester and verifier.");
  await db.supplierPayment.updateMany({ where: { id, approvedAt: null }, data: { approvedById: user.id, approvedAt: new Date() } });
  refreshApp();
}

/** Recording the bank transfer. Idempotent: a payment can only be marked executed once. */
export async function executeSupplierPayment(id: string, formData: FormData) {
  const user = await requireManager();
  const { state } = await loadPayment(id);
  if (state !== "EXECUTE") throw new Error("Este pago no está aprobado / Not approved.");
  const { executedRef } = parseForm(z.object({ executedRef: requiredText }), formData);
  await db.supplierPayment.updateMany({
    where: { id, executedAt: null },
    data: { executedAt: new Date(), executedById: user.id, executedRef },
  });
  refreshApp();
}

// ---------- Credit ----------

export async function setCreditLimit(accountId: string, formData: FormData) {
  await requireManager();
  const raw = String(formData.get("creditLimit") ?? "").trim();
  const creditLimit = raw === "" ? null : money.parse(raw);
  await db.account.update({ where: { id: accountId }, data: { creditLimit } });
  refreshApp();
}

export async function grantCreditException(dealId: string, formData: FormData) {
  const user = await requireManager();
  const { note } = parseForm(z.object({ note: requiredText }), formData);
  await db.deal.update({
    where: { id: dealId },
    data: { creditExceptionById: user.id, creditExceptionAt: new Date(), creditExceptionNote: note },
  });
  refreshApp();
}
