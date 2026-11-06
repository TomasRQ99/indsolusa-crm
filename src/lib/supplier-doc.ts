import { db } from "@/lib/db";
import { partKey } from "@/lib/parts";

// Reads a supplier's official quote or proforma invoice (text PDF) without AI:
// header (their number, date, validity, currency, Incoterm, lead time, payment terms) and the item lines
// whose code matches a part in our catalog (or looks like a part number). Everything is shown for review before saving.
// Bank details on the document are only compared with the verified profile, never stored as bank data.

export const MAX_SUPPLIER_DOC_BYTES = 8 * 1024 * 1024;

export type DocLine = {
  code: string; description: string; qty: number | null; unitPrice: number | null; total: number | null;
  leadText: string | null; partId: string | null; partMpn: string | null; confident: boolean;
};
export type DocHeader = {
  kind: "QUOTE" | "PROFORMA"; reference: string | null; issuedAt: string | null; validUntil: string | null; validDays: number | null;
  currency: string | null; incoterm: string | null; leadText: string | null; paymentTerms: string | null;
};
export type DocReading = { readable: boolean; header: DocHeader; lines: DocLine[]; bankNumbers: string[] };

type Item = { s: string; x: number; y: number; page: number };

async function pdfLines(bytes: Uint8Array): Promise<string[][]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const items: Item[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 8); p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    for (const raw of content.items as { str?: string; transform?: number[] }[]) {
      if (typeof raw.str === "string" && raw.transform && raw.str.trim()) items.push({ s: raw.str.trim(), x: raw.transform[4], y: raw.transform[5], page: p });
    }
  }
  // Same page and (almost) the same height = one visual line, left to right.
  items.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const out: Item[][] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last[0].page === it.page && Math.abs(last[0].y - it.y) <= 3) last.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x).map((i) => i.s));
}

/** "1,450.00" · "1.450,00" · "1450" · "USD 1,450.00" → 1450. Null if it isn't a number. */
export function parseMoney(raw: string): number | null {
  let s = raw.replace(/(USD|US\$|EUR|COP|GBP|€|\$)/gi, "").replace(/\s/g, "");
  if (!/^-?\d[\d.,']*$/.test(s)) return null;
  s = s.replace(/'/g, "");
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const dec = s.length - lastComma - 1;
    s = dec === 3 && (s.match(/,/g) ?? []).length >= 1 && !/^0,/.test(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  } else if (lastDot >= 0 && (s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

const MONTHS: Record<string, number> = { jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12 };
/** Dates as suppliers print them. dd/mm is assumed when ambiguous (it's shown for review). */
export function parseDate(raw: string, monthFirst = false): string | null {
  const s = raw.trim().toLowerCase();
  let y: number, m: number, d: number;
  let r = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let a = +r[1], b = +r[2];
    if (b > 12 && a <= 12) [a, b] = [b, a];
    else if (monthFirst && a <= 12 && b <= 12) [a, b] = [b, a];
    d = a; m = b; y = +r[3] < 100 ? 2000 + +r[3] : +r[3];
  } else if ((r = s.match(/(\d{1,2})\.?\s*(?:de\s+)?([a-z]{3})[a-z]*\.?,?\s*(?:de\s+)?(\d{4})/))) { d = +r[1]; m = MONTHS[r[2]] ?? 0; y = +r[3]; }
  else if ((r = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/))) { m = MONTHS[r[1]] ?? 0; d = +r[2]; y = +r[3]; }
  else return null;
  if (!m || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "4-6 weeks" → 28–42 days · "10 días" → 10 · "ex stock" → 0. */
export function parseLead(text: string | null): { min: number | null; max: number | null } {
  if (!text) return { min: null, max: null };
  const t = text.toLowerCase();
  if (/\b(ex[- ]?stock|en stock|in stock|inmediat|immediate|disponible)\b/.test(t)) return { min: 0, max: 5 };
  const r = t.match(/(\d+)\s*(?:-|–|a|to|bis)?\s*(\d+)?\s*(semanas?|weeks?|wks?|sem|wochen|d[ií]as?|days?|business days|h[aá]biles|tage|months?|meses?)/);
  if (!r) return { min: null, max: null };
  const k = /sem|week|wk|woch/.test(r[3]) ? 7 : /month|mes/.test(r[3]) ? 30 : 1;
  const a = +r[1] * k, b = r[2] ? +r[2] * k : a;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

const INCOTERMS = /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b[\s,:-]*([A-Za-zÀ-ÿ .]{0,24})?/;
const LEAD_RE = /\b(lead\s*time|delivery\s*time|delivery|plazo de entrega|tiempo de entrega|entrega|lieferzeit)\b\s*[:\-]?\s*(.{0,40})/i;

function header(lines: string[], full: string, monthFirst: boolean): DocHeader {
  const find = (re: RegExp, group = 1) => { for (const l of lines) { const m = l.match(re); if (m?.[group]?.trim()) return m[group].trim(); } return null; };
  const kind = /pro\s*-?\s*forma/i.test(full) ? "PROFORMA" : "QUOTE";
  const reference = find(/\b(?:quotation|quote|offer|proforma(?:\s+invoice)?|p\.?\s?i\.?|cotizaci[oó]n|oferta|factura\s+proforma|angebot)\s*(?:no\.?|nr\.?|number|n[°º.o]*|#)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,30})/i);
  const issuedRaw = find(/\b(?:date|fecha|datum|issued)\b\s*[:\-]?\s*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{2,4}|[0-9]{1,2}\.?\s*(?:de\s+)?[A-Za-z]{3,10}\.?,?\s*(?:de\s+)?[0-9]{4}|[A-Za-z]{3,10}\.?\s+[0-9]{1,2},?\s+[0-9]{4})/i);
  const validRaw = find(/\b(?:valid(?:ity)?(?:\s+until|\s+till|\s+through)?|v[aá]lid[ao]\s+hasta|validez(?:\s+hasta)?|g[uü]ltig\s+bis)\b\s*[:\-]?\s*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{2,4}|[0-9]{1,2}\.?\s*(?:de\s+)?[A-Za-z]{3,10}\.?,?\s*(?:de\s+)?[0-9]{4}|[A-Za-z]{3,10}\.?\s+[0-9]{1,2},?\s+[0-9]{4})/i);
  const validDays = find(/\b(?:valid(?:ity)?|validez|v[aá]lida|g[uü]ltig)\b[^0-9\n]{0,15}(\d{1,3})\s*(?:days|d[ií]as|tage)/i);
  let issuedAt = issuedRaw ? parseDate(issuedRaw, monthFirst) : null;
  let validUntil = validRaw ? parseDate(validRaw, monthFirst) : null;
  // Validity before the issue date means the day/month order was the other one.
  if (issuedAt && validUntil && validUntil < issuedAt && issuedRaw && validRaw) {
    const i2 = parseDate(issuedRaw, !monthFirst), v2 = parseDate(validRaw, !monthFirst);
    if (i2 && v2 && v2 >= i2) { issuedAt = i2; validUntil = v2; }
  }
  if (!validUntil && validDays && issuedAt) {
    const d = new Date(`${issuedAt}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(validDays)); validUntil = d.toISOString().slice(0, 10);
  }
  // Currency: the one printed most often.
  const counts: Record<string, number> = { USD: (full.match(/\bUSD\b|US\$/g) ?? []).length, EUR: (full.match(/\bEUR\b|€/g) ?? []).length, COP: (full.match(/\bCOP\b/g) ?? []).length, GBP: (full.match(/\bGBP\b|£/g) ?? []).length };
  const currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const cur = currency[1] > 0 ? currency[0] : /\$/.test(full) ? "USD" : null;
  const inc = full.match(INCOTERMS);
  const incoterm = inc ? `${inc[1]}${inc[2] && /[a-z]/i.test(inc[2]) ? ` ${inc[2].trim().replace(/\s+(incoterms?.*)$/i, "")}` : ""}`.trim().slice(0, 40) : null;
  const leadText = find(LEAD_RE, 2)?.replace(/[|;].*$/, "").trim().slice(0, 60) || null;
  const paymentTerms = find(/\b(?:payment(?:\s+terms)?|terms of payment|condiciones de pago|forma de pago|t[eé]rminos de pago|zahlung(?:sbedingungen)?)\b\s*[:\-]?\s*(.{3,60})/i);
  return { kind, reference, issuedAt, validUntil, validDays: validDays ? Number(validDays) : null, currency: cur, incoterm, leadText: leadText && /\d|stock/i.test(leadText) ? leadText : null, paymentTerms };
}

const looksLikeCode = (t: string) => t.length >= 4 && t.length <= 40 && /\d/.test(t) && /^[A-Z0-9][A-Z0-9.\-/ ]*[A-Z0-9]$/i.test(t) && !/^\d{1,3}([.,]\d{3})*([.,]\d{1,2})?$/.test(t) && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(t);

/** Reads the document and matches its lines against the catalog. */
/** monthFirst: the supplier writes dates as mm/dd (United States). */
export async function readSupplierDoc(bytes: Uint8Array, opts: { monthFirst?: boolean } = {}): Promise<DocReading & { text: string }> {
  const raw = await pdfLines(bytes);
  const lines = raw.map((l) => l.join(" "));
  const full = lines.join("\n");
  const head = header(lines, full, !!opts.monthFirst);
  if (full.replace(/\s/g, "").length < 40) return { readable: false, header: head, lines: [], bankNumbers: [], text: full };

  // Catalog keys (part numbers and aliases) → part.
  const [parts, aliases] = await Promise.all([
    db.part.findMany({ where: { mergedIntoId: null }, select: { id: true, mpn: true, mpnKey: true } }),
    db.partAlias.findMany({ where: { kind: { not: "NAME" } }, select: { codeKey: true, part: { select: { id: true, mpn: true, mergedIntoId: true } } } }),
  ]);
  const byKey = new Map<string, { id: string; mpn: string }>();
  parts.forEach((p) => byKey.set(p.mpnKey, { id: p.id, mpn: p.mpn }));
  aliases.forEach((a) => { if (!byKey.has(a.codeKey) && !a.part.mergedIntoId) byKey.set(a.codeKey, { id: a.part.id, mpn: a.part.mpn }); });

  const out: DocLine[] = [];
  for (const pieces of raw) {
    const line = pieces.join(" ");
    if (/\b(sub\s*-?total|total|iva|vat|tax|freight|flete|shipping|bank|iban|swift)\b/i.test(line) && !pieces.some((p) => byKey.has(partKey(p)))) continue;
    // The code: a piece (or two adjacent pieces) that is in the catalog, else the first piece that looks like a part number.
    let codeIdx = -1, code = "", match: { id: string; mpn: string } | null = null;
    for (let i = 0; i < pieces.length && !match; i++) {
      for (const cand of [pieces[i], i + 1 < pieces.length ? `${pieces[i]}${pieces[i + 1]}` : ""]) {
        const k = partKey(cand);
        if (k.length >= 3 && byKey.has(k)) { match = byKey.get(k)!; codeIdx = i; code = cand === pieces[i] ? pieces[i] : `${pieces[i]} ${pieces[i + 1]}`; break; }
      }
    }
    // Money-looking pieces after the code.
    const nums = pieces.map((p, i) => ({ i, v: /[\d]/.test(p) && i !== codeIdx ? parseMoney(p) : null, raw: p })).filter((n) => n.v != null && n.i > codeIdx);
    if (!match) {
      if (nums.length < 2) continue;
      const first = pieces.findIndex((p, i) => i < 3 && looksLikeCode(p) && !(i === 0 && /^\d{1,3}$/.test(p)));
      if (first < 0) continue;
      codeIdx = first; code = pieces[first];
    }
    const after = nums.filter((n) => n.i > codeIdx);
    if (!after.length) continue;
    const desc = pieces.slice(codeIdx + 1, after[0].i).join(" ").replace(/\s+/g, " ").trim();
    const values = after.map((n) => n.v!);
    let qty: number | null = null, unit: number | null = null, total: number | null = null, confident = false;
    // Try every (qty, unit, total) in order: qty × unit ≈ total confirms the reading.
    outer: for (let a = 0; a < values.length; a++) for (let b = a + 1; b < values.length; b++) for (let c = b + 1; c < values.length; c++) {
      const [q, u, tt] = [values[a], values[b], values[c]];
      if (Number.isInteger(q) && q > 0 && q < 1e6 && u > 0 && Math.abs(q * u - tt) <= Math.max(0.02, tt * 0.005)) { qty = q; unit = u; total = tt; confident = true; break outer; }
    }
    if (!confident) {
      const ints = values.filter((v) => Number.isInteger(v) && v > 0 && v < 10000);
      qty = values.length >= 3 ? ints[0] ?? null : null;
      unit = values.length >= 2 ? values[values.length - 2] : values[0];
      total = values.length >= 2 ? values[values.length - 1] : null;
    }
    const lead = line.match(/(\d+\s*(?:-|–|a|to)?\s*\d*\s*(?:semanas?|weeks?|wks?|d[ií]as?|days?)|ex[- ]?stock|en stock|in stock)/i)?.[1] ?? null;
    out.push({ code: code.slice(0, 60), description: desc.slice(0, 200), qty, unitPrice: unit, total, leadText: lead, partId: match?.id ?? null, partMpn: match?.mpn ?? null, confident });
  }

  const bankNumbers = [...full.matchAll(/\b(?:IBAN|account\s*(?:no\.?|number|#)|acct|cuenta(?:\s+(?:corriente|de ahorros|no\.?|n[°º]))?|routing|ABA|CLABE)\b\s*[:#.]?\s*([A-Z]{0,2}[0-9][0-9 \-]{5,34})/gi)].map((m) => m[1].replace(/\D/g, "")).filter((d) => d.length >= 6);
  return { readable: true, header: head, lines: out.slice(0, 60), bankNumbers: [...new Set(bankNumbers)], text: full.slice(0, 60000) };
}

/** Bank details printed on the document vs. the supplier's verified profile. Returns a warning or null. */
export function bankCheck(found: string[], verifiedAccount: string | null, verifiedAt: Date | null): string | null {
  if (!found.length) return null;
  const v = (verifiedAccount ?? "").replace(/\D/g, "");
  if (v && verifiedAt && found.every((f) => f.endsWith(v.slice(-6)) || v.endsWith(f.slice(-6)))) return null;
  if (!v || !verifiedAt) return "NO_VERIFIED";
  return "DIFFERENT";
}
