import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canImportData } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { FIELDS, SCALES, bigMoney, headerYears, mappingProblems, targetOf, needsDecimalStyle, suggestDecimalStyle, type FieldKey, type Mapping, type ParsedRow } from "@/lib/fin-rules";
import type { Cell } from "@/lib/sheet-read";
import { commit, decide, discard, saveMapping, setSheet } from "../actions";
import { IMPORT_STATUS } from "../../ui";

// One dataset import: map columns → check scale/currency/year → review exceptions → save (one transaction).

const ERR: Record<string, [string, string]> = {
  escala: ["Elige la escala de las cifras. SOLU no la supone: un error aquí multiplica todo por mil.", "Pick the scale of the figures. SOLU doesn't assume it: a mistake here multiplies everything by a thousand."],
  moneda: ["Elige la moneda de las cifras.", "Pick the currency of the figures."], mapeo: ["Faltan columnas importantes (abajo).", "Important columns are missing (below)."],
  pendiente: ["Aún hay filas por revisar.", "There are still rows to review."], repetido: ["Hay dos filas incluidas con el mismo NIT y año: deja solo una.", "Two included rows have the same NIT and year: keep only one."], ya: ["Este archivo ya se guardó.", "This file was already saved."],
};
const groupOf = (m: string) => m.split(" (")[0].split(":")[0];

export default async function ImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; n?: string; s?: string }> }) {
  const user = await requireUser();
  if (!canImportData(user)) redirect("/mercado/economia");
  const { id } = await params;
  const sp = await searchParams;
  const imp = await db.datasetImport.findUnique({ where: { id }, select: { id: true, fileName: true, size: true, status: true, headers: true, preview: true, rowCount: true, mapping: true, scale: true, currency: true, decimalStyle: true, fixedYear: true, okCount: true, errorCount: true, reviewCount: true, failure: true, createdAt: true, createdByName: true, committedAt: true, committedByName: true, source: { select: { name: true } } } });
  if (!imp) notFound();
  const i = makeI18n(user.lang);
  const { t } = i;
  const h = (imp.headers ?? {}) as { row?: number; cells?: (string | null)[]; sheetName?: string; sheetNames?: string[]; notes?: string[] };
  const cells = h.cells ?? [];
  const preview = (imp.preview ?? []) as Cell[][];
  const mapping = (imp.mapping ?? {}) as Mapping;
  const committed = imp.status === "COMMITTED";
  const validated = ["REVIEW_REQUIRED", "READY_TO_COMMIT", "COMMITTED"].includes(imp.status);
  const moneyCols = Object.entries(mapping).filter(([, f]) => !["nit", "name", "year", "ciiu", "sector", "department", "city"].includes(targetOf(f).field)).map(([c]) => Number(c));
  // Years written in the column titles (wide files: one record per year from each row).
  const years = [...new Set([...headerYears(cells), ...Object.values(mapping).map((v) => targetOf(v).year).filter((y): y is number => !!y)])].sort((a, b) => b - a);
  const PER_YEAR_KEYS: FieldKey[] = ["revenue", "operatingIncome", "netIncome", "assets", "liabilities", "equity", "currentAssets", "currentLiabilities", "debt", "employees"];
  const samples = preview.flatMap((r) => moneyCols.map((c) => r[c] ?? null));
  const styleNeeded = needsDecimalStyle(samples);
  const styleGuess = imp.decimalStyle ?? suggestDecimalStyle(samples);
  const problems = mappingProblems(mapping, imp.fixedYear);

  const [review, errors, okSample, pending] = validated ? await Promise.all([
    db.datasetRow.findMany({ where: { importId: id, status: "REVIEW" }, orderBy: { rowNo: "asc" }, take: 300 }),
    db.datasetRow.findMany({ where: { importId: id, status: "ERROR" }, orderBy: { rowNo: "asc" }, take: 200 }),
    db.datasetRow.findMany({ where: { importId: id, status: "OK" }, orderBy: { rowNo: "asc" }, take: 5 }),
    db.datasetRow.count({ where: { importId: id, status: "REVIEW", decision: null } }),
  ]) : [[], [], [], 0];
  const skipped = validated ? await db.datasetRow.count({ where: { importId: id, status: "SKIPPED" } }) : 0;
  const groups = [...new Set(review.flatMap((r) => r.messages.map(groupOf)))];
  const cur = imp.currency ?? "COP";

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado/fuentes">{t("Mercado · Fuentes de inteligencia", "Market · Intelligence sources")}</Link></div>
          <h1>{imp.fileName}</h1>
          <p className="small">{imp.source.name} · {t(`${i.n(imp.rowCount)} filas`, `${i.n(imp.rowCount)} rows`)} · {(imp.size / 1024 / 1024).toFixed(1)} MB · {imp.createdByName}, {i.day(imp.createdAt)} · <a href={`/mercado/fuentes/${imp.id}/archivo`}>{t("Descargar el original", "Download the original")}</a></p>
          <span className={`sig ${IMPORT_STATUS[imp.status]?.[2] ?? "wait"}`}>{t(IMPORT_STATUS[imp.status]?.[0] ?? imp.status, IMPORT_STATUS[imp.status]?.[1] ?? imp.status)}</span>
        </div>
      </div>
      {sp.err && ERR[sp.err] && <div className="note attn">{t(...ERR[sp.err])}</div>}
      {sp.ok === "validado" && <div className="note okn">{t("Filas revisadas. Mira el resumen y decide las excepciones.", "Rows checked. Look at the summary and decide the exceptions.")}</div>}
      {sp.ok === "guardado" && <div className="note okn">{t(`Guardado: ${i.n(Number(sp.n ?? 0))} cifras anuales. ${Number(sp.s ?? 0) ? `${sp.s} señal(es) económica(s) nuevas para clientes y prospectos, ya en Mercado · Explorar.` : "Sin señales nuevas para clientes o prospectos."}`, `Saved: ${i.n(Number(sp.n ?? 0))} yearly records. ${Number(sp.s ?? 0) ? `${sp.s} new economic signal(s) for customers and prospects, now in Market · Explore.` : "No new signals for customers or prospects."}`)} <Link href="/mercado/economia">{t("Ir al explorador económico", "Go to the economic explorer")}</Link></div>}

      {imp.status === "FAILED" && <div className="card"><p>{t("SOLU no pudo leer el archivo", "SOLU couldn't read the file")}: <b>{imp.failure}</b></p><form action={discard.bind(null, imp.id)}><button type="submit" className="secondary">{t("Descartar", "Discard")}</button></form></div>}

      {!committed && imp.status !== "FAILED" && imp.status !== "DISCARDED" && (
        <section className="mk-sec">
          <h2>1. {t("Qué es cada columna", "What each column is")}</h2>
          {(h.sheetNames?.length ?? 0) > 1 && (
            <form action={setSheet.bind(null, imp.id)} className="row card">
              <span className="small">{t(`El libro tiene ${h.sheetNames!.length} hojas. SOLU tomó la que tiene más datos:`, `The workbook has ${h.sheetNames!.length} sheets. SOLU took the one with the most data:`)}</span>
              <select name="sheet" defaultValue={h.sheetName}>{h.sheetNames!.map((s) => <option key={s}>{s}</option>)}</select>
              <button type="submit" className="secondary">{t("Usar esta hoja", "Use this sheet")}</button>
            </form>
          )}
          <form action={saveMapping.bind(null, imp.id)} className="stack">
            <div className="card flush mk-scroll">
              <table>
                <thead><tr><th>{t("Columna del archivo", "File column")}</th><th>{t("Ejemplos", "Examples")}</th><th>{t("En SOLU es", "In SOLU it is")}</th></tr></thead>
                <tbody>{cells.map((c, n) => (
                  <tr key={n}>
                    <td><b>{c ?? `(${t("sin título", "untitled")} ${n + 1})`}</b></td>
                    <td className="small muted">{preview.slice(0, 3).map((r) => r[n]).filter((v) => v != null).map((v) => String(v).slice(0, 28)).join(" · ") || "—"}</td>
                    <td><select name={`col_${n}`} defaultValue={mapping[String(n)] ?? ""}><option value="">{t("— no usar —", "— don't use —")}</option>{(Object.keys(FIELDS) as FieldKey[]).map((k) => <option key={k} value={k}>{t(FIELDS[k].es, FIELDS[k].en)}</option>)}{years.map((y) => <optgroup key={y} label={t(`Cifras de ${y}`, `${y} figures`)}>{PER_YEAR_KEYS.map((k) => <option key={`${k}@${y}`} value={`${k}@${y}`}>{t(`${FIELDS[k].es} · ${y}`, `${FIELDS[k].en} · ${y}`)}</option>)}</optgroup>)}</select></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {years.length > 0 && <p className="small">{t(`Este archivo trae varios años en la misma fila (${years.join(" y ")}): cada fila se guarda como un registro por año. Si un año no trae cifras, se omite.`, `This file has several years on the same row (${years.join(" and ")}): each row is saved as one record per year. A year without figures is skipped.`)}</p>}
            {problems.length > 0 && <div className="note attn">{problems.map((p) => t(p.es, p.en)).join(" · ")}</div>}
            <h2>2. {t("Escala, moneda y año", "Scale, currency and year")}</h2>
            <div className="card row">
              <label>{t("Las cifras están en", "Figures are in")}<select name="scale" defaultValue={imp.scale ?? ""} required><option value="" disabled>{t("Elige…", "Pick…")}</option>{Object.entries(SCALES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>{t("Moneda", "Currency")}<select name="currency" defaultValue={imp.currency ?? ""} required><option value="" disabled>{t("Elige…", "Pick…")}</option><option>COP</option><option>USD</option></select></label>
              {styleNeeded && <label>{t("Formato de números", "Number format")}<select name="decimalStyle" defaultValue={styleGuess ?? ""} required><option value="" disabled>{t("Elige…", "Pick…")}</option><option value="COMMA">1.234,56</option><option value="DOT">1,234.56</option></select></label>}
              {(h.notes?.length ?? 0) > 0 && <div className="note" style={{ flexBasis: "100%" }}><b>{t("El archivo dice, arriba de la tabla:", "The file says, above the table:")}</b> {h.notes!.map((x) => `«${x}»`).join(" · ")}<span className="src block">{t("Usa esa nota para elegir la escala: «Miles de pesos» = Miles; «Millones de pesos» = Millones.", "Use that note to pick the scale: “Miles de pesos” = Thousands; “Millones de pesos” = Millions.")}</span></div>}
              <label>{t("Año (si el archivo no tiene columna de año)", "Year (if the file has no year column)")}<input name="fixedYear" type="number" min="1990" max={new Date().getUTCFullYear()} defaultValue={imp.fixedYear ?? ""} style={{ width: 100 }} /></label>
              <span className="src block" style={{ flexBasis: "100%" }}>{t("Revisa la nota del archivo (por ejemplo «Miles de pesos»). Después de revisar verás cómo queda una empresa conocida antes de guardar.", "Check the file's note (for example “Miles de pesos”). After checking you'll see how a known company looks before saving.")}</span>
            </div>
            <button type="submit">{validated ? t("Volver a revisar todas las filas", "Check all rows again") : t("Revisar todas las filas", "Check all rows")}</button>
          </form>
        </section>
      )}

      {validated && (
        <section className="mk-sec" id="revisar">
          <h2>3. {t("Resumen", "Summary")}</h2>
          <div className="grid cols-4">
            <div className="card"><b className="val">{i.n(imp.okCount)}</b><span className="src block">{t("filas listas", "rows ready")}</span></div>
            <div className="card"><b className="val">{i.n(imp.reviewCount)}</b><span className="src block">{t(`a revisar · ${pending} sin decidir`, `to review · ${pending} undecided`)}</span></div>
            <div className="card"><b className="val">{i.n(imp.errorCount)}</b><span className="src block">{t("con error (no se guardan)", "with errors (not saved)")}</span></div>
            <div className="card"><b className="val">{i.n(skipped)}</b><span className="src block">{t("ya estaban (mismas cifras)", "already there (same figures)")}</span></div>
          </div>
          {okSample.length > 0 && (
            <div className="card flush mk-scroll">
              <p className="small" style={{ padding: "10px 16px 0" }}><b>{t("Así quedarán", "This is how they'll look")}</b> · {t(`escala: ${SCALES[imp.scale ?? "UNITS"]?.es}, moneda ${cur}. Si una cifra se ve mil veces más grande o más pequeña, corrige la escala arriba.`, `scale: ${SCALES[imp.scale ?? "UNITS"]?.en}, currency ${cur}. If a figure looks a thousand times too big or small, fix the scale above.`)}</p>
              <table>
                <thead><tr><th>{t("Empresa", "Company")}</th><th>{t("Año", "Year")}</th><th className="n">{t("Ingresos", "Revenue")}</th><th className="n">{t("Utilidad neta", "Net income")}</th><th className="n">{t("Activos", "Assets")}</th><th className="n">{t("Patrimonio", "Equity")}</th></tr></thead>
                <tbody>{okSample.map((r) => { const p = r.parsed as unknown as ParsedRow; return <tr key={r.id}><td>{p.name}<span className="src">NIT {p.nit}</span></td><td>{p.year}</td><td className="n">{bigMoney(cur, p.values.revenue, user.lang)}</td><td className="n">{bigMoney(cur, p.values.netIncome, user.lang)}</td><td className="n">{bigMoney(cur, p.values.assets, user.lang)}</td><td className="n">{bigMoney(cur, p.values.equity, user.lang)}</td></tr>; })}</tbody>
              </table>
            </div>
          )}

          {review.length > 0 && (
            <>
              <h2>4. {t("Excepciones a revisar", "Exceptions to review")}</h2>
              {!committed && groups.length > 0 && (
                <div className="card">
                  <span className="small">{t("Decidir todas las de un tipo:", "Decide all of one kind:")}</span>
                  <ul className="mk-ul">{groups.map((g) => (
                    <li key={g} className="row"><span style={{ flex: 1 }}>{g}</span>
                      <form action={decide.bind(null, imp.id)}><input type="hidden" name="group" value={g} /><input type="hidden" name="decision" value="INCLUDE" /><button type="submit" className="link small">{t("Incluir todas", "Include all")}</button></form>
                      <form action={decide.bind(null, imp.id)}><input type="hidden" name="group" value={g} /><input type="hidden" name="decision" value="EXCLUDE" /><button type="submit" className="link small">{t("Excluir todas", "Exclude all")}</button></form>
                    </li>
                  ))}</ul>
                </div>
              )}
              <div className="card flush mk-scroll">
                <table>
                  <thead><tr><th>{t("Fila", "Row")}</th><th>{t("Empresa", "Company")}</th><th>{t("Qué revisar", "What to check")}</th><th>{t("Decisión", "Decision")}</th></tr></thead>
                  <tbody>{review.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{r.rowNo}</td>
                      <td>{r.name}<span className="src">NIT {r.nit} · {r.year}</span></td>
                      <td className="small">{r.messages.join(" · ")}</td>
                      <td>{committed ? (r.decision === "INCLUDE" ? t("Incluida", "Included") : t("Excluida", "Excluded")) : (
                        <span className="row">
                          <form action={decide.bind(null, imp.id)}><input type="hidden" name="rowId" value={r.id} /><input type="hidden" name="decision" value="INCLUDE" /><button type="submit" className={r.decision === "INCLUDE" ? "small" : "secondary small"}>{t("Incluir", "Include")}</button></form>
                          <form action={decide.bind(null, imp.id)}><input type="hidden" name="rowId" value={r.id} /><input type="hidden" name="decision" value="EXCLUDE" /><button type="submit" className={r.decision === "EXCLUDE" ? "small" : "secondary small"}>{t("Excluir", "Exclude")}</button></form>
                        </span>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {imp.reviewCount > review.length && <p className="src" style={{ padding: "8px 16px" }}>{t(`Mostrando ${review.length} de ${imp.reviewCount}. Usa «Decidir todas las de un tipo».`, `Showing ${review.length} of ${imp.reviewCount}. Use “Decide all of one kind”.`)}</p>}
              </div>
            </>
          )}

          {errors.length > 0 && (
            <details className="card">
              <summary>{t(`Filas con error (${i.n(imp.errorCount)}) — no se guardan`, `Rows with errors (${i.n(imp.errorCount)}) — not saved`)}</summary>
              <ul className="mk-ul">{errors.map((r) => <li key={r.id} className="small"><b>{t("Fila", "Row")} {r.rowNo}</b>{r.name ? ` · ${r.name}` : ""}: {r.messages.join(" · ")}</li>)}</ul>
              {imp.errorCount > errors.length && <p className="src">{t(`Mostrando ${errors.length} de ${imp.errorCount}.`, `Showing ${errors.length} of ${imp.errorCount}.`)}</p>}
            </details>
          )}

          {!committed && (
            <div className="card row">
              {imp.status === "READY_TO_COMMIT" ? (
                <form action={commit.bind(null, imp.id)}><button type="submit">{t(`Guardar ${i.n(imp.okCount + review.filter((r) => r.decision === "INCLUDE").length)} filas en SOLU`, `Save ${i.n(imp.okCount + review.filter((r) => r.decision === "INCLUDE").length)} rows in SOLU`)}</button></form>
              ) : <span className="small muted">{t(`Decide las ${pending} excepciones pendientes para poder guardar.`, `Decide the ${pending} pending exceptions to be able to save.`)}</span>}
              <form action={discard.bind(null, imp.id)}><button type="submit" className="secondary">{t("Descartar este archivo", "Discard this file")}</button></form>
              <span className="src block" style={{ flexBasis: "100%" }}>{t("Guardar es una sola operación: o se guarda todo o nada. Los años anteriores nunca se reemplazan.", "Saving is a single operation: all or nothing. Earlier years are never replaced.")}</span>
            </div>
          )}
          {committed && <p className="small muted">{t(`Guardado por ${imp.committedByName} el ${i.day(imp.committedAt!)}.`, `Saved by ${imp.committedByName} on ${i.day(imp.committedAt!)}.`)}</p>}
        </section>
      )}
    </>
  );
}
