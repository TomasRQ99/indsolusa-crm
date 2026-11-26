import { db } from "./db";
import { trmLookup } from "./trm-store";

// Presupuesto comercial → Mis metas. The approved budget of a month becomes that month's goals in the batting table
// when the person typed none: purchase orders in value and number, quotes and requests. Only the official budget
// counts (approved and not replaced by a later approved version): a draft or a proposal still waiting is not a goal.
// Mis metas works in dollars and the budget in pesos, so the value is turned into dollars with the official TRM of
// today and the screen says so with both figures.

export type BudgetGoal = { value: number; cop: number; rate: number };
type Key = "BAT_PO_USD" | "BAT_PO_N" | "BAT_QUOTE_N" | "BAT_REQ_N";
const KPI_OF: Record<string, Key> = { OC_COP: "BAT_PO_USD", OC_N: "BAT_PO_N", COT_N: "BAT_QUOTE_N", SOL_N: "BAT_REQ_N" };

/** `period` = YYYY-MM. Returns nothing when the person has no approved budget with figures for that month. */
export async function budgetGoalsOf(userId: string, period: string, now = new Date()): Promise<Partial<Record<Key, BudgetGoal>> | null> {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return null;
  const lines = await db.salesBudgetLine.findMany({ where: { month, kpi: { in: Object.keys(KPI_OF) }, budget: { year, userId, state: "APPROVED", supersededAt: null } }, select: { kpi: true, value: true } });
  if (!lines.length) return null;
  const total = new Map<string, number>();
  for (const l of lines) total.set(l.kpi, (total.get(l.kpi) ?? 0) + Number(l.value));
  const out: Partial<Record<Key, BudgetGoal>> = {};
  const cop = total.get("OC_COP") ?? 0;
  if (cop > 0) {
    const hit = (await trmLookup(now, now))(now);
    // Without today's TRM the value goal is left out rather than converted at a guess.
    if (hit) out.BAT_PO_USD = { value: Math.round(cop / hit.rate), cop, rate: hit.rate };
  }
  for (const k of ["OC_N", "COT_N", "SOL_N"]) { const v = Math.round(total.get(k) ?? 0); if (v > 0) out[KPI_OF[k]] = { value: v, cop: 0, rate: 0 }; }
  return Object.keys(out).length ? out : null;
}
