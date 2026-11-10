import { db } from "./db";
import { today } from "./domain";
import { subMoney, sumMoney } from "./money";
import { prContext, type PrFull } from "./pr";
import { exposureOf, prReadiness, prTotals } from "./pr-rules";
import { DEFAULT_PURCHASE_POLICY, PURCHASE_POLICY_KEY, REASON_TEXT, cleanPolicy, covers, levelOf, reasonsOf, type AuthFacts, type PurchasePolicy } from "./purchase-auth";

// Operaciones O2 · authorization data: the facts the policy reads, what the approver sees (§8, no score, only
// legible facts) and Purchase Readiness including the approval.

export async function getPurchasePolicy(): Promise<{ value: PurchasePolicy; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: PURCHASE_POLICY_KEY }, orderBy: { version: "desc" } });
  return s ? { value: cleanPolicy(s.value as Partial<PurchasePolicy>), version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_PURCHASE_POLICY, version: 0, by: null, at: null };
}

export async function authView(pr: PrFull, policy: PurchasePolicy) {
  const T = today();
  const in14 = new Date(T.getTime() + 14 * 864e5);
  const ctx = await prContext(pr);
  const tot = prTotals(pr.lines);
  const ex = exposureOf(pr);
  const codes = pr.lines.map((l) => l.code).filter((c): c is string => !!c);
  const since = new Date(T.getTime() - policy.relatedDays * 864e5);
  const bal = (i: { amount: unknown; applications: { amount: unknown }[] }) => subMoney(i.amount as never, ...i.applications.map((a) => a.amount as never));
  const [related, sup, supReceived, supOpen, committed, quote, overdueInv, upcoming, collections] = await Promise.all([
    pr.supplierId ? db.purchaseRequirement.findMany({ where: { id: { not: pr.id }, cancelledAt: null, supplierId: pr.supplierId, createdAt: { gte: since }, OR: [...(pr.dealId ? [{ dealId: pr.dealId }] : []), ...(codes.length ? [{ lines: { some: { code: { in: codes } } } }] : []), { id: "" }] }, select: { code: true, lines: { select: { qty: true, expectedUnitCost: true, code: true, manufacturer: true, description: true, allocations: { select: { dealId: true, qty: true } } } } } }) : [],
    pr.supplierId ? db.supplier.findUnique({ where: { id: pr.supplierId }, select: { name: true, advancePct: true, paymentTerms: true } }) : null,
    pr.supplierId ? db.supplierPO.count({ where: { supplierId: pr.supplierId, receivedAt: { not: null } } }) : 0,
    pr.supplierId ? db.supplierPO.findMany({ where: { supplierId: pr.supplierId, releasedAt: { not: null }, receivedAt: null }, select: { amount: true, payments: { where: { executedAt: { not: null } }, select: { amountUsd: true } } } }) : [],
    pr.deal ? db.deal.aggregate({ where: { accountId: pr.deal.accountId, stage: "WON", invoices: { none: {} } }, _sum: { amount: true } }) : null,
    pr.dealId ? db.quote.findFirst({ where: { dealId: pr.dealId, status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, select: { protSale: true, protEsagra: true } }) : null,
    pr.deal ? db.invoice.findMany({ where: { accountId: pr.deal.accountId, dueAt: { lt: T } }, select: { amount: true, applications: { select: { amount: true } } } }) : [],
    db.supplierPayment.aggregate({ where: { executedAt: null, dueBy: { lte: in14 } }, _sum: { amountUsd: true } }),
    db.invoice.findMany({ where: { dueAt: { gte: T, lte: in14 } }, select: { amount: true, applications: { select: { amount: true } } } }),
  ]);
  // Related Commitment Total (§5.3): same supplier within the policy window, for the same Journey or the same product.
  const relatedTotal = sumMoney([tot.total, ...related.map((r) => prTotals(r.lines).total)]);
  const committedAmt = Number(committed?._sum.amount ?? 0);
  const exposure = (ctx.credit?.exposure ?? 0) + committedAmt;
  const facts: AuthFacts = {
    amount: tot.total, relatedTotal, stockQty: ex.qty, stockAmount: ex.amount,
    costOver: ctx.protectedCost != null && ctx.protectedCost > 0 ? Math.max(0, subMoney(tot.allocatedAmount, ctx.protectedCost)) : 0,
    overCredit: ctx.credit?.limit != null && exposure > ctx.credit.limit,
    newSupplier: !!pr.supplierId && supReceived === 0,
    fullAdvance: sup?.advancePct === 100,
  };
  const sale = quote?.protSale != null ? Number(quote.protSale) : null;
  const esagara = quote?.protEsagra != null ? Number(quote.protEsagra) : null;
  const context = {
    purchase: { total: tot.total, currency: pr.currency, lines: pr.lines.map((l) => `${l.qty} × ${l.code ?? l.description}`), stockQty: ex.qty, stockAmount: ex.amount, relatedTotal, relatedCodes: related.map((r) => r.code) },
    customer: pr.deal ? { name: pr.deal.account.name, sale, esagara, pct: sale && esagara != null ? Math.round((esagara / sale) * 1000) / 10 : null, costOver: facts.costOver, creditLimit: ctx.credit?.limit ?? null, openAR: ctx.credit?.exposure ?? 0, overdue: sumMoney(overdueInv.map(bal).filter((x) => x > 0)), committed: committedAmt } : null,
    supplier: sup ? { name: sup.name, received: supReceived, openPos: sumMoney(supOpen.map((p) => p.amount)), advanced: sumMoney(supOpen.flatMap((p) => p.payments.map((x) => x.amountUsd))), advancePct: sup.advancePct, terms: sup.paymentTerms } : null,
    cash: { upcomingPayments: Number(upcoming._sum.amountUsd ?? 0), expectedCollections: sumMoney(collections.map(bal).filter((x) => x > 0)) },
  };
  return { facts, reasons: reasonsOf(facts, policy), level: levelOf(relatedTotal, policy), context };
}
export type AuthContext = Awaited<ReturnType<typeof authView>>["context"];

/** Purchase Readiness including the authorization: an uncovered reason blocks; a covering approval clears it. */
export async function fullReadiness(pr: PrFull) {
  const pol = await getPurchasePolicy();
  const [base, auth, last] = await Promise.all([
    prContext(pr).then((c) => prReadiness(pr, c)),
    authView(pr, pol.value),
    db.purchaseApproval.findFirst({ where: { prId: pr.id }, orderBy: { requestedAt: "desc" } }),
  ]);
  const covered = auth.reasons.length > 0 && covers(last, auth.reasons, auth.facts);
  // One authorization covers every reason, stock included: the stock blocker is restated as part of it.
  let blockers = base.blockers.filter((b) => b.key !== "stock");
  if (auth.reasons.length > 0 && !covered) {
    const st = last?.status === "APPROVED" ? "STALE" : last?.status ?? "NONE";
    const list = { es: auth.reasons.map((x) => REASON_TEXT[x].es).join("; "), en: auth.reasons.map((x) => REASON_TEXT[x].en).join("; ") };
    const who = auth.level === 2 ? { es: "Gerencia (nivel 2)", en: "Management (level 2)" } : { es: "Finanzas, Administración o Gerencia", en: "Finance, Administration or Management" };
    const buyer = { es: "Quien compra", en: "The buyer" };
    blockers = [...blockers, {
      key: "approval",
      blocker: st === "REQUESTED" ? { es: "Esperando autorización de la compra", en: "Awaiting purchase authorization" } : st === "RETURNED" ? { es: "La autorización fue devuelta con una pregunta", en: "The authorization was returned with a question" } : st === "REJECTED" ? { es: "La compra no fue autorizada", en: "The purchase was not authorized" } : st === "STALE" ? { es: "La autorización anterior ya no cubre esta compra", en: "The earlier authorization no longer covers this purchase" } : { es: "Esta compra necesita autorización", en: "This purchase needs authorization" },
      impact: list,
      owner: st === "REQUESTED" ? who : buyer,
      path: st === "REQUESTED" ? { es: "La decide alguien distinto de quien la pidió", en: "Someone other than the requester decides it" } : st === "NONE" || st === "STALE" ? { es: "Pide la autorización abajo, con su contexto", en: "Request the authorization below, with its context" } : { es: "Responde o ajusta la compra y vuelve a pedirla", en: "Answer or adjust the purchase and request it again" },
      evidence: { es: "Decisión registrada: quién, cuándo y versión de la política", en: "Recorded decision: who, when and policy version" },
    }];
  }
  const result = blockers.length ? ("NEEDS_RESOLUTION" as const) : covered ? ("READY_WITH_APPROVED_EXCEPTION" as const) : ("READY_TO_PURCHASE" as const);
  return { readiness: { ...base, blockers, result }, auth, last, covered, policy: pol };
}
