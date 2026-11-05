import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { bankDiscrepancies, invoiceCash, paymentState, today } from "./domain";

// ---------- Receivables ----------

export type ReceivableState = "BROKEN" | "NEEDS_ACTION" | "RECEIVED_PENDING" | "WAITING" | "UPCOMING" | "PAID";

const receivableInclude = {
  account: { select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } } },
  deal: { select: { id: true, code: true, title: true, customerPo: true, ownerId: true } },
  applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } },
  promises: { orderBy: { createdAt: "desc" }, include: { recordedBy: { select: { name: true } } } },
} satisfies Prisma.InvoiceInclude;

export type ReceivableRow = Awaited<ReturnType<typeof loadReceivables>>[number];

export async function loadReceivables(where: Prisma.InvoiceWhereInput = {}) {
  const now = today();
  const invoices = await db.invoice.findMany({ where, include: receivableInclude, orderBy: { dueAt: "asc" } });
  return invoices
    .map((inv) => {
      const cash = invoiceCash(inv);
      const promise = inv.promises[0] ?? null;
      let state: ReceivableState;
      if (cash.balance <= 0.005) state = "PAID";
      else if (cash.pendingReconcile > 0) state = "RECEIVED_PENDING";
      else if (promise && promise.promisedFor < now) state = "BROKEN";
      else if (promise && promise.promisedFor >= now) state = "WAITING";
      else if (inv.dueAt < now) state = "NEEDS_ACTION";
      else state = "UPCOMING";
      const lastReceived = inv.applications.map((a) => a.payment.receivedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return { ...inv, cash, promise, state, lastReceived };
    })
    .filter((r) => r.state !== "PAID");
}

// ---------- Credit ----------

export async function loadCredit(accountWhere: Prisma.AccountWhereInput = {}) {
  const accounts = await db.account.findMany({
    where: { ...accountWhere, OR: [{ creditLimit: { not: null } }, { deals: { some: { stage: "WON" } } }] },
    include: {
      owner: { select: { name: true } },
      invoices: { include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } },
      deals: {
        where: { stage: { in: ["WON", "NEGOTIATION"] } },
        include: { invoices: { select: { amount: true } }, creditExceptionBy: { select: { name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
  return accounts.map((a) => {
    const openInvoices = a.invoices.reduce((s, i) => s + invoiceCash(i).balance, 0);
    const won = a.deals.filter((d) => d.stage === "WON");
    const uninvoiced = won.reduce((s, d) => s + Math.max(0, Number(d.amount) - d.invoices.reduce((x, i) => x + Number(i.amount), 0)), 0);
    const used = openInvoices + uninvoiced;
    const limit = a.creditLimit == null ? null : Number(a.creditLimit);
    const available = limit == null ? null : limit - used;
    const overdue = a.invoices.filter((i) => i.dueAt < today() && invoiceCash(i).balance > 0.005);
    // Orders that push the account over its limit and have no exception yet.
    const pending = a.deals.filter((d) => d.stage === "NEGOTIATION" || (d.stage === "WON" && d.invoices.length === 0));
    const blocking = limit == null ? [] : pending.filter((d) => d.stage === "WON" && !d.creditExceptionAt && used > limit);
    return { ...a, openInvoices, uninvoiced, used, limit, available, overdueCount: overdue.length, blocking };
  });
}

// ---------- Supplier payments ----------

export const paymentInclude = {
  supplierPo: {
    include: {
      supplier: true,
      deal: { select: { id: true, code: true, title: true, promisedDate: true, promiseText: true, account: { select: { name: true } } } },
    },
  },
  requestedBy: { select: { id: true, name: true } },
  verifiedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  executedBy: { select: { id: true, name: true } },
  executions: { orderBy: { sentAt: "asc" } },
  requirement: true,
} satisfies Prisma.SupplierPaymentInclude;

export async function loadSupplierPayments(where: Prisma.SupplierPaymentWhereInput = {}) {
  const rows = await db.supplierPayment.findMany({ where, include: paymentInclude, orderBy: { createdAt: "desc" } });
  return rows.map((p) => {
    const disc = bankDiscrepancies(p.supplierPo.supplier, p);
    return { ...p, discrepancies: disc, state: paymentState({ ...p, discrepancies: disc.length, executions: p.executions }) };
  });
}
