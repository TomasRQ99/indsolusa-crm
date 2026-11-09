// #3 (constitution No Debt Zone: money and currency arithmetic). Exact money math.
// JavaScript numbers can't hold 0.1 exactly, so 0.1 + 0.2 = 0.30000000000000004 and long sums drift.
// Here every amount is turned into whole cents (or smaller exact units) from its decimal text,
// added and multiplied as integers (BigInt), and rounded once, half away from zero, to cents.
// The results are plain numbers that are already exact to the cent, so the rest of SOLU keeps working.
// No dependencies: safe to use on the server and in the browser.

export type MoneyIn = number | string | { toString(): string } | null | undefined;

/** Exact integer in units of 10^-dp, from a decimal number/text/Prisma Decimal. Rounds half away from zero. */
function scaled(v: MoneyIn, dp: number): bigint {
  if (v == null) return BigInt(0);
  let s = typeof v === "string" ? v.trim() : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "0") : v.toString();
  if (!s) return BigInt(0);
  // Exponent forms (1e-7, 2.5e+21): expand through a fixed representation.
  if (/e/i.test(s)) { const n = Number(s); s = Number.isFinite(n) ? n.toFixed(Math.min(20, dp + 2)) : "0"; }
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return BigInt(0);
  const neg = m[1] === "-";
  const int = m[2] || "0";
  const frac = m[3] ?? "";
  const keep = (frac + "0".repeat(dp)).slice(0, dp);
  let out = BigInt(int + keep);
  if ((frac[dp] ?? "0") >= "5") out += BigInt(1);
  return neg ? -out : out;
}

const TEN = (n: number) => BigInt(10) ** BigInt(n);
/** Rounds an integer in 10^-from units to 10^-to units, half away from zero. */
function rescale(x: bigint, from: number, to: number): bigint {
  if (from <= to) return x * TEN(to - from);
  const d = TEN(from - to);
  const neg = x < BigInt(0);
  const a = neg ? -x : x;
  let q = a / d;
  if ((a % d) * BigInt(2) >= d) q += BigInt(1);
  return neg ? -q : q;
}
const toNum = (cents: bigint) => Number(cents) / 100;

/** Whole cents of an amount. */
export const cents = (v: MoneyIn): number => Number(scaled(v, 2));
/** An amount rounded to the cent. */
export const money2 = (v: MoneyIn): number => toNum(scaled(v, 2));
/** Exact sum, to the cent. */
export function sumMoney(values: Iterable<MoneyIn>): number {
  let t = BigInt(0);
  for (const v of values) t += scaled(v, 2);
  return toNum(t);
}
/** a − b − c …, to the cent. */
export const subMoney = (a: MoneyIn, ...rest: MoneyIn[]): number => toNum(rest.reduce<bigint>((t, v) => t - scaled(v, 2), scaled(a, 2)));
/** amount × factor (quantity, exchange rate, percentage as fraction), rounded once to the cent.
 *  Uses up to 6 decimals of the amount and 12 of the factor (enough for exchange rates and ratios). */
export const mulMoney = (amount: MoneyIn, factor: MoneyIn): number => toNum(rescale(scaled(amount, 6) * scaled(factor, 12), 18, 2));
/** Line amount: quantity × unit price (unit prices may have 4 decimals). */
export const lineAmount = (qty: MoneyIn, unitPrice: MoneyIn): number => mulMoney(unitPrice, qty);
/** Sum of qty × unit price over lines; each line is rounded to the cent first, like on an invoice. */
export const linesTotal = <L>(lines: L[], qty: (l: L) => MoneyIn, price: (l: L) => MoneyIn): number =>
  sumMoney(lines.map((l) => lineAmount(qty(l), price(l))));
/** percent (e.g. 30 for 30 %) of an amount, to the cent. */
export const percentOf = (amount: MoneyIn, percent: MoneyIn): number => toNum(rescale(scaled(amount, 6) * scaled(percent, 6), 14, 2));
/** Compare amounts to the cent: −1, 0 or 1. */
export function cmpMoney(a: MoneyIn, b: MoneyIn): -1 | 0 | 1 {
  const x = scaled(a, 2), y = scaled(b, 2);
  return x < y ? -1 : x > y ? 1 : 0;
}
export const sameMoney = (a: MoneyIn, b: MoneyIn) => cmpMoney(a, b) === 0;
/** Share of part in whole as a percentage with one decimal (for display; not used to move money). */
export const sharePct = (part: MoneyIn, whole: MoneyIn): number => {
  const w = Number(scaled(whole, 2));
  return w === 0 ? 0 : Math.round((Number(scaled(part, 2)) * 1000) / w) / 10;
};
