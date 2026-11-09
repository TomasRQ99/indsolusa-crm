// Mercado M3 · Economic Explorer (§9.7) and the economic view of one company (§9.6).
// Uses the latest committed snapshot per company; earlier versions stay in history.
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { econSignals, facts, metrics, type Snap } from "./fin-rules";
import { getThresholds, linkCompaniesToAccounts, toSnap } from "./dataset-import";

export type ExplorerFilters = { q?: string; sector?: string; place?: string; minRev?: number; currency?: string; growing?: boolean; equityPos?: boolean; profitable?: boolean; notCustomer?: boolean; withPlants?: boolean; year?: number; page?: number };
export const PAGE = 50;

type Row = { id: string; name: string; nit: string; sector: string | null; department: string | null; city: string | null; accountId: string | null; fiscalYear: number; currency: string; revenue: Prisma.Decimal | null; netIncome: Prisma.Decimal | null; equity: Prisma.Decimal | null; assets: Prisma.Decimal | null; liabilities: Prisma.Decimal | null; prevRevenue: Prisma.Decimal | null };

export async function explore(f: ExplorerFilters) {
  await linkCompaniesToAccounts(); // customers created after an import get linked by NIT
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.q) {
    const like = `%${f.q}%`, digits = f.q.replace(/\D/g, "");
    where.push(digits.length >= 3
      ? Prisma.sql`(c.name ILIKE ${like} OR c.nit LIKE ${digits.slice(0, 9) + "%"})`
      : Prisma.sql`(c.name ILIKE ${like} OR EXISTS (SELECT 1 FROM unnest(c."otherNames") n WHERE n ILIKE ${like}))`);
  }
  if (f.sector) where.push(Prisma.sql`(c.sector ILIKE ${`%${f.sector}%`} OR c.ciiu ILIKE ${`${f.sector}%`})`);
  if (f.place) where.push(Prisma.sql`(c.department ILIKE ${`%${f.place}%`} OR c.city ILIKE ${`%${f.place}%`})`);
  if (f.minRev) where.push(Prisma.sql`l.revenue >= ${f.minRev * 1e6} AND l.currency = ${f.currency ?? "COP"}`);
  if (f.growing) where.push(Prisma.sql`p.revenue > 0 AND l.revenue > p.revenue`);
  if (f.equityPos) where.push(Prisma.sql`l.equity > 0`);
  if (f.profitable) where.push(Prisma.sql`l."netIncome" > 0`);
  if (f.notCustomer) where.push(Prisma.sql`c."accountId" IS NULL`);
  if (f.withPlants) where.push(Prisma.sql`EXISTS (SELECT 1 FROM "Plant" pl WHERE pl."accountId" = c."accountId")`);
  if (f.year) where.push(Prisma.sql`l."fiscalYear" = ${f.year}`);
  const cond = Prisma.join(where, " AND ");
  const base = Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (s."companyId") s.* FROM "FinancialSnapshot" s JOIN "DatasetImport" i ON i.id = s."importId" AND i.status = 'COMMITTED'
      ORDER BY s."companyId", s."fiscalYear" DESC, s."createdAt" DESC
    ), prev AS (
      SELECT DISTINCT ON (s."companyId") s."companyId", s.revenue FROM "FinancialSnapshot" s JOIN latest l ON l."companyId" = s."companyId" AND s."fiscalYear" = l."fiscalYear" - 1
      JOIN "DatasetImport" i ON i.id = s."importId" AND i.status = 'COMMITTED'
      ORDER BY s."companyId", s."createdAt" DESC
    )`;
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.$queryRaw<Row[]>(Prisma.sql`${base}
      SELECT c.id, c.name, c.nit, c.sector, c.department, c.city, c."accountId", l."fiscalYear", l.currency, l.revenue, l."netIncome", l.equity, l.assets, l.liabilities, p.revenue AS "prevRevenue"
      FROM "MarketCompany" c JOIN latest l ON l."companyId" = c.id LEFT JOIN prev p ON p."companyId" = c.id
      WHERE ${cond} ORDER BY l.revenue DESC NULLS LAST, c.name LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`),
    db.$queryRaw<{ n: bigint }[]>(Prisma.sql`${base} SELECT COUNT(*)::bigint AS n FROM "MarketCompany" c JOIN latest l ON l."companyId" = c.id LEFT JOIN prev p ON p."companyId" = c.id WHERE ${cond}`),
  ]);

  // Relationship + signals for the page rows only.
  const ids = rows.map((r) => r.id);
  const accIds = rows.map((r) => r.accountId).filter((x): x is string => !!x);
  const [snaps, won, th] = await Promise.all([
    ids.length ? db.financialSnapshot.findMany({ where: { companyId: { in: ids }, import: { status: "COMMITTED" } }, orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }] }) : [],
    accIds.length ? db.deal.groupBy({ by: ["accountId"], where: { accountId: { in: accIds }, stage: "WON" }, _count: { _all: true } }) : [],
    getThresholds(),
  ]);
  const wonSet = new Set(won.map((w) => w.accountId));
  const list = rows.map((r) => {
    const s = snaps.filter((x) => x.companyId === r.id).map(toSnap);
    const n = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
    return { ...r, revenue: n(r.revenue), netIncome: n(r.netIncome), equity: n(r.equity), prevRevenue: n(r.prevRevenue), relation: r.accountId ? (wonSet.has(r.accountId) ? "CUSTOMER" : "PROSPECT") : null, signals: econSignals(s, th.value), years: new Set(s.map((x) => x.fiscalYear)).size };
  });
  const [sectors, years] = await Promise.all([
    db.$queryRaw<{ sector: string }[]>`SELECT DISTINCT sector FROM "MarketCompany" WHERE sector IS NOT NULL ORDER BY sector LIMIT 60`,
    db.$queryRaw<{ y: number }[]>`SELECT DISTINCT "fiscalYear" AS y FROM "FinancialSnapshot" ORDER BY y DESC LIMIT 15`,
  ]);
  return { list, total: Number(total[0]?.n ?? 0), page, sectors: sectors.map((s) => s.sector), years: years.map((y) => y.y) };
}

/** Economic view of one company: facts, indicators with formula, signals, every snapshot with its source. */
export async function companyEconomics(where: { companyId?: string; accountId?: string; taxId?: string | null }) {
  const nit = where.taxId ? (where.taxId.replace(/\D/g, "").slice(0, 9) || null) : null;
  const c = await db.marketCompany.findFirst({
    where: where.companyId ? { id: where.companyId } : { OR: [...(where.accountId ? [{ accountId: where.accountId }] : []), ...(nit && nit.length >= 6 ? [{ nit }] : [])] },
    include: {
      account: { select: { id: true, name: true } },
      snapshots: { where: { import: { status: "COMMITTED" } }, orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }], include: { source: { select: { name: true } }, import: { select: { fileName: true, committedAt: true } } } },
    },
  });
  if (!c) return null;
  const th = (await getThresholds()).value;
  const snaps: Snap[] = c.snapshots.map((s) => ({ ...toSnap(s), sourceName: s.source.name }));
  // Earlier versions of a year (a later file with different figures) are shown, never hidden.
  const versions = new Map<number, number>();
  for (const s of c.snapshots) versions.set(s.fiscalYear, (versions.get(s.fiscalYear) ?? 0) + 1);
  return { c, facts: facts(snaps, th), metrics: metrics(snaps), signals: econSignals(snaps, th), versions };
}
