import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { monthOf } from "./customer-stats";
import { canFinance } from "./permissions";
import { trmLookup } from "./trm-store";
import type { Kpi } from "./sales-budget-rules";
import { isMoney, parseHistory, type HistorySource, type Parsed, type Problem } from "./sales-history-rules";

// Presupuesto comercial · Historial cargado (reads and the check of a load). The loaded figures stand in for SOLU's
// own records only in the months BEFORE the company's first Need in SOLU: from that month on SOLU's records are the
// real ones, so a figure is never counted twice. Siigo's invoicing is also kept beside SOLU's to compare them.

export type FactScope = { accountIds?: string[]; ownerIds?: string[] };

/** The month's average official TRM (every calendar day of the month, up to today). null = a day has no rate. */
export async function monthRates(months: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const uniq = [...new Set(months)].sort();
  if (!uniq.length) return out;
  const lookup = await trmLookup(new Date(`${uniq[0]}-01T12:00:00Z`), new Date());
  const today = new Date().toISOString().slice(0, 10);
  for (const m of uniq) {
    const [y, mo] = m.split("-").map(Number);
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    let sum = 0, n = 0, missing = false;
    for (let d = 1; d <= days; d++) {
      const day = `${m}-${String(d).padStart(2, "0")}`;
      if (day > today) break;
      const hit = lookup(new Date(`${day}T17:00:00Z`));
      if (!hit) { missing = true; break; }
      sum += hit.rate; n++;
    }
    out.set(m, missing || !n ? null : Math.round((sum / n) * 100) / 100);
  }
  return out;
}

/** The month of each company's first Need in SOLU (companies without Needs are absent). */
export async function firstNeedMonths(accountIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!accountIds.length) return out;
  const rows = await db.deal.groupBy({ by: ["accountId"], where: { internal: false, accountId: { in: accountIds } }, _min: { createdAt: true } });
  for (const r of rows) if (r._min.createdAt) out.set(r.accountId, monthOf(r._min.createdAt));
  return out;
}

export type HistoryRow = { id: string; batchId: string; label: string; accountId: string; ownerId: string; month: string; kpi: Kpi; value: number; orig: number; currency: string; rate: number | null; source: HistorySource };

const rowSelect = { id: true, batchId: true, accountId: true, userId: true, month: true, kpi: true, value: true, orig: true, currency: true, rate: true, source: true, batch: { select: { label: true } }, account: { select: { ownerId: true } } } satisfies Prisma.SalesHistoryMonthSelect;
const scopeWhere = (scope: FactScope): Prisma.SalesHistoryMonthWhereInput => {
  const or: Prisma.SalesHistoryMonthWhereInput[] = [];
  if (scope.accountIds) or.push({ accountId: { in: scope.accountIds } });
  if (scope.ownerIds) or.push({ userId: { in: scope.ownerIds } }, { userId: null, account: { ownerId: { in: scope.ownerIds } } });
  return { batch: { state: "APPLIED" }, account: { internal: false }, ...(or.length ? { OR: or } : {}) };
};

/** Every saved figure in scope, with the person it belongs to (the row's negotiator, else the company's owner). */
export async function loadedRows(scope: FactScope): Promise<HistoryRow[]> {
  const rows = await db.salesHistoryMonth.findMany({ where: scopeWhere(scope), select: rowSelect, orderBy: [{ month: "asc" }] });
  return rows.map((r) => ({ id: r.id, batchId: r.batchId, label: r.batch.label, accountId: r.accountId, ownerId: r.userId ?? r.account.ownerId, month: r.month, kpi: r.kpi as Kpi, value: Number(r.value), orig: Number(r.orig), currency: r.currency, rate: r.rate == null ? null : Number(r.rate), source: r.source as HistorySource }));
}

/** Which loaded figures count as real: months before the company's first Need in SOLU; and for invoicing, Siigo's
 *  figure wins over the earlier system's for the same company and month. */
export function countedRows(rows: HistoryRow[], firstNeed: Map<string, string>): HistoryRow[] {
  const siigo = new Set(rows.filter((r) => r.source === "SIIGO" && r.kpi === "FACT_COP").map((r) => `${r.accountId}|${r.month}`));
  return rows.filter((r) => {
    const cut = firstNeed.get(r.accountId);
    if (cut && r.month >= cut) return false;
    if (r.source === "SIIGO") return r.kpi === "FACT_COP";
    return !(r.kpi === "FACT_COP" && siigo.has(`${r.accountId}|${r.month}`));
  });
}

/** The loaded figures that count as real for the budget screens. */
export async function historyFor(scope: FactScope): Promise<HistoryRow[]> {
  const rows = await loadedRows(scope);
  if (!rows.length) return rows;
  return countedRows(rows, await firstNeedMonths([...new Set(rows.map((r) => r.accountId))]));
}

export type CheckedRow = { line: number; accountId: string; userId: string | null; month: string; kpi: Kpi; value: number; orig: number; currency: string; rate: number | null };
export type Checked = {
  parsed: Parsed; problems: Problem[]; figures: CheckedRow[];
  /** Rows of the paste that can be saved, companies and months they cover. */
  okRows: number; companies: number; from: string | null; to: string | null;
  /** Figures that will be saved but not counted as real, because SOLU already has that company from that month. */
  shadowed: number; shadowedCompanies: { accountId: string; since: string }[];
  /** Figures already saved by an earlier load that this one replaces. */
  replaces: number;
  totals: { year: string; kpi: Kpi; value: number }[];
};

/** Reads a load again from its pasted text against today's companies and people. Nothing is written. */
export async function checkBatch(b: { id: string; source: string; currency: string; unit: number; raw: string }): Promise<Checked> {
  const [accounts, users] = await Promise.all([
    db.account.findMany({ where: { internal: false }, select: { id: true, name: true, taxId: true } }),
    db.user.findMany({ select: { id: true, name: true, email: true } }),
  ]);
  const source = b.source as HistorySource;
  const parsed = parseHistory(b.raw, source, b.unit, { accounts, users }, monthOf(new Date()));
  const problems = [...parsed.problems];
  const usd = b.currency === "USD";
  const rates = usd ? await monthRates(parsed.rows.map((r) => r.month)) : new Map<string, number | null>();
  const figures: CheckedRow[] = [];
  let okRows = 0;
  const companies = new Set<string>();
  let from: string | null = null, to: string | null = null;
  for (const r of parsed.rows) {
    const rate = usd ? rates.get(r.month) ?? null : null;
    const money = (Object.keys(r.values) as Kpi[]).some(isMoney);
    if (usd && money && rate == null) { problems.push({ line: r.line, code: "sin-tasa", detail: r.month }); continue; }
    okRows++; companies.add(r.accountId);
    if (!from || r.month < from) from = r.month;
    if (!to || r.month > to) to = r.month;
    for (const [k, v] of Object.entries(r.values) as [Kpi, number][]) {
      const conv = usd && isMoney(k);
      figures.push({ line: r.line, accountId: r.accountId, userId: r.userId, month: r.month, kpi: k, orig: v, currency: isMoney(k) ? b.currency : "", rate: conv ? rate : null, value: conv ? Math.round(v * rate!) : v });
    }
  }
  problems.sort((x, y) => x.line - y.line);
  const ids = [...companies];
  const [firstNeed, existing] = await Promise.all([
    firstNeedMonths(ids),
    ids.length ? db.salesHistoryMonth.findMany({ where: { accountId: { in: ids }, source, batchId: { not: b.id }, batch: { state: "APPLIED" } }, select: { accountId: true, month: true, kpi: true } }) : [],
  ]);
  const had = new Set(existing.map((e) => `${e.accountId}|${e.month}|${e.kpi}`));
  let shadowed = 0, replaces = 0;
  const shadowedCompanies = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const f of figures) {
    const cut = firstNeed.get(f.accountId);
    if (cut && f.month >= cut) { shadowed++; shadowedCompanies.set(f.accountId, cut); }
    if (had.has(`${f.accountId}|${f.month}|${f.kpi}`)) replaces++;
    const k = `${f.month.slice(0, 4)}|${f.kpi}`;
    totals.set(k, (totals.get(k) ?? 0) + f.value);
  }
  return {
    parsed, problems, figures, okRows, companies: ids.length, from, to, shadowed, replaces,
    shadowedCompanies: [...shadowedCompanies].map(([accountId, since]) => ({ accountId, since })),
    totals: [...totals].map(([k, value]) => ({ year: k.slice(0, 4), kpi: k.slice(5) as Kpi, value })).sort((x, y) => (x.year + x.kpi < y.year + y.kpi ? -1 : 1)),
  };
}

/** Who loads history: Gerencia, Dirección Comercial, Finanzas and Administración. Everyone reads it. */
export const canLoadHistory = canFinance;
