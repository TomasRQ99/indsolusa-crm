// Operaciones O8 · dispatch and delivery (module 11 §38–40, v1.2 §44). Pure: no database.
// Dispatched, Delivered and Invoice Ready are three different facts and are never collapsed.

type Txt = { es: string; en: string };
export const RESOURCES: Record<string, Txt> = {
  MESSENGER: { es: "Mensajero o personal propio", en: "Own messenger or staff" }, VEHICLE: { es: "Vehículo propio", en: "Own vehicle" },
  NATIONAL_CARRIER: { es: "Transportadora nacional", en: "National carrier" }, CARRIER_GATEWAY: { es: "Transportador conectado (DHL)", en: "Connected carrier (DHL)" },
  CUSTOMER_PICKUP: { es: "El cliente recoge", en: "Customer pickup" }, DIRECT_SHIP: { es: "Envío directo del proveedor", en: "Direct ship from supplier" },
};
export const PHASES: Record<string, Txt> = {
  BEFORE_DISPATCH: { es: "Antes de despachar", en: "Before dispatch" }, AT_DELIVERY: { es: "Al entregar", en: "At delivery" },
  AFTER_DELIVERY: { es: "Después de entregar", en: "After delivery" }, BEFORE_INVOICE: { es: "Antes de facturar", en: "Before invoicing" },
};
export const ENTRY_KINDS: Record<string, Txt> = {
  MIGO: { es: "MIGO (SAP)", en: "MIGO (SAP)" }, GR: { es: "Entrada de mercancía (GR)", en: "Goods receipt (GR)" }, ENTRY: { es: "Número de entrada", en: "Entry number" },
  WAREHOUSE: { es: "Recibo de almacén", en: "Warehouse receipt" }, CUSTOM: { es: "Otra referencia del cliente", en: "Other customer reference" },
};
export const BILLING_BASIS: Record<string, Txt> = {
  UPON_ORDER: { es: "Al recibir la orden", en: "Upon order" }, UPON_DELIVERY: { es: "Al entregar", en: "Upon delivery" }, UPON_ACCEPTANCE: { es: "Cuando el cliente acepta", en: "Upon acceptance" },
  MILESTONE: { es: "Por hitos", en: "Milestone billing" }, ADVANCE_BALANCE: { es: "Anticipo y saldo", en: "Advance + balance" }, RECURRING: { es: "Recurrente", en: "Recurring" },
};
export const FAIL_CAUSES: Record<string, Txt> = {
  CUSTOMER: { es: "Del cliente (no recibió, cita, acceso)", en: "Customer (not receiving, appointment, access)" }, COMPANY: { es: "Nuestra", en: "Ours" },
  CARRIER: { es: "Del transportador", en: "Carrier" }, OTHER: { es: "Otra", en: "Other" },
};
export const EVIDENCE_KINDS: Record<string, Txt> = {
  SIGNED_REMISSION: { es: "Remisión firmada", en: "Signed delivery note" }, POD: { es: "Prueba de entrega", en: "Proof of delivery" }, PHOTO: { es: "Foto", en: "Photo" }, PORTAL: { es: "Evidencia de portal", en: "Portal evidence" },
};
export const MAX_DELIVERY_EVIDENCE = 8;

export type Line = { dealItemId: string; code: string | null; description: string; qty: number };
export type StateKey = "CANCELLED" | "INSTRUCTION_PENDING" | "WAITING_DOCUMENTS" | "CUSTOMER_HOLD" | "READY_TO_SCHEDULE" | "SCHEDULED" | "DISPATCHED" | "DELIVERED" | "WAITING_CUSTOMER_ENTRY" | "INVOICE_READY" | "INVOICED";
export const STATES: Record<StateKey, Txt & { tone: string }> = {
  CANCELLED: { es: "Cancelado", en: "Cancelled", tone: "wait" }, INSTRUCTION_PENDING: { es: "Falta la instrucción de Comercial", en: "Instruction from Sales pending", tone: "attn" },
  WAITING_DOCUMENTS: { es: "Esperando documentos", en: "Waiting documents", tone: "attn" }, CUSTOMER_HOLD: { es: "Espera del cliente", en: "Customer-controlled wait", tone: "wait" },
  READY_TO_SCHEDULE: { es: "Listo para programar", en: "Ready to schedule", tone: "attn" }, SCHEDULED: { es: "Programado", en: "Scheduled", tone: "ok" }, DISPATCHED: { es: "Despachado", en: "Dispatched", tone: "ok" },
  DELIVERED: { es: "Entregado: faltan requisitos", en: "Delivered: requirements pending", tone: "attn" }, WAITING_CUSTOMER_ENTRY: { es: "Entregado: falta la entrada del cliente", en: "Delivered: customer entry pending", tone: "attn" },
  INVOICE_READY: { es: "Listo para facturar", en: "Invoice ready", tone: "ok" }, INVOICED: { es: "Facturado", en: "Invoiced", tone: "ok" },
};

export type Req = { id: string; phase: string; text: string };
export type StateIn = {
  cancelled: boolean; hasInstruction: boolean; reqs: Req[]; checks: Record<string, unknown>;
  customerHold: boolean; scheduledFor: Date | null; dispatchedAt: Date | null; deliveredAt: Date | null;
  entryRequired: boolean; entryRef: string | null; invoiced: boolean;
};
const open = (s: StateIn, phases: string[]) => s.reqs.filter((r) => phases.includes(r.phase) && !s.checks[r.id]);
/** §44.1 state model. `missing` lists what holds the order where it is. */
export function dispatchState(s: StateIn): { key: StateKey; missing: Req[] } {
  if (s.cancelled) return { key: "CANCELLED", missing: [] };
  if (s.deliveredAt) {
    if (s.invoiced) return { key: "INVOICED", missing: [] };
    const m = open(s, ["AT_DELIVERY", "AFTER_DELIVERY", "BEFORE_INVOICE"]);
    if (s.entryRequired && !s.entryRef?.trim()) return { key: "WAITING_CUSTOMER_ENTRY", missing: m };
    return m.length ? { key: "DELIVERED", missing: m } : { key: "INVOICE_READY", missing: [] };
  }
  if (s.dispatchedAt) return { key: "DISPATCHED", missing: open(s, ["AT_DELIVERY"]) };
  if (!s.hasInstruction) return { key: "INSTRUCTION_PENDING", missing: [] };
  const before = open(s, ["BEFORE_DISPATCH"]);
  if (before.length) return { key: "WAITING_DOCUMENTS", missing: before };
  if (s.customerHold) return { key: "CUSTOMER_HOLD", missing: [] };
  return { key: s.scheduledFor ? "SCHEDULED" : "READY_TO_SCHEDULE", missing: [] };
}
/** May the order leave? Never without the instruction or with a BEFORE_DISPATCH requirement open. */
export const canDispatch = (s: StateIn) => !s.cancelled && !s.dispatchedAt && !s.deliveredAt && s.hasInstruction && open(s, ["BEFORE_DISPATCH"]).length === 0 && !s.customerHold;
/** May it be marked delivered? The AT_DELIVERY requirements are evidence of the handover itself. */
export const canDeliver = (s: StateIn) => !!s.dispatchedAt && !s.deliveredAt && !s.cancelled && open(s, ["AT_DELIVERY"]).length === 0;

/** §39.1 Units still to dispatch per item: ordered − delivered − already in an open order. */
export function remainingByItem(items: { id: string; qty: number }[], delivered: { dealItemId: string; qty: number }[], inOpenOrders: { dealItemId: string; qty: number }[]) {
  const sum = (rows: { dealItemId: string; qty: number }[], id: string) => rows.filter((r) => r.dealItemId === id).reduce((a, r) => a + r.qty, 0);
  return items.map((it) => ({ id: it.id, ordered: it.qty, delivered: sum(delivered, it.id), inOrders: sum(inOpenOrders, it.id), remaining: Math.max(0, it.qty - sum(delivered, it.id) - sum(inOpenOrders, it.id)) }));
}

/** Oldest stock first. Returns how much to take from each lot; `short` is what the warehouse doesn't hold. */
export function consumeLots(lots: { id: string; qty: number }[], need: number) {
  const take: { id: string; qty: number; whole: boolean }[] = [];
  let left = need;
  for (const l of lots) { if (left <= 0) break; const q = Math.min(l.qty, left); take.push({ id: l.id, qty: q, whole: q === l.qty }); left -= q; }
  return { take, short: left };
}

const DAY = 864e5;
/** §47 Aging from event timestamps. Days waiting on the customer are counted apart from ours. */
export function aging(o: { readyAt: Date; dispatchedAt: Date | null; deliveredAt: Date | null; invoicedAt: Date | null; customerHoldSince: Date | null }, now: Date) {
  const d = (a: Date, b: Date) => Math.max(0, Math.floor((+b - +a) / DAY));
  return {
    readyToDispatch: d(o.readyAt, o.dispatchedAt ?? o.deliveredAt ?? now),
    deliveryToInvoice: o.deliveredAt ? d(o.deliveredAt, o.invoicedAt ?? now) : null,
    customerWait: o.customerHoldSince && !o.dispatchedAt ? d(o.customerHoldSince, now) : 0,
  };
}
