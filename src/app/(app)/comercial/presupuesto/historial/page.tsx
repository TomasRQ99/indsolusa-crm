import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { KPIS, MONTHS, type Kpi } from "@/lib/sales-budget-rules";
import { budgetScope, loadFacts, readYear } from "@/lib/sales-budget";
import { canLoadHistory, checkBatch, countedRows, firstNeedMonths, loadedRows } from "@/lib/sales-history";
import { COLUMNS, PROBLEM_TXT, SOURCE_TXT, UNITS, UNIT_TXT, VALUE_COLUMNS, type HistorySource } from "@/lib/sales-history-rules";
import { applyHistory, checkHistory, removeHistory } from "./actions";
import { BudgetNav, budgetFmt } from "../ui";
import "../presupuesto.css";

// Presupuesto comercial · Historial: the commercial history from before SOLU (and Siigo's invoicing), pasted from
// Excel, checked on screen and then saved. Loaded figures count as real only in the months before the company's
// first Need in SOLU. Below, SOLU's invoicing is compared with Siigo's month by month (spec AT-11).

const MAX_PROBLEMS = 60;
const SAME = 1000; // pesos: a difference below this is rounding, not a discrepancy

export default async function BudgetHistory({ searchParams }: { searchParams: Promise<{ y?: string; b?: string; e?: string; cy?: string; ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = budgetFmt(i);
  const sp = await searchParams;
  const now = new Date();
  const year = readYear(sp.y, now);
  const load = canLoadHistory(user);
  const scope = await budgetScope(user);
  const colName = (k: string) => { const c = COLUMNS.find((x) => x.col === k)!; return t(c.es, c.en); };
  const monthName = (key: string) => `${t(MONTHS[Number(key.slice(5)) - 1].es, MONTHS[Number(key.slice(5)) - 1].en)} ${key.slice(0, 4)}`;
  const cell = (k: Kpi, v: number | undefined) => (v == null ? "—" : KPIS[k].unit === "cop" ? i.money(v, "COP") : i.n(v));

  const [batch, batches, company] = await Promise.all([
    load && sp.b ? db.salesHistoryBatch.findUnique({ where: { id: sp.b } }) : null,
    db.salesHistoryBatch.findMany({ where: { state: "APPLIED" }, orderBy: { appliedAt: "desc" }, select: { id: true, source: true, label: true, currency: true, createdByName: true, appliedAt: true, _count: { select: { rows: true } } } }),
    sp.e ? db.account.findFirst({ where: { id: sp.e, internal: false }, select: { id: true, name: true } }) : null,
  ]);
  const review = batch && batch.state === "CHECKED" ? await checkBatch(batch) : null;
  const names = review ? new Map((await db.account.findMany({ where: { id: { in: review.shadowedCompanies.map((c) => c.accountId) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name])) : new Map<string, string>();
  const spans = batches.length ? await db.salesHistoryMonth.groupBy({ by: ["batchId"], where: { batchId: { in: batches.map((b) => b.id) } }, _min: { month: true }, _max: { month: true } }) : [];
  const spanOf = new Map(spans.map((s) => [s.batchId, s]));
  const companiesOf = batches.length ? await db.salesHistoryMonth.findMany({ where: { batchId: { in: batches.map((b) => b.id) } }, distinct: ["batchId", "accountId"], select: { batchId: true } }) : [];
  const nCompanies = (id: string) => companiesOf.filter((c) => c.batchId === id).length;

  // One company's loaded figures: month by month, and whether each month counts as real.
  const compRows = company ? await loadedRows({ accountIds: [company.id] }) : [];
  const compCut = company ? (await firstNeedMonths([company.id])).get(company.id) ?? null : null;
  const compCounted = new Set(countedRows(compRows, new Map(compCut ? [[company!.id, compCut]] : [])).map((r) => r.id));
  const compKeys = [...new Set(compRows.map((r) => `${r.month}|${r.source}|${r.ownerId}`))].sort().reverse();
  const owners = compRows.length ? new Map((await db.user.findMany({ where: { id: { in: [...new Set(compRows.map((r) => r.ownerId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();

  // SOLU's invoicing beside Siigo's, for the months of the chosen year that have Siigo figures loaded.
  const canCompare = load || scope.all;
  const siigoAll = canCompare ? await db.salesHistoryMonth.findMany({ where: { source: "SIIGO", kpi: "FACT_COP", batch: { state: "APPLIED" }, account: { internal: false } }, select: { accountId: true, month: true, value: true, account: { select: { name: true } } } }) : [];
  const siigoYears = [...new Set(siigoAll.map((r) => r.month.slice(0, 4)))].sort();
  const cy = sp.cy && siigoYears.includes(sp.cy) ? sp.cy : siigoYears[siigoYears.length - 1] ?? null;
  const siigo = siigoAll.filter((r) => cy && r.month.startsWith(cy));
  const compare: { month: string; solu: number; siigo: number; rows: { name: string; solu: number; siigo: number }[] }[] = [];
  let noRate = 0;
  if (cy && siigo.length) {
    const set = await loadFacts({});
    const solu = set.facts.filter((x) => x.kpi === "FACT_COP" && !x.loaded && x.month.startsWith(cy));
    noRate = solu.filter((x) => x.cop == null).length;
    const accNames = new Map((await db.account.findMany({ where: { id: { in: [...new Set(solu.map((x) => x.accountId))] } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
    for (const month of [...new Set(siigo.map((r) => r.month))].sort()) {
      const by = new Map<string, { name: string; solu: number; siigo: number }>();
      for (const r of siigo) if (r.month === month) { const x = by.get(r.accountId) ?? { name: r.account.name, solu: 0, siigo: 0 }; x.siigo += Number(r.value); by.set(r.accountId, x); }
      for (const x of solu) if (x.month === month && x.cop != null) { const y = by.get(x.accountId) ?? { name: accNames.get(x.accountId) ?? "—", solu: 0, siigo: 0 }; y.solu += x.cop; by.set(x.accountId, y); }
      const rows = [...by.values()].filter((r) => Math.abs(r.solu - r.siigo) >= SAME).sort((a, b) => Math.abs(b.solu - b.siigo) - Math.abs(a.solu - a.siigo));
      compare.push({ month, solu: [...by.values()].reduce((s, r) => s + r.solu, 0), siigo: [...by.values()].reduce((s, r) => s + r.siigo, 0), rows });
    }
  }

  const okMsg: Record<string, string> = {
    guardado: t("Historial guardado. Ya entra en el historial y en la sugerencia de cada empresa.", "History saved. It now feeds each company's history and suggestion."),
    quitado: t("Carga quitada: sus cifras ya no cuentan.", "Load removed: its figures no longer count."), descartado: t("Revisión descartada: no se guardó nada.", "Review discarded: nothing was saved."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("El historial lo cargan Gerencia, la Dirección Comercial, Finanzas o Administración.", "History is loaded by Management, the Commercial Director, Finance or Administration."),
    vacio: t("Faltan las filas: pega las celdas copiadas de Excel en «Filas copiadas de Excel», o elige un archivo de Excel o CSV.", "The rows are missing: paste the cells copied from Excel into «Rows copied from Excel», or choose an Excel or CSV file."),
    nombre: t("Falta «Nombre de esta carga»: escribe de dónde salen las cifras (por ejemplo «Ventas 2024–2026 del sistema anterior»).", "«Name of this load» is missing: write where the figures come from (for example «Sales 2024–2026 from the earlier system»)."),
    excel: t("No se pudo leer ese archivo. SOLU lee Excel .xlsx y CSV; si es un .xls antiguo, ábrelo y guárdalo como .xlsx, o copia las celdas y pégalas en «Filas copiadas de Excel».", "That file could not be read. SOLU reads Excel .xlsx and CSV; if it is an old .xls, open it and save it as .xlsx, or copy the cells and paste them into «Rows copied from Excel»."),
    grande: t("Son demasiadas filas para una sola carga (máximo 5 MB). Divídela por años.", "Too many rows for one load (5 MB at most). Split it by year."),
    estado: t("Esa carga ya se guardó o se descartó.", "That load was already saved or discarded."),
    nada: t("Ninguna fila se pudo leer: no hay nada que guardar. Corrige lo que se indica abajo y vuelve a cargar.", "No row could be read: there is nothing to save. Fix what is listed below and load again."),
  };
  const H = { mes: t("Mes", "Month"), origen: t("Origen", "Origin"), neg: t("Negociador", "Negotiator"), cuenta: t("¿Cuenta como real?", "Counts as real?") };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Historial anterior a SOLU", "History from before SOLU")}</h1>
        <p>{t("Las cifras de años anteriores, del sistema anterior o de Siigo, para que cada empresa tenga historial y sugerencia. Se pegan desde Excel, se revisan y se guardan.", "The figures of earlier years, from the earlier system or from Siigo, so each company has a history and a suggestion. They are pasted from Excel, checked and saved.")}</p>
      </div></div>
      <BudgetNav i={i} active="historial" year={year} years={[]} />
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {review && batch && (
        <section className="card" id="revision">
          <b>{t("REVISIÓN ANTES DE GUARDAR", "REVIEW BEFORE SAVING")} · {batch.label}</b>
          <p className="small">{t(SOURCE_TXT[batch.source as HistorySource].es, SOURCE_TXT[batch.source as HistorySource].en)} · {batch.currency} · {t("cifras en", "figures in")} {t(UNIT_TXT[batch.unit].es, UNIT_TXT[batch.unit].en)}. {t("Todavía no se ha guardado nada.", "Nothing has been saved yet.")}</p>
          {!review.parsed.columns ? (
            <div className="note risk" id="faltan-columnas">{t("No se pudieron leer los títulos de la primera fila. Falta: ", "The headings on the first row could not be read. Missing: ")}{review.parsed.missing.map((m) => t(m.es, m.en)).join("; ")}. {t("La primera fila pegada debe ser la de los títulos, como en la plantilla.", "The first pasted row must be the headings, as in the template.")}</div>
          ) : (
            <>
              <div className="pc-tiles">
                <article data-t="leidas"><b>{t("Filas leídas", "Rows read")}</b><span>{i.n(review.parsed.read)}</span></article>
                <article data-t="ok"><b>{t("Filas que se guardarán", "Rows to be saved")}</b><span>{i.n(review.okRows)}</span><small>{t(`${review.companies} empresas`, `${review.companies} companies`)}{review.from ? ` · ${monthName(review.from)} – ${monthName(review.to!)}` : ""}</small></article>
                <article data-t="problemas"><b>{t("Filas con algo por corregir", "Rows with something to fix")}</b><span>{i.n(review.parsed.read - review.okRows)}</span><small>{review.problems.length ? t("No se guardan: están abajo, una por una.", "They are not saved: they are listed below, one by one.") : t("Ninguna.", "None.")}</small></article>
              </div>
              {review.parsed.ignored.length > 0 && <p className="small" id="ignoradas">{t("Columnas que no se usan en esta carga: ", "Columns not used in this load: ")}{review.parsed.ignored.map((c) => `«${c}»`).join(", ")}.</p>}
              {review.replaces > 0 && <div className="note attn" id="reemplaza">{t(`${i.n(review.replaces)} cifras reemplazan a las de una carga anterior del mismo origen (misma empresa, mes e indicador).`, `${i.n(review.replaces)} figures replace those of an earlier load of the same origin (same company, month and indicator).`)}</div>}
              {review.shadowed > 0 && (
                <div className="note attn" id="no-cuentan">
                  {t(`${i.n(review.shadowed)} cifras se guardan pero no cuentan como reales, porque la empresa ya tiene Necesidades en SOLU desde ese mes y ahí manda lo registrado en SOLU: `, `${i.n(review.shadowed)} figures are saved but do not count as real, because the company already has Needs in SOLU from that month and SOLU's own records rule there: `)}
                  {review.shadowedCompanies.slice(0, 12).map((c) => `${names.get(c.accountId) ?? "—"} (${t("desde", "since")} ${monthName(c.since)})`).join("; ")}{review.shadowedCompanies.length > 12 ? t(` y ${review.shadowedCompanies.length - 12} más`, ` and ${review.shadowedCompanies.length - 12} more`) : ""}.
                </div>
              )}
              {review.totals.length > 0 && (
                <div className="pc-scroll">
                  <table className="pc-table pc-cards" id="tabla-revision">
                    <thead><tr><th>{t("Año", "Year")}</th>{VALUE_COLUMNS.map((k) => <th key={k}>{colName(k)}</th>)}</tr></thead>
                    <tbody>
                      {[...new Set(review.totals.map((x) => x.year))].map((y) => (
                        <tr key={y} data-y={y}><th scope="row">{y}</th>{VALUE_COLUMNS.map((k) => <td key={k} data-l={colName(k)}>{cell(k, review.totals.find((x) => x.year === y && x.kpi === k)?.value)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {review.totals.length > 0 && <p className="src">{t("Lo que se guardará, sumado por año, en pesos.", "What will be saved, added up by year, in pesos.")}{batch.currency === "USD" ? t(" Los dólares se pasaron a pesos con la TRM oficial promedio de cada mes.", " Dollars were turned into pesos with each month's average official TRM.") : ""} {t("Compáralo con el total de tu archivo antes de guardar.", "Compare it with your file's total before saving.")}</p>}
            </>
          )}
          {review.problems.length > 0 && (
            <>
              <h3>{t("Filas que no se guardan", "Rows that are not saved")}</h3>
              <div className="pc-scroll">
                <table className="pc-table pc-cards" id="tabla-problemas">
                  <thead><tr><th>{t("Fila", "Row")}</th><th className="l">{t("Lo que trae", "What it has")}</th><th className="l">{t("Qué corregir", "What to fix")}</th></tr></thead>
                  <tbody>{review.problems.slice(0, MAX_PROBLEMS).map((p, n) => <tr key={n} data-code={p.code}><th scope="row">{p.line}</th><td className="l" style={{ whiteSpace: "normal" }}>{p.detail}</td><td className="l" style={{ whiteSpace: "normal" }}>{t(PROBLEM_TXT[p.code].es, PROBLEM_TXT[p.code].en)}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="src">{review.problems.length > MAX_PROBLEMS ? t(`Se muestran las primeras ${MAX_PROBLEMS} de ${review.problems.length}. `, `Showing the first ${MAX_PROBLEMS} of ${review.problems.length}. `) : ""}{t("El número de fila es el de tu Excel, contando la de títulos. Puedes guardar las demás ahora y cargar estas después, ya corregidas.", "The row number is the one in your Excel, counting the headings. You can save the others now and load these later, once fixed.")}</p>
            </>
          )}
          <div className="pc-actions">
            {review.figures.length > 0 && <form action={applyHistory.bind(null, batch.id)}><button type="submit">{t("Guardar historial", "Save history")}</button></form>}
            <form action={removeHistory.bind(null, batch.id)}><button type="submit" className="secondary">{t("Descartar revisión", "Discard review")}</button></form>
          </div>
        </section>
      )}

      {load && (
        <section className="card" id="cargar">
          <b>{t("CARGAR HISTORIAL", "LOAD HISTORY")}</b>
          <ol className="small" style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
            <li>{t("Descarga la plantilla y ábrela en Excel: ", "Download the template and open it in Excel: ")}<a href="/comercial/presupuesto/historial/plantilla?s=ANTERIOR" id="plantilla">{t("Plantilla del sistema anterior", "Earlier-system template")}</a> · <a href="/comercial/presupuesto/historial/plantilla?s=SIIGO" id="plantilla-siigo">{t("Plantilla de Siigo", "Siigo template")}</a></li>
            <li>{t("Llena una fila por empresa y mes. La empresa se reconoce por el NIT (o por su nombre exacto en SOLU). Deja vacía la cifra que no tengas.", "Fill one row per company and month. The company is recognised by its tax ID (or its exact name in SOLU). Leave empty any figure you don't have.")}</li>
            <li>{t("Selecciona las celdas con sus títulos, cópialas y pégalas aquí abajo; o guarda el archivo y súbelo tal cual (se lee la primera hoja).", "Select the cells with their headings, copy them and paste them below; or save the file and upload it as it is (the first sheet is read).")}</li>
          </ol>
          <form action={checkHistory} className="qa-form" style={{ maxWidth: 860 }}>
            <div className="pc-assume">
              <label>{t("Origen", "Origin")} *<select name="source" defaultValue="ANTERIOR" style={{ maxWidth: "100%" }}><option value="ANTERIOR">{t("Sistema anterior (todas las cifras)", "Earlier system (every figure)")}</option><option value="SIIGO">{t("Siigo (solo facturación)", "Siigo (invoicing only)")}</option></select></label>
              <label>{t("Moneda de los valores", "Currency of the values")} *<select name="currency" defaultValue="COP" style={{ maxWidth: "100%" }}><option value="COP">{t("Pesos (COP)", "Pesos (COP)")}</option><option value="USD">{t("Dólares (USD)", "Dollars (USD)")}</option></select></label>
              <label>{t("Los valores están en", "The values are in")} *<select name="unit" defaultValue="1" style={{ maxWidth: "100%" }}>{UNITS.map((u) => <option key={u} value={u}>{t(UNIT_TXT[u].es, UNIT_TXT[u].en)}</option>)}</select></label>
            </div>
            <label>{t("Nombre de esta carga", "Name of this load")} *<input type="text" name="label" maxLength={120} placeholder={t("Ventas 2024–2026 del sistema anterior", "Sales 2024–2026 from the earlier system")} /></label>
            <label>{t("Filas copiadas de Excel", "Rows copied from Excel")}<textarea name="rows" rows={7} spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre" }} /></label>
            <label>{t("O un archivo de Excel o CSV", "Or an Excel or CSV file")}<input type="file" name="file" accept=".xlsx,.xlsm,.csv,.txt,text/csv,text/plain" /></label>
            <button type="submit">{t("Revisar antes de guardar", "Check before saving")}</button>
            <span className="src block">{t("Revisar no guarda nada: muestra lo que SOLU entendió, fila por fila, y ahí decides. Valores sin IVA; la facturación, ya descontadas las notas crédito. Un valor en dólares se pasa a pesos con la TRM oficial promedio de su mes.", "Checking saves nothing: it shows what SOLU understood, row by row, and you decide there. Values before VAT; invoicing net of credit notes. A value in dollars is turned into pesos with its month's average official TRM.")}</span>
          </form>
        </section>
      )}

      <section className="card" id="cargas">
        <b>{t("CARGAS GUARDADAS", "SAVED LOADS")}</b>
        {batches.length === 0 ? <p className="small muted">{t("Todavía no se ha cargado historial. Mientras tanto, el historial de cada empresa es solo lo registrado en SOLU.", "No history has been loaded yet. Meanwhile each company's history is only what is recorded in SOLU.")}{load ? "" : t(" Lo cargan Gerencia, la Dirección Comercial, Finanzas o Administración.", " Management, the Commercial Director, Finance or Administration load it.")}</p> : (
          <div className="pc-scroll">
            <table className="pc-table pc-cards" id="tabla-cargas">
              <thead><tr><th>{t("Carga", "Load")}</th><th className="l">{H.origen}</th><th>{t("Meses", "Months")}</th><th>{t("Empresas", "Companies")}</th><th>{t("Cifras", "Figures")}</th><th className="l">{t("Quién y cuándo", "Who and when")}</th>{load && <th />}</tr></thead>
              <tbody>
                {batches.map((b) => { const s = spanOf.get(b.id); return (
                  <tr key={b.id} data-b={b.id}>
                    <th scope="row">{b.label}</th>
                    <td className="l" data-l={H.origen}>{t(SOURCE_TXT[b.source as HistorySource].es, SOURCE_TXT[b.source as HistorySource].en)} · {b.currency}</td>
                    <td data-l={t("Meses", "Months")}>{s?._min.month ? `${monthName(s._min.month)} – ${monthName(s._max.month!)}` : "—"}</td>
                    <td data-l={t("Empresas", "Companies")}>{i.n(nCompanies(b.id))}</td>
                    <td data-l={t("Cifras", "Figures")}>{i.n(b._count.rows)}</td>
                    <td className="l" data-l={t("Quién y cuándo", "Who and when")}>{b.createdByName} · {i.date(b.appliedAt)}</td>
                    {load && <td><form action={removeHistory.bind(null, b.id)}><button type="submit" className="secondary sm" data-confirm={t(`¿Quitar la carga «${b.label}» con todas sus cifras? No se puede deshacer.`, `Remove the load “${b.label}” with all its figures? This cannot be undone.`)}>{t("Quitar carga", "Remove load")}</button></form></td>}
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}
        <p className="src">{t("Regla para no contar dos veces: lo cargado cuenta como real solo en los meses anteriores a la primera Necesidad de esa empresa en SOLU; desde ese mes cuenta lo registrado en SOLU. En facturación, la cifra de Siigo reemplaza a la del sistema anterior del mismo mes. Para ver lo cargado de una empresa, abre su presupuesto y entra por «Ver las fuentes de estas cifras».", "Rule against counting twice: a loaded figure counts as real only in the months before that company's first Need in SOLU; from that month on SOLU's own records count. For invoicing, Siigo's figure replaces the earlier system's for the same month. To see what was loaded for a company, open its budget and go in through «See the sources of these figures».")}</p>
      </section>

      {company && (
        <section className="card" id="empresa">
          <b>{t(`LO CARGADO DE ${company.name.toUpperCase()}`, `LOADED FOR ${company.name.toUpperCase()}`)}</b>
          {compRows.length === 0 ? <p className="small muted">{t("No hay historial cargado para esta empresa.", "No history has been loaded for this company.")}</p> : (
            <>
              <p className="small">{compCut ? t(`Su primera Necesidad en SOLU es de ${monthName(compCut)}: lo cargado cuenta hasta el mes anterior.`, `Its first Need in SOLU is from ${monthName(compCut)}: loaded figures count up to the month before.`) : t("Esta empresa no tiene Necesidades en SOLU todavía: todo lo cargado cuenta.", "This company has no Needs in SOLU yet: everything loaded counts.")} <Link href={`/comercial/presupuesto/${company.id}?y=${year}`}>{t("Abrir su presupuesto", "Open its budget")} →</Link></p>
              <div className="pc-scroll">
                <table className="pc-table" id="tabla-empresa">
                  <thead><tr><th>{H.mes}</th><th className="l">{H.origen}</th><th className="l">{H.neg}</th>{VALUE_COLUMNS.map((k) => <th key={k}>{colName(k)}</th>)}<th className="l">{H.cuenta}</th></tr></thead>
                  <tbody>
                    {compKeys.map((key) => { const [month, source, ownerId] = key.split("|"); const rs = compRows.filter((r) => r.month === month && r.source === source && r.ownerId === ownerId); const counted = rs.filter((r) => compCounted.has(r.id)).length; return (
                      <tr key={key} id={`m-${month}`} data-m={month}>
                        <th scope="row">{monthName(month)}</th>
                        <td className="l">{t(SOURCE_TXT[source as HistorySource].es, SOURCE_TXT[source as HistorySource].en)}<span className="src block">{rs[0].label}</span></td>
                        <td className="l">{owners.get(ownerId) ?? "—"}</td>
                        {VALUE_COLUMNS.map((k) => { const r = rs.find((x) => x.kpi === k); return <td key={k}>{cell(k, r?.value)}{r?.rate ? <span className="src block">USD {i.n(r.orig)} × {i.n2(r.rate)}</span> : null}</td>; })}
                        <td className="l">{counted === rs.length ? <span className="sig ok">{t("Sí", "Yes")}</span> : counted === 0 ? <span className="sig wait">{compCut && month >= compCut ? t("No: manda SOLU", "No: SOLU rules") : t("No: manda Siigo", "No: Siigo rules")}</span> : <span className="sig attn">{t("En parte", "Partly")}</span>}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
              <p className="src">{t("En pesos. «En parte» = la facturación de ese mes la da Siigo y las demás cifras, el sistema anterior.", "In pesos. «Partly» = that month's invoicing comes from Siigo and the other figures from the earlier system.")}</p>
            </>
          )}
        </section>
      )}

      {canCompare && (
        <section className="card" id="siigo">
          <b>{t("FACTURACIÓN: SOLU FRENTE A SIIGO", "INVOICING: SOLU AGAINST SIIGO")}{cy ? ` · ${cy}` : ""}</b>
          {!cy ? <p className="small muted">{t("Para comparar, carga la facturación de Siigo por empresa y mes (origen «Siigo»). SOLU no lee Siigo directamente: compara lo que se carga aquí con sus propias facturas.", "To compare, load Siigo's invoicing by company and month (origin «Siigo»). SOLU does not read Siigo directly: it compares what is loaded here with its own invoices.")}</p> : (
            <>
              {siigoYears.length > 1 && <p className="pc-years" style={{ margin: "6px 0" }}><span className="src">{t("Año", "Year")}</span>{siigoYears.map((y) => <Link key={y} href={`/comercial/presupuesto/historial?cy=${y}#siigo`} className={y === cy ? "on" : ""}>{y}</Link>)}</p>}
              <div className="pc-scroll">
                <table className="pc-table pc-cards" id="tabla-siigo">
                  <thead><tr><th>{H.mes}</th><th>{t("Facturas en SOLU", "Invoices in SOLU")}</th><th>{t("Facturación en Siigo", "Invoicing in Siigo")}</th><th>{t("Diferencia", "Difference")}</th><th className="l">{t("Resultado", "Result")}</th></tr></thead>
                  <tbody>
                    {compare.map((c) => { const d = c.solu - c.siigo; const same = c.rows.length === 0; return (
                      <tr key={c.month} data-m={c.month}>
                        <th scope="row">{monthName(c.month)}</th>
                        <td data-l={t("Facturas en SOLU", "Invoices in SOLU")}>{i.money(c.solu, "COP")}</td>
                        <td data-l={t("Facturación en Siigo", "Invoicing in Siigo")}>{i.money(c.siigo, "COP")}</td>
                        <td data-l={t("Diferencia", "Difference")}>{i.money(d, "COP")}</td>
                        <td className="l" data-l={t("Resultado", "Result")} style={{ whiteSpace: "normal" }}>{same ? <span className="sig ok">{t("Coincide", "Matches")}</span> : c.solu === 0 ? <span className="sig wait">{t("Sin facturas en SOLU ese mes", "No invoices in SOLU that month")}</span> : <><span className="sig risk">{t(`No coincide en ${c.rows.length} ${c.rows.length === 1 ? "empresa" : "empresas"}`, `Differs in ${c.rows.length} ${c.rows.length === 1 ? "company" : "companies"}`)}</span><span className="src block">{c.rows.slice(0, 6).map((r) => `${r.name}: SOLU ${f.m(r.solu)} · Siigo ${f.m(r.siigo)}`).join(" — ")}{c.rows.length > 6 ? t(` — y ${c.rows.length - 6} más`, ` — and ${c.rows.length - 6} more`) : ""}</span></>}</td>
                      </tr>
                    ); })}
                  </tbody>
                </table>
              </div>
              <p className="src">{t("Solo los meses con facturación de Siigo cargada. «Facturas en SOLU» = facturas emitidas en SOLU ese mes, en pesos (las de dólares, a la TRM oficial de su fecha), de todas las empresas. Una diferencia menor a $ 1.000 se toma como redondeo. Una empresa que factura en Siigo y no en SOLU (o al revés) aparece como diferencia. Los meses de antes de SOLU dicen «Sin facturas en SOLU ese mes»: ahí no hay nada que conciliar.", "Only the months with Siigo invoicing loaded. «Invoices in SOLU» = invoices issued in SOLU that month, in pesos (dollar ones at the official TRM of their date), every company. A difference under $ 1,000 is taken as rounding. A company invoiced in Siigo and not in SOLU (or the other way round) shows as a difference. Months from before SOLU say «No invoices in SOLU that month»: there is nothing to reconcile there.")}{noRate ? t(` ${noRate} facturas en dólares no tienen TRM guardada y no suman.`, ` ${noRate} dollar invoices have no stored TRM and are not added.`) : ""}</p>
            </>
          )}
        </section>
      )}
    </>
  );
}
