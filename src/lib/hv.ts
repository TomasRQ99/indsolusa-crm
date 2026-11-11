import { cache } from "react";
import { db } from "./db";
import { today } from "./domain";
import { subMoney, sumMoney } from "./money";
import { getFocusPolicy } from "./focus";
import { hvClosure, hvMilestone, hvRisks, type HvFacts } from "./hv-rules";
import type { Line } from "./dispatch-rules";

// Operaciones O8b · High-Value Commitments, derived from what already exists (no second record to keep in sync).
// "High value" uses the same Eságara threshold as Comercial's High-Value Focus, so both modules agree.

async function highValueCommitmentsRaw() {
  const T = today();
  const pol = await getFocusPolicy();
  const min = pol.value.materialEsagaraUsd;
  const deals = await db.deal.findMany({
    where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" }, quotes: { some: { status: "ACCEPTED", protEsagra: { gte: min } } } },
    orderBy: { promisedDate: "asc" },
    select: {
      id: true, code: true, title: true, promisedDate: true, promiseText: true, poAcceptedAt: true,
      owner: { select: { name: true } }, account: { select: { id: true, name: true, requiresReceptionCode: true } },
      quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { protSale: true, protEsagra: true } },
      items: { select: { qty: true } },
      supplierPos: { select: { releasedAt: true, receivedAt: true, eta: true, payments: { where: { executedAt: { not: null } }, select: { amountUsd: true } } } },
      stockLots: { where: { state: "COMMITTED", outAt: null }, select: { id: true }, take: 1 },
      dispatchOrders: { where: { cancelledAt: null, deliveredAt: null }, select: { dispatchedAt: true, lines: true } },
      deliveries: { select: { receptionCode: true, invoice: { select: { id: true } }, lines: { select: { qty: true } } } },
      invoices: { select: { amount: true, dueAt: true, applications: { select: { amount: true } } } },
      opsExceptions: { where: { status: "OPEN" }, select: { id: true } },
    },
  });
  return {
    threshold: min,
    rows: deals.map((d) => {
      const q = d.quotes[0];
      const bal = d.invoices.map((i) => ({ due: i.dueAt, b: subMoney(i.amount, ...i.applications.map((a) => a.amount)) }));
      const etas = d.supplierPos.filter((p) => !p.receivedAt && p.eta).map((p) => +p.eta!);
      const f: HvFacts = {
        purchases: d.supplierPos.length, unreleased: d.supplierPos.filter((p) => !p.releasedAt).length, notReceived: d.supplierPos.filter((p) => p.releasedAt && !p.receivedAt).length,
        nextSupplierEta: etas.length ? new Date(Math.max(...etas)) : null, hasStock: d.stockLots.length > 0,
        unitsOrdered: d.items.reduce((a, x) => a + x.qty, 0), unitsDelivered: d.deliveries.flatMap((x) => x.lines).reduce((a, x) => a + x.qty, 0),
        openDispatch: d.dispatchOrders.length, dispatchedNotDelivered: d.dispatchOrders.filter((o) => o.dispatchedAt).length,
        deliveries: d.deliveries.length, deliveriesNotInvoiced: d.deliveries.filter((x) => !x.invoice).length,
        waitingEntry: d.account.requiresReceptionCode ? d.deliveries.filter((x) => !x.invoice && !x.receptionCode?.trim()).length : 0,
        invoiced: sumMoney(d.invoices.map((i) => i.amount)), openBalance: sumMoney(bal.filter((x) => x.b > 0.005).map((x) => x.b)), overdueBalance: sumMoney(bal.filter((x) => x.b > 0.005 && x.due < T).map((x) => x.b)),
        promise: d.promisedDate, openExceptions: d.opsExceptions.length,
      };
      const inDispatch = d.dispatchOrders.flatMap((o) => o.lines as unknown as Line[]).reduce((a, l) => a + l.qty, 0);
      return {
        deal: { id: d.id, code: d.code, title: d.title, account: d.account.name, accountId: d.account.id, owner: d.owner.name },
        sale: q?.protSale != null ? Number(q.protSale) : null, esagara: q?.protEsagra != null ? Number(q.protEsagra) : null,
        advanced: sumMoney(d.supplierPos.flatMap((p) => p.payments.map((x) => x.amountUsd))),
        promise: d.promisedDate, promiseText: d.promiseText, facts: f, inDispatch,
        closure: hvClosure(f), milestone: hvMilestone(f), risks: hvRisks(f, T),
      };
    }).filter((r) => !r.closure.closed),
  };
}

/** Computed once per page: several blocks of the same screen read it (Módulo 15 Home). */
export const highValueCommitments = cache(highValueCommitmentsRaw);
