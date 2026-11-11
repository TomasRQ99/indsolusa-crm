import { cache } from "react";
import { db } from "./db";
import { today } from "./domain";
import { sumMoney } from "./money";
import { computeCommissions } from "./commission";
import { dealEconomics, getEsagaraPolicy } from "./economics";
import { settlementPreview } from "./settlement";

// Módulo 12 R6 · the figures behind the Dirección / Gerencia view (§27) and the Administración home (§28).
// Everything is derived from the same records the detail screens use, so each number drills down to its source.
// No ranking of people and no score: money, counts and the reason behind each difference.

type Txt = { es: string; en: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

async function profitSummaryRaw(userId: string) {
  const T = today();
  const monthStart = new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth(), 1));
  const pol = await getEsagaraPolicy();
  const [deals, monthInvoices, { rows }, runs] = await Promise.all([
    db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" }, quotes: { some: { status: "ACCEPTED", protSale: { gt: 0 } } } }, orderBy: { poAcceptedAt: "desc" }, take: 80, select: { id: true } }),
    db.invoice.findMany({ where: { issuedAt: { gte: monthStart } }, select: { amount: true, esagraAtIssue: true } }),
    computeCommissions(),
    db.commissionSettlementRun.findMany({ where: { status: "APPROVED" }, select: { id: true, period: true, total: true } }),
  ]);
  const econ = (await Promise.all(deals.map((d) => dealEconomics(d.id, pol)))).filter((e): e is NonNullable<typeof e> => !!e?.econ);
  const open = econ.filter((e) => e.d.economicsState !== "FINAL");

  // Why Eságara moved, added up across open Journeys (same lines as each Journey's own explanation).
  const drivers = new Map<string, { text: Txt; usd: number; n: number }>();
  for (const e of open) for (const l of e.econ!.lines) { const g = drivers.get(l.text.es) ?? { text: l.text, usd: 0, n: 0 }; g.usd = r2(g.usd + l.usd); g.n++; drivers.set(l.text.es, g); }

  // By customer: revenue next to what it really leaves. A big customer with thin Eságara shows here.
  const byCustomer = new Map<string, { id: string; name: string; journeys: number; sale: number; prot: number; expected: number; outstanding: number }>();
  for (const e of econ) {
    const g = byCustomer.get(e.d.account.id) ?? { id: e.d.account.id, name: e.d.account.name, journeys: 0, sale: 0, prot: 0, expected: 0, outstanding: 0 };
    g.journeys++; g.sale = r2(g.sale + e.econ!.expected.sale); g.prot = r2(g.prot + e.econ!.prot.esagara); g.expected = r2(g.expected + e.econ!.expected.esagara); g.outstanding = r2(g.outstanding + e.revenue.outstanding);
    byCustomer.set(e.d.account.id, g);
  }

  const halves = rows.flatMap((r) => [{ r, half: "SALE" as const, h: r.saleHalf }, { r, half: "COLLECTION" as const, h: r.collectionHalf }]);
  const sumState = (pred: (s: string) => boolean, half?: "SALE" | "COLLECTION") => { const xs = halves.filter((x) => pred(x.h.state) && (!half || x.half === half) && x.r.invoiceId); return { n: xs.length, usd: sumMoney(xs.map((x) => x.h.amount)) }; };
  const commission = {
    estimated: sumMoney(halves.filter((x) => x.h.state === "ESTIMATED" || x.h.state === "AT_RISK" || x.h.state === "PARTIAL").map((x) => x.h.amount)),
    saleReady: sumState((s) => s === "EARNED", "SALE"), collectionReady: sumState((s) => s === "EARNED", "COLLECTION"),
    approved: sumState((s) => s === "APPROVED"), paid: sumState((s) => s === "PAID"),
  };
  const totalCommission = r2(commission.estimated + commission.saleReady.usd + commission.collectionReady.usd + commission.approved.usd + commission.paid.usd);
  const preview = settlementPreview(rows, userId);

  const esagaraMonth = sumMoney(monthInvoices.map((i) => i.esagraAtIssue));
  const expectedOpen = sumMoney(open.map((e) => e.econ!.expected.esagara));
  return {
    monthStart, policyVersion: pol.version,
    month: { invoiced: sumMoney(monthInvoices.map((i) => i.amount)), esagara: esagaraMonth, invoices: monthInvoices.length },
    openJourneys: open.length, protectedOpen: sumMoney(open.map((e) => e.econ!.prot.esagara)), expectedOpen, gapOpen: r2(open.reduce((s, e) => s + e.econ!.gap, 0)),
    outstanding: sumMoney(econ.map((e) => e.revenue.outstanding)),
    commission, totalCommission, contributionAfterVariable: r2(expectedOpen - sumMoney(halves.filter((x) => open.some((e) => e.d.id === x.r.dealId)).map((x) => x.h.full ?? x.h.amount))),
    drivers: [...drivers.values()].sort((a, b) => a.usd - b.usd),
    byCustomer: [...byCustomer.values()].sort((a, b) => b.sale - a.sale),
    // Administración home (§28)
    readyToClose: open.filter((e) => e.readiness.ready).map((e) => ({ id: e.d.id, code: e.d.code ?? e.d.title, account: e.d.account.name, esagara: e.econ!.expected.esagara })),
    missing: open.filter((e) => !e.readiness.ready).map((e) => ({ id: e.d.id, code: e.d.code ?? e.d.title, account: e.d.account.name, what: e.readiness.criteria.filter((c) => !c.ok).map((c) => c.text) })),
    variances: [...open].filter((e) => Math.abs(e.econ!.gap) > 0.005).sort((a, b) => a.econ!.gap - b.econ!.gap).slice(0, 8).map((e) => ({ id: e.d.id, code: e.d.code ?? e.d.title, account: e.d.account.name, gap: e.econ!.gap, main: [...e.econ!.lines].sort((a, b) => Math.abs(b.usd) - Math.abs(a.usd))[0]?.text ?? null })),
    otherCurrency: open.filter((e) => e.otherCurrency.length > 0).map((e) => ({ id: e.d.id, code: e.d.code ?? e.d.title, n: e.otherCurrency.length })),
    excess: preview.excess, runsUnpaid: runs.map((r) => ({ id: r.id, period: r.period, total: Number(r.total) })),
  };
}

/** Computed once per page: several blocks of the same screen read it (Módulo 15 Home). */
export const profitSummary = cache(profitSummaryRaw);
