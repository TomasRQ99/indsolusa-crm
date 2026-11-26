import { db } from "./db";
import { TRM_SOURCE } from "./fx";

// Official TRM by day, kept in the database (table TrmDay) so a figure in dollars can be read in pesos with the rate
// of its own date (commercial budget, spec §2: keep the original currency, the rate applied, its date and source).
// The government's open-data service is asked once per missing stretch of days, never per figure.

const TRM_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json";
const DAY = 864e5;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftDay = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));

type Row = { day: string; validTo: string; rate: number };
/** The last attempt to reach the service that failed: don't retry on every page for a while. */
let failedAt = 0;
const RETRY_MS = 15 * 60e3;
/** The earliest day already asked to the service (the first rate on or after it may start a few days later). */
let askedFrom: string | null = null;

async function fetchRange(from: string, to: string): Promise<Row[] | null> {
  if (Date.now() - failedAt < RETRY_MS) return null;
  const qs = new URLSearchParams({ $where: `vigenciadesde >= '${from}T00:00:00.000' AND vigenciadesde <= '${to}T00:00:00.000'`, $order: "vigenciadesde ASC", $limit: "5000" });
  try {
    const res = await fetch(`${TRM_URL}?${qs}`, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) { failedAt = Date.now(); return null; }
    const rows = (await res.json()) as { valor?: string; vigenciadesde?: string; vigenciahasta?: string }[];
    return rows.map((r) => ({ day: String(r.vigenciadesde).slice(0, 10), validTo: String(r.vigenciahasta).slice(0, 10), rate: Number(r.valor) }))
      // Sanity bounds: a COP/USD rate outside this range means the service changed, not the market.
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && Number.isFinite(r.rate) && r.rate >= 500 && r.rate <= 20000);
  } catch {
    failedAt = Date.now();
    return null;
  }
}

export type TrmHit = { rate: number; day: string; source: string };
export type TrmLookup = (at: Date) => TrmHit | null;

/** A lookup of the TRM valid on any date between `from` and `to`. Missing days are fetched once and stored; when the
 *  service cannot be reached the lookup answers with what is stored, and null for a date before the first stored
 *  day (the figure then shows as "sin tasa" instead of being guessed). */
export async function trmLookup(from: Date, to: Date): Promise<TrmLookup> {
  const today = iso(new Date());
  const a = shiftDay(iso(from), -10), b = iso(to) > today ? today : iso(to);
  let rows: Row[] = (await db.trmDay.findMany({ orderBy: { day: "asc" }, select: { day: true, validTo: true, rate: true } })).map((r) => ({ day: r.day, validTo: r.validTo, rate: Number(r.rate) }));
  const gaps: [string, string][] = [];
  if (!rows.length) gaps.push([a, b]);
  else {
    if (rows[0].day > a && (!askedFrom || askedFrom > a)) gaps.push([a, rows[0].day]);
    const last = rows[rows.length - 1];
    // The rate of a Friday is valid through Monday: only ask again once its validity has run out.
    if (last.validTo < b) gaps.push([last.day, b]);
  }
  let added = false;
  for (const [x, y] of gaps) {
    if (x > y) continue;
    const got = await fetchRange(x, y);
    if (got && (!askedFrom || x < askedFrom)) askedFrom = x;
    if (!got?.length) continue;
    const known = new Set(rows.map((r) => r.day));
    const fresh = got.filter((r) => !known.has(r.day));
    if (fresh.length) { await db.trmDay.createMany({ data: fresh, skipDuplicates: true }); added = true; rows = rows.concat(fresh); }
  }
  if (added) rows.sort((p, q) => (p.day < q.day ? -1 : 1));
  return (at: Date) => {
    const d = iso(new Date(at.getTime() - 5 * 3600e3));
    let lo = 0, hi = rows.length - 1, hit = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].day <= d) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
    return hit < 0 ? null : { rate: rows[hit].rate, day: rows[hit].day, source: TRM_SOURCE };
  };
}
