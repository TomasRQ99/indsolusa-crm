// Operaciones O9a · reading a bank statement file (module 11 §42). Pure: no database.
// SOLU finds the columns by their titles and reads nothing it cannot identify: if the date, the description and the
// amount are not all recognised, the whole file is refused and the person is told which titles were found.

import { createHash } from "node:crypto";

export type BankRow = { date: Date; amount: number; description: string; reference: string | null; balance: number | null; fingerprint: string };
export type BankParse = { ok: true; rows: BankRow[]; skipped: { line: number; why: "NO_AMOUNT" | "BAD_DATE" | "BAD_AMOUNT" }[]; header: string[]; from: Date | null; to: Date | null } | { ok: false; reason: "EMPTY" | "NO_HEADER"; found: string[] };

/** One CSV line → cells, honouring quotes and doubled quotes. */
export function csvCells(line: string, sep = ","): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (q) { if (c === '"') { if (line[k + 1] === '"') { cur += '"'; k++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const COLS = {
  date: ["date", "posting date", "posted date", "transaction date", "fecha", "as of date"],
  description: ["description", "descripcion", "payee", "details", "transaction description", "detalle", "memo"],
  amount: ["amount", "monto", "importe", "valor"],
  debit: ["debit", "debits", "withdrawal", "withdrawals", "debito", "debitos"],
  credit: ["credit", "credits", "deposit", "deposits", "credito", "creditos"],
  balance: ["running bal", "running balance", "balance", "saldo"],
  reference: ["reference", "reference number", "ref", "check number", "check", "bank reference", "referencia"],
} as const;
const find = (head: string[], names: readonly string[]) => head.findIndex((h) => names.includes(h));

/** "1,234.56", "$1,234.56", "(12.00)", "-12.00" → number; anything else → null. US format (period decimals). */
export function parseMoney(s: string): number | null {
  const raw = s.replace(/[$\s]/g, "");
  if (!raw) return null;
  const neg = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const body = raw.replace(/[()+-]/g, "");
  // A comma is accepted only as a thousands separator. "500,00" (comma decimals) is refused, never read as 50000.
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(body)) return null;
  const n = Math.round(Number(body.replace(/,/g, "")) * 100) / 100;
  return neg ? -n : n;
}
/** MM/DD/YYYY (US bank) or YYYY-MM-DD → UTC day; anything else → null. */
export function parseBankDate(s: string): Date | null {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  let y: number, mo: number, d: number;
  if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

export function parseBankCsv(text: string): BankParse {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((l) => l.trim())) return { ok: false, reason: "EMPTY", found: [] };
  const sep = (lines.find((l) => l.trim()) ?? "").split(";").length > (lines.find((l) => l.trim()) ?? "").split(",").length ? ";" : ",";
  // The statement may start with a summary block: the real table starts at the first row that names the columns.
  let hi = -1, head: string[] = [];
  for (let k = 0; k < Math.min(lines.length, 40); k++) {
    const h = csvCells(lines[k], sep).map(norm);
    if (find(h, COLS.date) >= 0 && find(h, COLS.description) >= 0 && (find(h, COLS.amount) >= 0 || (find(h, COLS.debit) >= 0 && find(h, COLS.credit) >= 0))) { hi = k; head = h; break; }
  }
  if (hi < 0) return { ok: false, reason: "NO_HEADER", found: csvCells(lines.find((l) => l.trim()) ?? "", sep).filter(Boolean).slice(0, 12) };
  const ix = { date: find(head, COLS.date), desc: find(head, COLS.description), amount: find(head, COLS.amount), debit: find(head, COLS.debit), credit: find(head, COLS.credit), bal: find(head, COLS.balance), ref: find(head, COLS.reference) };
  const rows: BankRow[] = [];
  const skipped: { line: number; why: "NO_AMOUNT" | "BAD_DATE" | "BAD_AMOUNT" }[] = [];
  const seen = new Map<string, number>();
  for (let k = hi + 1; k < lines.length; k++) {
    if (!lines[k].trim()) continue;
    const c = csvCells(lines[k], sep);
    const date = parseBankDate(c[ix.date] ?? "");
    if (!date) { skipped.push({ line: k + 1, why: "BAD_DATE" }); continue; }
    let amount: number | null;
    if (ix.amount >= 0) {
      const raw = c[ix.amount] ?? "";
      // A balance line ("Beginning balance as of…") has no amount: it is not a movement.
      if (!raw.trim()) { skipped.push({ line: k + 1, why: "NO_AMOUNT" }); continue; }
      amount = parseMoney(raw);
    } else {
      const dRaw = (c[ix.debit] ?? "").trim(), cRaw = (c[ix.credit] ?? "").trim();
      if (!dRaw && !cRaw) { skipped.push({ line: k + 1, why: "NO_AMOUNT" }); continue; }
      const dv = dRaw ? parseMoney(dRaw) : 0, cv = cRaw ? parseMoney(cRaw) : 0;
      amount = dv == null || cv == null ? null : Math.round((Math.abs(cv) - Math.abs(dv)) * 100) / 100;
    }
    if (amount == null) { skipped.push({ line: k + 1, why: "BAD_AMOUNT" }); continue; }
    const description = (c[ix.desc] ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const base = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description.toLowerCase()}`;
    // Two identical movements on the same day are both real: the nth one keeps its own identity.
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    rows.push({ date, amount, description, reference: ix.ref >= 0 ? (c[ix.ref] ?? "").trim().slice(0, 80) || null : null, balance: ix.bal >= 0 ? parseMoney(c[ix.bal] ?? "") : null, fingerprint: createHash("sha1").update(`${base}|${n}`).digest("hex") });
  }
  const ts = rows.map((r) => +r.date);
  return { ok: true, rows, skipped, header: head, from: ts.length ? new Date(Math.min(...ts)) : null, to: ts.length ? new Date(Math.max(...ts)) : null };
}

// ---------- matching (§42.1–42.2) ----------

export type MatchState = "UNMATCHED" | "PARTIAL" | "MATCHED" | "CLASSIFIED";
/** Where a movement stands: fully explained, partly explained, set aside by a person, or still open. */
export function matchState(amount: number, matched: number, classifiedAs: string | null): { state: MatchState; open: number } {
  const open = Math.round((Math.abs(amount) - matched) * 100) / 100;
  if (classifiedAs) return { state: "CLASSIFIED", open: 0 };
  if (matched <= 0.005) return { state: "UNMATCHED", open };
  return open <= 0.005 ? { state: "MATCHED", open: 0 } : { state: "PARTIAL", open };
}
export type Candidate = { id: string; amount: number; date: Date; label: string; alreadyMatched: number };
/** Suggestions only: same amount still unexplained and a date within `days`. A person confirms; SOLU never matches alone. */
export function suggest<T extends Candidate>(txAmount: number, txDate: Date, open: number, cands: T[], days = 7): T[] {
  return cands
    .map((c) => ({ c, free: Math.round((c.amount - c.alreadyMatched) * 100) / 100, gap: Math.abs(+c.date - +txDate) / 864e5 }))
    .filter((x) => x.free > 0.005 && x.gap <= days && (Math.abs(x.free - open) <= 0.005 || Math.abs(x.c.amount - Math.abs(txAmount)) <= 0.005))
    .sort((a, b) => a.gap - b.gap)
    .map((x) => x.c);
}
export const CLASSES: Record<string, { es: string; en: string }> = {
  INTERNAL_TRANSFER: { es: "Traslado entre cuentas propias", en: "Transfer between own accounts" },
  BANK_FEE: { es: "Comisión o cargo del banco", en: "Bank fee or charge" },
  OTHER: { es: "Otro (no es de un cliente ni de un proveedor)", en: "Other (not from a customer or to a supplier)" },
};
