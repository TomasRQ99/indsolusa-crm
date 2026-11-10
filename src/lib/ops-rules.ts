// Operaciones O0 · pure rules (module 11 §30.1, §48, §50). No database.

type Txt = { es: string; en: string };
export const EXC_KINDS: Record<string, Txt> = {
  SUPPLIER_DELAY: { es: "Demora del proveedor", en: "Supplier delay" },
  MISSING_DOCS: { es: "Faltan documentos", en: "Missing documents" },
  CUSTOMS_HOLD: { es: "Retención en aduana", en: "Customs hold" },
  DAMAGED: { es: "Empaque o producto dañado", en: "Damaged package or product" },
  WRONG_ITEM: { es: "Producto equivocado", en: "Wrong item" },
  SHORT_SHIPMENT: { es: "Llegó incompleto", en: "Short shipment" },
  PAYMENT_NOT_CREDITED: { es: "Pago no acreditado", en: "Payment not credited" },
  FREIGHT_VARIANCE: { es: "Diferencia en el cobro del flete", en: "Freight billing variance" },
  CREDIT_OVEREXPOSURE: { es: "Exposición sobre el cupo", en: "Credit overexposure" },
  UNEXPECTED_INVENTORY: { es: "Inventario no previsto", en: "Unexpected inventory" },
  OTHER: { es: "Otra", en: "Other" },
};
/** §48 Commercial Impact Gate: Comercial steps in only when one of these is touched. */
export const IMPACT_AREAS: Record<string, Txt> = {
  PROMISE: { es: "Promesa al cliente", en: "Customer promise" },
  SCOPE: { es: "Alcance", en: "Scope" },
  PRICE: { es: "Precio o decisión del cliente", en: "Price or customer decision" },
  COMPLIANCE: { es: "Cumplimiento / norma", en: "Compliance" },
  RELATIONSHIP: { es: "Relación con el cliente", en: "Customer relationship" },
};
export const readAreas = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!IMPACT_AREAS[x]) : []);
export const readOptions = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, 6) : []);
export const needsCommercial = (areas: unknown) => readAreas(areas).length > 0;

export const OPS_POLICY_KEY = "opsPolicy";
/** narrowDays: expected delivery this close to the promise (or closer) reads "Narrow". Editable; defaults await O-15. */
export type OpsPolicy = { narrowDays: number; upcomingDays: number };
export const DEFAULT_OPS_POLICY: OpsPolicy = { narrowDays: 2, upcomingDays: 14 };

export type PromiseHealth = "PROTECTED" | "NARROW" | "AT_RISK" | "BREACHED" | "UNKNOWN";
const DAY = 864e5;
const d0 = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * §30.1 Promise Health with its reason (never a colour alone). Customer Promise and expected delivery are separate
 * dates: the carrier's ETA informs the expectation and never replaces the promise (AC17).
 */
export function promiseHealth(promise: Date, expected: Date | null, today: Date, policy: OpsPolicy, delivered = false): { health: PromiseHealth; days: number | null; reason: Txt } {
  if (delivered) return { health: "PROTECTED", days: null, reason: { es: "Entregado", en: "Delivered" } };
  const late = Math.round((d0(today) - d0(promise)) / DAY);
  if (late > 0) return { health: "BREACHED", days: late, reason: { es: `La promesa venció hace ${late} día(s) y no hay entrega`, en: `The promise passed ${late} day(s) ago with no delivery` } };
  if (!expected) return { health: "UNKNOWN", days: null, reason: { es: "No hay una fecha esperada de entrega con qué comparar la promesa", en: "There is no expected delivery date to compare the promise with" } };
  const gap = Math.round((d0(promise) - d0(expected)) / DAY); // + = margin before the promise
  if (gap < 0) return { health: "AT_RISK", days: -gap, reason: { es: `Lo esperado llega ${-gap} día(s) después de la promesa`, en: `Expected delivery is ${-gap} day(s) after the promise` } };
  if (gap <= policy.narrowDays) return { health: "NARROW", days: gap, reason: { es: gap === 0 ? "Lo esperado llega el mismo día de la promesa" : `Solo ${gap} día(s) de holgura frente a la promesa`, en: gap === 0 ? "Expected delivery is on the promise date itself" : `Only ${gap} day(s) of slack before the promise` } };
  return { health: "PROTECTED", days: gap, reason: { es: `${gap} día(s) de holgura frente a la promesa`, en: `${gap} day(s) of slack before the promise` } };
}
