// Presupuesto comercial (specification "Presupuesto comercial SOLU 2027", 2026-11-26). Pure rules: no database here.
// Two separate plans per company and negotiator: purchase orders accepted (commercial base) and invoicing (financial
// base). SOLU suggests from the history; the negotiator adjusts and explains; the leader approves. Pesos (COP).
// Every threshold below is a planning default (spec §11 leaves them to Dirección): they live in BUDGET_RULES so one
// place changes them.

import { isWorkingDay } from "./holidays";

export const BUDGET_RULES = {
  version: "pres-v1",
  /** A rate needs at least this many cases behind it; with fewer SOLU says «sin base suficiente» (AT-08). */
  minCases: 5,
  /** Rates read the cohorts of the last N months. */
  windowMonths: 24,
  /** A request younger than this is not yet a fair "was it quoted?" case (cohort maturity). */
  matureDays: 30,
  /** Complete months of history needed to project the close of the base year. */
  minHistoryMonths: 3,
  /** Own seasonality needs this many complete months and this many months with orders; otherwise even months. */
  seasonMinMonths: 12, seasonMinActive: 6,
  /** Suggested figures are rounded to this many dollars. */
  roundTo: 10,
  /** Radar: below this share of what was expected by today, a company is "below pace". */
  belowPace: 0.85,
  /** Radar: a fall of requests of at least this share between two quarters. */
  requestDrop: 0.3,
  /** Radar: quotes rising at least this share while orders don't. */
  quoteRise: 0.2,
  /** Radar: margin falling at least this many points while orders rise. */
  marginDropPts: 3,
} as const;

type Txt = { es: string; en: string };
export type Kpi = "OC_COP" | "FACT_COP" | "ESA_COP" | "OC_N" | "COT_COP" | "COT_N" | "SOL_N" | "ENT_N";
export const KPIS: Record<Kpi, Txt & { unit: "usd" | "n"; how: Txt }> = {
  OC_COP: { es: "Órdenes de compra (US$)", en: "Purchase orders (US$)", unit: "usd", how: { es: "Valor sin IVA de las órdenes de compra del cliente aceptadas, en el mes en que se aceptaron. Las rechazadas no cuentan.", en: "Value before VAT of the customer's purchase orders accepted, in the month they were accepted. Rejected ones don't count." } },
  FACT_COP: { es: "Facturación (US$)", en: "Invoicing (US$)", unit: "usd", how: { es: "Valor sin IVA de las facturas emitidas, en el mes de la fecha de la factura. Es un plan aparte: no se copia de las órdenes de compra del mismo mes.", en: "Value before VAT of the invoices issued, in the month of the invoice date. It is a separate plan: it is not copied from the same month's purchase orders." } },
  ESA_COP: { es: "Eságara de OC (US$)", en: "Eságara of POs (US$)", unit: "usd", how: { es: "Valor de las órdenes de compra por el porcentaje de Eságara de su cotización.", en: "Value of the purchase orders times the Eságara percentage of their quote." } },
  OC_N: { es: "# Órdenes de compra", en: "# Purchase orders", unit: "n", how: { es: "Número de órdenes de compra aceptadas, en el mes en que se aceptaron.", en: "Number of purchase orders accepted, in the month they were accepted." } },
  COT_COP: { es: "Cotizaciones (US$)", en: "Quotes (US$)", unit: "usd", how: { es: "Precio de venta sin IVA de la última revisión presentada de cada Necesidad, en el mes de su primera presentación. Una revisión no suma otra vez.", en: "Sale price before VAT of each Need's last presented revision, in the month of its first presentation. A revision does not add again." } },
  COT_N: { es: "# Cotizaciones", en: "# Quotes", unit: "n", how: { es: "Necesidades con una cotización presentada, en el mes de la primera presentación. Tres revisiones cuentan una vez.", en: "Needs with a quote presented, in the month of the first presentation. Three revisions count once." } },
  SOL_N: { es: "# Solicitudes", en: "# Requests", unit: "n", how: { es: "Necesidades creadas, en el mes en que se recibieron.", en: "Needs created, in the month they were received." } },
  ENT_N: { es: "# Entregas", en: "# Deliveries", unit: "n", how: { es: "Entregas confirmadas al cliente (con remisión), en el mes de la fecha real de entrega. Una entrega parcial cuenta como una entrega.", en: "Deliveries confirmed to the customer (with a delivery note), in the month of the real delivery date. A partial delivery counts as one delivery." } },
};
export const KPI_KEYS = Object.keys(KPIS) as Kpi[];
/** The three figures that roll up in money (consolidation columns). */
export const MAIN_KPIS: Kpi[] = ["OC_COP", "FACT_COP", "ESA_COP"];

export const MONTHS: Txt[] = [
  { es: "ene", en: "Jan" }, { es: "feb", en: "Feb" }, { es: "mar", en: "Mar" }, { es: "abr", en: "Apr" }, { es: "may", en: "May" }, { es: "jun", en: "Jun" },
  { es: "jul", en: "Jul" }, { es: "ago", en: "Aug" }, { es: "sep", en: "Sep" }, { es: "oct", en: "Oct" }, { es: "nov", en: "Nov" }, { es: "dic", en: "Dec" },
];
export const PROSPECTS = "PROSPECTOS";
export const zeros = () => Array.from({ length: 12 }, () => 0);
export const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
/** Dollars for the budget screens, whole: "149.852" (es) / "149,852" (en). The budget works in dollars. */
export const usdCell = (v: number, es: boolean) => new Intl.NumberFormat(es ? "es-CO" : "en-US", { maximumFractionDigits: 0 }).format(Math.round(v) || 0);
/** The same with the sign: "US$ 149.852". */
export const usdMoney = (v: number, es: boolean) => `US$ ${usdCell(v, es)}`;
export const monthKey =(year: number, m: number) => `${year}-${String(m).padStart(2, "0")}`;

// ---------- States ----------

export type BudgetState = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED";
/** What the screen calls each state. NONE = no budget yet; INFORCE = approved and the year published. */
export type ShownState = "NONE" | BudgetState | "INFORCE" | "SUPERSEDED";
export const STATE_TXT: Record<ShownState, Txt & { tone: "wait" | "attn" | "risk" | "ok" }> = {
  NONE: { es: "Sin iniciar", en: "Not started", tone: "wait" },
  DRAFT: { es: "Borrador", en: "Draft", tone: "wait" },
  SUBMITTED: { es: "Enviado", en: "Submitted", tone: "attn" },
  RETURNED: { es: "Devuelto", en: "Returned", tone: "risk" },
  APPROVED: { es: "Aprobado", en: "Approved", tone: "ok" },
  INFORCE: { es: "Vigente", en: "In force", tone: "ok" },
  SUPERSEDED: { es: "Reemplazado", en: "Superseded", tone: "wait" },
};
export const shownState = (b: { state: string; supersededAt: Date | null } | null, published: boolean): ShownState =>
  !b ? "NONE" : b.supersededAt ? "SUPERSEDED" : b.state === "APPROVED" ? (published ? "INFORCE" : "APPROVED") : (b.state as BudgetState);
/** Only a draft or a returned proposal can be changed; an approved one needs a new version (AT-10). */
export const isEditable = (state: string) => state === "DRAFT" || state === "RETURNED";

// ---------- Assumptions ----------

export type Assumptions = {
  /** Growth of purchase orders over the projected close of the base year, in percent. */
  growthPct: number;
  /** Growth of invoicing over the projected close of the base year, in percent (its own plan). */
  factGrowthPct: number;
  /** Average value of one purchase order, dollars. */
  ticket: number | null;
  /** Request → quote, percent. */
  convSC: number | null;
  /** Quote → purchase order by number, percent. */
  bateoN: number | null;
  /** Quote → purchase order by value, percent. */
  bateoV: number | null;
  /** Eságara objective of the purchase orders, percent. */
  marginPct: number | null;
  /** PROPIA = the company's own months; PAREJA = twelve even months. */
  season: "PROPIA" | "PAREJA";
  /** The assumptions the person typed; the others are SOLU's reading of the history. */
  manual: string[];
};
export const ASSUMPTION_KEYS = ["growthPct", "factGrowthPct", "ticket", "convSC", "bateoN", "bateoV", "marginPct"] as const;
export type AssumptionKey = (typeof ASSUMPTION_KEYS)[number];

/** A rate read from the history: the percentage, and the cases behind it [hits, at-bats]. */
export type Measured = { value: number | null; n: [number, number] };
/** What the history gives SOLU to suggest with. null = «sin base suficiente». */
export type Basis = {
  baseYear: number;
  /** Projected close of the base year, and how it was built. */
  ocClose: number | null; factClose: number | null;
  ocSoFar: number; factSoFar: number; monthsUsed: number;
  /** Share of each calendar month (sums 1), or null when the company has no seasonality of its own yet. */
  seasonOc: number[] | null; seasonFact: number[] | null;
  ticket: Measured; convSC: Measured; bateoN: Measured; bateoV: Measured; margin: Measured;
  /** Accepted purchase orders not invoiced yet (dollars): a reference for the invoicing plan. */
  backlog: number;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
/** hits / at-bats as a percentage with one decimal, or null with too few cases or a zero denominator (AT-08). */
export function measured(hits: number, atBats: number, min: number = BUDGET_RULES.minCases): Measured {
  return { value: atBats >= min && atBats > 0 && hits > 0 ? r1((hits / atBats) * 100) : null, n: [Math.round(hits), Math.round(atBats)] };
}

/** The assumptions SOLU starts with: what the history measured, and no growth until the person decides one. */
export function defaultAssumptions(b: Basis): Assumptions {
  return { growthPct: 0, factGrowthPct: 0, ticket: b.ticket.value, convSC: b.convSC.value, bateoN: b.bateoN.value, bateoV: b.bateoV.value, marginPct: b.margin.value, season: b.seasonOc ? "PROPIA" : "PAREJA", manual: [] };
}

/** Reads assumptions saved as JSON (or sent by a form), keeping only sane values. */
export function readAssumptions(raw: unknown, fallback: Assumptions): Assumptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: string, lo: number, hi: number, d: number | null) => { const v = o[k]; if (v == null || v === "") return d; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  return {
    growthPct: num("growthPct", -100, 1000, fallback.growthPct) ?? 0,
    factGrowthPct: num("factGrowthPct", -100, 1000, fallback.factGrowthPct) ?? 0,
    ticket: num("ticket", 1, 1e13, fallback.ticket),
    convSC: num("convSC", 0.1, 100, fallback.convSC),
    bateoN: num("bateoN", 0.1, 100, fallback.bateoN),
    bateoV: num("bateoV", 0.1, 1000, fallback.bateoV),
    marginPct: num("marginPct", 0, 100, fallback.marginPct),
    season: o.season === "PAREJA" ? "PAREJA" : o.season === "PROPIA" ? "PROPIA" : fallback.season,
    manual: Array.isArray(o.manual) ? o.manual.filter((x): x is string => typeof x === "string" && (ASSUMPTION_KEYS as readonly string[]).includes(x)) : fallback.manual,
  };
}

// ---------- History → projection, seasonality, suggestion ----------

/** Projected close of the base year: the complete months as they were, and the months still to come at the average
 *  of the complete ones. `first` = first month with any history (YYYY-MM); `current` = the month in course. */
export function projectClose(byMonth: (m: string) => number, baseYear: number, current: string, first: string | null): { close: number | null; soFar: number; used: number } {
  let soFar = 0, used = 0, complete = 0;
  for (let m = 1; m <= 12; m++) {
    const k = monthKey(baseYear, m);
    if (k >= current) break;
    complete++;
    soFar += byMonth(k);
    if (first && k >= first) used++;
  }
  if (used < BUDGET_RULES.minHistoryMonths || soFar <= 0) return { close: complete === 12 && soFar > 0 ? soFar : null, soFar, used };
  // Months before the first record are not zeros: they are months without history, so the average skips them.
  // The month in course counts for what it already has when that is more than the average, so the projected close
  // is never below what the year has really brought so far.
  const avg = soFar / used;
  return { close: Math.round(soFar + Math.max(byMonth(monthKey(baseYear, complete + 1)), avg) + avg * (11 - complete)), soFar, used };
}

/** The company's own seasonality: average of each calendar month over the complete months given, as shares that
 *  sum 1. null when the history is too short or too thin to call it a pattern. */
export function seasonShares(months: { key: string; value: number }[]): number[] | null {
  if (months.length < BUDGET_RULES.seasonMinMonths || months.filter((x) => x.value > 0).length < BUDGET_RULES.seasonMinActive) return null;
  const tot = zeros(), cnt = zeros();
  for (const x of months) { const m = Number(x.key.slice(5)) - 1; tot[m] += x.value; cnt[m]++; }
  if (cnt.some((c) => c === 0)) return null;
  const avg = tot.map((v, m) => v / cnt[m]);
  const all = sum(avg);
  return all > 0 ? avg.map((v) => v / all) : null;
}

/** Spreads a year's total over twelve months by shares (even months without them). The months are rounded and the
 *  difference goes to the largest month, so January to December always add up to the total (AT-01). */
export function spread(total: number, shares: number[] | null): number[] {
  const unit = BUDGET_RULES.roundTo;
  const goal = Math.round(total / unit) * unit;
  const sh = shares ?? Array.from({ length: 12 }, () => 1 / 12);
  const out = sh.map((s) => Math.round((goal * s) / unit) * unit);
  const diff = goal - sum(out);
  if (diff !== 0) { let top = 0; for (let m = 1; m < 12; m++) if (out[m] > out[top]) top = m; out[top] = Math.max(0, out[top] + diff); }
  return out;
}

/** What SOLU suggests for the twelve months, or null when there is no basis (the person decides, AT-08). */
export function suggest(close: number | null, growthPct: number, shares: number[] | null, season: Assumptions["season"]): number[] | null {
  if (close == null || close <= 0) return null;
  return spread(close * (1 + growthPct / 100), season === "PROPIA" ? shares : null);
}

// ---------- Inverse calculation of goals (spec §4) ----------

const ceil = (x: number) => Math.ceil(x - 1e-9);
export type Derived = { ocN: number | null; cotUsd: number | null; cotN: number | null; solN: number | null; esa: number | null };

/** From a month's purchase-order goal back to what it takes. null = the rate or ticket behind it is missing. */
export function deriveMonth(oc: number, a: Assumptions, ocNTyped: number | null = null): Derived {
  if (!(oc > 0)) return { ocN: 0, cotUsd: 0, cotN: 0, solN: 0, esa: 0 };
  const ocN = ocNTyped != null && ocNTyped > 0 ? Math.round(ocNTyped) : a.ticket && a.ticket > 0 ? Math.max(1, Math.round(oc / a.ticket)) : null;
  const cotUsd = a.bateoV && a.bateoV > 0 ? Math.round(oc / (a.bateoV / 100)) : null;
  const cotN = ocN != null && a.bateoN && a.bateoN > 0 ? ceil(ocN / (a.bateoN / 100)) : null;
  const solN = cotN != null && a.convSC && a.convSC > 0 ? ceil(cotN / (a.convSC / 100)) : null;
  const esa = a.marginPct != null ? Math.round((oc * a.marginPct) / 100) : null;
  return { ocN, cotUsd, cotN, solN, esa };
}

/** Portfolio margin: total Eságara over total orders. Never an average of percentages (AT-07). */
export const marginOf = (esa: number, oc: number) => (oc > 0 ? r1((esa / oc) * 100) : null);
/** Achievement, percent with one decimal; null without a budget to compare with. */
export const achievement = (real: number, budget: number) => (budget > 0 ? r1((real / budget) * 100) : null);
/** Growth of the year's goal over the projected close; null without a reliable base (denominator > 0). */
export const growthOf = (goal: number, close: number | null) => (close != null && close > 0 ? r1((goal / close - 1) * 100) : null);

// ---------- Progress of the year on working days (AT-12) ----------

const DAY = 864e5;
const BOGOTA_MS = 5 * 3600e3;
/** Today on Bogotá's calendar, as a UTC-midnight date. */
export const bogotaDay = (now: Date) => { const b = new Date(now.getTime() - BOGOTA_MS); return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())); };
const workdays = (from: Date, toExcl: Date) => { let w = 0; for (let t = from.getTime(); t < toExcl.getTime(); t += DAY) if (isWorkingDay(new Date(t))) w++; return w; };

export type YearProgress = {
  /** How much of each month has gone by: 1 = closed, 0 = not started, a fraction of working days = in course. */
  share: number[];
  /** Month in course (1–12), or null when the year has not started or is over. */
  current: number | null;
  elapsed: number; total: number;
  /** Working days left in the year, today not included; and the working days of the whole year. */
  remainingYear: number; totalYear: number;
};
export function yearProgress(year: number, now: Date): YearProgress {
  const today = bogotaDay(now);
  const share = zeros();
  let current: number | null = null, elapsed = 0, total = 0;
  for (let m = 1; m <= 12; m++) {
    const start = new Date(Date.UTC(year, m - 1, 1)), end = new Date(Date.UTC(year, m, 1));
    if (today >= end) share[m - 1] = 1;
    else if (today >= start) {
      current = m;
      total = workdays(start, end);
      elapsed = workdays(start, new Date(today.getTime() + DAY));
      share[m - 1] = total ? elapsed / total : 0;
    }
  }
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1)), yearStart = new Date(Date.UTC(year, 0, 1));
  const from = today < yearStart ? yearStart : new Date(today.getTime() + DAY);
  return { share, current, elapsed, total, remainingYear: from < yearEnd ? workdays(from, yearEnd) : 0, totalYear: workdays(yearStart, yearEnd) };
}
/** What the budget expected by today: closed months in full, the month in course by its working days gone. */
export const expectedToDate = (budget: number[], p: YearProgress) => budget.reduce((s, v, m) => s + v * p.share[m], 0);
/** Real of the months started so far (a future month has nothing real yet). */
export const realToDate = (real: number[], p: YearProgress) => real.reduce((s, v, m) => s + (p.share[m] > 0 ? v : 0), 0);

// ---------- Radar (spec §8): deterministic detections, each with the figures that back it ----------

export type RadarKind = "PACE" | "REQUESTS" | "QUOTES" | "MARGIN" | "BILLING";
export const RADAR_TXT: Record<RadarKind, { title: Txt; action: Txt }> = {
  PACE: { title: { es: "Órdenes de compra por debajo del ritmo previsto", en: "Purchase orders below the expected pace" }, action: { es: "Revisar las oportunidades avanzadas de esa empresa y sus fechas de decisión.", en: "Review that company's advanced opportunities and their decision dates." } },
  REQUESTS: { title: { es: "Solicitudes en descenso en un cliente Pareto", en: "Requests falling at a Pareto customer" }, action: { es: "Contactar a Compras y Mantenimiento para conocer cambios. SOLU ve la caída, no la causa.", en: "Contact Purchasing and Maintenance to learn what changed. SOLU sees the fall, not its cause." } },
  QUOTES: { title: { es: "Las cotizaciones suben y las órdenes de compra no", en: "Quotes rise and purchase orders don't" }, action: { es: "Revisar la concreción, la presentación de valor y los motivos de pérdida.", en: "Review closing, the presentation of value and the reasons for losses." } },
  MARGIN: { title: { es: "Las órdenes de compra suben y la Eságara cae", en: "Purchase orders rise and Eságara falls" }, action: { es: "Evaluar márgenes, liquidaciones y descuentos.", en: "Assess margins, cost settlements and discounts." } },
  BILLING: { title: { es: "El presupuesto de facturación supera lo que hay por entregar", en: "The invoicing budget exceeds what there is to deliver" }, action: { es: "Escalar la previsión de fechas a Operaciones y revisar lo pendiente por entregar.", en: "Escalate the date forecast to Operations and review what is pending delivery." } },
};

/** Quarter against quarter: the last three complete months and the three before (oldest first, six values). */
export const quarters = (six: number[]) => ({ prev: sum(six.slice(0, 3)), last: sum(six.slice(3, 6)) });

export type RadarInput = {
  /** Budget in force and real so far, purchase orders in dollars. */
  expected: number; real: number;
  pareto: boolean;
  /** Last six complete months, oldest first. */
  sol: number[]; cotN: number[]; ocN: number[]; oc: number[]; esa: number[];
  /** Invoicing budget of the month in course and the next, and the accepted orders not invoiced yet. */
  factAhead: number; backlog: number;
};
export type RadarHit = { kind: RadarKind; evidence: Txt };

export function radar(x: RadarInput, usd: (v: number) => string): RadarHit[] {
  const R = BUDGET_RULES, out: RadarHit[] = [];
  if (x.expected > 0 && x.real < x.expected * R.belowPace) out.push({ kind: "PACE", evidence: { es: `Van ${usd(x.real)} de ${usd(x.expected)} esperados a hoy (${Math.round((x.real / x.expected) * 100)} %).`, en: `${usd(x.real)} of ${usd(x.expected)} expected by today (${Math.round((x.real / x.expected) * 100)} %).` } });
  const s = quarters(x.sol);
  if (x.pareto && s.prev >= 3 && s.last <= s.prev * (1 - R.requestDrop)) out.push({ kind: "REQUESTS", evidence: { es: `${s.last} solicitudes en los últimos 3 meses completos; ${s.prev} en los 3 anteriores.`, en: `${s.last} requests in the last 3 complete months; ${s.prev} in the 3 before.` } });
  const c = quarters(x.cotN), o = quarters(x.ocN);
  if (c.prev >= 2 && c.last >= c.prev * (1 + R.quoteRise) && o.last <= o.prev) out.push({ kind: "QUOTES", evidence: { es: `Cotizaciones: ${c.prev} → ${c.last}. Órdenes de compra: ${o.prev} → ${o.last} (3 meses anteriores → últimos 3).`, en: `Quotes: ${c.prev} → ${c.last}. Purchase orders: ${o.prev} → ${o.last} (3 months before → last 3).` } });
  const v = quarters(x.oc), e = quarters(x.esa);
  const m0 = marginOf(e.prev, v.prev), m1 = marginOf(e.last, v.last);
  if (v.prev > 0 && v.last > v.prev && m0 != null && m1 != null && m1 <= m0 - R.marginDropPts) out.push({ kind: "MARGIN", evidence: { es: `Órdenes de compra: ${usd(v.prev)} → ${usd(v.last)}. Eságara: ${m0} % → ${m1} %.`, en: `Purchase orders: ${usd(v.prev)} → ${usd(v.last)}. Eságara: ${m0} % → ${m1} %.` } });
  if (x.factAhead > 0 && x.factAhead > x.backlog) out.push({ kind: "BILLING", evidence: { es: `Facturación presupuestada de este mes y el siguiente: ${usd(x.factAhead)}. Órdenes aceptadas sin facturar: ${usd(x.backlog)}.`, en: `Invoicing budgeted for this month and the next: ${usd(x.factAhead)}. Accepted orders not invoiced: ${usd(x.backlog)}.` } });
  return out;
}

// ---------- Attribution: every real figure lands in exactly one budget, or in none (AT-02, AT-13) ----------

/** Which negotiator's budget of a company receives the figures of people without their own budget for it: the
 *  company's owner when they budget it, otherwise the first who did. */
export function catchAll(budgetUserIds: string[], accountOwnerId: string | null): string | null {
  if (!budgetUserIds.length) return null;
  return accountOwnerId && budgetUserIds.includes(accountOwnerId) ? accountOwnerId : budgetUserIds[0];
}
/** The budget (slot|userId) a fact belongs to, or null = no budget covers it. `has` answers "is there a budget for
 *  this slot and person?"; `usersOf` lists who budgets a company, oldest budget first. */
export function attribute(f: { accountId: string; ownerId: string }, has: (slot: string, userId: string) => boolean, usersOf: (accountId: string) => string[], accountOwnerId: string | null): string | null {
  if (has(f.accountId, f.ownerId)) return `${f.accountId}|${f.ownerId}`;
  const other = catchAll(usersOf(f.accountId), accountOwnerId);
  if (other) return `${f.accountId}|${other}`;
  if (has(PROSPECTS, f.ownerId)) return `${PROSPECTS}|${f.ownerId}`;
  return null;
}

// ---------- Text helpers ----------

/** "40.000.000" → 40000000. Accepts dots, commas and spaces as thousand separators; empty = null. */
export function parsePesos(raw: unknown): number | null {
  const s = String(raw ?? "").replace(/[^\d-]/g, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** "12,5" or "12.5" → 12.5; empty = null. */
export function parsePct(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- Dollars typed on the screens ----------

/** "12.500" or "12500,5" (es), "12,500" or "12500.5" (en) → dollars; empty = null; anything that is not a number = NaN. */
export function parseMoney(raw: unknown, es: boolean): number | null {
  let s = String(raw ?? "").trim().replace(/\s/g, "").replace(/US\$|USD|\$/gi, "");
  if (!s) return null;
  // In Spanish notation a point marks thousands ("12.500"); a lone point with one or two digits after it is read as
  // cents ("1250.5"), so a figure typed the other way is not multiplied by a hundred.
  s = es ? (/^\d+\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, "").replace(",", ".")) : s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
/** Dollars → the text of an input, in the person's notation, without thousands marks or trailing zeros. */
export function moneyText(dollars: number | null | undefined, es: boolean): string {
  if (dollars == null) return "";
  const s = String(Math.round(dollars * 100) / 100);
  return es ? s.replace(".", ",") : s;
}

// ---------- From what the person typed to the lines that are stored ----------

export type LineOut = { month: number; kpi: Kpi; value: number; suggested: number | null; origin: "SOLU" | "MANUAL" | "DERIVED" };
/** The stored figures of a budget. `pureOc` / `pureFact` = SOLU's own suggestion (its reading of the history, no
 *  growth): a month equal to it is marked SOLU, any other MANUAL. A derived figure without basis is not stored. */
export function budgetLines(oc: number[], fact: number[], ocN: (number | null)[], a: Assumptions, pureOc: number[] | null, pureFact: number[] | null, ent: (number | null)[] = []): LineOut[] {
  const out: LineOut[] = [];
  for (let m = 0; m < 12; m++) {
    const month = m + 1;
    // Deliveries are planned by hand: SOLU has no rule to derive them from the order goal.
    if (ent[m] != null) out.push({ month, kpi: "ENT_N", value: ent[m]!, suggested: null, origin: "MANUAL" });
    out.push({ month, kpi: "OC_COP", value: oc[m], suggested: pureOc?.[m] ?? null, origin: pureOc && pureOc[m] === oc[m] ? "SOLU" : "MANUAL" });
    out.push({ month, kpi: "FACT_COP", value: fact[m], suggested: pureFact?.[m] ?? null, origin: pureFact && pureFact[m] === fact[m] ? "SOLU" : "MANUAL" });
    const d = deriveMonth(oc[m], a, ocN[m]);
    if (d.ocN != null) out.push({ month, kpi: "OC_N", value: d.ocN, suggested: null, origin: ocN[m] != null && ocN[m]! > 0 && oc[m] > 0 ? "MANUAL" : "DERIVED" });
    if (d.esa != null) out.push({ month, kpi: "ESA_COP", value: d.esa, suggested: null, origin: "DERIVED" });
    if (d.cotUsd != null) out.push({ month, kpi: "COT_COP", value: d.cotUsd, suggested: null, origin: "DERIVED" });
    if (d.cotN != null) out.push({ month, kpi: "COT_N", value: d.cotN, suggested: null, origin: "DERIVED" });
    if (d.solN != null) out.push({ month, kpi: "SOL_N", value: d.solN, suggested: null, origin: "DERIVED" });
  }
  return out;
}
/** Does the proposal move away from SOLU's own suggestion (or is there no suggestion to lean on)? Then the
 *  negotiator explains it (spec §6). */
export function departs(oc: number[], fact: number[], pureOc: number[] | null, pureFact: number[] | null): boolean {
  const off = (xs: number[], pure: number[] | null) => (pure ? xs.some((v, m) => v !== pure[m]) : xs.some((v) => v > 0));
  return off(oc, pureOc) || off(fact, pureFact);
}
// ---------- Reforecast (spec §3 "Forecast", §6): the official budget stays as approved; this is today's estimate ----------

/** What the person adds to the real figures of a month that is not over: purchase orders they see as probable and
 *  invoices already scheduled. A closed month takes nothing: its real figure is final. */
export type ForecastTyped = { ocProb: (number | null)[]; factProg: (number | null)[] };
export type ForecastMonth = { real: number; typed: number; estimate: number; open: boolean };
/** Month by month: real so far + what was typed for the months still open (the one in course and the ones ahead). */
export function forecastMonths(real: number[], typed: (number | null)[], p: YearProgress): ForecastMonth[] {
  return real.map((r, m) => {
    const open = p.share[m] < 1;
    const got = p.share[m] > 0 ? r : 0;
    const add = open ? Math.max(0, typed[m] ?? 0) : 0;
    return { real: got, typed: add, estimate: got + add, open };
  });
}
/** Annual estimate against the official budget: the difference in dollars and in percent of the budget. */
export function forecastGap(estimate: number, budget: number): { diff: number; pct: number | null } {
  return { diff: estimate - budget, pct: budget > 0 ? Math.round(((estimate - budget) / budget) * 1000) / 10 : null };
}

// ---------- Daily priorities (spec §8, AT-15): at most three, each tied to a detection with its figures and link ----------

export type InsightHit = { id: string; kind: RadarKind; accountId: string; company: string; evidence: Txt };
export type Priority = { hitId: string; kind: RadarKind; accountId: string; company: string; evidence: Txt; why: string | null; action: string; uncertainty: string; byAi: boolean };
export const MAX_PRIORITIES = 3;
const UNSURE: Txt = { es: "SOLU ve el hecho y sus cifras, no la causa: confírmala con el cliente antes de actuar.", en: "SOLU sees the fact and its figures, not the cause: confirm it with the customer before acting." };
/** The priorities when no AI is used (or its answer is not usable): the first detections in the radar's own order. */
export function rulePriorities(hits: InsightHit[], es: boolean): Priority[] {
  return hits.slice(0, MAX_PRIORITIES).map((h) => ({ hitId: h.id, kind: h.kind, accountId: h.accountId, company: h.company, evidence: h.evidence, why: null, action: es ? RADAR_TXT[h.kind].action.es : RADAR_TXT[h.kind].action.en, uncertainty: es ? UNSURE.es : UNSURE.en, byAi: false }));
}
/** What the AI may add: an order and words. It never adds a fact: a priority that names no existing detection is
 *  dropped, a detection is used once, and figures always come from SOLU's own evidence text (AT-15). */
export function aiPriorities(raw: unknown, hits: InsightHit[], es: boolean): Priority[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { priorities?: unknown }).priorities) ? (raw as { priorities: unknown[] }).priorities : [];
  const byId = new Map(hits.map((h) => [h.id, h]));
  const out: Priority[] = [], used = new Set<string>();
  const txt = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  for (const x of list) {
    if (out.length >= MAX_PRIORITIES || !x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const h = byId.get(String(o.id ?? ""));
    if (!h || used.has(h.id)) continue;
    const action = txt(o.action, 300);
    if (!action) continue;
    used.add(h.id);
    out.push({ hitId: h.id, kind: h.kind, accountId: h.accountId, company: h.company, evidence: h.evidence, why: txt(o.why, 300) || null, action, uncertainty: txt(o.uncertainty, 240) || (es ? UNSURE.es : UNSURE.en), byAi: true });
  }
  return out;
}
/** Is the evening email due now? Working days (Monday to Friday, no Colombian holidays) from 5 in the afternoon,
 *  company time. Returns the local date, so it goes out once per day. */
export function eveningDue(now: Date): string | null {
  const local = new Date(now.getTime() - 5 * 3600e3);
  const day = bogotaDay(now);
  return isWorkingDay(day) && local.getUTCHours() >= 17 ? day.toISOString().slice(0, 10) : null;
}
/** The next working day after a local date (YYYY-MM-DD), as YYYY-MM-DD. */
export function nextWorkingDay(day: string): string {
  let d = new Date(`${day}T00:00:00Z`);
  do { d = new Date(d.getTime() + 864e5); } while (!isWorkingDay(d));
  return d.toISOString().slice(0, 10);
}
