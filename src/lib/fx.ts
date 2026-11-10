import { money2, mulMoney, type MoneyIn } from "./money";

// COP → USD for travel expenses. The rate is Colombia's official TRM (Tasa Representativa del Mercado, certified by
// the Superintendencia Financiera), read from the government's open-data service: free, no key, no scraping.
// The TRM valid on the day of the expense is used; for today or a day without a published rate, the latest one.

const TRM_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json";
export const TRM_SOURCE = "TRM oficial · Superfinanciera (datos.gov.co)";
export type Trm = { rate: number; validFrom: string; validTo: string };

const cache = new Map<string, { at: number; trm: Trm }>();
const HOUR = 3600_000;

/** Official TRM valid on `day` (YYYY-MM-DD), or the most recent published one before it. Null if unreachable. */
export async function trmFor(day: string): Promise<Trm | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const hit = cache.get(day);
  if (hit && Date.now() - hit.at < HOUR) return hit.trm;
  const qs = new URLSearchParams({ $where: `vigenciadesde <= '${day}T00:00:00.000'`, $order: "vigenciadesde DESC", $limit: "1" });
  try {
    const res = await fetch(`${TRM_URL}?${qs}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    const rows = (await res.json()) as { valor?: string; vigenciadesde?: string; vigenciahasta?: string }[];
    const r = rows[0];
    const rate = Number(r?.valor);
    // Sanity bounds: a COP/USD rate outside this range means the service changed, not the market.
    if (!r || !Number.isFinite(rate) || rate < 500 || rate > 20000) return null;
    const trm = { rate, validFrom: String(r.vigenciadesde).slice(0, 10), validTo: String(r.vigenciahasta).slice(0, 10) };
    cache.set(day, { at: Date.now(), trm });
    return trm;
  } catch {
    return null;
  }
}

/** USD value of a COP amount at `rate` COP per USD, to the cent. */
export const copToUsd = (cop: MoneyIn, rate: number): number => mulMoney(cop, 1 / rate);
/** The rate implied by what was actually charged (COP per USD, 2 decimals). */
export const impliedRate = (cop: MoneyIn, usd: MoneyIn): number => Math.round((money2(cop) / money2(usd)) * 100) / 100;
