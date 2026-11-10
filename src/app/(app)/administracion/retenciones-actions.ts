"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditMoney, canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { invoiceCash, today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { WITHHOLDING_TYPES, withholdingProblem } from "@/lib/withholding";

// Operaciones O9b · withholdings (module 11 §42.3). Stored as a non-cash credit against one invoice: it lowers what
// the invoice owes everywhere in SOLU, and it is never counted as money received in the bank.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").trim().slice(0, max); return v || null; };
const back = (accountId: string | null, qs: string): never => { refreshApp(); redirect(`/administracion/pagos-recibidos?${accountId ? `account=${accountId}&` : ""}${qs}#retenciones`); };

export async function recordWithholding(fd: FormData) {
  const user = await requireUser();
  const inv = await db.invoice.findUnique({ where: { id: String(fd.get("invoiceId") ?? "") }, include: { account: { select: { id: true, ownerId: true } }, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } });
  if (!inv) redirect("/administracion/pagos-recibidos");
  if (!canEditMoney(user, inv!.account.ownerId)) back(inv!.account.id, "err=permiso");
  const raw = String(fd.get("amount") ?? "").trim().replace(",", ".");
  const amount = raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
  const type = String(fd.get("type") ?? "");
  const note = txt(fd, "note");
  const c = invoiceCash(inv!);
  const problem = withholdingProblem({ type, amount, note }, c.balance - c.pendingReconcile);
  if (problem) back(inv!.account.id, `err=ret-${problem.toLowerCase()}`);
  const d = String(fd.get("date") ?? "");
  const at = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : today();
  const certificate = txt(fd, "certificate", 80);
  await db.customerPayment.create({ data: {
    accountId: inv!.account.id, kind: "WITHHOLDING", withholdingType: type, certificate, withholdingNote: note, amount: money2(amount!), receivedAt: at,
    reference: `${WITHHOLDING_TYPES[type].es} · ${inv!.number}`.slice(0, 190), createdById: user.id,
    // Not cash: there is nothing to reconcile with the bank, so it counts on the invoice from the moment it is recorded.
    reconciledAt: new Date(), reconciledById: user.id,
    applications: { create: [{ invoiceId: inv!.id, amount: money2(amount!) }] },
  } });
  back(inv!.account.id, "ok=retencion");
}

/** The certificate usually arrives later: add its number when it does. */
export async function setWithholdingCertificate(id: string, fd: FormData) {
  const user = await requireUser();
  const w = await db.customerPayment.findFirst({ where: { id, kind: "WITHHOLDING" }, select: { accountId: true, account: { select: { ownerId: true } } } });
  if (!w) redirect("/administracion/pagos-recibidos");
  const certificate = txt(fd, "certificate", 80);
  if (!canEditMoney(user, w!.account.ownerId) || !certificate) back(w!.accountId, "err=ret-certificado");
  await db.customerPayment.update({ where: { id }, data: { certificate } });
  back(w!.accountId, "ok=certificado");
}

/** Recorded by mistake: Finanzas, Administración or management remove it, and the invoice owes that amount again. */
export async function voidWithholding(id: string) {
  const user = await requireUser();
  const w = await db.customerPayment.findFirst({ where: { id, kind: "WITHHOLDING" }, select: { accountId: true } });
  if (!w) redirect("/administracion/pagos-recibidos");
  if (!canFinance(user)) back(w!.accountId, "err=permiso");
  await db.customerPayment.delete({ where: { id } });
  back(w!.accountId, "ok=anulada");
}
