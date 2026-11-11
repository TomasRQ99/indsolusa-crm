import type { Prisma, Role } from "@prisma/client";
import { db } from "./db";
import { today } from "./domain";
import { canDecideCredit, canManageAll, isGerencia } from "./permissions";
import { loadCredit, loadSupplierPayments } from "./queries";
import { getPurchasePolicy } from "./pr-auth";
import { REASON_TEXT, type Reason } from "./purchase-auth";
import { APPROVER_ROLES } from "./esagara-gate";
import {
  AREAS, GERENCIA_POLICY_KEY, DEFAULT_GERENCIA_POLICY, asPairs, asStrings, decisionStage, inForce, rankQueue, readGerenciaPolicy,
  type CharterView, type GerenciaPolicy, type QueueEntry,
} from "./gerencia-rules";

// Módulo 15 · reads shared by the Gerencia screens. Gerencia looks through the same records every other module
// uses: nothing here keeps a second copy of a figure (principle 8, AC18).

type Txt = { es: string; en: string };
const tx = (es: string, en: string): Txt => ({ es, en });
const usd = (n: number) => `USD ${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
type U = { id: string; role: Role };

export async function getGerenciaPolicy(): Promise<{ value: GerenciaPolicy; version: number; by: string | null; at: Date | null; reason: string | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: GERENCIA_POLICY_KEY }, orderBy: { version: "desc" } });
  return s ? { value: readGerenciaPolicy(s.value), version: s.version, by: s.updatedByName, at: s.createdAt, reason: s.reason } : { value: DEFAULT_GERENCIA_POLICY, version: 0, by: null, at: null, reason: null };
}

// ---------- Identity and function charters (§22–23) ----------

export async function identityVersions() {
  return db.companyIdentity.findMany({ orderBy: { version: "desc" } });
}
export async function identityInForce(on = today()) {
  return inForce(await identityVersions(), on);
}
const charterSelect = { id: true, functionKey: true, version: true, purpose: true, contribution: true, outputs: true, responsibilities: true, decisionRights: true, interfaces: true, resources: true, ownerId: true, effectiveFrom: true, reason: true, publishedByName: true, publishedAt: true, owner: { select: { id: true, name: true, active: true } } } satisfies Prisma.FunctionCharterSelect;
export type CharterRow = Prisma.FunctionCharterGetPayload<{ select: typeof charterSelect }>;
export async function charterVersions() {
  return db.functionCharter.findMany({ orderBy: [{ functionKey: "asc" }, { version: "desc" }], select: charterSelect });
}
export const charterView = (c: CharterRow): CharterView => ({
  functionKey: c.functionKey, version: c.version, purpose: c.purpose, outputs: asStrings(c.outputs), responsibilities: asStrings(c.responsibilities), decisionRights: asStrings(c.decisionRights),
  interfaces: asPairs(c.interfaces, "with", "what"), resources: c.resources, ownerId: c.ownerId, ownerActive: !!c.owner?.active, effectiveFrom: c.effectiveFrom,
});
/** The charter in force of each function on a day (the highest version whose date has arrived). */
export function chartersInForce(all: CharterRow[], on = today()) {
  const out: CharterRow[] = [];
  for (const key of new Set(all.map((c) => c.functionKey))) { const c = inForce(all.filter((x) => x.functionKey === key), on); if (c) out.push(c); }
  return out;
}

// ---------- Management decisions (§4) ----------

export const decisionInclude = { reviews: { orderBy: { createdAt: "asc" } }, ownerAfter: { select: { id: true, name: true } }, scenario: { select: { id: true, title: true } } } satisfies Prisma.ManagementDecisionInclude;
export type DecisionRow = Prisma.ManagementDecisionGetPayload<{ include: typeof decisionInclude }>;
/** Who may read a decision record: Gerencia and Dirección read all; anyone reads what they asked for or now own. */
export const canReadDecision = (u: U, d: { requestedById: string; ownerAfterId: string | null }) => canManageAll(u) || d.requestedById === u.id || d.ownerAfterId === u.id;
export const decisionScope = (u: U): Prisma.ManagementDecisionWhereInput => (canManageAll(u) ? {} : { OR: [{ requestedById: u.id }, { ownerAfterId: u.id }] });

// ---------- Decisions Needed (§2C) ----------

export type NeededItem = QueueEntry & {
  source: "REQUEST" | "PURCHASE" | "INTERNAL" | "ESAGARA" | "CREDIT_REQUEST" | "CREDIT_LIMIT" | "POLICY" | "PAYMENT";
  area: string; question: Txt; whyNow: Txt; impact: string | null; options: Txt[]; facts: string | null; assumptions: string | null; recommendation: string | null;
  ownerAfter: string | null; askedBy: string | null; href: string;
};
const APPROVE_OPTS = [tx("Aprobar", "Approve"), tx("Devolver con una pregunta", "Return with a question"), tx("Rechazar", "Reject")];
const cut = (s: string | null | undefined, n = 220) => { const v = (s ?? "").trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };

/** Every matter that waits for a decision this person has the authority to take, from the records that hold it.
 *  Nothing is typed twice: an approval stays in its own module and is decided there; here it only gets a place in line. */
export async function neededItems(u: U): Promise<NeededItem[]> {
  const ger = isGerencia(u), manager = canManageAll(u), esagaraApprover = APPROVER_ROLES.includes(u.role), credit = canDecideCredit(u);
  const pp = await getPurchasePolicy();
  const l2 = pp.value.level2Roles.includes(u.role);
  const [requests, purchases, internal, esagara, creditReq, creditAcc, policy, payments] = await Promise.all([
    manager ? db.managementDecision.findMany({ where: { status: "REQUESTED", supersededAt: null }, orderBy: { requestedAt: "asc" }, include: { ownerAfter: { select: { name: true } } } }) : [],
    l2 ? db.purchaseApproval.findMany({ where: { status: "REQUESTED", level: 2, requestedById: { not: u.id } }, orderBy: { requestedAt: "asc" }, select: { id: true, prId: true, reasons: true, amount: true, relatedTotal: true, requestedByName: true, requestNote: true, pr: { select: { code: true, neededBy: true, deal: { select: { code: true, internal: true, account: { select: { name: true } } } } } } } }) : [],
    l2 ? db.internalPurchase.findMany({ where: { status: "REQUESTED", level: 2, requesterId: { not: u.id } }, orderBy: { createdAt: "asc" }, select: { id: true, code: true, description: true, need: true, amountUsd: true, neededBy: true, requester: { select: { name: true } }, budget: { select: { name: true } } } }) : [],
    esagaraApprover ? db.esagaraException.findMany({ where: { status: "REQUESTED", requestedById: { not: u.id } }, orderBy: { requestedAt: "asc" }, select: { id: true, saleAmount: true, esagaraAmount: true, esagaraPct: true, thresholdPct: true, narrative: true, expectedBenefit: true, alternatives: true, requestedByName: true, quote: { select: { deal: { select: { code: true, account: { select: { name: true } } } } } } } }) : [],
    credit && ger ? db.creditReviewRequest.findMany({ where: { status: "OPEN", requestedById: { not: u.id } }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, requestedLimit: true, requestedTerms: true, reason: true, alternatives: true, until: true, account: { select: { name: true, creditLimit: true } }, requestedBy: { select: { name: true } } } }) : [],
    ger ? loadCredit() : [],
    ger ? db.policyChangeRequest.findMany({ where: { status: "PENDING", requestedById: { not: u.id } }, select: { id: true, requestedByName: true, reason: true, effectiveFrom: true } }) : [],
    l2 ? loadSupplierPayments({ executedAt: null, approvedAt: null }) : [],
  ]);
  const out: NeededItem[] = [];
  for (const d of requests) out.push({
    key: `d-${d.id}`, requested: true, source: "REQUEST", area: d.area, impactUsd: d.impactUsd == null ? null : Number(d.impactUsd), deadline: d.deadline,
    question: tx(d.question, d.question), whyNow: tx(d.whyNow ?? d.context, d.whyNow ?? d.context), impact: d.impact,
    options: asPairs(d.alternatives).map((a) => tx(a.name, a.name)), facts: d.facts, assumptions: d.assumptions, recommendation: d.recommendation,
    ownerAfter: d.ownerAfter?.name ?? null, askedBy: d.requestedByName, href: `/gerencia/decisiones/${d.id}`,
  });
  for (const a of purchases) {
    const who = a.pr.deal && !a.pr.deal.internal ? `${a.pr.deal.code ?? ""} · ${a.pr.deal.account.name}` : "inventario";
    const reasons = (Array.isArray(a.reasons) ? a.reasons : []).map((r) => REASON_TEXT[r as Reason]).filter(Boolean);
    out.push({
      key: `pa-${a.id}`, requested: false, source: "PURCHASE", area: "OPERACIONES", impactUsd: Number(a.amount), deadline: a.pr.neededBy ?? null,
      question: tx(`¿Se aprueba la compra ${a.pr.code} (${who})?`, `Approve purchase ${a.pr.code} (${who})?`),
      whyNow: tx(`Supera lo que el primer nivel puede aprobar: ${reasons.map((r) => r.es).join("; ") || "por valor"}`, `Above what the first level may approve: ${reasons.map((r) => r.en).join("; ") || "by amount"}`),
      impact: usd(Number(a.amount)), options: APPROVE_OPTS, facts: `Compras relacionadas: ${usd(Number(a.relatedTotal))}.${a.requestNote ? ` ${cut(a.requestNote)}` : ""}`, assumptions: null, recommendation: null,
      ownerAfter: a.requestedByName, askedBy: a.requestedByName, href: `/compras/requerimientos/${a.prId}`,
    });
  }
  for (const p of internal) out.push({
    key: `ip-${p.id}`, requested: false, source: "INTERNAL", area: "ADMINISTRACION", impactUsd: Number(p.amountUsd), deadline: p.neededBy,
    question: tx(`¿Se aprueba la compra interna ${p.code}: ${cut(p.description, 90)}?`, `Approve internal purchase ${p.code}: ${cut(p.description, 90)}?`),
    whyNow: tx(p.budget ? `Sale del presupuesto «${p.budget.name}» y supera el primer nivel o lo que el presupuesto tiene libre` : "No tiene presupuesto asignado: es una excepción", p.budget ? `It comes from budget "${p.budget.name}" and is above the first level or what the budget has left` : "It has no budget assigned: it is an exception"),
    impact: usd(Number(p.amountUsd)), options: APPROVE_OPTS, facts: cut(p.need), assumptions: null, recommendation: null, ownerAfter: p.requester.name, askedBy: p.requester.name, href: `/administracion/compras-internas/${p.id}`,
  });
  for (const e of esagara) out.push({
    key: `ee-${e.id}`, requested: false, source: "ESAGARA", area: "COMERCIAL", impactUsd: Number(e.esagaraAmount), deadline: null,
    question: tx(`¿Se acepta vender a ${e.quote.deal.account.name} con Eságara de ${Number(e.esagaraPct).toFixed(2)} %?`, `Accept selling to ${e.quote.deal.account.name} at ${Number(e.esagaraPct).toFixed(2)} % Eságara?`),
    whyNow: tx(`Está por debajo del ${Number(e.thresholdPct).toFixed(2)} % de la política y no puede presentarse sin esta decisión`, `It is under the policy's ${Number(e.thresholdPct).toFixed(2)} % and cannot be presented without this decision`),
    impact: `Eságara ${usd(Number(e.esagaraAmount))} · venta ${usd(Number(e.saleAmount))}`, options: APPROVE_OPTS,
    facts: cut(e.narrative), assumptions: cut(e.expectedBenefit) || null, recommendation: null, ownerAfter: e.requestedByName, askedBy: e.requestedByName, href: `/comercial/esagara#e-${e.id}`,
  });
  for (const r of creditReq) out.push({
    key: `cr-${r.id}`, requested: false, source: "CREDIT_REQUEST", area: "ADMINISTRACION", impactUsd: r.requestedLimit == null ? null : Number(r.requestedLimit), deadline: r.until,
    question: tx(`¿Se cambia el crédito de ${r.account.name}?`, `Change ${r.account.name}'s credit?`),
    whyNow: tx("Comercial pidió revisarlo para poder seguir vendiendo", "Commercial asked for a review to keep selling"),
    impact: r.requestedLimit != null ? `${usd(Number(r.requestedLimit))} pedidos · cupo actual ${r.account.creditLimit == null ? "sin definir" : usd(Number(r.account.creditLimit))}` : r.requestedTerms != null ? `${r.requestedTerms} días de plazo` : null,
    options: r.alternatives.length ? r.alternatives.map((a) => tx(a, a)) : APPROVE_OPTS, facts: cut(r.reason), assumptions: null, recommendation: null, ownerAfter: r.requestedBy.name, askedBy: r.requestedBy.name, href: "/administracion/cupos#solicitudes",
  });
  for (const a of creditAcc) for (const d of a.blocking) out.push({
    key: `cl-${d.id}`, requested: false, source: "CREDIT_LIMIT", area: "ADMINISTRACION", impactUsd: Math.round((a.used - (a.limit ?? 0)) * 100) / 100, deadline: d.promisedDate ?? null,
    question: tx(`${a.name} supera su cupo con ${d.code ?? d.title}: ¿excepción, anticipo o cupo nuevo?`, `${a.name} exceeds its limit with ${d.code ?? d.title}: exception, advance or new limit?`),
    whyNow: tx("La orden está aceptada y el crédito usado pasa del cupo", "The order is accepted and the credit in use is above the limit"),
    impact: usd(a.used - (a.limit ?? 0)), options: [tx("Autorizar una excepción para esta orden", "Authorise an exception for this order"), tx("Pedir anticipo", "Ask for an advance"), tx("Subir el cupo", "Raise the limit")],
    facts: `Debe ${usd(a.openInvoices)}; aceptado sin facturar ${usd(a.uninvoiced)}; cupo ${usd(a.limit ?? 0)}.`, assumptions: null, recommendation: null, ownerAfter: a.owner?.name ?? null, askedBy: null, href: `/administracion/cupos#${a.id}`,
  });
  for (const p of policy) out.push({
    key: `pc-${p.id}`, requested: false, source: "POLICY", area: "GERENCIA", impactUsd: null, deadline: p.effectiveFrom,
    question: tx("¿Se aprueban los nuevos números de Rentabilidad?", "Approve the new profitability numbers?"), whyNow: tx(`${p.requestedByName} propuso un cambio de política`, `${p.requestedByName} proposed a policy change`),
    impact: null, options: [tx("Aprobar", "Approve"), tx("Rechazar", "Reject")], facts: cut(p.reason), assumptions: null, recommendation: null, ownerAfter: p.requestedByName, askedBy: p.requestedByName, href: "/profile/rentabilidad#pendiente",
  });
  // Supplier payments above the first level's amount: only the second level can release them.
  for (const p of payments.filter((x) => x.state === "APPROVE" && x.requestedById !== u.id && x.verifiedById !== u.id && Number(x.amountUsd ?? 0) > pp.value.level1LimitUsd)) out.push({
    key: `sp-${p.id}`, requested: false, source: "PAYMENT", area: "ADMINISTRACION", impactUsd: Number(p.amountUsd ?? 0), deadline: p.dueBy,
    question: tx(`¿Se aprueba el pago a ${p.supplierPo.supplier.name}?`, `Approve the payment to ${p.supplierPo.supplier.name}?`),
    whyNow: tx(`Supera los ${usd(pp.value.level1LimitUsd)} que aprueba el primer nivel`, `Above the ${usd(pp.value.level1LimitUsd)} the first level approves`),
    impact: usd(Number(p.amountUsd ?? 0)), options: [tx("Aprobar", "Approve"), tx("Devolver", "Return")], facts: `${p.supplierPo.code} · ${p.supplierPo.deal.account.name} · ${cut(p.reason, 140)}`, assumptions: null, recommendation: null,
    ownerAfter: p.requestedBy?.name ?? null, askedBy: p.requestedBy?.name ?? null, href: `/administracion/pagos-proveedores/${p.id}`,
  });
  return out;
}

/** The line Gerencia sees: ranked, capped, with what was left out counted (AC2). Plus decisions whose follow-up date arrived (AC20). */
export async function decisionsNeeded(u: U) {
  const T = today();
  const [items, pol, decided] = await Promise.all([
    neededItems(u), getGerenciaPolicy(),
    canManageAll(u) ? db.managementDecision.findMany({ where: { status: "DECIDED", supersededAt: null }, orderBy: { followUpOn: "asc" }, include: decisionInclude, take: 200 }) : [],
  ]);
  const reviewDue = decided.map((d) => ({ d, s: decisionStage(d, T) })).filter((x) => x.s.stage === "REVIEW_DUE");
  return { ...rankQueue(items, pol.value, T), all: items, reviewDue, policy: pol };
}
export const areaName = (k: string): Txt => AREAS[k] ?? tx(k, k);
