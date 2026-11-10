// Gerencia / Insights: a decision system, not an activity ranking.
// Everything here is computed from business records (results, promises, economics,
// Recoveries, futures). No message counts, call counts or time connected exist here.

import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, daysBetween, esagra } from "./domain";
import { causeOf, type CauseKey } from "./causes";

export type Filters = { owner?: string; sector?: string };

export const insightsInclude = {
  account: { select: { id: true, name: true, industry: true } },
  owner: { select: { id: true, name: true } },
  invoices: { select: { amount: true, esagraAtIssue: true, issuedAt: true } },
  deliveries: { select: { deliveredAt: true } },
  recoveries: true,
  continuity: { where: { resolvedAt: null } },
  quotes: { where: { presentedAt: { not: null } }, orderBy: { presentedAt: "desc" as const }, select: { status: true, number: true, rev: true, presentedAt: true, decisionAt: true, promiseDecideBy: true, protSale: true, protCost: true, protEsagra: true, supplierCost: true, freightCost: true, otherCosts: true } },
  supplierPos: { select: { id: true, code: true, shipBy: true, shippedAt: true, receivedAt: true, amount: true, currency: true, supplier: { select: { id: true, name: true } } } },
  shipments: { select: { carrierEta: true, deliveredAt: true, receipt: true, customs: true } },
  items: { select: { code: true, description: true } },
} satisfies Prisma.DealInclude;

export type IDeal = Prisma.DealGetPayload<{ include: typeof insightsInclude }>;

export async function loadInsightDeals(f: Filters) {
  // Insights looks back at most 12 months (+6 for trends): older closed history isn't loaded.
  const since = addDays(new Date(), -560);
  return db.deal.findMany({
    where: {
      internal: false,
      ...(f.owner ? { ownerId: f.owner } : {}), ...(f.sector ? { account: { industry: f.sector } } : {}),
      OR: [{ closedAt: null, stage: { not: "LOST" } }, { closedAt: { gte: since } }, { resultConfirmedAt: { gte: since } }, { updatedAt: { gte: since } }],
    },
    include: insightsInclude,
  });
}

export const monthStart = (d: Date, off = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, 1));
export const inMonth = (d: Date | null | undefined, m: Date) => !!d && d >= m && d < monthStart(m, 1);
export const bareName = (s: string) => s.replace(/ \(ejemplo\)$/, "");
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
export { median };

// ---------- Economics: protected (when the quote was presented) · current · final (invoiced) ----------

export function economicsOf(d: IDeal) {
  const q = d.quotes.find((x) => x.status === "ACCEPTED") ?? d.quotes[0] ?? null;
  const prot = q && q.protSale != null && q.protEsagra != null
    ? { sale: Number(q.protSale), value: Number(q.protEsagra), supplier: Number(q.supplierCost), freight: Number(q.freightCost) + Number(q.otherCosts), ref: `${q.number}${q.rev ? ` Rev. ${q.rev}` : ""}`, at: q.presentedAt }
    : null;
  const cur = esagra(d);
  const invoiced = d.invoices.reduce((s, x) => s + Number(x.amount), 0);
  const fully = d.invoices.length > 0 && (invoiced >= Number(d.amount) - 0.5 || !!d.closedAt);
  const final = fully ? { sale: invoiced, value: d.invoices.reduce((s, x) => s + Number(x.esagraAtIssue), 0), at: d.invoices.reduce((m, x) => (x.issuedAt > m ? x.issuedAt : m), d.invoices[0].issuedAt) } : null;
  // Where the protected esagra went: price, supplier cost or freight/other.
  let erosion: { amount: number; cause: CauseKey; parts: { price: number; supplier: number; freight: number } } | null = null;
  if (prot) {
    const parts = { price: Number(d.amount) - prot.sale, supplier: prot.supplier - Number(d.supplierCost), freight: prot.freight - Number(d.freightCost) - Number(d.otherCosts) };
    const lost = prot.value - (final?.value ?? cur.value);
    if (lost > 1) {
      const worst = (Object.entries(parts) as [keyof typeof parts, number][]).sort((a, b) => a[1] - b[1])[0][0];
      erosion = { amount: lost, parts, cause: worst === "price" ? "CUSTOMER" : worst === "supplier" ? "COST" : "LOGISTICS" };
    }
  }
  return { prot, cur: { sale: Number(d.amount), value: cur.value, pct: cur.pct }, final, erosion };
}

// ---------- Promise performance: original vs revised vs actual ----------

export type PromiseOutcome = "KEPT" | "REVISED_IN_TIME" | "MISSED";
export function promiseOf(d: IDeal) {
  const original = d.originalPromisedDate ?? d.promisedDate;
  if (!original) return null;
  const revised = d.promiseRevisions > 0 && d.promisedDate && d.promisedDate.getTime() !== original.getTime() ? d.promisedDate : null;
  const actual = d.deliveries.length ? d.deliveries.reduce((m, x) => (x.deliveredAt > m ? x.deliveredAt : m), d.deliveries[0].deliveredAt) : null;
  const revisedInTime = !!revised && !!d.promiseRevisedAt && d.promiseRevisedAt <= original;
  let outcome: PromiseOutcome | null = null;
  if (actual) outcome = actual <= original ? "KEPT" : revised && revisedInTime && actual <= revised ? "REVISED_IN_TIME" : "MISSED";
  const supplierLate = d.supplierPos.some((p) => p.shipBy && ((p.shippedAt && p.shippedAt > p.shipBy) || (!p.shippedAt && p.shipBy < new Date())));
  const changeCause: CauseKey | null = revised || outcome === "MISSED"
    ? (d.promiseChangeCause ? causeOf(d.promiseChangeCause) : supplierLate ? "SUPPLIER" : d.recoveries[0] ? causeOf(d.recoveries[0].cause, d.recoveries[0].whatChanged) : "UNKNOWN")
    : null;
  // Silent miss: delivered late without any revision or Recovery raised before the original date.
  const warned = revisedInTime || d.recoveries.some((r) => r.openedAt <= original);
  return { original, revised, revisedAt: d.promiseRevisedAt, revisedInTime, actual, outcome, deltaActual: actual ? daysBetween(original, actual) : null, deltaRevised: revised ? daysBetween(original, revised) : null, changeCause, silent: outcome === "MISSED" && !warned };
}

// ---------- Causality: cause → effect, each tied to a Journey ----------

export type Effect = "RESULT" | "RECOVERY" | "PROMISE" | "ESAGRA";
export type CauseRow = { cause: CauseKey; effect: Effect; deal: IDeal; amount?: number; text: string };

export function causesOf(d: IDeal): CauseRow[] {
  const out: CauseRow[] = [];
  for (const r of d.recoveries) out.push({ cause: causeOf(r.cause, r.whatChanged), effect: "RECOVERY", deal: d, text: r.whatChanged });
  const p = promiseOf(d);
  if (p?.changeCause) out.push({ cause: p.changeCause, effect: "PROMISE", deal: d, text: p.outcome === "MISSED" ? "MISSED" : "REVISED" });
  const e = economicsOf(d).erosion;
  if (e) out.push({ cause: e.cause, effect: "ESAGRA", deal: d, amount: e.amount, text: "" });
  if (d.resultState === "NOT_ACHIEVED" || d.resultState === "PARTIAL") {
    const r = d.recoveries[0];
    out.push({ cause: r ? causeOf(r.cause, r.whatChanged) : "UNKNOWN", effect: "RESULT", deal: d, text: d.actualResult ?? "" });
  }
  return out;
}

// ---------- Future by certainty (never added together) ----------

export type Certainty = "COMMITTED" | "EXPECTED" | "POSSIBLE" | "EXPLORATORY";
export const CERTAINTIES: Certainty[] = ["COMMITTED", "EXPECTED", "POSSIBLE", "EXPLORATORY"];
export type FutureItem = { key: string; deal: IDeal; amount: number | null; when: Date | null; basis: string; what: string };

export function futureOf(deals: IDeal[]) {
  const by: Record<Certainty, FutureItem[]> = { COMMITTED: [], EXPECTED: [], POSSIBLE: [], EXPLORATORY: [] };
  for (const d of deals) {
    if (d.closedAt || d.stage === "LOST" || d.resultState === "NO_LONGER_RELEVANT") {
      for (const c of d.continuity) by.EXPLORATORY.push({ key: c.id, deal: d, amount: null, when: c.triggerOn, basis: c.basis, what: c.what });
      continue;
    }
    const invoiced = d.invoices.reduce((s, x) => s + Number(x.amount), 0);
    if (d.stage === "WON") {
      const bal = Math.max(0, Number(d.amount) - invoiced);
      if (bal > 0.5) by.COMMITTED.push({ key: d.id, deal: d, amount: bal, when: d.promisedDate ?? d.neededBy, basis: d.customerPo ? `PO ${d.customerPo}` : "PO", what: d.title });
    } else if (d.stage === "PROPOSAL" || d.stage === "NEGOTIATION") {
      const q = d.quotes[0];
      by.EXPECTED.push({ key: d.id, deal: d, amount: Number(d.amount), when: q?.promiseDecideBy ?? q?.decisionAt ?? d.closeDate, basis: q ? `${q.number}${q.rev ? ` Rev. ${q.rev}` : ""}` : "—", what: d.title });
    } else if (Number(d.amount) > 0 || d.needSpecs) {
      by.POSSIBLE.push({ key: d.id, deal: d, amount: Number(d.amount) || null, when: d.closeDate ?? d.neededBy, basis: d.needSpecs ? "need" : "—", what: d.title });
    } else {
      by.EXPLORATORY.push({ key: d.id, deal: d, amount: null, when: d.neededBy, basis: "lead", what: d.title });
    }
    for (const c of d.continuity) by.EXPLORATORY.push({ key: c.id, deal: d, amount: null, when: c.triggerOn, basis: c.basis, what: c.what });
  }
  return by;
}

/** Buckets: late / this month / next / +2 / later / no date. */
export function horizon(items: FutureItem[], now: Date) {
  const m0 = monthStart(now);
  const keys = ["late", "m0", "m1", "m2", "later", "none"] as const;
  const b = Object.fromEntries(keys.map((k) => [k, { n: 0, amount: 0 }])) as Record<(typeof keys)[number], { n: number; amount: number }>;
  for (const it of items) {
    const k = !it.when ? "none" : it.when < now ? "late" : it.when < monthStart(m0, 1) ? "m0" : it.when < monthStart(m0, 2) ? "m1" : it.when < monthStart(m0, 3) ? "m2" : "later";
    b[k].n++; b[k].amount += it.amount ?? 0;
  }
  return { keys, b };
}

// ---------- Promises ahead at risk (next 30 days) ----------

export function promisesAhead(deals: IDeal[], now: Date) {
  const end = addDays(now, 30);
  return deals
    .filter((d) => d.stage === "WON" && !d.closedAt && d.promisedDate && d.promisedDate >= addDays(now, -3) && d.promisedDate <= end && !d.deliveries.length)
    .map((d) => {
      const why: string[] = [];
      const late = d.supplierPos.find((p) => p.shipBy && !p.shippedAt && p.shipBy < now);
      if (late) why.push(`SUPPLIER:${late.supplier.name}:${daysBetween(late.shipBy!, now)}`);
      const eta = d.shipments.find((s) => s.carrierEta && d.promisedDate && s.carrierEta > d.promisedDate && !s.deliveredAt);
      if (eta) why.push(`ETA:${daysBetween(d.promisedDate!, eta.carrierEta!)}`);
      if (d.shipments.some((s) => s.customs === "HOLD")) why.push("CUSTOMS");
      if (d.recoveries.some((r) => !r.resolvedAt)) why.push("RECOVERY");
      if (!d.supplierPos.length) why.push("NO_SPO");
      return { d, why };
    })
    .sort((a, b) => b.why.length - a.why.length || a.d.promisedDate!.getTime() - b.d.promisedDate!.getTime());
}

// ---------- Supplier dependency of committed future ----------

export function dependencies(deals: IDeal[], now: Date) {
  const sup = new Map<string, { id: string; name: string; committed: number; journeys: Set<string>; onTime: number; measured: number }>();
  const yearAgo = addDays(now, -365);
  for (const d of deals) {
    for (const p of d.supplierPos) {
      const s = sup.get(p.supplier.id) ?? { id: p.supplier.id, name: p.supplier.name, committed: 0, journeys: new Set<string>(), onTime: 0, measured: 0 };
      if (p.shipBy && p.shippedAt && p.shippedAt >= yearAgo) { s.measured++; if (p.shippedAt <= p.shipBy) s.onTime++; }
      sup.set(p.supplier.id, s);
    }
    if (d.stage !== "WON" || d.closedAt) continue;
    const open = d.supplierPos.filter((p) => !p.receivedAt);
    if (!open.length) continue;
    const bal = Math.max(0, Number(d.amount) - d.invoices.reduce((s, x) => s + Number(x.amount), 0));
    for (const p of open) { const s = sup.get(p.supplier.id)!; s.committed += bal / open.length; s.journeys.add(d.id); }
  }
  return [...sup.values()].filter((s) => s.committed > 0).sort((a, b) => b.committed - a.committed);
}

// ---------- Patterns with context (customer / supplier / product) ----------

export type Pattern = { key: string; kind: "CUSTOMER" | "SUPPLIER" | "PRODUCT" | "CAUSE"; title: string; context: string; href: string; n: number };

export function patternsOf(deals: IDeal[], now: Date, t: (es: string, en: string) => string, causeName: (c: string) => string): Pattern[] {
  const out: Pattern[] = [];
  const since = addDays(now, -365);
  const recent = deals.filter((d) => (d.resultConfirmedAt ?? d.createdAt) >= since);
  // Customers with repeated partial / not achieved / Recovery.
  const byAcc = new Map<string, { name: string; id: string; bad: IDeal[]; all: number }>();
  for (const d of recent.filter((x) => x.stage === "WON")) {
    const a = byAcc.get(d.account.id) ?? { name: bareName(d.account.name), id: d.account.id, bad: [], all: 0 };
    a.all++;
    if (d.resultState === "PARTIAL" || d.resultState === "NOT_ACHIEVED" || d.recoveries.length) a.bad.push(d);
    byAcc.set(d.account.id, a);
  }
  for (const a of byAcc.values()) if (a.bad.length >= 2) out.push({ key: `c${a.id}`, kind: "CUSTOMER", n: a.bad.length, href: `/accounts/${a.id}`, title: t(`${a.name}: ${a.bad.length} de ${a.all} Journeys necesitaron Recovery o no lograron todo`, `${a.name}: ${a.bad.length} of ${a.all} Journeys needed Recovery or fell short`), context: a.bad.map((d) => `${d.code} · ${causeName(d.recoveries[0] ? causeOf(d.recoveries[0].cause, d.recoveries[0].whatChanged) : "UNKNOWN")}`).join(" · ") });
  // Suppliers shipping late repeatedly.
  for (const s of dependencies(deals, now).concat([]))
    if (s.measured >= 3 && s.onTime / s.measured < 0.75) out.push({ key: `s${s.id}`, kind: "SUPPLIER", n: s.measured - s.onTime, href: `/suppliers/${s.id}`, title: t(`${bareName(s.name)}: ${s.measured - s.onTime} de ${s.measured} despachos tarde en 12 meses`, `${bareName(s.name)}: ${s.measured - s.onTime} of ${s.measured} shipments late in 12 months`), context: t(`y ${s.journeys.size} Journey(s) comprometido(s) dependen hoy de él`, `and ${s.journeys.size} committed Journey(s) depend on it today`) });
  // Suppliers late even without open dependency.
  const allSup = new Map<string, { id: string; name: string; late: number; n: number }>();
  for (const d of deals) for (const p of d.supplierPos) if (p.shipBy && p.shippedAt && p.shippedAt >= since) { const s = allSup.get(p.supplier.id) ?? { id: p.supplier.id, name: p.supplier.name, late: 0, n: 0 }; s.n++; if (p.shippedAt > p.shipBy) s.late++; allSup.set(p.supplier.id, s); }
  for (const s of allSup.values()) if (s.n >= 3 && s.late / s.n > 0.25 && !out.some((o) => o.key === `s${s.id}`)) out.push({ key: `s${s.id}`, kind: "SUPPLIER", n: s.late, href: `/suppliers/${s.id}`, title: t(`${bareName(s.name)}: ${s.late} de ${s.n} despachos tarde en 12 meses`, `${bareName(s.name)}: ${s.late} of ${s.n} shipments late in 12 months`), context: t("sin Journeys comprometidos con él hoy", "no committed Journeys with it today") });
  // Products where the solution failed (contradicting evidence or Recovery).
  const byCode = new Map<string, { code: string; desc: string; deals: IDeal[] }>();
  for (const d of deals) if (d.recoveries.length || d.resultState === "NOT_ACHIEVED") for (const it of d.items) { if (!it.code) continue; const p = byCode.get(it.code) ?? { code: it.code, desc: it.description, deals: [] }; p.deals.push(d); byCode.set(it.code, p); }
  for (const p of byCode.values()) out.push({ key: `p${p.code}`, kind: "PRODUCT", n: p.deals.length, href: `/productos/${encodeURIComponent(p.code)}`, title: t(`${p.code} ${p.desc}: falló en ${p.deals.length} Journey(s)`, `${p.code} ${p.desc}: failed in ${p.deals.length} Journey(s)`), context: p.deals.map((d) => `${bareName(d.account.name)} · ${causeName(d.recoveries[0] ? causeOf(d.recoveries[0].cause, d.recoveries[0].whatChanged) : "UNKNOWN")}`).join(" · ") });
  // Repeated material cause.
  const causes = new Map<string, Set<string>>();
  for (const d of recent) for (const c of causesOf(d)) if (c.cause !== "UNKNOWN") { const s = causes.get(c.cause) ?? new Set<string>(); s.add(d.id); causes.set(c.cause, s); }
  for (const [c, s] of causes) if (s.size >= 2) out.push({ key: `k${c}`, kind: "CAUSE", n: s.size, href: `/gerencia?view=causas&cause=${c}`, title: t(`${causeName(c)}: se repite en ${s.size} Journeys`, `${causeName(c)}: repeats in ${s.size} Journeys`), context: t("ver el análisis de causas", "see the cause analysis") });
  return out.sort((a, b) => b.n - a.n);
}
