import { db } from "./db";
import { invoiceCash, today } from "./domain";
import { sumMoney } from "./money";
import { focusItems, getFocusPolicy } from "./focus";
import { opsHome } from "./ops-home";
import { highValueCommitments } from "./hv";
import { profitSummary } from "./profit-summary";

// Módulo 13 §6 and v1.1 §25 · Future Pulse. Four different futures, shown side by side and never added into one
// number: what the market may bring, what Commercial is working, what is already contracted, and the money on its way.
// No probabilities: each figure is a count or an amount in a real state, grouped by when it is due.

type Txt = { es: string; en: string };
export const HORIZONS = ["OVERDUE", "D30", "D90", "LATER", "NODATE"] as const;
export type Horizon = (typeof HORIZONS)[number];
export const HORIZON_TEXT: Record<Horizon, Txt> = { OVERDUE: { es: "Ya pasó", en: "Past due" }, D30: { es: "Próximos 30 días", en: "Next 30 days" }, D90: { es: "31 a 90 días", en: "31 to 90 days" }, LATER: { es: "Más de 90 días", en: "Beyond 90 days" }, NODATE: { es: "Sin fecha", en: "No date" } };
/** Which window a date falls in, counted from `now` (pure). */
export function horizonOf(d: Date | null | undefined, now: Date): Horizon {
  if (!d) return "NODATE";
  const days = Math.floor((+d - +now) / 864e5);
  return days < 0 ? "OVERDUE" : days <= 30 ? "D30" : days <= 90 ? "D90" : "LATER";
}
type Bucket = Record<Horizon, { n: number; usd: number }>;
const empty = (): Bucket => Object.fromEntries(HORIZONS.map((h) => [h, { n: 0, usd: 0 }])) as Bucket;
const put = (b: Bucket, h: Horizon, usd: number) => { b[h].n++; b[h].usd = Math.round((b[h].usd + usd) * 100) / 100; };

export async function futurePulse() {
  const T = today();
  const pol = await getFocusPolicy();
  const [futures, items, contracted, invoices, payments] = await Promise.all([
    db.futureOpportunity.findMany({ orderBy: { expectedAt: "asc" }, take: 200, select: { id: true, description: true, expectedAt: true, account: { select: { id: true, name: true } } } }),
    focusItems(null, pol.value),
    db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" } }, select: { id: true, code: true, title: true, promisedDate: true, account: { select: { name: true } }, quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { protSale: true } }, invoices: { select: { amount: true } } } }),
    db.invoice.findMany({ select: { dueAt: true, amount: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
    db.supplierPayment.findMany({ where: { executedAt: null }, select: { amountUsd: true, dueBy: true } }),
  ]);
  const market = empty();
  for (const f of futures) put(market, horizonOf(f.expectedAt, T), 0);

  // Commercial future: only what is alive. A lost or declined quote is learning, not future (v1.1 §30).
  const needs = items.filter((x) => !x.quoteStatus), drafts = items.filter((x) => x.quoteStatus === "DRAFT"), presented = items.filter((x) => x.quoteStatus === "PRESENTED");
  const decisions = empty();
  for (const x of presented) put(decisions, horizonOf(x.nextDecision, T), x.esagara ?? 0);

  const toInvoice = empty();
  let contractedUsd = 0, contractedN = 0;
  for (const d of contracted) {
    const left = Math.round(((d.quotes[0]?.protSale != null ? Number(d.quotes[0].protSale) : 0) - sumMoney(d.invoices.map((i) => i.amount))) * 100) / 100;
    if (left <= 0.5) continue;
    contractedUsd = Math.round((contractedUsd + left) * 100) / 100; contractedN++;
    put(toInvoice, horizonOf(d.promisedDate, T), left);
  }
  const cashIn = empty(), cashOut = empty();
  for (const i of invoices) { const c = invoiceCash(i); const b = c.balance - c.pendingReconcile; if (b > 0.005) put(cashIn, horizonOf(i.dueAt, T), b); }
  for (const p of payments) put(cashOut, horizonOf(p.dueBy, T), Number(p.amountUsd ?? 0));

  return {
    asOf: new Date(), market, marketList: futures.filter((f) => f.expectedAt && f.expectedAt >= T).slice(0, 6),
    commercial: { needs: needs.length, drafts: { n: drafts.length, sale: sumMoney(drafts.map((x) => x.sale ?? 0)), esagara: sumMoney(drafts.map((x) => x.esagara ?? 0)) }, presented: { n: presented.length, sale: sumMoney(presented.map((x) => x.sale ?? 0)), esagara: sumMoney(presented.map((x) => x.esagara ?? 0)) }, decisions },
    contracted: { n: contractedN, usd: contractedUsd, toInvoice }, cashIn, cashOut,
  };
}

// ---------- §23 Gerencia: intervention queue ----------

export type QueueItem = { key: string; kind: Txt; headline: string; impact: string | null; owner: string | null; decision: Txt; href: string };
const KIND: Record<string, Txt> = {
  PROMISE: { es: "Promesa en riesgo", en: "Promise at risk" }, HIGH_VALUE: { es: "Compromiso de alto valor", en: "High-value commitment" }, MARGIN: { es: "Eságara en riesgo", en: "Eságara at risk" },
  CASH: { es: "Cartera vencida", en: "Overdue receivable" }, POLICY: { es: "Cambio de política por aprobar", en: "Policy change to approve" }, CLAIM: { es: "Reclamo de cliente abierto", en: "Open customer claim" },
};
/** A short list of matters that are material and need a decision. Each one names its impact, its owner and where to decide. */
export async function interventionQueue(userId: string, max = 9): Promise<QueueItem[]> {
  const T = today();
  const usd = (n: number) => `USD ${n.toFixed(2)}`;
  const [home, hv, profit, overdue, policy, claims] = await Promise.all([
    opsHome(), highValueCommitments(), profitSummary(userId),
    db.invoice.findMany({ where: { dueAt: { lt: T } }, select: { accountId: true, account: { select: { name: true, owner: { select: { name: true } } } }, amount: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
    db.policyChangeRequest.findFirst({ where: { status: "PENDING" }, select: { requestedByName: true, reason: true } }),
    db.customerClaim.findMany({ where: { status: "OPEN" }, orderBy: { reportedAt: "asc" }, take: 2, select: { id: true, code: true, whatHappened: true, deal: { select: { id: true, account: { select: { name: true } }, owner: { select: { name: true } } } } } }),
  ]);
  const out: QueueItem[] = [];
  for (const p of home.atRisk.filter((x) => x.health === "BREACHED" || x.health === "AT_RISK").slice(0, 3)) out.push({ key: `p-${p.deal.id}`, kind: KIND.PROMISE, headline: `${p.deal.code ?? p.deal.title} · ${p.deal.account.name}: ${p.reason.es}`, impact: p.amount ? usd(p.amount) : null, owner: p.deal.owner.name, decision: { es: "Decidir qué se le dice al cliente y qué se mueve para cumplir", en: "Decide what the customer is told and what is moved to deliver" }, href: `/deals/${p.deal.id}` });
  for (const r of hv.rows.filter((x) => x.risks.length > 0).slice(0, 3)) if (!out.some((o) => o.key === `p-${r.deal.id}`)) out.push({ key: `h-${r.deal.id}`, kind: KIND.HIGH_VALUE, headline: `${r.deal.code ?? r.deal.title} · ${r.deal.account}: ${r.risks[0].es}`, impact: r.esagara != null ? `Eságara ${usd(r.esagara)}` : null, owner: r.deal.owner, decision: r.milestone.text, href: `/deals/${r.deal.id}?tab=execute` });
  for (const v of profit.variances.filter((x) => x.gap < -0.005).slice(0, 2)) out.push({ key: `m-${v.id}`, kind: KIND.MARGIN, headline: `${v.code} · ${v.account}${v.main ? `: ${v.main.es}` : ""}`, impact: usd(v.gap), owner: null, decision: { es: "Revisar la causa y decidir si se corrige o se acepta", en: "Review the cause and decide whether to fix or accept it" }, href: `/deals/${v.id}/economia#puente` });
  const byAcc = new Map<string, { name: string; owner: string; usd: number }>();
  for (const i of overdue) { const c = invoiceCash(i); const b = c.balance - c.pendingReconcile; if (b <= 0.005) continue; const g = byAcc.get(i.accountId) ?? { name: i.account.name, owner: i.account.owner?.name ?? "", usd: 0 }; g.usd = Math.round((g.usd + b) * 100) / 100; byAcc.set(i.accountId, g); }
  for (const [id, g] of [...byAcc.entries()].sort((a, b) => b[1].usd - a[1].usd).slice(0, 2)) out.push({ key: `c-${id}`, kind: KIND.CASH, headline: `${g.name}: facturas vencidas sin cobrar`, impact: usd(g.usd), owner: g.owner || null, decision: { es: "Decidir el siguiente paso de cobro y si se sigue vendiendo a crédito", en: "Decide the next collection step and whether to keep selling on credit" }, href: `/accounts/${id}` });
  if (policy) out.push({ key: "policy", kind: KIND.POLICY, headline: `${policy.requestedByName}: ${policy.reason}`, impact: null, owner: policy.requestedByName, decision: { es: "Aprobar o rechazar el cambio de números de Rentabilidad", en: "Approve or reject the change to the profitability numbers" }, href: "/profile/rentabilidad#pendiente" });
  for (const c of claims) out.push({ key: `k-${c.id}`, kind: KIND.CLAIM, headline: `${c.code} · ${c.deal.account.name}: ${c.whatHappened.slice(0, 90)}`, impact: null, owner: c.deal.owner.name, decision: { es: "Confirmar qué pasó y si está cubierto antes de prometer una solución", en: "Confirm what happened and whether it is covered before promising a fix" }, href: `/deals/${c.deal.id}/garantia#c-${c.id}` });
  return out.slice(0, max);
}
