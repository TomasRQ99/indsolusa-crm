// Operaciones O4b · supplier commitments (module 11 §22–24). Pure: no database.
// "Una fecha informada por proveedor no es un hecho ocurrido." Reported, committed and occurred are kept apart, the
// milestones depend on the kind of order, and a healthy wait creates no follow-up work before its date (AC14).

type Txt = { es: string; en: string };
export const ORDER_KINDS: Record<string, Txt> = {
  STOCK: { es: "Producto en stock", en: "Stock item" },
  MANUFACTURED: { es: "Se fabrica", en: "Manufactured item" },
  SERVICE: { es: "Servicio", en: "Service" },
  REPAIR: { es: "Reparación", en: "Repair" },
};
const M = (key: string, es: string, en: string) => ({ key, es, en });
/** §23: no single flow for everything. */
export const MILESTONES: Record<string, { key: string; es: string; en: string }[]> = {
  STOCK: [M("PO_CONFIRMED", "Orden confirmada", "PO confirmed"), M("PAYMENT_RECEIVED", "Pago recibido por el proveedor", "Payment received by supplier"), M("READY", "Listo para recoger", "Ready"), M("PICKUP", "Recogido", "Picked up"), M("SHIPPED", "Despachado", "Shipped")],
  MANUFACTURED: [M("DRAWING_APPROVAL", "Aprobación de planos", "Drawing approval"), M("MATERIAL", "Material disponible", "Material"), M("PRODUCTION", "En producción", "Production"), M("TESTING", "Pruebas / FAT", "Testing / FAT"), M("PACKING", "Empaque", "Packing"), M("READY", "Listo para recoger", "Ready"), M("SHIPPING", "Despacho", "Shipping")],
  SERVICE: [M("KICKOFF", "Inicio", "Kickoff"), M("MILESTONE", "Hito", "Milestone"), M("DELIVERABLE", "Entregable", "Deliverable"), M("ACCEPTANCE", "Aceptación", "Acceptance")],
  REPAIR: [M("ITEM_RECEIVED", "Equipo recibido por el taller", "Item received"), M("DIAGNOSIS", "Diagnóstico", "Diagnosis"), M("QUOTE", "Cotización de la reparación", "Quote"), M("APPROVAL", "Aprobación", "Approval"), M("REPAIR", "Reparación", "Repair"), M("TESTING", "Pruebas", "Testing"), M("RETURN", "Devolución", "Return")],
};
export const COMMIT_STATUS: Record<string, Txt> = {
  PENDING: { es: "Sin dato del proveedor", en: "Nothing from the supplier yet" },
  REPORTED: { es: "Informado por el proveedor", en: "Reported by the supplier" },
  COMMITTED: { es: "Comprometido por el proveedor", en: "Committed by the supplier" },
  OCCURRED: { es: "Ocurrió", en: "Occurred" },
};

export type Reading = "DONE" | "WAITING" | "DUE" | "MISSED" | "NO_DATE";
const d0 = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
/**
 * §24 Waiting With Control. Before the date: a healthy wait, nothing to do. On the date (and through the grace
 * days): due, look for the evidence. After that without evidence: missed, it needs attention.
 */
export function commitmentReading(c: { status: string; expectedDate: Date | null }, today: Date, graceDays: number): { reading: Reading; days: number | null; text: Txt } {
  if (c.status === "OCCURRED") return { reading: "DONE", days: null, text: { es: "Ocurrió", en: "Occurred" } };
  if (!c.expectedDate) return { reading: "NO_DATE", days: null, text: { es: "Sin fecha esperada", en: "No expected date" } };
  const diff = Math.round((d0(c.expectedDate) - d0(today)) / 864e5);
  if (diff > 0) return { reading: "WAITING", days: diff, text: { es: `Espera sana: faltan ${diff} día(s). Nada que hacer hasta entonces.`, en: `Healthy wait: ${diff} day(s) to go. Nothing to do until then.` } };
  if (-diff <= graceDays) return { reading: "DUE", days: -diff, text: { es: diff === 0 ? "Es hoy: confirma con evidencia si ocurrió." : `Venció hace ${-diff} día(s): confirma con evidencia si ocurrió.`, en: diff === 0 ? "It's today: confirm with evidence whether it happened." : `Due ${-diff} day(s) ago: confirm with evidence whether it happened.` } };
  return { reading: "MISSED", days: -diff, text: { es: `Sin evidencia ${-diff} día(s) después de la fecha: necesita atención.`, en: `No evidence ${-diff} day(s) after the date: it needs attention.` } };
}
/** Default grace before a missed date surfaces (awaits O-15; editable later). */
export const DEFAULT_GRACE_DAYS = 1;
