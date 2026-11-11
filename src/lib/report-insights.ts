import { db } from "./db";
import { invoiceCash, today } from "./domain";
import { sumMoney, sharePct } from "./money";
import { GOAL_METRICS, METRIC_KEYS, periodBounds, shiftPeriod, type MetricKey } from "./goal-rules";
import { goalActuals } from "./goals";
import { getComPolicy } from "./esagara-gate";

// Módulo 13 §13–14 · Variance & Cause for a goal gap, and insights. Every insight is a fact counted from records, says
// so, and links to where the evidence is. An inference is labelled as an inference. Nothing is sent to anyone.

type Txt = { es: string; en: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- pure: why Eságara is below its goal ----------

export type GapDeal = { id: string; code: string; account: string; sale: number; esagara: number };
export type GapCause = { key: string; text: Txt; usd: number; deals: GapDeal[] };
/** Splits the gap to goal into what low-Eságara sales explain and a residual that stays visible as unexplained. */
export function goalGap(target: number | null, actual: number, deals: GapDeal[], floorPct: number): { gap: number; causes: GapCause[]; unexplained: number } | null {
  if (target == null || target <= 0) return null;
  const gap = r2(target - actual);
  if (gap <= 0.005) return { gap: 0, causes: [], unexplained: 0 };
  // A sale under the floor "cost" the difference between the Eságara it would have at the floor and what it has.
  const low = deals.map((d) => ({ d, short: r2((d.sale * floorPct) / 100 - d.esagara) })).filter((x) => x.short > 0.005).sort((a, b) => b.short - a.short);
  const lowTotal = r2(low.reduce((s, x) => s + x.short, 0));
  const explained = Math.min(gap, lowTotal);
  const causes: GapCause[] = explained > 0.005 ? [{ key: "LOW_ESAGARA", text: { es: `Ventas con Eságara por debajo del ${floorPct} %`, en: `Sales with Eságara under ${floorPct} %` }, usd: r2(explained), deals: low.map((x) => x.d) }] : [];
  return { gap, causes, unexplained: r2(gap - explained) };
}

// ---------- the Commercial function for a month ----------

export async function commercialFunction(period: string) {
  const { start, end } = periodBounds(period);
  const inP = { gte: start, lt: end };
  const [people, targets, accepted, pol, sentNoPresent] = await Promise.all([
    db.user.findMany({ where: { active: true, OR: [{ deals: { some: { internal: false } } }, { goalTargets: { some: { period } } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.goalTarget.findMany({ where: { period, supersededAt: null }, select: { userId: true, metric: true, target: true } }),
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: inP, deal: { internal: false } }, select: { protSale: true, protEsagra: true, deal: { select: { id: true, code: true, title: true, account: { select: { name: true } } } } } }),
    getComPolicy(),
    db.quote.count({ where: { presentedAt: inP, status: { not: "DRAFT" }, presentations: { none: {} } } }),
  ]);
  const actuals = await Promise.all(people.map(async (p) => ({ p, a: await goalActuals(p.id, period) })));
  const prevActuals = await Promise.all(people.map((p) => goalActuals(p.id, shiftPeriod(period, -1))));
  const total = Object.fromEntries(METRIC_KEYS.map((k) => [k, r2(actuals.reduce((s, x) => s + x.a.values[k], 0))])) as Record<MetricKey, number>;
  const prev = Object.fromEntries(METRIC_KEYS.map((k) => [k, r2(prevActuals.reduce((s, a) => s + a.values[k], 0))])) as Record<MetricKey, number>;
  // A goal for the function exists only where people have goals: it is their sum, never invented.
  const goal = Object.fromEntries(METRIC_KEYS.map((k) => { const ts = targets.filter((t) => t.metric === k); return [k, ts.length ? r2(ts.reduce((s, t) => s + Number(t.target), 0)) : null]; })) as Record<MetricKey, number | null>;
  const floorPct = Number((pol.value as { floorPct?: number }).floorPct ?? 20);
  const deals: GapDeal[] = accepted.map((q) => ({ id: q.deal.id, code: q.deal.code ?? q.deal.title, account: q.deal.account.name, sale: Number(q.protSale ?? 0), esagara: Number(q.protEsagra ?? 0) }));
  const sale = sumMoney(deals.map((d) => d.sale));
  return { period, people: actuals.map((x) => ({ id: x.p.id, name: x.p.name, values: x.a.values, hasGoal: targets.some((t) => t.userId === x.p.id) })), total, prev, goal, sale, esagaraPct: sale > 0 ? sharePct(total.ESAGARA_AMOUNT, sale) : null, floorPct, floorVersion: pol.version, deals, gap: goalGap(goal.ESAGARA_AMOUNT, total.ESAGARA_AMOUNT, deals, floorPct), sentNoPresent };
}

// ---------- insights ----------

export type Insight = { key: string; kind: "FACT" | "INFERENCE"; headline: Txt; detail: Txt; href: string };
export async function insightsFor(period: string): Promise<Insight[]> {
  const T = today();
  const f = await commercialFunction(period);
  const [notInvoiced, invoices] = await Promise.all([
    db.delivery.findMany({ where: { invoice: null, deal: { internal: false } }, select: { lines: { select: { qty: true, dealItem: { select: { unitPrice: true } } } } } }),
    db.invoice.findMany({ where: { dueAt: { lt: T } }, select: { amount: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
  ]);
  const out: Insight[] = [];
  const usd = (n: number) => `USD ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const g = f.gap;
  if (g && g.gap > 0.005 && g.causes[0]) {
    const c = g.causes[0], share = Math.round((c.usd / g.gap) * 100);
    out.push({ key: "gap-low", kind: "FACT", headline: { es: `La Eságara va ${usd(g.gap)} por debajo de la meta; ${c.deals.length} venta(s) bajo el ${f.floorPct} % explican el ${share} % de esa diferencia.`, en: `Eságara is ${usd(g.gap)} below goal; ${c.deals.length} sale(s) under ${f.floorPct} % explain ${share} % of that difference.` }, detail: { es: `Cálculo: para cada venta bajo el umbral, lo que habría dejado al ${f.floorPct} % menos lo que dejó. El resto (${usd(g.unexplained)}) no viene de Eságara baja.`, en: `Calculation: for each sale under the threshold, what it would have left at ${f.floorPct} % minus what it left. The rest (${usd(g.unexplained)}) does not come from low Eságara.` }, href: "/comercial/esagara" });
  } else if (g && g.gap > 0.005) {
    out.push({ key: "gap", kind: "FACT", headline: { es: `La Eságara va ${usd(g.gap)} por debajo de la meta y ninguna venta del mes está bajo el ${f.floorPct} %.`, en: `Eságara is ${usd(g.gap)} below goal and no sale this month is under ${f.floorPct} %.` }, detail: { es: "La diferencia no viene de márgenes bajos: faltan ventas o son más pequeñas.", en: "The difference does not come from low margins: sales are missing or smaller." }, href: "/informes/funcion" });
  }
  if (f.prev.NEEDS_CREATED > 0 && f.total.NEEDS_CREATED < f.prev.NEEDS_CREATED) {
    const drop = Math.round((1 - f.total.NEEDS_CREATED / f.prev.NEEDS_CREATED) * 100);
    out.push({ key: "needs", kind: "INFERENCE", headline: { es: `Las necesidades nuevas van ${drop} % por debajo del mes anterior (${f.total.NEEDS_CREATED} frente a ${f.prev.NEEDS_CREATED}).`, en: `New Needs are ${drop} % below the previous month (${f.total.NEEDS_CREATED} against ${f.prev.NEEDS_CREATED}).` }, detail: { es: "Hecho: los dos conteos. Inferencia: si el mes termina así, habrá menos que cotizar el mes siguiente. Un mes en curso se compara con uno completo.", en: "Fact: both counts. Inference: if the month ends like this, there will be less to quote next month. A month in progress is being compared with a full one." }, href: "/deals" });
  }
  if (f.sentNoPresent > 0) out.push({ key: "present", kind: "FACT", headline: { es: `${f.sentNoPresent} cotización(es) se enviaron este mes sin una presentación registrada.`, en: `${f.sentNoPresent} quote(s) were sent this month without a recorded presentation.` }, detail: { es: "Una presentación registrada es la que cuenta en «Soluciones presentadas».", en: "A recorded presentation is what counts in \"Solutions presented\"." }, href: "/cotizaciones" });
  const ni = sumMoney(notInvoiced.flatMap((d) => d.lines.map((l) => l.qty * Number(l.dealItem.unitPrice))));
  if (ni > 0.005) out.push({ key: "notinv", kind: "FACT", headline: { es: `${usd(ni)} están entregados y todavía sin facturar.`, en: `${usd(ni)} are delivered and not invoiced yet.` }, detail: { es: `${notInvoiced.length} entrega(s) sin factura.`, en: `${notInvoiced.length} delivery(ies) without an invoice.` }, href: "/operaciones/por-facturar" });
  const od = sumMoney(invoices.map((i) => { const c = invoiceCash(i); return Math.max(0, c.balance - c.pendingReconcile); }));
  if (od > 0.005) out.push({ key: "overdue", kind: "FACT", headline: { es: `${usd(od)} de facturas ya vencidas siguen sin cobrar.`, en: `${usd(od)} of invoices already due remain uncollected.` }, detail: { es: "Después de pagos conciliados, por conciliar y retenciones.", en: "After reconciled payments, payments to reconcile and withholdings." }, href: "/administracion/cobrar" });
  return out;
}
export { GOAL_METRICS };
