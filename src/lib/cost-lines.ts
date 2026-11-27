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

// ---------- One row per product (owner, 2026-11-27) ----------
// "Producto" on the sheet is no longer one total: each product has its row (quantity × what the supplier charges per
// unit, in the supplier's currency). The total the rest of SOLU reads (supplierCost) is the sum of the rows, and the
// sale price of each product comes from its own cost, so quote and purchase order carry each value apart.

export type ProductRow = { id: string | null; qty: number; code: string | null; description: string; unitCost: number | null };

/** The product rows of a submitted sheet, in the order typed. Null when the form has no product rows.
 *  A row left completely empty is not a product. */
export function productRows(fd: FormData): ProductRow[] | null {
  if (!fd.has("pi_rows")) return null;
  const col = (k: string) => fd.getAll(k).map((v) => String(v ?? "").trim());
  const ids = col("pi_id"), qtys = col("pi_qty"), codes = col("pi_code"), descs = col("pi_desc"), costs = col("pi_cost");
  const out: ProductRow[] = [];
  for (let n = 0; n < descs.length; n++) {
    const rawCost = (costs[n] ?? "").replace(",", ".");
    const c = rawCost === "" ? null : Number(rawCost);
    const unitCost = c != null && Number.isFinite(c) && c >= 0 ? money2(c) : null;
    const code = (codes[n] ?? "").slice(0, 60) || null, description = (descs[n] ?? "").slice(0, 300);
    const id = ids[n] || null;
    if (!id && !description && !code && !(unitCost != null && unitCost > 0)) continue;
    const q = Math.round(Number(qtys[n]));
    out.push({ id, qty: Number.isFinite(q) && q >= 1 ? Math.min(q, 1e6) : 1, code, description: description || code || "—", unitCost });
  }
  return out;
}

/** What the supplier charges for all the rows: Σ quantity × unit cost (rows without a cost add nothing). */
export function productsCost(rows: { qty: number; unitCost: MoneyIn | null }[]): number {
  return sumMoney(rows.map((r) => (r.unitCost == null ? 0 : money2((Number(String(r.unitCost)) * r.qty).toFixed(6)))));
}

/** Unit costs to show on the sheet. Products saved before the rows existed only have a total: it is spread over
 *  them (in proportion to their prices; by units when there are none), rounded up so the total never goes down
 *  by itself, and `seeded` says so on screen. */
export function seedUnitCosts(lines: { qty: number; unitPrice: MoneyIn; unitCost: MoneyIn | null }[], total: MoneyIn): { costs: (number | null)[]; seeded: boolean } {
  const tot = money2(total);
  if (lines.some((l) => l.unitCost != null) || !(tot > 0) || lines.length === 0) return { costs: lines.map((l) => (l.unitCost == null ? null : money2(l.unitCost))), seeded: false };
  const sale = lines.reduce((a, l) => a + Number(String(l.unitPrice ?? 0)) * l.qty, 0);
  const units = lines.reduce((a, l) => a + Math.max(0, l.qty), 0);
  const costs = lines.map((l) => {
    const share = sale > 0 ? (Number(String(l.unitPrice ?? 0)) * l.qty) / sale : units > 0 ? l.qty / units : 0;
    return l.qty > 0 ? Math.ceil(((tot * share) / l.qty) * 100 - 1e-6) / 100 : 0;
  });
  return { costs, seeded: true };
}

/** True when every product has its own cost: then each price comes from its cost. */
export function allCosted(lines: { unitCost: MoneyIn | null }[]): boolean {
  return lines.length > 0 && lines.every((l) => l.unitCost != null && money2(l.unitCost) > 0);
}

/** New unit prices so the lines add up to `target`. With a cost on every product, each one takes the same Eságara
 *  over its own cost (price = its cost × target ÷ cost of all products), so the shared costs (shipping, duties…)
 *  are carried in proportion to what each product costs. Without that, the older rule (repriceLines). */
export function repriceByCost(lines: { qty: number; unitPrice: MoneyIn; unitCost: MoneyIn | null }[], target: number): number[] {
  if (!allCosted(lines)) return repriceLines(lines, target);
  const base = lines.reduce((a, l) => a + Number(String(l.unitCost)) * l.qty, 0);
  return lines.map((l) => money2(((Number(String(l.unitCost)) * target) / base).toFixed(6)));
}
