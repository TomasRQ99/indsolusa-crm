import { db } from "./db";
import { sharePct, sumMoney } from "./money";

// Comercial C8c · Periodic closes (module 10 v1.3 §62). Period-event based: what happened inside the period, not a
// snapshot of the last day. Five parts: what happened, what we learned, future visible now, improvement
// opportunities, next movements. `ownerId` null = the whole company (totals only, never a list of people).

export async function closeReport(ownerId: string | null, start: Date, end: Date) {
  const r = { gte: start, lt: end };
  const own = ownerId ? { ownerId } : {};
  const nextSpan = { gte: end, lt: new Date(end.getTime() + (end.getTime() - start.getTime())) };
  const [presented, decided, pos, needs, visits, presentations, futures, invoices, payments, nextMoves, decisionsNext, usefulContacts] = await Promise.all([
    db.quote.findMany({ where: { presentedAt: r, status: { not: "DRAFT" }, deal: own }, select: { id: true, number: true, rev: true, protSale: true, protEsagra: true, presentations: { select: { id: true } }, deal: { select: { title: true, account: { select: { name: true } } } } } }),
    db.quote.findMany({ where: { decidedAt: r, status: { in: ["ACCEPTED", "DECLINED"] }, deal: own }, select: { id: true, number: true, rev: true, status: true, protSale: true, protEsagra: true, deal: { select: { title: true, account: { select: { name: true } } } } } }),
    db.customerPO.findMany({ where: { receivedAt: r, deal: own }, select: { id: true, number: true, deal: { select: { title: true, account: { select: { name: true } } } } } }),
    db.deal.findMany({ where: { createdAt: r, ...own, desiredResult: { not: null } }, select: { id: true, code: true, title: true, desiredResult: true, account: { select: { name: true } } } }),
    db.visitPlan.findMany({ where: { happenedAt: r, status: "DONE", ...own }, select: { id: true, learned: true, account: { select: { name: true } } } }),
    db.presentationRecord.findMany({ where: { at: r, case: { deal: own } }, select: { id: true, valued: true, objections: true, case: { select: { deal: { select: { id: true, title: true, account: { select: { name: true } } } } } } } }),
    db.futureOpportunity.findMany({ where: { createdAt: r, ...(ownerId ? { ownerId } : {}) }, select: { id: true, description: true, expectedAt: true, account: { select: { name: true } } } }),
    db.invoice.findMany({ where: { issuedAt: r, deal: own }, select: { amount: true } }),
    db.paymentApplication.findMany({ where: { payment: { receivedAt: r }, invoice: { deal: own } }, select: { amount: true } }),
    db.deal.findMany({ where: { ...own, stage: { notIn: ["WON", "LOST"] }, nextMoveDate: { lt: nextSpan.lt } }, orderBy: { nextMoveDate: "asc" }, take: 20, select: { id: true, code: true, title: true, nextMove: true, nextMoveDate: true, account: { select: { name: true } } } }),
    db.quote.findMany({ where: { status: "PRESENTED", deal: own, decisionAt: nextSpan }, select: { id: true, number: true, rev: true, decisionAt: true, protEsagra: true, deal: { select: { title: true, account: { select: { name: true } } } } } }),
    db.activity.count({ where: { occurredAt: r, valueKind: { not: null }, ...(ownerId ? { userId: ownerId } : {}) } }),
  ]);
  const acc = decided.filter((q) => q.status === "ACCEPTED");
  const sale = sumMoney(acc.map((q) => q.protSale));
  const esagara = sumMoney(acc.map((q) => q.protEsagra));
  const sentNoPresent = presented.filter((q) => q.presentations.length === 0).length;
  const improve: { es: string; en: string }[] = [];
  if (sentNoPresent > 0) improve.push({ es: `${sentNoPresent} cotizaciones se enviaron sin presentarlas.`, en: `${sentNoPresent} quotes were sent without presenting them.` });
  if (decided.length && acc.length === 0) improve.push({ es: "Todas las decisiones del periodo fueron «no»: revisa las objeciones.", en: "Every decision this period was «no»: review the objections." });
  if (usefulContacts > 0 && needs.length === 0) improve.push({ es: "Hubo contactos útiles pero ninguna necesidad nueva escrita.", en: "There were useful contacts but no new need written down." });
  const overdue = nextMoves.filter((d) => d.nextMoveDate && d.nextMoveDate < start).length;
  if (overdue > 0) improve.push({ es: `${overdue} Journeys tienen el próximo paso vencido desde antes del periodo.`, en: `${overdue} Journeys have a next step overdue from before the period.` });
  return {
    happened: { presented, decided, accepted: acc.length, declined: decided.length - acc.length, sale, esagara, pct: sale > 0 ? sharePct(esagara, sale) : null, pos, needs, visits: visits.length, usefulContacts, invoiced: sumMoney(invoices.map((i) => i.amount)), collected: sumMoney(payments.map((p) => p.amount)) },
    learned: { visits: visits.filter((v) => v.learned), presentations: presentations.filter((p) => p.valued || p.objections) },
    future: { futures, needs, decisionsNext },
    improve,
    next: nextMoves,
  };
}
