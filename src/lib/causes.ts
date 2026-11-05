// Material causes shared by Recovery, promise revisions and Insights causality.
// One short list so management can compare causes across effects.

export const CAUSE_KEYS = ["SPEC", "SUPPLIER", "LOGISTICS", "CUSTOMER", "COST", "OTHER"];
export type CauseKey = "SPEC" | "SUPPLIER" | "LOGISTICS" | "CUSTOMER" | "COST" | "OTHER" | "UNKNOWN";

type T = (es: string, en: string) => string;

export function causeLabel(t: T, c: string | null | undefined) {
  switch (c) {
    case "SPEC": return t("Especificación / aplicación", "Specification / application");
    case "SUPPLIER": return t("Proveedor (atraso, faltante, calidad)", "Supplier (delay, missing part, quality)");
    case "LOGISTICS": return t("Transporte / aduana", "Freight / customs");
    case "CUSTOMER": return t("Cambio del cliente", "Customer change");
    case "COST": return t("Costo / precio", "Cost / price");
    case "OTHER": return t("Otra causa", "Other cause");
    default: return t("Sin causa registrada", "No cause recorded");
  }
}

/** Fallback for records written before the cause was asked: read the person's own words. */
export function inferCause(text: string | null | undefined): CauseKey {
  const s = (text ?? "").toLowerCase();
  if (!s) return "UNKNOWN";
  if (/incompat|brida|especific|material|resist|elast[oó]mero|nema|iec|aplicaci/.test(s)) return "SPEC";
  if (/aduana|transport|vuelo|carga|courier|flete|naviera|awb/.test(s)) return "LOGISTICS";
  if (/faltante|lleg[oó] sin|sin el |sin la |atras|proveedor|calidad|defect/.test(s)) return "SUPPLIER";
  if (/cancel|cliente (cambi|pidi|decidi)/.test(s)) return "CUSTOMER";
  if (/costo|precio|tasa|cambio de moneda/.test(s)) return "COST";
  return "UNKNOWN";
}

export const causeOf = (explicit: string | null | undefined, text?: string | null): CauseKey =>
  (CAUSE_KEYS.includes(explicit ?? "") ? (explicit as CauseKey) : inferCause(text));
