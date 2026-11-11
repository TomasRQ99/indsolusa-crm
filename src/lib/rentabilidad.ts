import { db } from "./db";
import { tiersOf } from "./commission";
import { getFinanceRate } from "./financing";
import { flatRate, type Numbers } from "./rentabilidad-config";

// Módulo 12 · the profitability numbers in force (latest version of each policy).
export async function currentNumbers(): Promise<{ numbers: Numbers; policyVersion: number | null; policyFrom: Date | null; tiered: boolean; financeVersion: number }> {
  const [p, fin] = await Promise.all([db.commissionPolicy.findFirst({ orderBy: { version: "desc" } }), getFinanceRate()]);
  const flat = flatRate(tiersOf(p));
  return { numbers: { ratePct: flat ?? 0, newClientBonus: p ? Number(p.newClientBonus) : 0, salePercent: p?.salePercent ?? 50, commercialPct: p?.commercialPct ?? 100, proportional: p?.proportionalCollection ?? false, financeAnnualPct: fin.annualPct }, policyVersion: p?.version ?? null, policyFrom: p?.effectiveFrom ?? null, tiered: flat == null, financeVersion: fin.version };
}
