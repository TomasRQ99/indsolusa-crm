import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { METRICS } from "@/lib/metric-dictionary";

// Módulo 13 §9 · Metric Dictionary: every corporate metric with one definition, its formula, source and owner.

export default async function MetricDictionaryPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  return (
    <>
      <div className="ph"><div><h1>{t("Diccionario de métricas", "Metric dictionary")}</h1><p>{t("Cada cifra de SOLU tiene una sola definición: qué significa, cómo se calcula, de dónde sale, quién responde por ella y cuándo deja de moverse.", "Every figure in SOLU has one definition: what it means, how it is calculated, where it comes from, who answers for it and when it stops moving.")}</p></div></div>
      <section className="card">
        <div className="tscroll"><table>
          <thead><tr><th>{t("Métrica", "Metric")}</th><th>{t("Qué significa", "What it means")}</th><th>{t("Cómo se calcula", "How it is calculated")}</th><th>{t("Fuente y responsable", "Source and owner")}</th></tr></thead>
          <tbody>{Object.values(METRICS).map((m) => (
            <tr key={m.id}><td><b>{t(m.name.es, m.name.en)}</b><span className="src block mono">v{m.version} · {m.effectiveFrom}</span></td><td className="small">{t(m.definition.es, m.definition.en)}</td><td className="small">{t(m.formula.es, m.formula.en)}</td><td className="small">{t(m.source.es, m.source.en)}<span className="src block">{t(m.owner.es, m.owner.en)} · {t(m.closing.es, m.closing.en)}</span></td></tr>
          ))}</tbody>
        </table></div>
        <p className="src">{t("Todo va en USD antes de IVA. Lo registrado en otra moneda se muestra aparte y nunca se suma sin su conversión.", "Everything is in USD before VAT. What is recorded in another currency is shown apart and never added without its conversion.")}</p>
      </section>
    </>
  );
}
