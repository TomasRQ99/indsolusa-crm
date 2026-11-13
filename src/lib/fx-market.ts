import { db } from "./db";
import { BASE_CURRENCY, FOREIGN_CURRENCIES, currencyOf, type Currency } from "./currencies";

// Market exchange rates for the currencies suppliers are paid in, read from Yahoo Finance.
// Yahoo publishes no official business API: this is its public quote service (no key). It can fail or change
// without notice, so: every reading is saved (FxRate), a failed refresh keeps the last saved rate with its
// date, and currencies Yahoo doesn't answer are completed with the European Central Bank's daily reference
// rates (frankfurter.dev). Each rate says where it came from. Read-only; nothing here moves money.
// The rate is the market's mid rate: the bank's own rate on the day of payment will differ by its spread.

const YAHOO = process.env.NODE_ENV !== "production" && process.env.FX_YAHOO_BASE ? process.env.FX_YAHOO_BASE : "https://query1.finance.yahoo.com";
const ECB = process.env.NODE_ENV !== "production" && process.env.FX_ECB_BASE ? process.env.FX_ECB_BASE : "https://api.frankfurter.dev";
export const YAHOO_SOURCE = "Yahoo Finance";
export const ECB_SOURCE = "Banco Central Europeo (frankfurter.dev)";
/** A saved rate older than this is refreshed before it is used. */
export const FRESH_MINUTES = 15;
/** Older than this it is shown as "not from today's market". */
export const STALE_HOURS = 96; // covers a weekend plus a holiday: the currency market closes Friday night

export type MarketRate = { currency: string; usdPerUnit: number; unitsPerUsd: number; source: string; quotedAt: Date; fetchedAt: Date; stale: boolean };
type Reading = { currency: string; usdPerUnit: number; unitsPerUsd: number; source: string; quotedAt: Date };

const symbolOf = (c: Currency) => (c.direct ? `${c.code}USD=X` : `${c.code}=X`);
const round = (v: number, dp: number) => Number(v.toFixed(dp));

/** A Yahoo price for a currency's symbol → both directions. Null when the number can't be a rate. */
export function readingFrom(c: Currency, price: unknown, time: unknown, source: string): Reading | null {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0 || p > 1e7) return null;
  const usdPerUnit = c.direct ? p : 1 / p;
  const t = Number(time);
  const quotedAt = Number.isFinite(t) && t > 1e9 ? new Date(t * 1000) : new Date();
  return { currency: c.code, usdPerUnit: round(usdPerUnit, 10), unitsPerUsd: round(1 / usdPerUnit, 6), source, quotedAt };
}

const get = async (url: string) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; fx-rates)" }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
};

type Meta = { regularMarketPrice?: number; regularMarketTime?: number };

/** Several currencies in one Yahoo call. */
async function yahooBatch(list: Currency[]): Promise<Reading[]> {
  const qs = new URLSearchParams({ symbols: list.map(symbolOf).join(","), range: "1d", interval: "1d" });
  const j = (await get(`${YAHOO}/v7/finance/spark?${qs}`)) as { spark?: { result?: { symbol?: string; response?: { meta?: Meta }[] }[] } };
  const out: Reading[] = [];
  for (const r of j.spark?.result ?? []) {
    const c = list.find((x) => symbolOf(x) === r.symbol);
    const m = r.response?.[0]?.meta;
    const got = c && m ? readingFrom(c, m.regularMarketPrice, m.regularMarketTime, YAHOO_SOURCE) : null;
    if (got) out.push(got);
  }
  return out;
}

/** One currency from Yahoo's chart service (used for what the batch call didn't answer). */
async function yahooOne(c: Currency): Promise<Reading | null> {
  const j = (await get(`${YAHOO}/v8/finance/chart/${encodeURIComponent(symbolOf(c))}?interval=1d&range=1d`)) as { chart?: { result?: { meta?: Meta }[] } };
  const m = j.chart?.result?.[0]?.meta;
  return m ? readingFrom(c, m.regularMarketPrice, m.regularMarketTime, YAHOO_SOURCE) : null;
}

/** European Central Bank daily reference rates, for currencies Yahoo didn't answer. */
async function ecbRates(list: Currency[]): Promise<Reading[]> {
  const j = (await get(`${ECB}/v1/latest?base=${BASE_CURRENCY}`)) as { date?: string; rates?: Record<string, number> };
  const at = j.date && /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? new Date(`${j.date}T15:00:00Z`) : new Date();
  const out: Reading[] = [];
  for (const c of list) {
    const got = readingFrom({ ...c, direct: false }, j.rates?.[c.code], at.getTime() / 1000, ECB_SOURCE);
    if (got) out.push(got);
  }
  return out;
}

/** Reads the market now. Never throws: returns what it could read and what failed. */
export async function fetchMarket(): Promise<{ readings: Reading[]; missing: string[]; errors: string[] }> {
  const errors: string[] = [];
  const got = new Map<string, Reading>();
  const pending = () => FOREIGN_CURRENCIES.filter((c) => !got.has(c.code));
  const note = (what: string) => (e: unknown) => { errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 120)); };

  for (let n = 0; n < FOREIGN_CURRENCIES.length; n += 10) {
    await yahooBatch(FOREIGN_CURRENCIES.slice(n, n + 10)).then((rs) => rs.forEach((r) => got.set(r.currency, r)), note("yahoo batch"));
  }
  // Whatever the batch left out, one by one (a few at a time, to stay polite).
  const rest = pending();
  for (let n = 0; n < rest.length; n += 4) {
    await Promise.all(rest.slice(n, n + 4).map((c) => yahooOne(c).then((r) => { if (r) got.set(r.currency, r); }, note(`yahoo ${c.code}`))));
  }
  if (pending().length) await ecbRates(pending()).then((rs) => rs.forEach((r) => got.set(r.currency, r)), note("ecb"));
  return { readings: [...got.values()], missing: pending().map((c) => c.code), errors: errors.slice(0, 6) };
}

/** A reading more than 30 % away from a recent saved rate is a service error, not the market: it is not saved. */
export const plausible = (next: number, prev: { usdPerUnit: number; fetchedAt: Date } | null, now = new Date()) =>
  !prev || now.getTime() - prev.fetchedAt.getTime() > 30 * 864e5 || Math.abs(next - prev.usdPerUnit) / prev.usdPerUnit <= 0.3;

let lastTry = 0;
let running: Promise<{ saved: number; missing: string[]; rejected: string[]; errors: string[] }> | null = null;

/** Reads the market and saves it. Calls at the same moment share one read. */
export function refreshMarket() {
  running ??= (async () => {
    try {
      const [{ readings, missing, errors }, prev] = await Promise.all([fetchMarket(), db.fxRate.findMany()]);
      const before = new Map(prev.map((p) => [p.currency, { usdPerUnit: Number(p.usdPerUnit), fetchedAt: p.fetchedAt }]));
      const rejected: string[] = [];
      let saved = 0;
      for (const r of readings) {
        if (!plausible(r.usdPerUnit, before.get(r.currency) ?? null)) { rejected.push(r.currency); continue; }
        const data = { usdPerUnit: r.usdPerUnit, unitsPerUsd: r.unitsPerUsd, source: r.source, quotedAt: r.quotedAt, fetchedAt: new Date() };
        await db.fxRate.upsert({ where: { currency: r.currency }, create: { currency: r.currency, ...data }, update: data });
        saved++;
      }
      return { saved, missing, rejected, errors };
    } finally {
      running = null;
    }
  })();
  return running;
}

const view = (r: { currency: string; usdPerUnit: unknown; unitsPerUsd: unknown; source: string; quotedAt: Date; fetchedAt: Date }, now: Date): MarketRate => ({
  currency: r.currency, usdPerUnit: Number(r.usdPerUnit), unitsPerUsd: Number(r.unitsPerUsd), source: r.source, quotedAt: r.quotedAt, fetchedAt: r.fetchedAt,
  stale: now.getTime() - r.quotedAt.getTime() > STALE_HOURS * 3600e3,
});

/**
 * The saved market rates. `wait: true` (a person asked for the rate) refreshes first when they are older than
 * 15 minutes; `wait: false` (a page being drawn) returns what is saved and refreshes behind, so no page waits on Yahoo.
 */
export async function marketRates(o: { wait?: boolean } = {}): Promise<Map<string, MarketRate>> {
  const now = new Date();
  let rows = await db.fxRate.findMany();
  const fresh = rows.length >= FOREIGN_CURRENCIES.length && rows.every((r) => now.getTime() - r.fetchedAt.getTime() < FRESH_MINUTES * 60e3);
  // When Yahoo is down, don't knock on every page view: a person's request retries after a minute, a page after five.
  if (!fresh && now.getTime() - lastTry > (o.wait ? 60e3 : 5 * 60e3)) {
    lastTry = now.getTime();
    const job = refreshMarket().catch(() => null);
    if (o.wait) { await job; rows = await db.fxRate.findMany(); }
  }
  return new Map(rows.map((r) => [r.currency, view(r, now)]));
}

/** Market rate of one currency against the dollar, or null when it was never read (or isn't on the list). */
export async function marketRate(currency: string, o: { wait?: boolean } = { wait: true }): Promise<MarketRate | null> {
  if (!currencyOf(currency) || currency === BASE_CURRENCY) return null;
  return (await marketRates(o)).get(currency) ?? null;
}

/** "Yahoo Finance · 13 nov 2026 16:45 UTC": what is written next to a rate taken from the market. */
export function rateSourceText(r: { source: string; quotedAt: Date }): string {
  const d = r.quotedAt;
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${r.source} · ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
