import { db } from "./db";
import { addDays, invoiceCash, today } from "./domain";
import { sumMoney } from "./money";
import { paymentBehaviors } from "./pay-behavior";
import { dueDates } from "./admin-rules";
import { balanceAge, byBucket, expectedCollection, gapLevers, liquidity, lowPoint, planDates, projection, reserveOpen, type FItem } from "./treasury-rules";

// Módulo 14 §2A, §8, §17 · Treasury read model. Every future movement is read from the record that creates it
// (invoice, promise, payment request, milestone, purchase, trip, settlement, obligation); only what SOLU cannot know
// (payroll, taxes, financing) is typed by a person as a plan item. Nothing is stored here: it is recomputed on open.

const WINDOW = 120;

export async function treasuryView() {
  const T = today();
  const to = addDays(T, WINDOW);
  const [accounts, reservesAll, plan, invoices, deals, payments, milestones, apInvoices, internal, missions, runs, obligations] = await Promise.all([
    db.bankAccount.findMany({ where: { active: true }, orderBy: { label: "asc" }, include: {
      balances: { orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }], take: 1 },
      transactions: { where: { balance: { not: null } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1, select: { date: true, balance: true } },
    } }),
    db.cashReserve.findMany({ where: { releasedAt: null }, orderBy: { createdAt: "desc" } }),
    db.cashPlanItem.findMany({ where: { endedAt: null }, orderBy: { dueOn: "asc" } }),
    db.invoice.findMany({ select: { id: true, number: true, issuedAt: true, dueAt: true, amount: true, accountId: true, dealId: true, account: { select: { name: true } }, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } }, promises: { where: { replacedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { promisedFor: true, createdAt: true } } } }),
    db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" } }, select: { id: true, code: true, title: true, promisedDate: true, poAcceptedAt: true, account: { select: { name: true, paymentTermsDays: true } }, quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { protSale: true } }, invoices: { select: { amount: true } }, deliveries: { where: { invoice: null }, select: { id: true } } } }),
    db.supplierPayment.findMany({ where: { executedAt: null }, select: { id: true, amount: true, currency: true, amountUsd: true, dueBy: true, approvedAt: true, createdAt: true, supplierPo: { select: { code: true, supplier: { select: { name: true } } } } } }),
    // A milestone counts only while nothing was requested for it. When an order has payments that name no milestone,
    // SOLU cannot tell which milestone they paid, so that order's milestones are left out rather than counted twice.
    db.paymentRequirement.findMany({ where: { payments: { none: {} }, supplierPo: { releasedAt: { not: null }, payments: { none: { requirementId: null } }, deal: { stage: { not: "LOST" } } } }, select: { id: true, label: true, amount: true, dueBy: true, supplierPo: { select: { id: true, code: true, currency: true, releasedAt: true, supplier: { select: { name: true } } } } } }),
    db.supplierInvoice.findMany({ where: { supplierPoId: null, paidAt: null }, select: { id: true, number: true, amount: true, currency: true, amountUsd: true, dueAt: true, payApprovedAt: true, receivedAt: true, supplier: { select: { name: true } } } }),
    db.internalPurchase.findMany({ where: { status: "APPROVED", boughtAt: null, invoices: { none: {} } }, select: { id: true, code: true, description: true, amountUsd: true, neededBy: true, decidedAt: true } }),
    db.commercialMission.findMany({ where: { budgetStatus: "APPROVED", settledAt: null, expensesStatus: { not: "RECONCILED" } }, select: { id: true, title: true, startDate: true, endDate: true, budgetApproved: true, advanceAmount: true, advanceGivenAt: true, budgetDecidedAt: true } }),
    db.commissionSettlementRun.findMany({ where: { status: "APPROVED" }, select: { id: true, period: true, total: true, approvedAt: true } }),
    db.obligation.findMany({ where: { status: "ACTIVE", moneyDirection: { not: "NONE" }, amount: { not: null }, nextDueOn: { not: null } }, select: { id: true, party: true, purpose: true, status: true, endsOn: true, frequency: true, nextDueOn: true, moneyDirection: true, amount: true, currency: true, createdAt: true } }),
  ]);

  const open = invoices.map((x) => { const c = invoiceCash(x); return { x, bal: Math.round((c.balance - c.pendingReconcile) * 100) / 100 }; }).filter((r) => r.bal > 0.005);
  const behavior = await paymentBehaviors([...new Set(open.map((r) => r.x.accountId))]);
  const items: FItem[] = [];
  let noUsd = 0;

  for (const { x, bal } of open) {
    const days = behavior.byId.get(x.accountId)?.expected.expectedDays ?? null;
    const p = x.promises[0] ?? null;
    const e = expectedCollection(x, days, p?.promisedFor ?? null, T);
    items.push({
      key: `inv-${x.id}`, bucket: e.bucket, label: `${x.number} · ${x.account.name}`, amount: bal, on: e.on, due: x.dueAt, href: `/deals/${x.dealId}?tab=cash`, committed: false,
      confidence: "EXPECTED", observedAt: e.basis === "PROMISE" ? p!.createdAt : x.issuedAt,
      source: e.basis === "PROMISE" ? "Promesa de pago del cliente" : e.basis === "BEHAVIOR" ? `Comportamiento real de pago (~${days} días)` : "Fecha contractual de vencimiento",
    });
  }
  for (const d of deals) {
    const sale = d.quotes[0]?.protSale != null ? Number(d.quotes[0].protSale) : 0;
    const left = Math.round((sale - sumMoney(d.invoices.map((i) => i.amount))) * 100) / 100;
    if (left <= 0.5) continue;
    const ready = d.deliveries.length > 0;
    const terms = d.account.paymentTermsDays ?? 0;
    items.push({
      key: `deal-${d.id}`, bucket: ready ? "INVOICE_READY" : "CONTRACTED", label: `${d.code ?? d.title} · ${d.account.name}`, amount: left, href: `/deals/${d.id}`, committed: false, confidence: "ESTIMATED", observedAt: d.poAcceptedAt,
      on: ready ? addDays(T, terms) : d.promisedDate ? addDays(d.promisedDate < T ? T : d.promisedDate, terms) : null,
      source: ready ? `Entregado sin facturar: si se factura hoy, más ${terms} días de plazo` : `Fecha prometida de entrega más ${terms} días de plazo`,
    });
  }
  for (const p of payments) {
    const usd = p.amountUsd != null ? Number(p.amountUsd) : p.currency === "USD" ? Number(p.amount) : null;
    if (usd == null) { noUsd++; continue; }
    items.push({ key: `pay-${p.id}`, bucket: p.approvedAt ? "PAY_APPROVED" : "PAY_REQUESTED", label: `${p.supplierPo.code} · ${p.supplierPo.supplier.name}`, amount: usd, on: p.dueBy, href: `/administracion/pagos-proveedores/${p.id}`, committed: !!p.approvedAt, confidence: p.approvedAt ? "CONFIRMED" : "EXPECTED", source: p.approvedAt ? "Pago aprobado, sin enviar al banco" : "Solicitud de pago", observedAt: p.approvedAt ?? p.createdAt });
  }
  for (const m of milestones) {
    if (m.supplierPo.currency !== "USD") { noUsd++; continue; }
    items.push({ key: `ms-${m.id}`, bucket: "PAY_MILESTONE", label: `${m.supplierPo.code} · ${m.supplierPo.supplier.name} · ${m.label}`, amount: Number(m.amount), on: m.dueBy, href: `/compras/${m.supplierPo.id}`, committed: false, confidence: "EXPECTED", source: "Hito de pago de la orden al proveedor", observedAt: m.supplierPo.releasedAt });
  }
  for (const a of apInvoices) {
    const usd = a.amountUsd != null ? Number(a.amountUsd) : a.currency === "USD" ? Number(a.amount) : null;
    if (usd == null) { noUsd++; continue; }
    items.push({ key: `ap-${a.id}`, bucket: "AP_INVOICE", label: `${a.number} · ${a.supplier.name}`, amount: usd, on: a.dueAt, href: `/administracion/pagar#f-${a.id}`, committed: !!a.payApprovedAt, confidence: a.payApprovedAt ? "CONFIRMED" : "EXPECTED", source: "Factura del proveedor", observedAt: a.receivedAt });
  }
  for (const p of internal) items.push({ key: `ip-${p.id}`, bucket: "INTERNAL", label: `${p.code} · ${p.description}`, amount: Number(p.amountUsd), on: p.neededBy, href: `/administracion/compras-internas/${p.id}`, committed: true, confidence: "EXPECTED", source: "Compra interna aprobada, aún sin factura", observedAt: p.decidedAt });
  for (const m of missions) {
    const left = Math.round((Number(m.budgetApproved ?? 0) - (m.advanceGivenAt ? Number(m.advanceAmount ?? 0) : 0)) * 100) / 100;
    if (left > 0.005) items.push({ key: `trip-${m.id}`, bucket: "TRAVEL", label: m.title, amount: left, on: m.advanceGivenAt ? m.endDate : m.startDate, href: `/visitas/mision/${m.id}`, committed: true, confidence: "EXPECTED", source: m.advanceGivenAt ? "Presupuesto de viaje aprobado, menos el anticipo ya entregado" : "Presupuesto de viaje aprobado", observedAt: m.budgetDecidedAt });
  }
  for (const r of runs) items.push({ key: `run-${r.id}`, bucket: "COMMISSIONS", label: `Liquidación ${r.period}`, amount: Number(r.total), on: null, href: `/gerencia/liquidacion?mes=${r.period}#corridas`, committed: true, confidence: "CONFIRMED", source: "Liquidación de comisiones aprobada", observedAt: r.approvedAt });
  for (const o of obligations) {
    if (o.currency !== "USD") { noUsd++; continue; }
    for (const d of dueDates(o, T, to)) items.push({ key: `ob-${o.id}-${d.toISOString().slice(0, 10)}`, bucket: o.moneyDirection === "COLLECT" ? "OTHER_IN" : "OBLIGATIONS", label: `${o.party} · ${o.purpose}`, amount: Number(o.amount), on: d, href: `/administracion/obligaciones#o-${o.id}`, committed: false, confidence: "EXPECTED", source: "Contrato u obligación registrada", observedAt: o.createdAt });
  }
  for (const p of plan) {
    if (p.currency !== "USD") { noUsd++; continue; }
    for (const d of planDates(p, T, to)) items.push({ key: `plan-${p.id}-${d.toISOString().slice(0, 10)}`, bucket: p.direction === "IN" ? "OTHER_IN" : "PLAN_OUT", label: p.label, amount: Number(p.amount), on: d, href: "/administracion/tesoreria#plan", committed: false, confidence: p.confidence === "CONFIRMED" || p.confidence === "ESTIMATED" ? p.confidence : "EXPECTED", source: p.source, observedAt: p.observedAt });
  }

  const reserves = reservesAll.filter((r) => reserveOpen(r, T));
  const bank = accounts.map((a) => {
    const b = a.balances[0] ?? null;
    const st = a.transactions[0] ?? null;
    // A newer running balance on the statement than the last confirmed one: offered, never taken without a person.
    const suggestion = st && st.balance != null && (!b || st.date > b.observedAt) ? { amount: Number(st.balance), date: st.date } : null;
    return { id: a.id, label: a.label, bank: a.bank, last4: a.last4, currency: a.currency, balance: b ? { amount: Number(b.amount), observedAt: b.observedAt, source: b.source, by: b.confirmedByName, note: b.note } : null, suggestion, age: balanceAge(b?.observedAt ?? null, T) };
  });
  const balances = bank.filter((a) => a.balance).map((a) => ({ amount: a.balance!.amount, currency: a.currency }));
  const res = reserves.map((r) => ({ kind: r.kind, amount: Number(r.amount), currency: r.currency }));
  const liq = liquidity(balances, res, items);
  const setAside = sumMoney([liq.restricted, liq.reserved]);
  const low = lowPoint(liq.bank, setAside, items, T, 90);
  return {
    asOf: new Date(), today: T, bank, reserves, plan, items, liq,
    proj: projection(liq.bank, setAside, items, T), low, levers: gapLevers(items, res, T, low.lowOn), groups: byBucket(items),
    missingBalance: bank.filter((a) => !a.balance).length, staleBalance: bank.filter((a) => a.balance && a.age.stale).length, noUsd,
  };
}
export type TreasuryView = Awaited<ReturnType<typeof treasuryView>>;
