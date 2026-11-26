import { db } from "./db";
import { monthOf } from "./customer-stats";
import { expectedToDate, radar, realToDate, sum, yearProgress, zeros, type RadarHit, type RadarKind, type YearProgress } from "./sales-budget-rules";
import { budgetKey, budgetsOf, groupVersions, lastMonths, loadFacts, matrixOf, numbers, realByBudget, totals, yearRow, type BudgetRow, type FactSet } from "./sales-budget";

// Presupuesto comercial · real against budget and the radar, read once for every screen that shows them
// (Cumplimiento y radar, Reforecast, the day's priorities and the evening email), so they can never disagree.

/** Whose budgets are looked at: everything, some people, or one person. */
export type TrackView = { all: boolean; ids: Set<string>; only: string | null; viewerId: string };
export type TrackLine = { b: BudgetRow; oc: { goal: number; exp: number; real: number }; fa: { goal: number; exp: number; real: number }; es: { exp: number; real: number }; realOc: number[]; realFact: number[]; realEnt: number[] };
export type TrackHit = RadarHit & { accountId: string; ownerId: string };
export type Tracking = {
  year: number; published: boolean; prog: YearProgress; started: boolean;
  set: FactSet; lines: TrackLine[];
  accounts: Map<string, { id: string; name: string; ownerId: string }>;
  unassigned: { accountId: string; ownerId: string; oc: number; fa: number }[];
  hits: TrackHit[];
  /** Purchase orders of the last twelve complete months per company in view (orders the radar and the lists). */
  oc12: Map<string, number>;
};

const PRIO: RadarKind[] = ["PACE", "MARGIN", "REQUESTS", "QUOTES", "BILLING"];

/** `cop` writes a peso figure inside the radar's evidence text (the screens use "$ 40 M"). */
export async function trackYear(year: number, now: Date, view: TrackView, cop: (v: number) => string): Promise<Tracking> {
  const inView = (id: string) => (view.only ? id === view.only : view.all || view.ids.has(id));
  const [rows, yr] = await Promise.all([budgetsOf(year), yearRow(year)]);
  // Compare against the approved budget; where there is none yet, against the latest proposal.
  const allChosen = [...groupVersions(rows).values()].map((g) => g.official ?? g.latest);
  const chosen = allChosen.filter((b) => inView(b.userId));
  const set = await loadFacts(view.all && !view.only ? {} : { ownerIds: view.only ? [view.only] : [...view.ids], accountIds: chosen.map((b) => b.accountId).filter((x): x is string => !!x) });
  const accountIds = [...new Set([...set.facts.map((x) => x.accountId), ...chosen.map((b) => b.accountId).filter((x): x is string => !!x)])];
  const accounts = new Map((await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, ownerId: true } })).map((a) => [a.id, a]));
  // Attribution uses every budget of the year, so a figure is never handed to someone just because of who is looking.
  const real = realByBudget(set, year, allChosen, (id) => accounts.get(id)?.ownerId ?? null);
  const prog = yearProgress(year, now);
  const started = prog.share.some((s) => s > 0);

  const lines: TrackLine[] = chosen.map((b) => {
    const m = matrixOf(b), r = real.byKey.get(budgetKey(b));
    const of = (goal: number[], got: number[] | undefined) => ({ goal: sum(goal), exp: expectedToDate(goal, prog), real: realToDate(got ?? zeros(), prog) });
    return { b, oc: of(numbers(m.OC_COP), r?.OC_COP), fa: of(numbers(m.FACT_COP), r?.FACT_COP), es: of(numbers(m.ESA_COP), r?.ESA_COP), realOc: r?.OC_COP ?? zeros(), realFact: r?.FACT_COP ?? zeros(), realEnt: r?.ENT_N ?? zeros() };
  });
  const unassigned = [...real.unassignedRows.entries()].map(([k, r]) => { const [accountId, ownerId] = k.split("|"); return { accountId, ownerId, oc: realToDate(r.OC_COP, prog), fa: realToDate(r.FACT_COP, prog) }; }).filter((x) => inView(x.ownerId) && (x.oc > 0 || x.fa > 0)).sort((a, b) => b.oc - a.oc);

  // ---------- Radar ----------
  const current = monthOf(now);
  const six = lastMonths(current, 6), twelve = lastMonths(current, 12);
  const seen = (x: { ownerId: string }) => inView(x.ownerId);
  const companies = [...new Set(set.facts.filter(seen).filter((x) => x.month >= twelve[0]).map((x) => x.accountId))];
  const oc12 = new Map(companies.map((id) => { const tt = totals(set, (x) => x.accountId === id && seen(x)); return [id, sum(twelve.map((m) => tt.of("OC_COP", m)))] as const; }));
  const totalOc12 = sum([...oc12.values()]);
  const pareto = new Set<string>();
  { let acc = 0; for (const [id, v] of [...oc12.entries()].sort((a, b) => b[1] - a[1])) { if (v <= 0 || acc >= totalOc12 * 0.8) break; pareto.add(id); acc += v; } }
  const cm = prog.current;
  const hits: TrackHit[] = companies.flatMap((id) => {
    const tt = totals(set, (x) => x.accountId === id && seen(x));
    const ls = lines.filter((l) => l.b.accountId === id);
    const fact = ls.map((l) => numbers(matrixOf(l.b).FACT_COP));
    const ownerId = ls[0]?.b.userId ?? accounts.get(id)?.ownerId ?? view.viewerId;
    return radar({
      expected: sum(ls.map((l) => l.oc.exp)), real: sum(ls.map((l) => l.oc.real)), pareto: pareto.has(id),
      sol: six.map((m) => tt.of("SOL_N", m)), cotN: six.map((m) => tt.of("COT_N", m)), ocN: six.map((m) => tt.of("OC_N", m)), oc: six.map((m) => tt.of("OC_COP", m)), esa: six.map((m) => tt.of("ESA_COP", m)),
      factAhead: cm ? sum(fact.map((x) => x[cm - 1] + (cm < 12 ? x[cm] : 0))) : 0, backlog: set.backlog.filter((x) => x.accountId === id && seen(x)).reduce((s, x) => s + x.cop, 0),
    }, cop).map((h) => ({ ...h, accountId: id, ownerId: inView(ownerId) ? ownerId : view.viewerId }));
  });
  hits.sort((a, b) => PRIO.indexOf(a.kind) - PRIO.indexOf(b.kind) || (oc12.get(b.accountId) ?? 0) - (oc12.get(a.accountId) ?? 0));
  return { year, published: !!yr?.publishedAt, prog, started, set, lines, accounts, unassigned, hits, oc12 };
}
