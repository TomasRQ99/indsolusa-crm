"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit, canManageAll } from "@/lib/permissions";
import { optionalDate, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { addDays, bankDiscrepancies, esagra, invoiceBlockers, invoiceCash, nextDocNumber, paymentState, today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { authorityFor, treasuryChecks } from "@/lib/purchasing";

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
  // Partial billing follows the customer's billing profile (see Billing Readiness).
  const ordered = (await db.dealItem.aggregate({ where: { dealId: d.dealId }, _sum: { qty: true } }))._sum.qty ?? 0;
  const partial = ordered > 0 && d.lines.reduce((s, l) => s + l.qty, 0) < ordered;
  if (partial && !d.deal.account.allowsPartialBilling) {
    const approved = await db.billingRequest.findFirst({ where: { deliveryId: d.id, kind: "PARTIAL", resolvedAt: { not: null } }, select: { id: true } });
    if (!approved) redirect(`/deals/${d.dealId}/facturacion?err=no-listo`);
  }

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
        partial,
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
  const p = await db.supplierPayment.findUniqueOrThrow({ where: { id }, include: { supplierPo: { include: { supplier: true } }, executions: true } });
  const disc = bankDiscrepancies(p.supplierPo.supplier, p);
  return { p, disc, state: paymentState({ ...p, discrepancies: disc.length, executions: p.executions }) };
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
  // The verification route: the registered phone (never the document's), every field confirmed.
  if (formData.get("calledRegistered") !== "on" || formData.get("allFields") !== "on") payBack(id, "err=ruta");
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
  payBack(id, "ok=verificado");
}

const payBack = (id: string, qs: string): never => {
  refreshApp();
  redirect(`/administracion/pagos-proveedores/${id}?${qs}`);
};

/**
 * Approve Payment Request. Server-side: bank hard stop cleared, duplicate check acknowledged (and no hard
 * duplicate), authority (role limit in USD, different person from requester and verifier).
 * Approving does NOT pay: it only allows Treasury to send the transfer.
 */
export async function approveSupplierPayment(id: string, formData: FormData) {
  const user = await requireUser();
  const p = await db.supplierPayment.findUniqueOrThrow({ where: { id }, include: { executions: true, supplierPo: { include: { supplier: true } } } });
  const disc = bankDiscrepancies(p.supplierPo.supplier, p);
  const state = paymentState({ ...p, discrepancies: disc.length, executions: p.executions });
  if (state !== "APPROVE") payBack(id, "err=estado");
  const i = makeI18n(user.lang);
  const { dup, usd } = await treasuryChecks(p, p.supplierPo, i);
  if (dup.hard) payBack(id, "err=duplicado");
  if (dup.hits.length && formData.get("dupChecked") !== "1") payBack(id, "err=revisar-duplicados");
  const auth = authorityFor(user, p, usd, i);
  if (!auth.can) payBack(id, "err=autoridad");
  await db.supplierPayment.updateMany({
    where: { id, approvedAt: null },
    data: { approvedById: user.id, approvedAt: new Date(), dupCheckedByName: user.name, dupCheckNote: dup.hits.length ? `Revisados ${dup.hits.length} posibles duplicados` : "Sin duplicados" },
  });
  payBack(id, "ok=aprobado");
}

/**
 * Record external payment execution (done in the bank's portal, outside SOLU).
 * If the bank already shows the debit, it is confirmed (= paid). Otherwise it stays "sent, not confirmed".
 */
export async function recordExecution(id: string, formData: FormData) {
  const user = await requireManager();
  const p = await db.supplierPayment.findUniqueOrThrow({ where: { id }, include: { executions: true, supplierPo: { include: { supplier: true } } } });
  const state = paymentState({ ...p, discrepancies: bankDiscrepancies(p.supplierPo.supplier, p).length, executions: p.executions });
  if (state !== "EXECUTE") payBack(id, "err=estado");
  const bankRef = String(formData.get("bankRef") ?? "").trim().slice(0, 80) || null;
  const confirmed = formData.get("confirmed") === "yes";
  if (confirmed && !bankRef) payBack(id, "err=referencia");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.paymentExecution.create({
      data: {
        paymentId: id, amount: p.amount, sentAt: now, bankRef, state: confirmed ? "CONFIRMED" : "SENT",
        recordedById: user.id, recordedByName: user.name,
        ...(confirmed ? { resolvedAt: now, resolvedByName: user.name, evidence: `Débito visible en el banco · ref. ${bankRef}` } : {}),
      },
    });
    if (confirmed) await tx.supplierPayment.updateMany({ where: { id, executedAt: null }, data: { executedAt: now, executedById: user.id, executedRef: bankRef } });
  });
  payBack(id, confirmed ? "ok=pagado" : "ok=enviado");
}

/** Mark a sent transfer as uncertain (the bank or supplier contradicts it, or it's taking too long). */
export async function markUncertain(executionId: string, formData: FormData) {
  const user = await requireUser();
  const e = await db.paymentExecution.findUniqueOrThrow({ where: { id: executionId } });
  if (e.state !== "SENT") payBack(e.paymentId, "err=estado");
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  if (!note) payBack(e.paymentId, "err=nota");
  await db.paymentExecution.update({ where: { id: executionId }, data: { state: "UNCERTAIN", note: `${note} (${user.name})` } });
  payBack(e.paymentId, "ok=incierto");
}

/**
 * Reconcile an uncertain (or sent) execution with evidence. CONFIRMED = paid. FAILED = the money did not
 * leave (or came back): the request goes back to "approved · not sent" and a new attempt can be recorded.
 * Never retry before reconciling: that's how double payments happen.
 */
export async function reconcileExecution(executionId: string, outcome: "CONFIRMED" | "FAILED", formData: FormData) {
  const user = await requireManager();
  const e = await db.paymentExecution.findUniqueOrThrow({ where: { id: executionId } });
  if (e.state !== "SENT" && e.state !== "UNCERTAIN") payBack(e.paymentId, "err=estado");
  const evidence = String(formData.get("evidence") ?? "").trim().slice(0, 300);
  if (!evidence) payBack(e.paymentId, "err=evidencia");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.paymentExecution.update({ where: { id: executionId }, data: { state: outcome, resolvedAt: now, resolvedByName: user.name, evidence } });
    if (outcome === "CONFIRMED") await tx.supplierPayment.updateMany({ where: { id: e.paymentId, executedAt: null }, data: { executedAt: now, executedById: user.id, executedRef: e.bankRef } });
  });
  payBack(e.paymentId, outcome === "CONFIRMED" ? "ok=pagado" : "ok=fallido");
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
