// Módulo 12 · the profitability numbers a person can propose to change, and Gerencia approves (§33). Pure: no database.

type Txt = { es: string; en: string };
export type Numbers = { ratePct: number; newClientBonus: number; salePercent: number; commercialPct: number; proportional: boolean; financeAnnualPct: number | null };
export const NUMBER_LABELS: Record<keyof Numbers, Txt> = {
  ratePct: { es: "Comisión: % de la Eságara", en: "Commission: % of Eságara" },
  newClientBonus: { es: "Bono por cliente nuevo (puntos)", en: "New-customer bonus (points)" },
  salePercent: { es: "% de la comisión que se paga al facturar", en: "% of the commission paid at invoicing" },
  commercialPct: { es: "% del fondo para Comercial (el resto es Operativo)", en: "% of the fund for Commercial (the rest is Operational)" },
  proportional: { es: "El recaudo se gana en proporción a lo cobrado", en: "Collection half earned in proportion to what is collected" },
  financeAnnualPct: { es: "Costo del dinero: % anual", en: "Cost of money: % a year" },
};
const BOUNDS: Record<string, [number, number]> = { ratePct: [0, 100], newClientBonus: [0, 20], salePercent: [0, 100], commercialPct: [0, 100], financeAnnualPct: [0, 100] };
const n = (v: unknown) => { const s = String(v ?? "").trim().replace(",", "."); const x = Number(s); return s && Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };

/** Reads the form. Any value missing or outside its range refuses the whole proposal: nothing is adjusted silently. */
export function cleanNumbers(raw: Record<string, unknown>): Numbers | null {
  const out: Record<string, number> = {};
  for (const k of Object.keys(BOUNDS)) {
    const v = n(raw[k]);
    if (v == null || v < BOUNDS[k][0] || v > BOUNDS[k][1]) return null;
    out[k] = v;
  }
  if (!Number.isInteger(out.salePercent) || !Number.isInteger(out.commercialPct)) return null;
  return { ratePct: out.ratePct, newClientBonus: out.newClientBonus, salePercent: out.salePercent, commercialPct: out.commercialPct, proportional: raw.proportional === "1" || raw.proportional === true, financeAnnualPct: out.financeAnnualPct > 0 ? out.financeAnnualPct : null };
}
export type Change = { key: keyof Numbers; from: string; to: string };
const show = (k: keyof Numbers, v: Numbers[keyof Numbers]) => (k === "proportional" ? (v ? "sí" : "no") : v == null ? "—" : String(v));
export function diffNumbers(cur: Numbers, next: Numbers): Change[] {
  return (Object.keys(NUMBER_LABELS) as (keyof Numbers)[]).filter((k) => cur[k] !== next[k]).map((k) => ({ key: k, from: show(k, cur[k]), to: show(k, next[k]) }));
}
/** Which stored policies an approved change touches. */
export const touches = (changes: Change[]) => ({ commission: changes.some((c) => c.key !== "financeAnnualPct"), finance: changes.some((c) => c.key === "financeAnnualPct") });
/** The flat rate the simple screen shows; null when the policy in force uses several tiers. */
export function flatRate(tiers: { min: number; rate: number }[]): number | null {
  const paying = tiers.filter((t) => t.rate > 0);
  return tiers.length === 0 ? 0 : paying.length === 1 && tiers.every((t) => t.rate === 0 || t === paying[0]) ? paying[0].rate : paying.length === 0 ? 0 : null;
}
