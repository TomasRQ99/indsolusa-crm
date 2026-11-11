import { db } from "./db";
import { subMoney } from "./money";
import { addDays, today } from "./domain";
import { classifyHandover, classifyJourney, type HandoverClass } from "./team-rules";

// Comercial C8b · Absence Coverage (module 10 v1.3 §59). The emergency scan surfaces what can't wait in the absent
// person's work: promises, visits, presentations, deliveries, collections and decisions. Derived, never re-typed.

export type ScanKind = "PROMISE" | "VISIT" | "PRESENT" | "DELIVERY" | "COLLECT" | "DECISION" | "NEXT_MOVE" | "COMMITMENT" | "PICKUP" | "SUPPLIER_PAYMENT" | "CUSTOMS" | "EXCEPTION";
/** `cls`: where the item belongs in a Responsibility Handover (Módulo 16 §8); set when a handover snapshot is taken. */
export type ScanItem = { kind: ScanKind; at: string | null; label: string; href: string; account: string | null; amount?: number; cls?: HandoverClass };
export const SCAN_KINDS: Record<ScanKind, { es: string; en: string }> = {
  PROMISE: { es: "Promesa al cliente", en: "Promise to customer" },
  VISIT: { es: "Visita", en: "Visit" },
  PRESENT: { es: "Tarea o presentación agendada", en: "Scheduled task or presentation" },
  DELIVERY: { es: "Entrega", en: "Delivery" },
  COLLECT: { es: "Cobro", en: "Collection" },
  DECISION: { es: "Decisión del cliente", en: "Customer decision" },
  NEXT_MOVE: { es: "Próximo paso vencido o de hoy", en: "Next step due" },
  COMMITMENT: { es: "Compromiso de visita", en: "Visit commitment" },
  // Operaciones v1.2 §46
  PICKUP: { es: "Recogida en origen", en: "Pickup at origin" },
  SUPPLIER_PAYMENT: { es: "Pago a proveedor", en: "Supplier payment" },
  CUSTOMS: { es: "Aduana", en: "Customs" },
  EXCEPTION: { es: "Excepción operativa", en: "Operational exception" },
};
export const COVERAGE_MAX_DAYS = 60;

/** Whose Journeys `userId` covers at `now` (active, not revoked). Used by the session on every request. */
export async function coveringNow(userId: string, now = new Date()) {
  const rows = await db.coverageAssignment.findMany({ where: { actingUserId: userId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, select: { originalUserId: true } });
  return [...new Set(rows.map((r) => r.originalUserId))];
}

/** What's due for `userId` up to `until` (overdue included). */
export async function coverageScan(userId: string, until: Date): Promise<ScanItem[]> {
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
  const mine = { ownerId: userId, stage: { notIn: ["LOST" as const] } };
  const [promised, visits, decisions, dispatches, invoices, moves, commitments] = await Promise.all([
    db.deal.findMany({ where: { ...mine, promisedDate: { lte: until }, resultAchievedAt: null }, select: { id: true, code: true, title: true, promisedDate: true, promiseText: true, account: { select: { name: true } } } }),
    db.visitPlan.findMany({ where: { ownerId: userId, status: "PLANNED", plannedAt: { lte: until } }, select: { id: true, plannedAt: true, account: { select: { name: true } } } }),
    db.quote.findMany({ where: { status: "PRESENTED", deal: mine, OR: [{ decisionAt: { lte: until } }, { promiseDecideBy: { lte: until } }] }, select: { id: true, number: true, rev: true, decisionAt: true, promiseDecideBy: true, deal: { select: { title: true, account: { select: { name: true } } } } } }),
    db.dispatchInstruction.findMany({ where: { supersededAt: null, deal: mine, OR: [{ promiseDate: { lte: until } }, { windowTo: { lte: until } }] }, select: { id: true, dealId: true, version: true, promiseDate: true, windowTo: true, po: { select: { number: true } }, deal: { select: { resultAchievedAt: true, account: { select: { name: true } } } } } }),
    db.invoice.findMany({ where: { deal: { ownerId: userId }, OR: [{ dueAt: { lte: until } }, { collectNextAt: { lte: until } }] }, select: { id: true, number: true, dealId: true, amount: true, dueAt: true, collectNextAt: true, collectNext: true, applications: { select: { amount: true } }, account: { select: { name: true } } } }),
    db.deal.findMany({ where: { ...mine, stage: { notIn: ["WON", "LOST"] }, nextMoveDate: { lte: until } }, select: { id: true, code: true, title: true, nextMove: true, nextMoveDate: true, account: { select: { name: true } } } }),
    db.visitCommitment.findMany({ where: { status: "OPEN", side: "US", visit: { ownerId: userId }, dueAt: { lte: until } }, select: { id: true, what: true, dueAt: true, visit: { select: { id: true, account: { select: { name: true } } } } } }),
  ]);
  const presenting = await db.task.findMany({ where: { assigneeId: userId, status: "OPEN", dueDate: { lte: until } }, select: { id: true, title: true, dueDate: true, dealId: true, account: { select: { name: true } } } });
  const [pickups, supPays, customs, excs] = await Promise.all([
    db.shipment.findMany({ where: { deal: { ownerId: userId }, pickedUpAt: null, deliveredAt: null, OR: [{ plannedPickup: { lte: until } }, { rtsAt: { lte: until } }] }, select: { id: true, code: true, plannedPickup: true, rtsAt: true, deal: { select: { account: { select: { name: true } } } } } }),
    db.supplierPayment.findMany({ where: { executedAt: null, dueBy: { lte: until }, OR: [{ requestedById: userId }, { supplierPo: { deal: { ownerId: userId } } }] }, select: { id: true, amountUsd: true, dueBy: true, supplierPo: { select: { code: true, deal: { select: { account: { select: { name: true } } } } } } } }),
    db.shipment.findMany({ where: { deal: { ownerId: userId }, deliveredAt: null, customs: "HOLD" }, select: { id: true, code: true, customsNote: true, deal: { select: { account: { select: { name: true } } } } } }),
    db.operationalException.findMany({ where: { status: "OPEN", deadline: { lte: until }, OR: [{ ownerId: userId }, { deal: { ownerId: userId } }] }, select: { id: true, whatHappened: true, deadline: true, deal: { select: { account: { select: { name: true } } } } } }),
  ]);
  const out: ScanItem[] = [
    ...pickups.map((s) => ({ kind: "PICKUP" as const, at: iso(s.plannedPickup ?? s.rtsAt), label: s.code, href: `/logistica/${s.id}`, account: s.deal.account.name })),
    ...supPays.map((p) => ({ kind: "SUPPLIER_PAYMENT" as const, at: iso(p.dueBy), label: p.supplierPo.code, href: `/administracion/pagos-proveedores/${p.id}`, account: p.supplierPo.deal.account.name, amount: Number(p.amountUsd) })),
    ...customs.map((s) => ({ kind: "CUSTOMS" as const, at: null, label: `${s.code}${s.customsNote ? ` · ${s.customsNote}` : ""}`, href: `/logistica/${s.id}`, account: s.deal.account.name })),
    ...excs.map((e) => ({ kind: "EXCEPTION" as const, at: iso(e.deadline), label: e.whatHappened, href: `/operaciones#x-${e.id}`, account: e.deal.account.name })),
    ...promised.map((d) => ({ kind: "PROMISE" as const, at: iso(d.promisedDate), label: `${d.code ?? d.title}${d.promiseText ? ` · ${d.promiseText}` : ` · ${d.title}`}`, href: `/deals/${d.id}`, account: d.account.name })),
    ...visits.map((v) => ({ kind: "VISIT" as const, at: iso(v.plannedAt), label: v.account.name, href: `/visitas/${v.id}`, account: v.account.name })),
    ...presenting.map((x) => ({ kind: "PRESENT" as const, at: iso(x.dueDate), label: x.title, href: x.dealId ? `/deals/${x.dealId}` : "/mi-dia", account: x.account?.name ?? null })),
    ...decisions.map((q) => { const at = [q.decisionAt, q.promiseDecideBy].filter((x): x is Date => !!x).sort((a, b) => +a - +b)[0]; return { kind: "DECISION" as const, at: iso(at), label: `Quote Nº ${q.number}${q.rev ? `-R${q.rev}` : ""} · ${q.deal.title}`, href: `/cotizaciones/${q.id}`, account: q.deal.account.name }; }),
    ...dispatches.filter((x) => !x.deal.resultAchievedAt).map((x) => ({ kind: "DELIVERY" as const, at: iso(x.promiseDate ?? x.windowTo), label: `PO ${x.po?.number ?? "—"} · v${x.version}`, href: `/deals/${x.dealId}/despacho`, account: x.deal.account.name })),
    ...invoices.map((i) => ({ i, bal: subMoney(i.amount, ...i.applications.map((a) => a.amount)) })).filter((x) => x.bal > 0.005).map(({ i, bal }) => ({ kind: "COLLECT" as const, at: iso(i.collectNextAt ?? i.dueAt), label: `${i.number}${i.collectNext ? ` · ${i.collectNext}` : ""}`, href: `/deals/${i.dealId}?tab=cash`, account: i.account.name, amount: bal })),
    ...moves.map((d) => ({ kind: "NEXT_MOVE" as const, at: iso(d.nextMoveDate), label: `${d.code ?? d.title} · ${d.nextMove ?? d.title}`, href: `/deals/${d.id}`, account: d.account.name })),
    ...commitments.map((c) => ({ kind: "COMMITMENT" as const, at: iso(c.dueAt), label: c.what, href: `/visitas/${c.visit.id}`, account: c.visit.account.name })),
  ];
  return out.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/** Snapshot kept with the coverage: what was due and which Journeys were open when it started. */
export async function handoverSnapshot(userId: string, endsAt: Date) {
  const [items, open] = await Promise.all([
    coverageScan(userId, endsAt),
    db.deal.findMany({ where: { ownerId: userId, stage: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" }, take: 40, select: { id: true, code: true, title: true, nextMove: true, nextMoveDate: true, account: { select: { name: true } } } }),
  ]);
  // Responsibility Handover (Módulo 16 §8): every pending item says whether it must move, a decision is likely, it
  // waits on someone else, it is safe or it can wait for the return.
  return {
    takenAt: new Date().toISOString(), items: items.map((x) => ({ ...x, cls: classifyHandover(x, endsAt) })),
    openJourneys: open.map((d) => ({ id: d.id, label: `${d.code ?? d.title} · ${d.title}`, account: d.account.name, nextMove: d.nextMove, nextMoveDate: d.nextMoveDate?.toISOString() ?? null, cls: classifyJourney(d.nextMoveDate, endsAt) })),
  };
}
export type Handover = Awaited<ReturnType<typeof handoverSnapshot>>;

/** Return Brief: what happened on the original owner's Journeys while they were away. */
export async function returnBrief(originalUserId: string, from: Date, to: Date) {
  const range = { gte: from, lt: to };
  const [activities, decided, pos, newDeals] = await Promise.all([
    db.activity.findMany({ where: { occurredAt: range, deal: { ownerId: originalUserId }, userId: { not: originalUserId } }, orderBy: { occurredAt: "asc" }, take: 60, select: { id: true, subject: true, occurredAt: true, dealId: true, user: { select: { name: true } }, deal: { select: { code: true, title: true } } } }),
    db.quote.findMany({ where: { decidedAt: range, deal: { ownerId: originalUserId } }, select: { id: true, number: true, rev: true, status: true, deal: { select: { title: true } } } }),
    db.customerPO.findMany({ where: { receivedAt: range, deal: { ownerId: originalUserId } }, select: { id: true, number: true, deal: { select: { title: true } } } }),
    db.deal.findMany({ where: { createdAt: range, ownerId: originalUserId }, select: { id: true, code: true, title: true } }),
  ]);
  return { activities, decided, pos, newDeals };
}

/** Módulo 16 §8, AC5 · work that was opened in the name of the person covering while they stood in: open to-dos on
 *  the Journeys of the owner, created during the coverage and assigned to whoever covered. On return they go back. */
export async function handBack(c: { originalUserId: string; actingUserId: string; startsAt: Date; endsAt: Date; revokedAt: Date | null }) {
  const to = c.revokedAt ?? c.endsAt;
  return db.task.findMany({ where: { assigneeId: c.actingUserId, status: "OPEN", createdAt: { gte: c.startsAt, lt: to }, deal: { ownerId: c.originalUserId } }, orderBy: { dueDate: "asc" }, select: { id: true, title: true, dueDate: true, dealId: true, deal: { select: { code: true, title: true } } } });
}

export const coverageWindow = (startDay: Date, endDay: Date) => ({ startsAt: startDay, endsAt: addDays(endDay, 1) });
export const isActive = (c: { startsAt: Date; endsAt: Date; revokedAt: Date | null }, now = new Date()) => !c.revokedAt && c.startsAt <= now && now < c.endsAt;
export const scanHorizon = () => addDays(today(), 2);
