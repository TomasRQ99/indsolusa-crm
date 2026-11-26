import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { monthOf } from "@/lib/customer-stats";
import { workPeople } from "@/lib/team-store";
import { addWorkingDays } from "@/lib/holidays";
import { BUDGET_RULES, PROSPECTS, RADAR_TXT, achievement, expectedToDate, radar, realToDate, shownState, sum, yearProgress, zeros, type RadarKind } from "@/lib/sales-budget-rules";
import { budgetKey, budgetScope, budgetYears, budgetsOf, groupVersions, lastMonths, loadFacts, matrixOf, numbers, readYear, realByBudget, totals, yearRow, type BudgetRow } from "@/lib/sales-budget";
import { radarTask } from "../actions";
import { BudgetNav, StateChip, budgetFmt } from "../ui";
import "../presupuesto.css";

// Presupuesto comercial · P07 Cumplimiento y radar (spec §5, §8). Real against budget with the same calendar on both
// sides: closed months in full and the month in course by its working days gone (AT-12). The radar is a set of fixed
// rules over SOLU's own records; each detection shows the figures behind it and never states a cause.

export default async function BudgetTracking({ searchParams }: { searchParams: Promise<{ y?: string; u?: string; ok?: string; err?: string }> }) {
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
  const inView = (id: string) => (only ? id === only : scope.all || scope.ids.has(id));

  const [rows, yr] = await Promise.all([budgetsOf(year), yearRow(year)]);
  const published = !!yr?.publishedAt;
  // Compare against the approved budget; where there is none yet, against the latest proposal (and say so).
  const allChosen = [...groupVersions(rows).values()].map((g) => g.official ?? g.latest);
  const chosen = allChosen.filter((b) => inView(b.userId));
  const set = await loadFacts(scope.all && !only ? {} : { ownerIds: only ? [only] : [...scope.ids], accountIds: chosen.map((b) => b.accountId).filter((x): x is string => !!x) });
  const accountIds = [...new Set(set.facts.map((x) => x.accountId))];
  const accounts = new Map((await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, ownerId: true } })).map((a) => [a.id, a]));
  // Attribution uses every budget of the year, so a figure is never handed to someone just because of who is looking.
  const real = realByBudget(set, year, allChosen, (id) => accounts.get(id)?.ownerId ?? null);
  const prog = yearProgress(year, now);
  const started = prog.share.some((s) => s > 0);
  const nameOf = (id: string) => everyone.find((p) => p.id === id)?.name ?? "—";

  type Line = { b: BudgetRow; oc: { goal: number; exp: number; real: number }; fa: { goal: number; exp: number; real: number }; es: { exp: number; real: number } };
  const lines: Line[] = chosen.map((b) => {
    const m = matrixOf(b), r = real.byKey.get(budgetKey(b));
    const of = (goal: number[], got: number[] | undefined) => ({ goal: sum(goal), exp: expectedToDate(goal, prog), real: realToDate(got ?? zeros(), prog) });
    return { b, oc: of(numbers(m.OC_COP), r?.OC_COP), fa: of(numbers(m.FACT_COP), r?.FACT_COP), es: of(numbers(m.ESA_COP), r?.ESA_COP) };
  });
  const byPerson = new Map<string, Line[]>();
  for (const l of lines) byPerson.set(l.b.userId, [...(byPerson.get(l.b.userId) ?? []), l]);
  const add = (ls: Line[]) => ({ ocGoal: sum(ls.map((l) => l.oc.goal)), ocExp: sum(ls.map((l) => l.oc.exp)), ocReal: sum(ls.map((l) => l.oc.real)), faGoal: sum(ls.map((l) => l.fa.goal)), faExp: sum(ls.map((l) => l.fa.exp)), faReal: sum(ls.map((l) => l.fa.real)), esExp: sum(ls.map((l) => l.es.exp)), esReal: sum(ls.map((l) => l.es.real)) });
  const T = add(lines);
  const elapsedYear = prog.totalYear - prog.remainingYear;
  const project = (v: number) => (started && elapsedYear >= 20 ? (v / elapsedYear) * prog.totalYear : null);
  const perDay = (goal: number, got: number) => (prog.remainingYear > 0 && goal > got ? (goal - got) / prog.remainingYear : null);
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
  const hits = companies.flatMap((id) => {
    const tt = totals(set, (x) => x.accountId === id && seen(x));
    const ls = lines.filter((l) => l.b.accountId === id);
    const fact = ls.map((l) => numbers(matrixOf(l.b).FACT_COP));
    const ownerId = ls[0]?.b.userId ?? accounts.get(id)?.ownerId ?? user.id;
    return radar({
      expected: sum(ls.map((l) => l.oc.exp)), real: sum(ls.map((l) => l.oc.real)), pareto: pareto.has(id),
      sol: six.map((m) => tt.of("SOL_N", m)), cotN: six.map((m) => tt.of("COT_N", m)), ocN: six.map((m) => tt.of("OC_N", m)), oc: six.map((m) => tt.of("OC_COP", m)), esa: six.map((m) => tt.of("ESA_COP", m)),
      factAhead: cm ? sum(fact.map((x) => x[cm - 1] + (cm < 12 ? x[cm] : 0))) : 0, backlog: set.backlog.filter((x) => x.accountId === id && seen(x)).reduce((s, x) => s + x.cop, 0),
    }, f.m).map((h) => ({ ...h, accountId: id, ownerId: inView(ownerId) ? ownerId : user.id }));
  });
  const prio: RadarKind[] = ["PACE", "MARGIN", "REQUESTS", "QUOTES", "BILLING"];
  hits.sort((a, b) => prio.indexOf(a.kind) - prio.indexOf(b.kind) || (oc12.get(b.accountId) ?? 0) - (oc12.get(a.accountId) ?? 0));
  const due = addWorkingDays(new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"), 2).toISOString().slice(0, 10);

  const H = { goal: t("Presupuesto OC del año", "PO budget of the year"), exp: t("OC esperadas a hoy", "POs expected by today"), real: t("OC reales", "Real POs"), pct: t("Cumplimiento OC", "PO achievement"), gap: t("Faltante a hoy", "Shortfall today"), fexp: t("Facturación esperada a hoy", "Invoicing expected by today"), freal: t("Facturación real", "Real invoicing"), fpct: t("Cumplimiento facturación", "Invoicing achievement"), es: t("Eságara real / esperada", "Eságara real / expected"), st: t("Presupuesto", "Budget") };
  const cells = (x: ReturnType<typeof add>) => {
    const p = achievement(x.ocReal, x.ocExp), q = achievement(x.faReal, x.faExp);
    return (<>
      <td data-l={H.goal}>{f.m(x.ocGoal)}</td>
      <td data-l={H.exp}>{started ? f.m(x.ocExp) : "—"}</td>
      <td data-l={H.real}>{started ? f.m(x.ocReal) : "—"}</td>
      <td data-l={H.pct}>{p == null ? "—" : <><b className={p < BUDGET_RULES.belowPace * 100 ? "pc-down" : p >= 100 ? "pc-up" : ""}>{f.pct(p)}</b><span className="pc-meter"><span style={{ width: `${Math.min(100, p)}%` }} /></span></>}</td>
      <td data-l={H.gap}>{started ? (x.ocExp > x.ocReal ? f.m(x.ocExp - x.ocReal) : t("al día", "on track")) : "—"}</td>
      <td data-l={H.fexp}>{started ? f.m(x.faExp) : "—"}</td>
      <td data-l={H.freal}>{started ? f.m(x.faReal) : "—"}</td>
      <td data-l={H.fpct}>{q == null ? "—" : <b className={q < BUDGET_RULES.belowPace * 100 ? "pc-down" : q >= 100 ? "pc-up" : ""}>{f.pct(q)}</b>}</td>
      <td data-l={H.es}>{started ? `${f.m(x.esReal)} / ${f.m(x.esExp)}` : "—"}</td>
    </>);
  };
  const one = (l: Line) => add([l]);
  const okMsg: Record<string, string> = { tarea: t("Pendiente creado para el negociador. Lo ve en MI DÍA → Pendientes.", "To-do created for the negotiator. They see it in MY DAY → To-dos.") };
  const errMsg: Record<string, string> = { permiso: t("Solo puedes asignar pendientes a ti o a las personas que lideras.", "You can only assign to-dos to yourself or the people you lead."), tarea: t("Falta el texto del pendiente.", "The to-do text is missing.") };
  const monthName = cm ? new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, cm - 1, 1))) : null;

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href={`/comercial/presupuesto?y=${year}`}>{t(`Presupuesto comercial ${year}`, `Commercial budget ${year}`)}</Link></div>
        <h1>{t(`Cumplimiento y radar ${year}`, `Achievement and radar ${year}`)}</h1>
        <p>{t("Lo real frente al presupuesto, con el mismo calendario en los dos lados: los meses cerrados completos y el mes en curso por sus días hábiles transcurridos. Abajo, el radar: lo que SOLU detecta en sus registros y qué hacer.", "Real against budget, with the same calendar on both sides: closed months in full and the month in course by its working days gone. Below, the radar: what SOLU detects in its records and what to do.")}</p>
      </div></div>
      <BudgetNav i={i} active="cumplimiento" year={year} years={years} personId={only} />
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {!started && <div className="note">{t(`El año ${year} todavía no empieza: el cumplimiento aparece desde enero. El radar de abajo ya funciona, porque lee los últimos seis meses.`, `The year ${year} has not started yet: achievement shows from January. The radar below already works, because it reads the last six months.`)}</div>}

      {people.length > 1 && (
        <div className="pc-bar">
          <form method="get">
            <input type="hidden" name="y" value={year} />
            <label>{t("Negociador", "Negotiator")}<select name="u" defaultValue={only ?? ""}><option value="">{t("Todos los que ves", "Everyone you see")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button type="submit" className="secondary">{t("Ver", "View")}</button>
          </form>
        </div>
      )}

      <div className="pc-tiles">
        <article><b>{t("Órdenes de compra", "Purchase orders")}</b><span>{started ? f.pct(achievement(T.ocReal, T.ocExp)) : "—"}</span><small>{started ? t(`${f.m(T.ocReal)} reales de ${f.m(T.ocExp)} esperados a hoy`, `${f.m(T.ocReal)} real of ${f.m(T.ocExp)} expected by today`) : t(`Presupuesto del año: ${f.m(T.ocGoal)}`, `Budget of the year: ${f.m(T.ocGoal)}`)}</small></article>
        <article><b>{t("Facturación", "Invoicing")}</b><span>{started ? f.pct(achievement(T.faReal, T.faExp)) : "—"}</span><small>{started ? t(`${f.m(T.faReal)} reales de ${f.m(T.faExp)} esperados a hoy`, `${f.m(T.faReal)} real of ${f.m(T.faExp)} expected by today`) : t(`Presupuesto del año: ${f.m(T.faGoal)}`, `Budget of the year: ${f.m(T.faGoal)}`)}</small></article>
        <article><b>{t("Ritmo para cumplir", "Pace to deliver")}</b><span>{started && perDay(T.ocGoal, T.ocReal) != null ? f.m(perDay(T.ocGoal, T.ocReal)) : "—"}</span><small>{started ? t(`de OC por día hábil · quedan ${prog.remainingYear} días hábiles del año`, `of POs per working day · ${prog.remainingYear} working days left in the year`) : t("Aparece cuando empiece el año", "Shows once the year starts")}</small></article>
        <article><b>{t("Si sigue el ritmo actual", "If the current pace holds")}</b><span>{project(T.ocReal) != null ? f.m(project(T.ocReal)) : "—"}</span><small>{project(T.ocReal) != null ? t(`de OC al cierre de ${year}, frente a ${f.m(T.ocGoal)} presupuestados`, `of POs at the ${year} close, against ${f.m(T.ocGoal)} budgeted`) : t("Aparece desde el día hábil 20 del año", "Shows from working day 20 of the year")}</small></article>
        <article><b>{t("Radar", "Radar")}</b><span>{hits.length}</span><small>{t("detecciones con sus cifras", "detections with their figures")}</small></article>
      </div>

      <section className="card" id="cumplimiento">
        <b>{t("REAL FRENTE AL PRESUPUESTO", "REAL AGAINST BUDGET")}</b>
        {lines.length === 0 ? <p className="small muted">{t("No hay presupuestos de este año a tu vista. Empieza en «Mis empresas».", "There are no budgets of this year in your view. Start in «My companies».")}</p> : (
          <div className="pc-scroll">
            <table className="pc-table pc-cards" id="tabla-cumplimiento">
              <thead><tr><th>{t("Negociador / empresa", "Negotiator / company")}</th><th>{H.goal}</th><th>{H.exp}</th><th>{H.real}</th><th>{H.pct}</th><th>{H.gap}</th><th>{H.fexp}</th><th>{H.freal}</th><th>{H.fpct}</th><th>{H.es}</th><th className="l">{H.st}</th></tr></thead>
              <tbody>
                <tr className="pc-total" data-n="TOTAL"><th scope="row">{only ? nameOf(only) : t("Todo lo que ves", "Everything you see")}</th>{cells(T)}<td /></tr>
                {[...byPerson.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]), "es")).flatMap(([uid, ls]) => [
                  <tr key={uid} className="pc-sub pc-l1" data-n={`P-${uid}`}><th scope="row">{nameOf(uid)}</th>{cells(add(ls))}<td /></tr>,
                  ...ls.sort((a, b) => b.oc.goal - a.oc.goal).map((l) => (
                    <tr key={l.b.id} className="pc-l2" data-n={`B-${l.b.slot}`}>
                      <th scope="row"><Link href={`/comercial/presupuesto/${l.b.slot === PROSPECTS ? "prospectos" : l.b.slot}?y=${year}&u=${l.b.userId}`}>{l.b.slot === PROSPECTS ? t("Reactivaciones y prospectos", "Reactivations and prospects") : l.b.account?.name ?? "—"}</Link></th>
                      {cells(one(l))}
                      <td className="l" data-l={H.st}><StateChip i={i} state={shownState(l.b, published)} /></td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
        <p className="src">{cm ? t(`Hoy es el día hábil ${prog.elapsed} de ${prog.total} de ${monthName}: de ese mes se espera ${Math.round(prog.share[cm - 1] * 100)} % de su presupuesto. `, `Today is working day ${prog.elapsed} of ${prog.total} of ${monthName}: ${Math.round(prog.share[cm - 1] * 100)} % of that month's budget is expected. `) : ""}{t("Se compara con el presupuesto aprobado; donde aún no lo hay, con la última propuesta (la columna «Presupuesto» lo dice). Las «OC reales» de quien no tiene presupuesto propio para una empresa entran en el del dueño de esa empresa; lo vendido a empresas sin presupuesto entra en «Reactivaciones y prospectos». Una orden rechazada no cuenta. Cifras en millones de pesos.", "Compared with the approved budget; where there is none yet, with the latest proposal (the «Budget» column says so). The «real POs» of someone without their own budget for a company go into that of the company's owner; what is sold to companies without a budget goes into «Reactivations and prospects». A rejected order does not count. Figures in millions of pesos.")}</p>
        {unassigned.length > 0 && (
          <details className="small" id="sin-presupuesto"><summary>{t(`Real sin presupuesto: ${unassigned.length} empresas`, `Real without a budget: ${unassigned.length} companies`)}</summary>
            <ul className="mk-ul">{unassigned.slice(0, 40).map((x) => <li key={`${x.accountId}|${x.ownerId}`}><Link href={`/comercial/presupuesto/${x.accountId}?y=${year}&u=${x.ownerId}`}>{accounts.get(x.accountId)?.name ?? "—"}</Link> · {nameOf(x.ownerId)} · OC {f.m(x.oc)} · {t("facturación", "invoicing")} {f.m(x.fa)}</li>)}</ul>
          </details>
        )}
      </section>

      <section className="card" id="radar">
        <b>{t("RADAR", "RADAR")}</b>
        {hits.length === 0 ? <p className="small muted">{t("SOLU no detecta nada que atender ahora con sus reglas.", "SOLU detects nothing to attend to right now with its rules.")}</p> : (
          <ul className="pc-radar">
            {hits.slice(0, 30).map((h, n) => { const acc = accounts.get(h.accountId); return (
              <li key={n} data-kind={h.kind}>
                <b>{t(RADAR_TXT[h.kind].title.es, RADAR_TXT[h.kind].title.en)} · <Link href={`/comercial/presupuesto/${h.accountId}?y=${year}&u=${h.ownerId}`}>{acc?.name ?? "—"}</Link></b>
                <span>{t(h.evidence.es, h.evidence.en)}</span>
                <span className="small"><b>{t("Siguiente acción", "Next action")}:</b> {t(RADAR_TXT[h.kind].action.es, RADAR_TXT[h.kind].action.en)} · <Link href={`/accounts/${h.accountId}`}>{t("Abrir la ficha del cliente", "Open the customer page")}</Link> · <Link href={`/accounts/${h.accountId}/estadisticas`}>{t("Ver sus estadísticas", "See their statistics")}</Link></span>
                <form action={radarTask.bind(null, year)}>
                  <input type="hidden" name="assigneeId" value={h.ownerId} /><input type="hidden" name="accountId" value={h.accountId} />
                  <label>{t(`Pendiente para ${nameOf(h.ownerId)}`, `To-do for ${nameOf(h.ownerId)}`)}<input type="text" name="title" maxLength={200} required defaultValue={`${acc?.name ?? ""}: ${t(RADAR_TXT[h.kind].action.es, RADAR_TXT[h.kind].action.en)}`.slice(0, 200)} /></label>
                  <label>{t("Para el", "Due")}<input type="date" name="due" defaultValue={due} required /></label>
                  <button type="submit" className="secondary">{t("Asignar pendiente", "Assign to-do")}</button>
                </form>
              </li>
            ); })}
          </ul>
        )}
        <details className="small" style={{ marginTop: 10 }}><summary>{t("Cómo detecta el radar", "How the radar detects")}</summary>
          <ul className="mk-ul">
            <li>{t(`Por debajo del ritmo: las OC reales son menos del ${BUDGET_RULES.belowPace * 100} % de lo esperado a hoy.`, `Below pace: real POs are under ${BUDGET_RULES.belowPace * 100} % of what was expected by today.`)}</li>
            <li>{t(`Solicitudes en descenso: un cliente Pareto (los que suman el 80 % de las OC de 12 meses) con ${BUDGET_RULES.requestDrop * 100} % menos solicitudes en los últimos 3 meses completos que en los 3 anteriores.`, `Requests falling: a Pareto customer (those adding up to 80 % of 12 months of POs) with ${BUDGET_RULES.requestDrop * 100} % fewer requests in the last 3 complete months than in the 3 before.`)}</li>
            <li>{t(`Cotizaciones suben y OC no: ${BUDGET_RULES.quoteRise * 100} % más cotizaciones y las mismas o menos órdenes de compra.`, `Quotes rise and POs don't: ${BUDGET_RULES.quoteRise * 100} % more quotes and the same or fewer purchase orders.`)}</li>
            <li>{t(`OC suben y Eságara cae: más valor de órdenes y ${BUDGET_RULES.marginDropPts} puntos menos de Eságara sobre OC.`, `POs rise and Eságara falls: more order value and ${BUDGET_RULES.marginDropPts} points less Eságara on POs.`)}</li>
            <li>{t("Facturación por encima de lo entregable: el presupuesto de facturación de este mes y el siguiente es mayor que las órdenes aceptadas que aún no se facturan.", "Invoicing above what can be delivered: the invoicing budget of this month and the next is larger than the accepted orders not invoiced yet.")}</li>
            <li>{t("Son reglas fijas, sin inteligencia artificial. Muestran el hecho y sus cifras; la causa la averigua la persona.", "They are fixed rules, no artificial intelligence. They show the fact and its figures; the person finds out the cause.")}</li>
          </ul>
        </details>
      </section>
    </>
  );
}
