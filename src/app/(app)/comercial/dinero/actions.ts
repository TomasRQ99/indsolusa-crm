"use server";

// Comercial C3 · Commercial Cash Journey commands. Comercial moves the relationship; it never edits a balance,
// a reconciliation or an approved credit limit (§73). Finance keeps the financial truth.
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canDecideCredit, canEditMoney, canEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays, invoiceCash, today } from "@/lib/domain";
import { money2, sumMoney } from "@/lib/money";
import { cleanCashPolicy, isRootCause, reasonOf, STEP_KINDS, type CashStage, type StepKind } from "@/lib/cash-rules";
import { getCashPolicy } from "@/lib/cash-journey";
import { loadCredit } from "@/lib/queries";
import { paymentBehaviors } from "@/lib/pay-behavior";

const txt = (fd: FormData, k: string, max = 1000) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const day = (fd: FormData, k: string) => { const v = txt(fd, k, 10); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : null; };
const amount = (fd: FormData, k: string) => { const v = txt(fd, k, 20); if (!v) return null; const n = Number(v.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 && n < 1e12 ? money2(n) : NaN; };
const backOf = (fd: FormData, fallback: string) => { const b = txt(fd, "back", 300) ?? fallback; return b.startsWith("/") && !b.startsWith("//") ? b : fallback; };
const go = (path: string, qs: string): never => { refreshApp(); const [p, h] = path.split("#"); redirect(`${p}${p.includes("?") ? "&" : "?"}${qs}${h ? `#${h}` : ""}`); };

// ---------- Cash blockers (§57, §58, §70): root cause ≠ responsible person ----------

export async function saveBlocker(dealId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/comercial/dinero");
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { id: true, ownerId: true, amount: true } });
  if (!canEditMoney(user, deal.ownerId) && !canEditOps(user, deal.ownerId)) go(back, "err=permiso");
  const stage = txt(fd, "stage", 10) as CashStage | null;
  if (stage !== "DELIVER" && stage !== "INVOICE" && stage !== "COLLECT") go(back, "err=etapa");
  const reasonCode = txt(fd, "reasonCode", 60) ?? "";
  const reason = reasonOf(stage!, reasonCode);
  const rootCause = txt(fd, "rootCause", 20) ?? reason?.cause ?? "";
  const secondary = txt(fd, "secondaryCause", 20);
  const narrative = txt(fd, "narrative", 1200);
  const nextMovement = txt(fd, "nextMovement", 300);
  const responsibleId = txt(fd, "responsibleId", 40) ?? user.id;
  if (!reason) go(back, "err=motivo");
  if (!isRootCause(rootCause) || (secondary && !isRootCause(secondary))) go(back, "err=causa");
  if (!narrative) go(back, "err=narrativa");
  if (!nextMovement) go(back, "err=movimiento");
  const resp = await db.user.findFirst({ where: { id: responsibleId, active: true }, select: { id: true } });
  if (!resp) go(back, "err=responsable");
  const value = amount(fd, "blockedValue");
  if (Number.isNaN(value)) go(back, "err=valor");
  const data = {
    stage: stage!, reasonCode, rootCause, secondaryCause: secondary && secondary !== rootCause ? secondary : null, narrative: narrative!, evidence: txt(fd, "evidence", 600),
    responsibleId, nextMovement: nextMovement!, expectedResolution: day(fd, "expectedResolution"),
    shipmentId: txt(fd, "shipmentId", 40), deliveryId: txt(fd, "deliveryId", 40), invoiceId: txt(fd, "invoiceId", 40),
  };
  const id = txt(fd, "id", 40);
  if (id) {
    const cur = await db.cashBlocker.findFirst({ where: { id, dealId, resolvedAt: null } });
    if (!cur) go(back, "err=bloqueo");
    await db.cashBlocker.update({ where: { id }, data: { ...data, blockedValue: value ?? cur!.blockedValue } });
  } else {
    await db.cashBlocker.create({
      data: { ...data, dealId, readyAt: day(fd, "readyAt"), blockedSince: day(fd, "blockedSince") ?? today(), blockedValue: value ?? money2(deal.amount), createdByName: user.name },
    });
  }
  go(back, "ok=bloqueo");
}

export async function resolveBlocker(id: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/comercial/dinero");
  const b = await db.cashBlocker.findUniqueOrThrow({ where: { id }, include: { deal: { select: { ownerId: true } } } });
  if (!canEditMoney(user, b.deal.ownerId) && !canEditOps(user, b.deal.ownerId) && b.responsibleId !== user.id) go(back, "err=permiso");
  const note = txt(fd, "resolvedNote", 600);
  if (!note) go(back, "err=nota");
  if (!b.resolvedAt) await db.cashBlocker.update({ where: { id }, data: { resolvedAt: new Date(), resolvedNote: note } });
  go(back, "ok=resuelto");
}

// ---------- Invoice confirmation (§59) ----------

export async function addInvoiceStep(invoiceId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/comercial/dinero");
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { issuedAt: true, deal: { select: { ownerId: true } } } });
  if (!canEditMoney(user, inv.deal.ownerId)) go(back, "err=permiso");
  const kind = txt(fd, "kind", 30) as StepKind | null;
  if (!kind || !STEP_KINDS.includes(kind)) go(back, "err=paso");
  const at = day(fd, "at") ?? today();
  if (at < addDays(inv.issuedAt, 0) || at > today()) go(back, "err=fecha-paso");
  const reason = txt(fd, "reason", 600);
  if (kind === "REJECTED" && !reason) go(back, "err=motivo-rechazo");
  await db.invoiceStep.create({ data: { invoiceId, kind: kind!, at, reference: txt(fd, "reference", 120), reason, evidence: txt(fd, "evidence", 400), byName: user.name } });
  go(back, "ok=paso");
}

// ---------- Collection next movement (§60): at most one, or a wait with control ----------

export async function setCollectNext(invoiceId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/comercial/dinero");
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { deal: { select: { ownerId: true } } } });
  if (!canEditMoney(user, inv.deal.ownerId)) go(back, "err=permiso");
  const mode = txt(fd, "mode", 10);
  const next = txt(fd, "collectNext", 300);
  const waitingFor = txt(fd, "collectWaitingFor", 300);
  const at = day(fd, "collectNextAt");
  if (mode === "wait" ? !waitingFor || !at : !next) go(back, "err=movimiento");
  await db.invoice.update({
    where: { id: invoiceId },
    data: { collectNext: mode === "wait" ? null : next, collectWaitingFor: mode === "wait" ? waitingFor : null, collectNextAt: at, collectContact: txt(fd, "collectContact", 160), collectByName: user.name, collectAt: new Date() },
  });
  go(back, "ok=movimiento");
}

// ---------- Payment map (§59): who receives, validates, approves, schedules and pays ----------

const MAP_ROLES = ["RECEIVES", "VALIDATES", "APPROVES", "SCHEDULES", "PAYS"] as const;

export async function savePaymentMap(accountId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, `/accounts/${accountId}#mapa-pago`);
  const a = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { ownerId: true, contacts: { select: { id: true } } } });
  if (!canEditMoney(user, a.ownerId)) go(back, "err=permiso");
  const ok = new Set(a.contacts.map((c) => c.id));
  const people = MAP_ROLES.flatMap((role) => fd.getAll(`role_${role}`).map(String).filter((id) => ok.has(id)).map((contactId) => ({ role, contactId })));
  const data = { process: txt(fd, "process", 1200), portal: txt(fd, "portal", 300), payDays: txt(fd, "payDays", 300), documents: txt(fd, "documents", 800), notes: txt(fd, "notes", 1200), updatedByName: user.name };
  await db.$transaction(async (tx) => {
    const m = await tx.paymentMap.upsert({ where: { accountId }, create: { accountId, ...data }, update: data });
    await tx.paymentMapPerson.deleteMany({ where: { mapId: m.id } });
    if (people.length) await tx.paymentMapPerson.createMany({ data: people.map((p) => ({ ...p, mapId: m.id })), skipDuplicates: true });
  });
  go(back, "ok=mapa");
}

// ---------- Credit review requests (§63): anyone asks, Finanzas or Gerencia decides ----------

const KINDS = ["INCREASE", "DECREASE", "TEMPORARY_EXCEPTION", "TERMS_REVIEW"] as const;
const ALTS = ["PREPAYMENT", "PRIOR_PAYMENT", "GUARANTEE", "SPLIT_ORDER", "REDUCE_EXPOSURE"] as const;

export async function requestCreditReview(accountId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/comercial/dinero#credito");
  const kind = txt(fd, "kind", 30) as (typeof KINDS)[number] | null;
  if (!kind || !KINDS.includes(kind)) go(back, "err=tipo");
  const reason = txt(fd, "reason", 1200);
  if (!reason) go(back, "err=motivo-cupo");
  const limit = amount(fd, "requestedLimit");
  const terms = txt(fd, "requestedTerms", 4);
  const termsN = terms ? Math.round(Number(terms)) : null;
  if (Number.isNaN(limit) || (termsN != null && !(termsN > 0 && termsN <= 365))) go(back, "err=valor");
  if ((kind === "INCREASE" || kind === "DECREASE") && limit == null) go(back, "err=monto-cupo");
  if (kind === "TERMS_REVIEW" && termsN == null) go(back, "err=plazo");
  const until = day(fd, "until");
  if (kind === "TEMPORARY_EXCEPTION" && !until) go(back, "err=horizonte");
  const dealId = txt(fd, "dealId", 40);
  if (await db.creditReviewRequest.count({ where: { accountId, status: "OPEN" } })) go(back, "err=cupo-pendiente");
  const [c] = await loadCredit({ id: accountId });
  const pb = (await paymentBehaviors([accountId])).byId.get(accountId);
  const acct = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { paymentTermsDays: true } });
  // What the decider sees, frozen at the moment of asking.
  const snapshot = {
    limit: c?.limit ?? null, used: c?.used ?? 0, openInvoices: c?.openInvoices ?? 0, committed: c?.uninvoiced ?? 0, available: c?.available ?? null,
    overdueCount: c?.overdueCount ?? 0, overdue: c ? sumMoney(c.invoices.filter((x) => x.dueAt < today()).map((x) => invoiceCash(x).balance)) : 0,
    termsDays: acct.paymentTermsDays, expectedDays: pb?.expected.expectedDays ?? null, avgDelay: pb?.expected.avgDelay ?? null, payN: pb?.expected.n ?? 0,
    trend: pb?.trend.trend ?? "UNKNOWN", promisesKept: pb?.promises.kept ?? 0, promisesBroken: pb?.promises.broken ?? 0,
    blocking: c?.blocking.map((d) => ({ code: d.code, amount: Number(d.amount) })) ?? [],
  };
  await db.creditReviewRequest.create({
    data: {
      accountId, dealId: dealId && (await db.deal.count({ where: { id: dealId, accountId } })) ? dealId : null, kind: kind!, requestedLimit: limit, requestedTerms: termsN, until,
      reason: reason!, info: txt(fd, "info", 1200), alternatives: fd.getAll("alternatives").map(String).filter((x) => (ALTS as readonly string[]).includes(x)),
      snapshot: snapshot as Prisma.InputJsonValue, requestedById: user.id,
    },
  });
  go(back, "ok=cupo-pedido");
}

export async function withdrawCreditReview(id: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/comercial/dinero#credito");
  const r = await db.creditReviewRequest.findUniqueOrThrow({ where: { id } });
  if (r.requestedById !== user.id || r.status !== "OPEN") go(back, "err=permiso");
  await db.creditReviewRequest.update({ where: { id }, data: { status: "WITHDRAWN", decidedAt: new Date(), decisionNote: txt(fd, "note", 600) } });
  go(back, "ok=cupo-retirado");
}

/** Approve (with the limit / terms actually granted) or reject. Never by the person who asked.
 *  An approval updates the account (or the Journey's credit exception) in the same transaction; all audited. */
export async function decideCreditReview(id: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/administracion/cupos#solicitudes");
  if (!canDecideCredit(user)) go(back, "err=autoridad");
  const r = await db.creditReviewRequest.findUniqueOrThrow({ where: { id } });
  if (r.status !== "OPEN") go(back, "err=decidida");
  if (r.requestedById === user.id) go(back, "err=propia");
  const decision = txt(fd, "decision", 10);
  const note = txt(fd, "decisionNote", 1200);
  if (decision !== "APPROVE" && decision !== "REJECT") go(back, "err=decision");
  if (!note) go(back, "err=nota");
  if (decision === "REJECT") {
    await db.creditReviewRequest.update({ where: { id }, data: { status: "REJECTED", decidedById: user.id, decidedAt: new Date(), decisionNote: note } });
    go(back, "ok=cupo-rechazado");
  }
  const lim = amount(fd, "approvedLimit");
  const terms = txt(fd, "approvedTerms", 4);
  const termsN = terms ? Math.round(Number(terms)) : null;
  if (Number.isNaN(lim) || (termsN != null && !(termsN > 0 && termsN <= 365))) go(back, "err=valor");
  const approvedLimit = lim ?? (r.requestedLimit == null ? null : Number(r.requestedLimit));
  const approvedTerms = termsN ?? r.requestedTerms;
  await db.$transaction(async (tx) => {
    if ((r.kind === "INCREASE" || r.kind === "DECREASE") && approvedLimit != null) await tx.account.update({ where: { id: r.accountId }, data: { creditLimit: approvedLimit } });
    if (r.kind === "TERMS_REVIEW" && approvedTerms != null) await tx.account.update({ where: { id: r.accountId }, data: { paymentTermsDays: approvedTerms } });
    if (r.kind === "TEMPORARY_EXCEPTION" && r.dealId) await tx.deal.update({ where: { id: r.dealId }, data: { creditExceptionById: user.id, creditExceptionAt: new Date(), creditExceptionNote: `${note}${r.until ? ` (hasta ${r.until.toISOString().slice(0, 10)})` : ""}`.slice(0, 600) } });
    await tx.creditReviewRequest.update({ where: { id }, data: { status: "APPROVED", decidedById: user.id, decidedAt: new Date(), decisionNote: note, approvedLimit: r.kind === "INCREASE" || r.kind === "DECREASE" ? approvedLimit : null, approvedTerms: r.kind === "TERMS_REVIEW" ? approvedTerms : null } });
  });
  go(back, "ok=cupo-aprobado");
}

// ---------- Policy (versioned; Gerencia or Finanzas) ----------

export async function saveCashPolicy(fd: FormData) {
  const user = await requireUser();
  const back = "/comercial/fugas#politica";
  if (!canDecideCredit(user)) go(back, "err=autoridad");
  const cur = await getCashPolicy();
  const value = cleanCashPolicy({
    readyAlertDays: txt(fd, "readyAlertDays", 4), deliveredAlertWorkingDays: txt(fd, "deliveredAlertWorkingDays", 4), acceptAlertWorkingDays: txt(fd, "acceptAlertWorkingDays", 4),
    aging: (txt(fd, "aging", 60) ?? "").split(/[^\d]+/).filter(Boolean).map(Number),
  });
  await db.marketSetting.create({ data: { key: "cashPolicy", version: cur.version + 1, value, updatedByName: user.name } });
  go(back, "ok=politica");
}
