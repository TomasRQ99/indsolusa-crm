import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { MIN_SAMPLE, opsMetrics, type Metric } from "@/lib/ops-metrics";
import { Meter } from "@/components/Viz";

// Operaciones · metrics (module 11 §55–63). Facts with their counts; no ranking and nothing per person.

export default async function OpsMetricsPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { since, groups } = await opsMetrics();
  const show = (m: Metric) => {
    if (m.kind === "RATIO") {
      if (!m.den) return <span className="muted">{t("Sin casos todavía", "No cases yet")}</span>;
      if (m.den < MIN_SAMPLE) return <><b className="mono">{m.num} {t("de", "of")} {m.den}</b><span className="muted small"> · {t("pocos casos para un porcentaje", "too few cases for a percentage")}</span></>;
      return <span className="vz-meter-row"><span><b className="mono">{i.pct(((m.num ?? 0) / m.den) * 100)}</b><span className="muted small"> · {m.num} {t("de", "of")} {m.den}</span></span><Meter pct={((m.num ?? 0) / m.den) * 100} label={`${t(m.label.es, m.label.en)}: ${m.num} ${t("de", "of")} ${m.den}`} /></span>;
    }
    if (m.value == null || (!m.n && m.kind !== "COUNT")) return <span className="muted">{t("Sin casos todavía", "No cases yet")}</span>;
    if (m.kind === "DAYS") return <><b className="mono">{i.n2(m.value)} {t("días", "days")}</b><span className="muted small"> · {m.n} {t("casos", "cases")}{(m.n ?? 0) < MIN_SAMPLE ? ` · ${t("pocos casos", "few cases")}` : ""}</span></>;
    if (m.kind === "MONEY") return <><b className="mono">USD {m.value < 0 ? "−" : ""}{i.n2(Math.abs(m.value))}</b><span className="muted small"> · {m.n} {t("casos", "cases")}</span></>;
    return <b className="mono">{m.value}</b>;
  };
  return (
    <>
      <div className="ph"><div><h1>{t("Métricas de Operaciones", "Operations metrics")}</h1><p>{t(`Cómo funcionó la operación desde el ${i.day(since)}, contado de lo que quedó registrado. Cada cifra muestra de cuántos casos sale. No hay comparación entre personas.`, `How the operation worked since ${i.day(since)}, counted from what was recorded. Each figure shows how many cases it comes from. There is no comparison between people.`)}</p></div></div>
      {groups.map((g) => (
        <section className="card" key={g.key}>
          <b>{t(g.title.es, g.title.en).toUpperCase()}</b>
          <dl className="qv-dl">{g.metrics.map((m) => <div key={m.key} style={{ display: "contents" }}><dt>{t(m.label.es, m.label.en)}{m.note && <span className="src block">{t(m.note.es, m.note.en)}</span>}</dt><dd>{show(m)}</dd></div>)}</dl>
        </section>
      ))}
      <p className="src">{t("Aún sin medir: tiempo de requerimiento a orden, exposición de caja en días, exposición por tasa de cambio, variación del tránsito y costo de financiación. Necesitan datos o reglas que todavía no existen en SOLU.", "Not measured yet: requirement-to-order time, cash days funded, FX exposure, transit variance and financing cost. They need data or rules SOLU doesn't have yet.")}</p>
    </>
  );
}
