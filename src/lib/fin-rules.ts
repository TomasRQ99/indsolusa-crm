// Mercado M3 · Economic intelligence — pure rules (no database).
// Column recognition, number parsing, NIT checks, row validation (No Debt Zone §9.3), derived indicators
// with their formula and inputs (§9.5), explainable facts (§9.6) and economic signals (§9.8).
// Thresholds are a management decision (§32): DEFAULT_THRESHOLDS is a proposal, editable and versioned.
import { fold } from "./part-lexicon";
import { mulMoney } from "./money";
import type { Cell } from "./sheet-read";

type L = { es: string; en: string };
export const FORMULA_VERSION = "fin-v1";

export type FieldKey = "nit" | "name" | "year" | "ciiu" | "sector" | "department" | "city" | "revenue" | "operatingIncome" | "netIncome" | "assets" | "liabilities" | "equity" | "currentAssets" | "currentLiabilities" | "debt" | "employees";
export const MONEY_FIELDS = ["revenue", "operatingIncome", "netIncome", "assets", "liabilities", "equity", "currentAssets", "currentLiabilities", "debt"] as const;
export type MoneyField = (typeof MONEY_FIELDS)[number];

export const FIELDS: Record<FieldKey, L & { words: string[] }> = {
  nit: { es: "NIT", en: "Tax ID (NIT)", words: ["nit", "nit empresa", "numero de identificacion", "identificacion", "nit sin dv", "numero nit"] },
  name: { es: "Razón social", en: "Company name", words: ["razon social", "nombre", "razon social de la sociedad", "nombre de la sociedad", "empresa", "sociedad"] },
  year: { es: "Año fiscal", en: "Fiscal year", words: ["ano", "ano de corte", "anio", "periodo", "fecha de corte", "vigencia", "ano fiscal", "year", "fecha corte"] },
  ciiu: { es: "CIIU", en: "CIIU code", words: ["ciiu", "codigo ciiu", "ciiu principal", "actividad economica ciiu"] },
  sector: { es: "Sector / macrosector", en: "Sector", words: ["macrosector", "sector", "macro sector", "actividad economica"] },
  department: { es: "Departamento", en: "Department / state", words: ["departamento", "departamento domicilio", "estado"] },
  city: { es: "Ciudad", en: "City", words: ["ciudad", "ciudad domicilio", "municipio", "municipio domicilio"] },
  revenue: { es: "Ingresos", en: "Revenue", words: ["ingresos operacionales", "ingresos de actividades ordinarias", "ingresos", "ventas", "ingresos operacionales netos", "ventas netas", "total ingresos operacionales"] },
  operatingIncome: { es: "Utilidad operacional", en: "Operating income", words: ["utilidad operacional", "ganancia operacional", "resultado operacional", "ganancia perdida por actividades de operacion", "ganancia perdida por actividad de operacion", "utilidad perdida operacional", "resultado de actividades de operacion"] },
  netIncome: { es: "Utilidad neta", en: "Net income", words: ["ganancia perdida", "utilidad neta", "resultado del ejercicio", "ganancia perdida neta", "utilidad perdida neta", "utilidad del ejercicio"] },
  assets: { es: "Activos totales", en: "Total assets", words: ["total activos", "activos totales", "activos", "total de activos"] },
  liabilities: { es: "Pasivos totales", en: "Total liabilities", words: ["total pasivos", "pasivos totales", "pasivos", "total de pasivos"] },
  equity: { es: "Patrimonio", en: "Equity", words: ["total patrimonio", "patrimonio total", "patrimonio", "total de patrimonio"] },
  currentAssets: { es: "Activos corrientes", en: "Current assets", words: ["activos corrientes", "total activos corrientes", "activo corriente"] },
  currentLiabilities: { es: "Pasivos corrientes", en: "Current liabilities", words: ["pasivos corrientes", "total pasivos corrientes", "pasivo corriente"] },
  debt: { es: "Obligaciones financieras", en: "Financial debt", words: ["obligaciones financieras", "deuda financiera", "total obligaciones financieras"] },
  employees: { es: "Empleados", en: "Employees", words: ["empleados", "numero de empleados", "no empleados", "total empleados"] },
};
export const SCALES: Record<string, L & { factor: number }> = {
  UNITS: { es: "Pesos/dólares (sin escala)", en: "Units (no scale)", factor: 1 },
  THOUSANDS: { es: "Miles", en: "Thousands", factor: 1e3 },
  MILLIONS: { es: "Millones", en: "Millions", factor: 1e6 },
  BILLIONS: { es: "Miles de millones", en: "Billions (thousand millions)", factor: 1e9 },
};
export const SOURCE_KINDS: Record<string, L> = {
  SUPERSOCIEDADES: { es: "Superintendencia de Sociedades", en: "Superintendencia de Sociedades" },
  CAMARA: { es: "Cámara de Comercio", en: "Chamber of Commerce" },
  SECTOR: { es: "Base sectorial", en: "Sector database" },
  PROVIDED: { es: "Estados financieros suministrados", en: "Provided financial statements" },
  INTERNAL: { es: "Información propia", en: "Our own information" },
  OTHER: { es: "Otra fuente", en: "Other source" },
};

const norm = (h: Cell) => fold(String(h ?? "")).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();

/** Fields that can come once per year in "wide" files ("TOTAL ACTIVOS 2025 | TOTAL ACTIVOS 2024"). */
const PER_YEAR = new Set<FieldKey>([...MONEY_FIELDS, "employees"]);
/** A mapping target: a field ("assets") or a field of one year taken from the column title ("assets@2025"). */
export type Target = string;
export const targetOf = (v: Target) => { const [f, y] = String(v).split("@"); return { field: f as FieldKey, year: y ? Number(y) : null }; };
export const isTarget = (v: string) => { const t = targetOf(v); return t.field in FIELDS && (t.year == null || (PER_YEAR.has(t.field) && t.year >= 1990 && t.year <= 2200)); };
export const targetLabel = (v: Target): L => { const t = targetOf(v); const f = FIELDS[t.field]; return t.year ? { es: `${f.es} · ${t.year}`, en: `${f.en} · ${t.year}` } : { es: f.es, en: f.en }; };
const titleYear = (n: string) => /\b(19|20)\d{2}\b/.exec(n)?.[0] ?? null;
/** Years written in column titles of figure columns (for the per-year choices). */
export function headerYears(headers: Cell[]): number[] {
  const ys = new Set<number>();
  for (const h of headers) {
    const n = norm(h), y = titleYear(n);
    if (!y) continue;
    const base = n.replace(y, " ").replace(/\s+/g, " ").trim();
    if ([...PER_YEAR].some((k) => FIELDS[k].words.includes(base))) ys.add(Number(y));
  }
  return [...ys].sort((a, b) => b - a);
}
/** Exact header recognition only (predictable); anything else the person maps.
 *  A year inside a figure column's title makes it that year's figure. */
export function suggestMapping(headers: Cell[]): Record<number, Target> {
  const out: Record<number, Target> = {};
  const used = new Set<Target>();
  headers.forEach((h, i) => {
    const n = norm(h);
    const exact = (Object.keys(FIELDS) as FieldKey[]).find((k) => !used.has(k) && FIELDS[k].words.includes(n));
    if (exact) { out[i] = exact; used.add(exact); return; }
    const y = titleYear(n);
    if (!y) return;
    const base = n.replace(y, " ").replace(/\s+/g, " ").trim();
    const k = [...PER_YEAR].find((f) => FIELDS[f].words.includes(base) && !used.has(`${f}@${y}`));
    if (k) { out[i] = `${k}@${y}`; used.add(`${k}@${y}`); }
  });
  return out;
}
/** Header row = first row (within the first 15) that recognizes at least 2 fields; else the first non-empty row. */
export function findHeaderRow(rows: Cell[][]): number {
  for (let r = 0; r < Math.min(15, rows.length); r++) if (Object.keys(suggestMapping(rows[r] ?? [])).length >= 2) return r;
  return Math.max(0, rows.findIndex((r) => r && r.filter((c) => c != null).length >= 2));
}

/** "1.234,56" (COMMA) or "1,234.56" (DOT). Numeric cells need no style. */
export function suggestDecimalStyle(samples: Cell[]): "COMMA" | "DOT" | null {
  let comma = 0, dot = 0;
  for (const c of samples) {
    if (typeof c !== "string") continue;
    const s = c.replace(/[^\d.,]/g, "");
    if (/\d\.\d{3},\d/.test(s) || /^\d{1,3}(\.\d{3})+$/.test(s) || /,\d{1,2}$/.test(s)) comma++;
    else if (/\d,\d{3}\.\d/.test(s) || /^\d{1,3}(,\d{3})+$/.test(s) || /\.\d{1,2}$/.test(s)) dot++;
  }
  return comma && !dot ? "COMMA" : dot && !comma ? "DOT" : null;
}
export function needsDecimalStyle(samples: Cell[]) { return samples.some((c) => typeof c === "string" && /\d[.,]\d/.test(c)); }

/** Parses one amount. null = empty (not an error); NaN = unparseable. */
export function parseAmount(c: Cell, style: string | null | undefined): number | null {
  if (c == null) return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : NaN;
  let s = c.trim();
  if (!s || /^(-|—|n\/?a|nd|s\.?d\.?)$/i.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(cop|usd|us\$|\$)\s*/i, "").replace(/\s*(cop|usd)$/i, "").replace(/\s|\$/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (/[.,]/.test(s)) {
    if (style === "COMMA") s = s.replace(/\./g, "").replace(",", ".");
    else if (style === "DOT") s = s.replace(/,/g, "");
    else return NaN; // ambiguous without a style
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

/** Colombian NIT check digit (DIAN modulo 11). */
export function nitDv(nit: string): number {
  const w = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = nit.replace(/\D/g, "").split("").reverse();
  const sum = d.reduce((s, ch, i) => s + Number(ch) * w[i], 0) % 11;
  return sum > 1 ? 11 - sum : sum;
}
/** NIT key = digits without the check digit, first 9 (same rule as customers). Verifies the DV when it comes with a dash. */
export function parseNit(c: Cell): { key: string | null; error?: L } {
  if (c == null || c === "") return { key: null, error: { es: "Sin NIT", en: "No NIT" } };
  const s = typeof c === "number" ? String(Math.trunc(c)) : String(c).trim();
  const m = /^([\d.\s]+)-\s*(\d)$/.exec(s);
  const base = (m ? m[1] : s).replace(/\D/g, "");
  if (base.length < 6 || base.length > 10) return { key: null, error: { es: `NIT inválido (${s})`, en: `Invalid NIT (${s})` } };
  if (m && nitDv(base) !== Number(m[2])) return { key: null, error: { es: `El dígito de verificación no corresponde (${s})`, en: `Check digit doesn't match (${s})` } };
  return { key: base.slice(0, 9) };
}
/** Year from 2024, "2024", "2024-12-31", "31/12/2024" or an Excel date serial. */
export function parseYear(c: Cell, now = new Date()): number | null {
  if (c == null) return null;
  let y: number | null = null;
  if (typeof c === "number") y = c > 1900 && c < 2200 ? Math.trunc(c) : c > 20000 && c < 80000 ? new Date(Date.UTC(1899, 11, 30) + c * 864e5).getUTCFullYear() : null;
  else { const m = /(19|20)\d{2}/.exec(c); y = m ? Number(m[0]) : null; }
  return y && y >= 1990 && y <= now.getUTCFullYear() ? y : null;
}

export type Mapping = Record<string, Target>; // column index (as string) → field, or field@year
export type ParsedRow = { nit: string | null; name: string | null; year: number | null; ciiu: string | null; sector: string | null; department: string | null; city: string | null; values: Partial<Record<MoneyField, number>>; employees: number | null };
export type RowCheck = { parsed: ParsedRow; status: "OK" | "ERROR" | "REVIEW"; messages: L[] };

/** Material columns (§9.3): NIT, name, year (column or fixed) and at least revenue or assets. */
export function mappingProblems(mapping: Mapping, fixedYear: number | null): L[] {
  const ts = Object.values(mapping).map(targetOf);
  const f = new Set(ts.map((x) => x.field));
  const perYear = ts.some((x) => x.year);
  const p: L[] = [];
  if (!f.has("nit")) p.push({ es: "Falta la columna del NIT", en: "NIT column missing" });
  if (!f.has("name")) p.push({ es: "Falta la columna de razón social", en: "Company name column missing" });
  if (!f.has("year") && !fixedYear && !perYear) p.push({ es: "Falta el año: elige la columna o escribe el año del archivo", en: "Year missing: pick the column or type the file's year" });
  if (!f.has("revenue") && !f.has("assets")) p.push({ es: "Mapea al menos ingresos o activos", en: "Map at least revenue or assets" });
  const dup = Object.values(mapping).filter((v, i, a) => a.indexOf(v) !== i);
  if (dup.length) p.push({ es: `Hay campos asignados a dos columnas: ${[...new Set(dup)].map((d) => targetLabel(d).es).join(", ")}`, en: `Fields mapped twice: ${[...new Set(dup)].map((d) => targetLabel(d).en).join(", ")}` });
  return p;
}

const txt = (c: Cell) => (c == null ? null : String(c).trim().slice(0, 200) || null);

/** One row → parsed values + No Debt Zone checks. Scale is applied with money.ts (cents, no float drift). */
export function checkRow(row: Cell[], mapping: Mapping, o: { scale: string; decimalStyle: string | null; fixedYear: number | null; now?: Date }): RowCheck {
  const at = (k: FieldKey) => { const col = Object.entries(mapping).find(([, v]) => v === k)?.[0]; return col == null ? undefined : row[Number(col)] ?? null; };
  const messages: L[] = [];
  let status = "OK" as RowCheck["status"];
  const err = (m: L) => { messages.push(m); status = "ERROR"; };
  const review = (m: L) => { messages.push(m); if (status !== "ERROR") status = "REVIEW"; };
  const n = parseNit(at("nit") ?? null);
  if (n.error) err(n.error);
  const yearCell = at("year");
  const year = yearCell !== undefined ? parseYear(yearCell, o.now) : o.fixedYear;
  if (!year) err({ es: "Año faltante o fuera de rango", en: "Year missing or out of range" });
  const name = txt(at("name") ?? null);
  if (!name) err({ es: "Sin razón social", en: "No company name" });
  const factor = SCALES[o.scale]?.factor ?? NaN;
  const values: Partial<Record<MoneyField, number>> = {};
  for (const k of MONEY_FIELDS) {
    const c = at(k);
    if (c === undefined) continue;
    const v = parseAmount(c, o.decimalStyle);
    if (v == null) continue;
    if (Number.isNaN(v)) { err({ es: `${FIELDS[k].es}: número no legible (${String(c).slice(0, 30)})`, en: `${FIELDS[k].en}: unreadable number (${String(c).slice(0, 30)})` }); continue; }
    values[k] = mulMoney(v, factor);
  }
  const empC = at("employees");
  const emp = empC === undefined ? null : parseAmount(empC, o.decimalStyle);
  if (emp != null && (Number.isNaN(emp) || emp < 0)) err({ es: "Empleados: número no legible", en: "Employees: unreadable number" });
  if (!Object.keys(values).length && status !== "ERROR") err({ es: "La fila no trae cifras", en: "The row has no figures" });
  // Incoherent signs (§9.3).
  if ((values.assets ?? 0) < 0) err({ es: "Activos negativos: signo incoherente", en: "Negative assets: incoherent sign" });
  if ((values.revenue ?? 0) < 0) review({ es: "Ingresos negativos: confirma el signo", en: "Negative revenue: confirm the sign" });
  if ((values.liabilities ?? 0) < 0) review({ es: "Pasivos negativos: confirma el signo", en: "Negative liabilities: confirm the sign" });
  if (values.assets != null && values.liabilities != null && values.equity != null && values.assets > 0) {
    const gap = Math.abs(values.assets - values.liabilities - values.equity);
    // 1 % of assets, but never less than the file's own rounding (three figures shown with 2 decimals at this scale).
    if (gap > Math.max(values.assets * 0.01, factor * 0.02)) review({ es: "Activos ≠ pasivos + patrimonio (diferencia mayor al 1 %)", en: "Assets ≠ liabilities + equity (difference over 1%)" });
  }
  return {
    parsed: { nit: n.key, name, year, ciiu: txt(at("ciiu") ?? null), sector: txt(at("sector") ?? null), department: txt(at("department") ?? null), city: txt(at("city") ?? null), values, employees: emp != null && !Number.isNaN(emp) && emp >= 0 ? Math.round(emp) : null },
    status, messages,
  };
}

/** One file row → one check per year. Wide files (figures per year in the title) give one record per year;
 *  a year with no figures at all is skipped (e.g. a company without the previous year). */
export function checkRows(row: Cell[], mapping: Mapping, o: { scale: string; decimalStyle: string | null; fixedYear: number | null; now?: Date }): RowCheck[] {
  const years = [...new Set(Object.values(mapping).map((v) => targetOf(v).year).filter((y): y is number => !!y))].sort((a, b) => b - a);
  if (!years.length) return [checkRow(row, mapping, o)];
  const plain: Mapping = Object.fromEntries(Object.entries(mapping).filter(([, v]) => !targetOf(v).year && v !== "year"));
  const subOf = (y: number): Mapping => ({ ...plain, ...Object.fromEntries(Object.entries(mapping).filter(([, v]) => targetOf(v).year === y).map(([c, v]) => [c, targetOf(v).field])) });
  const filled = (m: Mapping) => Object.entries(m).some(([c, v]) => PER_YEAR.has(v as FieldKey) && row[Number(c)] != null && String(row[Number(c)]).trim() !== "");
  const out = years.filter((y) => filled(subOf(y))).map((y) => checkRow(row, subOf(y), { ...o, fixedYear: y }));
  return out.length ? out : [checkRow(row, subOf(years[0]), { ...o, fixedYear: years[0] })];
}

// ---------- Indicators, facts and signals ----------

export type Snap = { fiscalYear: number; currency: string } & Partial<Record<MoneyField, number | null>> & { employees?: number | null; sourceName?: string };
export type Metric = { key: string; es: string; en: string; value: number; formula: string; inputs: Record<string, number | string> };

export const DEFAULT_THRESHOLDS = {
  strongGrowthPct: 20, // revenue growth year over year
  revenueDropPct: 10,
  equityDropPct: 15,
  leverageUpPts: 10, // debt/assets (liabilities/assets) increase in percentage points
  weakCurrentRatio: 1,
  bigChangePct: 30,
  leverageModeratePct: 40, // liabilities/assets bands for the "Endeudamiento" fact
  leverageHighPct: 70,
};
export type Thresholds = typeof DEFAULT_THRESHOLDS;

const pct = (a: number, b: number) => ((a - b) / Math.abs(b)) * 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Latest-first unique years (the most recent version of each year is expected first). */
export function byYear(snaps: Snap[]) {
  const seen = new Set<number>();
  return [...snaps].sort((a, b) => b.fiscalYear - a.fiscalYear).filter((s) => (seen.has(s.fiscalYear) ? false : (seen.add(s.fiscalYear), true)));
}

/** Derived indicators (§9.5), only when inputs exist and make sense. Each keeps formula and inputs. */
export function metrics(snaps: Snap[]): Metric[] {
  const ys = byYear(snaps);
  const [c, p] = ys;
  const out: Metric[] = [];
  if (!c) return out;
  const add = (key: string, es: string, en: string, value: number, formula: string, inputs: Record<string, number | string>) => { if (Number.isFinite(value)) out.push({ key, es, en, value: r1(value), formula, inputs }); };
  if (p && c.revenue != null && p.revenue != null && p.revenue > 0 && c.fiscalYear - p.fiscalYear === 1) add("growth", "Crecimiento de ingresos", "Revenue growth", pct(c.revenue, p.revenue), "(ingresos año − ingresos año anterior) / ingresos año anterior × 100", { [`ingresos ${c.fiscalYear}`]: c.revenue, [`ingresos ${p.fiscalYear}`]: p.revenue });
  const old = ys[ys.length - 1];
  if (ys.length >= 3 && c.revenue != null && old.revenue != null && c.revenue > 0 && old.revenue > 0) { const n = c.fiscalYear - old.fiscalYear; add("cagr", `Crecimiento anual compuesto (${n} años)`, `CAGR (${n} years)`, (Math.pow(c.revenue / old.revenue, 1 / n) - 1) * 100, "((ingresos final / ingresos inicial)^(1/años) − 1) × 100", { [`ingresos ${old.fiscalYear}`]: old.revenue, [`ingresos ${c.fiscalYear}`]: c.revenue, años: n }); }
  if (c.netIncome != null && c.revenue != null && c.revenue > 0) add("netMargin", "Margen neto", "Net margin", (c.netIncome / c.revenue) * 100, "utilidad neta / ingresos × 100", { "utilidad neta": c.netIncome, ingresos: c.revenue });
  if (c.liabilities != null && c.assets != null && c.assets > 0) add("leverage", "Endeudamiento (pasivos / activos)", "Leverage (liabilities / assets)", (c.liabilities / c.assets) * 100, "pasivos totales / activos totales × 100", { pasivos: c.liabilities, activos: c.assets });
  if (c.currentAssets != null && c.currentLiabilities != null && c.currentLiabilities > 0) add("currentRatio", "Razón corriente", "Current ratio", c.currentAssets / c.currentLiabilities, "activos corrientes / pasivos corrientes", { "activos corrientes": c.currentAssets, "pasivos corrientes": c.currentLiabilities });
  if (c.netIncome != null && c.assets != null && c.assets > 0) add("roa", "ROA", "ROA", (c.netIncome / c.assets) * 100, "utilidad neta / activos × 100", { "utilidad neta": c.netIncome, activos: c.assets });
  if (c.netIncome != null && c.equity != null && c.equity > 0) add("roe", "ROE", "ROE", (c.netIncome / c.equity) * 100, "utilidad neta / patrimonio × 100", { "utilidad neta": c.netIncome, patrimonio: c.equity });
  return out;
}

/** Consecutive years (latest first) in which `field` grew (+1 each) or fell (−1 each). 0 = no clear direction. */
export function streak(snaps: Snap[], field: MoneyField): number {
  const ys = byYear(snaps).filter((s) => s[field] != null);
  let n = 0;
  for (let i = 0; i + 1 < ys.length; i++) {
    if (ys[i].fiscalYear - ys[i + 1].fiscalYear !== 1) break;
    const d = Math.sign((ys[i][field] as number) - (ys[i + 1][field] as number));
    if (d === 0 || (n !== 0 && Math.sign(n) !== d)) break;
    n += d;
  }
  return n;
}

/** Explainable facts (§9.6): plain sentences, no score. */
export function facts(snaps: Snap[], th: Thresholds = DEFAULT_THRESHOLDS): { es: string; en: string }[] {
  const ys = byYear(snaps);
  const c = ys[0];
  if (!c) return [];
  const out: L[] = [];
  const g = streak(snaps, "revenue");
  if (g > 0) out.push({ es: `Ingresos: creciendo ${g > 1 ? `${g} años seguidos` : "frente al año anterior"}`, en: `Revenue: growing ${g > 1 ? `${g} years in a row` : "vs. prior year"}` });
  else if (g < 0) out.push({ es: `Ingresos: bajando ${-g > 1 ? `${-g} años seguidos` : "frente al año anterior"}`, en: `Revenue: falling ${-g > 1 ? `${-g} years in a row` : "vs. prior year"}` });
  if (c.equity != null) {
    const e = streak(snaps, "equity");
    out.push(c.equity > 0 ? { es: `Patrimonio: positivo${e > 0 ? " y creciente" : e < 0 ? " pero bajando" : ""}`, en: `Equity: positive${e > 0 ? " and growing" : e < 0 ? " but falling" : ""}` } : { es: "Patrimonio: negativo", en: "Equity: negative" });
  }
  if (c.netIncome != null) out.push(c.netIncome > 0 ? { es: "Rentabilidad: positiva", en: "Profitability: positive" } : c.netIncome < 0 ? { es: "Rentabilidad: pérdidas en el último año", en: "Profitability: loss in the latest year" } : { es: "Rentabilidad: en equilibrio", en: "Profitability: break-even" });
  if (c.liabilities != null && c.assets != null && c.assets > 0) {
    const lv = (c.liabilities / c.assets) * 100;
    out.push(lv < th.leverageModeratePct ? { es: "Endeudamiento: bajo", en: "Leverage: low" } : lv <= th.leverageHighPct ? { es: "Endeudamiento: moderado", en: "Leverage: moderate" } : { es: "Endeudamiento: alto", en: "Leverage: high" });
  }
  out.push({ es: `Información: FY${c.fiscalYear}${ys.length > 1 ? ` (${ys.length} años)` : ""}`, en: `Data: FY${c.fiscalYear}${ys.length > 1 ? ` (${ys.length} years)` : ""}` });
  return out;
}

export type EconSignal = { key: string; es: string; en: string; tone: "good" | "attn" };
/** Economic signals (§9.8). A signal is a reason to look, never an approval or a rejection. */
export function econSignals(snaps: Snap[], th: Thresholds = DEFAULT_THRESHOLDS): EconSignal[] {
  const ys = byYear(snaps);
  const [c, p, q] = ys;
  const out: EconSignal[] = [];
  if (!c || !p || c.fiscalYear - p.fiscalYear !== 1) {
    if (c && c.currentAssets != null && c.currentLiabilities != null && c.currentLiabilities > 0 && c.currentAssets / c.currentLiabilities < th.weakCurrentRatio) out.push({ key: "liquidity", es: `Liquidez débil (razón corriente ${r1(c.currentAssets / c.currentLiabilities)})`, en: `Weak liquidity (current ratio ${r1(c.currentAssets / c.currentLiabilities)})`, tone: "attn" });
    return out;
  }
  const g = c.revenue != null && p.revenue != null && p.revenue > 0 ? pct(c.revenue, p.revenue) : null;
  if (g != null && g >= th.strongGrowthPct) out.push({ key: "growth", es: `Crecimiento fuerte de ingresos (+${r1(g)} %)`, en: `Strong revenue growth (+${r1(g)}%)`, tone: "good" });
  if (g != null && g <= -th.revenueDropPct) out.push({ key: "revDrop", es: `Ingresos cayendo (${r1(g)} %)`, en: `Revenue falling (${r1(g)}%)`, tone: "attn" });
  if (q && p.fiscalYear - q.fiscalYear === 1 && c.netIncome != null && p.netIncome != null && q.netIncome != null && q.netIncome < 0 && p.netIncome > 0 && c.netIncome > 0 && streak(snaps, "revenue") >= 2) out.push({ key: "recovery", es: "Recuperación sostenida: dos años con utilidad e ingresos en alza", en: "Sustained recovery: two profitable years with rising revenue", tone: "good" });
  if (c.netIncome != null && p.netIncome != null && c.netIncome < 0 && p.netIncome < 0) out.push({ key: "losses", es: "Pérdidas recurrentes (dos años seguidos)", en: "Recurring losses (two years in a row)", tone: "attn" });
  if (c.equity != null && p.equity != null && p.equity > 0 && pct(c.equity, p.equity) <= -th.equityDropPct) out.push({ key: "equityDrop", es: `Caída de patrimonio (${r1(pct(c.equity, p.equity))} %)`, en: `Equity drop (${r1(pct(c.equity, p.equity))}%)`, tone: "attn" });
  if (c.liabilities != null && c.assets && p.liabilities != null && p.assets) { const d = (c.liabilities / c.assets - p.liabilities / p.assets) * 100; if (d >= th.leverageUpPts) out.push({ key: "leverageUp", es: `Endeudamiento sube ${r1(d)} puntos`, en: `Leverage up ${r1(d)} points`, tone: "attn" }); }
  if (c.currentAssets != null && c.currentLiabilities != null && c.currentLiabilities > 0 && c.currentAssets / c.currentLiabilities < th.weakCurrentRatio) out.push({ key: "liquidity", es: `Liquidez débil (razón corriente ${r1(c.currentAssets / c.currentLiabilities)})`, en: `Weak liquidity (current ratio ${r1(c.currentAssets / c.currentLiabilities)})`, tone: "attn" });
  const big = (["revenue", "assets"] as const).find((k) => c[k] != null && p[k] != null && (p[k] as number) > 0 && Math.abs(pct(c[k] as number, p[k] as number)) >= th.bigChangePct);
  if (big && !out.some((s) => s.key === "growth" || s.key === "revDrop")) out.push({ key: "bigChange", es: `Cambio importante frente al año anterior (${big === "revenue" ? "ingresos" : "activos"})`, en: `Major change vs. prior year (${big})`, tone: "attn" });
  return out;
}

// ── Company names across files ────────────────────────────────────────────────
// Supersociedades writes the same legal name differently year to year ("D1 S.A.S" / "D1 S A S",
// "BAVARIA & CIA S.C.A" / "BAVARIA Y CIA SCA", names written twice). Those are not a different company.
// Legal forms and connectors ("S.A.S.", "& CIA", "E.S.P.", "C.I.", "BIC") don't tell companies apart.
const LEGAL_FORM = new Set(["sas", "sa", "ltda", "sca", "scs", "esp", "bic", "ci", "eu", "cia", "y", "en", "ltd", "limitada"]);
// Spelled-out legal forms and a legal status (being in reorganization doesn't make it another company).
const SPELLED: [RegExp, string][] = [
  [/\bsociedad por acciones simplificada\b/g, " sas "], [/\bsociedad anonima\b/g, " sa "], [/\bcomercializadora internacional\b/g, " ci "],
  [/\bempresa de servicios publicos\b/g, " esp "], [/\ben (reorganizacion|liquidacion|reestructuracion)( judicial)?\b/g, " "],
];
// "sasci" (from "S.A.S C.I") is two legal forms run together.
const onlyForms = (w: string): boolean => !w || [...LEGAL_FORM].some((f) => w.startsWith(f) && onlyForms(w.slice(f.length)));
export function companyNameKey(name: string | null | undefined): string {
  let s = fold(name ?? "").replace(/&/g, " y ").replace(/[^a-z0-9ñ]+/g, " ");
  for (const [re, to] of SPELLED) s = s.replace(re, to);
  const words = s.trim().split(" ").filter(Boolean);
  // Single letters in a row are one abbreviation: "s a s" → "sas", "e s p" → "esp".
  const merged: string[] = [];
  words.forEach((w, n) => { if (w.length === 1 && n > 0 && words[n - 1].length === 1) merged[merged.length - 1] += w; else merged.push(w); });
  const core = merged.filter((w) => !LEGAL_FORM.has(w) && !(w.length <= 8 && onlyForms(w)));
  let key = (core.length ? core : merged).join("");
  // "ITALCOL SA ITALCOL SA" → "italcol"
  const half = key.length / 2;
  if (key.length >= 6 && Number.isInteger(half) && key.slice(0, half) === key.slice(half)) key = key.slice(0, half);
  return key;
}
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** Same company name, written differently (punctuation, legal form, a typo of one or two letters in a long name). */
export function sameCompanyName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = companyNameKey(a), y = companyNameKey(b);
  if (!x || !y) return x === y;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 10 && editDistance(x, y, 2) <= 2;
}

// ── Patterns across years (like-for-like) ─────────────────────────────────────
export type YearPoint = { year: number; revenue: number | null; netIncome: number | null; equity: number | null; assets: number | null; liabilities: number | null };
/** One row per year (best version first in the input), oldest → newest, with growth and margins. */
export function yearSeries(snaps: Snap[]) {
  const ys = byYear(snaps).reverse();
  return ys.map((s, n) => {
    const p = ys[n - 1];
    const consecutive = p && s.fiscalYear - p.fiscalYear === 1;
    return {
      year: s.fiscalYear, currency: s.currency, revenue: s.revenue ?? null, netIncome: s.netIncome ?? null, equity: s.equity ?? null, assets: s.assets ?? null, liabilities: s.liabilities ?? null,
      growth: consecutive && s.revenue != null && p.revenue != null && p.revenue > 0 ? r1(pct(s.revenue, p.revenue)) : null,
      margin: s.revenue && s.netIncome != null ? r1((s.netIncome / s.revenue) * 100) : null,
      leverage: s.assets && s.liabilities != null ? r1((s.liabilities / s.assets) * 100) : null,
    };
  });
}
export type SeriesRow = ReturnType<typeof yearSeries>[number];
/** Compound annual growth of revenue between the first and last year with revenue (needs ≥ 2 years apart by ≥ 1). */
export function cagr(rows: SeriesRow[]): { pct: number; from: number; to: number } | null {
  const w = rows.filter((r) => r.revenue != null && r.revenue > 0);
  if (w.length < 2) return null;
  const a = w[0], b = w[w.length - 1];
  const n = b.year - a.year;
  if (n < 1) return null;
  return { pct: r1((Math.pow(b.revenue! / a.revenue!, 1 / n) - 1) * 100), from: a.year, to: b.year };
}
/** Plain-language pattern of a company over the years it has. Facts only. */
export function patternFacts(rows: SeriesRow[]): L[] {
  const out: L[] = [];
  const d = (n: number) => String(n).replace(".", ","); // Spanish decimal comma
  const g = rows.map((r) => r.growth).filter((x): x is number => x != null);
  const c = cagr(rows);
  if (c && c.to - c.from >= 2) out.push({ es: `Ingresos ${c.pct >= 0 ? "crecieron" : "cayeron"} ${d(Math.abs(c.pct))} % por año en promedio (${c.from}–${c.to})`, en: `Revenue ${c.pct >= 0 ? "grew" : "fell"} ${Math.abs(c.pct)}% a year on average (${c.from}–${c.to})` });
  if (g.length >= 2) {
    const up = g.filter((x) => x > 0).length;
    if (up === g.length) out.push({ es: `Ingresos subieron todos los años (${g.length} de ${g.length})`, en: `Revenue rose every year (${g.length} of ${g.length})` });
    else if (up === 0) out.push({ es: `Ingresos bajaron todos los años (${g.length} de ${g.length})`, en: `Revenue fell every year (${g.length} of ${g.length})` });
    else out.push({ es: `Ingresos subieron ${up} de ${g.length} años`, en: `Revenue rose ${up} of ${g.length} years` });
  }
  const prof = rows.filter((r) => r.netIncome != null);
  if (prof.length >= 2) { const k = prof.filter((r) => r.netIncome! > 0).length; out.push({ es: `Con utilidad ${k} de ${prof.length} años`, en: `Profitable ${k} of ${prof.length} years` }); }
  const m = rows.filter((r) => r.margin != null);
  if (m.length >= 2) { const x = r1(m[m.length - 1].margin! - m[0].margin!); if (Math.abs(x) >= 1) out.push({ es: `Margen neto ${x > 0 ? "sube" : "baja"} ${d(Math.abs(x))} puntos (${m[0].year}: ${d(m[0].margin!)} % → ${m[m.length - 1].year}: ${d(m[m.length - 1].margin!)} %)`, en: `Net margin ${x > 0 ? "up" : "down"} ${Math.abs(x)} points (${m[0].year}: ${m[0].margin}% → ${m[m.length - 1].year}: ${m[m.length - 1].margin}%)` }); }
  const l = rows.filter((r) => r.leverage != null);
  if (l.length >= 2) { const x = r1(l[l.length - 1].leverage! - l[0].leverage!); if (Math.abs(x) >= 5) out.push({ es: `Endeudamiento ${x > 0 ? "sube" : "baja"} ${d(Math.abs(x))} puntos desde ${l[0].year}`, en: `Leverage ${x > 0 ? "up" : "down"} ${Math.abs(x)} points since ${l[0].year}` }); }
  return out;
}

/** Big amounts the way Colombian business people read them: "COP 390.512 M". */
export function bigMoney(currency: string, v: number | null | undefined, lang: string) {
  if (v == null) return "—";
  const loc = lang === "EN" ? "en-US" : "es-CO";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${currency} ${new Intl.NumberFormat(loc, { maximumFractionDigits: abs >= 1e9 ? 0 : 1 }).format(v / 1e6)} M`;
  return `${currency} ${new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(v)}`;
}
