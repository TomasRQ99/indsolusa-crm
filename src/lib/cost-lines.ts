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

export const COST_LINES = [
  { k: "tax", name: "taxCost", es: "Impuestos", en: "Taxes", hintEs: "Arancel e impuestos que no se recuperan", hintEn: "Duties and taxes we don't get back" },
  { k: "customs", name: "customsCost", es: "Aduana", en: "Customs", hintEs: "Agencia de aduana y trámites", hintEn: "Customs broker and paperwork" },
  { k: "packing", name: "packingCost", es: "Empaque", en: "Packing", hintEs: "Embalaje, guacal, estiba", hintEn: "Packaging, crate, pallet" },
  { k: "wire", name: "wireCost", es: "Giro", en: "Bank wire", hintEs: "Lo que cobra el banco por enviar el dinero", hintEn: "What the bank charges to send the money" },
  { k: "misc", name: "miscCost", es: "Otros", en: "Other", hintEs: "Seguro, logística local, imprevistos", hintEn: "Insurance, local logistics, contingency" },
] as const;
