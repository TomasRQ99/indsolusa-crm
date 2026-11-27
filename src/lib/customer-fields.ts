// Pure rules for the customer's registration data (used by the form in the browser and by the server):
// countries with their phone code, how a phone and a tax ID are stored, and the full postal address.
// Nothing here touches the database.

export type Country = { code: string; es: string; en: string; dial: string };

/** Colombia and the United States first (where we sell from and to); then alphabetical in Spanish. */
export const COUNTRIES: Country[] = [
  { code: "CO", es: "Colombia", en: "Colombia", dial: "+57" },
  { code: "US", es: "Estados Unidos", en: "United States", dial: "+1" },
  { code: "DE", es: "Alemania", en: "Germany", dial: "+49" },
  { code: "AR", es: "Argentina", en: "Argentina", dial: "+54" },
  { code: "AT", es: "Austria", en: "Austria", dial: "+43" },
  { code: "BE", es: "Bélgica", en: "Belgium", dial: "+32" },
  { code: "BO", es: "Bolivia", en: "Bolivia", dial: "+591" },
  { code: "BR", es: "Brasil", en: "Brazil", dial: "+55" },
  { code: "CA", es: "Canadá", en: "Canada", dial: "+1" },
  { code: "CL", es: "Chile", en: "Chile", dial: "+56" },
  { code: "CN", es: "China", en: "China", dial: "+86" },
  { code: "KR", es: "Corea del Sur", en: "South Korea", dial: "+82" },
  { code: "CR", es: "Costa Rica", en: "Costa Rica", dial: "+506" },
  { code: "DK", es: "Dinamarca", en: "Denmark", dial: "+45" },
  { code: "EC", es: "Ecuador", en: "Ecuador", dial: "+593" },
  { code: "SV", es: "El Salvador", en: "El Salvador", dial: "+503" },
  { code: "ES", es: "España", en: "Spain", dial: "+34" },
  { code: "FR", es: "Francia", en: "France", dial: "+33" },
  { code: "GT", es: "Guatemala", en: "Guatemala", dial: "+502" },
  { code: "HN", es: "Honduras", en: "Honduras", dial: "+504" },
  { code: "IN", es: "India", en: "India", dial: "+91" },
  { code: "IT", es: "Italia", en: "Italy", dial: "+39" },
  { code: "JP", es: "Japón", en: "Japan", dial: "+81" },
  { code: "MX", es: "México", en: "Mexico", dial: "+52" },
  { code: "NI", es: "Nicaragua", en: "Nicaragua", dial: "+505" },
  { code: "NL", es: "Países Bajos", en: "Netherlands", dial: "+31" },
  { code: "PA", es: "Panamá", en: "Panama", dial: "+507" },
  { code: "PY", es: "Paraguay", en: "Paraguay", dial: "+595" },
  { code: "PE", es: "Perú", en: "Peru", dial: "+51" },
  { code: "PT", es: "Portugal", en: "Portugal", dial: "+351" },
  { code: "PR", es: "Puerto Rico", en: "Puerto Rico", dial: "+1" },
  { code: "GB", es: "Reino Unido", en: "United Kingdom", dial: "+44" },
  { code: "DO", es: "República Dominicana", en: "Dominican Republic", dial: "+1" },
  { code: "SE", es: "Suecia", en: "Sweden", dial: "+46" },
  { code: "CH", es: "Suiza", en: "Switzerland", dial: "+41" },
  { code: "TW", es: "Taiwán", en: "Taiwan", dial: "+886" },
  { code: "TR", es: "Turquía", en: "Turkey", dial: "+90" },
  { code: "UY", es: "Uruguay", en: "Uruguay", dial: "+598" },
  { code: "VE", es: "Venezuela", en: "Venezuela", dial: "+58" },
];

export const countryOf = (code?: string | null) => COUNTRIES.find((c) => c.code === code) ?? null;
export const countryName = (code: string | null | undefined, es: boolean) => {
  const c = countryOf(code);
  return c ? (es ? c.es : c.en) : null;
};
/** A valid country code or null (what the server stores). */
export const cleanCountry = (v: unknown) => countryOf(String(v ?? "").trim().toUpperCase())?.code ?? null;

/** The different phone codes, shortest list for the picker: "+57", "+1", … */
export const DIAL_CODES = [...new Set(COUNTRIES.map((c) => c.dial))];
export const cleanDial = (v: unknown) => {
  const s = String(v ?? "").trim();
  return DIAL_CODES.includes(s) ? s : "";
};

/**
 * A phone is stored in one piece, country code first: "+57 6016010213".
 * If the person already typed a "+", their number is kept as written.
 */
export function joinPhone(dial: unknown, number: unknown): string | null {
  const n = String(number ?? "").replace(/[^\d+()\-.\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!n.replace(/\D/g, "")) return null;
  if (n.startsWith("+")) return n;
  const d = cleanDial(dial);
  return d ? `${d} ${n}` : n;
}

/** The country whose phone code starts this stored phone, if any (Colombia and the United States win a tie). */
export function phoneCountry(phone?: string | null) {
  const p = (phone ?? "").trim();
  if (!p.startsWith("+")) return null;
  return [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => p.startsWith(c.dial)) ?? null;
}

/** DIAN check digit ("dígito de verificación") for a Colombian NIT. */
export function nitCheckDigit(nit: string) {
  const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = nit.replace(/\D/g, "").split("").reverse();
  const sum = d.reduce((acc, n, i) => acc + Number(n) * (w[i] ?? 0), 0);
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

/** "900123456-7" → number and check digit apart. A number without a dash has no check digit. */
export function splitTaxId(raw?: string | null): { base: string; dv: string } {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(.*\d)\s*-\s*(\d)$/);
  return m ? { base: m[1].trim(), dv: m[2] } : { base: s, dv: "" };
}

/** The tax ID as it is stored: the number, and "-digit" when the check digit was given (it is optional). */
export function composeTaxId(raw: unknown, dv: unknown): string | null {
  const typed = splitTaxId(String(raw ?? "").slice(0, 40));
  const digit = String(dv ?? "").replace(/\D/g, "").slice(0, 1) || typed.dv;
  if (!typed.base) return null;
  return digit ? `${typed.base}-${digit}` : typed.base;
}

/** True when a check digit was given and it is not the one DIAN's rule gives for that number. */
export function dvMismatch(base: string, dv: string) {
  const digits = base.replace(/\D/g, "");
  return /^\d$/.test(dv) && digits.length >= 6 && digits.length <= 15 && nitCheckDigit(digits) !== Number(dv);
}

/** A website as people type it ("WWW. EMPRESA.COM") stored as a link that works ("https://www.empresa.com"). Never refuses. */
export function tidyWebsite(v: unknown): string | null {
  const s = String(v ?? "").replace(/\s+/g, "").slice(0, 200);
  if (!s) return null;
  const m = s.match(/^(https?):\/*(.*)$/i);
  const rest = (m ? m[2] : s).replace(/^\/+/, "");
  if (!rest) return null;
  const slash = rest.indexOf("/");
  const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
  return `${m ? m[1].toLowerCase() : "https"}://${host}${slash < 0 ? "" : rest.slice(slash)}`;
}

export const looksLikeEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v.trim());

export type Place = { address?: string | null; city?: string | null; region?: string | null; postalCode?: string | null; country?: string | null };

export type ShipFields = { shipSame?: boolean | null; shipAddress?: string | null; shipCity?: string | null; shipRegion?: string | null; shipPostalCode?: string | null; shipCountry?: string | null };

/** The customer's address fields are the billing address. This is where the goods go: the customer's own
 *  shipping address, or the billing one when it is the same (or when no shipping address was written). */
export function shipPlace(a: Place & ShipFields): Place {
  if (a.shipSame !== false || !(a.shipAddress?.trim() || a.shipCity?.trim())) return a;
  return { address: a.shipAddress, city: a.shipCity, region: a.shipRegion, postalCode: a.shipPostalCode, country: a.shipCountry };
}

/** What an address needs to bill or ship: country, state, city and street. The postal code is asked but not needed. */
export const PLACE_NEEDED = ["country", "region", "city", "address"] as const;
export const placeMissing = (p: Place) => PLACE_NEEDED.filter((k) => !p[k]?.trim());

/** Second line of a postal address: "Bogotá, Cundinamarca 110111, Colombia". Empty when nothing is known. */
export function placeLine(p: Place, es: boolean) {
  const region = p.region && p.region !== p.city ? p.region : null;
  const first = [p.city, [region, p.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [first, countryName(p.country, es)].filter(Boolean).join(", ");
}

/** Street plus city, department, postal code and country, for documents and deliveries. On a document (one item
 *  per line) the country goes on its own line, as on the company's own quotes (owner, 2026-11-27): "U.S.A.". */
export function fullAddress(p: Place, es: boolean, sep = "\n") {
  if (sep !== "\n") return [p.address?.trim(), placeLine(p, es)].filter(Boolean).join(sep);
  const country = p.country === "US" && !es ? "U.S.A." : countryName(p.country, es);
  return [p.address?.trim(), placeLine({ ...p, country: null }, es), country].filter(Boolean).join("\n");
}
