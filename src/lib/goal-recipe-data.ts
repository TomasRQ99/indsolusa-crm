import { db } from "./db";
import { sumMoney } from "./money";
import { periodBounds } from "./goal-rules";
import type { RecipeKey } from "./goal-recipe";

// Recetario mensual · what already happened this month for each row, counted from what is recorded in SOLU.
// Attribution as in Mis metas: quotes and sales by the Need's owner; contacts by who logged them.

const BOGOTA_MS = 5 * 3600e3;
/** Start and end of today in Bogotá, as UTC instants. */
function bogotaToday(now: Date) {
  const local = new Date(now.getTime() - BOGOTA_MS);
  const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + BOGOTA_MS);
  return { start, end: new Date(start.getTime() + 864e5) };
}

/** Calls, emails and meetings that were really attempted or held (a meeting being arranged or cancelled is not one). */
const prospectingWhere = (userId: string, occurredAt: { gte: Date; lt: Date }) => ({
  userId, occurredAt, type: { in: ["CALL", "EMAIL", "MEETING"] as ("CALL" | "EMAIL" | "MEETING")[] },
  NOT: { outcome: { in: ["ARRANGING", "CANCELLED"] } },
});

export async function recipeActuals(userId: string, period: string, now = new Date()): Promise<{ actual: Partial<Record<RecipeKey, number>>; avg12: number | null; isCurrent: boolean }> {
  const { start, end } = periodBounds(period);
  const inMonth = { gte: start, lt: end };
  const today = bogotaToday(now);
  const isCurrent = today.start < end && today.end > start;
  const yearAgo = new Date(now.getTime() - 365 * 864e5);
  const [accepted, quoted, meetings, pitches, activities, daily, last12] = await Promise.all([
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: inMonth, deal: { ownerId: userId } }, select: { protSale: true } }),
    db.quote.findMany({ where: { presentedAt: inMonth, status: { not: "DRAFT" }, deal: { ownerId: userId } }, select: { dealId: true }, distinct: ["dealId"] }),
    db.activity.findMany({ where: { userId, type: "MEETING", occurredAt: inMonth, accountId: { not: null }, OR: [{ outcome: null }, { outcome: "DONE" }] }, select: { accountId: true }, distinct: ["accountId"] }),
    db.activity.count({ where: { userId, occurredAt: inMonth, valueKind: "DECISION_MAKER" } }),
    db.activity.count({ where: prospectingWhere(userId, inMonth) }),
    isCurrent ? db.activity.count({ where: prospectingWhere(userId, { gte: today.start, lt: today.end }) }) : Promise.resolve(0),
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: { gte: yearAgo }, deal: { ownerId: userId } }, select: { protSale: true } }),
  ]);
  // A first meeting: a customer with no meeting held (by anyone) before this month.
  const met = meetings.map((m) => m.accountId!).filter(Boolean);
  const before = met.length ? await db.activity.findMany({ where: { type: "MEETING", accountId: { in: met }, occurredAt: { lt: start }, OR: [{ outcome: null }, { outcome: "DONE" }] }, select: { accountId: true }, distinct: ["accountId"] }) : [];
  const seen = new Set(before.map((b) => b.accountId));
  const sale = sumMoney(accepted.map((q) => q.protSale));
  const sale12 = sumMoney(last12.map((q) => q.protSale));
  return {
    actual: {
      salesGoal: sale,
      avgSale: accepted.length ? sale / accepted.length : undefined,
      closes: accepted.length,
      quotes: quoted.length,
      meetings: met.filter((a) => !seen.has(a)).length,
      pitches,
      activities,
      ...(isCurrent ? { daily } : {}),
    },
    avg12: last12.length ? Math.round(sale12 / last12.length) : null,
    isCurrent,
  };
}

export const recipeFor = (userId: string, period: string) => db.goalRecipe.findUnique({ where: { userId_period: { userId, period } } });
