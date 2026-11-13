import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { today } from "./domain";
import { subMoney, sumMoney } from "./money";
import { prReadiness, type PrCtx } from "./pr-rules";

// Operaciones O1 · Purchase Requirement data. A customer purchase gets its requirement automatically from the
// Journey when the Supplier PO is prepared (nobody types it); the buyer then adjusts quantity and assignments.

/** PR-YYMM-0001, same numbering style as Supplier POs. */
export async function nextPrCode(tx: Prisma.TransactionClient) {
  const d = new Date();
  const start = `PR-${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}-`;
  const last = await tx.purchaseRequirement.findFirst({ where: { code: { startsWith: start } }, orderBy: { code: "desc" }, select: { code: true } });
  return `${start}${String(last?.code ? Number(last.code.slice(start.length)) + 1 : 1).padStart(4, "0")}`;
}

export const prInclude = {
  lines: { orderBy: { position: "asc" }, include: { allocations: { include: { deal: { select: { id: true, code: true, title: true, account: { select: { name: true } } } } } } } },
  deal: { select: { id: true, code: true, title: true, ownerId: true, accountId: true, promisedDate: true, account: { select: { id: true, name: true, creditLimit: true } }, quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { supplierCost: true, fxRate: true, supplierValidUntil: true } } } },
  supplier: { select: { id: true, name: true, country: true } },
  requester: { select: { id: true, name: true } },
} satisfies Prisma.PurchaseRequirementInclude;
export type PrFull = Prisma.PurchaseRequirementGetPayload<{ include: typeof prInclude }>;

export async function prContext(pr: PrFull): Promise<PrCtx> {
  const q = pr.deal?.quotes[0] ?? null;
  let credit: PrCtx["credit"] = null;
  if (pr.deal) {
    const inv = await db.invoice.findMany({ where: { accountId: pr.deal.accountId }, select: { amount: true, applications: { select: { amount: true } } } });
    credit = { limit: pr.deal.account.creditLimit != null ? Number(pr.deal.account.creditLimit) : null, exposure: sumMoney(inv.map((i) => subMoney(i.amount, ...i.applications.map((a) => a.amount)))) };
  }
  return { today: today(), supplyValidUntil: q?.supplierValidUntil ?? null, protectedCost: q ? Number(q.supplierCost) * (q.fxRate ? Number(q.fxRate) : 1) : null, credit };
}
export async function prView(id: string) {
  const pr = await db.purchaseRequirement.findUnique({ where: { id }, include: prInclude });
  if (!pr) return null;
  return { pr, readiness: prReadiness(pr, await prContext(pr)) };
}

/** The requirement behind a Supplier PO, created from the PO's own lines the first time (100 % assigned to its Journey). */
export async function ensurePrForSpo(tx: Prisma.TransactionClient, spo: { id: string; dealId: string; supplierId: string; currency: string; shipBy: Date | null; lines: { position: number; qty: number; code: string | null; description: string; unitCost: Prisma.Decimal | number }[] }, user: { id: string; name: string }, sellerKey: string) {
  const had = await tx.purchaseRequirement.findUnique({ where: { supplierPoId: spo.id }, select: { id: true } });
  if (had) return had.id;
  const code = await nextPrCode(tx);
  const pr = await tx.purchaseRequirement.create({ data: {
    code, purpose: "CUSTOMER_FULFILLMENT", sellerKey, requesterId: user.id, dealId: spo.dealId, supplierId: spo.supplierId, currency: spo.currency, neededBy: spo.shipBy, supplierPoId: spo.id, createdByName: user.name,
    sourceEvidence: "Derivado de la Necesidad al preparar la compra",
    lines: { create: spo.lines.map((l) => ({ position: l.position, code: l.code, description: l.description, qty: l.qty, expectedUnitCost: l.unitCost, allocations: { create: [{ dealId: spo.dealId, qty: l.qty }] } })) },
  } });
  return pr.id;
}

/** Readiness of the requirement behind a Supplier PO (null when the PO predates requirements). */
export async function readinessForSpo(spoId: string) {
  const pr = await db.purchaseRequirement.findUnique({ where: { supplierPoId: spoId }, include: prInclude });
  return pr ? { pr, readiness: prReadiness(pr, await prContext(pr)) } : null;
}
