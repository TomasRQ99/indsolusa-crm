import { db } from "./db";
import { monthOf, monthRange } from "./customer-stats";
import type { Batting } from "./batting";

// The rest of the team's document of 2026-11-25 ("todo esto es esencial"), on top of the batting table:
// 1 goals per company · 2 the other batting percentages · 5 quality · 6 goal coverage · 7 SOLU's diagnosis ·
// 8 required pace · 9 portfolio development · 10 the scoreboard · 12 consistency.
// Everything compares the person with themselves; nothing here ranks people. No AI: counts and plain rules.
// Attribution as in the batting table: by the Need's owner; contacts by who logged them. Months on Bogotá's calendar.

type Txt = { es: string; en: string };
const DAY = 864e5;
/** A customer is "dormant" after this many days without a purchase order (reactivation, point 2 and 9). */
export const DORMANT_DAYS = 180;
/** The document's healthy coverage: open quotes worth three times what is still missing. */
export const HEALTHY_COVER = 3;

// ---------- 2 · batting percentages ----------

export type RateKey = "reqQuote" | "quoteOrder" | "reqOrder" | "byValue" | "byEsagara" | "repurchase" | "reactivation";
export const RATE_ROWS: { k: RateKey; money?: true; label: Txt; how: Txt }[] = [
  { k: "reqQuote", label: { es: "Bateo Solicitud → Cotización", en: "Batting Request → Quote" }, how: { es: "De las solicitudes creadas en el periodo, las que ya tienen cotización presentada. Dice tu capacidad de responder.", en: "Of the requests created in the period, those that already have a quote presented. It tells your capacity to respond." } },
  { k: "quoteOrder", label: { es: "Bateo Cotización → OC", en: "Batting Quote → PO" }, how: { es: "De las Necesidades cotizadas por primera vez en el periodo que ya tienen decisión, las ganadas (llegó la orden de compra o quedó aceptada). Dice tu capacidad de concretar.", en: "Of the Needs first quoted in the period that already have a decision, those won (the purchase order arrived or it was accepted). It tells your capacity to close." } },
  { k: "reqOrder", label: { es: "Bateo Solicitud → OC", en: "Batting Request → PO" }, how: { es: "De las solicitudes creadas en el periodo, las que ya se ganaron (llegó la orden de compra o la cotización quedó aceptada). Es la efectividad completa.", en: "Of the requests created in the period, those already won (the purchase order arrived or the quote was accepted). It is the complete effectiveness." } },
  { k: "byValue", money: true, label: { es: "Bateo por valor", en: "Batting by value" }, how: { es: "Valor ganado frente al valor cotizado que ya tiene decisión (última revisión presentada de cada Necesidad).", en: "Value won against the quoted value that already has a decision (last presented revision of each Need)." } },
  { k: "byEsagara", money: true, label: { es: "Bateo por Eságara", en: "Batting by Eságara" }, how: { es: "Eságara ganada frente a la Eságara de lo cotizado que ya tiene decisión.", en: "Eságara won against the Eságara of what was quoted and already has a decision." } },
  { k: "repurchase", label: { es: "Bateo Cliente → Recompra", en: "Batting Customer → Repurchase" }, how: { es: "De los clientes que te compraron en el periodo, los que ya habían comprado antes o compraron más de una vez.", en: "Of the customers who bought from you in the period, those who had bought before or bought more than once." } },
  { k: "reactivation", label: { es: "Bateo Reactivación", en: "Batting Reactivation" }, how: { es: `De los clientes dormidos (compraron alguna vez y llevaban ${DORMANT_DAYS} días o más sin orden de compra) que trabajaste en el periodo con una llamada, correo, reunión o Necesidad, los que volvieron a comprar.`, en: `Of the dormant customers (they bought once and had gone ${DORMANT_DAYS} days or more without a purchase order) you worked in the period with a call, email, meeting or Need, those who bought again.` } },
];
/** hits / at-bats; for the money rows both are amounts. pct null = no at-bats. */
export type Ratio = { pct: number | null; hit: number; of: number };
const ratio = (hit: number, of: number): Ratio => ({ pct: of > 0 ? Math.round((hit / of) * 100) : null, hit, of });

// ---------- 5 · quality ----------

export type QualityKey = "ticket" | "esaPerPo" | "margin" | "avgQuote" | "esaPerQuote";
export const QUALITY_ROWS: { k: QualityKey; unit: "usd" | "pct"; label: Txt; how: Txt }[] = [
  { k: "ticket", unit: "usd", label: { es: "Ticket promedio", en: "Average ticket" }, how: { es: "Valor de las órdenes de compra ÷ número de órdenes de compra.", en: "Value of the purchase orders ÷ number of purchase orders." } },
  { k: "esaPerPo", unit: "usd", label: { es: "Eságara promedio por OC", en: "Average Eságara per PO" }, how: { es: "Eságara ganada ÷ número de órdenes de compra.", en: "Eságara won ÷ number of purchase orders." } },
  { k: "margin", unit: "pct", label: { es: "Margen promedio", en: "Average margin" }, how: { es: "Eságara ganada ÷ venta de las cotizaciones aceptadas.", en: "Eságara won ÷ sale of the accepted quotes." } },
  { k: "avgQuote", unit: "usd", label: { es: "Valor promedio de cotización", en: "Average quote value" }, how: { es: "Valor cotizado ÷ número de cotizaciones.", en: "Value quoted ÷ number of quotes." } },
  { k: "esaPerQuote", unit: "usd", label: { es: "Eságara promedio por cotización", en: "Average Eságara per quote" }, how: { es: "Eságara de lo cotizado ÷ número de cotizaciones.", en: "Eságara of what was quoted ÷ number of quotes." } },
];

// ---------- 9 · portfolio development ----------

export type DevKey = "BAT_DEV_REACT" | "BAT_DEV_DEEP" | "BAT_DEV_CONTACT" | "BAT_DEV_DECISION" | "BAT_DEV_AREA" | "BAT_DEV_OPP";
export const DEV_ROWS: { k: DevKey; unit: "n"; label: Txt; goal: Txt; how: Txt }[] = [
  { k: "BAT_DEV_REACT", unit: "n", label: { es: "Clientes reactivados", en: "Customers reactivated" }, goal: { es: "Meta Clientes reactivados", en: "Goal Customers reactivated" }, how: { es: `Clientes con una Necesidad tuya creada en el mes cuya Necesidad anterior fue hace ${DORMANT_DAYS} días o más.`, en: `Customers with a Need of yours created in the month whose previous Need was ${DORMANT_DAYS} days ago or more.` } },
  { k: "BAT_DEV_DEEP", unit: "n", label: { es: "Clientes profundizados", en: "Customers deepened" }, goal: { es: "Meta Clientes profundizados", en: "Goal Customers deepened" }, how: { es: "Clientes que ya habían comprado y que en el mes te pidieron algo a través de una persona que nunca antes había pedido.", en: "Customers who had already bought and who this month asked you for something through a person who had never asked before." } },
  { k: "BAT_DEV_CONTACT", unit: "n", label: { es: "Nuevos contactos", en: "New contacts" }, goal: { es: "Meta Nuevos contactos", en: "Goal New contacts" }, how: { es: "Contactos registrados en el mes en los clientes que llevas (tuyos o con Necesidades tuyas).", en: "Contacts registered in the month at the customers you carry (yours or with Needs of yours)." } },
  { k: "BAT_DEV_DECISION", unit: "n", label: { es: "Nuevos decisores", en: "New decision makers" }, goal: { es: "Meta Nuevos decisores", en: "Goal New decision makers" }, how: { es: "Contactos que registraste en el mes marcados «Supe quién decide».", en: "Contacts you logged in the month marked «Learned who decides»." } },
  { k: "BAT_DEV_AREA", unit: "n", label: { es: "Nuevas áreas exploradas", en: "New areas explored" }, goal: { es: "Meta Nuevas áreas exploradas", en: "Goal New areas explored" }, how: { es: "Plantas, áreas de una persona y espacios en blanco que registraste en Mercado en el mes.", en: "Plants, a person's areas and white spaces you registered in Mercado in the month." } },
  { k: "BAT_DEV_OPP", unit: "n", label: { es: "Nuevas oportunidades generadas", en: "New opportunities generated" }, goal: { es: "Meta Nuevas oportunidades generadas", en: "Goal New opportunities generated" }, how: { es: "Oportunidades futuras que registraste en Mercado en el mes, más tus Necesidades del mes que nacieron de Mercado.", en: "Future opportunities you registered in Mercado in the month, plus your Needs of the month born from Mercado." } },
];

// ---------- 1 · goals per company ----------

export const ACC_PREFIX = "BAT_ACC:";
export const POT_PREFIX = "BAT_POT:";
/** Number of requests and of quotes expected from a customer in the month (approved 2026-11-25). */
export const REQ_PREFIX = "BAT_ARQ:";
export const QUO_PREFIX = "BAT_AQU:";
const COMPANY_PREFIXES = [ACC_PREFIX, POT_PREFIX, REQ_PREFIX, QUO_PREFIX];
const companyMetric = { OR: COMPANY_PREFIXES.map((p) => ({ metric: { startsWith: p } })) };

/** Company goals carry forward (approved 2026-11-25): a month uses the goals of the latest month, up to itself, in
 *  which the person saved any. Returns those rows per person, with the month they come from. */
export async function companyGoalRows(period: string, userId?: string) {
  const rows = await db.goalTarget.findMany({ where: { supersededAt: null, period: { lte: period }, ...(userId ? { userId } : {}), ...companyMetric }, select: { userId: true, metric: true, period: true, target: true } });
  const latest = new Map<string, string>();
  for (const r of rows) if ((latest.get(r.userId) ?? "") < r.period) latest.set(r.userId, r.period);
  return { rows: rows.filter((r) => latest.get(r.userId) === r.period), latest };
}
export const OTHERS = "OTROS";
export const POTENTIALS: Record<number, Txt> = { 3: { es: "Alto", en: "High" }, 2: { es: "Medio", en: "Medium" }, 1: { es: "Bajo", en: "Low" } };
export type CompanyGoalRow = { id: string; name: string; avg12: number; actual: number; goal: number | null; potential: number | null; reqGoal: number | null; reqActual: number; quoGoal: number | null; quoActual: number };
export type CompanyGoals = {
  rows: CompanyGoalRow[];
  others: { avg12: number; actual: number; goal: number | null; reqGoal: number | null; reqActual: number; quoGoal: number | null; quoActual: number };
  /** Sums of the goals (null = none of that kind): sales, requests, quotes. */
  total: number | null; reqTotal: number | null; quoTotal: number | null;
  hidden: number;
  /** The month the goals come from when it is not the chosen one (carried forward, not yet saved for this month). */
  carriedFrom: string | null;
};

// ---------- result ----------

export type Arrow = "up" | "flat" | "down" | null;
export type TrendRow = { k: "poUsd" | "esagara" | "batting"; unit: "usd" | "pct"; label: Txt; points: { month: string; value: number | null; arrow: Arrow }[] };
export type Coach = {
  rates: Record<RateKey, { month: Ratio; year: Ratio }>;
  /** Best complete earlier month of Quote → PO with at least 3 decided quotes. */
  bestOrder: { pct: number; month: string } | null;
  quality: Record<QualityKey, { month: number | null; year: number | null }>;
  /** Presented quotes still without a decision, on open Needs: the pipeline of point 6. */
  pipeline: { usd: number; n: number };
  trend: TrendRow[];
  /** Consecutive complete months, back from the one before the chosen month. */
  streak: { aboveAvg: { poUsd: number; esagara: number }; goal: { poUsd: number | null; esagara: number | null } };
  /** Customers with a purchase order: the last 3 months with the chosen one, and the 3 before. */
  buyers: { last3: number; prev3: number };
  companies: CompanyGoals | null;
  dev: Record<DevKey, number> | null;
};

const shiftMonth = (key: string, k: number) => { const [y, m] = key.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const BOGOTA_MS = 5 * 3600e3;
const monthStart = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1) + BOGOTA_MS); };

/** Everything beyond the table for one person and month; `accountId` narrows the percentages and quality to one company. */
export async function loadCoach(userId: string, period: string, accountId: string | null = null): Promise<Coach> {
  const keys = monthRange(period, 13);
  const win = new Set(keys);
  const prior = keys.slice(0, 12);
  const from = monthStart(period), to = monthStart(shiftMonth(period, 1));
  const winFrom = monthStart(keys[0]);

  const [deals, touches, person] = await Promise.all([
    db.deal.findMany({
      where: { ownerId: userId, internal: false, ...(accountId ? { accountId } : {}) },
      select: {
        accountId: true, contactId: true, createdAt: true, stage: true, closedAt: true, explorationId: true, originRef: true,
        account: { select: { name: true } },
        quotes: { where: { presentedAt: { not: null } }, orderBy: { presentedAt: "asc" }, select: { presentedAt: true, status: true, decidedAt: true, protSale: true, protEsagra: true } },
        customerPos: { where: { rejectedAt: null }, select: { receivedAt: true, lines: { select: { qty: true, unitPrice: true } } } },
      },
    }),
    db.activity.findMany({ where: { userId, type: { not: "NOTE" }, occurredAt: { gte: winFrom, lt: to }, accountId: accountId ?? { not: null } }, select: { accountId: true, occurredAt: true } }),
    db.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  const accountIds = [...new Set(deals.map((d) => d.accountId))];
  // Every purchase order of those customers (also on other people's Needs): "had bought before" is about the customer.
  const allPos = accountIds.length ? await db.customerPO.findMany({ where: { rejectedAt: null, deal: { accountId: { in: accountIds }, internal: false } }, select: { receivedAt: true, deal: { select: { accountId: true } } } }) : [];
  const posOf = new Map<string, Date[]>();
  for (const p of allPos) { const a = posOf.get(p.deal.accountId) ?? []; a.push(p.receivedAt); posOf.set(p.deal.accountId, a); }
  for (const a of posOf.values()) a.sort((x, y) => +x - +y);

  // ---- monthly sums ----
  type SumKey = "req" | "quoteN" | "quoteUsd" | "quoteEsa" | "poN" | "poUsd" | "wonUsd" | "esagara";
  const sums: Record<SumKey, Map<string, number>> = { req: new Map(), quoteN: new Map(), quoteUsd: new Map(), quoteEsa: new Map(), poN: new Map(), poUsd: new Map(), wonUsd: new Map(), esagara: new Map() };
  const poByAcc = new Map<string, Map<string, number>>();
  let first: string | null = null;
  const add = (k: SumKey, at: Date, v: number) => { const m = monthOf(at); sums[k].set(m, (sums[k].get(m) ?? 0) + v); if (!first || m < first) first = m; };
  type C = { accountId: string; created: Date; quoted: Date | null; sale: number; esa: number; won: boolean; decided: boolean; open: boolean };
  const cohort: C[] = [];
  const myPos: { accountId: string; at: Date }[] = [];
  for (const d of deals) {
    add("req", d.createdAt, 1);
    const q0 = d.quotes[0], last = d.quotes[d.quotes.length - 1];
    const sale = last ? Number(last.protSale ?? 0) : 0, esa = last ? Number(last.protEsagra ?? 0) : 0;
    if (q0?.presentedAt) { add("quoteN", q0.presentedAt, 1); add("quoteUsd", q0.presentedAt, sale); add("quoteEsa", q0.presentedAt, esa); }
    for (const p of d.customerPos) {
      const usd = p.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0);
      add("poN", p.receivedAt, 1); add("poUsd", p.receivedAt, usd);
      const m = poByAcc.get(d.accountId) ?? new Map<string, number>(); m.set(monthOf(p.receivedAt), (m.get(monthOf(p.receivedAt)) ?? 0) + usd); poByAcc.set(d.accountId, m);
      myPos.push({ accountId: d.accountId, at: p.receivedAt });
    }
    for (const q of d.quotes) if (q.status === "ACCEPTED" && q.decidedAt) { add("wonUsd", q.decidedAt, Number(q.protSale ?? 0)); add("esagara", q.decidedAt, Number(q.protEsagra ?? 0)); }
    const won = d.customerPos.length > 0 || d.quotes.some((q) => q.status === "ACCEPTED");
    const decided = won || d.quotes.some((q) => q.status === "DECLINED");
    cohort.push({ accountId: d.accountId, created: d.createdAt, quoted: q0?.presentedAt ?? null, sale, esa, won, decided, open: !decided && d.stage !== "LOST" && !d.closedAt });
  }
  const v = (k: SumKey, m: string) => sums[k].get(m) ?? 0;
  const total = (k: SumKey, ms: string[]) => ms.reduce((s, m) => s + v(k, m), 0);
  const history = first ? prior.filter((m) => m >= first!).length : 0;

  // ---- 2 · rates by cohort ----
  const rateFor = (months: Set<string>, start: Date, end: Date): Record<RateKey, Ratio> => {
    const asked = cohort.filter((c) => months.has(monthOf(c.created)));
    const shown = cohort.filter((c) => c.quoted && months.has(monthOf(c.quoted)) && c.decided);
    const wonShown = shown.filter((c) => c.won);
    // Repurchase: buyers of the period (on this person's Needs) who had bought before or more than once.
    const buyers = [...new Set(myPos.filter((p) => p.at >= start && p.at < end).map((p) => p.accountId))];
    const again = buyers.filter((a) => (posOf.get(a) ?? []).filter((d) => d < end).length >= 2);
    // Reactivation: dormant customers worked in the period, and those who then bought.
    const firstTouch = new Map<string, Date>();
    const touch = (a: string | null, at: Date) => { if (!a || at < start || at >= end) return; const cur = firstTouch.get(a); if (!cur || at < cur) firstTouch.set(a, at); };
    for (const t of touches) touch(t.accountId, t.occurredAt);
    for (const c of cohort) touch(c.accountId, c.created);
    let worked = 0, back = 0;
    for (const [a, at] of firstTouch) {
      const ps = posOf.get(a) ?? [];
      const before = ps.filter((d) => d < at);
      if (!before.length || +at - +before[before.length - 1] < DORMANT_DAYS * DAY) continue;
      worked++;
      if (ps.some((d) => d >= at)) back++;
    }
    return {
      reqQuote: ratio(asked.filter((c) => c.quoted).length, asked.length),
      quoteOrder: ratio(wonShown.length, shown.length),
      reqOrder: ratio(asked.filter((c) => c.won).length, asked.length),
      byValue: ratio(Math.round(wonShown.reduce((s, c) => s + c.sale, 0)), Math.round(shown.reduce((s, c) => s + c.sale, 0))),
      byEsagara: ratio(Math.round(wonShown.reduce((s, c) => s + c.esa, 0)), Math.round(shown.reduce((s, c) => s + c.esa, 0))),
      repurchase: ratio(again.length, buyers.length),
      reactivation: ratio(back, worked),
    };
  };
  const rm = rateFor(new Set([period]), from, to), ry = rateFor(win, winFrom, to);
  const rates = Object.fromEntries(RATE_ROWS.map((r) => [r.k, { month: rm[r.k], year: ry[r.k] }])) as Coach["rates"];
  const orderOf = (m: string) => { const s = cohort.filter((c) => c.quoted && monthOf(c.quoted) === m && c.decided); return { won: s.filter((c) => c.won).length, of: s.length }; };
  let bestOrder: Coach["bestOrder"] = null;
  for (const m of new Set(cohort.filter((c) => c.quoted).map((c) => monthOf(c.quoted!)))) {
    if (m >= period) continue;
    const o = orderOf(m);
    if (o.of < 3) continue;
    const pct = Math.round((o.won / o.of) * 100);
    if (!bestOrder || pct > bestOrder.pct || (pct === bestOrder.pct && m > bestOrder.month)) bestOrder = { pct, month: m };
  }

  // ---- 5 · quality ----
  const div = (a: number, b: number) => (b > 0 ? Math.round(a / b) : null);
  const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const q = (ms: string[]): Record<QualityKey, number | null> => ({
    ticket: div(total("poUsd", ms), total("poN", ms)), esaPerPo: div(total("esagara", ms), total("poN", ms)), margin: pctOf(total("esagara", ms), total("wonUsd", ms)),
    avgQuote: div(total("quoteUsd", ms), total("quoteN", ms)), esaPerQuote: div(total("quoteEsa", ms), total("quoteN", ms)),
  });
  const qm = q([period]), qy = q(prior);
  const quality = Object.fromEntries(QUALITY_ROWS.map((r) => [r.k, { month: qm[r.k], year: qy[r.k] }])) as Coach["quality"];

  // ---- 6 · pipeline ----
  const open = cohort.filter((c) => c.quoted && c.open);
  const pipeline = { usd: Math.round(open.reduce((s, c) => s + c.sale, 0)), n: open.length };

  // ---- 12 · consistency ----
  const arrow = (now: number | null, was: number | null): Arrow => (now == null || was == null ? null : now > was * 1.05 + 1e-9 ? "up" : now < was * 0.95 - 1e-9 ? "down" : "flat");
  const last4 = [4, 3, 2, 1].map((k) => shiftMonth(period, -k));
  const series = (f: (m: string) => number | null) => last4.slice(1).map((m, i) => ({ month: m, value: f(m), arrow: arrow(f(m), f(last4[i])) }));
  const batOf = (m: string) => { const o = orderOf(m); return o.of ? Math.round((o.won / o.of) * 100) : null; };
  const seen = (m: string) => !!first && m >= first;
  const trend: TrendRow[] = [
    { k: "poUsd", unit: "usd", label: { es: "Ventas (valor OC)", en: "Sales (PO value)" }, points: series((m) => (seen(m) ? Math.round(v("poUsd", m)) : null)) },
    { k: "esagara", unit: "usd", label: { es: "Eságara", en: "Eságara" }, points: series((m) => (seen(m) ? Math.round(v("esagara", m)) : null)) },
    { k: "batting", unit: "pct", label: { es: "Bateo Cotización → OC", en: "Batting Quote → PO" }, points: series(batOf) },
  ];
  const aboveAvg = (k: SumKey) => {
    let n = 0;
    for (let m = shiftMonth(period, -1); seen(shiftMonth(m, -1)) && n < 60; m = shiftMonth(m, -1)) {
      const back = monthRange(shiftMonth(m, -1), 12).filter(seen);
      const avg = back.reduce((s, x) => s + v(k, x), 0) / back.length;
      if (v(k, m) > avg) n++; else break;
    }
    return n;
  };
  const pastGoals = accountId ? [] : await db.goalTarget.findMany({ where: { userId, supersededAt: null, period: { lt: period }, metric: { in: ["BAT_PO_USD", "ESAGARA_AMOUNT"] } }, select: { metric: true, period: true, target: true } });
  const goalStreak = (metric: string, k: SumKey) => {
    const byPeriod = new Map(pastGoals.filter((g) => g.metric === metric).map((g) => [g.period, Number(g.target)]));
    if (!byPeriod.size) return null;
    let n = 0;
    for (let m = shiftMonth(period, -1); n < 60; m = shiftMonth(m, -1)) { const g = byPeriod.get(m); if (g && v(k, m) >= g) n++; else break; }
    return n;
  };
  const streak = { aboveAvg: { poUsd: aboveAvg("poUsd"), esagara: aboveAvg("esagara") }, goal: { poUsd: goalStreak("BAT_PO_USD", "poUsd"), esagara: goalStreak("ESAGARA_AMOUNT", "esagara") } };
  const buyersIn = (ms: string[]) => new Set(myPos.filter((p) => ms.includes(monthOf(p.at))).map((p) => p.accountId)).size;
  const buyers = { last3: buyersIn(keys.slice(10)), prev3: buyersIn(keys.slice(7, 10)) };

  if (accountId) return { rates, bestOrder, quality, pipeline, trend, streak, buyers, companies: null, dev: null };

  // ---- 1 · goals per company ----
  const cg = await companyGoalRows(period, userId);
  const gOf = (metric: string) => { const g = cg.rows.find((x) => x.metric === metric); return g ? Number(g.target) : null; };
  const span = Math.max(1, history);
  const nameOf = new Map(deals.map((d) => [d.accountId, d.account.name]));
  const recent = new Set(cohort.filter((c) => win.has(monthOf(c.created))).map((c) => c.accountId));
  const askedBy = new Map<string, number>(), quotedBy = new Map<string, number>();
  for (const c of cohort) {
    if (monthOf(c.created) === period) askedBy.set(c.accountId, (askedBy.get(c.accountId) ?? 0) + 1);
    if (c.quoted && monthOf(c.quoted) === period) quotedBy.set(c.accountId, (quotedBy.get(c.accountId) ?? 0) + 1);
  }
  const every = accountIds.map((id): CompanyGoalRow => {
    const m = poByAcc.get(id);
    return { id, name: nameOf.get(id) ?? "—", avg12: history ? Math.round(prior.reduce((s, x) => s + (m?.get(x) ?? 0), 0) / span) : 0, actual: Math.round(m?.get(period) ?? 0), goal: gOf(ACC_PREFIX + id), potential: gOf(POT_PREFIX + id), reqGoal: gOf(REQ_PREFIX + id), reqActual: askedBy.get(id) ?? 0, quoGoal: gOf(QUO_PREFIX + id), quoActual: quotedBy.get(id) ?? 0 };
  });
  const hasGoal = (r: CompanyGoalRow) => r.goal != null || r.reqGoal != null || r.quoGoal != null;
  const shownRows = every.filter((r) => hasGoal(r) || r.avg12 > 0 || r.actual > 0 || recent.has(r.id)).sort((a, b) => (b.goal ?? 0) - (a.goal ?? 0) || b.avg12 - a.avg12 || a.name.localeCompare(b.name, "es"));
  const rows = shownRows.slice(0, 40);
  const allAvg = history ? Math.round(total("poUsd", prior) / span) : 0, allActual = Math.round(v("poUsd", period));
  // "Otros" holds whatever has no goal of its own of that kind.
  const rest = (allOf: number, has: (r: CompanyGoalRow) => boolean, val: (r: CompanyGoalRow) => number) => Math.max(0, allOf - rows.filter(has).reduce((s, r) => s + val(r), 0));
  const others = {
    avg12: rest(allAvg, (r) => r.goal != null, (r) => r.avg12), actual: rest(allActual, (r) => r.goal != null, (r) => r.actual), goal: gOf(ACC_PREFIX + OTHERS),
    reqGoal: gOf(REQ_PREFIX + OTHERS), reqActual: rest(v("req", period), (r) => r.reqGoal != null, (r) => r.reqActual),
    quoGoal: gOf(QUO_PREFIX + OTHERS), quoActual: rest(v("quoteN", period), (r) => r.quoGoal != null, (r) => r.quoActual),
  };
  const sumOf = (pick: (r: CompanyGoalRow) => number | null, other: number | null) => { const xs = [...rows.map(pick), other].filter((x): x is number => x != null); return xs.length ? xs.reduce((s, x) => s + x, 0) : null; };
  const goalsFrom = cg.latest.get(userId) ?? null;
  const companies: CompanyGoals = { rows, others, total: sumOf((r) => r.goal, others.goal), reqTotal: sumOf((r) => r.reqGoal, others.reqGoal), quoTotal: sumOf((r) => r.quoGoal, others.quoGoal), hidden: shownRows.length - rows.length, carriedFrom: goalsFrom && goalsFrom !== period ? goalsFrom : null };

  // ---- 9 · portfolio development ----
  const inMonth = { gte: from, lt: to };
  const name = person?.name ?? "";
  const mine = cohort.filter((c) => c.created >= from && c.created < to);
  const monthAccounts = [...new Set(mine.map((c) => c.accountId))];
  const ownedAccounts = await db.account.findMany({ where: { ownerId: userId, internal: false }, select: { id: true } });
  const carried = [...new Set([...accountIds, ...ownedAccounts.map((a) => a.id)])];
  const [earlier, contacts, deciders, plants, areas, spaces, futures] = await Promise.all([
    monthAccounts.length ? db.deal.findMany({ where: { accountId: { in: monthAccounts }, internal: false, createdAt: { lt: from } }, select: { accountId: true, contactId: true, createdAt: true } }) : Promise.resolve([]),
    carried.length ? db.contact.count({ where: { accountId: { in: carried }, createdAt: inMonth } }) : Promise.resolve(0),
    db.activity.count({ where: { userId, occurredAt: inMonth, valueKind: "DECISION_MAKER" } }),
    name ? db.plant.count({ where: { capturedByName: name, createdAt: inMonth } }) : Promise.resolve(0),
    name ? db.employment.count({ where: { capturedByName: name, createdAt: inMonth, area: { not: null } } }) : Promise.resolve(0),
    name ? db.whiteSpace.count({ where: { createdByName: name, createdAt: inMonth } }) : Promise.resolve(0),
    db.futureOpportunity.count({ where: { ownerId: userId, createdAt: inMonth } }),
  ]);
  let react = 0, deep = 0;
  for (const a of monthAccounts) {
    const before = earlier.filter((e) => e.accountId === a);
    const firstNow = mine.filter((c) => c.accountId === a).reduce((m, c) => (c.created < m ? c.created : m), to);
    const lastBefore = before.reduce<Date | null>((m, e) => (!m || e.createdAt > m ? e.createdAt : m), null);
    if (lastBefore && +firstNow - +lastBefore >= DORMANT_DAYS * DAY) react++;
    const boughtBefore = (posOf.get(a) ?? []).some((d) => d < from);
    const known = new Set(before.map((e) => e.contactId).filter(Boolean));
    const askers = deals.filter((d) => d.accountId === a && d.createdAt >= from && d.createdAt < to && d.contactId).map((d) => d.contactId!);
    if (boughtBefore && askers.some((c) => !known.has(c))) deep++;
  }
  const fromMarket = deals.filter((d) => d.createdAt >= from && d.createdAt < to && (d.explorationId || d.originRef)).length;
  const dev: Record<DevKey, number> = { BAT_DEV_REACT: react, BAT_DEV_DEEP: deep, BAT_DEV_CONTACT: contacts, BAT_DEV_DECISION: deciders, BAT_DEV_AREA: plants + areas + spaces, BAT_DEV_OPP: futures + fromMarket };

  return { rates, bestOrder, quality, pipeline, trend, streak, buyers, companies, dev };
}

// ---------- 6 · coverage, 8 · pace, 7 · diagnosis (pure) ----------

export type Cover = { goal: number; sold: number; missing: number; pipeline: number; n: number; times: number | null };
/** What is still missing of the sales goal against the open quotes. times null = nothing missing. */
export function coverOf(goal: number | null, sold: number, pipeline: { usd: number; n: number }): Cover | null {
  if (!goal || goal <= 0) return null;
  const missing = Math.max(0, goal - sold);
  return { goal, sold, missing, pipeline: pipeline.usd, n: pipeline.n, times: missing > 0 ? Math.round((pipeline.usd / missing) * 10) / 10 : null };
}

export type DiagInput = {
  bat: Batting; coach: Coach; cover: Cover | null;
  /** Effective goals by batting key (typed, from companies or from the recipe). */
  goals: Partial<Record<string, number>>;
  /** Share of the month's working days already gone (1 for a closed month). */
  share: number;
  money: (v: number) => string;
};
export type Finding = { key: string; tone: "ok" | "attn" | "risk"; es: string; en: string };

/** Plain-rule diagnosis: which kind of problem this person has this month (cases A–D of the document), and where the
 *  biggest opportunity is. Each line is a fact about their own numbers; it never mentions another person. */
export function diagnose({ bat, coach, cover, goals, share, money }: DiagInput): Finding[] {
  const out: Finding[] = [];
  const L = bat.lines;
  const ref = (k: keyof typeof L) => { const base = goals[k] ?? L[k].avg12; return base && base > 0 ? base * share : null; };
  const low = (k: keyof typeof L) => { const r = ref(k); return r != null && L[k].actual < r * 0.85; };
  const fine = (k: keyof typeof L) => { const r = ref(k); return r != null && L[k].actual >= r * 0.85; };
  const known = (["BAT_REQ_N", "BAT_QUOTE_N", "BAT_PO_N", "BAT_PO_USD", "BAT_ESAGARA"] as const).filter((k) => ref(k) != null);
  if (!known.length) return [{ key: "none", tone: "attn", es: "Todavía no hay metas ni meses anteriores con registros: escribe tus metas en la tabla de bateo y SOLU te dirá dónde trabajar.", en: "There are no goals or earlier months with records yet: type your goals in the batting table and SOLU will tell you where to work." }];

  const ry = coach.rates.quoteOrder.year, rm = coach.rates.quoteOrder.month;
  if ((fine("BAT_REQ_N") || fine("BAT_QUOTE_N")) && (low("BAT_PO_N") || low("BAT_PO_USD"))) {
    out.push({ key: "A", tone: "risk", es: `Tu problema es de bateo: tienes solicitudes y cotizaciones, pero las órdenes de compra van por debajo de tu ritmo (este mes: ${L.BAT_QUOTE_N.actual} cotizaciones, ${L.BAT_PO_N.actual} órdenes de compra${coach.pipeline.n ? `, y ${coach.pipeline.n} cotizaciones abiertas sin decisión` : ""}). Trabaja la exploración de la necesidad, la presentación de valor, el seguimiento y el cierre.`, en: `Your problem is batting: you have requests and quotes, but purchase orders are below your pace (this month: ${L.BAT_QUOTE_N.actual} quotes, ${L.BAT_PO_N.actual} purchase orders${coach.pipeline.n ? `, and ${coach.pipeline.n} open quotes without a decision` : ""}). Work on exploring the need, presenting value, following up and closing.` });
  }
  const rq = coach.rates.reqQuote;
  if (rq.month.of >= 5 && rq.month.pct != null && rq.month.pct < 50 && (rq.year.pct == null || rq.month.pct < rq.year.pct)) {
    out.push({ key: "resp", tone: "attn", es: `Tienes solicitudes sin cotizar: has cotizado ${rq.month.hit} de las ${rq.month.of} de este mes (${rq.month.pct} %${rq.year.pct != null ? `, frente a ${rq.year.pct} % en 12 meses` : ""}). Responder rápido es lo que vendemos.`, en: `You have requests not yet quoted: you have quoted ${rq.month.hit} of this month's ${rq.month.of} (${rq.month.pct} %${rq.year.pct != null ? `, against ${rq.year.pct} % in 12 months` : ""}). Answering fast is what we sell.` });
  }
  if (low("BAT_REQ_N")) {
    out.push({ key: "B", tone: "risk", es: `Tu problema es de volumen de oportunidades: llegan pocas solicitudes${ry.pct != null ? `, aunque ganas ${ry.pct} % de lo que se decide` : ""}. Desarrolla clientes, reactiva los dormidos, visita y explora más.`, en: `Your problem is volume of opportunities: few requests come in${ry.pct != null ? `, although you win ${ry.pct} % of what gets decided` : ""}. Develop customers, reactivate the dormant ones, visit and explore more.` });
  }
  const mm = coach.quality.margin.month, my = coach.quality.margin.year;
  if (L.BAT_PO_N.actual > 0 && !low("BAT_PO_N") && ((mm != null && my != null && mm < my - 3) || (fine("BAT_PO_USD") && low("BAT_ESAGARA")))) {
    out.push({ key: "C", tone: "attn", es: `Tu problema es de calidad económica: cierras negocios, pero la Eságara es baja${mm != null && my != null ? ` (margen de ${mm} % este mes frente a ${my} % en 12 meses)` : ""}. Defiende el margen y elige negocios de más valor.`, en: `Your problem is economic quality: you close deals, but Eságara is low${mm != null && my != null ? ` (margin of ${mm} % this month against ${my} % in 12 months)` : ""}. Defend the margin and choose higher-value deals.` });
  }
  if (coach.buyers.prev3 > 0 && coach.buyers.last3 < coach.buyers.prev3 && !low("BAT_PO_USD")) {
    out.push({ key: "D", tone: "attn", es: `Tu problema es de sostenibilidad: tus cifras van bien, pero te compran menos clientes (${coach.buyers.last3} en los últimos 3 meses, ${coach.buyers.prev3} en los 3 anteriores). Protege y desarrolla tu cartera.`, en: `Your problem is sustainability: your figures are fine, but fewer customers buy from you (${coach.buyers.last3} in the last 3 months, ${coach.buyers.prev3} in the 3 before). Protect and develop your portfolio.` });
  }
  if (cover && cover.times != null) {
    if (cover.times < 1) out.push({ key: "cover", tone: "risk", es: `Tus cotizaciones abiertas cubren ${Math.round(cover.times * 100)} % de lo que falta: aun cerrándolo todo no alcanzas la meta. Necesitas generar oportunidades nuevas por ${money(cover.missing - cover.pipeline)}.`, en: `Your open quotes cover ${Math.round(cover.times * 100)} % of what is missing: even closing everything you don't reach the goal. You need to generate new opportunities worth ${money(cover.missing - cover.pipeline)}.` });
    else if (cover.times < HEALTHY_COVER) out.push({ key: "cover", tone: "attn", es: `Tu cobertura es de ${cover.times}X: para una cobertura sana de ${HEALTHY_COVER}X te faltan ${money(cover.missing * HEALTHY_COVER - cover.pipeline)} en cotizaciones.`, en: `Your coverage is ${cover.times}X: for a healthy ${HEALTHY_COVER}X coverage you are short ${money(cover.missing * HEALTHY_COVER - cover.pipeline)} in quotes.` });
    else out.push({ key: "cover", tone: "ok", es: `Tu cobertura es de ${cover.times}X: tienes oportunidades suficientes. Tu trabajo ahora es convertirlas.`, en: `Your coverage is ${cover.times}X: you have enough opportunities. Your work now is to convert them.` });
  }
  if (rm.pct != null && ry.pct != null && rm.of >= 3 && Math.abs(rm.pct - ry.pct) >= 4) {
    const up = rm.pct > ry.pct;
    out.push({ key: "bat", tone: up ? "ok" : "attn", es: `Tu bateo Cotización → OC ${up ? "mejoró" : "bajó"} ${Math.abs(rm.pct - ry.pct)} puntos frente a tus 12 meses (${rm.pct} % frente a ${ry.pct} %).`, en: `Your Quote → PO batting ${up ? "improved" : "dropped"} ${Math.abs(rm.pct - ry.pct)} points against your 12 months (${rm.pct} % against ${ry.pct} %).` });
  }
  const sq = bat.speed.BAT_SPD_QUOTE;
  if (sq.actual != null && sq.avg12 != null && sq.avg12 > 0 && Math.abs(sq.actual - sq.avg12) / sq.avg12 >= 0.15) {
    const faster = sq.actual < sq.avg12;
    out.push({ key: "speed", tone: faster ? "ok" : "attn", es: `Estás cotizando ${faster ? "más rápido" : "más lento"} que tu promedio: ${sq.actual} días frente a ${sq.avg12}.`, en: `You are quoting ${faster ? "faster" : "slower"} than your average: ${sq.actual} days against ${sq.avg12}.` });
  }
  const good = known.filter((k) => fine(k));
  if (!out.some((f) => f.tone !== "ok")) out.unshift({ key: "ok", tone: "ok", es: good.length === known.length ? "Vas dentro de tu ritmo en todo lo medido. Ahora ve por tu mejor marca." : "Nada se está frenando por ahora.", en: good.length === known.length ? "You are within your pace on everything measured. Now go for your best mark." : "Nothing is slowing down for now." });
  return out;
}
