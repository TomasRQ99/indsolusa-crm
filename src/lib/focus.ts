import { db } from "./db";
import { addDays, daysBetween, today } from "./domain";
import { costOf, saleOf } from "./quote";
import { sharePct, subMoney } from "./money";
import { DEFAULT_FOCUS_POLICY, FOCUS_POLICY_KEY, needsAttention, type FocusPolicy } from "./focus-rules";

// Comercial C8c · High-Value Focus (module 10 v1.3 §60). Derived views over open Journeys. Every item shows company,
// solution, sale, Eságara $ and %, current position, next decision, next movement, material risk and owner.

export async function getFocusPolicy(): Promise<{ value: FocusPolicy; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: FOCUS_POLICY_KEY }, orderBy: { version: "desc" } });
  return s ? { value: { ...DEFAULT_FOCUS_POLICY, ...(s.value as Partial<FocusPolicy>) }, version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_FOCUS_POLICY, version: 0, by: null, at: null };
}

type Txt = { es: string; en: string };
export type FocusItem = {
  dealId: string; code: string | null; account: string; accountId: string; solution: string; owner: string; ownerId: string;
  quoteId: string | null; quoteStatus: string | null; sale: number | null; esagara: number | null; pct: number | null;
  position: Txt; nextDecision: Date | null; nextMove: string | null; nextMoveDate: Date | null; risks: Txt[]; daysQuiet: number | null; attention: boolean; createdAt: Date; desiredResult: string | null;
};

const POS: Record<string, Txt> = {
  NONE: { es: "Necesidad sin cotización", en: "Need without a quote" },
  DRAFT: { es: "Cotización en preparación", en: "Quote being prepared" },
  PRESENTED: { es: "Presentada, esperando decisión", en: "Presented, awaiting decision" },
  ACCEPTED: { es: "Aceptada, en ejecución", en: "Accepted, in execution" },
};

/** Open Journeys (not lost, result not achieved) of one owner or of everyone. */
/** `extra` narrows the Journeys further (Módulo 15: one selling company). */
export async function focusItems(ownerId: string | null, policy: FocusPolicy, extra: { sellerKey?: string } = {}): Promise<FocusItem[]> {
  const T = today();
  const deals = await db.deal.findMany({
    where: { internal: false, stage: { not: "LOST" }, resultAchievedAt: null, ...(ownerId ? { ownerId } : {}), ...extra },
    select: {
      id: true, code: true, title: true, createdAt: true, desiredResult: true, nextMove: true, nextMoveDate: true, promisedDate: true, ownerId: true,
      owner: { select: { name: true } }, account: { select: { id: true, name: true } },
      quotes: { where: { status: { in: ["DRAFT", "PRESENTED", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, protSale: true, protEsagra: true, decisionAt: true, promiseDecideBy: true, supplierCost: true, freightCost: true, otherCosts: true, fxRate: true, lines: { select: { qty: true, unitPrice: true } }, esagaraExceptions: { where: { status: { in: ["REQUESTED", "RETURNED"] } }, select: { id: true } } } },
      cashBlockers: { where: { resolvedAt: null }, select: { narrative: true, blockedValue: true } },
    },
  });
  const last = await db.activity.groupBy({ by: ["dealId"], where: { dealId: { in: deals.map((d) => d.id) } }, _max: { occurredAt: true } });
  const lastBy = new Map(last.map((l) => [l.dealId!, l._max.occurredAt]));
  const rank: Record<string, number> = { ACCEPTED: 3, PRESENTED: 2, DRAFT: 1 };
  return deals.map((d) => {
    const q = [...d.quotes].sort((a, b) => rank[b.status] - rank[a.status])[0] ?? null;
    const sale = q ? (q.protSale != null ? Number(q.protSale) : saleOf(q.lines)) : null;
    const esagara = q ? (q.protEsagra != null ? Number(q.protEsagra) : subMoney(saleOf(q.lines), costOf(q))) : null;
    const nextDecision = q && q.status === "PRESENTED" ? [q.decisionAt, q.promiseDecideBy].filter((x): x is Date => !!x).sort((a, b) => +a - +b)[0] ?? null : null;
    const lastAt = lastBy.get(d.id) ?? null;
    const daysQuiet = lastAt ? Math.max(0, daysBetween(lastAt, new Date())) : Math.max(0, daysBetween(d.createdAt, new Date()));
    const risks: Txt[] = [];
    for (const b of d.cashBlockers) risks.push({ es: `Caja bloqueada: ${b.narrative}`, en: `Cash blocked: ${b.narrative}` });
    if (q?.status === "ACCEPTED" && d.promisedDate && d.promisedDate < T) risks.push({ es: "La fecha prometida al cliente ya pasó", en: "The date promised to the customer has passed" });
    if (nextDecision && nextDecision < T) risks.push({ es: "La decisión del cliente está vencida", en: "The customer's decision is overdue" });
    if (q && q.esagaraExceptions.length) risks.push({ es: "Excepción de Eságara pendiente", en: "Eságara exception pending" });
    if (d.nextMoveDate && d.nextMoveDate < T) risks.push({ es: "El próximo paso está vencido", en: "The next step is overdue" });
    if (!d.nextMove) risks.push({ es: "Sin próximo paso definido", en: "No next step defined" });
    const attention = needsAttention(esagara, daysQuiet, policy);
    if (attention) risks.unshift({ es: `Sin movimiento hace ${daysQuiet} días`, en: `No movement for ${daysQuiet} days` });
    return {
      dealId: d.id, code: d.code, account: d.account.name, accountId: d.account.id, solution: d.title, owner: d.owner.name, ownerId: d.ownerId,
      quoteId: q?.id ?? null, quoteStatus: q?.status ?? null, sale, esagara, pct: sale && esagara != null ? sharePct(esagara, sale) : null,
      position: POS[q?.status ?? "NONE"], nextDecision, nextMove: d.nextMove, nextMoveDate: d.nextMoveDate, risks, daysQuiet, attention, createdAt: d.createdAt, desiredResult: d.desiredResult,
    };
  });
}

export async function focusViews(ownerId: string | null, policy: FocusPolicy, extra: { sellerKey?: string } = {}) {
  const items = await focusItems(ownerId, policy, extra);
  const T = today();
  const monthEnd = new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() + 1, 1));
  const byEsagara = (a: FocusItem, b: FocusItem) => (b.esagara ?? -Infinity) - (a.esagara ?? -Infinity);
  const priced = items.filter((x) => x.esagara != null);
  const [blockers, futures] = await Promise.all([
    db.cashBlocker.findMany({ where: { resolvedAt: null, ...(ownerId ? { deal: { ownerId } } : {}) }, orderBy: { blockedValue: "desc" }, take: 5, select: { id: true, blockedValue: true, narrative: true, nextMovement: true, blockedSince: true, deal: { select: { id: true, code: true, title: true, account: { select: { name: true } }, owner: { select: { name: true } } } } } }),
    db.futureOpportunity.findMany({ where: { expectedAt: { lte: addDays(T, 365) }, ...(ownerId ? { ownerId } : {}) }, orderBy: { expectedAt: "asc" }, take: 6, select: { id: true, description: true, expectedAt: true, nextMove: true, account: { select: { id: true, name: true } } } }),
  ]);
  return {
    items,
    top5: [...priced].sort(byEsagara).slice(0, 5),
    monthMovers: priced.filter((x) => x.nextDecision && x.nextDecision < monthEnd).sort(byEsagara).slice(0, 8),
    toProtect: items.filter((x) => x.quoteStatus === "ACCEPTED" && x.risks.length > 0).sort(byEsagara).slice(0, 8),
    futureBuilders: items.filter((x) => !x.quoteStatus && x.desiredResult && x.createdAt >= addDays(T, -90)).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 8),
    futures,
    moneyToMove: blockers,
    decisionsComing: items.filter((x) => x.nextDecision && x.nextDecision >= T && x.nextDecision <= addDays(T, policy.decisionsDays)).sort((a, b) => +a.nextDecision! - +b.nextDecision!),
    attention: items.filter((x) => x.attention).sort(byEsagara),
  };
}
