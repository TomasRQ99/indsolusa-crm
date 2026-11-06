// Server-side only (route handler and server actions). Reads company data from a customer's documents: the DIAN RUT (Formulario 001)
// and the Cámara de Comercio certificate. Only PDFs that contain text can be read
// (the ones downloaded from DIAN or the Cámara). Scans and photos have no text:
// they are stored but nothing is filled in. Rule-based, no AI: every value found
// is shown to the person for review before it is saved.

export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const DOC_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export type DocKind ="RUT" | "CAMARA" | "OTHER";
export type ExtractedFields = {
  name?: string;
  tradeName?: string;
  taxId?: string;
  address?: string;
  city?: string;
  department?: string;
  phone?: string;
  email?: string;
  ciiu?: string;
};
export type Extraction = { kind: DocKind; fields: ExtractedFields; readable: boolean; nitMismatch?: boolean };

type Item = { s: string; x: number; y: number; w: number; page: number };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const digits = (s: string) => s.replace(/\D/g, "");
const LABEL = /^\d{1,3}\.(\s*[A-Za-zÁÉÍÓÚáéíóúÑñ(]|$)/;

/** Groups text pieces into visual lines (same page, nearly the same height). */
function lines(items: Item[]) {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const out: Item[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && last[0].page === it.page && Math.abs(last[0].y - it.y) <= 2.5) last.push(it);
    else out.push([it]);
  }
  out.forEach((l) => l.sort((a, b) => a.x - b.x));
  return out;
}

/**
 * RUT layout: each box has a numbered label ("35. Razón social") and its value
 * printed below it. Find the label, then read the text under it, between the
 * label's left edge and the next label on the same line.
 */
function rutBox(ls: Item[][], label: RegExp): string | undefined {
  for (let li = 0; li < ls.length; li++) {
    const line = ls[li];
    // The number and the words of a label can come as one piece or two ("35." + "Razón social").
    let span = 1;
    let idx = line.findIndex((it) => label.test(clean(it.s)));
    if (idx < 0) {
      idx = line.findIndex((it, i) => i + 1 < line.length && label.test(clean(`${it.s} ${line[i + 1].s}`)));
      span = 2;
    }
    if (idx < 0) continue;
    const lab = line[idx];
    const nextLabel = line.slice(idx + span).find((it) => LABEL.test(clean(it.s)));
    const left = lab.x - 4;
    const right = nextLabel ? nextLabel.x - 1 : Infinity;
    // Words to the right of a label on its own line are the rest of the label; the value is below.
    for (let k = li + 1; k < Math.min(ls.length, li + 4); k++) {
      const below = ls[k];
      if (below[0].page !== lab.page || lab.y - below[0].y > 40) break;
      const parts = below.filter((it) => it.x + it.w / 2 >= left && it.x < right);
      if (!parts.length) continue;
      if (parts.every((it) => LABEL.test(clean(it.s)))) break;
      const v = clean(parts.filter((it) => !LABEL.test(clean(it.s))).map((it) => it.s).join(" "));
      if (v) return v;
    }
  }
  return undefined;
}

/** "Label: value" lines, as printed on Cámara de Comercio certificates. */
function labelled(text: string, label: RegExp): string | undefined {
  const re = new RegExp(`(?:^|\\n)\\s*(?:${label.source})\\s*[:\\-]\\s*([^\\n]+)`, "i");
  const m = text.match(re);
  return m ? clean(m[1]) : undefined;
}

export function formatNit(raw: string, dv?: string) {
  const d = digits(raw);
  if (d.length < 6) return undefined;
  const check = dv ? digits(dv).slice(0, 1) : "";
  return check ? `${d}-${check}` : d;
}

/** DIAN check digit for a NIT, used to validate what was read. */
export function nitCheckDigit(nit: string) {
  const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = digits(nit).split("").reverse();
  const sum = d.reduce((acc, n, i) => acc + Number(n) * (w[i] ?? 0), 0);
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

export function extractFromText(items: Item[], full: string): Extraction {
  const ls = lines(items);
  // A real RUT carries its numbered boxes, not just the words (DIAN brochures mention them too).
  const isRut = /Registro [ÚU]nico Tributario|Formulario del Registro/i.test(full) && /35\.\s*Raz[oó]n social/i.test(full) && /5\.\s*N[uú]mero de Identificaci[oó]n Tributaria/i.test(full);
  const isCamara = /C[aá]mara de Comercio/i.test(full) && /(Certificado|Matr[ií]cula)/i.test(full);
  const f: ExtractedFields = {};

  if (isRut) {
    const nit = rutBox(ls, /^5\.\s*N[uú]mero de Identificaci[oó]n Tributaria/i);
    const dv = rutBox(ls, /^6\.\s*DV/i);
    if (nit) {
      // The NIT box sometimes carries the DV at the end when both are read together.
      const d = digits(nit);
      f.taxId = formatNit(d, dv) ?? undefined;
    }
    f.name = rutBox(ls, /^35\.\s*Raz[oó]n social/i);
    if (!f.name) {
      // Natural person: names in boxes 31–34.
      const parts = [/^31\./, /^32\./, /^33\./, /^34\./].map((r) => rutBox(ls, r)).filter(Boolean);
      if (parts.length) f.name = parts.join(" ");
    }
    f.tradeName = rutBox(ls, /^36\.\s*Nombre comercial/i);
    f.department = stripCodes(rutBox(ls, /^39\.\s*Departamento/i));
    f.city = stripCodes(rutBox(ls, /^40\.\s*Ciudad/i));
    f.address = rutBox(ls, /^41\.\s*Direcci[oó]n/i);
    f.email = rutBox(ls, /^42\.\s*Correo/i)?.replace(/\s+/g, "");
    const tel = rutBox(ls, /^44\.\s*Tel[eé]fono/i);
    if (tel && digits(tel).length >= 7) f.phone = digits(tel);
    const ciiu = rutBox(ls, /^46\.\s*C[oó]digo/i);
    if (ciiu && digits(ciiu).length >= 4) f.ciiu = digits(ciiu).slice(0, 4);
  }

  if (isCamara || !isRut) {
    f.name ??= labelled(full, /Raz[oó]n social|Nombre o raz[oó]n social|Nombre/);
    const nit = labelled(full, /N\.?I\.?T\.?|Nit/);
    if (nit && !f.taxId) {
      const m = nit.match(/(\d[\d.]{5,})\s*-?\s*(\d)?/);
      if (m) f.taxId = formatNit(m[1], m[2]);
    }
    f.address ??= labelled(full, /Direcci[oó]n del domicilio principal|Direcci[oó]n comercial|Direcci[oó]n/);
    f.city ??= labelled(full, /Municipio|Ciudad/);
    f.email ??= labelled(full, /Correo electr[oó]nico(?: comercial)?/)?.replace(/\s+/g, "");
    const tel = labelled(full, /Tel[eé]fono comercial 1|Tel[eé]fono(?: comercial)?/);
    if (tel && !f.phone && digits(tel).length >= 7) f.phone = digits(tel).slice(0, 12);
  }

  // Last resort for any document: an email and a NIT-shaped number.
  if (!f.email) f.email = full.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  if (!f.taxId) {
    const m = full.match(/NIT[^\d]{0,12}(\d{3}[.\s]?\d{3}[.\s]?\d{3})\s*-\s*(\d)/i);
    if (m) f.taxId = formatNit(m[1], m[2]);
  }

  // Sanity checks: drop values that are obviously not what the box asks for.
  if (f.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email)) delete f.email;
  if (f.name && (f.name.length < 2 || LABEL.test(f.name))) delete f.name;
  for (const k of Object.keys(f) as (keyof ExtractedFields)[]) if (!f[k]) delete f[k];

  const kind: DocKind = isRut ? "RUT" : isCamara ? "CAMARA" : "OTHER";
  const m = f.taxId?.match(/^(\d{6,10})-(\d)$/);
  const nitMismatch = !!m && nitCheckDigit(m[1]) !== Number(m[2]);
  return { kind, fields: f, readable: full.replace(/\s/g, "").length > 40, nitMismatch };
}

/** RUT prints code boxes next to names ("Bogotá D.C. 1 1"): keep only the name. */
function stripCodes(v?: string) {
  if (!v) return v;
  const s = clean(v.replace(/(\s\d)+\s*$/g, "").replace(/^\d[\d\s]*\s/, ""));
  return s || undefined;
}

export async function extractDocument(bytes: Uint8Array, mime: string): Promise<Extraction> {
  if (mime !== "application/pdf") return { kind: "OTHER", fields: {}, readable: false };
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const items: Item[] = [];
  const pages = Math.min(pdf.numPages, 4);
  const texts: string[] = [];
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let buf = "";
    for (const raw of content.items as { str?: string; transform?: number[]; width?: number; hasEOL?: boolean }[]) {
      if (typeof raw.str !== "string" || !raw.transform) continue;
      const x = raw.transform[4], y = raw.transform[5];
      if (raw.str.trim()) items.push({ s: raw.str, x, y, w: raw.width ?? 0, page: p });
      if (lastY !== null && Math.abs(lastY - y) > 2.5) buf += "\n";
      else if (buf && !buf.endsWith(" ")) buf += " ";
      buf += raw.str;
      lastY = y;
    }
    texts.push(buf);
  }
  return extractFromText(items, texts.join("\n"));
}
