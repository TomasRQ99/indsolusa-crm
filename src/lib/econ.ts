// Mercado M3 · Economic Explorer (§9.7) and the economic view of one company (§9.6).
// Uses the latest committed snapshot per company; earlier versions stay in history.
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { cagr, econSignals, facts, metrics, patternFacts, yearSeries, type Snap } from "./fin-rules";
import { getThresholds, linkCompaniesToAccounts, SNAP_ORDER, SNAP_ORDER_SQL, toSnap } from "./dataset-import";

export type ExplorerFilters = { q?: string; sector?: string; place?: string; minRev?: number; currency?: string; growing?: boolean; equityPos?: boolean; profitable?: boolean; notCustomer?: boolean; withPlants?: boolean; year?: number; page?: number; pattern?: PatternKey };
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
  if (f.pattern) where.push(PATTERNS[f.pattern].sql);
  const patJoin = f.pattern ? Prisma.sql`JOIN pat pt ON pt."companyId" = c.id` : Prisma.empty;
  const cond = Prisma.join(where, " AND ");
  const base = Prisma.sql`
    WITH ${f.pattern ? Prisma.sql`${BEST},` : Prisma.empty} latest AS (
      SELECT DISTINCT ON (s."companyId") s.* FROM "FinancialSnapshot" s JOIN "DatasetImport" i ON i.id = s."importId" AND i.status = 'COMMITTED'
      ORDER BY s."companyId", s."fiscalYear" DESC, ${SNAP_ORDER_SQL}
    ), prev AS (
      SELECT DISTINCT ON (s."companyId") s."companyId", s.revenue FROM "FinancialSnapshot" s JOIN latest l ON l."companyId" = s."companyId" AND s."fiscalYear" = l."fiscalYear" - 1
      JOIN "DatasetImport" i ON i.id = s."importId" AND i.status = 'COMMITTED'
      ORDER BY s."companyId", ${SNAP_ORDER_SQL}
    )`;
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.$queryRaw<Row[]>(Prisma.sql`${base}
      SELECT c.id, c.name, c.nit, c.sector, c.department, c.city, c."accountId", l."fiscalYear", l.currency, l.revenue, l."netIncome", l.equity, l.assets, l.liabilities, p.revenue AS "prevRevenue"
      FROM "MarketCompany" c JOIN latest l ON l."companyId" = c.id LEFT JOIN prev p ON p."companyId" = c.id ${patJoin}
      WHERE ${cond} ORDER BY l.revenue DESC NULLS LAST, c.name LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`),
    db.$queryRaw<{ n: bigint }[]>(Prisma.sql`${base} SELECT COUNT(*)::bigint AS n FROM "MarketCompany" c JOIN latest l ON l."companyId" = c.id LEFT JOIN prev p ON p."companyId" = c.id ${patJoin} WHERE ${cond}`),
  ]);

  // Relationship + signals for the page rows only.
  const ids = rows.map((r) => r.id);
  const accIds = rows.map((r) => r.accountId).filter((x): x is string => !!x);
  const [snaps, won, th] = await Promise.all([
    ids.length ? db.financialSnapshot.findMany({ where: { companyId: { in: ids }, import: { status: "COMMITTED" } }, orderBy: SNAP_ORDER }) : [],
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

// ── Patterns across years ────────────────────────────────────────────────────
// best = the figures SOLU shows per company and year; ser = with the previous year's revenue (like-for-like);
// pat = the multi-year pattern of each company.
const BEST = Prisma.sql`best AS (
  SELECT DISTINCT ON (s."companyId", s."fiscalYear") s."companyId", s."fiscalYear", s.currency, s.revenue, s."netIncome", s.equity, s.assets, s.liabilities
  FROM "FinancialSnapshot" s JOIN "DatasetImport" i ON i.id = s."importId" AND i.status = 'COMMITTED'
  ORDER BY s."companyId", s."fiscalYear", ${SNAP_ORDER_SQL}
), ser AS (
  SELECT b.*, lag(b.revenue) OVER w AS "prevRev", lag(b."fiscalYear") OVER w AS "prevYear", (lag(b."fiscalYear") OVER w = b."fiscalYear" - 1 AND lag(b.revenue) OVER w > 0 AND b.revenue IS NOT NULL) AS pair
  FROM best b WINDOW w AS (PARTITION BY b."companyId" ORDER BY b."fiscalYear")
), pat AS (
  SELECT "companyId", count(*) FILTER (WHERE pair) AS pairs, count(*) FILTER (WHERE pair AND revenue > "prevRev") AS ups, count(*) FILTER (WHERE pair AND revenue < "prevRev") AS downs,
    count(*) FILTER (WHERE "netIncome" < 0) AS losses, (array_agg("netIncome" ORDER BY "fiscalYear" DESC)) AS ni
  FROM ser GROUP BY "companyId"
)`;
export const PATTERNS = {
  up_all: { es: "Ingresos subiendo todos los años", en: "Revenue up every year", sql: Prisma.sql`pt.pairs >= 2 AND pt.ups = pt.pairs` },
  down_all: { es: "Ingresos bajando todos los años", en: "Revenue down every year", sql: Prisma.sql`pt.pairs >= 2 AND pt.downs = pt.pairs` },
  turnaround: { es: "Volvió a utilidad tras un año con pérdida", en: "Back to profit after a loss year", sql: Prisma.sql`pt.ni[1] > 0 AND pt.losses >= 1` },
  losses2: { es: "Pérdida los dos últimos años", en: "Losses in the last two years", sql: Prisma.sql`pt.ni[1] < 0 AND pt.ni[2] < 0` },
} as const;
export type PatternKey = keyof typeof PATTERNS;
export const isPattern = (k: string | undefined): k is PatternKey => !!k && k in PATTERNS;

export const GROUP_BY = { sector: { es: "Sector", en: "Sector", col: Prisma.raw(`c.sector`) }, department: { es: "Departamento", en: "Department", col: Prisma.raw(`c.department`) }, all: { es: "Todas", en: "All", col: Prisma.raw(`'*'::text`) } } as const;
export type GroupBy = keyof typeof GROUP_BY;

type GroupYear = { grp: string | null; y: number; n: number; profitable: number; withNi: number; revPair: number | null; prevPair: number | null; pairs: number; medGrowth: number | null; medMargin: number | null };
/** Like-for-like patterns per sector (or department) and year: only companies with figures in both years
 *  count for growth, because the list of the 10,000 largest changes every year. COP figures only. */
export async function groupPatterns(by: GroupBy, only?: string | null) {
  const col = GROUP_BY[by].col;
  const filter = only ? Prisma.sql`AND ${col} = ${only}` : Prisma.empty;
  const [rows, pats] = await Promise.all([
    db.$queryRaw<GroupYear[]>(Prisma.sql`WITH ${BEST}
      SELECT ${col} AS grp, s."fiscalYear" AS y, count(*)::int AS n,
        count(*) FILTER (WHERE s."netIncome" > 0)::int AS profitable, count(*) FILTER (WHERE s."netIncome" IS NOT NULL)::int AS "withNi",
        (sum(s.revenue) FILTER (WHERE s.pair))::float8 AS "revPair", (sum(s."prevRev") FILTER (WHERE s.pair))::float8 AS "prevPair", count(*) FILTER (WHERE s.pair)::int AS pairs,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY (s.revenue - s."prevRev") / s."prevRev") FILTER (WHERE s.pair))::float8 AS "medGrowth",
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY s."netIncome" / s.revenue) FILTER (WHERE s.revenue > 0 AND s."netIncome" IS NOT NULL))::float8 AS "medMargin"
      FROM ser s JOIN "MarketCompany" c ON c.id = s."companyId" WHERE s.currency = 'COP' ${filter} GROUP BY 1, 2 ORDER BY 1, 2`),
    db.$queryRaw<({ grp: string | null; companies: number } & Record<PatternKey, number>)[]>(Prisma.sql`WITH ${BEST}
      SELECT ${col} AS grp, count(*)::int AS companies, ${Prisma.join((Object.keys(PATTERNS) as PatternKey[]).map((k) => Prisma.sql`count(*) FILTER (WHERE ${PATTERNS[k].sql})::int AS ${Prisma.raw(`"${k}"`)}`), ", ")}
      FROM pat pt JOIN "MarketCompany" c ON c.id = pt."companyId" WHERE TRUE ${filter} GROUP BY 1`),
  ]);
  const years = [...new Set(rows.map((r) => r.y))].sort((a, b) => a - b);
  const groups = pats.map((p) => {
    const ys = rows.filter((r) => r.grp === p.grp);
    return {
      name: p.grp, companies: p.companies, patterns: Object.fromEntries((Object.keys(PATTERNS) as PatternKey[]).map((k) => [k, p[k]])) as Record<PatternKey, number>,
      years: Object.fromEntries(ys.map((r) => [r.y, {
        n: r.n, pairs: r.pairs,
        growth: r.prevPair && r.prevPair > 0 && r.revPair != null ? Math.round(((r.revPair - r.prevPair) / r.prevPair) * 1000) / 10 : null,
        medGrowth: r.medGrowth == null ? null : Math.round(r.medGrowth * 1000) / 10,
        profitablePct: r.withNi ? Math.round((r.profitable / r.withNi) * 100) : null,
        medMargin: r.medMargin == null ? null : Math.round(r.medMargin * 1000) / 10,
      }])) as Record<number, { n: number; pairs: number; growth: number | null; medGrowth: number | null; profitablePct: number | null; medMargin: number | null }>,
    };
  }).sort((a, b) => b.companies - a.companies);
  return { years, groups };
}
export type GroupPatterns = Awaited<ReturnType<typeof groupPatterns>>;

/** Up to four companies side by side, each with its yearly series (the shown version of each year). */
export async function compareCompanies(ids: string[]) {
  const list = await db.marketCompany.findMany({
    where: { id: { in: ids.slice(0, 4) } },
    include: { account: { select: { id: true } }, snapshots: { where: { import: { status: "COMMITTED" } }, orderBy: SNAP_ORDER } },
  });
  const byId = new Map(list.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is (typeof list)[number] => !!c).map((c) => {
    const rows = yearSeries(c.snapshots.map(toSnap));
    return { id: c.id, name: c.name, nit: c.nit, sector: c.sector, accountId: c.account?.id ?? null, rows, cagr: cagr(rows), facts: patternFacts(rows) };
  });
}
export type Compared = Awaited<ReturnType<typeof compareCompanies>>;

export async function findCompanies(q: string, exclude: string[]) {
  const digits = q.replace(/\D/g, "");
  return db.marketCompany.findMany({
    where: { id: { notIn: exclude }, OR: digits.length >= 3 ? [{ nit: { startsWith: digits.slice(0, 9) } }] : [{ name: { contains: q, mode: "insensitive" } }, { otherNames: { has: q.toUpperCase() } }] },
    select: { id: true, name: true, nit: true, sector: true }, orderBy: { name: "asc" }, take: 8,
  });
}

/** Economic view of one company: facts, indicators with formula, signals, every snapshot with its source. */
export async function companyEconomics(where: { companyId?: string; accountId?: string; taxId?: string | null }) {
  const nit = where.taxId ? (where.taxId.replace(/\D/g, "").slice(0, 9) || null) : null;
  const c = await db.marketCompany.findFirst({
    where: where.companyId ? { id: where.companyId } : { OR: [...(where.accountId ? [{ accountId: where.accountId }] : []), ...(nit && nit.length >= 6 ? [{ nit }] : [])] },
    include: {
      account: { select: { id: true, name: true } },
      snapshots: { where: { import: { status: "COMMITTED" } }, orderBy: SNAP_ORDER, include: { source: { select: { name: true } }, import: { select: { fileName: true, committedAt: true, reportYear: true } } } },
    },
  });
  if (!c) return null;
  const th = (await getThresholds()).value;
  const snaps: Snap[] = c.snapshots.map((s) => ({ ...toSnap(s), sourceName: s.source.name }));
  // Earlier versions of a year (a later file with different figures) are shown, never hidden.
  const versions = new Map<number, number>();
  for (const s of c.snapshots) versions.set(s.fiscalYear, (versions.get(s.fiscalYear) ?? 0) + 1);
  const rows = yearSeries(snaps);
  // Its sector, same years, like-for-like (context, not a ranking).
  const sector = c.sector && rows.length > 1 ? (await groupPatterns("sector", c.sector)).groups[0] ?? null : null;
  return { c, facts: facts(snaps, th), metrics: metrics(snaps), signals: econSignals(snaps, th), versions, rows, cagr: cagr(rows), patterns: patternFacts(rows), sector };
}
