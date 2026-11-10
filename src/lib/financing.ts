import { db } from "./db";
import { percentOf, subMoney } from "./money";

// Financing cost (decision 2026-11-10): selling on credit means the company finances the customer.
//   cost = sale × yearly cost-of-money rate × days ÷ 365
//   days = what history says the customer takes to pay (reconciled cash); the agreed terms when there is no history.
// One company rate, versioned (MarketSetting "financeRate"), set by Finanzas or Gerencia.
// Shown next to Eságara ($ and %); the 20 % gate keeps using today's formula (it does not include financing).

export const FIN_COST_FORMULA = "fin-cost-v1";

export async function getFinanceRate(): Promise<{ annualPct: number | null; version: number; by: string | null; at: Date | null; note: string | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: "financeRate" }, orderBy: { version: "desc" } });
  const v = (s?.value ?? {}) as { annualPct?: unknown; note?: unknown };
  const pct = Number(v.annualPct);
  return { annualPct: s && Number.isFinite(pct) && pct > 0 ? pct : null, version: s?.version ?? 0, by: s?.updatedByName ?? null, at: s?.createdAt ?? null, note: typeof v.note === "string" ? v.note : null };
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Cost of carrying `amount` for `days` at `annualPct` a year (simple interest, 365-day year). */
export const carryCost = (amount: number, days: number, annualPct: number) => (days > 0 && annualPct > 0 ? percentOf(amount, r6((annualPct * days) / 365)) : 0);

export function financingOf(o: { sale: number; esagra: number; expectedDays: number | null; contractualDays: number; annualPct: number | null }) {
  const basis: "HISTORY" | "TERMS" = o.expectedDays != null ? "HISTORY" : "TERMS";
  const days = Math.max(0, o.expectedDays ?? o.contractualDays);
  if (o.annualPct == null) return { basis, days, rateMissing: true as const };
  const termsDays = Math.min(days, Math.max(0, o.contractualDays));
  const lateDays = Math.max(0, days - termsDays);
  const cost = carryCost(o.sale, days, o.annualPct);
  const lateCost = carryCost(o.sale, lateDays, o.annualPct);
  const after = subMoney(o.esagra, cost);
  return {
    basis, days, termsDays, lateDays, rateMissing: false as const, annualPct: o.annualPct,
    cost, termsCost: subMoney(cost, lateCost), lateCost,
    esagraAfter: after, pctAfter: o.sale > 0 ? (after / o.sale) * 100 : null,
  };
}
