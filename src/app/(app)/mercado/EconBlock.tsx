import Link from "next/link";
import { bigMoney, FORMULA_VERSION, SCALES } from "@/lib/fin-rules";
import type { companyEconomics } from "@/lib/econ";
import { YearBars } from "@/components/EconCharts";

type Data = NonNullable<Awaited<ReturnType<typeof companyEconomics>>>;
type T = (es: string, en: string) => string;

/** Growth cell tint: blue up, red down, nothing near zero. The number itself is always in ink. */
export const growthTone = (g: number | null) => (g == null ? "" : g >= 10 ? "ec-up2" : g > 0 ? "ec-up1" : g <= -10 ? "ec-dn2" : g < 0 ? "ec-dn1" : "");

/** Economic intelligence of a company (§9.6): facts and trend, never a score. Prudent language. */
export function EconBlock({ d, t, lang, day }: { d: Data; t: T; lang: string; day: (x: Date) => string }) {
  const latest = d.c.snapshots[0];
  const num = (v: number) => new Intl.NumberFormat(lang === "EN" ? "en-US" : "es-CO", { maximumFractionDigits: 1 }).format(v);
  const fmt = (k: string, v: number) => (k === "currentRatio" ? `${num(v)}×` : `${num(v)} %`);
  const pc = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v)} %`);
  const money = (v: number | null) => bigMoney(latest.currency, v, lang);
  const rows = d.rows;
  const lastYear = rows[rows.length - 1]?.year;
  const sy = d.sector && lastYear ? d.sector.years[lastYear] : null;
  return (
    <div className="stack">
      <div className="grid cols-2">
        <div className="card">
          <b>{t("Lo que muestra la evidencia disponible", "What the available evidence shows")}</b>
          <p className="small">{t("Ingresos", "Revenue")}: <b>{money(latest.revenue == null ? null : Number(latest.revenue))}</b> (FY{latest.fiscalYear})</p>
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
                  <span className="src block">{Object.entries(m.inputs).map(([k, v]) => `${k}: ${typeof v === "number" && Math.abs(v) >= 1000 ? money(v) : v}`).join(" · ")}</span>
                </details>
              </li>
            ))}</ul>
          )}
        </div>
      </div>

      {rows.length > 1 && (
        <div className="card" id="patron">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{t(`Patrón de varios años · FY${rows[0].year}–FY${lastYear}`, `Multi-year pattern · FY${rows[0].year}–FY${lastYear}`)}</b>
            <Link href={`/mercado/economia/comparar?id=${d.c.id}`} className="small">{t("Comparar con otras empresas", "Compare with other companies")}</Link>
          </div>
          <YearBars label={t("Ingresos por año", "Revenue by year")} pts={rows.map((r) => ({ year: r.year, v: r.revenue, top: r.growth == null ? undefined : pc(r.growth), tip: `FY${r.year} · ${t("Ingresos", "Revenue")} ${money(r.revenue)}${r.growth == null ? "" : ` · ${pc(r.growth)} ${t("vs. año anterior", "vs. prior year")}`}` }))} />
          <span className="src block">{t("Barras: ingresos de cada año. Encima: cambio frente al año anterior.", "Bars: revenue each year. Above: change vs. the prior year.")}</span>
          {d.patterns.length > 0 && <ul className="mk-ul">{d.patterns.map((f) => <li key={f.es} className="small">{t(f.es, f.en)}</li>)}</ul>}
          {sy && (
            <p className="small">
              {t(`En su sector (${d.c.sector}), FY${lastYear}: ingresos comparables ${pc(sy.growth)} (mediana por empresa ${pc(sy.medGrowth)}); con utilidad ${sy.profitablePct ?? "—"} % de las empresas; margen neto mediano ${sy.medMargin == null ? "—" : `${num(sy.medMargin)} %`}.`, `In its sector (${d.c.sector}), FY${lastYear}: like-for-like revenue ${pc(sy.growth)} (median per company ${pc(sy.medGrowth)}); ${sy.profitablePct ?? "—"}% of companies profitable; median net margin ${sy.medMargin == null ? "—" : `${num(sy.medMargin)}%`}.`)}
              {" "}<Link href={`/mercado/economia/patrones?by=sector&only=${encodeURIComponent(d.c.sector!)}`}>{t("Ver el sector", "See the sector")}</Link>
              <span className="src block">{t("Contexto, no un ranking: «comparables» suma solo las empresas que reportaron ambos años.", "Context, not a ranking: “like-for-like” adds only companies that reported both years.")}</span>
            </p>
          )}
          <div className="mk-scroll">
            <table className="ec-tab">
              <thead><tr><th>{t("Año", "Year")}</th><th className="n">{t("Ingresos", "Revenue")}</th><th className="n">{t("vs. año anterior", "vs. prior year")}</th><th className="n">{t("Utilidad neta", "Net income")}</th><th className="n">{t("Margen neto", "Net margin")}</th><th className="n">{t("Patrimonio", "Equity")}</th><th className="n">{t("Pasivos / activos", "Liabilities / assets")}</th></tr></thead>
              <tbody>{[...rows].reverse().map((r) => (
                <tr key={r.year}>
                  <td>FY{r.year}</td><td className="n">{money(r.revenue)}</td><td className={`n ${growthTone(r.growth)}`}>{pc(r.growth)}</td><td className="n">{money(r.netIncome)}</td>
                  <td className="n">{r.margin == null ? "—" : `${num(r.margin)} %`}</td><td className="n">{money(r.equity)}</td><td className="n">{r.leverage == null ? "—" : `${num(r.leverage)} %`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      <details className="card flush mk-scroll" open={rows.length <= 1}>
        <summary style={{ padding: "10px 16px" }}>{t(`Todas las cifras guardadas y su fuente (${d.c.snapshots.length})`, `Every saved figure and its source (${d.c.snapshots.length})`)}</summary>
        <table>
          <thead><tr><th>{t("Año", "Year")}</th><th className="n">{t("Ingresos", "Revenue")}</th><th className="n">{t("Utilidad neta", "Net income")}</th><th className="n">{t("Activos", "Assets")}</th><th className="n">{t("Pasivos", "Liabilities")}</th><th className="n">{t("Patrimonio", "Equity")}</th><th>{t("Fuente", "Source")}</th></tr></thead>
          <tbody>{d.c.snapshots.map((s, n) => {
            const older = d.c.snapshots.findIndex((x) => x.fiscalYear === s.fiscalYear) !== n;
            const v = (x: unknown) => bigMoney(s.currency, x == null ? null : Number(x), lang);
            return (
              <tr key={s.id} className={older ? "muted" : ""}>
                <td>FY{s.fiscalYear}{older && <span className="src">{t("versión anterior", "earlier version")}</span>}</td>
                <td className="n">{v(s.revenue)}</td><td className="n">{v(s.netIncome)}</td><td className="n">{v(s.assets)}</td><td className="n">{v(s.liabilities)}</td><td className="n">{v(s.equity)}</td>
                <td className="small">{s.source.name}{s.import.reportYear ? ` · ${t(`publicación ${s.import.reportYear}`, `${s.import.reportYear} publication`)}` : ""}<span className="src">{s.import.fileName} · {t("en el archivo", "in the file")}: {t(SCALES[s.unitsScale]?.es ?? s.unitsScale, SCALES[s.unitsScale]?.en ?? s.unitsScale)}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
        <p className="src" style={{ padding: "6px 16px 10px" }}>{t("Si un año aparece en dos publicaciones, SOLU muestra la más reciente (puede traer cifras corregidas); la otra queda como versión anterior.", "If a year appears in two publications, SOLU shows the most recent one (it may carry corrected figures); the other stays as an earlier version.")}</p>
      </details>
    </div>
  );
}
