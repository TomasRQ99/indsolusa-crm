// Server-side only (route handler and server actions). Reads company data from a customer's documents: the DIAN RUT (Formulario 001)
// and the Cámara de Comercio certificate. Only PDFs that contain text can be read
// (the ones downloaded from DIAN or the Cámara). Scans and photos have no text:
// they are stored but nothing is filled in. Rule-based, no AI: every value found
// is shown to the person for review before it is saved.

export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const DOC_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

import { nitCheckDigit } from "./customer-fields";
export { nitCheckDigit };

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

/** A line of the document as printed, and the same line without accents, in lower case and single-spaced, to find labels however they were typed. */
type Line = { text: string; key: string };
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function textLines(full: string): Line[] {
  return full.split("\n").map((l) => clean(l.normalize("NFC"))).filter(Boolean).map((text) => ({ text, key: plain(text) }));
}

/**
 * "Label: value" lines, as printed on Cámara de Comercio certificates. The label is matched without accents
 * or capitals; when the value was printed on the line below, that line is taken.
 */
function labelled(ls: Line[], label: RegExp): string | undefined {
  const re = new RegExp(`^(?:${label.source})\\s*[:\\-]\\s*(.*)$`);
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].key.match(re);
    if (!m) continue;
    const v = clean(ls[i].text.slice(ls[i].text.length - m[1].length));
    if (v) return v;
    const next = ls[i + 1];
    if (next && !/^[a-z0-9 .()]{3,60}:/.test(next.key)) return next.text;
  }
  return undefined;
}

// Addresses that belong to whoever issued the document (the Chamber, DIAN, other registries), never to the company.
const ISSUER_MAIL = /camara|(^|\.)cc[a-z]{1,3}\.org\.co$|\.gov\.co$|(^|\.)rues\.org\.co$|confecamaras|certicamara/;
// Words of a company name that say nothing about who it is.
const NAME_NOISE = new Set(["sas", "ltda", "limitada", "sociedad", "anonima", "simplificada", "acciones", "por", "cia", "compania", "comercializadora", "colombia", "grupo", "empresa", "liquidacion", "sucursal", "inversiones"]);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * The company's own email among every address printed in the document. Uses the context: which label the address
 * sits under, whether its domain looks like the company's name, and who else writes addresses on these documents.
 * An address with nothing that ties it to the company is not taken: an empty box is better than a wrong one.
 */
export function pickCompanyEmail(ls: Line[], name?: string): string | undefined {
  const words = plain(name ?? "").split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !NAME_NOISE.has(w));
  let best: { mail: string; score: number } | undefined;
  ls.forEach((l, i) => {
    for (const raw of l.text.match(EMAIL) ?? []) {
      const mail = raw.replace(/[.,;]+$/, "").toLowerCase();
      const domain = mail.split("@")[1] ?? "";
      if (ISSUER_MAIL.test(domain)) continue;
      // The label can be on the same line or, when the value wrapped, on the one above.
      const ctx = l.key.startsWith(plain(raw)) && i > 0 && /[:\-]$/.test(ls[i - 1].key) ? `${ls[i - 1].key} ${l.key}` : l.key;
      let score = 0;
      if (/correo electronico comercial|e-?mail comercial/.test(ctx)) score += 6;
      else if (/(correo electronico|e-?mail)[^:]{0,40}notificaci/.test(ctx)) score += 3;
      else if (/(correo electronico|e-?mail)\s*:/.test(ctx)) score += 5;
      const core = domain.replace(/\.[a-z]{2,3}(\.[a-z]{2})?$/, "").replace(/[^a-z0-9]/g, "");
      if (words.some((w) => core.includes(w) || (core.length >= 4 && w.includes(core)))) score += 4;
      // Notices printed by the issuer ("para más información escriba a…").
      if (/informacion|comuniquese|escriba|eleccion|renueve|consulte|peticiones|pqr|denuncie|verifi/.test(ctx)) score -= 4;
      if (score >= 3 && (!best || score > best.score)) best = { mail, score };
    }
  });
  return best?.mail;
}

export function formatNit(raw: string, dv?: string) {
  const d = digits(raw);
  if (d.length < 6) return undefined;
  const check = dv ? digits(dv).slice(0, 1) : "";
  return check ? `${d}-${check}` : d;
}

export function extractFromText(items: Item[], full: string): Extraction {
  const ls = lines(items);
  const tl = textLines(full);
  const key = tl.map((l) => l.key).join("\n");
  // A real RUT carries its numbered boxes, not just the words (DIAN brochures mention them too).
  const isRut = /registro unico tributario|formulario del registro/.test(key) && /35\.\s*razon social/.test(key) && /5\.\s*numero de identificacion tributaria/.test(key);
  const isCamara = /camara de comercio/.test(key) && /(certificado|matricula)/.test(key);
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
    const mail = rutBox(ls, /^42\.\s*Correo/i)?.replace(/\s+/g, "").toLowerCase();
    if (mail && !ISSUER_MAIL.test(mail.split("@")[1] ?? "")) f.email = mail;
    const tel = rutBox(ls, /^44\.\s*Tel[eé]fono/i);
    if (tel && digits(tel).length >= 7) f.phone = digits(tel);
    const ciiu = rutBox(ls, /^46\.\s*C[oó]digo/i);
    if (ciiu && digits(ciiu).length >= 4) f.ciiu = digits(ciiu).slice(0, 4);
  }

  if (isCamara || !isRut) {
    f.name ??= labelled(tl, /razon social|nombre o razon social|nombre/);
    const nit = labelled(tl, /n\.?i\.?t\.?/);
    if (nit && !f.taxId) {
      const m = nit.match(/(\d[\d.]{5,})\s*-?\s*(\d)?/);
      if (m) f.taxId = formatNit(m[1], m[2]);
    }
    f.address ??= labelled(tl, /direccion del domicilio principal|direccion comercial|direccion/);
    f.city ??= labelled(tl, /municipio|ciudad/);
    const tel = labelled(tl, /telefono comercial 1|telefono(?: comercial)?/);
    if (tel && !f.phone && digits(tel).length >= 7) f.phone = digits(tel).slice(0, 12);
  }

  // Email: never the first address found. The one that belongs to the company, by its label and its name.
  if (!f.email) f.email = pickCompanyEmail(tl, f.name ?? f.tradeName);
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
