"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { fDay, fMoney, fText } from "@/lib/fd";
import { getPurchasePolicy } from "@/lib/pr-auth";
import { actWith, loadSupplierInvoices } from "@/lib/admin-store";

// Módulo 14 §2D · Accounts payable. The supplier's invoice is recorded once and linked to its order; SOLU compares
// order, receipt and invoice. Accepting a difference, approving the payment and paying are three separate facts,
// each by someone with authority, and approving is never done by whoever recorded the invoice (AC7, AC8).

const go = (qs: string): never => { refreshApp(); redirect(`/administracion/pagar?${qs}`); };
type U = { id: string; role: string };
const canRecord = (u: U) => canFinance(u as never) || u.role === "NEGOCIADOR_OPERATIVO";

export async function recordSupplierInvoice(fd: FormData) {
  const user = await requireUser();
  if (!canRecord(user)) go("err=permiso");
  const link = String(fd.get("link") ?? "");
  const [po, ip] = await Promise.all([
    link.startsWith("po:") ? db.supplierPO.findUnique({ where: { id: link.slice(3) }, select: { id: true, supplierId: true, currency: true } }) : null,
    link.startsWith("ip:") ? db.internalPurchase.findUnique({ where: { id: link.slice(3) }, select: { id: true, supplierId: true, currency: true } }) : null,
  ]);
  const supplierId = po?.supplierId ?? ip?.supplierId ?? fText(fd, "supplierId", 40);
  const number = fText(fd, "number", 60), amount = fMoney(fd, "amount"), invoiceDate = fDay(fd, "invoiceDate"), source = fText(fd, "source", 160);
  const currency = (fText(fd, "currency", 3) ?? po?.currency ?? ip?.currency ?? "USD").toUpperCase();
  if (!supplierId || !number || !amount || !invoiceDate || !source || !/^[A-Z]{3}$/.test(currency)) go("err=datos#nueva");
  if (!(await db.supplier.count({ where: { id: supplierId! } }))) go("err=datos#nueva");
  // The same invoice number of the same supplier is never recorded twice.
  if (await db.supplierInvoice.count({ where: { supplierId: supplierId!, number: number! } })) go("err=repetida#nueva");
  const amountUsd = currency === "USD" ? amount : fMoney(fd, "amountUsd");
  const pct = fMoney(fd, "discountPct", 100);
  const row = await db.supplierInvoice.create({ data: {
    supplierId: supplierId!, supplierPoId: po?.id ?? null, internalPurchaseId: ip?.id ?? null, number: number!, kind: fd.get("kind") === "SERVICE" ? "SERVICE" : "PRODUCT",
    invoiceDate: invoiceDate!, dueAt: fDay(fd, "dueAt"), amount: amount!, currency, amountUsd, discountPct: pct && pct > 0 ? pct : null, discountUntil: pct && pct > 0 ? fDay(fd, "discountUntil") : null,
    lateImpact: fText(fd, "lateImpact", 200), source: source!, receivedAt: fDay(fd, "receivedAt") ?? today(), recordedByName: user.name, recordedById: user.id,
  } });
  go(`ok=registrada#f-${row.id}`);
}

async function load(id: string) {
  const user = await requireUser();
  const [row] = await loadSupplierInvoices({ id });
  if (!row) go("err=no-existe");
  return { user, row: row! };
}

/** A person says the service was received as agreed. For a service this takes the place of the goods receipt. */
export async function acceptService(id: string, fd: FormData) {
  const { user, row } = await load(id);
  const note = fText(fd, "note");
  if (!canRecord(user)) go("err=permiso");
  if (row.kind !== "SERVICE" || row.serviceAcceptedAt || !note) go(`err=servicio#f-${id}`);
  await db.supplierInvoice.update({ where: { id }, data: { serviceAcceptedAt: new Date(), serviceAcceptedByName: user.name, serviceAcceptNote: note } });
  go(`ok=servicio#f-${id}`);
}

/** Authority to accept a difference or approve a payment: the purchase policy (level by amount), with the person's
 *  own role or one lent to them, and never whoever recorded the invoice. */
async function authority(user: U, row: { recordedById: string; amountUsd: unknown; amount: unknown; currency: string }, domain: "PURCHASE_APPROVAL" | "PAYMENT_APPROVAL") {
  if (user.id === row.recordedById) return { ok: false, delegationId: null, fromName: null };
  const pol = await getPurchasePolicy();
  const usd = row.amountUsd != null ? Number(row.amountUsd) : row.currency === "USD" ? Number(row.amount) : null;
  // Without a USD value the limit cannot be applied: only the level without a limit may decide.
  const test = (role: string) => pol.value.level2Roles.includes(role) || (usd != null && usd <= pol.value.level1LimitUsd && pol.value.level1Roles.includes(role));
  return actWith(user, domain, usd, row.recordedById, test);
}

export async function acceptException(id: string, fd: FormData) {
  const { user, row } = await load(id);
  const note = fText(fd, "note", 500);
  if (row.match.clean || row.exceptionAt || !note) go(`err=excepcion#f-${id}`);
  const a = await authority(user, row, "PURCHASE_APPROVAL");
  if (!a.ok) go(`err=autoridad#f-${id}`);
  await db.supplierInvoice.update({ where: { id }, data: { exceptionAt: new Date(), exceptionByName: a.fromName ? `${user.name} (autoridad prestada por ${a.fromName})` : user.name, exceptionNote: note } });
  go(`ok=excepcion#f-${id}`);
}

/** Approve paying an invoice that has no customer order behind it. Invoices of an order are paid through the
 *  order's own payment requests, so they are not approved here. Approving does not pay. */
export async function approveInvoicePayment(id: string) {
  const { user, row } = await load(id);
  if (row.supplierPoId || row.payApprovedAt || row.paidAt) go(`err=estado#f-${id}`);
  if (!row.match.payable) go(`err=sin-cuadrar#f-${id}`);
  const a = await authority(user, row, "PAYMENT_APPROVAL");
  if (!a.ok) go(`err=autoridad#f-${id}`);
  await db.supplierInvoice.updateMany({ where: { id, payApprovedAt: null }, data: { payApprovedAt: new Date(), payApprovedById: user.id, payApprovedByName: a.fromName ? `${user.name} (autoridad prestada por ${a.fromName})` : user.name } });
  go(`ok=aprobada#f-${id}`);
}

/** The money left the bank: reference and date. Only after the approval. */
export async function markInvoicePaid(id: string, fd: FormData) {
  const { user, row } = await load(id);
  if (!canFinance(user)) go("err=permiso");
  const ref = fText(fd, "paidRef", 120), at = fDay(fd, "paidAt") ?? today();
  if (row.supplierPoId || !row.payApprovedAt || row.paidAt || !ref || at > today()) go(`err=pago#f-${id}`);
  await db.supplierInvoice.updateMany({ where: { id, paidAt: null }, data: { paidAt: at, paidRef: ref, paidByName: user.name } });
  go(`ok=pagada#f-${id}`);
}
