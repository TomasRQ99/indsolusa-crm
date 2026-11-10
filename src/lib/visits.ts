import { db } from "./db";
import { subMoney, sumMoney } from "./money";

// Comercial C8a · Visits & Commercial Missions (module 10 v1.3 §57). The Visit Brief is derived: it gathers what
// SOLU already knows about the customer so nobody re-types it (AC "no manual re-entry of known data").

type Txt = { es: string; en: string };
export const OBJECTIVE_CATS: Record<string, Txt> = {
  UNDERSTAND: { es: "Entender", en: "Understand" },
  RELATIONSHIP: { es: "Relación", en: "Relationship" },
  SOLVE: { es: "Resolver", en: "Solve" },
  PRESENT_DECIDE: { es: "Presentar / decidir", en: "Present / decide" },
  ACCOMPANY: { es: "Acompañar", en: "Accompany" },
  FUTURE: { es: "Futuro", en: "Future" },
};
export const VISIT_STATUS: Record<string, Txt> = { PLANNED: { es: "Planeada", en: "Planned" }, DONE: { es: "Hecha", en: "Done" }, CANCELLED: { es: "Cancelada", en: "Cancelled" } };
export type Objective = { cat: string; text: string };
export const readObjectives = (v: unknown): Objective[] => (Array.isArray(v) ? v : []).filter((o): o is Objective => !!o && typeof o === "object" && typeof (o as Objective).cat === "string" && !!OBJECTIVE_CATS[(o as Objective).cat]).map((o) => ({ cat: o.cat, text: String(o.text ?? "").slice(0, 300) }));

/** Everything worth knowing before walking in, from records that already exist. */
export async function visitBrief(accountId: string, excludeVisitId?: string) {
  const [account, deals, quotes, pos, blockers, invoices, commitments, futures, lastVisits] = await Promise.all([
    db.account.findUniqueOrThrow({ where: { id: accountId }, select: { id: true, name: true, address: true, phone: true, creditLimit: true, paymentTermsDays: true, contacts: { orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, title: true, phone: true, email: true } }, plants: { select: { id: true, name: true, city: true } } } }),
    db.deal.findMany({ where: { accountId, stage: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, code: true, title: true, desiredResult: true, nextMove: true, nextMoveDate: true, waitingFor: true, owner: { select: { name: true } } } }),
    db.quote.findMany({ where: { status: "PRESENTED", deal: { accountId } }, orderBy: { presentedAt: "desc" }, take: 10, select: { id: true, number: true, rev: true, protSale: true, protEsagra: true, presentedAt: true, decisionAt: true, deal: { select: { id: true, code: true, title: true } } } }),
    db.customerPO.findMany({ where: { deal: { accountId, resultAchievedAt: null }, acceptance: { isNot: null } }, orderBy: { receivedAt: "desc" }, take: 8, select: { id: true, number: true, deal: { select: { id: true, code: true, title: true, promisedDate: true } } } }),
    db.cashBlocker.findMany({ where: { deal: { accountId }, resolvedAt: null }, orderBy: { blockedSince: "asc" }, select: { id: true, stage: true, reasonCode: true, narrative: true, blockedValue: true, nextMovement: true, deal: { select: { id: true, code: true, title: true } } } }),
    db.invoice.findMany({ where: { accountId }, select: { id: true, number: true, amount: true, dueAt: true, applications: { select: { amount: true } } } }),
    db.visitCommitment.findMany({ where: { status: "OPEN", visit: { accountId, ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}) } }, orderBy: { dueAt: "asc" }, select: { id: true, side: true, what: true, dueAt: true, visit: { select: { id: true, happenedAt: true } } } }),
    db.futureOpportunity.findMany({ where: { accountId }, orderBy: { expectedAt: "asc" }, take: 8, select: { id: true, kind: true, description: true, expectedAt: true, nextMove: true } }),
    db.visitPlan.findMany({ where: { accountId, status: "DONE", ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}) }, orderBy: { happenedAt: "desc" }, take: 3, select: { id: true, happenedAt: true, learned: true, owner: { select: { name: true } } } }),
  ]);
  const now = new Date();
  const open = invoices.map((i) => ({ ...i, balance: subMoney(i.amount, ...i.applications.map((a) => a.amount)) })).filter((i) => i.balance > 0.005);
  const overdue = open.filter((i) => i.dueAt < now);
  return {
    account, deals, quotes, pos, blockers, commitments, futures, lastVisits,
    ar: { open: sumMoney(open.map((i) => i.balance)), overdue: sumMoney(overdue.map((i) => i.balance)), overdueCount: overdue.length, items: open.slice(0, 8) },
  };
}
export type VisitBrief = Awaited<ReturnType<typeof visitBrief>>;
