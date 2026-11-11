import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { systemPerformance } from "@/lib/gerencia-views";
import { fmtFig } from "../ui";

// Módulo 15 §20 · System performance. The result of a month says how much was sold; this says whether the company is
// getting better at each step of the path: generating, converting, earning, delivering, collecting and having the
// people to do it. The past is a baseline to learn from: no person is compared here and nothing is graded.

export default async function SystemPage() {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const p = await systemPerformance();
  const groups = [...new Set(p.rows.map((r) => r.dimension.es))];
  const reading = (key: string, trend: string) => {
    if (trend === "THIN") return { cls: "wait", text: t("Pocos datos para decir algo", "Too little data to say anything") };
    if (trend === "SAME") return { cls: "wait", text: t("Igual que antes", "Same as before") };
    if (p.neutral.has(key)) return { cls: "info", text: trend === "UP" ? t("Subió", "Went up") : t("Bajó", "Went down") };
    const better = p.lowerIsBetter.has(key) ? trend === "DOWN" : trend === "UP";
    return { cls: better ? "ok" : "attn", text: better ? t("Mejoró", "Improved") : t("Empeoró", "Got worse") };
  };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Desempeño del sistema", "System performance")}</h1>
        <p>{t("No es el resultado del mes: es si la empresa está mejorando su capacidad de generar, convertir, ganar, cumplir y cobrar. Los últimos 90 días frente a los 270 anteriores.", "Not the month's result: whether the company is improving its capacity to generate, convert, earn, deliver and collect. The last 90 days against the 270 before them.")}</p>
        <p className="small">{i.date(p.from)} – {i.date(p.to)} · {t("línea de base desde", "baseline from")} {i.date(p.baseFrom)} · {t("calculado", "as of")} {i.date(p.asOf)}</p>
      </div></div>
      {groups.map((g) => { const rows = p.rows.filter((r) => r.dimension.es === g); return (
        <section className="card" key={g} id={rows[0].key}>
          <b>{t(rows[0].dimension.es, rows[0].dimension.en).toUpperCase()}</b>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Qué", "What")}</th><th className="n">{t("Últimos 90 días", "Last 90 days")}</th><th className="n">{t("Antes", "Before")}</th><th>{t("Lectura", "Reading")}</th><th>{t("Casos", "Cases")}</th></tr></thead>
            <tbody>{rows.map((r) => { const rd = reading(r.key, r.trend); return (
              <tr key={r.key}>
                <td><Link href={r.href}>{t(r.title.es, r.title.en)}</Link><span className="src block">{t(r.how.es, r.how.en)}</span></td>
                <td className="n mono"><b>{fmtFig(i, r.unit, r.cur)}</b></td><td className="n mono">{fmtFig(i, r.unit, r.base)}</td>
                <td><span className={`sig ${rd.cls}`}>{rd.text}</span></td><td className="small">{t(r.sample.es, r.sample.en)}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        </section>
      ); })}
      <p className="src">{t("Cada lectura compara la empresa consigo misma. Con menos de 5 casos en cualquiera de los dos periodos SOLU dice «pocos datos» en vez de sacar una conclusión. Las ausencias y las coberturas se muestran como contexto de capacidad: que suban o bajen no es bueno ni malo por sí solo.", "Each reading compares the company with itself. With fewer than 5 cases in either period SOLU says \"too little data\" instead of drawing a conclusion. Absences and coverages are shown as capacity context: going up or down is neither good nor bad by itself.")}</p>
    </>
  );
}
