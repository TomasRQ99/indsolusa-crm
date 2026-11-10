import { promiseHealth, type OpsPolicy, type PromiseHealth } from "./ops-rules";

// Operaciones O5a · freight (module 11 §25–30). Pure: no database.
// "La métrica no es flete más barato; es Cost to Fulfill." Every option is read against the customer promise, and the
// carrier's dates inform the expectation without ever becoming the promise.

type Txt = { es: string; en: string };
export const WEIGHT_SOURCES: Record<string, Txt> = {
  SUPPLIER_STATED: { es: "Dicho por el proveedor", en: "Supplier stated" },
  HISTORICAL_MEASURED: { es: "Medido antes (histórico)", en: "Historical measured" },
  WAREHOUSE_MEASURED: { es: "Medido en bodega", en: "Warehouse measured" },
  CARRIER_MEASURED: { es: "Medido por el transportador", en: "Carrier measured" },
  ESTIMATED: { es: "Estimado", en: "Estimated" },
};

export type FreightIn = { pickupAddress: string | null; pickupContact: string | null; pickupHours: string | null; destination: string | null; readyDate: Date | null; packages: number | null; grossKg: number | null; dims: string | null; packagingType: string | null; hazardous: boolean | null; incoterm: string | null; hasInvoice: boolean; hasPackingList: boolean; origin: string | null };
export type Missing = { key: string; what: Txt; why: Txt };
const N = (key: string, what: [string, string], why: [string, string]): Missing => ({ key, what: { es: what[0], en: what[1] }, why: { es: why[0], en: why[1] } });

/** §25 Logistics Readiness: derived. Each missing item says why transport can't be booked without it. */
export function logisticsReadiness(f: FreightIn, international: boolean): Missing[] {
  const out: Missing[] = [];
  if (!f.pickupAddress?.trim()) out.push(N("pickup", ["Dirección de recogida", "Pickup address"], ["El transportador no sabe dónde recoger", "The carrier doesn't know where to collect"]));
  if (!f.pickupContact?.trim()) out.push(N("contact", ["Contacto en origen", "Contact at origin"], ["Nadie responde por la entrega al transportador", "Nobody answers for handing over to the carrier"]));
  if (!f.pickupHours?.trim()) out.push(N("hours", ["Horario de recogida", "Opening hours"], ["Una recogida fallida mueve la fecha", "A failed pickup moves the date"]));
  if (!f.destination?.trim()) out.push(N("destination", ["Destino", "Destination"], ["Sin destino no hay tarifa", "No destination, no rate"]));
  if (!f.readyDate) out.push(N("ready", ["Fecha de listo", "Ready date"], ["No se puede programar la recogida", "The pickup can't be scheduled"]));
  if (!f.packages || f.packages <= 0) out.push(N("packages", ["Número de bultos", "Number of packages"], ["La guía se crea por pieza", "The waybill is created per piece"]));
  if (!f.grossKg || f.grossKg <= 0) out.push(N("weight", ["Peso bruto", "Gross weight"], ["La tarifa depende del peso", "The rate depends on the weight"]));
  if (!f.dims?.trim()) out.push(N("dims", ["Medidas por bulto", "Dimensions per package"], ["El peso volumétrico puede superar el real", "Volumetric weight can exceed the real one"]));
  if (!f.packagingType?.trim()) out.push(N("packaging", ["Tipo de empaque", "Packaging type"], ["Define manejo y apilado", "It sets handling and stacking"]));
  if (f.hazardous == null) out.push(N("hazardous", ["¿Es mercancía peligrosa?", "Is it hazardous?"], ["Cambia el servicio y los documentos", "It changes the service and the documents"]));
  if (!f.incoterm?.trim()) out.push(N("incoterm", ["Incoterm", "Incoterm"], ["Define quién contrata y paga el transporte", "It sets who books and pays the transport"]));
  if (international) {
    if (!f.origin?.trim()) out.push(N("origin", ["País de origen", "Country of origin"], ["Lo exige la aduana", "Customs requires it"]));
    if (!f.hasInvoice) out.push(N("invoice", ["Factura comercial", "Commercial invoice"], ["Sin ella no sale ni entra", "Without it nothing leaves or enters"]));
    if (!f.hasPackingList) out.push(N("packing", ["Lista de empaque", "Packing list"], ["La aduana la contrasta con la carga", "Customs checks it against the cargo"]));
  }
  return out;
}

/**
 * §26 / golden step 9: a stated weight outside what was measured before is not overwritten and not trusted
 * silently: it asks for reconfirmation.
 */
export function weightCheck(stated: number | null, measured: number[]): { ask: boolean; min: number | null; max: number | null } {
  if (stated == null || measured.length === 0) return { ask: false, min: null, max: null };
  const min = Math.min(...measured), max = Math.max(...measured);
  return { ask: stated < min * 0.97 || stated > max * 1.03, min, max };
}

export type QuoteIn = { id: string; cost: number; currency: string; transitDays: number | null; pickupDate: Date | null };
export type QuoteRead = { id: string; arrives: Date | null; health: PromiseHealth; reason: Txt; cheapest: boolean; extraVsCheapest: number };
/** Each option: when it would arrive (pickup + transit + clearance + last mile) and what that does to the promise. */
export function readQuotes(quotes: QuoteIn[], ctx: { readyDate: Date | null; promise: Date | null; today: Date; afterArrivalDays: number; policy: OpsPolicy }): QuoteRead[] {
  const sameCur = quotes.every((q) => q.currency === quotes[0]?.currency);
  const min = quotes.length && sameCur ? Math.min(...quotes.map((q) => q.cost)) : null;
  return quotes.map((q) => {
    const start = q.pickupDate ?? ctx.readyDate;
    const arrives = start && q.transitDays != null ? new Date(start.getTime() + (q.transitDays + ctx.afterArrivalDays) * 864e5) : null;
    const h = ctx.promise ? promiseHealth(ctx.promise, arrives, ctx.today, ctx.policy) : { health: "UNKNOWN" as const, reason: { es: "Este Journey no tiene promesa con fecha", en: "This Journey has no dated promise" } };
    return { id: q.id, arrives, health: h.health, reason: h.reason, cheapest: min != null && q.cost === min, extraVsCheapest: min != null ? Math.round((q.cost - min) * 100) / 100 : 0 };
  });
}
/** Choosing needs a written reason when the option is not the cheapest or doesn't protect the promise. */
export const choiceNeedsReason = (r: QuoteRead) => !r.cheapest || r.health === "AT_RISK" || r.health === "BREACHED" || r.health === "UNKNOWN";
