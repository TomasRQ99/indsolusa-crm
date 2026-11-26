// Presupuesto comercial · Historial cargado. Pure rules: reading the rows a person pastes from Excel (or a CSV file)
// with the commercial history from before SOLU, or with Siigo's invoicing. No database here.
// Nothing is guessed: a row whose company, person, month or figure cannot be read is reported with its line and the
// reason, and is left out.

import type { Kpi } from "./sales-budget-rules";

type Txt = { es: string; en: string };
export type HistorySource = "ANTERIOR" | "SIIGO";
export const SOURCE_TXT: Record<HistorySource, Txt> = {
  ANTERIOR: { es: "Sistema anterior", en: "Earlier system" },
  SIIGO: { es: "Siigo", en: "Siigo" },
};
export const UNITS = [1, 1000, 1000000] as const;
export const UNIT_TXT: Record<number, Txt> = { 1: { es: "pesos (o dólares) completos", en: "whole pesos (or dollars)" }, 1000: { es: "miles", en: "thousands" }, 1000000: { es: "millones", en: "millions" } };

/** Lower case, no accents, single spaces, letters and digits only. */
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A company name without its legal ending, so "Acme S.A.S." and "ACME SAS" are the same company. */
export const normCompany = (s: unknown) => norm(s).replace(/\b(s a s|sas|s a|sa|ltda|limitada|s en c|inc|llc|corp|e u|eu|bic)\b/g, " ").replace(/\s+/g, " ").trim();
export const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
/** Two tax ids are the same when their digits match, with or without the verification digit at the end. */
export function sameTaxId(a: string, b: string) {
  const x = digits(a), y = digits(b);
  if (x.length < 6 || y.length < 6) return false;
  return x === y || (x.length === y.length + 1 && x.startsWith(y)) || (y.length === x.length + 1 && y.startsWith(x));
}

export type Column = "NIT" | "EMPRESA" | "NEGOCIADOR" | "ANIO" | "MES" | "PERIODO" | Kpi;
/** The heading of each column on the template, and what a pasted heading is matched against. */
export const COLUMNS: { col: Column; es: string; en: string; match: (h: string) => boolean }[] = [
  { col: "NIT", es: "NIT", en: "Tax ID", match: (h) => /^(nit|tax id|identificacion|numero de identificacion)$/.test(h) },
  { col: "EMPRESA", es: "Empresa", en: "Company", match: (h) => /^(empresa|cliente|company|customer|razon social|nombre)$/.test(h) },
  { col: "NEGOCIADOR", es: "Negociador", en: "Negotiator", match: (h) => /^(negociador|vendedor|asesor|negotiator|comercial)$/.test(h) },
  { col: "ANIO", es: "Año", en: "Year", match: (h) => /^(ano|year|anio)$/.test(h) },
  { col: "MES", es: "Mes", en: "Month", match: (h) => /^(mes|month)$/.test(h) },
  { col: "PERIODO", es: "Periodo", en: "Period", match: (h) => /^(periodo|period|fecha|date)$/.test(h) },
  { col: "SOL_N", es: "Solicitudes (número)", en: "Requests (number)", match: (h) => /solicitud|request/.test(h) },
  { col: "COT_N", es: "Cotizaciones (número)", en: "Quotes (number)", match: (h) => /(cotizacion|quote).*(numero|number|cantidad)|^(n|no|num|numero) (de )?(cotizacion|quote)|^cotizaciones$|^quotes$/.test(h) },
  { col: "COT_COP", es: "Cotizado (valor)", en: "Quoted (value)", match: (h) => /cotizado|quoted|(cotizacion|quote).*(valor|value)|^valor (de )?cotiza/.test(h) },
  { col: "OC_N", es: "Órdenes de compra (número)", en: "Purchase orders (number)", match: (h) => /(orden|oc|po|purchase).*(numero|number|cantidad)|^(n|no|num|numero) (de )?(oc|orden|po)/.test(h) },
  { col: "OC_COP", es: "Órdenes de compra (valor)", en: "Purchase orders (value)", match: (h) => /orden|^oc|^po|purchase/.test(h) && !/numero|number|cantidad/.test(h) && !/factur|invoic/.test(h) },
  { col: "ESA_COP", es: "Eságara (valor)", en: "Eságara (value)", match: (h) => /esagara|esagra|utilidad|margen|profit|margin/.test(h) },
  { col: "FACT_COP", es: "Facturación (valor)", en: "Invoicing (value)", match: (h) => /factur|invoic/.test(h) && !/numero|number|cantidad/.test(h) },
];
const MONEY: Kpi[] = ["OC_COP", "FACT_COP", "ESA_COP", "COT_COP"];
const COUNT: Kpi[] = ["OC_N", "COT_N", "SOL_N"];
export const VALUE_COLUMNS: Kpi[] = ["SOL_N", "COT_N", "COT_COP", "OC_N", "OC_COP", "ESA_COP", "FACT_COP"];

const MONTH_NAMES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTH_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "3", "03", "marzo", "Mar" → 3; null when it is not a month. */
export function readMonth(raw: unknown): number | null {
  const s = norm(raw);
  if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 1 && n <= 12 ? n : null; }
  const k = s.slice(0, 3);
  const i = MONTH_NAMES.indexOf(k) >= 0 ? MONTH_NAMES.indexOf(k) : MONTH_EN.indexOf(k);
  return s.length >= 3 && i >= 0 ? i + 1 : null;
}
/** "2024-03", "03/2024", "2024/3", "mar 2024", "marzo de 2024", "15/03/2024" → "2024-03". */
export function readPeriod(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  // A date cell read straight from an Excel file comes as its serial number (days since 1900).
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = Number(s); if (n >= 36526 && n <= 73050) { const d = new Date(Math.round((n - 25569) * 864e5)); return okPeriod(d.getUTCFullYear(), d.getUTCMonth() + 1); } }
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s);
  if (m) return okPeriod(Number(m[1]), Number(m[2]));
  m = /^(?:\d{1,2}[-/.])?(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return okPeriod(Number(m[2]), Number(m[1]));
  m = /^([a-záéíóú]+)\.?(?:\s+de)?[\s-/]+(\d{4})$/i.exec(s);
  if (m) { const mo = readMonth(m[1]); return mo ? okPeriod(Number(m[2]), mo) : null; }
  return null;
}
const okPeriod = (y: number, m: number) => (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, "0")}` : null);

/** A number as Excel shows it in Colombia ("1.234.567,89") or in English ("1,234,567.89"), with or without "$".
 *  Empty → null; unreadable → NaN. A single separator followed by exactly three digits is read as thousands. */
export function readNumber(raw: unknown): number | null {
  let s = String(raw ?? "").replace(/[\s$]|cop|usd/gi, "");
  if (s === "" || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  let dec = "";
  if (dots && commas) dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
  else if (dots + commas === 1) { const sep = dots ? "." : ","; if (!/^\d{1,3}[.,]\d{3}$/.test(s)) dec = sep; }
  if (dec) {
    if ((dec === "." ? dots : commas) > 1) return NaN;
    const [a, b] = s.split(dec);
    s = `${a.replace(/[.,]/g, "")}.${b}`;
  } else s = s.replace(/[.,]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/** Splits pasted text into cells: tabs (copied from Excel), or ";" / "," (a CSV file), with quoted cells. */
export function splitRows(text: string): string[][] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = clean.split("\n").find((l) => l.trim() !== "") ?? "";
  const sep = first.includes("\t") ? "\t" : (first.match(/;/g) ?? []).length >= (first.match(/,/g) ?? []).length && first.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let k = 0; k < clean.length; k++) {
    const c = clean[k];
    if (quoted) {
      if (c === '"') { if (clean[k + 1] === '"') { cell += '"'; k++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

export type Problem = { line: number; code: "empresa" | "empresa-varias" | "negociador" | "mes" | "valor" | "entero" | "vacia" | "repetida" | "sin-tasa" | "futuro"; detail: string };
export type ParsedRow = { line: number; accountId: string; userId: string | null; month: string; values: Partial<Record<Kpi, number>> };
export type Parsed = {
  /** null = the headings could not be read; `missing` says which ones are needed. */
  columns: Column[] | null; missing: Txt[]; ignored: string[];
  read: number; rows: ParsedRow[]; problems: Problem[];
};
export type Directory = {
  accounts: { id: string; name: string; taxId: string | null }[];
  users: { id: string; name: string; email: string }[];
};

/** Reads the pasted text against the companies and people of SOLU. `current` = this month (YYYY-MM): history is
 *  about months already finished or in course, never the future. Money comes back in the pasted currency × unit. */
export function parseHistory(text: string, source: HistorySource, unit: number, dir: Directory, current: string): Parsed {
  const all = splitRows(text).map((cells, k) => ({ cells, line: k + 1 })).filter((r) => r.cells.some((c) => c !== ""));
  const out: Parsed = { columns: null, missing: [], ignored: [], read: 0, rows: [], problems: [] };
  if (!all.length) { out.missing = [{ es: "las filas", en: "the rows" }]; return out; }
  const head = all[0].cells.map(norm);
  const cols: (Column | null)[] = head.map((h) => (h === "" ? null : COLUMNS.find((c) => c.match(h))?.col ?? null));
  // A heading claimed twice keeps its first column.
  const seen = new Set<Column>();
  for (let k = 0; k < cols.length; k++) { const c = cols[k]; if (c) { if (seen.has(c)) cols[k] = null; else seen.add(c); } }
  out.ignored = all[0].cells.filter((h, k) => h !== "" && !cols[k]);
  const has = (c: Column) => seen.has(c);
  const wanted = source === "SIIGO" ? (["FACT_COP"] as Kpi[]) : VALUE_COLUMNS;
  if (!has("NIT") && !has("EMPRESA")) out.missing.push({ es: "«NIT» o «Empresa»", en: "«Tax ID» or «Company»" });
  if (!has("PERIODO") && !(has("ANIO") && has("MES"))) out.missing.push({ es: "«Año» y «Mes» (o «Periodo»)", en: "«Year» and «Month» (or «Period»)" });
  if (!wanted.some(has)) out.missing.push(source === "SIIGO" ? { es: "«Facturación (valor)»", en: "«Invoicing (value)»" } : { es: "al menos una columna de cifras", en: "at least one column of figures" });
  if (out.missing.length) return out;
  out.columns = cols.filter((c): c is Column => !!c);
  if (source === "SIIGO") out.ignored.push(...all[0].cells.filter((_, k) => { const c = cols[k]; return !!c && VALUE_COLUMNS.includes(c as Kpi) && c !== "FACT_COP"; }));

  const byName = new Map<string, string[]>();
  for (const a of dir.accounts) { const k = normCompany(a.name); if (k) byName.set(k, [...(byName.get(k) ?? []), a.id]); }
  const userBy = new Map<string, string[]>();
  for (const u of dir.users) for (const k of [norm(u.name), u.email.trim().toLowerCase()]) if (k) userBy.set(k, [...(userBy.get(k) ?? []), u.id]);
  const keys = new Set<string>();

  for (const { cells, line } of all.slice(1)) {
    out.read++;
    const get = (c: Column) => { const k = cols.indexOf(c); return k < 0 ? "" : cells[k] ?? ""; };
    const bad = (code: Problem["code"], detail: string) => { out.problems.push({ line, code, detail }); };
    // Company: the tax id decides when it is given; otherwise the exact name.
    const nit = get("NIT"), name = get("EMPRESA");
    let ids: string[] = [];
    if (digits(nit).length >= 6) ids = dir.accounts.filter((a) => a.taxId && sameTaxId(a.taxId, nit)).map((a) => a.id);
    if (!ids.length && name) ids = byName.get(normCompany(name)) ?? [];
    if (ids.length !== 1) { bad(ids.length ? "empresa-varias" : "empresa", [nit, name].filter(Boolean).join(" · ") || "—"); continue; }
    const rawUser = get("NEGOCIADOR");
    let userId: string | null = null;
    if (rawUser) {
      const hit = userBy.get(rawUser.includes("@") ? rawUser.trim().toLowerCase() : norm(rawUser)) ?? [];
      if (hit.length !== 1) { bad("negociador", rawUser); continue; }
      userId = hit[0];
    }
    let month: string | null = null;
    if (has("ANIO") && has("MES") && (get("ANIO") || get("MES"))) { const y = Number(digits(get("ANIO"))), m = readMonth(get("MES")); month = m ? okPeriod(y, m) : null; }
    else if (has("PERIODO")) month = readPeriod(get("PERIODO"));
    if (!month) { bad("mes", [get("ANIO"), get("MES"), get("PERIODO")].filter(Boolean).join(" ") || "—"); continue; }
    if (month > current) { bad("futuro", month); continue; }
    const values: Partial<Record<Kpi, number>> = {};
    let wrong = false;
    for (const k of wanted) {
      if (!has(k)) continue;
      const n = readNumber(get(k));
      if (n == null) continue;
      if (Number.isNaN(n) || Math.abs(n) > 1e15) { bad("valor", `${COLUMNS.find((c) => c.col === k)!.es}: «${get(k)}»`); wrong = true; break; }
      if (COUNT.includes(k)) {
        if (!Number.isInteger(n) || n < 0 || n > 1e6) { bad("entero", `${COLUMNS.find((c) => c.col === k)!.es}: «${get(k)}»`); wrong = true; break; }
        values[k] = n;
      } else values[k] = Math.round(n * unit * 100) / 100;
    }
    if (wrong) continue;
    if (!Object.keys(values).length) { bad("vacia", month); continue; }
    const key = `${ids[0]}|${userId ?? ""}|${month}`;
    if (keys.has(key)) { bad("repetida", `${name || nit} · ${month}`); continue; }
    keys.add(key);
    out.rows.push({ line, accountId: ids[0], userId, month, values });
  }
  return out;
}
export const isMoney = (k: Kpi) => MONEY.includes(k);

// ---------- The owner's invoice sheet (one row per invoice, in dollars) ----------

export type InvoiceSheet = {
  /** The same rows the review reads: one per company, negotiator and month. */
  text: string;
  invoices: number; total: number;
  /** What the sheet's own "Total" row says, when it has one. */
  fileTotal: number | null;
  /** Rows left out: annulled invoices, and rows without customer, date or amount. */
  annulled: number; unread: number;
};
const sheetMoney = (v: string | number | null): number | null => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[\s$]|US/gi, ""));
  const n = Number(s.replace(/[^\d.,]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
};
const sheetMonth = (v: string | number | null): string | null => {
  // An Excel date is a day count: 25569 is 1970-01-01.
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 7);
  return v == null ? null : readPeriod(String(v));
};
/** Reads the invoice sheet of the earlier system as it is exported: «Fecha, Factura, Cliente, Vendedor, Estado, Envío,
 *  Impuesto, Importe», one invoice per row, amounts in dollars written "$1,698.12". Returns null when the sheet is
 *  not that layout. The invoices are added up per customer, seller and month; an invoice stands for a purchase
 *  order (the owner's decision), so each month carries invoicing, order value and number of orders.
 *  `sellerOk` = the seller is exactly one SOLU user; other sellers' figures go to whoever owns the company. */
export function invoiceSheet(rows: (string | number | null)[][], sellerOk: (name: string) => boolean): InvoiceSheet | null {
  const at = rows.findIndex((r) => { const h = r.map(norm); return h.includes("fecha") && h.includes("factura") && h.includes("cliente") && h.includes("importe"); });
  if (at < 0) return null;
  const h = rows[at].map(norm);
  const c = { date: h.indexOf("fecha"), client: h.indexOf("cliente"), seller: h.indexOf("vendedor"), state: h.indexOf("estado"), amount: h.indexOf("importe") };
  const by = new Map<string, { client: string; seller: string; month: string; usd: number; n: number }>();
  const out: InvoiceSheet = { text: "", invoices: 0, total: 0, fileTotal: null, annulled: 0, unread: 0 };
  for (const r of rows.slice(at + 1)) {
    if (!r || r.every((x) => x == null || String(x).trim() === "")) continue;
    if (norm(r[0]) === "total" || norm(r[c.client]) === "total") { out.fileTotal = sheetMoney(r[c.amount]); continue; }
    const client = String(r[c.client] ?? "").replace(/\s+/g, " ").trim(), month = sheetMonth(r[c.date]), usd = sheetMoney(r[c.amount]);
    if (!client || !month || usd == null) { out.unread++; continue; }
    if (c.state >= 0 && /anulad|cancelad|void/.test(norm(r[c.state]))) { out.annulled++; continue; }
    const rawSeller = c.seller >= 0 ? String(r[c.seller] ?? "").replace(/\s+/g, " ").trim() : "";
    const seller = rawSeller && sellerOk(rawSeller) ? rawSeller : "";
    const key = `${normCompany(client)}|${norm(seller)}|${month}`;
    const g = by.get(key) ?? { client, seller, month, usd: 0, n: 0 };
    g.usd += usd; g.n++; by.set(key, g);
    out.invoices++; out.total += usd;
  }
  out.total = Math.round(out.total * 100) / 100;
  const body = [...by.values()].sort((a, b) => (a.month + a.client < b.month + b.client ? -1 : 1)).map((g) => { const v = (Math.round(g.usd * 100) / 100).toFixed(2); return [g.client, g.seller, g.month, g.n, v, v].join("\t"); });
  out.text = ["Empresa\tNegociador\tPeriodo\tÓrdenes de compra (número)\tÓrdenes de compra (valor)\tFacturación (valor)", ...body].join("\n");
  return out;
}

export const PROBLEM_TXT: Record<Problem["code"], Txt> = {
  empresa: { es: "La empresa no está en SOLU con ese NIT ni con ese nombre exacto. Créala en Clientes o corrige el NIT.", en: "The company is not in SOLU with that tax ID or that exact name. Create it in Customers or fix the tax ID." },
  "empresa-varias": { es: "Hay más de una empresa en SOLU con ese NIT o nombre: escribe el NIT de la correcta.", en: "More than one company in SOLU has that tax ID or name: type the tax ID of the right one." },
  negociador: { es: "El negociador no coincide con una sola persona de SOLU: escribe su nombre completo como aparece en EQUIPO, o su correo.", en: "The negotiator doesn't match exactly one person in SOLU: type the full name as shown in TEAM, or the email." },
  mes: { es: "No se pudo leer el año y el mes.", en: "The year and month could not be read." },
  futuro: { es: "Ese mes todavía no llega: el historial es de meses pasados.", en: "That month hasn't come yet: history is about past months." },
  valor: { es: "La cifra no es un número.", en: "The figure is not a number." },
  entero: { es: "El número de casos debe ser entero, de cero en adelante.", en: "The number of cases must be a whole number, from zero up." },
  vacia: { es: "La fila no trae ninguna cifra.", en: "The row has no figure." },
  repetida: { es: "La misma empresa, negociador y mes ya están en una fila anterior.", en: "The same company, negotiator and month are already in an earlier row." },
  "sin-tasa": { es: "No hay TRM oficial guardada para ese mes: no se pudo pasar a dólares.", en: "There is no official TRM stored for that month: it could not be turned into dollars." },
};

/** The template a person fills in Excel: the headings and two example rows. */
export function templateRows(es: boolean, source: HistorySource): string[][] {
  const h = (c: Column) => { const x = COLUMNS.find((k) => k.col === c)!; return es ? x.es : x.en; };
  if (source === "SIIGO") return [[h("NIT"), h("EMPRESA"), h("ANIO"), h("MES"), h("FACT_COP")], ["900123456", es ? "Empresa de ejemplo S.A.S." : "Example company", "2026", "1", "45000000"], ["900123456", es ? "Empresa de ejemplo S.A.S." : "Example company", "2026", "2", "38500000"]];
  const cols: Column[] = ["NIT", "EMPRESA", "NEGOCIADOR", "ANIO", "MES", ...VALUE_COLUMNS];
  return [cols.map(h), ["900123456", es ? "Empresa de ejemplo S.A.S." : "Example company", "", "2025", "1", "6", "5", "120000000", "2", "48000000", "9600000", "30000000"], ["900123456", es ? "Empresa de ejemplo S.A.S." : "Example company", "", "2025", "2", "4", "4", "90000000", "1", "22000000", "4400000", "48000000"]];
}
