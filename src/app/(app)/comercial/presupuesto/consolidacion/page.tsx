import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canExportReports, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { workPeople } from "@/lib/team-store";
import { db } from "@/lib/db";
import { KPIS, MAIN_KPIS, MONTHS, PROSPECTS, STATE_TXT, marginOf, moneyText, shownState, sum, zeros, type Kpi, type ShownState } from "@/lib/sales-budget-rules";
import { budgetScope, budgetYears, budgetsOf, corporateOf, groupVersions, matrixOf, numbers, readYear, teamOfPeople, yearRow, type BudgetRow } from "@/lib/sales-budget";
import { publishYear, saveCorporate } from "../actions";
import { BudgetNav, StateChip, budgetFmt } from "../ui";
import "../presupuesto.css";

// Presupuesto comercial · P05 Consolidación (spec §5.2): company → team → negotiator → customer, twelve months, the
// three money indicators. Sums only ever go upwards; the company objective is shown beside them as a gap to review
// and assign, never spread silently. Percentages are recalculated from the totals (AT-07).

type Node = { oc: number[]; fact: number[]; esa: number[] };
const blank = (): Node => ({ oc: zeros(), fact: zeros(), esa: zeros() });
const addTo = (a: Node, b: Node) => { for (let m = 0; m < 12; m++) { a.oc[m] += b.oc[m]; a.fact[m] += b.fact[m]; a.esa[m] += b.esa[m]; } };

export default async function BudgetRollup({ searchParams }: { searchParams: Promise<{ y?: string; ver?: string; k?: string; det?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = budgetFmt(i);
  const sp = await searchParams;
  const now = new Date();
  const year = readYear(sp.y, now);
  const { years } = budgetYears(now);
  const official = sp.ver === "oficial";
  const kpi: Kpi = sp.k === "FACT_COP" || sp.k === "ESA_COP" ? sp.k : "OC_COP";
  const detail = sp.det === "1";
  const manage = canManageAll(user);
  const scope = await budgetScope(user);
  const [rows, yr, people, { teams, teamOf }] = await Promise.all([budgetsOf(year, scope.all ? undefined : [...scope.ids]), yearRow(year), workPeople(true), teamOfPeople()]);
  const published = !!yr?.publishedAt;
  const groups = [...groupVersions(rows).values()];
  const picked = groups.map((g) => (official ? g.official : g.latest)).filter((b): b is BudgetRow => !!b);
  const nodeOf = (b: BudgetRow): Node => { const m = matrixOf(b); return { oc: numbers(m.OC_COP), fact: numbers(m.FACT_COP), esa: numbers(m.ESA_COP) }; };

  // The tree. A person belongs to one team here (the first they joined), so nothing is added twice.
  const NO_TEAM = "—";
  const byPerson = new Map<string, BudgetRow[]>();
  for (const b of picked) byPerson.set(b.userId, [...(byPerson.get(b.userId) ?? []), b]);
  const teamIds = [...teams.map((x) => x.id), NO_TEAM].filter((id) => [...byPerson.keys()].some((u) => (teamOf.get(u) ?? NO_TEAM) === id));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
  const tree = teamIds.map((teamId) => {
    const members = [...byPerson.keys()].filter((u) => (teamOf.get(u) ?? NO_TEAM) === teamId).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "es"));
    const node = blank();
    const persons = members.map((u) => {
      const pn = blank();
      const items = byPerson.get(u)!.sort((a, b) => (a.slot === PROSPECTS ? 1 : b.slot === PROSPECTS ? -1 : (a.account?.name ?? "").localeCompare(b.account?.name ?? "", "es"))).map((b) => { const n = nodeOf(b); addTo(pn, n); return { b, n }; });
      addTo(node, pn);
      return { id: u, name: nameOf(u), node: pn, items };
    });
    const team = teams.find((x) => x.id === teamId);
    return { id: teamId, name: team ? team.name : t("Sin equipo", "No team"), leader: team?.leader ?? null, node, persons };
  });
  const total = blank();
  for (const tm of tree) addTo(total, tm.node);

  const corp = corporateOf(yr);
  const sums: Record<string, number> = { OC_COP: sum(total.oc), FACT_COP: sum(total.fact), ESA_COP: sum(total.esa) };
  const states = (bs: BudgetRow[]) => {
    const c = new Map<ShownState, number>();
    for (const b of bs) { const s = shownState(b, published); c.set(s, (c.get(s) ?? 0) + 1); }
    return [...c.entries()].map(([s, n]) => `${n} ${t(STATE_TXT[s].es, STATE_TXT[s].en).toLowerCase()}`).join(" · ");
  };
  // Controls a reviewer needs before trusting the sum.
  const memberships = byPerson.size ? await db.teamMember.groupBy({ by: ["userId"], where: { team: { active: true }, userId: { in: [...byPerson.keys()] } }, _count: { teamId: true } }) : [];
  const multiTeam = memberships.filter((x) => x._count.teamId > 1).map((x) => nameOf(x.userId));
  const shared = new Map<string, string[]>();
  for (const b of picked) if (b.slot !== PROSPECTS) shared.set(b.slot, [...(shared.get(b.slot) ?? []), b.user.name]);
  const sharedCos = [...shared.entries()].filter(([, us]) => us.length > 1).map(([slot, us]) => `${picked.find((b) => b.slot === slot)?.account?.name ?? slot} (${us.join(", ")})`);
  const noBase = picked.filter((b) => { const m = matrixOf(b); return m.OC_COP.some((v, k) => (v ?? 0) > 0 && (m.OC_N[k] == null || m.COT_N[k] == null || m.SOL_N[k] == null || m.ESA_COP[k] == null)); });
  const pending = groups.filter((g) => g.latest.state !== "APPROVED").length;

  const base = `/comercial/presupuesto/consolidacion?y=${year}`;
  const href = (o: { ver?: boolean; k?: Kpi; det?: boolean }) => `${base}${(o.ver ?? official) ? "&ver=oficial" : ""}&k=${o.k ?? kpi}${(o.det ?? detail) ? "&det=1" : ""}`;
  const pick = (n: Node) => (kpi === "OC_COP" ? n.oc : kpi === "FACT_COP" ? n.fact : n.esa);
  const M = MONTHS.map((x) => t(x.es, x.en));
  const H = { oc: t(`OC anual ${year}`, `Annual POs ${year}`), fa: t(`Facturación ${year}`, `Invoicing ${year}`), es: t(`Eságara ${year}`, `Eságara ${year}`), mg: t("Margen", "Margin"), st: t("Estado", "State") };
  const annualCells = (n: Node) => <><td data-l={H.oc}>{f.m(sum(n.oc))}</td><td data-l={H.fa}>{f.m(sum(n.fact))}</td><td data-l={H.es}>{f.m(sum(n.esa))}</td><td data-l={H.mg}>{f.pct(marginOf(sum(n.esa), sum(n.oc)))}</td></>;
  const monthCells = (n: Node) => <>{pick(n).map((v, m) => <td key={m}>{f.bare(v)}</td>)}<td className="pc-year">{f.bare(sum(pick(n)))}</td></>;
  const okMsg: Record<string, string> = { objetivo: t("Objetivo de la empresa guardado.", "Company objective saved."), publicado: t(`Presupuesto ${year} publicado: los presupuestos aprobados quedan «Vigente».`, `Budget ${year} published: the approved budgets are now «In force».`) };
  const errMsg: Record<string, string> = { permiso: t("Solo Gerencia o la Dirección Comercial.", "Only Management or the Commercial Director."), valor: t("El objetivo es un número en dólares, de cero en adelante.", "The objective is a number in dollars, from zero up."), anio: t("Ese año no está abierto.", "That year is not open."), "nada-aprobado": t("Todavía no hay ningún presupuesto aprobado que publicar.", "There is no approved budget to publish yet.") };

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href={`/comercial/presupuesto?y=${year}`}>{t(`Presupuesto comercial ${year}`, `Commercial budget ${year}`)}</Link></div>
        <h1>{t(`Consolidación del presupuesto ${year}`, `Budget consolidation ${year}`)}</h1>
        <p>{t("Las metas por empresa se suman hacia el negociador, el equipo y la compañía. El objetivo de la empresa se muestra al lado: la diferencia es una brecha para revisar y asignar, nunca se reparte sola.", "The goals per company add up to the negotiator, the team and the company. The company objective is shown beside them: the difference is a gap to review and assign, never spread on its own.")}{scope.all ? "" : t(" Ves tu presupuesto y el de las personas que lideras.", " You see your budget and that of the people you lead.")}</p>
      </div></div>
      <BudgetNav i={i} active="consolidacion" year={year} years={years} />
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <div className="pc-bar">
        <span className="pc-tabs" id="version-vista">
          <Link href={href({ ver: false })} className={official ? "" : "on"}>{t("Última propuesta", "Latest proposal")}</Link>
          <Link href={href({ ver: true })} className={official ? "on" : ""}>{t("Solo lo aprobado", "Approved only")}</Link>
        </span>
        <span className="grow" />
        {(manage || canExportReports(user)) && <a className="btn secondary" href={`/comercial/presupuesto/consolidacion/csv?y=${year}${official ? "&ver=oficial" : ""}`}>{t("Exportar a CSV", "Export to CSV")}</a>}
      </div>

      <section className="card" id="objetivo">
        <b>{t("OBJETIVO DE LA EMPRESA Y BRECHA", "COMPANY OBJECTIVE AND GAP")}</b>
        <div className="pc-scroll">
          <table className="pc-table pc-cards" id="brecha">
            <thead><tr><th>{t("Indicador", "Indicator")}</th><th>{t("Objetivo de la empresa", "Company objective")}</th><th>{official ? t("Suma de lo aprobado", "Sum of the approved") : t("Suma de las propuestas", "Sum of the proposals")}</th><th>{t("Brecha por asignar", "Gap to assign")}</th><th>{t("Cubierto", "Covered")}</th></tr></thead>
            <tbody>
              {MAIN_KPIS.map((k) => { const goal = corp[k as "OC_COP"] ?? null, got = sums[k]; return (
                <tr key={k} data-k={k}>
                  <th scope="row">{t(KPIS[k].es, KPIS[k].en)}</th>
                  <td data-l={t("Objetivo de la empresa", "Company objective")}>{goal != null ? f.m(goal) : <span className="muted">{t("sin objetivo", "no objective")}</span>}</td>
                  <td data-l={t("Suma", "Sum")}>{f.m(got)}</td>
                  <td data-l={t("Brecha por asignar", "Gap to assign")}>{goal != null ? (goal > got ? <b className="pc-down">{f.m(goal - got)}</b> : <span className="pc-up">{t("sin brecha", "no gap")}</span>) : "—"}</td>
                  <td data-l={t("Cubierto", "Covered")}>{goal != null ? f.pct((got / goal) * 100) : "—"}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        {yr?.corporateByName && <p className="src">{t(`Objetivo escrito por ${yr.corporateByName} · ${i.day(yr.corporateAt)}.`, `Objective written by ${yr.corporateByName} · ${i.day(yr.corporateAt)}.`)}</p>}
        {manage && (
          <form action={saveCorporate.bind(null, year)} className="pc-bar" style={{ margin: "8px 0 0" }}>
            {MAIN_KPIS.map((k) => <label key={k}>{t(`Objetivo ${KPIS[k].es} · US$`, `Objective ${KPIS[k].en} · US$`)}<input name={k} inputMode="decimal" defaultValue={moneyText(corp[k as "OC_COP"] ?? null, i.es)} /></label>)}
            <button type="submit" className="secondary">{t("Guardar objetivo", "Save objective")}</button>
          </form>
        )}
      </section>

      <section className="card" id="arbol">
        <b>{t("COMPAÑÍA → EQUIPO → NEGOCIADOR → EMPRESA", "COMPANY → TEAM → NEGOTIATOR → CUSTOMER")}</b>
        {picked.length === 0 ? <p className="small muted">{official ? t("Todavía no hay presupuestos aprobados. Mira «Última propuesta».", "No approved budgets yet. See «Latest proposal».") : t("Todavía nadie ha guardado una propuesta para este año. Empieza en «Mis empresas».", "Nobody has saved a proposal for this year yet. Start in «My companies».")}</p> : (
          <div className="pc-scroll">
            <table className="pc-table pc-cards" id="tabla-arbol">
              <thead><tr><th>{t("Nivel", "Level")}</th><th>{H.oc}</th><th>{H.fa}</th><th>{H.es}</th><th>{H.mg}</th><th className="l">{H.st}</th></tr></thead>
              <tbody>
                <tr className="pc-total" data-n="TOTAL"><th scope="row">ImportSoluciones</th>{annualCells(total)}<td className="l" data-l={H.st}>{states(picked)}</td></tr>
                {tree.map((tm) => (
                  [<tr key={tm.id} className="pc-sub pc-l1" data-n={`T-${tm.id}`}><th scope="row">{t("Equipo", "Team")} {tm.name}{tm.leader ? <span className="src"> · {t("líder", "leader")} {tm.leader}</span> : null}</th>{annualCells(tm.node)}<td className="l" data-l={H.st}>{states(tm.persons.flatMap((p) => p.items.map((x) => x.b)))}</td></tr>,
                  ...tm.persons.flatMap((p) => [
                    <tr key={p.id} className="pc-l2" data-n={`P-${p.id}`}><th scope="row"><Link href={`/comercial/presupuesto?y=${year}&u=${p.id}`}>{p.name}</Link></th>{annualCells(p.node)}<td className="l" data-l={H.st}>{states(p.items.map((x) => x.b))}</td></tr>,
                    ...p.items.map(({ b, n }) => <tr key={b.id} className="pc-l3" data-n={`B-${b.slot}`}><th scope="row"><Link href={`/comercial/presupuesto/${b.slot === PROSPECTS ? "prospectos" : b.slot}?y=${year}&u=${b.userId}${official ? `&v=${b.version}` : ""}`}>{b.slot === PROSPECTS ? t("Reactivaciones y prospectos", "Reactivations and prospects") : b.account?.name ?? "—"}</Link></th>{annualCells(n)}<td className="l" data-l={H.st}><StateChip i={i} state={shownState(b, published)} />{b.reconcileNote ? <span className="src"> · {t("conciliación pedida", "reconciliation requested")}</span> : null}</td></tr>),
                  ])]
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {picked.length > 0 && (
        <section className="card" id="meses">
          <b>{t("DOCE MESES", "TWELVE MONTHS")} · {t(KPIS[kpi].es, KPIS[kpi].en)}</b>
          <div className="pc-bar" style={{ margin: "8px 0" }}>
            <span className="pc-tabs">{MAIN_KPIS.map((k) => <Link key={k} href={`${href({ k })}#meses`} className={k === kpi ? "on" : ""}>{t(KPIS[k].es, KPIS[k].en)}</Link>)}</span>
            <span className="grow" />
            <Link className="qa-btn" href={`${href({ det: !detail })}#meses`}>{detail ? t("Ocultar las empresas", "Hide the companies") : t("Ver también las empresas", "Show the companies too")}</Link>
          </div>
          <div className="pc-scroll">
            <table className="pc-table" id="tabla-meses">
              <thead><tr><th>{t("Nivel", "Level")}</th>{M.map((m) => <th key={m}>{m}</th>)}<th className="pc-year">{t("Anual", "Annual")}</th></tr></thead>
              <tbody>
                <tr className="pc-total"><th scope="row">ImportSoluciones</th>{monthCells(total)}</tr>
                {tree.map((tm) => [
                  <tr key={tm.id} className="pc-sub pc-l1"><th scope="row">{t("Equipo", "Team")} {tm.name}</th>{monthCells(tm.node)}</tr>,
                  ...tm.persons.flatMap((p) => [
                    <tr key={p.id} className="pc-l2"><th scope="row">{p.name}</th>{monthCells(p.node)}</tr>,
                    ...(detail ? p.items.map(({ b, n }) => <tr key={b.id} className="pc-l3"><th scope="row">{b.slot === PROSPECTS ? t("Reactivaciones y prospectos", "Reactivations and prospects") : b.account?.name ?? "—"}</th>{monthCells(n)}</tr>) : []),
                  ]),
                ])}
              </tbody>
            </table>
          </div>
          <p className="src">{t("Cifras en dólares (US$), sin IVA. Cada fila es la suma exacta de las filas que tiene debajo.", "Figures in dollars (US$), before VAT. Each row is the exact sum of the rows beneath it.")}</p>
        </section>
      )}

      <section className="card" id="controles">
        <b>{t("CONTROLES ANTES DE CONFIAR EN LA SUMA", "CHECKS BEFORE TRUSTING THE SUM")}</b>
        <ul className="mk-ul small">
          <li>{pending === 0 ? t("Todas las propuestas están aprobadas.", "Every proposal is approved.") : t(`${pending} propuestas todavía no están aprobadas (borrador, enviadas o devueltas).`, `${pending} proposals are not approved yet (draft, submitted or returned).`)} <Link href={`/comercial/presupuesto/aprobaciones?y=${year}`}>{t("Ver aprobaciones", "See approvals")} →</Link></li>
          <li>{noBase.length === 0 ? t("Todas las propuestas tienen sus indicadores de apoyo calculados.", "Every proposal has its supporting indicators worked out.") : t(`${noBase.length} propuestas tienen meses «sin base suficiente» (falta ticket, bateo o Eságara objetivo): ${noBase.slice(0, 6).map((b) => `${b.account?.name ?? t("Prospectos", "Prospects")} (${b.user.name})`).join(", ")}${noBase.length > 6 ? "…" : ""}.`, `${noBase.length} proposals have months with «not enough basis» (ticket, batting or Eságara objective missing): ${noBase.slice(0, 6).map((b) => `${b.account?.name ?? "Prospects"} (${b.user.name})`).join(", ")}${noBase.length > 6 ? "…" : ""}.`)}</li>
          <li>{sharedCos.length === 0 ? t("Ninguna empresa está presupuestada por dos negociadores.", "No company is budgeted by two negotiators.") : t(`Empresas presupuestadas por más de un negociador (cada uno su parte, se suman una sola vez): ${sharedCos.join("; ")}.`, `Companies budgeted by more than one negotiator (each their part, added only once): ${sharedCos.join("; ")}.`)}</li>
          {multiTeam.length > 0 && <li>{t(`Personas en más de un equipo, contadas solo en el primero: ${multiTeam.join(", ")}.`, `People in more than one team, counted only in the first: ${multiTeam.join(", ")}.`)}</li>}
        </ul>
      </section>

      <section className="card" id="publicar">
        <b>{t(`PUBLICAR EL PRESUPUESTO ${year}`, `PUBLISH THE ${year} BUDGET`)}</b>
        {published ? <p className="small">{t(`Publicado por ${yr!.publishedByName} · ${i.date(yr!.publishedAt)}. Los presupuestos aprobados están «Vigente»; los que se aprueben después lo quedan al aprobarse.`, `Published by ${yr!.publishedByName} · ${i.date(yr!.publishedAt)}. The approved budgets are «In force»; those approved later become so on approval.`)}</p> : manage ? (
          <form action={publishYear.bind(null, year)} className="pc-actions"><button type="submit" data-confirm={t(`¿Publicar el presupuesto ${year}? Los presupuestos aprobados pasan a «Vigente».`, `Publish the ${year} budget? The approved budgets become «In force».`)}>{t(`Publicar presupuesto ${year}`, `Publish budget ${year}`)}</button><span className="src">{t("Los presupuestos aprobados pasan a «Vigente». No cambia ninguna cifra.", "The approved budgets become «In force». No figure changes.")}</span></form>
        ) : <p className="small muted">{t("Aún no se publica. Lo hacen Gerencia o la Dirección Comercial cuando las propuestas estén aprobadas.", "Not published yet. Management or the Commercial Director do it once the proposals are approved.")}</p>}
      </section>
    </>
  );
}
