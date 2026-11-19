import { money2, subMoney, sumMoney, type MoneyIn } from "./money";

// Cost settlement of a quote ("liquidación de costos"), in the order the team works:
// producto · envío · impuestos · aduana · empaque · giro · otros · crédito a favor.
// Pure: safe on the server and in the browser. Everything here is USD.
//
// The quote keeps three totals every other screen reads (supplierCost, freightCost, otherCosts).
// The detail lives inside otherCosts: otherCosts = tax + customs + packing + wire + misc − credit.
// "misc" is not stored: it is whatever part of otherCosts has no detail (older quotes, sample data).

export type CostDetailIn = { otherCosts: MoneyIn; taxCost?: MoneyIn; customsCost?: MoneyIn; packingCost?: MoneyIn; wireCost?: MoneyIn; creditAmount?: MoneyIn };

export function costDetail(q: CostDetailIn) {
  const tax = money2(q.taxCost), customs = money2(q.customsCost), packing = money2(q.packingCost), wire = money2(q.wireCost), credit = money2(q.creditAmount);
  const misc = subMoney(sumMoney([q.otherCosts, credit]), tax, customs, packing, wire);
  return { tax, customs, packing, wire, misc, credit };
}

/** The otherCosts total from its parts (can be negative when the credit is bigger than the other costs). */
export function otherTotal(p: { tax: MoneyIn; customs: MoneyIn; packing: MoneyIn; wire: MoneyIn; misc: MoneyIn; credit: MoneyIn }) {
  return subMoney(sumMoney([p.tax, p.customs, p.packing, p.wire, p.misc]), p.credit);
}

// ---------- Eságara decides the price (owner, 2026-11-19) ----------
// The person types the Eságara they want (a % of the sale) and the price comes out of the costs:
// price = total cost ÷ (1 − Eságara %). Cost 355 at 30 % → 507.14, of which 152.14 is Eságara.

/** Above this the price runs away (99 % = one hundred times the cost): treated as a typing mistake. */
export const ESAGARA_MAX_PCT = 95;

/** Sale price that leaves `pct` % of Eságara over `cost`. Null when it cannot be calculated. */
export function priceForEsagara(cost: MoneyIn, pct: number | null | undefined): number | null {
  const c = money2(cost);
  if (pct == null || !Number.isFinite(pct) || pct < 0 || pct > ESAGARA_MAX_PCT || c <= 0) return null;
  return money2((c / (1 - pct / 100)).toFixed(6));
}

/** Eságara % (two decimals) that a sale leaves over a cost. Null without a sale. */
export function esagaraPctOf(sale: MoneyIn, cost: MoneyIn): number | null {
  const s = money2(sale);
  return s > 0 ? Math.round((subMoney(s, cost) / s) * 10000) / 100 : null;
}

/** New unit prices so the lines add up to `target`: same proportion as today's prices; with no prices yet, the same
 *  price per unit. Unit prices are rounded to the cent, so the total can be off by a few cents. */
export function repriceLines(lines: { qty: number; unitPrice: MoneyIn }[], target: number): number[] {
  const cur = sumMoney(lines.map((l) => money2((Number(String(l.unitPrice ?? 0)) * l.qty).toFixed(6))));
  const units = lines.reduce((a, l) => a + Math.max(0, l.qty), 0);
  if (cur > 0) return lines.map((l) => money2(((Number(String(l.unitPrice ?? 0)) * target) / cur).toFixed(6)));
  return lines.map(() => (units > 0 ? money2((target / units).toFixed(6)) : 0));
}

/** What the customer's price covers, for the printed quote: named, never with amounts (our costs and the Eságara
 *  are not shown to the customer). A concept is named only when the settlement has a cost for it. */
export function priceIncludes(q: { freightCost?: MoneyIn; taxCost?: MoneyIn; customsCost?: MoneyIn; packingCost?: MoneyIn }, lang: "ES" | "EN"): string {
  const es = lang === "ES";
  const parts = [
    es ? "producto" : "product",
    money2(q.freightCost) > 0 ? (es ? "envío hasta destino" : "shipping to destination") : null,
    money2(q.taxCost) > 0 ? (es ? "arancel e impuestos de importación" : "import duties and taxes") : null,
    money2(q.customsCost) > 0 ? (es ? "trámite de aduana" : "customs clearance") : null,
    money2(q.packingCost) > 0 ? (es ? "empaque" : "packing") : null,
  ].filter(Boolean).join(", ");
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

export const COST_LINES = [
  { k: "tax", name: "taxCost", es: "Impuestos", en: "Taxes", hintEs: "Arancel e impuestos que no se recuperan", hintEn: "Duties and taxes we don't get back" },
  { k: "customs", name: "customsCost", es: "Aduana", en: "Customs", hintEs: "Agencia de aduana y trámites", hintEn: "Customs broker and paperwork" },
  { k: "packing", name: "packingCost", es: "Empaque", en: "Packing", hintEs: "Embalaje, guacal, estiba", hintEn: "Packaging, crate, pallet" },
  { k: "wire", name: "wireCost", es: "Giro", en: "Bank wire", hintEs: "Lo que cobra el banco por enviar el dinero", hintEn: "What the bank charges to send the money" },
  { k: "misc", name: "miscCost", es: "Otros", en: "Other", hintEs: "Seguro, logística local, imprevistos", hintEn: "Insurance, local logistics, contingency" },
] as const;
