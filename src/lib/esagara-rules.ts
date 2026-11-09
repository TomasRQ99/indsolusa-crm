// Comercial C2 · Eságara Protection Gate (module 10 v1.1 §43–49). Pure rules, no database.
// The gate doesn't forbid selling: below the threshold the company decides consciously, with a reason and an approver.

type L = { es: string; en: string };

export type ComPolicy = {
  /** v1.1 §44: strictly below this % of net sale needs an approved exception. Initial value frozen by the spec: 20.00. */
  minEsagaraPct: number;
  /** "No loops for cents" (§44): an approval still covers the quote if its Eságara % drops less than this many points… */
  reapproveDropPts: number;
  /** …and the net sale moves less than this % from what the approver saw. */
  reapproveAmountPct: number;
};
export const DEFAULT_COM_POLICY: ComPolicy = { minEsagaraPct: 20, reapproveDropPts: 1, reapproveAmountPct: 5 };

/** v1.1 §46 — categories, not automatic justifications. OTHER needs its own explanation. */
export const REASONS: Record<string, L & { hint: L }> = {
  WIN_STRATEGIC_ACCOUNT: { es: "Entrar o profundizar una cuenta estratégica", en: "Enter or deepen a strategic account", hint: { es: "¿Qué cuenta, y qué esperamos construir con ella?", en: "Which account, and what do we expect to build with it?" } },
  WIN_SPECIFIC_DEAL: { es: "Ganar este negocio en concreto", en: "Win this specific deal", hint: { es: "¿Por qué este negocio vale la pena aunque deje menos?", en: "Why is this deal worth it even if it leaves less?" } },
  COMPETITIVE_RESPONSE: { es: "Respuesta a una condición competitiva documentada", en: "Response to a documented competitive condition", hint: { es: "¿Qué evidencia tenemos de la condición competitiva?", en: "What evidence do we have of the competitive condition?" } },
  ACCOUNT_RECOVERY: { es: "Recuperar la relación o el cliente", en: "Recover the relationship or the customer", hint: { es: "¿Qué pasó y cómo ayuda este precio a recuperarla?", en: "What happened and how does this price help recover it?" } },
  VOLUME_OR_FUTURE_VALUE: { es: "Volumen o valor futuro verificable", en: "Verifiable volume or future value", hint: { es: "¿Qué evidencia hay del valor futuro? Una promesa vaga no es un hecho.", en: "What evidence is there of the future value? A vague promise isn't a fact." } },
  INVENTORY_EXIT: { es: "Liberar inventario u obsolescencia", en: "Clear inventory or obsolescence", hint: { es: "¿Qué inventario y qué cuesta mantenerlo?", en: "Which inventory and what does keeping it cost?" } },
  SUPPLIER_SPECIAL_CONDITION: { es: "Condición especial temporal del proveedor", en: "Temporary special supplier condition", hint: { es: "¿Qué condición y hasta cuándo?", en: "Which condition and until when?" } },
  CUSTOMER_VALUE_TRADEOFF: { es: "Trasladar parte del valor al cliente a propósito", en: "Deliberately pass part of the value to the customer", hint: { es: "¿Qué ganamos a cambio?", en: "What do we gain in return?" } },
  OTHER: { es: "Otra razón", en: "Other reason", hint: { es: "Explica la razón empresarial con tus palabras.", en: "Explain the business reason in your own words." } },
};
export const SCOPES: Record<string, L> = {
  ONE_TIME: { es: "Solo esta vez", en: "This time only" },
  STRATEGIC: { es: "Precio estratégico por un periodo", en: "Strategic price for a period" },
  RECURRING: { es: "Precio recurrente para este cliente", en: "Recurring price for this customer" },
};

/** Two decimals, the way the policy reads it: 19.99 triggers, 20.00 doesn't (v1.1 AC 6–7). */
export const pct2 = (v: number) => Math.round(v * 100) / 100;

export type Gate = { sale: number; esagara: number; pct: number | null; threshold: number; triggered: boolean; sacrificed: number };

/** ESAGARA_PERCENT_PROJECTED = (net sale − eligible direct costs) / net sale × 100 (§43). */
export function gateOf(sale: number, cost: number, p: ComPolicy): Gate {
  const esagara = Math.round((sale - cost) * 100) / 100;
  const pct = sale > 0 ? pct2((esagara / sale) * 100) : null;
  const triggered = pct != null && pct < p.minEsagaraPct;
  // Eságara given up compared with selling right at the threshold.
  const sacrificed = triggered ? Math.round((sale * p.minEsagaraPct / 100 - esagara) * 100) / 100 : 0;
  return { sale, esagara, pct, threshold: p.minEsagaraPct, triggered, sacrificed };
}

export type ApprovedException = { status: string; saleAmount: number; esagaraPct: number };

/** An approval keeps covering the same quote version while the change stays inside the policy tolerance (§44). */
export function exceptionCovers(e: ApprovedException | null | undefined, current: { sale: number; pct: number | null }, p: ComPolicy) {
  if (!e || e.status !== "APPROVED" || current.pct == null) return false;
  const dropOk = current.pct >= pct2(e.esagaraPct - p.reapproveDropPts);
  const saleOk = e.saleAmount > 0 && (Math.abs(current.sale - e.saleAmount) / e.saleAmount) * 100 <= p.reapproveAmountPct;
  return dropOk && saleOk;
}

/** The floor that applies to this quote version: the policy threshold, or the approved level minus the tolerance. */
export function effectiveFloor(p: ComPolicy, e: ApprovedException | null | undefined) {
  return e && e.status === "APPROVED" ? Math.min(p.minEsagaraPct, pct2(e.esagaraPct - p.reapproveDropPts)) : p.minEsagaraPct;
}

/** v1.1 §45/§46: what a request needs before an approver sees it. "I don't want to lose the deal" alone isn't enough. */
export function requestProblems(r: { reasonCode: string; narrative: string; expectedBenefit: string; scope: string }) {
  const out: string[] = [];
  if (!(r.reasonCode in REASONS)) out.push("razon");
  if (r.narrative.trim().length < 20) out.push("narrativa");
  if (r.expectedBenefit.trim().length < 10) out.push("beneficio");
  if (!(r.scope in SCOPES)) out.push("alcance");
  if (/^(no quiero perder|para no perder|para ganar(lo)?|el cliente lo pide)[^.]{0,40}\.?$/i.test(r.narrative.trim())) out.push("vaga");
  return out;
}

/** v1.1 §49: a known cost can go down only with a reason (it's audited either way). */
export function costDrops(before: { supplierCost: number; freightCost: number; otherCosts: number }, after: { supplierCost: number; freightCost: number; otherCosts: number }) {
  return (["supplierCost", "freightCost", "otherCosts"] as const).filter((k) => before[k] > 0 && after[k] < before[k]);
}
