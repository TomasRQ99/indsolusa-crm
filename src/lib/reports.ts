import { db } from "./db";
import { invoiceCash, today } from "./domain";
import { canFinance, canManageAll } from "./permissions";
import { sumMoney } from "./money";
import { goalActuals, goalBoard } from "./goals";
import { shiftPeriod } from "./goal-rules";
import { computeCommissions } from "./commission";
import { focusItems, getFocusPolicy } from "./focus";

// Módulo 13 · role views (§4). Everything is read from the same functions the operational screens use, so a figure
// here equals the figure there (AC55). Nothing is typed again and nothing is stored.

type U = { id: string; role: string; covering?: string[] };

/** Who this person may see a report for: themselves, the members of teams they lead, or everyone (management / money roles). */
export async function reportScope(user: U) {
  const all = canManageAll(user as never) || canFinance(user as never);
  const led = await db.team.findMany({ where: { leaderId: user.id, active: true }, select: { id: true, name: true, members: { select: { userId: true, user: { select: { name: true, active: true } } } } } });
  const teamIds = new Set(led.flatMap((t) => t.members.filter((m) => m.user.active).map((m) => m.userId)));
  return { all, led, canSee: (id: string) => id === user.id || all || teamIds.has(id), seesCommissionOf: (id: string) => id === user.id || all };
}

export async function personReport(userId: string, period: string, now = new Date()) {
  const T = today();
  const pol = await getFocusPolicy();
  const [board, prev, comm, items, deliveries, invoices] = await Promise.all([
    goalBoard(userId, period, now),
    goalActuals(userId, shiftPeriod(period, -1)),
    computeCommissions({ userId }),
    focusItems(userId, pol.value),
    db.delivery.findMany({ where: { invoice: null, deal: { ownerId: userId, internal: false } }, select: { id: true, code: true, deal: { select: { id: true, code: true, title: true } }, lines: { select: { qty: true, dealItem: { select: { unitPrice: true } } } } } }),
    db.invoice.findMany({ where: { deal: { ownerId: userId } }, select: { id: true, number: true, dueAt: true, amount: true, dealId: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
  ]);
  const notInvoiced = deliveries.map((d) => ({ id: d.deal.id, code: d.deal.code ?? d.deal.title, ref: d.code, usd: sumMoney(d.lines.map((l) => l.qty * Number(l.dealItem.unitPrice))) }));
  const open = invoices.map((i) => { const c = invoiceCash(i); return { id: i.dealId, number: i.number, due: i.dueAt, usd: Math.round((c.balance - c.pendingReconcile) * 100) / 100 }; }).filter((x) => x.usd > 0.005);
  const overdue = open.filter((x) => x.due < T);
  return {
    period, asOf: now, board, prev,
    commission: comm.totals,
    money: { notInvoiced, notInvoicedUsd: sumMoney(notInvoiced.map((x) => x.usd)), open, outstandingUsd: sumMoney(open.map((x) => x.usd)), overdue, overdueUsd: sumMoney(overdue.map((x) => x.usd)) },
    risks: {
      attention: items.filter((x) => x.attention), noNextMove: items.filter((x) => !x.nextMove), decisionOverdue: items.filter((x) => x.nextDecision && x.nextDecision < T),
      lowEsagara: board.extras.lowEsagaraApproved,
    },
    future: { decisionsComing: items.filter((x) => x.nextDecision && x.nextDecision >= T).sort((a, b) => +a.nextDecision! - +b.nextDecision!).slice(0, 6), openJourneys: items.length },
  };
}
