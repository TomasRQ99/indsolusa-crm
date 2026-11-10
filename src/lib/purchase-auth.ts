// Operaciones O2 · Purchase authorization rules (module 11 §7–11). Pure: no database.
// "La existencia de una venta autoriza el propósito de la compra; el nivel de autoridad determina quién puede
// comprometer los recursos." Nothing here is fixed in code: roles, the limit and the triggers come from a versioned
// policy that Gerencia edits (decisions 2026-11-10).

type Txt = { es: string; en: string };
export const PURCHASE_POLICY_KEY = "purchasePolicy";
export const REASONS = ["STOCK", "COST_ABOVE_PROTECTED", "OVER_CREDIT", "NEW_SUPPLIER", "FULL_ADVANCE"] as const;
export type Reason = (typeof REASONS)[number];
export const REASON_TEXT: Record<Reason, Txt> = {
  STOCK: { es: "Quedan unidades para inventario", en: "Units would remain as inventory" },
  COST_ABOVE_PROTECTED: { es: "El costo supera el costo protegido de la cotización", en: "The cost is above the quote's protected cost" },
  OVER_CREDIT: { es: "El cliente supera su cupo de crédito", en: "The customer is over its credit limit" },
  NEW_SUPPLIER: { es: "Proveedor nuevo, sin compras recibidas", en: "New supplier, no purchases received yet" },
  FULL_ADVANCE: { es: "Anticipo del 100 % por encima del límite", en: "100 % advance above the limit" },
};
export type PurchasePolicy = { level1Roles: string[]; level2Roles: string[]; level1LimitUsd: number; relatedDays: number; triggers: Record<Reason, boolean> };
/** Decided 2026-11-10: Finanzas or Administración up to the limit, Gerencia above; approval only when something is off. */
export const DEFAULT_PURCHASE_POLICY: PurchasePolicy = {
  level1Roles: ["FINANZAS", "ADMINISTRACION"], level2Roles: ["GERENCIA"], level1LimitUsd: 25000, relatedDays: 30,
  triggers: { STOCK: true, COST_ABOVE_PROTECTED: true, OVER_CREDIT: true, NEW_SUPPLIER: true, FULL_ADVANCE: true },
};
export const cleanPolicy = (v: Partial<PurchasePolicy> | null | undefined): PurchasePolicy => ({
  ...DEFAULT_PURCHASE_POLICY, ...(v ?? {}),
  triggers: { ...DEFAULT_PURCHASE_POLICY.triggers, ...(v?.triggers ?? {}) },
});

export type AuthFacts = { amount: number; relatedTotal: number; stockQty: number; stockAmount: number; costOver: number; overCredit: boolean; newSupplier: boolean; fullAdvance: boolean };
/** Why this purchase is not routine (empty = it goes ahead without approval). */
export function reasonsOf(f: AuthFacts, p: PurchasePolicy): Reason[] {
  const out: Reason[] = [];
  if (p.triggers.STOCK && f.stockQty > 0) out.push("STOCK");
  if (p.triggers.COST_ABOVE_PROTECTED && f.costOver > 0.005) out.push("COST_ABOVE_PROTECTED");
  if (p.triggers.OVER_CREDIT && f.overCredit) out.push("OVER_CREDIT");
  if (p.triggers.NEW_SUPPLIER && f.newSupplier) out.push("NEW_SUPPLIER");
  // Anti-fragmentation (AC3): the limit is read against the related commitment, not this purchase alone.
  if (p.triggers.FULL_ADVANCE && f.fullAdvance && f.relatedTotal > p.level1LimitUsd) out.push("FULL_ADVANCE");
  return out;
}
/** Level by the Related Commitment Total, so splitting a purchase doesn't lower the authority needed. */
export const levelOf = (relatedTotal: number, p: PurchasePolicy): 1 | 2 => (relatedTotal > p.level1LimitUsd ? 2 : 1);

/** Level-2 roles can always decide; level-1 roles only level-1 requests. Never the person who asked. */
export function canApprovePurchase(u: { id: string; role: string }, a: { requestedById: string; level: number }, p: PurchasePolicy) {
  if (u.id === a.requestedById) return false;
  return p.level2Roles.includes(u.role) || (a.level === 1 && p.level1Roles.includes(u.role));
}

/** Does an earlier approval still cover what is in front of us? More money, more stock or a new reason needs a new one. */
export function covers(a: { status: string; reasons: unknown; amount: unknown; stockQty: number; stockAmount: unknown } | null, reasons: Reason[], f: AuthFacts) {
  if (!a || a.status !== "APPROVED") return false;
  const had = Array.isArray(a.reasons) ? (a.reasons as string[]) : [];
  return reasons.every((r) => had.includes(r)) && Number(a.amount) + 0.005 >= f.amount && a.stockQty >= f.stockQty && Number(a.stockAmount) + 0.005 >= f.stockAmount;
}
