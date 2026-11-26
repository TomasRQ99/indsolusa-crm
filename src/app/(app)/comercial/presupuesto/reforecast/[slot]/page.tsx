import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { workPeople } from "@/lib/team-store";
import { MONTHS, PROSPECTS, forecastGap, forecastMonths, moneyText, sum } from "@/lib/sales-budget-rules";
import { budgetScope, budgetYears, canWriteBudget, matrixOf, numbers, readYear } from "@/lib/sales-budget";
import { trackYear } from "@/lib/sales-budget-track";
import { saveForecast } from "../actions";
import { BudgetNav, budgetFmt } from "../../ui";
import "../../presupuesto.css";

// Presupuesto comercial · Reforecast of one company and negotiator. The official budget is shown and never edited
// here. For each month still open the negotiator types what they expect on top of what is already real; every save
// is a new cut that keeps who, when and the assumptions (spec §3 "Forecast").

export default async function ReforecastCompany({ params, searchParams }: { params: Promise<{ slot: string }>; searchParams: Promise<{ y?: string; u?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = budgetFmt(i);
  const [{ slot: rawSlot }, sp] = await Promise.all([params, searchParams]);
  const slot = rawSlot === "prospectos" ? PROSPECTS : rawSlot;
  const now = new Date();
  const year = readYear(sp.y, now);
  const { years } = budgetYears(now);
  const scope = await budgetScope(user);
  const everyone = await workPeople();
  const personId = sp.u && (scope.all || scope.ids.has(sp.u)) && everyone.some((p) => p.id === sp.u) ? sp.u : user.id;
  const person = everyone.find((p) => p.id === personId) ?? { id: user.id, name: user.name };
  const tr = await trackYear(year, now, { all: false, ids: new Set([personId]), only: personId, viewerId: user.id }, f.m);
  const line = tr.lines.find((l) => l.b.slot === slot);
  if (!line) notFound();
  const { prog, started } = tr;
  const over = prog.share.every((s) => s >= 1);
  const write = canWriteBudget(user, personId) && started && !over;
  const cuts = await db.salesForecast.findMany({ where: { year, slot, userId: personId }, orderBy: { cutAt: "desc" }, take: 12, include: { lines: true } });
  const last = cuts[0] ?? null;
  const typed = (kpi: string) => Array.from({ length: 12 }, (_, m) => { const x = last?.lines.find((z) => z.kpi === kpi && z.month === m + 1); return x ? Number(x.value) : null; });
  const ocT = typed("OC_PROB"), faT = typed("FACT_PROG");
  const oc = forecastMonths(line.realOc, ocT, prog), fa = forecastMonths(line.realFact, faT, prog);
  const m = matrixOf(line.b);
  const goalOc = numbers(m.OC_COP), goalFa = numbers(m.FACT_COP), goalEnt = numbers(m.ENT_N);
  const estOc = sum(oc.map((x) => x.estimate)), estFa = sum(fa.map((x) => x.estimate));
  const gOc = forecastGap(estOc, sum(goalOc)), gFa = forecastGap(estFa, sum(goalFa));
  const title = slot === PROSPECTS ? t("Reactivaciones y prospectos", "Reactivations and prospects") : line.b.account?.name ?? "—";
  // What there is to lean on: quotes presented and not decided, and accepted orders not invoiced yet.
  const mine = (x: { accountId: string; ownerId: string }) => x.ownerId === personId && (slot === PROSPECTS ? false : x.accountId === slot);
  const openQ = tr.set.cohorts.filter((c) => mine(c) && c.quotedAt && !c.decided);
  const backlog = tr.set.backlog.filter(mine).reduce((s, x) => s + x.usd, 0);
  const entReal = sum(line.realEnt.map((v, k) => (prog.share[k] > 0 ? v : 0)));
  const M = MONTHS.map((x) => t(x.es, x.en));
  const okMsg: Record<string, string> = { guardado: t("Reforecast guardado como un corte nuevo. El presupuesto oficial no cambió.", "Reforecast saved as a new cut. The official budget did not change.") };
  const errMsg: Record<string, string> = {
    permiso: t("El reforecast lo escribe su negociador, Gerencia o la Dirección Comercial.", "The reforecast is written by its negotiator, Management or the Commercial Director."),
    anio: t("Ese año no está en curso: el reforecast solo se hace durante el año.", "That year is not in course: a reforecast is only made during the year."),
    presupuesto: t("Esa empresa no tiene presupuesto este año.", "That company has no budget this year."),
    valor: t("Falta corregir una cifra en «OC probables» o «Facturas programadas»: son números en dólares, de cero en adelante.", "A figure in «Probable POs» or «Scheduled invoices» needs fixing: numbers in dollars, from zero up."),
    supuestos: t("Faltan los «Supuestos de este reforecast»: escribe en qué te basas (qué órdenes esperas, de quién y para cuándo).", "The «Assumptions of this reforecast» are missing: write what you base it on (which orders you expect, from whom and by when)."),
  };
  const diff = (g: { diff: number; pct: number | null }) => <b className={g.diff < 0 ? "pc-down" : g.diff > 0 ? "pc-up" : ""}>{g.diff > 0 ? "+" : ""}{f.bare(g.diff)}{g.pct != null ? ` (${f.signed(g.pct)})` : ""}</b>;
  const inputRow = (prefix: string, label: string, ms: typeof oc, vals: (number | null)[]) => (
    <tr data-k={prefix}><th scope="row">{label}</th>{ms.map((x, k) => <td key={k}>{x.open ? (write ? <input className="pc-in" name={`${prefix}_${k + 1}`} inputMode="decimal" defaultValue={vals[k] ? moneyText(vals[k], i.es) : ""} aria-label={`${label} · ${M[k]}`} /> : f.bare(x.typed)) : <span className="muted">—</span>}</td>)}<td className="pc-year">{f.bare(sum(ms.map((x) => x.typed)))}</td></tr>
  );

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href={`/comercial/presupuesto/reforecast?y=${year}${personId !== user.id ? `&u=${personId}` : ""}`}>{t(`Reforecast ${year}`, `Reforecast ${year}`)}</Link></div>
        <h1>{title}</h1>
        <p>{t(`Reforecast ${year} · Negociador: ${person.name}`, `Reforecast ${year} · Negotiator: ${person.name}`)} · <Link href={`/comercial/presupuesto/${rawSlot}?y=${year}&u=${personId}`}>{t("Ver el presupuesto oficial", "See the official budget")}</Link></p>
      </div></div>
      <BudgetNav i={i} active="reforecast" year={year} years={years} personId={personId !== user.id ? personId : null} />
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {!started && <div className="note">{t(`El año ${year} todavía no empieza: el reforecast se abre en enero.`, `The year ${year} has not started yet: the reforecast opens in January.`)}</div>}

      <div className="pc-tiles">
        <article data-t="oc"><b>{t("Reforecast OC", "PO reforecast")}</b><span>{started ? f.m(estOc) : "—"}</span><small>{t(`Presupuesto oficial: ${f.m(sum(goalOc))}`, `Official budget: ${f.m(sum(goalOc))}`)}{started ? <> · {diff(gOc)}</> : null}</small></article>
        <article data-t="fact"><b>{t("Reforecast facturación", "Invoicing reforecast")}</b><span>{started ? f.m(estFa) : "—"}</span><small>{t(`Presupuesto oficial: ${f.m(sum(goalFa))}`, `Official budget: ${f.m(sum(goalFa))}`)}{started ? <> · {diff(gFa)}</> : null}</small></article>
        <article data-t="apoyo"><b>{t("En qué apoyarte", "What to lean on")}</b><span>{f.m(sum(openQ.map((c) => c.cotUsd ?? 0)))}</span><small>{t(`en ${openQ.length} cotizaciones presentadas sin decisión · OC aceptadas sin facturar: ${f.m(backlog)}`, `in ${openQ.length} quotes presented and not decided · accepted POs not invoiced: ${f.m(backlog)}`)}</small></article>
        <article data-t="ent"><b>{t("Entregas confirmadas", "Deliveries confirmed")}</b><span>{started ? i.n(entReal) : "—"}</span><small>{sum(goalEnt) > 0 ? t(`de ${i.n(sum(goalEnt))} presupuestadas en el año`, `of ${i.n(sum(goalEnt))} budgeted for the year`) : t("Sin entregas presupuestadas", "No deliveries budgeted")}</small></article>
      </div>

      <section className="card" id="reforecast">
        <b>{t(`REFORECAST ${year} · ENERO A DICIEMBRE`, `REFORECAST ${year} · JANUARY TO DECEMBER`)}</b>
        <form action={saveForecast.bind(null, year, slot, personId)} className="pc-form">
          <div className="pc-scroll">
            <table className="pc-table pc-matrix" id="tabla-reforecast-mes">
              <thead><tr><th>{t("Indicador (US$)", "Indicator (US$)")}</th>{M.map((x) => <th key={x}>{x}</th>)}<th className="pc-year">{t(`Año ${year}`, `Year ${year}`)}</th></tr></thead>
              <tbody>
                <tr className="pc-g"><td colSpan={14}>{t("Órdenes de compra", "Purchase orders")}</td></tr>
                <tr className="pc-sug" data-k="goal_oc"><th scope="row">{t("Presupuesto oficial", "Official budget")}</th>{goalOc.map((v, k) => <td key={k}>{f.bare(v)}</td>)}<td className="pc-year">{f.bare(sum(goalOc))}</td></tr>
                <tr data-k="real_oc"><th scope="row">{t("OC reales (aceptadas)", "Real POs (accepted)")}</th>{oc.map((x, k) => <td key={k}>{prog.share[k] > 0 ? f.bare(x.real) : <span className="muted">—</span>}</td>)}<td className="pc-year">{f.bare(sum(oc.map((x) => x.real)))}</td></tr>
                {inputRow("oc", t("OC probables (lo que agregas)", "Probable POs (what you add)"), oc, ocT)}
                <tr className="pc-total" data-k="est_oc"><th scope="row">{t("Reforecast OC", "PO reforecast")}</th>{oc.map((x, k) => <td key={k}>{f.bare(x.estimate)}</td>)}<td className="pc-year" data-total="est_oc">{f.bare(estOc)}</td></tr>
                <tr className="pc-g"><td colSpan={14}>{t("Facturación (plan aparte)", "Invoicing (a separate plan)")}</td></tr>
                <tr className="pc-sug" data-k="goal_fact"><th scope="row">{t("Presupuesto oficial", "Official budget")}</th>{goalFa.map((v, k) => <td key={k}>{f.bare(v)}</td>)}<td className="pc-year">{f.bare(sum(goalFa))}</td></tr>
                <tr data-k="real_fact"><th scope="row">{t("Facturación real", "Real invoicing")}</th>{fa.map((x, k) => <td key={k}>{prog.share[k] > 0 ? f.bare(x.real) : <span className="muted">—</span>}</td>)}<td className="pc-year">{f.bare(sum(fa.map((x) => x.real)))}</td></tr>
                {inputRow("fact", t("Facturas programadas (lo que agregas)", "Scheduled invoices (what you add)"), fa, faT)}
                <tr className="pc-total" data-k="est_fact"><th scope="row">{t("Reforecast facturación", "Invoicing reforecast")}</th>{fa.map((x, k) => <td key={k}>{f.bare(x.estimate)}</td>)}<td className="pc-year" data-total="est_fact">{f.bare(estFa)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="src">{t("Solo se escriben los meses que no han cerrado: el mes en curso y los que faltan. En el mes en curso, escribe lo que esperas además de lo que ya es real. Un mes cerrado vale lo que fue. Las cifras de «Reforecast» se actualizan al guardar.", "Only the months that have not closed are typed: the one in course and the ones left. For the month in course, type what you expect on top of what is already real. A closed month is worth what it was. The «Reforecast» figures update on saving.")}</p>
          {write && (
            <>
              <div className="pc-text"><label id="supuestos">{t("Supuestos de este reforecast (obligatorio)", "Assumptions of this reforecast (required)")} *<textarea name="note" rows={3} maxLength={2000} defaultValue={last?.note ?? ""} placeholder={t("Qué órdenes esperas, de quién y para cuándo; qué entregas ya están programadas para facturar.", "Which orders you expect, from whom and by when; which deliveries are already scheduled to be invoiced.")} /></label></div>
              <div className="pc-actions"><button type="submit">{t("Guardar reforecast", "Save reforecast")}</button><span className="src">{t("Queda como un corte nuevo, con tu nombre y la fecha. No cambia el presupuesto oficial ni su aprobación.", "It is kept as a new cut, with your name and the date. It changes neither the official budget nor its approval.")}</span></div>
            </>
          )}
        </form>
      </section>

      <section className="card" id="cortes">
        <b>{t("CORTES ANTERIORES", "EARLIER CUTS")}</b>
        {cuts.length === 0 ? <p className="small muted">{t("Todavía no hay reforecast de esta empresa.", "There is no reforecast of this company yet.")}</p> : (
          <div className="pc-scroll">
            <table className="pc-table pc-cards" id="tabla-cortes">
              <thead><tr><th>{t("Corte", "Cut")}</th><th>{t("Reforecast OC ese día", "PO reforecast that day")}</th><th>{t("Reforecast facturación ese día", "Invoicing reforecast that day")}</th><th className="l">{t("Supuestos", "Assumptions")}</th></tr></thead>
              <tbody>{cuts.map((c, n) => <tr key={c.id}><th scope="row">{i.date(c.cutAt)} · {c.createdByName}{n === 0 ? t(" · vigente", " · current") : ""}</th><td data-l={t("Reforecast OC ese día", "PO reforecast that day")}>{f.m(Number(c.estOc))}</td><td data-l={t("Reforecast facturación ese día", "Invoicing reforecast that day")}>{f.m(Number(c.estFact))}</td><td className="l" style={{ whiteSpace: "normal" }}>«{c.note}»</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="src">{t("Los últimos 12 cortes. Cada uno guarda la cifra que daba ese día; el vigente se recalcula con lo real de hoy.", "The last 12 cuts. Each keeps the figure it gave that day; the current one recalculates with today's real figures.")}</p>
      </section>
    </>
  );
}
