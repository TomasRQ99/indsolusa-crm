import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { monthOf } from "@/lib/customer-stats";
import { workPeople } from "@/lib/team-store";
import { findCompanies } from "@/lib/batting";
import { PROSPECTS, growthOf, marginOf, shownState, sum, STATE_TXT, type ShownState } from "@/lib/sales-budget-rules";
import { basisFor, basisPick, budgetScope, budgetYears, budgetsOf, canWriteBudget, companiesOf, groupVersions, lastMonths, loadFacts, matrixOf, readYear, totals, yearRow } from "@/lib/sales-budget";
import { BudgetNav, StateChip, budgetFmt } from "./ui";
import "./presupuesto.css";

// Presupuesto comercial · P01 Mis empresas (spec §5): each company of the negotiator with its history, the projected
// close of the year before, trend, potential and the state of its budget. From here a company is opened to budget it.

const POT: Record<string, { es: string; en: string }> = { ALTO: { es: "Alto", en: "High" }, MEDIO: { es: "Medio", en: "Medium" }, BAJO: { es: "Bajo", en: "Low" } };

export default async function BudgetHome({ searchParams }: { searchParams: Promise<{ y?: string; u?: string; q?: string; st?: string; ord?: string; add?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = budgetFmt(i);
  const sp = await searchParams;
  const now = new Date();
  const year = readYear(sp.y, now), base = year - 1;
  const { years } = budgetYears(now);
  const scope = await budgetScope(user);
  const everyone = await workPeople();
  const people = scope.all ? everyone : everyone.filter((p) => scope.ids.has(p.id));
  const personId = sp.u && people.some((p) => p.id === sp.u) ? sp.u : user.id;
  const person = everyone.find((p) => p.id === personId) ?? { id: user.id, name: user.name };
  const own = personId === user.id;
  const write = canWriteBudget(user, personId);

  const [companies, mine, yr] = await Promise.all([companiesOf(personId, year), budgetsOf(year, [personId]), yearRow(year)]);
  const ids = companies.map((c) => c.id);
  const [set, allBudgets] = await Promise.all([
    loadFacts({ ownerIds: [personId], accountIds: ids }),
    db.salesBudget.findMany({ where: { year, slot: { in: ids } }, distinct: ["slot", "userId"], orderBy: { createdAt: "asc" }, select: { slot: true, userId: true } }),
  ]);
  const groups = groupVersions(mine);
  const published = !!yr?.publishedAt;
  const current = monthOf(now);
  const six = lastMonths(current, 6);
  /** The base year is over: a company without orders in it had no sales that year, which is not "too little history". */
  const baseOver = `${base}-12` < current;
  /** The budget's own year has begun: its real purchase orders so far can be shown beside the base year. */
  const started = `${year}-01` <= current;

  const rows = companies.map((c) => {
    const others = allBudgets.filter((b) => b.slot === c.id).map((b) => b.userId);
    const pick = basisPick(c.id, personId, c.ownerId, others);
    const tt = totals(set, pick);
    const b = basisFor(set, year, now, pick, null);
    const oc = tt.year("OC_COP", base), esa = tt.year("ESA_COP", base);
    const prev = sum(six.slice(0, 3).map((m) => tt.of("OC_COP", m))), last = sum(six.slice(3).map((m) => tt.of("OC_COP", m)));
    const trend: "up" | "down" | "flat" | null = prev === 0 && last === 0 ? null : last > prev * 1.05 ? "up" : last < prev * 0.95 ? "down" : "flat";
    const g = groups.get(`${c.id}|${personId}`) ?? null;
    const m = matrixOf(g?.latest ?? null);
    const state = shownState(g?.latest ?? null, published);
    return { ...c, soFar: sum(oc), real: sum(tt.year("OC_COP", year)), close: b.ocClose, margin: sum(esa) > 0 ? marginOf(sum(esa), sum(oc)) : null, trend, potential: g?.latest.potential ?? null, goalOc: g ? sum(m.OC_COP) : null, goalFact: g ? sum(m.FACT_COP) : null, goalEsa: g ? sum(m.ESA_COP) : null, state, version: g?.latest.version ?? null };
  });

  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 60);
  const st = sp.st && sp.st in STATE_TXT ? (sp.st as ShownState) : null;
  const ord = ["nombre", "oc", "meta", "estado"].includes(sp.ord ?? "") ? sp.ord! : "oc";
  const shown = rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!st || r.state === st)).sort((a, b) =>
    ord === "nombre" ? a.name.localeCompare(b.name, "es") : ord === "meta" ? (b.goalOc ?? -1) - (a.goalOc ?? -1) : ord === "estado" ? a.state.localeCompare(b.state) || a.name.localeCompare(b.name, "es") : b.soFar - a.soFar || a.name.localeCompare(b.name, "es"));

  const pros = groups.get(`${PROSPECTS}|${personId}`) ?? null;
  const prosM = matrixOf(pros?.latest ?? null);
  const withBudget = rows.filter((r) => r.state !== "NONE");
  const goalOc = sum(withBudget.map((r) => r.goalOc)) + (pros ? sum(prosM.OC_COP) : 0);
  const goalFact = sum(withBudget.map((r) => r.goalFact)) + (pros ? sum(prosM.FACT_COP) : 0);
  const goalEsa = sum(withBudget.map((r) => r.goalEsa)) + (pros ? sum(prosM.ESA_COP) : 0);
  const closeAll = rows.every((r) => r.close == null) ? null : sum(rows.map((r) => r.close));
  const count = (s: ShownState) => rows.filter((r) => r.state === s).length;

  const add = (sp.add ?? "").trim().slice(0, 80);
  const found = add ? (await findCompanies(add)).filter((a) => !ids.includes(a.id)) : null;
  const link = (slot: string) => `/comercial/presupuesto/${slot}?y=${year}&u=${personId}`;
  const arrow = { up: "↑", down: "↓", flat: "→" } as const;
  const H = {
    sector: t("Sector", "Sector"), so: t(`OC ${base}`, `POs ${base}`), close: t(`Cierre ${base} proyectado`, `Projected ${base} close`), esa: t(`Eságara ${base}`, `Eságara ${base}`), trend: t("Tendencia", "Trend"), pot: t("Potencial", "Potential"), real: t(`OC ${year} real`, `Real POs ${year}`),
    goc: t(`Meta OC ${year}`, `PO goal ${year}`), gfa: t(`Meta facturación ${year}`, `Invoicing goal ${year}`), st: t("Estado", "State"),
  };

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
        <h1>{own ? t(`Presupuesto comercial ${year}`, `Commercial budget ${year}`) : t(`Presupuesto comercial ${year} de ${person.name}`, `${person.name}'s commercial budget ${year}`)}</h1>
        <p>{t(`Empresa por empresa: SOLU propone las metas del año con el historial, tú las ajustas y las explicas, y tu líder las aprueba. Las órdenes de compra y la facturación son dos presupuestos separados. Cifras en dólares (US$), sin IVA. El presupuesto de ${year} se arma con lo vendido en ${base}; para planear con lo vendido en ${year}, elige el año ${year + 1}.`,`Company by company: SOLU proposes the year's goals from the history, you adjust and explain them, and your leader approves them. Purchase orders and invoicing are two separate budgets. Figures in dollars (US$), before VAT. The ${year} budget is built on what was sold in ${base}; to plan with what was sold in ${year}, choose year ${year + 1}.`)}</p>
      </div></div>

      <BudgetNav i={i} active="empresas" year={year} years={years} personId={own ? null : personId} />

      <div className="pc-tiles">
        <article><b>{t("Empresas", "Companies")}</b><span>{rows.length}</span><small>{t(`${withBudget.length} con presupuesto · ${count("NONE")} sin iniciar`, `${withBudget.length} with a budget · ${count("NONE")} not started`)}</small></article>
        <article><b>{t("Por estado", "By state")}</b><span>{count("APPROVED") + count("INFORCE")}</span><small>{t(`aprobadas · ${count("SUBMITTED")} enviadas · ${count("RETURNED")} devueltas · ${count("DRAFT")} en borrador`, `approved · ${count("SUBMITTED")} submitted · ${count("RETURNED")} returned · ${count("DRAFT")} in draft`)}</small></article>
        <article><b>{H.goc}</b><span>{f.m(goalOc)}</span><small>{goalOc <= 0 ? t("Aún no hay metas guardadas", "No goals saved yet") : closeAll != null ? t(`${f.signed(growthOf(goalOc, closeAll))} frente al cierre ${base} proyectado (${f.m(closeAll)})`, `${f.signed(growthOf(goalOc, closeAll))} against the projected ${base} close (${f.m(closeAll)})`) : t(`Sin base suficiente para proyectar el cierre ${base}`, `Not enough basis to project the ${base} close`)}</small></article>
        <article><b>{H.gfa}</b><span>{f.m(goalFact)}</span><small>{t("Plan aparte: no se copia de las OC", "A separate plan: not copied from the POs")}</small></article>
        <article><b>{t(`Eságara objetivo ${year}`, `Eságara objective ${year}`)}</b><span>{f.m(goalEsa)}</span><small>{t(`Margen de la cartera: ${f.pct(marginOf(goalEsa, goalOc))}`, `Portfolio margin: ${f.pct(marginOf(goalEsa, goalOc))}`)}</small></article>
      </div>

      <div className="pc-bar">
        <form method="get" id="filtros">
          <input type="hidden" name="y" value={year} />
          {!own && <input type="hidden" name="u" value={personId} />}
          <label>{t("Buscar en la lista", "Search the list")}<input type="search" name="q" defaultValue={q} placeholder={t("Nombre de la empresa", "Company name")} /></label>
          <label>{t("Estado", "State")}
            <select name="st" defaultValue={st ?? ""}>
              <option value="">{t("Todos", "All")}</option>
              {(["NONE", "DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "INFORCE"] as ShownState[]).map((s) => <option key={s} value={s}>{t(STATE_TXT[s].es, STATE_TXT[s].en)}</option>)}
            </select>
          </label>
          <label>{t("Ordenar por", "Order by")}
            <select name="ord" defaultValue={ord}>
              <option value="oc">{t(`OC ${base}, de mayor a menor`, `POs ${base}, largest first`)}</option>
              <option value="meta">{t(`Meta OC ${year}, de mayor a menor`, `PO goal ${year}, largest first`)}</option>
              <option value="nombre">{t("Nombre", "Name")}</option>
              <option value="estado">{t("Estado", "State")}</option>
            </select>
          </label>
          <button type="submit" className="secondary">{t("Filtrar", "Filter")}</button>
        </form>
        <span className="grow" />
        {people.length > 1 && (
          <form method="get">
            <input type="hidden" name="y" value={year} />
            <label>{t("Negociador", "Negotiator")}<select name="u" defaultValue={personId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button type="submit" className="secondary">{t("Ver", "View")}</button>
          </form>
        )}
      </div>

      <section className="card" id="empresas">
        <b>{t(`EMPRESAS DE ${person.name.toUpperCase()}`, `${person.name.toUpperCase()}'S COMPANIES`)}</b>
        {rows.length === 0 ? <p className="small muted">{t("Esta persona aún no tiene empresas a su nombre ni Necesidades. Con «Agregar otra empresa», abajo, se puede presupuestar cualquier cliente.", "This person has no companies or Needs yet. With «Add another company», below, any customer can be budgeted.")}</p> : (
          <div className="pc-scroll">
            <table className="pc-table pc-cards">
              <thead><tr><th>{t("Empresa", "Company")}</th><th className="l">{H.sector}</th><th>{H.so}</th><th>{H.close}</th><th>{H.esa}</th><th>{H.trend}</th><th>{H.pot}</th><th>{H.real}</th><th>{H.goc}</th><th>{H.gfa}</th><th>{H.st}</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} data-a={r.id}>
                    <th scope="row"><Link href={link(r.id)}>{r.name}</Link></th>
                    <td className="l" data-l={H.sector}>{r.industry ?? "—"}</td>
                    <td data-l={H.so}>{f.m(r.soFar)}</td>
                    <td data-l={H.close}>{r.close != null ? f.m(r.close) : <span className="muted">{baseOver && r.soFar <= 0 ? t(`sin ventas en ${base}`, `no sales in ${base}`) : t("sin base suficiente", "not enough basis")}</span>}</td>
                    <td data-l={H.esa}>{f.pct(r.margin)}</td>
                    <td data-l={H.trend}>{r.trend ? <span className={`pc-${r.trend}`} title={r.trend === "up" ? t("Los últimos 3 meses completos superan a los 3 anteriores", "The last 3 complete months beat the 3 before") : r.trend === "down" ? t("Los últimos 3 meses completos están por debajo de los 3 anteriores", "The last 3 complete months are below the 3 before") : t("Los últimos 3 meses completos están parejos con los 3 anteriores", "The last 3 complete months are level with the 3 before")}>{arrow[r.trend]}</span> : "—"}</td>
                    <td data-l={H.pot}>{r.potential && POT[r.potential] ? t(POT[r.potential].es, POT[r.potential].en) : "—"}</td>
                    <td data-l={H.real} data-c="real">{started ? f.m(r.real) : "—"}</td>
                    <td data-l={H.goc}>{r.goalOc != null ? f.m(r.goalOc) : "—"}</td>
                    <td data-l={H.gfa}>{r.goalFact != null ? f.m(r.goalFact) : "—"}</td>
                    <td data-l={H.st}><StateChip i={i} state={r.state} />{r.version && r.version > 1 ? <span className="src"> v{r.version}</span> : null}</td>
                    <td><Link className={`btn${r.state === "NONE" && write ? "" : " secondary"}`} href={link(r.id)}>{r.state === "NONE" && write ? t("Presupuestar", "Budget") : t("Abrir", "Open")}</Link></td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={12} className="l muted">{t("Ninguna empresa coincide con el filtro.", "No company matches the filter.")}</td></tr>}
                <tr data-a={PROSPECTS} className="pc-sub">
                  <th scope="row"><Link href={link("prospectos")}>{t("Reactivaciones y prospectos", "Reactivations and prospects")}</Link><span className="src block">{t("Lo que esperas vender a empresas que aún no tienen presupuesto propio. No tiene historial: no es una empresa.", "What you expect to sell to companies without a budget of their own yet. It has no history: it is not a company.")}</span></th>
                  <td className="l" data-l={H.sector}>—</td><td data-l={H.so}>—</td><td data-l={H.close}>—</td><td data-l={H.esa}>—</td><td data-l={H.trend}>—</td><td data-l={H.pot}>—</td><td data-l={H.real}>—</td>
                  <td data-l={H.goc}>{pros ? f.m(sum(prosM.OC_COP)) : "—"}</td>
                  <td data-l={H.gfa}>{pros ? f.m(sum(prosM.FACT_COP)) : "—"}</td>
                  <td data-l={H.st}><StateChip i={i} state={shownState(pros?.latest ?? null, published)} /></td>
                  <td><Link className="btn secondary" href={link("prospectos")}>{pros ? t("Abrir", "Open") : write ? t("Presupuestar", "Budget") : t("Abrir", "Open")}</Link></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="src">{t(`«OC ${base}» = órdenes de compra aceptadas en ${base} hasta hoy. «Cierre ${base} proyectado» = esos meses más los que faltan al promedio de los meses con historial (el mes en curso cuenta por lo que ya lleva, si es más que el promedio); con menos de 3 meses de historial SOLU dice «sin base suficiente», y «sin ventas en ${base}» cuando ese año ya terminó sin órdenes. «Eságara ${base}» sale «—» cuando las ventas cargadas no traen Eságara. «OC ${year} real» = órdenes de compra aceptadas en ${year} hasta hoy (antes de que empiece el año sale «—»). «Tendencia» compara los últimos 3 meses completos con los 3 anteriores. Todo va en dólares: el valor en dólares de cada documento de SOLU y de las ventas cargadas.`, `«POs ${base}» = purchase orders accepted in ${base} up to today. «Projected ${base} close» = those months plus the ones to come at the average of the months with history (the month in course counts for what it already has, when that is more than the average); with fewer than 3 months of history SOLU says «not enough basis», and «no sales in ${base}» when that year ended without orders. «Eságara ${base}» shows «—» when the loaded sales carry no Eságara. «Real POs ${year}» = purchase orders accepted in ${year} up to today («—» before the year starts). «Trend» compares the last 3 complete months with the 3 before. Everything is in dollars: the dollar value of each SOLU document and of the loaded sales.`)}{set.noRate > 0 ? t(` ${set.noRate} cifras cargadas en pesos no tienen TRM guardada para su mes y no entran en los totales.`, ` ${set.noRate} figures loaded in pesos have no stored TRM for their month and are left out of the totals.`) : ""}</p>
      </section>

      {write && (
        <section className="card" id="agregar">
          <b>{t("Agregar otra empresa", "Add another company")}</b>
          <form method="get" action="/comercial/presupuesto#agregar" className="pc-bar" style={{ margin: "8px 0 0" }}>
            <input type="hidden" name="y" value={year} />
            {!own && <input type="hidden" name="u" value={personId} />}
            <label>{t("Nombre de la empresa", "Company name")}<input type="search" name="add" defaultValue={add} required minLength={2} /></label>
            <button type="submit" className="secondary">{t("Buscar empresa", "Search company")}</button>
          </form>
          {found && (found.length === 0 ? <p className="small muted">{t("No hay otra empresa con ese nombre. Si es nueva, primero créala en MERCADO → Clientes.", "No other company with that name. If it is new, create it first in MARKET → Customers.")}</p> : (
            <ul className="mk-ul">{found.map((a) => <li key={a.id}><Link href={link(a.id)}>{a.name}</Link> · <Link href={link(a.id)}>{t("Presupuestar", "Budget")} →</Link></li>)}</ul>
          ))}
        </section>
      )}
    </>
  );
}
