import { bigMoney, FORMULA_VERSION, SCALES } from "@/lib/fin-rules";
import type { companyEconomics } from "@/lib/econ";

type Data = NonNullable<Awaited<ReturnType<typeof companyEconomics>>>;
type T = (es: string, en: string) => string;

/** Economic intelligence of a company (§9.6): facts and trend, never a score. Prudent language. */
export function EconBlock({ d, t, lang, day }: { d: Data; t: T; lang: string; day: (x: Date) => string }) {
  const latest = d.c.snapshots[0];
  const num = (v: number) => new Intl.NumberFormat(lang === "EN" ? "en-US" : "es-CO", { maximumFractionDigits: 1 }).format(v);
  const fmt = (k: string, v: number) => (k === "currentRatio" ? `${num(v)}×` : `${num(v)} %`);
  return (
    <div className="stack">
      <div className="grid cols-2">
        <div className="card">
          <b>{t("Lo que muestra la evidencia disponible", "What the available evidence shows")}</b>
          <p className="small">{t("Ingresos", "Revenue")}: <b>{bigMoney(latest.currency, latest.revenue == null ? null : Number(latest.revenue), lang)}</b> (FY{latest.fiscalYear})</p>
          <ul className="mk-ul">{d.facts.map((f) => <li key={f.es} className="small">{t(f.es, f.en)}</li>)}</ul>
          <span className="src block">{t("Fuente", "Source")}: {latest.source.name} · {latest.import.fileName} · {t("guardado", "saved")} {latest.import.committedAt ? day(latest.import.committedAt) : ""}</span>
          <span className="src block">{t("Esto ayuda a decidir si vale la pena conocer la empresa. No es una evaluación de crédito: el cupo lo decide Administración.", "This helps decide whether the company is worth getting to know. It isn't a credit evaluation: limits are decided by Administration.")}</span>
        </div>
        <div className="card">
          <b>{t("Señales", "Signals")}</b>
          {d.signals.length === 0 ? <p className="small muted">{t("Sin cambios notables según los umbrales actuales.", "No notable changes under the current thresholds.")}</p> : (
            <ul className="mk-ul">{d.signals.map((s) => <li key={s.key}><span className={`sig ${s.tone === "good" ? "ok" : "attn"}`}>{t(s.es, s.en)}</span></li>)}</ul>
          )}
          <b className="small">{t("Indicadores", "Indicators")}</b>
          {d.metrics.length === 0 ? <p className="small muted">{t("Faltan datos para calcularlos.", "Not enough data to calculate them.")}</p> : (
            <ul className="mk-ul">{d.metrics.map((m) => (
              <li key={m.key} className="small">
                <details><summary>{t(m.es, m.en)}: <b>{fmt(m.key, m.value)}</b></summary>
                  <span className="src block">{t("Fórmula", "Formula")}: {m.formula} · {FORMULA_VERSION}</span>
                  <span className="src block">{Object.entries(m.inputs).map(([k, v]) => `${k}: ${typeof v === "number" && Math.abs(v) >= 1000 ? bigMoney(latest.currency, v, lang) : v}`).join(" · ")}</span>
                </details>
              </li>
            ))}</ul>
          )}
        </div>
      </div>
      <div className="card flush mk-scroll">
        <table>
          <thead><tr><th>{t("Año", "Year")}</th><th className="n">{t("Ingresos", "Revenue")}</th><th className="n">{t("Utilidad neta", "Net income")}</th><th className="n">{t("Activos", "Assets")}</th><th className="n">{t("Pasivos", "Liabilities")}</th><th className="n">{t("Patrimonio", "Equity")}</th><th>{t("Fuente", "Source")}</th></tr></thead>
          <tbody>{d.c.snapshots.map((s, n) => {
            const older = d.c.snapshots.findIndex((x) => x.fiscalYear === s.fiscalYear) !== n;
            const v = (x: unknown) => bigMoney(s.currency, x == null ? null : Number(x), lang);
            return (
              <tr key={s.id} className={older ? "muted" : ""}>
                <td>FY{s.fiscalYear}{older && <span className="src">{t("versión anterior", "earlier version")}</span>}</td>
                <td className="n">{v(s.revenue)}</td><td className="n">{v(s.netIncome)}</td><td className="n">{v(s.assets)}</td><td className="n">{v(s.liabilities)}</td><td className="n">{v(s.equity)}</td>
                <td className="small">{s.source.name}<span className="src">{t("en el archivo", "in the file")}: {t(SCALES[s.unitsScale]?.es ?? s.unitsScale, SCALES[s.unitsScale]?.en ?? s.unitsScale)}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
