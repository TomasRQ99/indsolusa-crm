import { db } from "./db";
import { invoiceCash, today } from "./domain";
import { sumMoney, sharePct } from "./money";
import { periodBounds, shiftPeriod } from "./goal-rules";

// Módulo 13 §5 · Business Pulse: what we discovered, what we closed, what we delivered and what resources we looked
// after, in one month. Two kinds of figures, never mixed (v1.1 §26): what HAPPENED in the period (counted from event
// dates) and how things STOOD at the moment of calculation. Everything is USD before VAT.

type Txt = { es: string; en: string };
export type PulseMetric = { key: string; label: Txt; value: number; unit: "usd" | "n" | "pct"; kind: "PERIOD" | "STATE"; href?: string; metric?: string; note?: Txt; n?: number };
export type PulseGroup = { key: string; title: Txt; question: Txt; metrics: PulseMetric[] };

async function periodFigures(period: string) {
  const { start, end } = periodBounds(period);
  const inP = { gte: start, lt: end };
  const [accepted, declined, presentations, needs, explorations, signals, futures, deliveries, exceptionsOpened, exceptionsResolved, invoices, cash, withheld, supplierPaid, commissions, finals, claims, cinv] = await Promise.all([
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: inP, deal: { internal: false } }, select: { protSale: true, protEsagra: true, deal: { select: { accountId: true } } } }),
    db.quote.count({ where: { status: "DECLINED", decidedAt: inP } }),
    db.presentationRecord.count({ where: { at: inP } }),
    db.deal.count({ where: { internal: false, createdAt: inP, desiredResult: { not: null }, NOT: { desiredResult: "" } } }),
    db.exploration.count({ where: { startedAt: inP } }),
    db.marketSignal.count({ where: { createdAt: inP } }),
    db.futureOpportunity.count({ where: { createdAt: inP } }),
    db.delivery.findMany({ where: { deliveredAt: inP, deal: { internal: false } }, select: { deliveredAt: true, deal: { select: { promisedDate: true } } } }),
    db.operationalException.count({ where: { createdAt: inP } }),
    db.operationalException.count({ where: { resolvedAt: inP } }),
    db.invoice.findMany({ where: { issuedAt: inP }, select: { amount: true, esagraAtIssue: true } }),
    db.paymentApplication.findMany({ where: { payment: { kind: "CASH", reconciledAt: inP } }, select: { amount: true } }),
    db.paymentApplication.findMany({ where: { payment: { kind: "WITHHOLDING", receivedAt: inP } }, select: { amount: true } }),
    db.supplierPayment.findMany({ where: { executedAt: inP }, select: { amountUsd: true } }),
    db.commissionEntry.findMany({ where: { approvedAt: inP }, select: { amount: true } }),
    db.deal.count({ where: { economicsState: "FINAL", economicsAt: inP } }),
    db.freightClaim.findMany({ where: { status: "RECOVERED", recoveredAt: inP }, select: { recoveredAmount: true } }),
    db.carrierInvoice.findMany({ where: { invoiceDate: inP }, select: { status: true } }),
  ]);
  const sale = sumMoney(accepted.map((q) => q.protSale)), esagara = sumMoney(accepted.map((q) => q.protEsagra));
  const withPromise = deliveries.filter((d) => d.deal.promisedDate);
  const onTime = withPromise.filter((d) => +d.deliveredAt <= +d.deal.promisedDate! + 864e5 - 1);
  return {
    sale, esagara, esagaraPct: sale > 0 ? sharePct(esagara, sale) : null, deals: accepted.length, decisions: accepted.length + declined, activeCustomers: new Set(accepted.map((q) => q.deal.accountId)).size,
    presentations, needs, explorations, signals, futures,
    deliveries: deliveries.length, withPromise: withPromise.length, onTime: onTime.length, exceptionsOpened, exceptionsResolved,
    invoiced: sumMoney(invoices.map((i) => i.amount)), invoicedEsagara: sumMoney(invoices.map((i) => i.esagraAtIssue)), collected: sumMoney(cash.map((a) => a.amount)), withheld: sumMoney(withheld.map((a) => a.amount)),
    supplierPaid: sumMoney(supplierPaid.map((p) => p.amountUsd)), commissionsApproved: sumMoney(commissions.map((c) => c.amount)), finals,
    claimsRecovered: sumMoney(claims.map((c) => c.recoveredAmount)), freightVariances: cinv.filter((c) => ["VARIANCE_REVIEW", "CLAIM_RECOMMENDED", "CLAIM_OPEN"].includes(c.status)).length, freightInvoices: cinv.length,
  };
}

/** How things stand right now (not at the end of a past month: SOLU keeps no history of balances). */
async function stateNow() {
  const T = today();
  const [invoices, notInvoiced, openExc, activeExpl] = await Promise.all([
    db.invoice.findMany({ select: { dueAt: true, amount: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
    db.delivery.count({ where: { invoice: null, deal: { internal: false } } }),
    db.operationalException.count({ where: { status: "OPEN" } }),
    db.exploration.count(),
  ]);
  const open = invoices.map((i) => { const c = invoiceCash(i); return { due: i.dueAt, b: c.balance - c.pendingReconcile }; }).filter((x) => x.b > 0.005);
  return { outstanding: sumMoney(open.map((x) => x.b)), overdue: sumMoney(open.filter((x) => x.due < T).map((x) => x.b)), notInvoiced, openExc, explorations: activeExpl };
}

export type PulseData = { period: string; asOf: string; cur: Awaited<ReturnType<typeof periodFigures>>; prev: Awaited<ReturnType<typeof periodFigures>>; state: Awaited<ReturnType<typeof stateNow>> };
export async function computePulse(period: string, now = new Date()): Promise<PulseData> {
  const [cur, prev, state] = await Promise.all([periodFigures(period), periodFigures(shiftPeriod(period, -1)), stateNow()]);
  return { period, asOf: now.toISOString(), cur, prev, state };
}

/** The pulse as groups by function. `prevOf(key)` gives the same figure for the previous month, when it is a period figure. */
export function pulseGroups(d: PulseData): { groups: PulseGroup[]; prevOf: (key: string) => number | null } {
  const c = d.cur, s = d.state;
  const p = (key: string, es: string, en: string, value: number, unit: PulseMetric["unit"], extra: Partial<PulseMetric> = {}): PulseMetric => ({ key, label: { es, en }, value, unit, kind: "PERIOD", ...extra });
  const st = (key: string, es: string, en: string, value: number, unit: PulseMetric["unit"], extra: Partial<PulseMetric> = {}): PulseMetric => ({ key, label: { es, en }, value, unit, kind: "STATE", ...extra });
  const groups: PulseGroup[] = [
    { key: "mercado", title: { es: "Mercado", en: "Market" }, question: { es: "¿Qué descubrimos?", en: "What did we discover?" }, metrics: [
      p("explorations", "Exploraciones iniciadas", "Explorations started", c.explorations, "n", { href: "/mercado" }),
      p("signals", "Señales registradas", "Signals recorded", c.signals, "n", { href: "/mercado" }),
      p("futures", "Oportunidades futuras identificadas", "Future opportunities identified", c.futures, "n", { href: "/mercado" }),
      p("needs", "Necesidades nuevas", "New Needs", c.needs, "n", { href: "/deals", metric: "NEEDS_CREATED" }),
      st("explTotal", "Exploraciones en total", "Explorations in total", s.explorations, "n", { href: "/mercado" }),
    ] },
    { key: "comercial", title: { es: "Comercial", en: "Commercial" }, question: { es: "¿Qué transamos?", en: "What did we close?" }, metrics: [
      p("sale", "Venta", "Sales", c.sale, "usd", { href: "/cotizaciones", metric: "SALES" }),
      p("esagara", "Eságara ganada", "Eságara won", c.esagara, "usd", { href: "/gerencia/rentabilidad", metric: "ESAGARA_AMOUNT", note: c.esagaraPct != null ? { es: `${c.esagaraPct.toFixed(1)} % de la venta`, en: `${c.esagaraPct.toFixed(1)} % of sales` } : undefined }),
      p("deals", "Negocios aceptados", "Deals accepted", c.deals, "n", { href: "/deals" }),
      p("activeCustomers", "Clientes que compraron", "Customers who bought", c.activeCustomers, "n", { href: "/accounts" }),
      p("presentations", "Soluciones presentadas", "Solutions presented", c.presentations, "n", { metric: "SOLUTIONS_PRESENTED" }),
      p("decisions", "Decisiones del cliente", "Customer decisions", c.decisions, "n", { href: "/cotizaciones", metric: "DECISIONS_MOVED" }),
    ] },
    { key: "operaciones", title: { es: "Operaciones", en: "Operations" }, question: { es: "¿Qué cumplimos?", en: "What did we deliver?" }, metrics: [
      p("deliveries", "Entregas al cliente", "Customer deliveries", c.deliveries, "n", { href: "/operaciones/remisiones" }),
      p("onTime", "Entregas dentro de la promesa", "Deliveries within the promise", c.onTime, "n", { href: "/operaciones/metricas", metric: "CUSTOMER_PROMISE", n: c.withPromise, note: { es: `de ${c.withPromise} con fecha prometida`, en: `of ${c.withPromise} with a promised date` } }),
      p("exceptionsOpened", "Excepciones abiertas en el mes", "Exceptions opened in the month", c.exceptionsOpened, "n", { href: "/operaciones" }),
      p("exceptionsResolved", "Excepciones resueltas en el mes", "Exceptions resolved in the month", c.exceptionsResolved, "n", { href: "/operaciones" }),
      p("freightVariances", "Facturas de flete con diferencia", "Freight invoices with a variance", c.freightVariances, "n", { href: "/logistica", n: c.freightInvoices, note: { es: `de ${c.freightInvoices} registradas`, en: `of ${c.freightInvoices} recorded` } }),
      p("claimsRecovered", "Recuperado de reclamos de flete", "Recovered from freight claims", c.claimsRecovered, "usd", { href: "/logistica" }),
      st("openExc", "Excepciones abiertas hoy", "Exceptions open today", s.openExc, "n", { href: "/operaciones" }),
      st("notInvoiced", "Entregas sin facturar hoy", "Deliveries not invoiced today", s.notInvoiced, "n", { href: "/operaciones/por-facturar", metric: "DELIVERED_NOT_INVOICED" }),
    ] },
    { key: "administracion", title: { es: "Administración", en: "Administration" }, question: { es: "¿Qué recursos cuidamos?", en: "What resources did we look after?" }, metrics: [
      p("invoiced", "Facturado", "Invoiced", c.invoiced, "usd", { href: "/administracion/cobrar" }),
      p("collected", "Cobrado y conciliado", "Collected and reconciled", c.collected, "usd", { href: "/administracion/pagos-recibidos" }),
      p("withheld", "Retenido por clientes", "Withheld by customers", c.withheld, "usd", { href: "/administracion/pagos-recibidos" }),
      p("supplierPaid", "Pagado a proveedores", "Paid to suppliers", c.supplierPaid, "usd", { href: "/administracion/pagos-proveedores" }),
      p("commissionsApproved", "Comisiones aprobadas", "Commissions approved", c.commissionsApproved, "usd", { href: "/gerencia/liquidacion", metric: "COMMISSION" }),
      p("finals", "Journeys con economía cerrada como final", "Journeys with economics closed as final", c.finals, "n", { href: "/administracion/economia?ver=todo" }),
      st("outstanding", "Por cobrar hoy", "Outstanding today", s.outstanding, "usd", { href: "/administracion/cobrar", metric: "OUTSTANDING" }),
      st("overdue", "Vencido hoy", "Overdue today", s.overdue, "usd", { href: "/administracion/cobrar", metric: "OVERDUE" }),
    ] },
  ];
  const prev = d.prev as unknown as Record<string, number | null>;
  return { groups, prevOf: (key) => (key in prev && typeof prev[key] === "number" ? (prev[key] as number) : null) };
}
