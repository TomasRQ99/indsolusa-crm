// #5 (constitution: no artificial pressure). A supplier email says URGENT only when the Journey
// really is urgent. SOLU suggests it from facts; the person confirms it on the RFQ form.
import { db } from "./db";
import { isWorkingDay } from "./holidays";
import { today } from "./domain";

export const URGENT_WORKING_DAYS = 3;

const workingDaysUntil = (d: Date) => {
  const a = today(); const b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (b <= a) return 0;
  let n = 0; const c = new Date(a);
  while (c < b) { c.setUTCDate(c.getUTCDate() + 1); if (isWorkingDay(c)) n++; }
  return n;
};

/** Urgent when the customer said so (in a conversation linked to the Journey, not rejected) or
 *  needs it within 3 working days. Returns the reason in both languages, or null when not urgent. */
export async function journeyUrgency(dealId: string | null | undefined): Promise<{ es: string; en: string } | null> {
  if (!dealId) return null;
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { neededBy: true, closedAt: true } });
  if (!deal || deal.closedAt) return null;
  const said = await db.commItem.findFirst({ where: { field: "urgency", status: { not: "REJECTED" }, thread: { dealId } }, select: { id: true } });
  if (said) return { es: "el cliente dijo que es urgente", en: "the customer said it's urgent" };
  if (deal.neededBy && workingDaysUntil(deal.neededBy) <= URGENT_WORKING_DAYS) return { es: "el cliente lo necesita en 3 días hábiles o menos", en: "the customer needs it within 3 working days" };
  return null;
}
