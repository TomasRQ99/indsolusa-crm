import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { workPeople } from "@/lib/team-store";
import { PROSPECTS, forecastGap, forecastMonths, sum } from "@/lib/sales-budget-rules";
import { budgetKey, budgetScope, budgetYears, canWriteBudget, readYear } from "@/lib/sales-budget";
import { trackYear, type TrackLine } from "@/lib/sales-budget-track";
import { BudgetNav, budgetFmt } from "../ui";
import "../presupuesto.css";

// Presupuesto comercial · Reforecast (spec §3 "Forecast", §6): today's estimate of the year beside the official
// budget, which stays as approved. Estimate = what is already real + what each negotiator adds for the months still
// open (purchase orders they see as probable, invoices already scheduled). No probabilities are invented.

export default async function ReforecastList({ searchParams }: { searchParams: Promise<{ y?: string; u?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = budgetFmt(i);
  const sp = await searchParams;
  const now = new Date();
  const year = readYear(sp.y, now);
  const { years } = budgetYears(now);
  const scope = await budgetScope(user);
  const everyone = await workPeople(true);
  const people = scope.all ? everyone.filter((p) => p.active) : everyone.filter((p) => scope.ids.has(p.id));
  const only = sp.u && people.some((p) => p.id === sp.u) ? sp.u : null;
  const tr = await trackYear(year, now, { all: scope.all, ids: scope.ids, only, viewerId: user.id }, f.m);
  const { prog, started, lines } = tr;
  const over = prog.share.every((s) => s >= 1);
  const cuts = lines.length ? await db.salesForecast.findMany({ where: { year, userId: { in: [...new Set(lines.map((l) => l.b.userId))] } }, orderBy: { cutAt: "desc" }, include: { lines: true } }) : [];
  const latest = new Map<string, (typeof cuts)[number]>();
  for (const c of cuts) { const k = `${c.slot}|${c.userId}`; if (!latest.has(k)) latest.set(k, c); }
  const nameOf = (id: string) => everyone.find((p) => p.id === id)?.name ?? "—";

  type Row = { l: TrackLine; cut: (typeof cuts)[number] | null; oc: { prob: number; est: number } | null; fa: { prog: number; est: number } | null };
  const rows: Row[] = lines.map((l) => {
    const cut = latest.get(budgetKey(l.b)) ?? null;
    if (!cut) return { l, cut, oc: null, fa: null };
    const typed = (kpi: string) => Array.from({ length: 12 }, (_, m) => { const x = cut.lines.find((z) => z.kpi === kpi && z.month === m + 1); return x ? Number(x.value) : null; });
    const a = forecastMonths(l.realOc, typed("OC_PROB"), prog), b = forecastMonths(l.realFact, typed("FACT_PROG"), prog);
    return { l, cut, oc: { prob: sum(a.map((x) => x.typed)), est: sum(a.map((x) => x.estimate)) }, fa: { prog: sum(b.map((x) => x.typed)), est: sum(b.map((x) => x.estimate)) } };
  });
  const byPerson = new Map<string, Row[]>();
  for (const r of rows) byPerson.set(r.l.b.userId, [...(byPerson.get(r.l.b.userId) ?? []), r]);
  const add = (rs: Row[]) => { const w = rs.filter((r) => r.oc && r.fa); return { n: w.length, of: rs.length, ocGoal: sum(w.map((r) => r.l.oc.goal)), ocReal: sum(w.map((r) => r.l.oc.real)), prob: sum(w.map((r) => r.oc!.prob)), ocEst: sum(w.map((r) => r.oc!.est)), faGoal: sum(w.map((r) => r.l.fa.goal)), faEst: sum(w.map((r) => r.fa!.est)) }; };
  const H = { goal: t("Presupuesto OC", "PO budget"), real: t("OC reales a hoy", "Real POs so far"), prob: t("OC probables", "Probable POs"), est: t("Reforecast OC", "PO reforecast"), diff: t("Frente al presupuesto", "Against the budget"), fgoal: t("Presupuesto facturación", "Invoicing budget"), fest: t("Reforecast facturación", "Invoicing reforecast"), fdiff: t("Frente al presupuesto", "Against the budget"), cut: t("Último corte", "Latest cut") };
  const gap = (est: number, goal: number) => { const g = forecastGap(est, goal); return <b className={g.diff < 0 ? "pc-down" : g.diff > 0 ? "pc-up" : ""}>{g.diff > 0 ? "+" : ""}{f.bare(g.diff)}{g.pct != null ? ` (${f.signed(g.pct)})` : ""}</b>; };
  const sumCells = (rs: Row[]) => { const x = add(rs); return x.n === 0 ? <td colSpan={8} className="l muted">{t("Sin reforecast todavía", "No reforecast yet")}</td> : (<>
    <td data-l={H.goal}>{f.bare(x.ocGoal)}</td><td data-l={H.real}>{f.bare(x.ocReal)}</td><td data-l={H.prob}>{f.bare(x.prob)}</td><td data-l={H.est}>{f.bare(x.ocEst)}</td><td data-l={H.diff}>{gap(x.ocEst, x.ocGoal)}</td>
    <td data-l={H.fgoal}>{f.bare(x.faGoal)}</td><td data-l={H.fest}>{f.bare(x.faEst)}</td><td data-l={H.fdiff}>{gap(x.faEst, x.faGoal)}</td>
  </>); };
  const T = add(rows);

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href={`/comercial/presupuesto?y=${year}`}>{t(`Presupuesto comercial ${year}`, `Commercial budget ${year}`)}</Link></div>
        <h1>{t(`Reforecast ${year}`, `Reforecast ${year}`)}</h1>
        <p>{t("Cómo se ve hoy el cierre del año, al lado del presupuesto oficial, que no cambia. Reforecast = lo que ya es real + lo que cada negociador agrega para los meses que faltan: las órdenes de compra que ve probables y las facturas ya programadas.", "How the year's close looks today, beside the official budget, which does not change. Reforecast = what is already real + what each negotiator adds for the months left: the purchase orders they see as probable and the invoices already scheduled.")}</p>
      </div></div>
      <BudgetNav i={i} active="reforecast" year={year} years={years} personId={only} />
      {!started && <div className="note" id="sin-empezar">{t(`El año ${year} todavía no empieza: el reforecast se abre en enero, cuando ya hay cifras reales que comparar. Mientras tanto, elige arriba el año en curso.`, `The year ${year} has not started yet: the reforecast opens in January, once there are real figures to compare. Meanwhile, choose the year in course above.`)}</div>}
      {over && <div className="note">{t(`El año ${year} ya cerró: lo real es definitivo y no hay nada que estimar.`, `The year ${year} is over: the real figures are final and there is nothing to estimate.`)}</div>}

      {people.length > 1 && (
        <div className="pc-bar"><form method="get"><input type="hidden" name="y" value={year} />
          <label>{t("Negociador", "Negotiator")}<select name="u" defaultValue={only ?? ""}><option value="">{t("Todos los que ves", "Everyone you see")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button type="submit" className="secondary">{t("Ver", "View")}</button>
        </form></div>
      )}

      {started && (
        <>
          <div className="pc-tiles">
            <article data-t="con"><b>{t("Empresas con reforecast", "Companies with a reforecast")}</b><span>{T.n} / {T.of}</span><small>{t("Las demás solo muestran su presupuesto", "The others only show their budget")}</small></article>
            <article data-t="oc"><b>{t("Reforecast OC", "PO reforecast")}</b><span>{T.n ? f.m(T.ocEst) : "—"}</span><small>{T.n ? t(`frente a ${f.m(T.ocGoal)} presupuestados en esas empresas`, `against ${f.m(T.ocGoal)} budgeted for those companies`) : t("Aún sin cortes", "No cuts yet")}</small></article>
            <article data-t="fact"><b>{t("Reforecast facturación", "Invoicing reforecast")}</b><span>{T.n ? f.m(T.faEst) : "—"}</span><small>{T.n ? t(`frente a ${f.m(T.faGoal)} presupuestados en esas empresas`, `against ${f.m(T.faGoal)} budgeted for those companies`) : t("Aún sin cortes", "No cuts yet")}</small></article>
          </div>
          <section className="card" id="lista">
            <b>{t("PRESUPUESTO OFICIAL Y REFORECAST", "OFFICIAL BUDGET AND REFORECAST")}</b>
            {rows.length === 0 ? <p className="small muted">{t("No hay presupuestos de este año a tu vista. Empieza en «Mis empresas».", "There are no budgets of this year in your view. Start in «My companies».")}</p> : (
              <div className="pc-scroll">
                <table className="pc-table pc-cards" id="tabla-reforecast">
                  <thead><tr><th>{t("Negociador / empresa", "Negotiator / company")}</th><th>{H.goal}</th><th>{H.real}</th><th>{H.prob}</th><th>{H.est}</th><th>{H.diff}</th><th>{H.fgoal}</th><th>{H.fest}</th><th>{H.fdiff}</th><th className="l">{H.cut}</th><th /></tr></thead>
                  <tbody>
                    <tr className="pc-total" data-n="TOTAL"><th scope="row">{only ? nameOf(only) : t("Todo lo que ves", "Everything you see")}</th>{sumCells(rows)}<td className="l">{t(`${T.n} de ${T.of} empresas`, `${T.n} of ${T.of} companies`)}</td><td /></tr>
                    {[...byPerson.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]), "es")).flatMap(([uid, rs]) => [
                      <tr key={uid} className="pc-sub pc-l1" data-n={`P-${uid}`}><th scope="row">{nameOf(uid)}</th>{sumCells(rs)}<td /><td /></tr>,
                      ...rs.sort((a, b) => b.l.oc.goal - a.l.oc.goal).map((r) => { const href = `/comercial/presupuesto/reforecast/${r.l.b.slot === PROSPECTS ? "prospectos" : r.l.b.slot}?y=${year}&u=${uid}`; return (
                        <tr key={r.l.b.id} className="pc-l2" data-n={`B-${r.l.b.slot}`}>
                          <th scope="row"><Link href={href}>{r.l.b.slot === PROSPECTS ? t("Reactivaciones y prospectos", "Reactivations and prospects") : r.l.b.account?.name ?? "—"}</Link></th>
                          {r.oc && r.fa ? (<>
                            <td data-l={H.goal}>{f.bare(r.l.oc.goal)}</td><td data-l={H.real}>{f.bare(r.l.oc.real)}</td><td data-l={H.prob}>{f.bare(r.oc.prob)}</td><td data-l={H.est}>{f.bare(r.oc.est)}</td><td data-l={H.diff}>{gap(r.oc.est, r.l.oc.goal)}</td>
                            <td data-l={H.fgoal}>{f.bare(r.l.fa.goal)}</td><td data-l={H.fest}>{f.bare(r.fa.est)}</td><td data-l={H.fdiff}>{gap(r.fa.est, r.l.fa.goal)}</td>
                          </>) : (<>
                            <td data-l={H.goal}>{f.bare(r.l.oc.goal)}</td><td data-l={H.real}>{f.bare(r.l.oc.real)}</td><td colSpan={3} className="l muted">{t("Sin reforecast todavía", "No reforecast yet")}</td>
                            <td data-l={H.fgoal}>{f.bare(r.l.fa.goal)}</td><td colSpan={2} />
                          </>)}
                          <td className="l" data-l={H.cut}>{r.cut ? `${i.day(r.cut.cutAt)} · ${r.cut.createdByName}` : "—"}</td>
                          <td>{!over && <Link className="btn secondary" href={href}>{canWriteBudget(user, uid) ? (r.cut ? t("Actualizar", "Update") : t("Hacer reforecast", "Make a reforecast")) : t("Ver", "View")} →</Link>}</td>
                        </tr>
                      ); }),
                    ])}
                  </tbody>
                </table>
              </div>
            )}
            <p className="src">{t("Cifras en millones de pesos. Las sumas incluyen solo las empresas que ya tienen reforecast, para comparar lo mismo en los dos lados. El reforecast se recalcula solo: cuando una orden probable se acepta pasa a «reales», y lo escrito para un mes que ya cerró deja de contar. El presupuesto oficial es el aprobado; donde no lo hay, la última propuesta.", "Figures in millions of pesos. The sums include only the companies that already have a reforecast, so both sides compare the same thing. The reforecast recalculates itself: when a probable order is accepted it moves to «real», and what was typed for a month that closed stops counting. The official budget is the approved one; where there is none, the latest proposal.")}</p>
          </section>
        </>
      )}
    </>
  );
}
