import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, daysBetween, invoiceCash, today } from "./domain";
import { money2, subMoney, sumMoney } from "./money";
import type { makeI18n } from "./i18n";
import { billingInclude, cashViewOf, deliveryAmount, readinessOf, type ReqKey } from "./billing";
import { loadCredit } from "./queries";
import { paymentBehaviors } from "./pay-behavior";
import { computeCommissions } from "./commission";
import { invoiceFacts, toPayInvoice } from "./pay-rules";
import { carryCost, getFinanceRate } from "./financing";
import {
  agingBucket, causeClass, cleanCashPolicy, confirmationOf, delayAttribution, median, pct, promiseStatus, workingDaysBetween,
  DEFAULT_CASH_POLICY, type CashPolicy, type CauseClass, type PromiseStatus, type RootCause,
} from "./cash-rules";

// Comercial C3 · read model over Operations (ready goods, deliveries) and Finance (invoices, cash, credit).
// One financial truth: nothing here stores a balance. It only says where money stopped, why, who moves it next.

type I = ReturnType<typeof makeI18n>;

export async function getCashPolicy(): Promise<{ value: CashPolicy; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: "cashPolicy" }, orderBy: { version: "desc" } });
  return s ? { value: cleanCashPolicy(s.value), version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_CASH_POLICY, version: 0, by: null, at: null };
}

const journeyInclude = {
  ...billingInclude,
  owner: { select: { id: true, name: true } },
  shipments: { include: { lines: true } },
  supplierPos: { select: { id: true, code: true, receivedAt: true, shipments: { select: { id: true } } } },
  cashBlockers: { orderBy: { blockedSince: "asc" }, include: { responsible: { select: { id: true, name: true } } } },
  invoices: {
    orderBy: { issuedAt: "asc" },
    include: {
      delivery: { select: { code: true, deliveredAt: true } },
      promises: { orderBy: { createdAt: "desc" }, include: { recordedBy: { select: { name: true } } } },
      applications: { include: { payment: true } },
      steps: { orderBy: [{ at: "asc" }, { createdAt: "asc" }] },
    },
  },
} satisfies Prisma.DealInclude;
type JDeal = Prisma.DealGetPayload<{ include: typeof journeyInclude }>;
type JBlocker = JDeal["cashBlockers"][number];
type JInvoice = JDeal["invoices"][number];

/** Missing billing evidence → who usually holds it (a suggestion; a recorded blocker overrides it). */
const REQ_CAUSE: Record<ReqKey, RootCause> = { POD: "OPERATIONS", RECEPTION_CODE: "CUSTOMER", PO: "CUSTOMER", PORTAL: "ADMINISTRATION", TAX: "ADMINISTRATION", PARTIAL: "CUSTOMER" };

const base = (d: JDeal) => ({ dealId: d.id, dealCode: d.code, title: d.title, accountId: d.accountId, account: d.account.name, ownerId: d.ownerId, ownerName: d.owner.name });
const openBlocker = (d: JDeal, stage: string, match: (b: JBlocker) => boolean) => d.cashBlockers.find((b) => b.stage === stage && !b.resolvedAt && match(b)) ?? null;

export type Scope = { ownerId?: string; light?: boolean };

export async function loadCashJourney(i: I, scope: Scope = {}) {
  const now = today();
  const policy = await getCashPolicy();
  const P = policy.value;
  const own = scope.ownerId ? { ownerId: scope.ownerId } : {};
  const since = addDays(now, -180);
  const deals = await db.deal.findMany({
    where: { ...own, OR: [{ stage: "WON" }, { invoices: { some: {} } }] },
    include: journeyInclude,
    orderBy: { createdAt: "asc" },
  });
  const accountIds = [...new Set(deals.map((d) => d.accountId))];
  const [pb, credit, reviews, unapplied] = await Promise.all([
    paymentBehaviors(accountIds),
    loadCredit(scope.ownerId ? { deals: { some: { ownerId: scope.ownerId } } } : {}),
    db.creditReviewRequest.findMany({
      where: scope.ownerId ? { OR: [{ requestedById: scope.ownerId }, { account: { deals: { some: { ownerId: scope.ownerId } } } }] } : {},
      include: { account: { select: { id: true, name: true } }, deal: { select: { id: true, code: true } }, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.customerPayment.findMany({ where: { accountId: { in: accountIds }, reconciledAt: null }, include: { applications: { select: { amount: true } }, account: { select: { name: true } } } }),
  ]);

  // ---------- 1 · Entregar: goods ready, not delivered ----------
  const deliver = deals.flatMap((d) => {
    if (d.stage !== "WON") return [];
    const delivered = sumMoney(d.deliveries.map((x) => deliveryAmount(d, x)));
    const undelivered = Math.max(0, subMoney(d.amount, delivered));
    const ships = d.shipments.filter((s) => !s.toCustomer && s.deliveredAt && !s.deliveryId && s.customs !== "HOLD" && s.customs !== "PENDING");
    const pos = d.supplierPos.filter((p) => p.receivedAt && p.shipments.length === 0 && !d.deliveries.some((x) => x.deliveredAt >= p.receivedAt!));
    if (!ships.length && !(pos.length && undelivered > 0.005)) return [];
    const readyAt = [...ships.map((s) => s.deliveredAt!), ...pos.map((p) => p.receivedAt!)].reduce((m, x) => (x < m ? x : m));
    const lineValue = sumMoney(ships.flatMap((s) => s.lines.map((l) => { const it = d.items.find((x) => x.id === l.dealItemId); return it ? money2(Number(it.unitPrice) * l.qty) : 0; })));
    const value = lineValue > 0 ? Math.min(lineValue, undelivered || lineValue) : undelivered;
    if (value <= 0.005) return [];
    const days = Math.max(0, daysBetween(readyAt, now));
    const blocker = openBlocker(d, "DELIVER", () => true);
    const att = delayAttribution(readyAt, now, d.cashBlockers.filter((b) => b.stage === "DELIVER"));
    return [{
      ...base(d), key: `deliver:${d.id}`, refs: [...ships.map((s) => s.code), ...pos.map((p) => p.code)], shipmentId: ships[0]?.id ?? null,
      readyAt, days, value, blocker, att, alert: days > P.readyAlertDays,
      next: blocker?.nextMovement ?? d.nextMove ?? null, lookAgain: blocker?.expectedResolution ?? d.nextMoveDate ?? null,
    }];
  });

  // ---------- 2 · Facturar: delivered, not invoiced ----------
  const invoice = deals.flatMap((d) => d.deliveries.filter((x) => !x.invoice).map((x) => {
    const reqs = readinessOf(d, x, i, now);
    const missing = reqs.filter((r) => r.state === "missing").map((r) => ({ key: r.key, label: r.label, detail: r.detail, cause: REQ_CAUSE[r.key], request: r.request }));
    const wd = workingDaysBetween(x.deliveredAt, now);
    const blocker = openBlocker(d, "INVOICE", (b) => !b.deliveryId || b.deliveryId === x.id);
    const att = delayAttribution(x.deliveredAt, now, d.cashBlockers.filter((b) => b.stage === "INVOICE" && (!b.deliveryId || b.deliveryId === x.id)));
    return {
      ...base(d), key: `invoice:${x.id}`, deliveryId: x.id, ref: x.code, deliveredAt: x.deliveredAt, days: Math.max(0, daysBetween(x.deliveredAt, now)), workingDays: wd,
      value: deliveryAmount(d, x), missing, ready: missing.length === 0, blocker, att, alert: wd > P.deliveredAlertWorkingDays,
      next: blocker?.nextMovement ?? (missing.length ? null : i.t("Emitir la factura", "Issue the invoice")), lookAgain: blocker?.expectedResolution ?? null,
    };
  }));

  // ---------- 3 · Cobrar: open invoices ----------
  const collect = deals.flatMap((d) => d.invoices.map((inv) => {
    const c = invoiceCash(inv);
    if (c.balance <= 0.005) return null;
    const b = pb.byId.get(d.accountId);
    const view = cashViewOf(inv, { n: b?.expected.n ?? 0, avg: b?.expected.avgDelay ?? 0 }, d.account.paymentTermsDays, i, now);
    const conf = confirmationOf(inv.steps);
    const aging = agingBucket(inv.dueAt, now, P.aging);
    const apps = inv.applications.map((a) => ({ amount: Number(a.amount), reconciled: !!a.payment.reconciledAt, receivedAt: a.payment.receivedAt }));
    const promises = inv.promises.map((p) => ({ p, ...promiseStatus({ promisedFor: p.promisedFor, createdAt: p.createdAt, amount: p.amount == null ? null : Number(p.amount), replacedAt: p.replacedAt }, { amount: Number(inv.amount), apps }, now) }));
    const latest = promises.find((x) => !x.p.replacedById) ?? null;
    const blocker = openBlocker(d, "COLLECT", (bl) => bl.invoiceId === inv.id);
    const issuedWd = workingDaysBetween(inv.issuedAt, now);
    const sinceConf = conf.at ? workingDaysBetween(conf.at, now) : issuedWd;
    // One stage per invoice (no double counting), most actionable first. Rules are shown on screen.
    let leak: LeakStage | null = null;
    if (conf.stage === "REJECTED") leak = "REJECTED";
    else if (latest && (latest.status === "MISSED" || latest.status === "PARTIALLY_KEPT")) leak = "PROMISE_MISSED";
    else if (aging.late > 0 && c.pendingReconcile < 0.005 && !(latest && latest.status === "OPEN")) leak = "DUE_UNPAID";
    else if (conf.stage === "ISSUED" && issuedWd > P.deliveredAlertWorkingDays) leak = "NOT_SUBMITTED";
    else if ((conf.stage === "SUBMITTED" || conf.stage === "RECEIVED") && sinceConf > P.acceptAlertWorkingDays) leak = "NOT_ACCEPTED";
    const promiseToday = latest?.status === "OPEN" && daysBetween(latest.p.promisedFor, now) === 0;
    const waiting = !!inv.collectWaitingFor && !!inv.collectNextAt && inv.collectNextAt >= now;
    const needs = leak === "REJECTED" || leak === "PROMISE_MISSED" || promiseToday || (leak === "DUE_UNPAID" && !waiting) || (leak != null && !inv.collectNext && !waiting);
    const open = Math.max(0, subMoney(c.balance, c.pendingReconcile));
    return {
      ...base(d), key: `collect:${inv.id}`, invoiceId: inv.id, number: inv.number, issuedAt: inv.issuedAt, dueAt: inv.dueAt,
      value: c.balance, open, cash: c, view, conf, steps: inv.steps, aging, promises, latest, blocker, leak, needs, promiseToday, waiting,
      collectNext: inv.collectNext, collectNextAt: inv.collectNextAt, collectWaitingFor: inv.collectWaitingFor, collectContact: inv.collectContact, collectByName: inv.collectByName, collectAt: inv.collectAt,
      lookAgain: inv.collectNextAt ?? (latest?.status === "OPEN" ? latest.p.promisedFor : null) ?? (inv.dueAt >= now ? inv.dueAt : null),
    };
  }).filter((x): x is NonNullable<typeof x> => !!x));

  // ---------- 4 · Liberar crédito ----------
  const openReviews = reviews.filter((r) => r.status === "OPEN");
  const creditItems = credit
    .filter((a) => a.limit != null && (a.blocking.length > 0 || a.used > a.limit * 0.8 || openReviews.some((r) => r.accountId === a.id)))
    .map((a) => {
      const blockingValue = sumMoney(a.blocking.map((d) => d.amount));
      const overdue = sumMoney(a.invoices.filter((x) => x.dueAt < now).map((x) => invoiceCash(x).balance));
      return {
        key: `credit:${a.id}`, accountId: a.id, account: a.name, ownerName: a.owner.name, limit: a.limit!, used: a.used, available: a.available!,
        openInvoices: a.openInvoices, committed: a.uninvoiced, overdue, blocking: a.blocking.map((d) => ({ id: d.id, code: d.code, title: d.title, amount: money2(d.amount) })),
        value: blockingValue || Math.max(0, a.used - a.limit!), over: a.used > a.limit!, review: openReviews.find((r) => r.accountId === a.id) ?? null,
        needs: a.blocking.length > 0 && !openReviews.some((r) => r.accountId === a.id),
      };
    });

  const sortBags = <T extends { value: number; needs?: boolean; alert?: boolean }>(xs: T[]) =>
    [...xs].sort((a, b) => Number(!!(b.needs ?? b.alert)) - Number(!!(a.needs ?? a.alert)) || b.value - a.value);

  // ---------- Leakage (§64) ----------
  const leakRows: LeakRow[] = [
    leakOf("READY_NOT_DELIVERED", deliver.filter((x) => x.alert).map((x) => ({ value: x.value, days: x.days, cause: x.blocker?.rootCause ?? null, dealId: x.dealId, label: `${x.dealCode ?? ""} · ${x.account}`, next: x.next }))),
    leakOf("DELIVERED_NOT_INVOICED", invoice.filter((x) => x.alert).map((x) => ({ value: x.value, days: x.days, cause: x.blocker?.rootCause ?? x.missing[0]?.cause ?? null, dealId: x.dealId, label: `${x.ref} · ${x.account}`, next: x.next }))),
    ...(["NOT_SUBMITTED", "REJECTED", "NOT_ACCEPTED", "DUE_UNPAID", "PROMISE_MISSED"] as const).map((st) =>
      leakOf(st, collect.filter((x) => x.leak === st).map((x) => ({
        value: x.value, days: st === "DUE_UNPAID" || st === "PROMISE_MISSED" ? x.aging.late : daysBetween(x.conf.at ?? x.issuedAt, now),
        cause: x.blocker?.rootCause ?? null, dealId: x.dealId, label: `${x.number} · ${x.account}`, next: x.collectNext,
      })))),
    leakOf("UNAPPLIED_CASH", unapplied.map((p) => ({ p, rest: subMoney(p.amount, sumMoney(p.applications.map((a) => a.amount))) })).filter((x) => x.rest > 0.005).map((x) => ({
      value: x.rest, days: Math.max(0, daysBetween(x.p.receivedAt, now)), cause: "ADMINISTRATION", dealId: null, label: `${x.p.reference ?? "—"} · ${x.p.account.name}`, next: null,
    }))),
  ];
  const leakTotal = sumMoney(leakRows.map((r) => r.value));

  // ---------- Cash conversion delay (§65): history, last 180 days ----------
  const blockersOf = (d: JDeal, stage: string) => d.cashBlockers.filter((b) => b.stage === stage);
  const iv = {
    READY_DELIVERED: [] as Span[], DELIVERED_INVOICED: [] as Span[], INVOICED_ACCEPTED: [] as Span[], DUE_CASH: [] as Span[], RECEIVED_RECONCILED: [] as Span[],
  };
  const cashDelay: number[] = [];
  for (const d of deals) {
    for (const s of d.shipments) {
      const del = s.deliveryId ? d.deliveries.find((x) => x.id === s.deliveryId) : null;
      if (!s.toCustomer && s.deliveredAt && del && del.deliveredAt >= since) iv.READY_DELIVERED.push(span(s.deliveredAt, del.deliveredAt, blockersOf(d, "DELIVER")));
    }
    for (const inv of d.invoices) {
      const delAt = inv.delivery?.deliveredAt;
      if (delAt && inv.issuedAt >= since) iv.DELIVERED_INVOICED.push(span(delAt, inv.issuedAt, blockersOf(d, "INVOICE").filter((b) => !b.deliveryId || b.deliveryId === inv.deliveryId)));
      const conf = confirmationOf(inv.steps);
      if (conf.acceptedAt && conf.acceptedAt >= since) iv.INVOICED_ACCEPTED.push(span(inv.issuedAt, conf.acceptedAt, blockersOf(d, "COLLECT").filter((b) => b.invoiceId === inv.id)));
      const f = invoiceFacts(toPayInvoice(inv), now);
      if (f.collected && f.paidAt! >= since) {
        iv.DUE_CASH.push(span(inv.dueAt, f.paidAt!, blockersOf(d, "COLLECT").filter((b) => b.invoiceId === inv.id), true));
        if (delAt) cashDelay.push(daysBetween(delAt, f.paidAt!));
      }
    }
  }
  const pays = await db.customerPayment.findMany({ where: { kind: "CASH", accountId: { in: accountIds }, reconciledAt: { gte: since } }, select: { receivedAt: true, reconciledAt: true } });
  for (const p of pays) iv.RECEIVED_RECONCILED.push(span(p.receivedAt, p.reconciledAt!, []));
  const intervals = (Object.keys(iv) as IntervalKey[]).map((k) => intervalStats(k, iv[k]));

  // ---------- Indicators (§68), each with its declared rule ----------
  const allInv = deals.flatMap((d) => d.invoices.map((inv) => ({ d, inv })));
  const due90 = allInv.filter(({ inv }) => inv.dueAt >= addDays(now, -90) && inv.dueAt <= now);
  const dueAmt = sumMoney(due90.map(({ inv }) => inv.amount));
  const gotAmt = sumMoney(due90.map(({ inv }) => invoiceCash(inv).reconciled));
  const issued90 = allInv.filter(({ inv }) => inv.issuedAt >= addDays(now, -90));
  const conf90 = issued90.filter(({ inv }) => confirmationOf(inv.steps).confirmed).length;
  const judged = collect.flatMap((x) => x.promises).concat(
    allInv.filter(({ inv }) => invoiceCash(inv).balance <= 0.005).flatMap(({ inv }) => {
      const apps = inv.applications.map((a) => ({ amount: Number(a.amount), reconciled: !!a.payment.reconciledAt, receivedAt: a.payment.receivedAt }));
      return inv.promises.map((p) => ({ p, ...promiseStatus({ promisedFor: p.promisedFor, createdAt: p.createdAt, amount: p.amount == null ? null : Number(p.amount), replacedAt: p.replacedAt }, { amount: Number(inv.amount), apps }, now) }));
    }),
  ).filter((x) => x.p.promisedFor >= since && ["KEPT", "PARTIALLY_KEPT", "MISSED"].includes(x.status));
  const decided = reviews.filter((r) => r.decidedAt && r.decidedAt >= since);
  const indicators = {
    collectionEffectiveness: { value: pct(gotAmt, dueAmt), got: gotAmt, due: dueAmt, n: due90.length },
    confirmationRate: { value: pct(conf90, issued90.length), confirmed: conf90, n: issued90.length },
    deliveredToInvoiced: { value: intervals.find((x) => x.key === "DELIVERED_INVOICED")!.median, n: iv.DELIVERED_INVOICED.length },
    readyAging: { value: median(deliver.map((x) => x.days)), oldest: deliver.length ? Math.max(...deliver.map((x) => x.days)) : null, n: deliver.length },
    promiseKept: { value: pct(judged.filter((x) => x.status === "KEPT").length, judged.length), kept: judged.filter((x) => x.status === "KEPT").length, n: judged.length },
    creditResolution: { value: median(decided.map((r) => daysBetween(r.createdAt, r.decidedAt!))), n: decided.length },
    cashConversion: { value: median(cashDelay), n: cashDelay.length },
    leakage: { value: leakTotal },
  };

  // ---------- Commission waiting for collection (§69) and working capital (§66) ----------
  let commission: { total: number; rows: { invoiceNumber: string | null; account: string; amount: number; state: string }[] } | null = null;
  if (!scope.light) try {
    const rows = (await computeCommissions(scope.ownerId ? { userId: scope.ownerId } : {})).rows.filter((r) => r.invoiceId && (r.collectionHalf.state === "ESTIMATED" || r.collectionHalf.state === "AT_RISK"));
    commission = { total: sumMoney(rows.map((r) => r.collectionHalf.amount)), rows: rows.map((r) => ({ invoiceNumber: r.invoiceNumber, account: r.account, amount: r.collectionHalf.amount, state: r.collectionHalf.state })) };
  } catch (e) { console.error("commission waiting failed", e); }

  const ar = sumMoney(collect.map((x) => x.value));
  const committed = sumMoney(deals.filter((d) => d.stage === "WON").map((d) => Math.max(0, subMoney(d.amount, sumMoney(d.invoices.map((x) => x.amount))))));
  const readyGoods = sumMoney(deliver.map((x) => x.value));
  const rate = await getFinanceRate();
  const total = sumMoney([ar, committed]);
  const capital = { ar, committed, readyGoods, total, annualPct: rate.annualPct, monthlyCost: rate.annualPct == null ? null : carryCost(total, 30, rate.annualPct) };

  return {
    now, policy,
    deliver: sortBags(deliver), invoice: sortBags(invoice), collect: sortBags(collect), credit: sortBags(creditItems),
    reviews, openReviews,
    leak: leakRows, leakTotal, intervals, indicators, commission, capital,
  };
}
export type CashJourney = Awaited<ReturnType<typeof loadCashJourney>>;

// ---------- Leakage and interval helpers ----------

export const LEAK_STAGES = ["READY_NOT_DELIVERED", "DELIVERED_NOT_INVOICED", "NOT_SUBMITTED", "REJECTED", "NOT_ACCEPTED", "DUE_UNPAID", "PROMISE_MISSED", "UNAPPLIED_CASH"] as const;
export type LeakStage = (typeof LEAK_STAGES)[number];
type LeakItem = { value: number; days: number; cause: string | null; dealId: string | null; label: string; next: string | null };
export type LeakRow = { stage: LeakStage; value: number; n: number; oldest: number; byClass: Record<CauseClass | "UNSET", number>; byCause: Partial<Record<RootCause, number>>; items: LeakItem[] };

function leakOf(stage: LeakStage, items: LeakItem[]): LeakRow {
  const byClass: LeakRow["byClass"] = { COMPANY: 0, CUSTOMER: 0, EXTERNAL: 0, UNSET: 0 };
  const byCause: LeakRow["byCause"] = {};
  for (const x of items) {
    const k = causeClass(x.cause) ?? "UNSET";
    byClass[k] = money2(byClass[k] + x.value);
    if (x.cause && k !== "UNSET") byCause[x.cause as RootCause] = money2((byCause[x.cause as RootCause] ?? 0) + x.value);
  }
  return { stage, value: sumMoney(items.map((x) => x.value)), n: items.length, oldest: items.length ? Math.max(...items.map((x) => x.days)) : 0, byClass, byCause, items: [...items].sort((a, b) => b.value - a.value) };
}

export const INTERVALS = ["READY_DELIVERED", "DELIVERED_INVOICED", "INVOICED_ACCEPTED", "DUE_CASH", "RECEIVED_RECONCILED"] as const;
export type IntervalKey = (typeof INTERVALS)[number];
type Span = { days: number; att: ReturnType<typeof delayAttribution> };

/** `signed`: due → cash can be negative (paid early); attribution only applies to the late part. */
function span(a: Date, b: Date, blockers: { blockedSince: Date; resolvedAt: Date | null; rootCause: string }[], signed = false): Span {
  const days = daysBetween(a, b);
  return { days: signed ? days : Math.max(0, days), att: delayAttribution(a, b, blockers) };
}
function intervalStats(key: IntervalKey, xs: Span[]) {
  const sum = (f: (s: Span) => number) => xs.reduce((t, s) => t + f(s), 0);
  const total = sum((s) => s.att.total);
  return {
    key, n: xs.length, median: median(xs.map((s) => s.days)), avg: xs.length ? Math.round((sum((s) => s.days) / xs.length) * 10) / 10 : null,
    split: { COMPANY: sum((s) => s.att.COMPANY), CUSTOMER: sum((s) => s.att.CUSTOMER), EXTERNAL: sum((s) => s.att.EXTERNAL), UNEXPLAINED: sum((s) => s.att.unexplained), total },
  };
}

export const statusTone = (s: PromiseStatus) => (s === "KEPT" ? "ok" : s === "OPEN" ? "wait" : s === "REPLACED" ? "dash" : s === "PARTIALLY_KEPT" ? "attn" : "risk");
