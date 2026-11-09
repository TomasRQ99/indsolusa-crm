import type { Prisma } from "@prisma/client";
import { daysBetween, invoiceCash, today } from "./domain";
import type { makeI18n } from "./i18n";
import { DEFAULT_PAY_RULES, payBehavior, toPayInvoice, type PayRules } from "./pay-rules";

type I = ReturnType<typeof makeI18n>;

// 360 views (Customer, Product, Supplier): facts that improve the next decision, each with
// where it came from and how old it is. No opaque scores, no KPIs that don't change a decision.

/** How old a piece of knowledge is, and whether it's too old to trust without re-confirming. */
export function freshness(i: I, at: Date | null | undefined, staleDays: number, now = today()) {
  if (!at) return { at: null, days: null, stale: true, label: i.t("sin dato", "no data") };
  const days = Math.max(0, daysBetween(at, now));
  const label = days === 0 ? i.t("hoy", "today") : days < 60 ? i.t(`hace ${days} d`, `${days} d ago`) : days < 730 ? i.t(`hace ${Math.round(days / 30)} meses`, `${Math.round(days / 30)} months ago`) : i.t(`hace ${Math.round(days / 365)} años`, `${Math.round(days / 365)} years ago`);
  return { at, days, stale: days > staleDays, label };
}
export type Fresh = ReturnType<typeof freshness>;

/** Strip the demo tag so names match free text (quote supply basis, etc.). */
export const bareName = (s: string) => s.replace(/\s*\((ejemplo|example)\)\s*$/i, "").trim();
export const normCode = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

// ---------- Supplier ----------

export const supplierInclude = {
  bankVerifiedBy: { select: { name: true } },
  pos: {
    orderBy: { createdAt: "asc" },
    include: {
      deal: { select: { id: true, code: true, title: true, account: { select: { id: true, name: true } }, recoveries: true, quotes: { where: { status: "ACCEPTED" }, select: { number: true, rev: true, supplierCost: true, costCurrency: true, supplyPrimary: true, decidedAt: true } } } },
      lines: true,
      requirements: { include: { payments: { include: { executions: true } } } },
      payments: { include: { executions: true } },
      shipments: { include: { events: { where: { material: true }, orderBy: { at: "asc" } } } },
    },
  },
} satisfies Prisma.SupplierInclude;
export type Supplier360 = Prisma.SupplierGetPayload<{ include: typeof supplierInclude }>;

/** Actual ready-to-ship history: what the supplier promised (ship-by) vs when it really shipped. */
export function rtsHistory(s: Supplier360, now = today()) {
  return s.pos
    .filter((p) => p.releasedAt || p.confirmedAt)
    .map((p) => {
      const promised = p.shipBy;
      const ship = p.shipments.find((x) => x.rtsAt || x.pickedUpAt);
      const actual = p.shippedAt ?? ship?.rtsAt ?? ship?.pickedUpAt ?? null;
      const delta = promised && actual ? daysBetween(promised, actual) : null;
      const openLate = !actual && promised && promised < now ? daysBetween(promised, now) : null;
      const lead = p.confirmedAt && actual ? daysBetween(p.confirmedAt, actual) : null;
      return { p, promised, actual, delta, openLate, lead };
    });
}

// ---------- Customer ----------

export const customerInclude = {
  owner: { select: { id: true, name: true } },
  contacts: { orderBy: { lastName: "asc" } },
  deals: {
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { name: true } },
      items: { include: { deliveryLines: { include: { delivery: { select: { deliveredAt: true, code: true } } } } } },
      resultEvidence: { orderBy: { at: "desc" } },
      recoveries: true,
      continuity: true,
    },
  },
  invoices: { orderBy: { issuedAt: "desc" }, include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } }, promises: { orderBy: { createdAt: "desc" } } } },
  activities: { orderBy: { occurredAt: "desc" }, take: 60, include: { user: { select: { name: true } } } },
  threads: { orderBy: { lastAt: "desc" }, take: 20, select: { id: true, contactId: true, lastAt: true, channel: true, subject: true } },
} satisfies Prisma.AccountInclude;
export type Customer360 = Prisma.AccountGetPayload<{ include: typeof customerInclude }>;

/** How this customer actually pays: real delays, promises kept, short payments. */
export function billingPattern(a: Customer360, now = today(), rules: PayRules = DEFAULT_PAY_RULES) {
  // One truth with Mercado's payment behavior: only reconciled cash keeps a promise or counts as paid.
  const b = payBehavior(a.invoices.map(toPayInvoice), a.paymentTermsDays, now, rules);
  const hist = { n: b.expected.n, avg: b.expected.avgDelay ?? 0, enough: b.expected.enough };
  const { kept, broken } = b.promises;
  const shortPays = a.invoices.filter((inv) => inv.shortPayNote).map((inv) => inv.shortPayNote!);
  const open = a.invoices.reduce((s, inv) => s + invoiceCash(inv).balance, 0);
  const lastPaid = a.invoices.flatMap((inv) => inv.applications.filter((x) => x.payment.reconciledAt).map((x) => x.payment.receivedAt)).sort((x, y) => +y - +x)[0] ?? null;
  return { hist, kept, broken, shortPays, open, lastPaid, invoices: a.invoices.length, behavior: b };
}

/** What we delivered that is (or should be) running at the customer, with the result it gave. */
export function installedContext(a: Customer360) {
  const out: { code: string | null; description: string; qty: number; at: Date; dealId: string; dealCode: string | null; state: string; evidence: string | null }[] = [];
  for (const d of a.deals) {
    for (const it of d.items) {
      const qty = it.deliveryLines.reduce((s, l) => s + l.qty, 0);
      if (!qty) continue;
      const at = it.deliveryLines.map((l) => l.delivery.deliveredAt).sort((x, y) => +y - +x)[0];
      out.push({ code: it.code, description: it.description, qty, at, dealId: d.id, dealCode: d.code, state: d.resultState, evidence: d.resultEvidence.find((e) => e.stance === "SUPPORTS")?.text ?? null });
    }
  }
  return out.sort((x, y) => +y.at - +x.at);
}
