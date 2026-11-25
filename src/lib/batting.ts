import { db } from "./db";
import { monthOf, monthRange } from "./customer-stats";

// Tabla de bateo (owner, 2026-11-25): each person sees their requests, quotes and purchase orders of the month
// against their goal and against their own past (previous month, average of 3 / 6 / 12 months), and can narrow the
// same figures to one company. Counting rules are the ones of the customer Estadísticas page, so both screens agree.
// Attribution as in Mis metas: by the Need's owner. Months on Bogotá's calendar.

export type BatKey = "BAT_REQ_N" | "BAT_QUOTE_N" | "BAT_QUOTE_USD" | "BAT_PO_N" | "BAT_PO_USD";
export type BatGroup = "sol" | "cot" | "oc";
type Txt = { es: string; en: string };

export const BAT_GROUPS: Record<BatGroup, Txt> = {
  sol: { es: "Solicitudes", en: "Requests" },
  cot: { es: "Cotizaciones", en: "Quotes" },
  oc: { es: "Órdenes de compra", en: "Purchase orders" },
};

export const BAT_ROWS: { k: BatKey; group: BatGroup; unit: "n" | "usd"; label: Txt; goal: Txt; how: Txt }[] = [
  { k: "BAT_REQ_N", group: "sol", unit: "n", label: { es: "# Solicitudes", en: "# Requests" }, goal: { es: "# Meta Solicitudes Mes", en: "# Requests goal for the month" }, how: { es: "Solicitudes: tus Necesidades, en el mes en que se crearon.", en: "Requests: your Needs, in the month they were created." } },
  { k: "BAT_QUOTE_N", group: "cot", unit: "n", label: { es: "# Cotizaciones", en: "# Quotes" }, goal: { es: "# Meta Cotizaciones Mes", en: "# Quotes goal for the month" }, how: { es: "# Cotizaciones: tus Necesidades con una cotización presentada, en el mes de la primera presentación (una revisión no cuenta otra vez).", en: "# Quotes: your Needs with a quote presented, in the month of the first presentation (a revision doesn't count again)." } },
  { k: "BAT_QUOTE_USD", group: "cot", unit: "usd", label: { es: "$ Cotizaciones", en: "$ Quotes" }, goal: { es: "$ Meta Cotizaciones Mes (USD)", en: "$ Quotes goal for the month (USD)" }, how: { es: "$ Cotizaciones: precio de venta de la última revisión presentada de cada Necesidad, en el mes de su primera presentación. USD sin IVA.", en: "$ Quotes: sale price of each Need's last presented revision, in the month of its first presentation. USD before VAT." } },
  { k: "BAT_PO_N", group: "oc", unit: "n", label: { es: "# Órdenes de compra", en: "# Purchase orders" }, goal: { es: "# Meta Órdenes de Compra Mes", en: "# Purchase orders goal for the month" }, how: { es: "# Órdenes de compra: órdenes de compra del cliente en tus Necesidades, en el mes en que llegaron. Las rechazadas no cuentan.", en: "# Purchase orders: the customer's purchase orders on your Needs, in the month they arrived. Rejected ones don't count." } },
  { k: "BAT_PO_USD", group: "oc", unit: "usd", label: { es: "$ Órdenes de compra", en: "$ Purchase orders" }, goal: { es: "$ Meta Órdenes de Compra Mes (USD)", en: "$ Purchase orders goal for the month (USD)" }, how: { es: "$ Órdenes de compra: cantidad por precio de cada línea de esas órdenes. USD sin IVA.", en: "$ Purchase orders: quantity times price of each line of those orders. USD before VAT." } },
];
export const BAT_KEYS = BAT_ROWS.map((r) => r.k);

export type BatLine = {
  actual: number; prev: number | null; avg3: number | null; avg6: number | null; avg12: number | null;
  /** The 12 months before the chosen one and the chosen one, oldest first. */
  months: { key: string; value: number }[];
};
export type Batting = {
  lines: Record<BatKey, BatLine>;
  /** Months with history before the chosen month (0–12): the averages divide by the months that exist. */
  history: number;
  /** Quotes per 100 requests and orders per 100 quotes: the chosen month and the last 12 months with it. */
  rates: { quoteMonth: number | null; orderMonth: number | null; quoteYear: number | null; orderYear: number | null };
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

/** One person's batting table for a month; `accountId` narrows it to one company. Pure reads. */
export async function loadBatting(userId: string, period: string, accountId: string | null = null): Promise<Batting> {
  const deals = await db.deal.findMany({
    where: { ownerId: userId, internal: false, ...(accountId ? { accountId } : {}) },
    select: {
      createdAt: true,
      quotes: { where: { presentedAt: { not: null } }, orderBy: { presentedAt: "asc" }, select: { presentedAt: true, protSale: true } },
      customerPos: { where: { rejectedAt: null }, select: { receivedAt: true, lines: { select: { qty: true, unitPrice: true } } } },
    },
  });
  const sums = Object.fromEntries(BAT_KEYS.map((k) => [k, new Map<string, number>()])) as Record<BatKey, Map<string, number>>;
  let first: string | null = null;
  const add = (k: BatKey, at: Date, v: number) => {
    const m = monthOf(at);
    sums[k].set(m, (sums[k].get(m) ?? 0) + v);
    if (!first || m < first) first = m;
  };
  for (const d of deals) {
    add("BAT_REQ_N", d.createdAt, 1);
    const q0 = d.quotes[0];
    if (q0?.presentedAt) {
      add("BAT_QUOTE_N", q0.presentedAt, 1);
      add("BAT_QUOTE_USD", q0.presentedAt, Number(d.quotes[d.quotes.length - 1].protSale ?? 0));
    }
    for (const p of d.customerPos) {
      add("BAT_PO_N", p.receivedAt, 1);
      add("BAT_PO_USD", p.receivedAt, p.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0));
    }
  }
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
    lines[row.k] = { actual: v(period), prev: history ? v(before[11]) : null, avg3: avg(3), avg6: avg(6), avg12: avg(12), months: keys.map((key) => ({ key, value: v(key) })) };
  }
  const year = (k: BatKey) => lines[k].months.reduce((s, m) => s + m.value, 0);
  return {
    lines, history,
    rates: {
      quoteMonth: pct(lines.BAT_QUOTE_N.actual, lines.BAT_REQ_N.actual), orderMonth: pct(lines.BAT_PO_N.actual, lines.BAT_QUOTE_N.actual),
      quoteYear: pct(year("BAT_QUOTE_N"), year("BAT_REQ_N")), orderYear: pct(year("BAT_PO_N"), year("BAT_QUOTE_N")),
    },
  };
}

/** Companies whose name contains the text (for the search of the batting table). */
export const findCompanies = (q: string) =>
  db.account.findMany({ where: { name: { contains: q, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 9, select: { id: true, name: true } });
