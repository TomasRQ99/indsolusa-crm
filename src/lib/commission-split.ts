// Módulo 12 R2 · who shares a sale's commission (§11.2–12). Pure: no database.
// The fund is divided between two functions (Commercial, Operational) by the policy, and each function's part between
// the people Gerencia names. With nobody named, a function's part goes to the Journey's negotiator, who then does both.

export type Pool = "COMMERCIAL" | "OPERATIONAL";
export const POOLS: Record<Pool, { es: string; en: string }> = { COMMERCIAL: { es: "Comercial", en: "Commercial" }, OPERATIONAL: { es: "Operativo", en: "Operational" } };
export type Alloc = { userId: string; userName: string; pool: string; splitPct: number };
export type Share = { userId: string; userName: string; frac: number; parts: { pool: Pool; poolPct: number; splitPct: number }[] };

export function sharesOf(policy: { commercialPct: number; operationalPct: number } | null, allocs: Alloc[], owner: { id: string; name: string }): Share[] {
  const pools: [Pool, number][] = policy ? [["COMMERCIAL", policy.commercialPct], ["OPERATIONAL", policy.operationalPct]] : [["COMMERCIAL", 100]];
  const by = new Map<string, Share>();
  for (const [pool, poolPct] of pools) {
    if (poolPct <= 0) continue;
    const named = allocs.filter((a) => a.pool === pool && a.splitPct > 0);
    const rows = named.length ? named : [{ userId: owner.id, userName: owner.name, pool, splitPct: 100 }];
    for (const r of rows) {
      const s = by.get(r.userId) ?? { userId: r.userId, userName: r.userName, frac: 0, parts: [] };
      s.frac += (poolPct / 100) * (r.splitPct / 100);
      s.parts.push({ pool, poolPct, splitPct: r.splitPct });
      by.set(r.userId, s);
    }
  }
  return [...by.values()].map((s) => ({ ...s, frac: Math.round(s.frac * 1e6) / 1e6 }));
}
/** How a share reads in a calculation: "Comercial 50 % × 70 % + Operativo 50 % × 100 %". */
export const shareText = (s: Share, es = true) => s.parts.map((p) => `${es ? POOLS[p.pool].es : POOLS[p.pool].en} ${p.poolPct} %${p.splitPct !== 100 ? ` × ${p.splitPct} %` : ""}`).join(" + ");

export type SplitRow = { userId: string; pool: string; splitPct: number | null };
/** Within each function the named people must add up to exactly 100 %; a function with nobody named is allowed. */
export function splitProblem(rows: SplitRow[]): "POOL" | "PCT" | "DUPLICATE" | "SUM" | null {
  for (const r of rows) {
    if (r.pool !== "COMMERCIAL" && r.pool !== "OPERATIONAL") return "POOL";
    if (r.splitPct == null || !(r.splitPct > 0) || r.splitPct > 100) return "PCT";
  }
  for (const pool of ["COMMERCIAL", "OPERATIONAL"]) {
    const rs = rows.filter((r) => r.pool === pool);
    if (!rs.length) continue;
    if (new Set(rs.map((r) => r.userId)).size !== rs.length) return "DUPLICATE";
    if (Math.abs(rs.reduce((a, r) => a + (r.splitPct ?? 0), 0) - 100) > 0.005) return "SUM";
  }
  return null;
}
