import type { PhotoReading } from "./part-vision";
import { brandIn, categoryIn, CATEGORIES } from "./part-lexicon";

// Free photo search (decision 2026-11-10): the browser reads the text on a nameplate (OCR, no AI, no cost)
// and this turns that text into a reading SOLU can search with. Pure, runs in the browser and on the server.
// It copies what was read; it never "fixes" a digit. The reading is shown as unconfirmed.

const LABELED = /\b(P\s*\/\s*N|PART\s*(?:NO|NUMBER|#)\.?|ART(?:ICLE)?\.?\s*-?\s*(?:NR|NO)\.?|ORDER\s*(?:NO|CODE)\.?|MLFB|CAT(?:ALOG)?\.?\s*(?:NO|#)\.?|TYPE|TYP|REF(?:ERENCE)?\.?|CODE|C[OÓ]DIGO|MODEL(?:O)?|MOD\.)\s*[:.#=]?\s*([A-Z0-9][A-Z0-9\-./]{2,})/gi;
// OCR often turns "S/N" into "SIN", "S|N", "5/N" or "SN".
const SERIAL = /\b(?:[S5]\s*[\/\\|Il1]?\s*N(?![A-Z])|SER(?:IAL)?\.?\s*(?:NO|NR|#)?\.?|SERIE|F\.?\s*NR\.?)\s*[:.#]?\s*([A-Z0-9][A-Z0-9\-./]{2,})/gi;
const SPEC = [
  /\b\d+(?:[.,]\d+)?\s*(?:kW|KW|kw|HP|hp|CV)\b/g,
  /\b\d+(?:[.,]\d+)?(?:\s*[-–/]\s*\d+(?:[.,]\d+)?)?\s*V(?:AC|DC)?\b/g,
  /\b\d+(?:[.,]\d+)?\s*A\b/g,
  /\b\d+(?:\s*\/\s*\d+)?\s*Hz\b/gi,
  /\b\d{3,5}\s*(?:rpm|RPM|r\/min|min-1|1\/min)\b/g,
  /\bIP\s?\d{2}\b/g,
  /\b\d+(?:[.,]\d+)?\s*bar\b/gi,
  /\b-?\d+(?:[.,]\d+)?\s*°\s*C\b/g,
];
// Looks like a rating or a date, not a part number.
const NOT_A_CODE = /^(?:\d+(?:[.,]\d+)?(?:[-–/]\d+(?:[.,]\d+)?)?(?:K?W|HP|CV|V|VAC|VDC|A|HZ|RPM|BAR|MM|KG|NM|°C)|IP\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|(?:19|20)\d{2})$/i;

const clean = (s: string) => s.replace(/[.,;:/]+$/, "").toUpperCase();

/** A token worth searching as a part number: letters and digits mixed, or digit groups joined by hyphens. */
export function codeLike(tok: string) {
  const s = clean(tok);
  if (s.length < 5 || s.length > 30 || NOT_A_CODE.test(s)) return false;
  const digits = (s.match(/\d/g) ?? []).length;
  if (!digits) return false;
  const letters = (s.match(/[A-Z]/g) ?? []).length;
  return (letters > 0 && digits >= 2) || /\d+[-.]\d+/.test(s);
}

export function readingFromText(raw: string): PhotoReading & { via: "OCR" } {
  const text = raw.replace(/\r/g, "").replace(/[|¦]/g, " ").replace(/[ \t]+/g, " ");
  const serials = new Set<string>();
  for (const m of text.matchAll(SERIAL)) serials.add(clean(m[1]));

  const labeled: string[] = [];
  let model: string | null = null;
  for (const m of text.matchAll(LABELED)) {
    const val = clean(m[2]);
    if (serials.has(val)) continue;
    if (/^MOD/i.test(m[1]) && !model) { model = val; continue; }
    if (codeLike(val) || /^(MLFB|P\s*\/\s*N|ART|ORDER|CAT|PART)/i.test(m[1].trim())) labeled.push(val);
  }
  const loose = text.split(/[\s,;()]+/).map(clean).filter((x) => codeLike(x) && !serials.has(x));
  const partNumbers = [...new Set([...labeled, ...loose.sort((a, b) => (b.match(/-/g) ?? []).length - (a.match(/-/g) ?? []).length || b.length - a.length)])].slice(0, 5);

  const specs = [...new Set(SPEC.flatMap((re) => [...text.matchAll(re)].map((m) => m[0].replace(/\s+/g, " ").trim())))].slice(0, 8);
  const brand = brandIn(text) ?? null;
  const cat = categoryIn(text) ?? null;
  const found = partNumbers.length > 0 || !!brand;
  return {
    via: "OCR",
    partNumbers, brand, model, specs,
    partType: cat ? CATEGORIES[cat].es : "", partTypeEn: cat ? CATEGORIES[cat].en : "",
    category: cat,
    source: found ? "NAMEPLATE" : "UNCLEAR",
    note: found
      ? "Leído en tu navegador, sin IA: compara cada dígito con la foto (0/O, 1/I, 8/B se confunden)."
      : "No se leyó texto útil. Prueba una foto más cercana, de frente y con buena luz, solo de la placa.",
  };
}

/** Same rule as the AI reading: numbers first, else brand + type + model. */
export function queryFromText(r: PhotoReading) {
  if (r.partNumbers.length) return r.partNumbers.slice(0, 3).join(" ");
  return [r.brand, r.model, r.partType].filter(Boolean).join(" ").trim();
}
