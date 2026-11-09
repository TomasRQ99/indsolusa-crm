// Comercial C2 · Eságara Protection Gate — database side: policy in force, exceptions, approver context.
import { db } from "./db";
import { addDays } from "./domain";
import { DEFAULT_COM_POLICY, effectiveFloor, exceptionCovers, gateOf, type ApprovedException, type ComPolicy } from "./esagara-rules";
import { costOf, saleOf } from "./quote";
import { paymentBehavior } from "./pay-behavior";

export const COM_POLICY_KEY = "comPolicy";
/** Who can decide an exception (user decision 2026-11-09): MANAGER or ADMIN, never the person who asked. */
export const APPROVER_ROLES = ["MANAGER", "ADMIN"];
export const canApprove = (u: { id: string; role: string }, e: { requestedById: string }) => APPROVER_ROLES.includes(u.role) && u.id !== e.requestedById;

export async function getComPolicy(): Promise<{ value: ComPolicy; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: COM_POLICY_KEY }, orderBy: { version: "desc" } });
  return s ? { value: { ...DEFAULT_COM_POLICY, ...(s.value as Partial<ComPolicy>) }, version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_COM_POLICY, version: 0, by: null, at: null };
}

const asApproved = (e: { status: string; saleAmount: unknown; esagaraPct: unknown } | null | undefined): ApprovedException | null =>
  e ? { status: e.status, saleAmount: Number(e.saleAmount), esagaraPct: Number(e.esagaraPct) } : null;

/** Latest exception per quote (any status) — the one the screens talk about. */
export async function latestExceptions(quoteIds: string[]) {
  if (!quoteIds.length) return new Map<string, Awaited<ReturnType<typeof db.esagaraException.findFirst>>>();
  const rows = await db.esagaraException.findMany({ where: { quoteId: { in: quoteIds } }, orderBy: { requestedAt: "desc" } });
  const m = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!m.has(r.quoteId)) m.set(r.quoteId, r);
  return m;
}

/** Floor for one quote version: { version, floorPct } keeps the shape the quote/PO screens already use. */
export async function quoteFloor(quoteId: string | null | undefined) {
  const pol = await getComPolicy();
  const ex = quoteId ? (await latestExceptions([quoteId])).get(quoteId) ?? null : null;
  let approved = ex?.status === "APPROVED" ? asApproved(ex) : null;
  let outside = false;
  // An approval only holds while the economics stay inside the tolerance on BOTH % and amount (§44).
  if (approved && quoteId) {
    const q = await db.quote.findUnique({ where: { id: quoteId }, include: { lines: true } });
    const g = q ? gateOf(saleOf(q.lines), costOf(q), pol.value) : null;
    if (q?.status === "DRAFT" && g && !exceptionCovers(approved, g, pol.value)) { approved = null; outside = true; }
  }
  return { version: pol.version, floorPct: effectiveFloor(pol.value, approved), threshold: pol.value.minEsagaraPct, policy: pol.value, exception: ex, outside };
}

/** Floors for many quotes at once (Commercial Future list). */
export async function quoteFloors(quoteIds: string[]) {
  const pol = await getComPolicy();
  const ex = await latestExceptions(quoteIds);
  const floor = (id: string) => { const e = ex.get(id); return effectiveFloor(pol.value, e?.status === "APPROVED" ? asApproved(e) : null); };
  return { version: pol.version, threshold: pol.value.minEsagaraPct, floor, exceptions: ex };
}

/** What the approver needs to decide in seconds (v1.1 §47), frozen at request time. */
export async function approverContext(quoteId: string) {
  const q = await db.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { lines: true, deal: { include: { account: { select: { id: true, name: true, creditLimit: true, paymentTermsDays: true } }, owner: { select: { name: true } } } } },
  });
  const a = q.deal.account;
  const [open, pay, related] = await Promise.all([
    db.invoice.findMany({ where: { accountId: a.id }, select: { amount: true, applications: { select: { amount: true } } } }),
    paymentBehavior(a.id).catch(() => null),
    // §49 anti-splitting: other commitments for the same customer in the last 60 days.
    db.quote.findMany({ where: { deal: { accountId: a.id }, id: { not: q.id }, createdAt: { gte: addDays(new Date(), -60) }, status: { in: ["DRAFT", "PRESENTED", "ACCEPTED"] } }, include: { lines: true, deal: { select: { title: true, code: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const ar = open.reduce((s, i) => s + Number(i.amount) - i.applications.reduce((x, p) => x + Number(p.amount), 0), 0);
  const committed = await db.deal.aggregate({ where: { accountId: a.id, stage: "WON", invoices: { none: {} } }, _sum: { amount: true } });
  return {
    quote: { number: q.number, rev: q.rev, sale: saleOf(q.lines), cost: costOf(q), supplierCost: Number(q.supplierCost), freightCost: Number(q.freightCost), otherCosts: Number(q.otherCosts), fxRate: q.fxRate ? Number(q.fxRate) : null, costCurrency: q.costCurrency, paymentTerms: q.paymentTerms, incoterm: q.incoterm, supplyPrimary: q.supplyPrimary, supplyAlt: q.supplyAlt, lines: q.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) })) },
    deal: { id: q.deal.id, code: q.deal.code, title: q.deal.title, owner: q.deal.owner.name },
    customer: {
      id: a.id, name: a.name, creditLimit: a.creditLimit != null ? Number(a.creditLimit) : null, termsDays: a.paymentTermsDays, openAR: Math.round(ar * 100) / 100,
      committedNotInvoiced: Number(committed._sum.amount ?? 0),
      expectedPayDays: pay?.b.expected.expectedDays ?? null, trend: pay?.b.trend.trend ?? null,
    },
    related: related.map((r) => { const s = saleOf(r.lines); const c = costOf(r); return { id: r.id, number: r.number, rev: r.rev, status: r.status, deal: `${r.deal.code ?? ""} ${r.deal.title}`.trim(), sale: s, pct: s > 0 ? Math.round(((s - c) / s) * 10000) / 100 : null }; }),
  };
}
export type ApproverContext = Awaited<ReturnType<typeof approverContext>>;
