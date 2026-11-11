import { db } from "./db";
import { mulMoney, sumMoney } from "./money";
import { CATS, DEFAULT_ESAGARA_POLICY, ESAGARA_POLICY_KEY, closureReadiness, economics, zeroCosts, type Cat, type Costs, type EsagaraPolicy } from "./economics-rules";
import { settlement } from "./withholding";

// Operaciones O9c + Módulo 12 R0 · the real costs of one Journey, read from where each fact already lives, plus the
// cost ledger. Money here is USD before IVA. Anything recorded in another currency is listed apart and never
// silently converted. Which cost categories count towards Eságara is a versioned policy, not code.

export type CostFact = { cat: Cat; amount: number; what: string; href: string | null; counts: boolean; ledgerId?: string; shared?: { method: string; total: number | null; note: string | null } | null };

export async function getEsagaraPolicy(): Promise<{ value: EsagaraPolicy; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: ESAGARA_POLICY_KEY }, orderBy: { version: "desc" } });
  if (!s) return { value: DEFAULT_ESAGARA_POLICY, version: 0, by: null, at: null };
  const v = s.value as Partial<EsagaraPolicy>;
  return { value: { counts: { ...DEFAULT_ESAGARA_POLICY.counts, ...(v.counts ?? {}) }, materialityUsd: Number(v.materialityUsd ?? 0) }, version: s.version, by: s.updatedByName, at: s.createdAt };
}

export async function dealEconomics(dealId: string, policy?: { value: EsagaraPolicy; version: number }) {
  const pol = policy ?? (await getEsagaraPolicy());
  const d = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true, code: true, title: true, ownerId: true, economicsState: true, economicsNote: true, economicsByName: true, economicsAt: true, economicsFinal: true,
      account: { select: { id: true, name: true } }, items: { select: { qty: true } },
      quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { id: true, number: true, protSale: true, protCost: true, protEsagra: true, supplierCost: true, freightCost: true, otherCosts: true, fxRate: true } },
      invoices: { select: { number: true, amount: true, applications: { select: { amount: true, payment: { select: { kind: true, reconciledAt: true } } } } } },
      deliveries: { select: { invoice: { select: { id: true } }, lines: { select: { qty: true } } } },
      supplierPos: { select: { id: true, code: true, amount: true, currency: true, releasedAt: true, supplier: { select: { name: true } }, payments: { select: { id: true, amountUsd: true, executedAt: true, executions: { where: { state: { not: "FAILED" } }, select: { feeUsd: true } } } } } },
      shipments: { select: { id: true, code: true, international: true, carrierInvoices: { select: { carrier: true, number: true, amount: true, currency: true, claim: { select: { status: true, recoveredAmount: true } } } }, customsCase: { select: { dutiesActual: true } } } },
      dispatchOrders: { where: { cancelledAt: null, cost: { not: null } }, select: { id: true, code: true, cost: true, costCurrency: true } },
      customerClaims: { where: { status: "OPEN" }, select: { id: true } },
      costs: { orderBy: { spentOn: "asc" } },
    },
  });
  if (!d) return null;
  const q = d.quotes[0] ?? null;
  const facts: CostFact[] = [];
  const otherCurrency: string[] = [];
  const add = (f: Omit<CostFact, "counts">) => facts.push({ ...f, counts: pol.value.counts[f.cat] !== false });
  for (const p of d.supplierPos.filter((x) => x.releasedAt)) {
    if (p.currency === "USD") add({ cat: "SUPPLIER", amount: Number(p.amount), what: `${p.code} · ${p.supplier.name}`, href: `/compras/${p.id}` });
    else {
      // An order in another currency counts at what was really paid in USD; until it is paid in full it is flagged.
      const paid = sumMoney(p.payments.filter((x) => x.executedAt).map((x) => x.amountUsd));
      if (paid > 0) add({ cat: "SUPPLIER", amount: paid, what: `${p.code} · ${p.supplier.name} (${p.currency}, pagado en USD)`, href: `/compras/${p.id}` });
      otherCurrency.push(`${p.code} (${p.currency})`);
    }
    const fee = sumMoney(p.payments.flatMap((x) => x.executions.map((e) => e.feeUsd)));
    if (fee > 0) add({ cat: "BANK_FEE", amount: fee, what: `Cargos de pago · ${p.code}`, href: `/compras/${p.id}` });
  }
  let claimRecovered = 0, openFreightClaims = 0;
  for (const s of d.shipments) {
    for (const ci of s.carrierInvoices) {
      if (ci.currency === "USD") add({ cat: "FREIGHT", amount: Number(ci.amount), what: `${ci.carrier} · ${ci.number}`, href: `/logistica/${s.id}#auditoria` }); else otherCurrency.push(`${ci.carrier} ${ci.number} (${ci.currency})`);
      if (ci.claim?.status === "RECOVERED" && ci.currency === "USD") claimRecovered = sumMoney([claimRecovered, ci.claim.recoveredAmount]);
      if (ci.claim && (ci.claim.status === "OPEN" || ci.claim.status === "ACCEPTED")) openFreightClaims++;
    }
    if (s.customsCase?.dutiesActual != null && Number(s.customsCase.dutiesActual) > 0) add({ cat: "DUTY", amount: Number(s.customsCase.dutiesActual), what: `Tributos · ${s.code}`, href: `/logistica/${s.id}#aduana` });
  }
  for (const o of d.dispatchOrders) { if (o.costCurrency === "USD") add({ cat: "DELIVERY", amount: Number(o.cost), what: `Despacho ${o.code}`, href: `/operaciones/despachos/${o.id}` }); else otherCurrency.push(`${o.code} (${o.costCurrency})`); }
  for (const c of d.costs) add({ cat: (CATS as string[]).includes(c.category) ? (c.category as Cat) : "OTHER", amount: Number(c.amount), what: c.description, href: null, ledgerId: c.id, shared: c.sharedId ? { method: c.splitMethod ?? "MANUAL", total: c.sharedTotal != null ? Number(c.sharedTotal) : null, note: c.splitNote } : null });

  const sums: Costs = zeroCosts();
  const known = Object.fromEntries(CATS.map((c) => [c, false])) as Record<Cat, boolean>;
  // Only the categories the policy counts enter Eságara; the rest stay visible, marked as not counted.
  for (const f of facts) if (f.counts) { sums[f.cat] = sumMoney([sums[f.cat], f.amount]); known[f.cat] = true; }
  const excluded = sumMoney(facts.filter((f) => !f.counts).map((f) => f.amount));
  const invoiced = d.invoices.length ? sumMoney(d.invoices.map((i) => i.amount)) : null;
  const protSupplier = q ? (q.fxRate ? mulMoney(q.supplierCost, q.fxRate) : Number(q.supplierCost)) : 0;
  const econ = q && q.protSale != null ? economics({ protSale: Number(q.protSale), protSupplier, protFreight: Number(q.freightCost), protOther: Number(q.otherCosts), invoiced, facts: sums, known, claimRecovered }) : null;

  // §5 Revenue side, each part on its own: sale is not invoice, invoice is not cash.
  const parts = d.invoices.map((i) => settlement(Number(i.amount), i.applications.map((a) => ({ amount: Number(a.amount), kind: a.payment.kind, reconciled: !!a.payment.reconciledAt }))));
  const revenue = { sale: q?.protSale != null ? Number(q.protSale) : null, invoiced: invoiced ?? 0, cash: sumMoney(parts.map((p) => p.cash)), pending: sumMoney(parts.map((p) => p.pending)), withheld: sumMoney(parts.map((p) => p.withheld)), outstanding: sumMoney(parts.map((p) => p.outstanding)) };

  const released = d.supplierPos.filter((x) => x.releasedAt);
  const units = d.items.reduce((a, x) => a + x.qty, 0);
  const readiness = closureReadiness({
    hasQuote: !!econ, supplierOrders: released.length, supplierOrdersUnreleased: d.supplierPos.length - released.length,
    shipments: d.shipments.length, shipmentsWithoutInvoice: d.shipments.filter((s) => s.carrierInvoices.length === 0).length,
    intlWithoutDuties: d.shipments.filter((s) => s.international && s.customsCase?.dutiesActual == null).length,
    unitsOrdered: units, unitsDelivered: d.deliveries.flatMap((x) => x.lines).reduce((a, l) => a + l.qty, 0),
    deliveriesNotInvoiced: d.deliveries.filter((x) => !x.invoice).length, invoiced: invoiced ?? 0,
    openFreightClaims, openCustomerClaims: d.customerClaims.length, otherCurrency: otherCurrency.length,
  });
  return { d, quote: q, facts, sums, known, excluded, invoiced, claimRecovered, otherCurrency, econ, units, revenue, readiness, policyVersion: pol.version, materialityUsd: pol.value.materialityUsd };
}
