import { db } from "./db";
import { mulMoney, sumMoney } from "./money";
import { CATS, economics, zeroCosts, type Cat, type Costs } from "./economics-rules";

// Operaciones O9c · the real costs of one Journey, read from where each fact already lives, plus the cost ledger.
// Money here is USD before IVA. Anything recorded in another currency is listed apart and never silently converted.

export type CostFact = { cat: Cat; amount: number; what: string; href: string | null; ledgerId?: string; shared?: { method: string; total: number | null; note: string | null } | null };

export async function dealEconomics(dealId: string) {
  const d = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true, code: true, title: true, ownerId: true, economicsState: true, economicsNote: true, economicsByName: true, economicsAt: true, economicsFinal: true,
      account: { select: { id: true, name: true } }, items: { select: { qty: true } },
      quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { id: true, number: true, protSale: true, protCost: true, protEsagra: true, supplierCost: true, freightCost: true, otherCosts: true, fxRate: true } },
      invoices: { select: { number: true, amount: true } },
      supplierPos: { select: { id: true, code: true, amount: true, currency: true, releasedAt: true, supplier: { select: { name: true } }, payments: { select: { id: true, amountUsd: true, executedAt: true, executions: { where: { state: { not: "FAILED" } }, select: { feeUsd: true } } } } } },
      shipments: { select: { id: true, code: true, carrierInvoices: { select: { carrier: true, number: true, amount: true, currency: true, claim: { select: { status: true, recoveredAmount: true } } } }, customsCase: { select: { dutiesActual: true } } } },
      dispatchOrders: { where: { cancelledAt: null, cost: { not: null } }, select: { id: true, code: true, cost: true, costCurrency: true } },
      costs: { orderBy: { spentOn: "asc" } },
    },
  });
  if (!d) return null;
  const q = d.quotes[0] ?? null;
  const facts: CostFact[] = [];
  const otherCurrency: string[] = [];
  for (const p of d.supplierPos.filter((x) => x.releasedAt)) {
    if (p.currency === "USD") facts.push({ cat: "SUPPLIER", amount: Number(p.amount), what: `${p.code} · ${p.supplier.name}`, href: `/compras/${p.id}` });
    else {
      // An order in another currency counts at what was really paid in USD; until it is paid in full it is flagged.
      const paid = sumMoney(p.payments.filter((x) => x.executedAt).map((x) => x.amountUsd));
      if (paid > 0) facts.push({ cat: "SUPPLIER", amount: paid, what: `${p.code} · ${p.supplier.name} (${p.currency}, pagado en USD)`, href: `/compras/${p.id}` });
      otherCurrency.push(`${p.code} (${p.currency})`);
    }
    const fee = sumMoney(p.payments.flatMap((x) => x.executions.map((e) => e.feeUsd)));
    if (fee > 0) facts.push({ cat: "BANK_FEE", amount: fee, what: `Cargos de pago · ${p.code}`, href: `/compras/${p.id}` });
  }
  let claimRecovered = 0;
  for (const s of d.shipments) {
    for (const ci of s.carrierInvoices) {
      if (ci.currency === "USD") facts.push({ cat: "FREIGHT", amount: Number(ci.amount), what: `${ci.carrier} · ${ci.number}`, href: `/logistica/${s.id}#auditoria` }); else otherCurrency.push(`${ci.carrier} ${ci.number} (${ci.currency})`);
      if (ci.claim?.status === "RECOVERED" && ci.currency === "USD") claimRecovered = sumMoney([claimRecovered, ci.claim.recoveredAmount]);
    }
    if (s.customsCase?.dutiesActual != null && Number(s.customsCase.dutiesActual) > 0) facts.push({ cat: "DUTY", amount: Number(s.customsCase.dutiesActual), what: `Tributos · ${s.code}`, href: `/logistica/${s.id}#aduana` });
  }
  for (const o of d.dispatchOrders) { if (o.costCurrency === "USD") facts.push({ cat: "DELIVERY", amount: Number(o.cost), what: `Despacho ${o.code}`, href: `/operaciones/despachos/${o.id}` }); else otherCurrency.push(`${o.code} (${o.costCurrency})`); }
  for (const c of d.costs) facts.push({ cat: (CATS as string[]).includes(c.category) ? (c.category as Cat) : "OTHER", amount: Number(c.amount), what: c.description, href: null, ledgerId: c.id, shared: c.sharedId ? { method: c.splitMethod ?? "MANUAL", total: c.sharedTotal != null ? Number(c.sharedTotal) : null, note: c.splitNote } : null });

  const sums: Costs = zeroCosts();
  const known = Object.fromEntries(CATS.map((c) => [c, false])) as Record<Cat, boolean>;
  for (const f of facts) { sums[f.cat] = sumMoney([sums[f.cat], f.amount]); known[f.cat] = true; }
  const invoiced = d.invoices.length ? sumMoney(d.invoices.map((i) => i.amount)) : null;
  const protSupplier = q ? (q.fxRate ? mulMoney(q.supplierCost, q.fxRate) : Number(q.supplierCost)) : 0;
  const econ = q && q.protSale != null ? economics({ protSale: Number(q.protSale), protSupplier, protFreight: Number(q.freightCost), protOther: Number(q.otherCosts), invoiced, facts: sums, known, claimRecovered }) : null;
  return { d, quote: q, facts, sums, known, invoiced, claimRecovered, otherCurrency, econ, units: d.items.reduce((a, x) => a + x.qty, 0) };
}
