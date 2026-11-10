import { lineAmount, money2, mulMoney, percentOf, sumMoney, type MoneyIn } from "./money";

// What the customer sees on a quote (decisions C-20, C-21). SOLU keeps prices, costs and Eságara in USD before IVA.
// A document can be shown in COP at a rate fixed for that document, and IVA is always a separate line, added last.
// Pure: no database.

export type DocCurrency = "USD" | "COP";
export type SellerSnap = { key: string; legalName: string; taxIdLabel: string | null; taxId: string | null; addressLines: string | null; phone: string | null };
export type DocMoney = {
  currency: DocCurrency;
  fxRate: number | null;
  lines: { unit: number; total: number }[];
  subtotal: number;
  ivaPct: number;
  ivaExempt: boolean;
  iva: number;
  total: number;
  /** USD value of the subtotal (what Eságara is measured against). */
  usdSubtotal: number;
};

/** Whole pesos for COP, cents for USD. */
export const roundDoc = (v: number, c: DocCurrency) => (c === "COP" ? Math.round(v) : money2(v));

/** The IVA % that applies: the seller's rate unless this quote is exempt. */
export const effectiveIvaPct = (sellerIvaPct: MoneyIn, exempt: boolean) => (exempt ? 0 : Number(sellerIvaPct ?? 0) || 0);

export function docMoneyOf(lines: { qty: number; unitPrice: MoneyIn }[], opts: { currency: string; fxRate: MoneyIn; ivaPct: MoneyIn; ivaExempt: boolean }): DocMoney {
  const rate = Number(opts.fxRate ?? 0);
  const cop = opts.currency === "COP" && rate > 0;
  const currency: DocCurrency = cop ? "COP" : "USD";
  // COP: each unit price is converted and rounded to whole pesos first, so qty × unit always equals the line total.
  const view = lines.map((l) => {
    const unit = cop ? Math.round(mulMoney(l.unitPrice, rate)) : money2(l.unitPrice);
    return { unit, total: cop ? unit * l.qty : lineAmount(l.qty, l.unitPrice) };
  });
  const subtotal = roundDoc(sumMoney(view.map((v) => v.total)), currency);
  const ivaPct = effectiveIvaPct(opts.ivaPct, opts.ivaExempt);
  const iva = roundDoc(percentOf(subtotal, ivaPct), currency);
  return { currency, fxRate: cop ? rate : null, lines: view, subtotal, ivaPct, ivaExempt: opts.ivaExempt, iva, total: roundDoc(subtotal + iva, currency), usdSubtotal: sumMoney(lines.map((l) => lineAmount(l.qty, l.unitPrice))) };
}

/** Why a quote can't be presented yet from the seller / currency side (empty = fine). */
export function docBlockers(q: { currency: string; docFxRate: MoneyIn; ivaExempt: boolean; ivaExemptReason: string | null }, seller: { active: boolean; allowsCop: boolean; missing: string[] }) {
  const out: ("SELLER_INACTIVE" | "SELLER_INCOMPLETE" | "COP_NOT_ALLOWED" | "NO_RATE" | "EXEMPT_NO_REASON")[] = [];
  if (!seller.active) out.push("SELLER_INACTIVE");
  if (seller.missing.length) out.push("SELLER_INCOMPLETE");
  if (q.currency === "COP" && !seller.allowsCop) out.push("COP_NOT_ALLOWED");
  if (q.currency === "COP" && !(Number(q.docFxRate ?? 0) > 0)) out.push("NO_RATE");
  if (q.ivaExempt && !q.ivaExemptReason?.trim()) out.push("EXEMPT_NO_REASON");
  return out;
}

export const RATE_MIN = 500;
export const RATE_MAX = 20000;
