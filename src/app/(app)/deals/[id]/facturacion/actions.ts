"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit, canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays, esagra, invoiceCash, nextDocNumber, today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { cmpMoney, money2, mulMoney, subMoney, sumMoney } from "@/lib/money";
import { refreshPaymentBehaviorSafe } from "@/lib/pay-behavior";
import { billingInclude, DEAL_LEVEL, deliveryAmount, partialOf, readinessOf, REQ_KEYS, reqLabel, type ReqKey } from "@/lib/billing";

const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const txt = (fd: FormData, k: string, max = 300) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const back = (dealId: string, qs: string, hash = ""): never => {
  refreshApp();
  redirect(`/deals/${dealId}/facturacion?${qs}${hash}`);
};
const isKey = (k: string): k is ReqKey => (REQ_KEYS as string[]).includes(k);

async function loadDeal(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: billingInclude });
  assertCanEdit(user, deal.ownerId);
  return { user, deal, i: makeI18n(user.lang) };
}
const fact = (userId: string, deal: { id: string; accountId: string }, subject: string, source: string | null = null) =>
  db.activity.create({ data: { type: "NOTE", subject: subject.slice(0, 200), userId, accountId: deal.accountId, dealId: deal.id, phase: "finance", source } });

// ---------- Billing evidence ----------

/** Ask the customer for a missing piece of billing evidence. It stays open until the evidence is recorded. */
export async function requestEvidence(dealId: string, deliveryId: string, kind: string, fd: FormData) {
  const { user, deal, i } = await loadDeal(dealId);
  if (!isKey(kind)) back(dealId, "err=dato");
  const k = kind as ReqKey;
  const sentTo = txt(fd, "sentTo", 160);
  await db.billingRequest.create({
    data: { dealId, deliveryId: DEAL_LEVEL.includes(k) ? null : deliveryId || null, kind: k, sentTo, note: txt(fd, "note", 500), requestedById: user.id },
  });
  await fact(user.id, deal, i.t(`Solicitado al cliente: ${reqLabel(i, k)}`, `Requested from customer: ${reqLabel(i, k)}`), sentTo);
  back(dealId, "ok=solicitado");
}

/** Record evidence that arrived. Only this resolves the requirement (a request alone never does). */
export async function recordEvidence(dealId: string, deliveryId: string, kind: string, fd: FormData) {
  const { user, deal, i } = await loadDeal(dealId);
  if (!isKey(kind)) back(dealId, "err=dato");
  const k = kind as ReqKey;
  const d = deal.deliveries.find((x) => x.id === deliveryId) ?? null;
  const val = txt(fd, "value", 160);
  const now = new Date();
  switch (k) {
    case "POD":
      if (!d || !val) back(dealId, "err=dato");
      await db.delivery.update({ where: { id: d!.id }, data: { podReceived: true, receivedByName: val } });
      break;
    case "RECEPTION_CODE":
      if (!d || !val) back(dealId, "err=dato");
      await db.delivery.update({ where: { id: d!.id }, data: { receptionCode: val } });
      break;
    case "PO":
      if (!val) back(dealId, "err=dato");
      await db.deal.update({ where: { id: dealId }, data: { customerPo: val, poAcceptedAt: deal.poAcceptedAt ?? today() } });
      break;
    case "PORTAL": {
      const until = dayOf(fd.get("date"));
      if (!until || until < today()) back(dealId, "err=fecha");
      await db.account.update({ where: { id: deal.accountId }, data: { portalValidUntil: until } });
      break;
    }
    case "TAX":
      if (!val) back(dealId, "err=dato");
      await db.account.update({ where: { id: deal.accountId }, data: { taxId: val, taxDataComplete: true } });
      break;
    case "PARTIAL":
      if (!d || !val) back(dealId, "err=dato");
      // Written approval to invoice partially, kept as a resolved request on this delivery.
      await db.billingRequest.create({ data: { dealId, deliveryId: d!.id, kind: "PARTIAL", note: val, requestedById: user.id, resolvedAt: now } });
      break;
  }
  await db.billingRequest.updateMany({
    where: { dealId, kind: k, resolvedAt: null, ...(DEAL_LEVEL.includes(k) ? {} : { deliveryId: d?.id ?? null }) },
    data: { resolvedAt: now },
  });
  await fact(user.id, deal, i.t(`Evidencia de facturación recibida: ${reqLabel(i, k)}`, `Billing evidence received: ${reqLabel(i, k)}`), val);
  back(dealId, "ok=evidencia");
}

// ---------- Issue invoice (controlled bridge) ----------

/** Issue SOLU's invoice for a delivery, only when every requirement is met. Accounting starts as "not sent". */
export async function issueFromReadiness(dealId: string, deliveryId: string) {
  const { user, deal, i } = await loadDeal(dealId);
  const d = deal.deliveries.find((x) => x.id === deliveryId);
  if (!d) back(dealId, "err=dato");
  if (d!.invoice) back(dealId, "ok=ya-emitida");
  if (readinessOf(deal, d!, i).some((r) => r.state === "missing")) back(dealId, "err=no-listo");
  const amount = deliveryAmount(deal, d!);
  if (amount <= 0) back(dealId, "err=monto");
  const eg = esagra(deal);
  const issuedAt = today();
  const quote = await db.quote.findFirst({ where: { dealId, status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, select: { id: true, lang: true } });
  const inv = await db.$transaction(async (tx) => {
    const number = await nextDocNumber(tx);
    return tx.invoice.create({
      data: {
        number, dealId, deliveryId: d!.id, accountId: deal.accountId, issuedAt,
        dueAt: addDays(issuedAt, deal.account.paymentTermsDays), amount,
        esagraAtIssue: eg.pct == null ? 0 : mulMoney(amount, eg.pct / 100),
        issuedById: user.id, quoteId: quote?.id ?? null, docLang: quote?.lang ?? deal.account.docLang,
        partial: partialOf(deal, d!).partial,
      },
    });
  });
  await fact(user.id, deal, i.t(`Factura ${inv.number} emitida (USD ${i.n2(amount)})`, `Invoice ${inv.number} issued (USD ${i.n2(amount)})`), d!.code);
  back(dealId, "ok=emitida", `#inv-${inv.id}`);
}

/**
 * Record what the accounting system did with the invoice. SENT = handed over, waiting for its ID;
 * CONFIRMED = the accounting system returned its ID; UNCERTAIN = we don't know if it was created
 * (don't send again until someone checks the accounting system).
 */
export async function accountingBridge(invoiceId: string, mode: string, fd: FormData) {
  const user = await requireUser();
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { deal: { select: { id: true, ownerId: true, accountId: true } } } });
  assertCanEdit(user, inv.deal.ownerId);
  const i = makeI18n(user.lang);
  const system = txt(fd, "externalSystem", 60) ?? inv.externalSystem;
  const note = txt(fd, "note", 300);
  if (mode === "SENT") {
    await db.invoice.update({ where: { id: invoiceId }, data: { syncState: "SENT", externalSystem: system, syncAt: new Date(), syncNote: note } });
  } else if (mode === "CONFIRMED") {
    const externalId = txt(fd, "externalId", 80);
    if (!externalId) back(inv.dealId, "err=id", `#inv-${invoiceId}`);
    const dup = await db.invoice.findFirst({ where: { externalId, externalSystem: system, id: { not: invoiceId } }, select: { number: true } });
    if (dup) back(inv.dealId, `err=id-dup&n=${dup.number}`, `#inv-${invoiceId}`);
    await db.invoice.update({ where: { id: invoiceId }, data: { syncState: "CONFIRMED", externalSystem: system, externalId, syncAt: new Date(), syncNote: note } });
  } else if (mode === "UNCERTAIN") {
    await db.invoice.update({ where: { id: invoiceId }, data: { syncState: "UNCERTAIN", externalSystem: system, syncAt: new Date(), syncNote: note ?? i.t("Sin confirmación del sistema contable.", "No confirmation from the accounting system.") } });
  } else back(inv.dealId, "err=dato");
  await fact(user.id, { id: inv.dealId, accountId: inv.accountId }, i.t(`Factura ${inv.number}: puente contable → ${mode}`, `Invoice ${inv.number}: accounting bridge → ${mode}`), note);
  back(inv.dealId, `ok=contable-${mode.toLowerCase()}`, `#inv-${invoiceId}`);
}

// ---------- Promises and cash ----------

export async function recordPayPromise(invoiceId: string, fd: FormData) {
  const user = await requireUser();
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { deal: { select: { ownerId: true } } } });
  assertCanEdit(user, inv.deal.ownerId);
  const promisedFor = dayOf(fd.get("promisedFor"));
  const promisedBy = txt(fd, "promisedBy", 120);
  const source = txt(fd, "source", 300);
  if (!promisedFor || !promisedBy || !source) back(inv.dealId, "err=promesa", `#inv-${invoiceId}`);
  await db.paymentPromise.create({ data: { invoiceId, promisedFor: promisedFor!, promisedBy: promisedBy!, source: source!, recordedById: user.id } });
  back(inv.dealId, "ok=promesa", `#inv-${invoiceId}`);
}

/** Allocate received cash to one or several invoices (many-to-many). Allocation is not reconciliation. */
export async function allocateCash(dealId: string, paymentId: string, fd: FormData) {
  await requireUser();
  const p = await db.customerPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { applications: true } });
  if (p.reconciledAt) back(dealId, "err=conciliado");
  const apps: { invoiceId: string; amount: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("apply_")) continue;
    const amount = money2(String(v || 0).trim().replace(",", "."));
    if (amount > 0) apps.push({ invoiceId: k.slice(6), amount });
  }
  const used = sumMoney(p.applications.map((a) => a.amount));
  if (cmpMoney(sumMoney([used, ...apps.map((a) => a.amount)]), p.amount) > 0) back(dealId, "err=excede");
  const invoices = await db.invoice.findMany({ where: { id: { in: apps.map((a) => a.invoiceId) }, accountId: p.accountId }, include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } });
  for (const a of apps) {
    const inv = invoices.find((x) => x.id === a.invoiceId);
    if (!inv) back(dealId, "err=otro-cliente");
    const c = invoiceCash(inv!);
    if (cmpMoney(a.amount, subMoney(c.balance, c.pendingReconcile)) > 0) back(dealId, `err=tope&n=${inv!.number}`);
  }
  const residualNote = txt(fd, "residualNote", 300);
  if (!apps.length && !residualNote) back(dealId, "err=nada");
  await db.$transaction([
    ...(apps.length ? [db.paymentApplication.createMany({ data: apps.map((a) => ({ ...a, paymentId })) })] : []),
    ...(residualNote ? [db.customerPayment.update({ where: { id: paymentId }, data: { residualNote } })] : []),
  ]);
  back(dealId, apps.length ? "ok=asignado" : "ok=residuo");
}

/** Treasury confirms the bank movement matches its allocation. Only now does the cash count as collected. */
export async function reconcileCash(dealId: string, paymentId: string) {
  const user = await requireUser();
  if (!canManageAll(user)) back(dealId, "err=gerencia");
  const p = await db.customerPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { applications: true } });
  if (!p.applications.length) back(dealId, "err=sin-asignar");
  const rest = subMoney(p.amount, sumMoney(p.applications.map((a) => a.amount)));
  if (rest > 0 && !p.residualNote) back(dealId, "err=residuo-pendiente");
  await db.customerPayment.updateMany({ where: { id: paymentId, reconciledAt: null }, data: { reconciledAt: new Date(), reconciledById: user.id } });
  await refreshPaymentBehaviorSafe(p.accountId, `Pago conciliado ${p.reference ?? ""}`.trim());
  back(dealId, "ok=conciliado");
}

/** Explain why the customer paid less. The balance stays open until a credit note or the rest arrives. */
export async function markShortPay(invoiceId: string, fd: FormData) {
  const user = await requireUser();
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { deal: { select: { ownerId: true } } } });
  assertCanEdit(user, inv.deal.ownerId);
  const note = txt(fd, "note", 300);
  if (!note) back(inv.dealId, "err=dato", `#inv-${invoiceId}`);
  await db.invoice.update({ where: { id: invoiceId }, data: { shortPayNote: note } });
  back(inv.dealId, "ok=corto", `#inv-${invoiceId}`);
}
