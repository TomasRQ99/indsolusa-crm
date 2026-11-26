import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { SessionUser } from "./auth";
import { canManageAll, isMoneyRole } from "./permissions";
import { leaderIdsOf, reportIdsOf } from "./team-store";
import { monthOf } from "./customer-stats";
import { historyFor, type FactScope } from "./sales-history";
import { SOURCE_TXT } from "./sales-history-rules";
import {
  BUDGET_RULES, KPIS, KPI_KEYS, PROSPECTS, attribute, catchAll, measured, monthKey, projectClose, seasonShares, zeros,
  type Basis, type Kpi, type Measured,
} from "./sales-budget-rules";

// Presupuesto comercial · reads. Every real figure is a dated record of SOLU (a Need, a presented quote, an accepted
// purchase order, an invoice) in dollars, the currency SOLU prices in (owner's decision 2026-11-26: the budget works
// in dollars, not pesos). A document made in pesos keeps its own figure, rate and source beside its dollars, so any
// total can be opened and checked (spec §2, §3 "Hecho comercial"). The indicator keys keep their first names
// (OC_COP, FACT_COP…): they are stored identifiers, not a currency.
// Attribution: by the owner of the Need. One owner per Need, so a document is always attributed 100 % once (AT-13).

type Txt = { es: string; en: string };
export type Fact = {
  kpi: Kpi; at: Date; month: string; accountId: string; ownerId: string;
  /** Value in dollars (or the count); null = a figure loaded in pesos whose month has no TRM stored (never guessed). */
  usd: number | null;
  /** The figure as recorded: amount and currency (counts carry 1). */
  orig: number; currency: string;
  rate: number | null; rateDay: string | null; rateSource: Txt | null;
  text: string; href: string;
  /** Set on a figure loaded from before SOLU (a month's total, not one document): the load it came from. */
  loaded?: string;
  /** Cases behind a loaded month's total (its number of purchase orders); a SOLU record is always one case. */
  cases?: number;
  /** The site or plant of the Need the record belongs to, when the Need names one. */
  plantId?: string | null;
  /** Set when the Need is shared between negotiators: the percent of the document this figure carries. */
  sharePct?: number;
};
/** One Need as a cohort case for the batting rates. */
export type Cohort = { accountId: string; ownerId: string; created: Date; quotedAt: Date | null; decided: boolean; won: boolean; cotUsd: number | null; ocUsd: number };
export type FactSet = { facts: Fact[]; cohorts: Cohort[]; backlog: { accountId: string; ownerId: string; usd: number }[]; noRate: number };

const FIXED: Txt = { es: "Tasa fija de la cotización", en: "The quote's fixed rate" };
const TRM_MONTH: Txt = { es: "TRM oficial promedio del mes", en: "Average official TRM of the month" };
/** Where a loaded figure of a company opens: the rows loaded for that company. */
export const historyHref = (accountId: string, month?: string) => `/comercial/presupuesto/historial?e=${accountId}${month ? `#m-${month}` : ""}`;
const MAX_SYNTH = 500;

/** The dated records behind the budget screens. `scope` narrows what is read: the Needs of some companies or of
 *  some people (either one is enough); empty = everything. The history loaded from before SOLU joins them for the
 *  months before each company's first Need (see sales-history.ts). */
export async function loadFacts(scope: FactScope = {}): Promise<FactSet> {
  const or: Prisma.DealWhereInput[] = [];
  if (scope.accountIds) or.push({ accountId: { in: scope.accountIds } });
  // A person's figures include their part of the Needs someone else leads and shares with them.
  if (scope.ownerIds) or.push({ ownerId: { in: scope.ownerIds } }, { salesShares: { some: { userId: { in: scope.ownerIds } } } });
  const [deals, history] = await Promise.all([db.deal.findMany({
    where: { internal: false, ...(or.length ? { OR: or } : {}) },
    select: {
      id: true, code: true, title: true, accountId: true, ownerId: true, createdAt: true, plantId: true,
      salesShares: { select: { userId: true, pct: true } },
      quotes: { where: { presentedAt: { not: null } }, orderBy: { presentedAt: "asc" }, select: { id: true, number: true, presentedAt: true, protSale: true, protEsagra: true, status: true, currency: true, docFxRate: true } },
      customerPos: { where: { rejectedAt: null }, select: { id: true, number: true, currency: true, docFxRate: true, quoteId: true, acceptance: { select: { acceptedAt: true } }, lines: { select: { qty: true, unitPrice: true, docUnitPrice: true } } } },
      invoices: { select: { id: true, number: true, issuedAt: true, amount: true, docCurrency: true, quote: { select: { docFxRate: true } } } },
      deliveries: { select: { id: true, code: true, deliveredAt: true } },
    },
  }), historyFor(scope)]);
  const facts: Fact[] = [], cohorts: Cohort[] = [], backlog: FactSet["backlog"] = [];
  let noRate = 0;
  const cents = (v: number) => Math.round(v * 100) / 100;
  /** A SOLU document always has its dollar value. One made in pesos also shows its peso figure at its fixed rate. */
  const doc = (usd: number, fixed: number | null, pesos?: number) => fixed && fixed > 0
    ? { usd: cents(usd), orig: pesos ?? Math.round(usd * fixed), currency: "COP", rate: fixed as number | null, rateDay: null as string | null, rateSource: FIXED as Txt | null }
    : { usd: cents(usd), orig: cents(usd), currency: "USD", rate: null as number | null, rateDay: null as string | null, rateSource: null as Txt | null };
  for (const d of deals) {
    const base = { accountId: d.accountId, ownerId: d.ownerId };
    const name = `${d.code ?? ""} ${d.title}`.trim();
    // Shared Need (AT-13): its money figures are split by the agreed percentages; the owner keeps what is left, so
    // the parts always add up to the document. Counts stay whole with the owner.
    const others = d.salesShares.filter((x) => x.userId !== d.ownerId && Number(x.pct) > 0).map((x) => ({ userId: x.userId, pct: Number(x.pct) }));
    const given = others.reduce((s, x) => s + x.pct, 0);
    const shared = others.length > 0 && given < 100;
    const split = (v: number) => { const parts = others.map((x) => ({ ownerId: x.userId, pct: x.pct, v: cents((v * x.pct) / 100) })); return [{ ownerId: d.ownerId, pct: Math.round((100 - given) * 100) / 100, v: cents(v - parts.reduce((s, x) => s + x.v, 0)) }, ...parts]; };
    const push = (kpi: Kpi, at: Date, f: Omit<Fact, "kpi" | "at" | "month" | "accountId" | "ownerId">) => {
      const common = { kpi, at, month: monthOf(at), accountId: d.accountId, plantId: d.plantId };
      if (!shared || KPIS[kpi].unit === "n" || f.usd == null) { facts.push({ ...common, ownerId: d.ownerId, ...f }); return; }
      for (const p of split(f.usd)) facts.push({ ...common, ownerId: p.ownerId, ...f, usd: p.v, orig: Math.round(f.orig * p.pct) / 100, text: `${f.text} · ${p.pct} %`, sharePct: p.pct });
    };
    const one = { usd: 1, orig: 1, currency: "", rate: null, rateDay: null, rateSource: null };
    push("SOL_N", d.createdAt, { ...one, text: name, href: `/deals/${d.id}` });
    // Quotes: one per Need, in the month of the first presentation, valued at the last presented revision (AT-03).
    const q0 = d.quotes[0], qLast = d.quotes[d.quotes.length - 1];
    let cotUsd: number | null = null;
    if (q0?.presentedAt && qLast) {
      const v = doc(Number(qLast.protSale ?? 0), qLast.currency === "COP" && qLast.docFxRate ? Number(qLast.docFxRate) : null);
      cotUsd = v.usd;
      push("COT_N", q0.presentedAt, { ...one, text: `${qLast.number} · ${name}`, href: `/cotizaciones/${qLast.id}` });
      push("COT_COP", q0.presentedAt, { ...v, text: `${qLast.number} · ${name}`, href: `/cotizaciones/${qLast.id}` });
    }
    // Purchase orders: accepted ones, on the date they were accepted. A rejected or not yet accepted one is not real.
    let ocUsd = 0, accepted = 0;
    for (const p of d.customerPos) {
      if (!p.acceptance) continue;
      accepted++;
      const at = p.acceptance.acceptedAt;
      const usd = p.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0);
      const fixed = p.currency === "COP" && p.docFxRate ? Number(p.docFxRate) : null;
      const inPesos = fixed && p.lines.every((l) => l.docUnitPrice != null);
      const v = doc(usd, fixed, inPesos ? Math.round(p.lines.reduce((s, l) => s + l.qty * Number(l.docUnitPrice), 0)) : undefined);
      const text = `OC ${p.number} · ${name}`, href = `/po/${p.id}`;
      push("OC_N", at, { ...one, text, href });
      push("OC_COP", at, { ...v, text, href });
      ocUsd += v.usd;
      // Eságara of the order: the order's value at the margin of its quote (the linked one, else the last presented).
      const q = d.quotes.find((x) => x.id === p.quoteId) ?? qLast;
      const sale = Number(q?.protSale ?? 0);
      if (q && sale > 0 && q.protEsagra != null) { const e = cents((v.usd * Number(q.protEsagra)) / sale); push("ESA_COP", at, { usd: e, orig: e, currency: "USD", rate: null, rateDay: null, rateSource: null, text, href }); }
    }
    let factUsd = 0;
    for (const inv of d.invoices) {
      const v = doc(Number(inv.amount), inv.docCurrency === "COP" && inv.quote?.docFxRate ? Number(inv.quote.docFxRate) : null);
      push("FACT_COP", inv.issuedAt, { ...v, text: `${inv.number} · ${name}`, href: `/deals/${d.id}/facturacion` });
      factUsd += v.usd;
    }
    // Deliveries confirmed to the customer, on the real delivery date (a partial delivery is one delivery).
    for (const dl of d.deliveries) push("ENT_N", dl.deliveredAt, { ...one, text: `${dl.code} · ${name}`, href: `/deals/${d.id}` });
    if (ocUsd > factUsd) { if (shared) for (const p of split(ocUsd - factUsd)) backlog.push({ accountId: d.accountId, ownerId: p.ownerId, usd: p.v }); else backlog.push({ ...base, usd: cents(ocUsd - factUsd) }); }
    const won = accepted > 0 || d.quotes.some((q) => q.status === "ACCEPTED");
    cohorts.push({ ...base, created: d.createdAt, quotedAt: q0?.presentedAt ?? null, won, decided: won || d.quotes.some((q) => q.status === "DECLINED"), cotUsd, ocUsd });
  }
  // Loaded history: one figure per company, person, month and indicator, dated in the middle of its month.
  const months = new Map<string, Partial<Record<Kpi, number>> & { accountId: string; ownerId: string; month: string }>();
  for (const h of history) {
    const key = `${h.accountId}|${h.ownerId}|${h.month}`;
    const m = months.get(key) ?? { accountId: h.accountId, ownerId: h.ownerId, month: h.month };
    m[h.kpi] = (m[h.kpi] ?? 0) + h.value;
    months.set(key, m);
  }
  for (const h of history) {
    const at = new Date(`${h.month}-15T17:00:00Z`);
    const pesos = h.currency === "COP";
    const ocN = months.get(`${h.accountId}|${h.ownerId}|${h.month}`)?.OC_N ?? 0;
    facts.push({
      kpi: h.kpi, at, month: h.month, accountId: h.accountId, ownerId: h.ownerId, usd: h.value, orig: h.orig, currency: h.currency,
      rate: pesos ? h.rate : null, rateDay: null, rateSource: pesos ? TRM_MONTH : null,
      text: `${SOURCE_TXT[h.source].es} · ${h.label}`, href: historyHref(h.accountId, h.month), loaded: h.batchId,
      cases: h.kpi === "OC_COP" || h.kpi === "ESA_COP" ? ocN : 1,
    });
  }
  // The batting rates of loaded months come from the month's totals: so many requests, so many of them quoted, so
  // many quotes won. Each is one finished case of that month (history from before SOLU has no open quotes).
  for (const m of months.values()) {
    const s = m.SOL_N ?? 0, c = m.COT_N ?? 0, o = Math.min(m.OC_N ?? 0, c);
    const n = Math.min(Math.max(s, c), MAX_SYNTH);
    const at = new Date(`${m.month}-15T17:00:00Z`);
    for (let k = 0; k < n; k++) {
      const quoted = k < c, won = k < o;
      cohorts.push({ accountId: m.accountId, ownerId: m.ownerId, created: at, quotedAt: quoted ? at : null, decided: quoted, won, cotUsd: quoted && m.COT_COP != null && c > 0 ? m.COT_COP / c : null, ocUsd: won && o > 0 ? (m.OC_COP ?? 0) / o : 0 });
    }
  }
  return { facts, cohorts, backlog, noRate };
}

export type FactPick = (x: { accountId: string; ownerId: string }) => boolean;
/** kpi + month → total in dollars (or count) of the facts picked. Facts without a rate are left out of money totals. */
export function totals(set: FactSet, pick: FactPick) {
  const m = new Map<string, number>();
  let first: string | null = null;
  for (const f of set.facts) {
    if (!pick(f)) continue;
    if (!first || f.month < first) first = f.month;
    if (f.usd == null) continue;
    const k = `${f.kpi}|${f.month}`;
    m.set(k, (m.get(k) ?? 0) + f.usd);
  }
  const of = (kpi: Kpi, month: string) => m.get(`${kpi}|${month}`) ?? 0;
  return { of, first, year: (kpi: Kpi, year: number) => Array.from({ length: 12 }, (_, i) => of(kpi, monthKey(year, i + 1))) };
}

const shiftMonth = (key: string, k: number) => { const [y, m] = key.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
/** `n` complete months before `current`, oldest first. */
export const lastMonths = (current: string, n: number) => Array.from({ length: n }, (_, k) => shiftMonth(current, k - n));

/** The batting rates of the cohorts picked, on the window of the rules. */
function rates(set: FactSet, pick: FactPick, now: Date): { ticket: Measured; convSC: Measured; bateoN: Measured; bateoV: Measured; margin: Measured } {
  const R = BUDGET_RULES;
  const current = monthOf(now);
  const from = shiftMonth(current, -R.windowMonths);
  const inWin = (d: Date) => monthOf(d) >= from;
  const mature = new Date(now.getTime() - R.matureDays * 864e5);
  const cs = set.cohorts.filter(pick);
  const asked = cs.filter((c) => inWin(c.created) && c.created <= mature);
  const decided = cs.filter((c) => c.quotedAt && inWin(c.quotedAt) && c.decided);
  const valued = decided.filter((c) => c.cotUsd != null && c.cotUsd > 0);
  let oc = 0, ocN = 0, esa = 0, ocWithEsa = 0, esaN = 0;
  const esaKeys = new Set<string>();
  // A SOLU record is one case; a loaded month's total stands for as many cases as purchase orders it says it had
  // (none stated = it cannot feed the average value of an order).
  const key = (f: Fact) => `${f.href}|${f.ownerId}`;
  for (const f of set.facts) if (f.kpi === "ESA_COP" && pick(f) && f.month >= from && f.usd != null) { esa += f.usd; esaN += Math.max(1, f.cases ?? 1); esaKeys.add(key(f)); }
  for (const f of set.facts) if (f.kpi === "OC_COP" && pick(f) && f.month >= from && f.usd != null) { const n = f.cases ?? 1; if (n > 0) { oc += f.usd; ocN += n; } if (esaKeys.has(key(f))) ocWithEsa += f.usd; }
  const byValue = measured(valued.filter((c) => c.won).length, valued.length);
  const cot = valued.reduce((s, c) => s + c.cotUsd!, 0), got = valued.reduce((s, c) => s + c.ocUsd, 0);
  return {
    ticket: { value: ocN >= R.minCases ? Math.round(oc / ocN) : null, n: [ocN, ocN] },
    convSC: measured(asked.filter((c) => c.quotedAt).length, asked.length),
    bateoN: measured(decided.filter((c) => c.won).length, decided.length),
    // By value: what the decided quotes brought in orders over what they quoted (controls partial and larger orders).
    bateoV: { value: byValue.value != null && cot > 0 && got > 0 ? Math.round((got / cot) * 1000) / 10 : null, n: byValue.n },
    margin: { value: esaN >= R.minCases && ocWithEsa > 0 ? Math.round((esa / ocWithEsa) * 1000) / 10 : null, n: [esaN, esaN] },
  };
}

export type Scoped = Measured & { scope: "EMPRESA" | "CARTERA" | "NONE" };
export type BasisX = Omit<Basis, "ticket" | "convSC" | "bateoN" | "bateoV" | "margin"> & { ticket: Scoped; convSC: Scoped; bateoN: Scoped; bateoV: Scoped; margin: Scoped };

/** What the history gives to suggest a budget: `pick` = the company's facts that belong to this negotiator's budget;
 *  `portfolio` = all of the negotiator's facts, used for a rate the company alone cannot back (and said so). */
export function basisFor(set: FactSet, year: number, now: Date, pick: FactPick, portfolio: FactPick | null): BasisX {
  const baseYear = year - 1;
  const current = monthOf(now);
  const t = totals(set, pick);
  const oc = projectClose((m) => t.of("OC_COP", m), baseYear, current, t.first);
  const fact = projectClose((m) => t.of("FACT_COP", m), baseYear, current, t.first);
  // Seasonality reads up to 36 complete months, from the first month with history.
  const span = lastMonths(current, 36).filter((m) => t.first != null && m >= t.first);
  const own = rates(set, pick, now), wide = portfolio ? rates(set, portfolio, now) : null;
  const scoped = (k: keyof typeof own): Scoped => own[k].value != null ? { ...own[k], scope: "EMPRESA" } : wide && wide[k].value != null ? { ...wide[k], scope: "CARTERA" } : { ...own[k], scope: "NONE" };
  return {
    baseYear, ocClose: oc.close, factClose: fact.close, ocSoFar: oc.soFar, factSoFar: fact.soFar, monthsUsed: oc.used,
    seasonOc: seasonShares(span.map((key) => ({ key, value: t.of("OC_COP", key) }))),
    seasonFact: seasonShares(span.map((key) => ({ key, value: t.of("FACT_COP", key) }))),
    ticket: scoped("ticket"), convSC: scoped("convSC"), bateoN: scoped("bateoN"), bateoV: scoped("bateoV"), margin: scoped("margin"),
    backlog: set.backlog.filter(pick).reduce((s, b) => s + b.usd, 0),
  };
}

// ---------- Budgets ----------

const budgetInclude = { lines: true, account: { select: { id: true, name: true, ownerId: true } }, user: { select: { id: true, name: true } } } satisfies Prisma.SalesBudgetInclude;
export type BudgetRow = Prisma.SalesBudgetGetPayload<{ include: typeof budgetInclude }>;
export const budgetKey = (b: { slot: string; userId: string }) => `${b.slot}|${b.userId}`;

/** Every version of the year's budgets (optionally of some people), oldest first. */
export const budgetsOf = (year: number, userIds?: string[]) =>
  db.salesBudget.findMany({ where: { year, ...(userIds ? { userId: { in: userIds } } : {}) }, include: budgetInclude, orderBy: [{ createdAt: "asc" }, { version: "asc" }] });

export type Versions = { key: string; latest: BudgetRow; official: BudgetRow | null; all: BudgetRow[] };
/** Per company and negotiator: the latest version (any state) and the official one (approved, not superseded). */
export function groupVersions(rows: BudgetRow[]): Map<string, Versions> {
  const out = new Map<string, Versions>();
  for (const b of rows) {
    const key = budgetKey(b);
    const g = out.get(key) ?? { key, latest: b, official: null, all: [] };
    g.all.push(b);
    if (b.version >= g.latest.version) g.latest = b;
    if (b.state === "APPROVED" && !b.supersededAt) g.official = b;
    out.set(key, g);
  }
  return out;
}

export type Matrix = Record<Kpi, (number | null)[]>;
/** A budget's lines as twelve months per indicator; null = that month's figure has no basis yet. */
export function matrixOf(b: { lines: { month: number; kpi: string; value: Prisma.Decimal }[] } | null): Matrix {
  const out = Object.fromEntries(KPI_KEYS.map((k) => [k, Array.from({ length: 12 }, () => null as number | null)])) as Matrix;
  for (const l of b?.lines ?? []) if (out[l.kpi as Kpi] && l.month >= 1 && l.month <= 12) out[l.kpi as Kpi][l.month - 1] = Number(l.value);
  return out;
}
export const numbers = (xs: (number | null)[]) => xs.map((x) => x ?? 0);

export const yearRow = (year: number) => db.salesBudgetYear.findUnique({ where: { year } });
export type Corporate = Partial<Record<"OC_COP" | "FACT_COP" | "ESA_COP", number>>;
export const corporateOf = (y: { corporate: Prisma.JsonValue | null } | null): Corporate => {
  const o = (y?.corporate && typeof y.corporate === "object" && !Array.isArray(y.corporate) ? y.corporate : {}) as Record<string, unknown>;
  const out: Corporate = {};
  for (const k of ["OC_COP", "FACT_COP", "ESA_COP"] as const) { const n = Number(o[k]); if (Number.isFinite(n) && n > 0) out[k] = n; }
  return out;
};

// ---------- Who sees and decides what ----------

type U = Pick<SessionUser, "id" | "role">;

/** Whose budgets this person may read: everyone's for Gerencia, Dirección Comercial, Finanzas and Administración;
 *  otherwise their own and those of the people they lead. */
export async function budgetScope(user: U): Promise<{ all: boolean; ids: Set<string> }> {
  if (canManageAll(user) || isMoneyRole(user.role)) return { all: true, ids: new Set() };
  return { all: false, ids: new Set([user.id, ...(await reportIdsOf(user.id))]) };
}
/** A proposal is written by its negotiator, or by Gerencia / Dirección Comercial for them. */
export const canWriteBudget = (user: U, ownerId: string) => user.id === ownerId || canManageAll(user);
/** Who approves a negotiator's budgets: their assigned leader(s). Only when nobody leads them, Gerencia or
 *  Dirección Comercial. Never the negotiator themselves. */
export async function approverIdsOf(ownerId: string): Promise<{ ids: string[]; byLeader: boolean }> {
  const leaders = await leaderIdsOf(ownerId);
  if (leaders.length) return { ids: leaders, byLeader: true };
  const managers = await db.user.findMany({ where: { active: true, role: { in: ["GERENCIA", "DIRECTOR_COMERCIAL"] }, id: { not: ownerId } }, select: { id: true } });
  return { ids: managers.map((m) => m.id), byLeader: false };
}

/** The companies a person can budget: the ones they own, the ones they have Needs with, and the ones already
 *  budgeted for them. */
export async function companiesOf(userId: string, year: number) {
  const [owned, viaDeals, budgeted, loaded] = await Promise.all([
    db.account.findMany({ where: { ownerId: userId, internal: false }, select: { id: true, name: true, industry: true, ownerId: true } }),
    db.deal.findMany({ where: { ownerId: userId, internal: false }, distinct: ["accountId"], select: { account: { select: { id: true, name: true, industry: true, ownerId: true, internal: true } } } }),
    db.salesBudget.findMany({ where: { year, userId, accountId: { not: null } }, distinct: ["accountId"], select: { account: { select: { id: true, name: true, industry: true, ownerId: true } } } }),
    db.salesHistoryMonth.findMany({ where: { userId, batch: { state: "APPLIED" }, account: { internal: false } }, distinct: ["accountId"], select: { account: { select: { id: true, name: true, industry: true, ownerId: true } } } }),
  ]);
  const map = new Map<string, { id: string; name: string; industry: string | null; ownerId: string }>();
  for (const a of owned) map.set(a.id, a);
  for (const d of viaDeals) if (d.account && !d.account.internal) map.set(d.account.id, d.account);
  for (const b of budgeted) if (b.account) map.set(b.account.id, b.account);
  for (const h of loaded) map.set(h.account.id, h.account);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Which facts of a company feed the budget of one negotiator: their own Needs, and — when they are the one who
 *  receives what has no budget of its own (see catchAll) — the Needs of people who don't budget that company. */
export function basisPick(accountId: string, userId: string, accountOwnerId: string | null, others: string[]): FactPick {
  const all = others.includes(userId) ? others : [...others, userId];
  const receiver = catchAll(all, accountOwnerId);
  return (f) => f.accountId === accountId && (f.ownerId === userId || (receiver === userId && !all.includes(f.ownerId)));
}

export type RealByBudget = { byKey: Map<string, Record<Kpi, number[]>>; unassigned: Record<Kpi, number[]>; unassignedRows: Map<string, Record<Kpi, number[]>> };
/** The year's real figures, each attributed to exactly one budget of `keys` (or to "sin presupuesto"). */
export function realByBudget(set: FactSet, year: number, budgets: { slot: string; userId: string; createdAt: Date }[], ownerOf: (accountId: string) => string | null): RealByBudget {
  const blank = () => Object.fromEntries(KPI_KEYS.map((k) => [k, zeros()])) as Record<Kpi, number[]>;
  const has = new Set(budgets.map(budgetKey));
  const users = new Map<string, string[]>();
  for (const b of [...budgets].sort((x, y) => +x.createdAt - +y.createdAt)) if (b.slot !== PROSPECTS) users.set(b.slot, [...(users.get(b.slot) ?? []), b.userId]);
  const byKey = new Map<string, Record<Kpi, number[]>>(), unassigned = blank(), unassignedRows = new Map<string, Record<Kpi, number[]>>();
  const y = String(year);
  for (const f of set.facts) {
    if (f.usd == null || !f.month.startsWith(y)) continue;
    const key = attribute(f, (slot, userId) => has.has(`${slot}|${userId}`), (a) => users.get(a) ?? [], ownerOf(f.accountId));
    const m = Number(f.month.slice(5)) - 1;
    if (key) { const r = byKey.get(key) ?? blank(); r[f.kpi][m] += f.usd; byKey.set(key, r); }
    else {
      unassigned[f.kpi][m] += f.usd;
      const k = `${f.accountId}|${f.ownerId}`, r = unassignedRows.get(k) ?? blank();
      r[f.kpi][m] += f.usd; unassignedRows.set(k, r);
    }
  }
  return { byKey, unassigned, unassignedRows };
}

/** Each active person's team for the roll-up: the first team they belong to, so nobody is counted twice (AT-02). */
export async function teamOfPeople(): Promise<{ teams: { id: string; name: string; leader: string }[]; teamOf: Map<string, string> }> {
  const teams = await db.team.findMany({ where: { active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, leader: { select: { name: true } }, members: { select: { userId: true } } } });
  const teamOf = new Map<string, string>();
  for (const t of teams) for (const m of t.members) if (!teamOf.has(m.userId)) teamOf.set(m.userId, t.id);
  return { teams: teams.map((t) => ({ id: t.id, name: t.name, leader: t.leader.name })), teamOf };
}

/** The years offered: the one in course and the next. From October the next year is the one being planned. */
export function budgetYears(now: Date) {
  const y = Number(monthOf(now).slice(0, 4)), m = Number(monthOf(now).slice(5));
  return { years: [y, y + 1], planning: m >= 10 ? y + 1 : y };
}
export const readYear = (raw: string | undefined, now: Date) => { const { years, planning } = budgetYears(now); const n = Number(raw); return years.includes(n) ? n : planning; };
