import type { MatchWhy } from "@/lib/parts";

type T = (es: string, en: string) => string;

export const LIFE: Record<string, { es: string; en: string }> = {
  ACTIVE: { es: "Vigente", en: "Active" },
  DISCONTINUED: { es: "Descontinuada", en: "Discontinued" },
  OBSOLETE: { es: "Obsoleta", en: "Obsolete" },
};
export const CONDITION: Record<string, { es: string; en: string }> = {
  NEW: { es: "Nueva", en: "New" },
  REFURBISHED: { es: "Reacondicionada", en: "Refurbished" },
  USED: { es: "Usada", en: "Used" },
};
export const ALIAS_KIND: Record<string, { es: string; en: string; help: string }> = {
  OEM: { es: "Número del fabricante", en: "Manufacturer number", help: "El número con el que el fabricante original la vende" },
  AFTERMARKET: { es: "Equivalente de otra marca", en: "Aftermarket equivalent", help: "Otra marca que fabrica la misma parte" },
  CROSSREF: { es: "Referencia cruzada", en: "Cross-reference", help: "Un número de otro catálogo que corresponde a esta parte" },
  SUPERSEDED: { es: "Número anterior (reemplazado)", en: "Superseded number", help: "El número viejo; el fabricante lo cambió por este" },
  VARIANT: { es: "Otra forma de escribirlo", en: "Spelling variant", help: "El mismo número escrito distinto" },
  MERGED: { es: "Duplicado fusionado", en: "Merged duplicate", help: "Era un registro repetido de esta misma parte" },
  NAME: { es: "Nombre comercial", en: "Trade name", help: "Cómo la llaman clientes o proveedores" },
};

export function whyText(w: MatchWhy, t: T): string {
  switch (w.t) {
    case "MPN": return t("El número de parte es exactamente el que escribiste", "The part number is exactly what you typed");
    case "ALIAS": return t(`Se conoce también como ${w.code} (${ALIAS_KIND[w.kind]?.es.toLowerCase() ?? w.kind})`, `Also known as ${w.code} (${ALIAS_KIND[w.kind]?.en.toLowerCase() ?? w.kind})`);
    case "PREFIX": return t(`Su número ${w.code} empieza con lo que escribiste`, `Its number ${w.code} starts with what you typed`);
    case "SIMILAR": return t(`Número muy parecido: ${w.code} (¿error de escritura?)`, `Very similar number: ${w.code} (typo?)`);
    case "WORDS": {
      const parts = [
        ...w.hits.map((h) => (h.via === h.word ? `“${h.word}”` : t(`“${h.word}” = ${h.via}`, `“${h.word}” = ${h.via}`))),
        ...w.fuzzy.map((f) => t(`“${f}” (parecido)`, `“${f}” (close spelling)`)),
      ];
      return t(`La descripción coincide con ${parts.join(", ")}`, `The description matches ${parts.join(", ")}`);
    }
    case "BRAND": return t(`Es de la marca ${w.brand}, la que pediste`, `It's ${w.brand}, the brand you asked for`);
  }
}
