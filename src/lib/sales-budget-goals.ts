import { db } from "./db";

// Presupuesto comercial → Mis metas. The approved budget of a month becomes that month's goals in the batting table
// when the person typed none: purchase orders in value and number, quotes and requests. Only the official budget
// counts (approved and not replaced by a later approved version): a draft or a proposal still waiting is not a goal.
// Both screens work in dollars, so the value passes as it is.

export type BudgetGoal = { value: number };
type Key = "BAT_PO_USD" | "BAT_PO_N" | "BAT_QUOTE_N" | "BAT_REQ_N";
const KPI_OF: Record<string, Key> = { OC_COP: "BAT_PO_USD", OC_N: "BAT_PO_N", COT_N: "BAT_QUOTE_N", SOL_N: "BAT_REQ_N" };

/** `period` = YYYY-MM. Returns nothing when the person has no approved budget with figures for that month. */
export async function budgetGoalsOf(userId: string, period: string): Promise<Partial<Record<Key, BudgetGoal>> | null> {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return null;
  const lines = await db.salesBudgetLine.findMany({ where: { month, kpi: { in: Object.keys(KPI_OF) }, budget: { year, userId, state: "APPROVED", supersededAt: null } }, select: { kpi: true, value: true } });
  if (!lines.length) return null;
  const total = new Map<string, number>();
  for (const l of lines) total.set(l.kpi, (total.get(l.kpi) ?? 0) + Number(l.value));
  const out: Partial<Record<Key, BudgetGoal>> = {};
  for (const k of Object.keys(KPI_OF)) { const v = Math.round(total.get(k) ?? 0); if (v > 0) out[KPI_OF[k]] = { value: v }; }
  return Object.keys(out).length ? out : null;
}
