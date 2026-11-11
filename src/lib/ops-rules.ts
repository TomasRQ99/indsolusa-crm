// Operaciones O0 · pure rules (module 11 §30.1, §48, §50). No database.

type Txt = { es: string; en: string };
export const EXC_KINDS: Record<string, Txt> = {
  SUPPLIER_DELAY: { es: "Demora del proveedor", en: "Supplier delay" },
  MISSING_DOCS: { es: "Faltan documentos", en: "Missing documents" },
  CUSTOMS_HOLD: { es: "Retención en aduana", en: "Customs hold" },
  DAMAGED: { es: "Empaque o producto dañado", en: "Damaged package or product" },
  WRONG_ITEM: { es: "Producto equivocado", en: "Wrong item" },
  SHORT_SHIPMENT: { es: "Llegó incompleto", en: "Short shipment" },
  DELIVERY_FAILED: { es: "Entrega fallida", en: "Failed delivery" },
  CUSTOMER_CLAIM: { es: "Garantía o reclamo del cliente", en: "Customer warranty or claim" },
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
export type OpsPolicy = { narrowDays: number; upcomingDays: number; graceDays: number; warrantyMonths: number; warrantyEndingDays: number; courierMaxKg: number; cargoOverKg: number; cargoFobUsd: number };
// Courier / cargo values as given by Importsoluciones on 2026-11-11 (courier up to 49 kg; cargo above 50 kg or FOB above USD 2,000).
export const DEFAULT_OPS_POLICY: OpsPolicy = { narrowDays: 2, upcomingDays: 14, graceDays: 1, warrantyMonths: 12, warrantyEndingDays: 60, courierMaxKg: 49, cargoOverKg: 50, cargoFobUsd: 2000 };
/** Bounds for each threshold, used by the settings screen: a value outside them is refused, never clamped silently. */
export const OPS_POLICY_BOUNDS: Record<keyof OpsPolicy, [number, number]> = { narrowDays: [0, 30], upcomingDays: [1, 90], graceDays: [0, 15], warrantyMonths: [1, 120], warrantyEndingDays: [1, 365], courierMaxKg: [1, 1000], cargoOverKg: [1, 1000], cargoFobUsd: [0, 1000000] };
export function cleanOpsPolicy(raw: Record<string, unknown>): OpsPolicy | null {
  const out = {} as OpsPolicy;
  for (const k of Object.keys(OPS_POLICY_BOUNDS) as (keyof OpsPolicy)[]) {
    const n = Number(raw[k]);
    if (!Number.isInteger(n) || n < OPS_POLICY_BOUNDS[k][0] || n > OPS_POLICY_BOUNDS[k][1]) return null;
    out[k] = n;
  }
  // The cargo weight can never start below where courier ends.
  if (out.cargoOverKg < out.courierMaxKg) return null;
  return out;
}

export type ShipClass = { cls: "COURIER" | "CARGO" | "BETWEEN" | "UNKNOWN"; reasons: Txt[] };
/** Courier or cargo (rule given by Importsoluciones, who hold the DHL account). Cargo means formal import and
 *  nationalisation. Uses the PHYSICAL weight, never the volumetric one, and the FOB value of the goods alone. */
export function shipClass(physicalKg: number | null, fobUsd: number | null, p: OpsPolicy): ShipClass {
  const reasons: Txt[] = [];
  if (physicalKg != null && physicalKg > p.cargoOverKg) reasons.push({ es: `Peso físico de ${physicalKg} kg, por encima de ${p.cargoOverKg} kg`, en: `Physical weight ${physicalKg} kg, above ${p.cargoOverKg} kg` });
  if (fobUsd != null && fobUsd > p.cargoFobUsd) reasons.push({ es: `Valor FOB de USD ${fobUsd.toFixed(2)}, por encima de USD ${p.cargoFobUsd}`, en: `FOB value USD ${fobUsd.toFixed(2)}, above USD ${p.cargoFobUsd}` });
  if (reasons.length) return { cls: "CARGO", reasons };
  // Without both facts SOLU does not guess: a missing weight or value could still make it cargo.
  if (physicalKg == null || fobUsd == null) return { cls: "UNKNOWN", reasons: [physicalKg == null ? { es: "Falta el peso físico", en: "Physical weight missing" } : { es: "Falta el valor FOB en USD", en: "FOB value in USD missing" }] };
  if (physicalKg > p.courierMaxKg) return { cls: "BETWEEN", reasons: [{ es: `Peso entre ${p.courierMaxKg} y ${p.cargoOverKg} kg: la regla no dice cuál cuenta aplica`, en: `Weight between ${p.courierMaxKg} and ${p.cargoOverKg} kg: the rule doesn't say which account applies` }] };
  return { cls: "COURIER", reasons: [{ es: `Hasta ${p.courierMaxKg} kg y FOB hasta USD ${p.cargoFobUsd}`, en: `Up to ${p.courierMaxKg} kg and FOB up to USD ${p.cargoFobUsd}` }] };
}

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
