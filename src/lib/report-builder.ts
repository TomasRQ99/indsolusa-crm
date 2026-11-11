import { db } from "./db";
import { sumMoney, sharePct } from "./money";
import { periodBounds, shiftPeriod, validPeriod } from "./goal-rules";

// Módulo 13 §15 · Report Builder. It reads only certified metrics (Venta, Eságara ganada, Eságara %) from the
// official object behind them — accepted quotes by decision date — so a figure here equals the one on every other
// screen. It creates no parallel fields. A saved view stores the question, never the answer: opening it recalculates
// from live data under the permissions of whoever opens it.

export const DIMS = ["MONTH", "CUSTOMER", "NEGOTIATOR"] as const;
export type Dim = (typeof DIMS)[number];
export const DIM_TEXT: Record<Dim, { es: string; en: string }> = { MONTH: { es: "Mes", en: "Month" }, CUSTOMER: { es: "Cliente", en: "Customer" }, NEGOTIATOR: { es: "Negociador", en: "Negotiator" } };
export const MAX_MONTHS = 24;
export type BuilderConfig = { from: string; to: string; dim: Dim; ownerId: string | null; accountId: string | null };

/** Reads a config from anything (a query string, stored JSON) and returns a valid one; never throws. */
export function cleanConfig(raw: Record<string, unknown> | null | undefined, nowPeriod: string): BuilderConfig {
  const s = (k: string) => (typeof raw?.[k] === "string" ? (raw![k] as string) : "");
  let to = validPeriod(s("to")) ? s("to") : nowPeriod;
  let from = validPeriod(s("from")) ? s("from") : shiftPeriod(to, -2);
  if (from > to) [from, to] = [to, from];
  if (shiftPeriod(from, MAX_MONTHS - 1) < to) from = shiftPeriod(to, -(MAX_MONTHS - 1));
  const dim = (DIMS as readonly string[]).includes(s("dim")) ? (s("dim") as Dim) : "MONTH";
  return { from, to, dim, ownerId: s("ownerId") || null, accountId: s("accountId") || null };
}
export const configQuery = (c: BuilderConfig) => new URLSearchParams({ from: c.from, to: c.to, dim: c.dim, ...(c.ownerId ? { ownerId: c.ownerId } : {}), ...(c.accountId ? { accountId: c.accountId } : {}) }).toString();

export type Fact = { period: string; dealId: string; ownerId: string; ownerName: string; accountId: string; accountName: string; sale: number; esagara: number };
export type Row = { key: string; label: string; href: string | null; n: number; sale: number; esagara: number; esagaraPct: number | null };

/** Pure: groups accepted sales by the chosen dimension. Months are listed in order, even when empty; the rest alphabetically. */
export function buildRows(facts: Fact[], c: BuilderConfig): { rows: Row[]; total: Row } {
  const groups = new Map<string, { label: string; href: string | null; fs: Fact[] }>();
  if (c.dim === "MONTH") for (let p = c.from; p <= c.to; p = shiftPeriod(p, 1)) groups.set(p, { label: p, href: null, fs: [] });
  for (const f of facts) {
    const [key, label, href] = c.dim === "MONTH" ? [f.period, f.period, null] : c.dim === "CUSTOMER" ? [f.accountId, f.accountName, `/accounts/${f.accountId}`] : [f.ownerId, f.ownerName, `/informes?u=${f.ownerId}`];
    const g = groups.get(key) ?? { label, href, fs: [] };
    g.fs.push(f); groups.set(key, g);
  }
  const row = (key: string, label: string, href: string | null, fs: Fact[]): Row => {
    const sale = sumMoney(fs.map((f) => f.sale)), esagara = sumMoney(fs.map((f) => f.esagara));
    return { key, label, href, n: fs.length, sale, esagara, esagaraPct: sale > 0 ? sharePct(esagara, sale) : null };
  };
  const rows = [...groups.entries()].map(([k, g]) => row(k, g.label, g.href, g.fs));
  if (c.dim !== "MONTH") rows.sort((a, b) => a.label.localeCompare(b.label));
  return { rows, total: row("TOTAL", "", null, facts) };
}

/** The accepted sales a person may see: everything, or only Journeys owned by the people in `visibleOwnerIds`. */
export async function builderFacts(c: BuilderConfig, visibleOwnerIds: string[] | null): Promise<Fact[]> {
  const start = periodBounds(c.from).start, end = periodBounds(c.to).end;
  const owner = c.ownerId ? (visibleOwnerIds && !visibleOwnerIds.includes(c.ownerId) ? { in: [] as string[] } : c.ownerId) : visibleOwnerIds ? { in: visibleOwnerIds } : undefined;
  const qs = await db.quote.findMany({
    where: { status: "ACCEPTED", decidedAt: { gte: start, lt: end }, deal: { internal: false, ...(owner !== undefined ? { ownerId: owner } : {}), ...(c.accountId ? { accountId: c.accountId } : {}) } },
    select: { decidedAt: true, protSale: true, protEsagra: true, deal: { select: { id: true, ownerId: true, owner: { select: { name: true } }, account: { select: { id: true, name: true } } } } },
  });
  return qs.map((q) => ({ period: q.decidedAt!.toISOString().slice(0, 7), dealId: q.deal.id, ownerId: q.deal.ownerId, ownerName: q.deal.owner.name, accountId: q.deal.account.id, accountName: q.deal.account.name, sale: Number(q.protSale ?? 0), esagara: Number(q.protEsagra ?? 0) }));
}
