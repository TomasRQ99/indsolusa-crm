import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canImportData, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { getThresholds, MAX_FILE } from "@/lib/dataset-import";
import { DEFAULT_THRESHOLDS, SOURCE_KINDS } from "@/lib/fin-rules";
import { createSource, saveThresholds, uploadFile } from "./actions";
import { IMPORT_STATUS as STATUS } from "../ui";

// Mercado M3 · Intelligence sources (§9.1): where economic data comes from, each file kept as evidence.

const OK: Record<string, [string, string]> = { fuente: ["Fuente creada.", "Source created."], descartado: ["Archivo descartado. No se guardó nada.", "File discarded. Nothing was saved."], umbrales: ["Nueva versión de los umbrales guardada. Se aplica a las próximas señales.", "New threshold version saved. It applies to the next signals."] };
const ERR: Record<string, [string, string]> = {
  vacio: ["Elige un archivo .xlsx o .csv.", "Pick an .xlsx or .csv file."], grande: ["El archivo pasa de 25 MB. Si es un .csv muy grande, divídelo por año.", "The file is over 25 MB. If it's a very large .csv, split it by year."],
  duplicado: ["Este mismo archivo ya se cargó antes.", "This same file was already uploaded."], fuente: ["Elige o crea la fuente primero.", "Pick or create the source first."], permiso: ["Solo Gerencia puede cambiar los umbrales.", "Only Management can change the thresholds."],
};
const TH: Record<keyof typeof DEFAULT_THRESHOLDS, [string, string, string]> = {
  strongGrowthPct: ["Crecimiento fuerte de ingresos desde", "Strong revenue growth from", "%"],
  revenueDropPct: ["Ingresos cayendo desde", "Revenue falling from", "%"],
  equityDropPct: ["Caída de patrimonio desde", "Equity drop from", "%"],
  leverageUpPts: ["Endeudamiento sube desde", "Leverage up from", "puntos"],
  weakCurrentRatio: ["Liquidez débil si la razón corriente es menor a", "Weak liquidity if current ratio below", "×"],
  bigChangePct: ["Cambio importante (ingresos o activos) desde", "Major change (revenue or assets) from", "%"],
  leverageModeratePct: ["Endeudamiento «moderado» desde", "Leverage “moderate” from", "%"],
  leverageHighPct: ["Endeudamiento «alto» por encima de", "Leverage “high” above", "%"],
};

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; dup?: string }> }) {
  const user = await requireUser();
  if (!canImportData(user)) redirect("/mercado/economia");
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const [sources, imports, th] = await Promise.all([
    db.intelligenceSource.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { snapshots: true } } } }),
    db.datasetImport.findMany({ orderBy: { createdAt: "desc" }, take: 30, select: { id: true, fileName: true, status: true, rowCount: true, okCount: true, errorCount: true, reviewCount: true, createdAt: true, createdByName: true, committedAt: true, committedByName: true, size: true, source: { select: { name: true } } } }),
    getThresholds(),
  ]);
  const manager = canManageAll(user);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado">{t("Mercado", "Market")}</Link></div>
          <h1>{t("Fuentes de inteligencia", "Intelligence sources")}</h1>
          <p>{t("Archivos de Supersociedades, Cámara de Comercio u otras bases. SOLU guarda el archivo original, revisa cada fila y solo guarda lo que tú confirmas. Nunca reemplaza años anteriores.", "Files from Supersociedades, Chamber of Commerce or other databases. SOLU keeps the original file, checks every row and saves only what you confirm. It never replaces earlier years.")}</p>
        </div>
        <Link href="/mercado/economia" className="btn secondary">{t("Explorador económico", "Economic explorer")}</Link>
      </div>
      {sp.ok && OK[sp.ok] && <div className="note okn">{t(...OK[sp.ok])}</div>}
      {sp.err && ERR[sp.err] && <div className="note attn">{t(...ERR[sp.err])}{sp.dup && <> <Link href={`/mercado/fuentes/${sp.dup}`}>{t("Ver esa carga", "See that upload")}</Link></>}</div>}

      <div className="grid cols-2">
        <section className="card">
          <b>{t("Cargar un archivo", "Upload a file")}</b>
          {sources.length === 0 ? <p className="small muted">{t("Primero crea la fuente (a la derecha).", "First create the source (on the right).")}</p> : (
            <form action={uploadFile} className="stack">
              <label>{t("Fuente", "Source")}<select name="sourceId" required>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label>{t("Archivo (.xlsx o .csv, hasta 25 MB)", "File (.xlsx or .csv, up to 25 MB)")}<input type="file" name="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-max={MAX_FILE} /></label>
              <button type="submit">{t("Cargar y revisar", "Upload and review")}</button>
              <span className="src block">{t("Nada se guarda en SOLU hasta que revises y confirmes.", "Nothing is saved in SOLU until you review and confirm.")}</span>
            </form>
          )}
        </section>
        <section className="card">
          <b>{t("Fuentes", "Sources")}</b>
          <ul className="mk-ul">{sources.map((s) => <li key={s.id}>{s.name} <span className="src">{t(SOURCE_KINDS[s.kind]?.es ?? s.kind, SOURCE_KINDS[s.kind]?.en ?? s.kind)} · {t(`${i.n(s._count.snapshots)} cifras anuales`, `${i.n(s._count.snapshots)} yearly records`)}{s.mapping ? ` · ${t("mapeo guardado", "mapping saved")}` : ""}</span></li>)}</ul>
          <details>
            <summary className="small">{t("Nueva fuente", "New source")}</summary>
            <form action={createSource} className="stack">
              <input name="name" required maxLength={120} placeholder={t("Ej.: Supersociedades — 10.000 empresas", "E.g.: Supersociedades — 10,000 companies")} />
              <select name="kind" defaultValue="SUPERSOCIEDADES">{Object.entries(SOURCE_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select>
              <input name="description" maxLength={300} placeholder={t("De dónde se descarga (opcional)", "Where it's downloaded from (optional)")} />
              <button type="submit" className="secondary">{t("Crear", "Create")}</button>
            </form>
          </details>
        </section>
      </div>

      <section className="mk-sec">
        <h2>{t("Archivos cargados", "Uploaded files")}</h2>
        {imports.length === 0 ? <div className="card empty small">{t("Aún no hay archivos.", "No files yet.")}</div> : (
          <div className="card flush">
            <table>
              <thead><tr><th>{t("Archivo", "File")}</th><th>{t("Estado", "Status")}</th><th className="n">{t("Filas", "Rows")}</th><th className="n">{t("Listas", "OK")}</th><th className="n">{t("A revisar", "Review")}</th><th className="n">{t("Con error", "Errors")}</th></tr></thead>
              <tbody>{imports.map((m) => (
                <tr key={m.id}>
                  <td><Link href={`/mercado/fuentes/${m.id}`}><b>{m.fileName}</b></Link><span className="src">{m.source.name} · {i.day(m.createdAt)} · {m.createdByName}{m.committedAt ? ` · ${t("guardado por", "saved by")} ${m.committedByName}` : ""}</span></td>
                  <td><span className={`sig ${STATUS[m.status]?.[2] ?? "wait"}`}>{t(STATUS[m.status]?.[0] ?? m.status, STATUS[m.status]?.[1] ?? m.status)}</span></td>
                  <td className="n">{i.n(m.rowCount)}</td><td className="n">{i.n(m.okCount)}</td><td className="n">{i.n(m.reviewCount)}</td><td className="n">{i.n(m.errorCount)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mk-sec" id="umbrales">
        <h2>{t("Umbrales de las señales económicas", "Economic signal thresholds")}</h2>
        <div className="card">
          <p className="small muted">{th.version === 0 ? t("Valores propuestos por SOLU: Gerencia aún no los ha confirmado. Una señal es una razón para mirar, nunca una aprobación ni un rechazo de crédito.", "Values proposed by SOLU: Management hasn't confirmed them yet. A signal is a reason to look, never a credit approval or rejection.") : t(`Versión ${th.version}, definida por ${th.by} el ${i.day(th.at!)}.`, `Version ${th.version}, set by ${th.by} on ${i.day(th.at!)}.`)}</p>
          <form action={saveThresholds} className="mk-th">
            {(Object.keys(TH) as (keyof typeof TH)[]).map((k) => (
              <label key={k}>{t(TH[k][0], TH[k][1])}<span className="row"><input name={k} type="number" step="0.1" min="0" defaultValue={th.value[k]} disabled={!manager} style={{ width: 90 }} /> <span className="small muted">{TH[k][2]}</span></span></label>
            ))}
            {manager && <button type="submit" className="secondary">{t("Guardar nueva versión", "Save new version")}</button>}
          </form>
        </div>
      </section>
    </>
  );
}
