import { db } from "./db";
import { monthOf, monthRange } from "./customer-stats";
import { DEV_ROWS } from "./batting-coach";

// Tabla de bateo (owner, 2026-11-25): each person sees their requests, quotes and purchase orders of the month
// against their goal and against their own past (previous month, average of 3 / 6 / 12 months), and can narrow the
// same figures to one company. Counting rules are the ones of the customer Estadísticas page, so both screens agree.
// Attribution as in Mis metas: by the Need's owner. Months on Bogotá's calendar.

export type BatKey = "BAT_REQ_N" | "BAT_QUOTE_N" | "BAT_QUOTE_USD" | "BAT_PO_N" | "BAT_PO_USD" | "BAT_ESAGARA";
export type BatGroup = "sol" | "cot" | "oc" | "esa";
type Txt = { es: string; en: string };

export const BAT_GROUPS: Record<BatGroup, Txt> = {
  sol: { es: "Solicitudes", en: "Requests" },
  cot: { es: "Cotizaciones", en: "Quotes" },
  oc: { es: "Órdenes de compra", en: "Purchase orders" },
  esa: { es: "Eságara", en: "Eságara" },
};

/** `goalMetric`: the goal of this row is not typed in the table; it is the month's goal of that name in Mis metas. */
export const BAT_ROWS: { k: BatKey; group: BatGroup; unit: "n" | "usd"; label: Txt; goal: Txt; how: Txt; goalMetric?: string }[] = [
  { k: "BAT_REQ_N", group: "sol", unit: "n", label: { es: "# Solicitudes", en: "# Requests" }, goal: { es: "# Meta Solicitudes Mes", en: "# Requests goal for the month" }, how: { es: "Solicitudes: tus Necesidades, en el mes en que se crearon.", en: "Requests: your Needs, in the month they were created." } },
  { k: "BAT_QUOTE_N", group: "cot", unit: "n", label: { es: "# Cotizaciones", en: "# Quotes" }, goal: { es: "# Meta Cotizaciones Mes", en: "# Quotes goal for the month" }, how: { es: "# Cotizaciones: tus Necesidades con una cotización presentada, en el mes de la primera presentación (una revisión no cuenta otra vez).", en: "# Quotes: your Needs with a quote presented, in the month of the first presentation (a revision doesn't count again)." } },
  { k: "BAT_QUOTE_USD", group: "cot", unit: "usd", label: { es: "$ Cotizaciones", en: "$ Quotes" }, goal: { es: "$ Meta Cotizaciones Mes (USD)", en: "$ Quotes goal for the month (USD)" }, how: { es: "$ Cotizaciones: precio de venta de la última revisión presentada de cada Necesidad, en el mes de su primera presentación. USD sin IVA.", en: "$ Quotes: sale price of each Need's last presented revision, in the month of its first presentation. USD before VAT." } },
  { k: "BAT_PO_N", group: "oc", unit: "n", label: { es: "# Órdenes de compra", en: "# Purchase orders" }, goal: { es: "# Meta Órdenes de Compra Mes", en: "# Purchase orders goal for the month" }, how: { es: "# Órdenes de compra: órdenes de compra del cliente en tus Necesidades, en el mes en que llegaron. Las rechazadas no cuentan.", en: "# Purchase orders: the customer's purchase orders on your Needs, in the month they arrived. Rejected ones don't count." } },
  { k: "BAT_PO_USD", group: "oc", unit: "usd", label: { es: "$ Órdenes de compra", en: "$ Purchase orders" }, goal: { es: "$ Meta Órdenes de Compra Mes (USD)", en: "$ Purchase orders goal for the month (USD)" }, how: { es: "$ Órdenes de compra: cantidad por precio de cada línea de esas órdenes. USD sin IVA.", en: "$ Purchase orders: quantity times price of each line of those orders. USD before VAT." } },
  { k: "BAT_ESAGARA", group: "esa", unit: "usd", goalMetric: "ESAGARA_AMOUNT", label: { es: "$ Eságara", en: "$ Eságara" }, goal: { es: "$ Meta Eságara Mes (USD)", en: "$ Eságara goal for the month (USD)" }, how: { es: "$ Eságara: Eságara protegida de las cotizaciones aceptadas en el mes, en tus Necesidades. Su meta es la «Eságara ganada» que fijan Gerencia o la Dirección Comercial.", en: "$ Eságara: protected Eságara of the quotes accepted in the month, on your Needs. Its goal is the «Eságara won» set by Management or the Commercial Director." } },
];
/** The rows whose goal the person types in the table. */
export const BAT_GOAL_ROWS = BAT_ROWS.filter((r) => !r.goalMetric);

// Velocidad (owner, 2026-11-25: "also measure speed"): how long each step takes, in the month and on average.
export type SpeedKey = "BAT_SPD_FIRST" | "BAT_SPD_QUOTE" | "BAT_SPD_FOLLOW" | "BAT_SPD_PO";
export const SPEED_ROWS: { k: SpeedKey; unit: "hours" | "days"; label: Txt; goal: Txt; how: Txt }[] = [
  { k: "BAT_SPD_FIRST", unit: "hours", label: { es: "Tiempo Solicitud → Primera gestión", en: "Time Request → First action" }, goal: { es: "Meta Solicitud → Primera gestión (horas)", en: "Goal Request → First action (hours)" }, how: { es: "Solicitud → Primera gestión: horas desde que se creó la Necesidad hasta la primera llamada, correo o reunión registrada en ella. Una nota no cuenta.", en: "Request → First action: hours from creating the Need to the first call, email or meeting recorded on it. A note doesn't count." } },
  { k: "BAT_SPD_QUOTE", unit: "days", label: { es: "Tiempo Solicitud → Cotización", en: "Time Request → Quote" }, goal: { es: "Meta Solicitud → Cotización (días)", en: "Goal Request → Quote (days)" }, how: { es: "Solicitud → Cotización: días desde que se creó la Necesidad hasta su primera cotización presentada.", en: "Request → Quote: days from creating the Need to its first quote presented." } },
  { k: "BAT_SPD_FOLLOW", unit: "days", label: { es: "Tiempo Cotización → Seguimiento", en: "Time Quote → Follow-up" }, goal: { es: "Meta Cotización → Seguimiento (días)", en: "Goal Quote → Follow-up (days)" }, how: { es: "Cotización → Seguimiento: días desde la primera cotización presentada hasta la siguiente llamada, correo o reunión registrada en esa Necesidad (lo registrado en la primera hora es el envío de la cotización y no cuenta).", en: "Quote → Follow-up: days from the first quote presented to the next call, email or meeting recorded on that Need (what is recorded in the first hour is the sending of the quote and doesn't count)." } },
  { k: "BAT_SPD_PO", unit: "days", label: { es: "Tiempo Cotización → OC", en: "Time Quote → PO" }, goal: { es: "Meta Cotización → OC (días)", en: "Goal Quote → PO (days)" }, how: { es: "Cotización → OC: días desde la primera cotización presentada hasta la primera orden de compra del cliente.", en: "Quote → PO: days from the first quote presented to the customer's first purchase order." } },
];
export type SpeedLine = { actual: number | null; n: number; avg12: number | null; n12: number };
/** Every goal the person types under the table: the five counts and amounts, then the four times. */
/** `grp`: which form writes it: "tabla" (the batting table) or "desarrollo" (portfolio development). */
export const BAT_GOAL_FIELDS: { k: string; unit: "n" | "usd" | "hours" | "days"; goal: Txt; grp: "tabla" | "desarrollo" }[] = [
  ...BAT_GOAL_ROWS.map((r) => ({ k: r.k as string, unit: r.unit, goal: r.goal, grp: "tabla" as const })),
  ...SPEED_ROWS.map((r) => ({ k: r.k as string, unit: r.unit, goal: r.goal, grp: "tabla" as const })),
  ...DEV_ROWS.map((r) => ({ k: r.k as string, unit: r.unit, goal: r.goal, grp: "desarrollo" as const })),
];
export const BAT_KEYS = BAT_GOAL_FIELDS.map((r) => r.k);
const ALL_KEYS = BAT_ROWS.map((r) => r.k);

export type BatLine = {
  actual: number; prev: number | null; avg3: number | null; avg6: number | null; avg12: number | null;
  /** "Mi mejor marca": the best complete month before the chosen one, in all the history. null = none above zero. */
  best: { value: number; month: string } | null;
  /** The 12 months before the chosen one and the chosen one, oldest first. */
  months: { key: string; value: number }[];
};
export type Batting = {
  lines: Record<BatKey, BatLine>;
  /** Months with history before the chosen month (0–12): the averages divide by the months that exist. */
  history: number;
  /** Batting by cohort (owner's document, 2026-11-25): of the requests created in the period, how many were quoted;
   *  of the Needs first quoted in the period that already have a decision, how many were won. The chosen month and
   *  the 12 months before with it. `n` keeps [hits, at-bats] of each percentage. */
  rates: { quoteMonth: number | null; orderMonth: number | null; quoteYear: number | null; orderYear: number | null; n: Record<"quoteMonth" | "orderMonth" | "quoteYear" | "orderYear", [number, number]> };
  /** Times of the month (cases that finished the step in it) and of the 12 months before. */
  speed: Record<SpeedKey, SpeedLine>;
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

/** One person's batting table for a month; `accountId` narrows it to one company. Pure reads. */
export async function loadBatting(userId: string, period: string, accountId: string | null = null): Promise<Batting> {
  const [deals, won] = await Promise.all([db.deal.findMany({
    where: { ownerId: userId, internal: false, ...(accountId ? { accountId } : {}) },
    select: {
      createdAt: true,
      activities: { where: { type: { not: "NOTE" } }, orderBy: { occurredAt: "asc" }, select: { occurredAt: true } },
      quotes: { where: { presentedAt: { not: null } }, orderBy: { presentedAt: "asc" }, select: { presentedAt: true, protSale: true, status: true } },
      customerPos: { where: { rejectedAt: null }, select: { receivedAt: true, lines: { select: { qty: true, unitPrice: true } } } },
    },
  }),
  // Same rule as the «Eságara ganada» goal of Mis metas.
  db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: { not: null }, deal: { ownerId: userId, ...(accountId ? { accountId } : {}) } }, select: { decidedAt: true, protEsagra: true } })]);
  const sums = Object.fromEntries(ALL_KEYS.map((k) => [k, new Map<string, number>()])) as Record<BatKey, Map<string, number>>;
  let first: string | null = null;
  const add = (k: BatKey, at: Date, v: number) => {
    const m = monthOf(at);
    sums[k].set(m, (sums[k].get(m) ?? 0) + v);
    if (!first || m < first) first = m;
  };
  const times = Object.fromEntries(SPEED_ROWS.map((r) => [r.k, [] as { at: Date; value: number }[]])) as Record<SpeedKey, { at: Date; value: number }[]>;
  const HOUR = 3600e3, DAY = 864e5;
  const cohort: { created: string; quoted: string | null; won: boolean; decided: boolean }[] = [];
  for (const d of deals) {
    const wonIt = d.customerPos.length > 0 || d.quotes.some((q) => q.status === "ACCEPTED");
    cohort.push({ created: monthOf(d.createdAt), quoted: d.quotes[0]?.presentedAt ? monthOf(d.quotes[0].presentedAt) : null, won: wonIt, decided: wonIt || d.quotes.some((q) => q.status === "DECLINED") });
    add("BAT_REQ_N", d.createdAt, 1);
    const q0 = d.quotes[0];
    const act0 = d.activities.find((a) => a.occurredAt >= d.createdAt);
    if (act0) times.BAT_SPD_FIRST.push({ at: act0.occurredAt, value: (+act0.occurredAt - +d.createdAt) / HOUR });
    if (q0?.presentedAt) {
      const shown = q0.presentedAt;
      if (shown >= d.createdAt) times.BAT_SPD_QUOTE.push({ at: shown, value: (+shown - +d.createdAt) / DAY });
      const follow = d.activities.find((a) => +a.occurredAt >= +shown + HOUR);
      if (follow) times.BAT_SPD_FOLLOW.push({ at: follow.occurredAt, value: (+follow.occurredAt - +shown) / DAY });
      const po = d.customerPos.map((p) => p.receivedAt).filter((r) => r >= shown).sort((a, b) => +a - +b)[0];
      if (po) times.BAT_SPD_PO.push({ at: po, value: (+po - +shown) / DAY });
      add("BAT_QUOTE_N", q0.presentedAt, 1);
      add("BAT_QUOTE_USD", q0.presentedAt, Number(d.quotes[d.quotes.length - 1].protSale ?? 0));
    }
    for (const p of d.customerPos) {
      add("BAT_PO_N", p.receivedAt, 1);
      add("BAT_PO_USD", p.receivedAt, p.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0));
    }
  }
  for (const q of won) add("BAT_ESAGARA", q.decidedAt!, Number(q.protEsagra ?? 0));
  const keys = monthRange(period, 13);
  const before = keys.slice(0, 12);
  const history = first ? before.filter((m) => m >= first!).length : 0;
  const lines = {} as Record<BatKey, BatLine>;
  for (const row of BAT_ROWS) {
    const v = (m: string) => sums[row.k].get(m) ?? 0;
    // Average of the complete months before the chosen one; a person with less history divides by what exists.
    const avg = (n: number) => {
      const span = Math.min(n, history);
      if (!span) return null;
      const x = before.slice(12 - span).reduce((s, m) => s + v(m), 0) / span;
      return row.unit === "usd" ? Math.round(x) : Math.round(x * 10) / 10;
    };
    let best: BatLine["best"] = null;
    for (const [m, x] of sums[row.k]) if (m < period && x > 0 && (!best || x > best.value || (x === best.value && m > best.month))) best = { value: row.unit === "usd" ? Math.round(x) : x, month: m };
    lines[row.k] = { best, actual: v(period), prev: history ? v(before[11]) : null, avg3: avg(3), avg6: avg(6), avg12: avg(12), months: keys.map((key) => ({ key, value: v(key) })) };
  }
  const all13 = new Set(keys);
  const bat = (months: Set<string>) => {
    const asked = cohort.filter((c) => months.has(c.created));
    const shown = cohort.filter((c) => c.quoted && months.has(c.quoted) && c.decided);
    return { q: [asked.filter((c) => c.quoted).length, asked.length] as [number, number], o: [shown.filter((c) => c.won).length, shown.length] as [number, number] };
  };
  const bm = bat(new Set([period])), by = bat(all13);
  const prior = new Set(before);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const speed = Object.fromEntries(SPEED_ROWS.map((r) => {
    const now = times[r.k].filter((e) => monthOf(e.at) === period).map((e) => e.value);
    const old = times[r.k].filter((e) => prior.has(monthOf(e.at))).map((e) => e.value);
    return [r.k, { actual: mean(now), n: now.length, avg12: mean(old), n12: old.length }];
  })) as Record<SpeedKey, SpeedLine>;
  return {
    lines, history, speed,
    rates: {
      quoteMonth: pct(...bm.q), orderMonth: pct(...bm.o), quoteYear: pct(...by.q), orderYear: pct(...by.o),
      n: { quoteMonth: bm.q, orderMonth: bm.o, quoteYear: by.q, orderYear: by.o },
    },
  };
}

/** Companies whose name contains the text (for the search of the batting table). */
export const findCompanies = (q: string) =>
  db.account.findMany({ where: { name: { contains: q, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 9, select: { id: true, name: true } });
