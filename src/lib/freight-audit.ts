// Operaciones O7 · freight invoice audit and customs (module 11 §31–33). Pure: no database.
// The audit checks that what was billed matches the cargo actually moved, the rate agreed and the surcharges that
// apply. Our own measurement is contrast evidence, never automatic proof that the carrier is wrong (AC50).

type Txt = { es: string; en: string };
export type Rule = { carrier: string; divisor: number; roundingKg: number; minChargeKg: number | null; tolerancePct: number; toleranceUsd: number; claimPct: number; confirmed: boolean; version: number };

/** "41x31x30" (cm) → [41, 31, 30]. Anything else → null: SOLU doesn't guess dimensions. */
export function parseDims(s: string | null | undefined): [number, number, number] | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*$/i.exec(s ?? "");
  if (!m) return null;
  const v = m.slice(1, 4).map((x) => Number(x.replace(",", "."))) as [number, number, number];
  return v.every((x) => x > 0) ? v : null;
}
const roundUp = (kg: number, step: number) => (step > 0 ? Math.ceil(kg / step - 1e-9) * step : kg);
/** Volumetric weight for `packages` equal boxes, by this carrier's own divisor (AC19). */
export const volumetricKg = (dims: [number, number, number] | null, packages: number | null, rule: Rule) => (dims ? Math.round(((dims[0] * dims[1] * dims[2]) / rule.divisor) * Math.max(1, packages ?? 1) * 100) / 100 : null);
/** Chargeable = the larger of actual and volumetric, rounded up to the carrier's step, never below its minimum. */
export function chargeableKg(actualKg: number | null, volKg: number | null, rule: Rule) {
  if (actualKg == null && volKg == null) return null;
  return Math.max(roundUp(Math.max(actualKg ?? 0, volKg ?? 0), rule.roundingKg), rule.minChargeKg ?? 0);
}

export type Side = { kg: number | null; dims: string | null; packages: number | null };
export type AuditIn = { quote: { cost: number; currency: string } | null; stated: Side | null; measured: Side | null; invoice: { amount: number; currency: string; billedKg: number | null; billedPieces: number | null; surcharges: { name: string; amount: number }[] }; duplicateOf: string | null };
export type Variance = { key: "CHARGEABLE_WEIGHT" | "DIMENSIONAL" | "PIECES" | "RATE" | "SURCHARGE" | "DUPLICATE"; text: Txt };
export type Status = "NOT_COMPARED" | "MATCH" |"WITHIN_TOLERANCE" | "VARIANCE_REVIEW" | "CLAIM_RECOMMENDED";
export type Audit = { status: Status; expectedKg: number | null; volKg: number | null; basis: "MEASURED" | "STATED" | null; billedKg: number | null; diffAmount: number | null; diffPct: number | null; variances: Variance[]; nextMove: Txt; ruleVersion: number; ruleConfirmed: boolean };

/** §31.2 Four-way match: quote, waybill data, our measurement, invoice. Uses whatever exists; never invents a side. */
export function auditInvoice(a: AuditIn, rule: Rule): Audit {
  const v: Variance[] = [];
  const side = a.measured?.kg != null || parseDims(a.measured?.dims) ? a.measured : a.stated;
  const basis = side ? (side === a.measured ? "MEASURED" : "STATED") : null;
  const volKg = side ? volumetricKg(parseDims(side.dims), side.packages, rule) : null;
  const expectedKg = side ? chargeableKg(side.kg, volKg, rule) : null;
  const n = (x: number) => (Math.round(x * 100) / 100).toString();
  if (a.duplicateOf) v.push({ key: "DUPLICATE", text: { es: `Posible cobro duplicado: ya existe la factura ${a.duplicateOf} para este envío`, en: `Possible duplicate charge: invoice ${a.duplicateOf} already exists for this shipment` } });
  if (expectedKg != null && a.invoice.billedKg != null && a.invoice.billedKg > expectedKg + rule.roundingKg) v.push({ key: "CHARGEABLE_WEIGHT", text: { es: `Peso cobrable facturado ${n(a.invoice.billedKg)} kg; lo esperado con ${basis === "MEASURED" ? "nuestra medición" : "lo declarado"} es ${n(expectedKg)} kg`, en: `Billed chargeable weight ${n(a.invoice.billedKg)} kg; expected from ${basis === "MEASURED" ? "our measurement" : "what was stated"} is ${n(expectedKg)} kg` } });
  const sKg = a.stated?.kg, mKg = a.measured?.kg;
  if (sKg != null && mKg != null && Math.abs(sKg - mKg) > Math.max(rule.roundingKg, sKg * 0.03)) v.push({ key: "DIMENSIONAL", text: { es: `Lo declarado (${n(sKg)} kg) y lo que medimos (${n(mKg)} kg) no coinciden`, en: `What was stated (${n(sKg)} kg) and what we measured (${n(mKg)} kg) don't match` } });
  const pcs = a.measured?.packages ?? a.stated?.packages ?? null;
  if (pcs != null && a.invoice.billedPieces != null && pcs !== a.invoice.billedPieces) v.push({ key: "PIECES", text: { es: `Facturan ${a.invoice.billedPieces} bultos; contamos ${pcs}`, en: `${a.invoice.billedPieces} pieces billed; we counted ${pcs}` } });
  for (const s of a.invoice.surcharges.filter((x) => x.amount > 0)) v.push({ key: "SURCHARGE", text: { es: `Recargo ${s.name}: ${a.invoice.currency} ${n(s.amount)} — confirmar que aplica`, en: `Surcharge ${s.name}: ${a.invoice.currency} ${n(s.amount)} — confirm it applies` } });
  let diffAmount: number | null = null, diffPct: number | null = null;
  if (a.quote && a.quote.currency === a.invoice.currency) {
    diffAmount = Math.round((a.invoice.amount - a.quote.cost) * 100) / 100;
    diffPct = a.quote.cost > 0 ? Math.round((diffAmount / a.quote.cost) * 1000) / 10 : null;
    if (diffAmount > 0.005) v.push({ key: "RATE", text: { es: `Facturado ${a.invoice.currency} ${n(a.invoice.amount)} frente a ${n(a.quote.cost)} cotizado (+${n(diffAmount)})`, en: `Billed ${a.invoice.currency} ${n(a.invoice.amount)} against ${n(a.quote.cost)} quoted (+${n(diffAmount)})` } });
  }
  // A quote in another currency can't be compared without inventing an exchange rate: a person looks at it.
  const fxGap = !!a.quote && a.quote.currency !== a.invoice.currency;
  if (fxGap) v.push({ key: "RATE", text: { es: `La cotización está en ${a.quote!.currency} y la factura en ${a.invoice.currency}: SOLU no las compara sola`, en: `The quote is in ${a.quote!.currency} and the invoice in ${a.invoice.currency}: SOLU doesn't compare them by itself` } });
  // Status by the money at stake when there is a quote; otherwise by whether any variance was found.
  const over = diffAmount != null ? diffAmount : null;
  let status: Status;
  if (a.duplicateOf) status = "CLAIM_RECOMMENDED";
  else if (over != null) status = over <= 0.005 && v.every((x) => x.key === "SURCHARGE" || x.key === "DIMENSIONAL") ? (v.length ? "WITHIN_TOLERANCE" : "MATCH") : over <= rule.toleranceUsd || (diffPct ?? 0) <= rule.tolerancePct ? "WITHIN_TOLERANCE" : (diffPct ?? 0) <= rule.claimPct ? "VARIANCE_REVIEW" : "CLAIM_RECOMMENDED";
  else status = fxGap || v.some((x) => x.key === "CHARGEABLE_WEIGHT" || x.key === "PIECES") ? "VARIANCE_REVIEW" : v.length ? "WITHIN_TOLERANCE" : "MATCH";
  // With no quote and no weight to compare against, saying "match" would be inventing a check that never happened.
  const blind = !a.duplicateOf && !a.quote && (expectedKg == null || a.invoice.billedKg == null) && !v.some((x) => x.key === "PIECES");
  if (blind) status = "NOT_COMPARED";
  const nextMove: Txt = blind ? { es: "No hubo contra qué comparar: falta la cotización de flete elegida en la compra, o el peso (declarado o medido) y el peso cobrable de la factura", en: "There was nothing to compare against: the freight quote chosen on the purchase is missing, or the weight (stated or measured) and the invoice's chargeable weight" }
    : status === "WITHIN_TOLERANCE" && v.length ? { es: "Dentro de lo normal. Solo confirmar los puntos anotados arriba", en: "Within tolerance. Just confirm the points noted above" }
    : status === "CLAIM_RECOMMENDED" ? { es: "Pedir al transportador el detalle de su medición y abrir el reclamo con la evidencia", en: "Ask the carrier for its measurement detail and open the claim with the evidence" }
    : status === "VARIANCE_REVIEW" ? { es: "Revisar la diferencia con la evidencia: el transportador pudo reempacar, paletizar o redondear según contrato", en: "Review the difference with the evidence: the carrier may have repacked, palletised or rounded per contract" }
    : { es: "Nada que hacer: la factura corresponde a lo esperado", en: "Nothing to do: the invoice matches what was expected" };
  return { status, expectedKg, volKg, basis, billedKg: a.invoice.billedKg, diffAmount, diffPct, variances: v, nextMove, ruleVersion: rule.version, ruleConfirmed: rule.confirmed };
}
export const STATUS_TEXT: Record<string, Txt & { tone: string }> = {
  NOT_COMPARED: { es: "Sin base para comparar", en: "Nothing to compare against", tone: "wait" }, MATCH: { es: "Coincide", en: "Match", tone: "ok" }, WITHIN_TOLERANCE: { es: "Dentro de lo normal", en: "Within tolerance", tone: "ok" }, VARIANCE_REVIEW: { es: "Revisar diferencia", en: "Review variance", tone: "attn" },
  CLAIM_RECOMMENDED: { es: "Se recomienda reclamar", en: "Claim recommended", tone: "risk" }, CLAIM_OPEN: { es: "Reclamo abierto", en: "Claim open", tone: "attn" }, CREDIT_RECEIVED: { es: "Crédito recibido", en: "Credit received", tone: "ok" },
};

// ---------- Customs (§32–33) ----------

export type CustomsIn = { international: boolean; hasInvoice: boolean; hasPackingList: boolean; hasTransportDoc: boolean; origin: string | null; classification: string | null; classificationStatus: string; consignee: string | null; broker: string | null; declaredValue: number | null };
export type Need = { key: string; what: Txt };
/** §32 Import Readiness by applicability: a domestic move asks for nothing. */
export function importReadiness(c: CustomsIn): Need[] {
  if (!c.international) return [];
  const out: Need[] = [];
  const add = (key: string, es: string, en: string) => out.push({ key, what: { es, en } });
  if (!c.hasInvoice) add("invoice", "Factura comercial", "Commercial invoice");
  if (!c.hasPackingList) add("packing", "Lista de empaque", "Packing list");
  if (!c.hasTransportDoc) add("transport", "Documento de transporte (guía / BL)", "Transport document (AWB / BL)");
  if (!c.origin?.trim()) add("origin", "País de origen", "Country of origin");
  if (!c.classification?.trim()) add("class", "Clasificación arancelaria", "Tariff classification");
  else if (c.classificationStatus !== "VALIDATED_CURRENT") add("class-current", "Clasificación validada con la norma vigente (una usada antes es historia, no validación)", "Classification validated against current rules (one used before is history, not validation)");
  if (!c.consignee?.trim()) add("consignee", "Consignatario", "Consignee");
  if (!c.broker?.trim()) add("broker", "Agente de aduana", "Customs broker");
  if (c.declaredValue == null || c.declaredValue <= 0) add("value", "Valor declarado", "Declared value");
  return out;
}
/** §12.3 / AC39, frozen rule: duty optimisation follows correct classification, it never drives it. */
export const CLASSIFICATION_RULE: Txt = { es: "La clasificación se define por lo que el producto es. Nunca se elige una posición porque pague menos arancel.", en: "Classification is set by what the product is. A heading is never chosen because it pays less duty." };
