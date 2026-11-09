import { cmpMoney, subMoney, sumMoney } from "./money";
import { daysBetween } from "./domain";

// Mercado M4 · Payment behavior (§4.21, §10). Pure rules, no database.
// The agreed term says what should happen; history says what will probably happen. SOLU shows both.
// Only reconciled cash counts: money in the bank that Treasury hasn't reconciled never makes an invoice "paid"
// and never improves the behavior. Facts and trends only: no "good/bad payer" label, no credit change.

export const PAY_FORMULA = "pay-v1";

/** Proposed defaults, stored as a versioned setting (MarketSetting "payRules") and editable by management. */
export const DEFAULT_PAY_RULES = {
  graceDays: 0, // paid up to N days after the due date still counts as on time
  expectedWindowMonths: 12, // expected payment days = average of invoices collected in this window…
  minInvoices: 3, // …needs at least this many; otherwise the window widens to 24 months, then all history
  trendDays: 5, // the average delay of the last 6 months vs the 12 before must move this much to call a trend
  bandSmallUsd: 5000, // amount bands: below this is "small"
  bandLargeUsd: 25000, // at or above this is "large"
};
export type PayRules = typeof DEFAULT_PAY_RULES;

export type PayInvoice = {
  id: string; number: string; amount: number; issuedAt: Date; dueAt: Date;
  apps: { amount: number; reconciled: boolean; receivedAt: Date }[];
  promises: { promisedFor: Date; createdAt: Date }[];
};

/** Invoice rows as Prisma returns them (Decimal amounts) → plain numbers for the rules. */
export type RawPayInvoice = {
  id: string; number: string; amount: unknown; issuedAt: Date; dueAt: Date;
  applications: { amount: unknown; payment: { reconciledAt: Date | null; receivedAt: Date } }[];
  promises?: { promisedFor: Date; createdAt: Date }[];
};
export const toPayInvoice = (x: RawPayInvoice): PayInvoice => ({
  id: x.id, number: x.number, amount: Number(x.amount), issuedAt: x.issuedAt, dueAt: x.dueAt,
  apps: x.applications.map((a) => ({ amount: Number(a.amount), reconciled: !!a.payment.reconciledAt, receivedAt: a.payment.receivedAt })),
  promises: x.promises ?? [],
});

export type InvoiceFact = {
  id: string; number: string; amount: number; issuedAt: Date; dueAt: Date;
  termDays: number; collected: boolean; paidAt: Date | null; actualDays: number | null; delay: number | null;
  open: number; pendingReconcile: number; overdueDays: number;
};

export function invoiceFacts(inv: PayInvoice, now: Date): InvoiceFact {
  const rec = inv.apps.filter((a) => a.reconciled);
  const paid = sumMoney(rec.map((a) => a.amount));
  const collected = rec.length > 0 && cmpMoney(paid, inv.amount) >= 0;
  const paidAt = collected ? rec.reduce((m, a) => (a.receivedAt > m ? a.receivedAt : m), rec[0].receivedAt) : null;
  const open = Math.max(0, subMoney(inv.amount, paid));
  return {
    id: inv.id, number: inv.number, amount: inv.amount, issuedAt: inv.issuedAt, dueAt: inv.dueAt,
    termDays: daysBetween(inv.issuedAt, inv.dueAt), collected, paidAt,
    actualDays: paidAt ? daysBetween(inv.issuedAt, paidAt) : null,
    delay: paidAt ? daysBetween(inv.dueAt, paidAt) : null,
    open, pendingReconcile: sumMoney(inv.apps.filter((a) => !a.reconciled).map((a) => a.amount)),
    overdueDays: open > 0 ? Math.max(0, daysBetween(inv.dueAt, now)) : 0,
  };
}

const monthsAgo = (now: Date, m: number) => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - m); return d; };
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type WindowStats = {
  months: number | null; n: number; avgTermDays: number | null; avgActualDays: number | null; avgDelay: number | null;
  medianDelay: number | null; minDelay: number | null; worstDelay: number | null; onTimePct: number | null;
};

export function windowStats(facts: InvoiceFact[], months: number | null, now: Date, rules: PayRules): WindowStats {
  const from = months == null ? null : monthsAgo(now, months);
  const xs = facts.filter((f) => f.collected && (!from || f.paidAt! >= from));
  const delays = xs.map((f) => f.delay!);
  return {
    months, n: xs.length,
    avgTermDays: r1(avg(xs.map((f) => f.termDays))), avgActualDays: r1(avg(xs.map((f) => f.actualDays!))),
    avgDelay: r1(avg(delays)), medianDelay: r1(median(delays)),
    minDelay: delays.length ? Math.min(...delays) : null, worstDelay: delays.length ? Math.max(...delays) : null,
    onTimePct: xs.length ? Math.round((delays.filter((d) => d <= rules.graceDays).length / xs.length) * 1000) / 10 : null,
  };
}

export type Trend = "WORSE" | "BETTER" | "STABLE" | "UNKNOWN";

/** Last 6 months vs the 12 months before them, by the date the cash arrived. Needs 2+ invoices on each side. */
export function trendOf(facts: InvoiceFact[], now: Date, rules: PayRules) {
  const a = monthsAgo(now, 6), b = monthsAgo(now, 18);
  const recent = facts.filter((f) => f.collected && f.paidAt! >= a).map((f) => f.delay!);
  const prior = facts.filter((f) => f.collected && f.paidAt! < a && f.paidAt! >= b).map((f) => f.delay!);
  if (recent.length < 2 || prior.length < 2) return { trend: "UNKNOWN" as Trend, recent: r1(avg(recent)), prior: r1(avg(prior)), nRecent: recent.length, nPrior: prior.length, delta: null };
  const delta = r1(avg(recent)! - avg(prior)!)!;
  const trend: Trend = delta >= rules.trendDays ? "WORSE" : delta <= -rules.trendDays ? "BETTER" : "STABLE";
  return { trend, recent: r1(avg(recent)), prior: r1(avg(prior)), nRecent: recent.length, nPrior: prior.length, delta };
}

/** A promise is kept when reconciled cash received by the promised day covers the invoice;
 *  broken when that day passed without it; pending while the day hasn't come or the cash awaits reconciliation. */
export function promiseFacts(invs: PayInvoice[], now: Date) {
  let kept = 0, broken = 0, pending = 0;
  for (const inv of invs) {
    for (const p of inv.promises) {
      const recBy = sumMoney(inv.apps.filter((a) => a.reconciled && daysBetween(a.receivedAt, p.promisedFor) >= 0).map((a) => a.amount));
      const anyBy = sumMoney(inv.apps.filter((a) => daysBetween(a.receivedAt, p.promisedFor) >= 0).map((a) => a.amount));
      if (cmpMoney(recBy, inv.amount) >= 0) kept++;
      else if (daysBetween(p.promisedFor, now) <= 0 || cmpMoney(anyBy, inv.amount) >= 0) pending++;
      else broken++;
    }
  }
  return { kept, broken, pending, reliabilityPct: kept + broken ? Math.round((kept / (kept + broken)) * 1000) / 10 : null };
}

export const BANDS = ["SMALL", "MEDIUM", "LARGE"] as const;
export type Band = (typeof BANDS)[number];
export const bandOf = (amount: number, rules: PayRules): Band => (amount < rules.bandSmallUsd ? "SMALL" : amount < rules.bandLargeUsd ? "MEDIUM" : "LARGE");

export function bandStats(facts: InvoiceFact[], rules: PayRules) {
  return BANDS.map((band) => {
    const xs = facts.filter((f) => f.collected && bandOf(f.amount, rules) === band);
    return { band, n: xs.length, avgDelay: r1(avg(xs.map((f) => f.delay!))), worstDelay: xs.length ? Math.max(...xs.map((f) => f.delay!)) : null };
  });
}

/** Expected payment days for Comercial/Liquidation: average real days from invoice to reconciled cash.
 *  Widens 12 → 24 months → all history until it has `minInvoices`; with fewer it is shown as indicative only. */
export function expectedOf(facts: InvoiceFact[], contractualDays: number, now: Date, rules: PayRules) {
  const tries: (number | null)[] = [rules.expectedWindowMonths, Math.max(24, rules.expectedWindowMonths), null];
  let pick: WindowStats | null = null;
  for (const m of tries) {
    const w = windowStats(facts, m, now, rules);
    if (w.n >= rules.minInvoices) { pick = w; break; }
    if (m == null && w.n > 0) pick = w;
  }
  if (!pick || pick.avgActualDays == null) return { contractualDays, expectedDays: null, deltaDays: null, n: 0, months: null, enough: false, avgDelay: null };
  const expectedDays = Math.round(pick.avgActualDays);
  return { contractualDays, expectedDays, deltaDays: expectedDays - contractualDays, n: pick.n, months: pick.months, enough: pick.n >= rules.minInvoices, avgDelay: pick.avgDelay == null ? null : Math.round(pick.avgDelay) };
}

export function exposureOf(facts: InvoiceFact[]) {
  const open = facts.filter((f) => f.open > 0);
  const overdue = open.filter((f) => f.overdueDays > 0);
  return {
    openTotal: sumMoney(open.map((f) => f.open)), openCount: open.length,
    overdueTotal: sumMoney(overdue.map((f) => f.open)), overdueCount: overdue.length,
    oldestOverdueDays: overdue.length ? Math.max(...overdue.map((f) => f.overdueDays)) : 0,
    pendingReconcile: sumMoney(facts.map((f) => f.pendingReconcile)),
  };
}

export function payBehavior(invs: PayInvoice[], contractualDays: number, now: Date, rules: PayRules) {
  const facts = invs.map((x) => invoiceFacts(x, now)).sort((a, b) => +b.issuedAt - +a.issuedAt);
  return {
    formula: PAY_FORMULA,
    contractualDays,
    windows: [6, 12, 24, null].map((m) => windowStats(facts, m, now, rules)),
    trend: trendOf(facts, now, rules),
    promises: promiseFacts(invs, now),
    bands: bandStats(facts, rules),
    expected: expectedOf(facts, contractualDays, now, rules),
    exposure: exposureOf(facts),
    facts,
    lastPaidAt: facts.filter((f) => f.paidAt).map((f) => f.paidAt!).sort((a, b) => +b - +a)[0] ?? null,
  };
}
export type PayBehavior = ReturnType<typeof payBehavior>;

/** What changed between two behavior snapshots that is worth a signal. Only a new "worse" trend. */
export function payTrendSignal(prev: Trend | null, cur: ReturnType<typeof trendOf>) {
  if (cur.trend !== "WORSE" || prev === "WORSE") return null;
  return {
    es: `Paga más lento: retraso promedio de ${cur.prior} a ${cur.recent} días`,
    en: `Paying more slowly: average delay from ${cur.prior} to ${cur.recent} days`,
  };
}
