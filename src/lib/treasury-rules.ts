import { money2, subMoney, sumMoney } from "./money";
import { addDays, daysBetween } from "./domain";

// Módulo 14 §2A, §8, §17 · Treasury. Pure rules, no database.
// "La disponibilidad bancaria no equivale a capacidad libre de gasto" (§1.2): what the bank shows is the start, and
// every step down to what is really free is a named line a person can open. Nothing is a probability: each future
// movement keeps how sure it is, where it comes from and when it was observed.

type Txt = { es: string; en: string };
export const HORIZON_DAYS = [7, 30, 60, 90] as const;
export type Confidence = "CONFIRMED" | "EXPECTED" | "ESTIMATED";
export const CONFIDENCE: Record<Confidence, Txt & { tone: string }> = {
  CONFIRMED: { es: "Confirmado", en: "Confirmed", tone: "ok" },
  EXPECTED: { es: "Esperado", en: "Expected", tone: "wait" },
  ESTIMATED: { es: "Estimado", en: "Estimated", tone: "attn" },
};

/** §17: future money is never one pile. Money in, by how far it is from being cash; money out, by how firm it is. */
export const BUCKETS = {
  PROMISED: { dir: "IN", es: "Cobro prometido por el cliente", en: "Collection promised by the customer" },
  DUE_EXPECTED: { dir: "IN", es: "Facturado y vencido: cobro esperado", en: "Invoiced and due: collection expected" },
  ISSUED_NOT_DUE: { dir: "IN", es: "Facturado, aún sin vencer", en: "Invoiced, not yet due" },
  INVOICE_READY: { dir: "IN", es: "Entregado, listo para facturar (aún no es cartera)", en: "Delivered, ready to invoice (not receivable yet)" },
  CONTRACTED: { dir: "IN", es: "Contratado, aún sin entregar (no es cartera)", en: "Contracted, not delivered yet (not receivable)" },
  OTHER_IN: { dir: "IN", es: "Otras entradas (financiación, aportes, contratos)", en: "Other inflows (financing, contributions, contracts)" },
  PAY_APPROVED: { dir: "OUT", es: "Pagos a proveedores aprobados", en: "Supplier payments approved" },
  PAY_REQUESTED: { dir: "OUT", es: "Pagos a proveedores pedidos, sin aprobar", en: "Supplier payments requested, not approved" },
  PAY_MILESTONE: { dir: "OUT", es: "Hitos de pago de órdenes, aún sin pedir", en: "Order payment milestones, not requested yet" },
  AP_INVOICE: { dir: "OUT", es: "Facturas de proveedor de compras internas", en: "Supplier invoices of internal purchases" },
  INTERNAL: { dir: "OUT", es: "Compras internas aprobadas", en: "Internal purchases approved" },
  TRAVEL: { dir: "OUT", es: "Viajes con presupuesto aprobado", en: "Trips with an approved budget" },
  COMMISSIONS: { dir: "OUT", es: "Comisiones aprobadas sin pagar", en: "Commissions approved, not paid" },
  OBLIGATIONS: { dir: "OUT", es: "Contratos y obligaciones", en: "Contracts and obligations" },
  PLAN_OUT: { dir: "OUT", es: "Nómina, impuestos, financiación y otros", en: "Payroll, taxes, financing and others" },
} as const satisfies Record<string, Txt & { dir: "IN" | "OUT" }>;
export type Bucket = keyof typeof BUCKETS;

export type FItem = {
  key: string; bucket: Bucket; label: string; amount: number;
  /** the day the money is expected to move; null = nobody knows yet */
  on: Date | null;
  /** for an invoice: the contractual due date, kept apart from `on` (AC4) */
  due?: Date | null;
  confidence: Confidence; source: string; observedAt: Date | null; href: string | null;
  /** approved money out, not yet paid: it already uses up what the bank shows */
  committed: boolean;
};
export const dirOf = (b: Bucket) => BUCKETS[b].dir;

/** When an issued invoice is expected to be paid (AC4, §7): an open promise first; otherwise the customer's real
 *  behaviour when there is history; otherwise the contract. The contractual due date is never changed by this. */
export function expectedCollection(inv: { issuedAt: Date; dueAt: Date }, expectedDays: number | null, openPromise: Date | null, now: Date): { on: Date; basis: "PROMISE" | "BEHAVIOR" | "CONTRACT"; bucket: Bucket } {
  if (openPromise && openPromise >= now) return { on: openPromise, basis: "PROMISE", bucket: "PROMISED" };
  const byBehavior = expectedDays != null ? addDays(inv.issuedAt, expectedDays) : null;
  const on = byBehavior && byBehavior > inv.dueAt ? byBehavior : inv.dueAt;
  return { on, basis: byBehavior && byBehavior > inv.dueAt ? "BEHAVIOR" : "CONTRACT", bucket: inv.dueAt < now ? "DUE_EXPECTED" : "ISSUED_NOT_DUE" };
}

/** A reserve still holds money while it has not been released and its date has not passed. */
export const reserveOpen = (r: { releasedAt: Date | null; until: Date | null }, now: Date) => !r.releasedAt && (!r.until || r.until >= now);

/** Available Liquidity, line by line (AC1): bank − restricted − reserved − committed. Only USD is added; a balance
 *  in another currency is listed apart, never converted in silence. */
export function liquidity(balances: { amount: number; currency: string }[], reserves: { kind: string; amount: number; currency: string }[], items: FItem[]) {
  const usd = (c: string) => c === "USD";
  const bank = sumMoney(balances.filter((b) => usd(b.currency)).map((b) => b.amount));
  const restricted = sumMoney(reserves.filter((r) => r.kind === "RESTRICTED" && usd(r.currency)).map((r) => r.amount));
  const reserved = sumMoney(reserves.filter((r) => r.kind !== "RESTRICTED" && usd(r.currency)).map((r) => r.amount));
  const committed = sumMoney(items.filter((x) => x.committed && dirOf(x.bucket) === "OUT").map((x) => x.amount));
  const available = subMoney(bank, restricted, reserved, committed);
  const otherCurrency = [...balances.filter((b) => !usd(b.currency)).map((b) => ({ what: "BALANCE" as const, ...b })), ...reserves.filter((r) => !usd(r.currency)).map((r) => ({ what: "RESERVE" as const, amount: r.amount, currency: r.currency }))];
  return { bank, restricted, reserved, committed, available, otherCurrency };
}

/** Cash projected at each horizon: what the bank shows, minus what is set aside, plus what is due in and minus
 *  what is due out by that day. Anything already overdue counts from today. Undated items are left out and counted apart. */
export function projection(bank: number, setAside: number, items: FItem[], now: Date, horizons: readonly number[] = HORIZON_DAYS) {
  const start = subMoney(bank, setAside);
  const dated = items.filter((x) => x.on);
  const rows = horizons.map((h) => {
    const upTo = dated.filter((x) => daysBetween(now, x.on!) <= h);
    const inflow = sumMoney(upTo.filter((x) => dirOf(x.bucket) === "IN").map((x) => x.amount));
    const outflow = sumMoney(upTo.filter((x) => dirOf(x.bucket) === "OUT").map((x) => x.amount));
    return { days: h, inflow, outflow, projected: subMoney(sumMoney([start, inflow]), outflow) };
  });
  const undated = items.filter((x) => !x.on);
  return { start, rows, undatedIn: sumMoney(undated.filter((x) => dirOf(x.bucket) === "IN").map((x) => x.amount)), undatedOut: sumMoney(undated.filter((x) => dirOf(x.bucket) === "OUT").map((x) => x.amount)), undatedN: undated.length };
}

/** The lowest point of cash inside the window, walking the dated movements day by day (on a same day, money out
 *  is counted before money in, so the low point is never flattered). A gap is a low point below zero. */
export function lowPoint(bank: number, setAside: number, items: FItem[], now: Date, windowDays = 90) {
  let run = subMoney(bank, setAside);
  let low = run, lowOn: Date | null = null;
  const seq = items.filter((x) => x.on && daysBetween(now, x.on) <= windowDays)
    .map((x) => ({ x, day: x.on! < now ? now : x.on! }))
    .sort((a, b) => +a.day - +b.day || (dirOf(a.x.bucket) === "OUT" ? -1 : 1) - (dirOf(b.x.bucket) === "OUT" ? -1 : 1));
  for (const { x, day } of seq) {
    run = dirOf(x.bucket) === "IN" ? sumMoney([run, x.amount]) : subMoney(run, x.amount);
    if (run < low - 0.004) { low = run; lowOn = day; }
  }
  return { low, lowOn, gap: low < -0.004 ? money2(-low) : 0 };
}

/** What could move if cash falls short, as facts with their amounts (§2A "escenarios de gap de caja y funding").
 *  SOLU proposes nothing and assumes nothing: each lever is money that exists today in a known state. */
export function gapLevers(items: FItem[], reserves: { kind: string; amount: number; currency: string }[], now: Date, until: Date | null) {
  const before = (x: FItem) => !!x.on && (!until || x.on <= until);
  const overdueIn = items.filter((x) => (x.bucket === "DUE_EXPECTED") && x.amount > 0);
  const readyToInvoice = items.filter((x) => x.bucket === "INVOICE_READY");
  const deferrable = items.filter((x) => dirOf(x.bucket) === "OUT" && !x.committed && before(x));
  return {
    collectOverdue: { n: overdueIn.length, usd: sumMoney(overdueIn.map((x) => x.amount)) },
    invoiceReady: { n: readyToInvoice.length, usd: sumMoney(readyToInvoice.map((x) => x.amount)) },
    deferrable: { n: deferrable.length, usd: sumMoney(deferrable.map((x) => x.amount)) },
    reserved: sumMoney(reserves.filter((r) => r.kind !== "RESTRICTED" && r.currency === "USD").map((r) => r.amount)),
  };
}

/** Totals by bucket, in the order of §17. */
export function byBucket(items: FItem[]) {
  return (Object.keys(BUCKETS) as Bucket[]).map((b) => { const xs = items.filter((x) => x.bucket === b); return { bucket: b, n: xs.length, usd: sumMoney(xs.map((x) => x.amount)), items: xs }; }).filter((g) => g.n > 0);
}

/** How old a confirmed balance is. A forecast on a stale balance says so instead of looking exact. */
export function balanceAge(observedAt: Date | null, now: Date) {
  if (!observedAt) return { days: null, stale: true };
  const days = Math.max(0, daysBetween(observedAt, now));
  return { days, stale: days > 7 };
}

export const PLAN_CATS: Record<string, Txt> = {
  PAYROLL: { es: "Nómina", en: "Payroll" }, TAX: { es: "Impuestos", en: "Taxes" }, FINANCING: { es: "Financiación (crédito, cuota, desembolso)", en: "Financing (loan, instalment, drawdown)" },
  INVESTMENT: { es: "Inversión o aporte de socios", en: "Investment or partner contribution" }, RENT: { es: "Arriendo y servicios", en: "Rent and utilities" }, OTHER: { es: "Otro", en: "Other" },
};
/** The dates of a plan item between today and `to`: once, or every month until its end. Past dates of a one-off stay (overdue). */
export function planDates(p: { dueOn: Date; repeat: string; repeatUntil: Date | null; endedAt: Date | null }, now: Date, to: Date) {
  if (p.endedAt) return [];
  if (p.repeat !== "MONTHLY") return p.dueOn <= to ? [p.dueOn] : [];
  const out: Date[] = [];
  for (let k = 0; k < 240 && out.length < 14; k++) {
    const x = new Date(Date.UTC(p.dueOn.getUTCFullYear(), p.dueOn.getUTCMonth() + k, 1));
    const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
    x.setUTCDate(Math.min(p.dueOn.getUTCDate(), last));
    if (x > to || (p.repeatUntil && x > p.repeatUntil)) break;
    if (x >= now) out.push(x);
  }
  return out;
}
