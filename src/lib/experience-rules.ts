// Operaciones O10 · product experience and publication eligibility (module 11 §36–37). Pure: no database.
// SOLU never publishes by itself. "Ready" only means a person has reviewed every confidentiality point.

type Txt = { es: string; en: string };
export const ELIGIBILITY: Record<string, Txt> = {
  INTERNAL_ONLY: { es: "Solo interno", en: "Internal only" },
  PUBLISHABLE_ANONYMIZED: { es: "Publicable sin nombrar al cliente", en: "Publishable without naming the customer" },
  CUSTOMER_APPROVED_CASE: { es: "Caso aprobado por el cliente", en: "Customer-approved case" },
};
/** §37.2 Every point a person must look at before anything leaves the company. */
export const REVIEW: Record<string, Txt> = {
  customer: { es: "No revela al cliente (o el cliente aprobó que se nombre)", en: "Doesn't reveal the customer (or the customer approved being named)" },
  prices: { es: "Sin precios ni costos", en: "No prices or costs" },
  serials: { es: "Sin seriales", en: "No serial numbers" },
  suppliers: { es: "Sin fuentes ni nombres de proveedores", en: "No supplier sources or names" },
  documents: { es: "Sin documentos del cliente o del proveedor", en: "No customer or supplier documents" },
  trademarks: { es: "Marcas usadas solo para identificar el producto", en: "Trademarks used only to identify the product" },
  plant: { es: "Sin información sensible de la planta", en: "No sensitive plant information" },
};
export const REVIEW_KEYS = Object.keys(REVIEW);
/** §37.3 The line every public page of a past supply must carry. */
export const AVAILABILITY_NOTE: Txt = { es: "Referencia suministrada o localizada anteriormente. Disponibilidad sujeta a nueva confirmación.", en: "Reference supplied or located previously. Availability subject to new confirmation." };

export type Exp = { eligibility: string; draft: string | null; checks: Record<string, unknown>; customerApproval: string | null };
export function readiness(e: Exp): { ready: boolean; missing: Txt[] } {
  const missing: Txt[] = [];
  if (e.eligibility === "INTERNAL_ONLY") return { ready: false, missing: [{ es: "Marcada como solo interna", en: "Marked internal only" }] };
  if (!e.draft?.trim()) missing.push({ es: "Falta el texto del borrador", en: "The draft text is missing" });
  if (e.eligibility === "CUSTOMER_APPROVED_CASE" && !e.customerApproval?.trim()) missing.push({ es: "Falta quién del cliente aprobó y cuándo", en: "Missing who at the customer approved and when" });
  for (const k of REVIEW_KEYS) if (!e.checks[k]) missing.push(REVIEW[k]);
  return { ready: missing.length === 0, missing };
}
/** Things in a draft that usually should not be public. Warnings for the reviewer, never an automatic block or pass. */
export function draftWarnings(draft: string, ctx: { customerName?: string | null; supplierNames?: string[]; anonymized: boolean }): Txt[] {
  const w: Txt[] = [];
  const low = draft.toLowerCase();
  if (/(usd|us\$|cop|\$)\s?\d|\d[\d.,]*\s?(usd|cop|dólares|dolares|pesos)\b/i.test(draft)) w.push({ es: "Parece haber un precio o un valor en dinero", en: "There seems to be a price or money amount" });
  if (/\b(s\/?n|serial|serie)\b\s*[:#]?\s*[a-z0-9-]{4,}/i.test(draft)) w.push({ es: "Parece haber un número de serie", en: "There seems to be a serial number" });
  if (ctx.anonymized && ctx.customerName && ctx.customerName.trim().length >= 4 && low.includes(ctx.customerName.trim().toLowerCase())) w.push({ es: "Aparece el nombre del cliente y está marcada como «sin nombrar al cliente»", en: "The customer's name appears and it is marked \"without naming the customer\"" });
  for (const s of ctx.supplierNames ?? []) if (s.trim().length >= 4 && low.includes(s.trim().toLowerCase())) { w.push({ es: `Aparece el nombre de un proveedor (${s})`, en: `A supplier's name appears (${s})` }); break; }
  if (/\b(en stock|disponible de inmediato|entrega inmediata|in stock|immediate delivery)\b/i.test(draft)) w.push({ es: "Promete disponibilidad: solo si de verdad hay inventario", en: "It promises availability: only if there really is stock" });
  return w;
}
