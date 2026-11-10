import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { improvementFor, STEP_TEXT, type StepKey } from "@/lib/improvement";
import { IMPROVE_RULES, type Verdict } from "@/lib/focus-rules";

// Comercial C8c · Improvement Engine (v1.3 §61). One person at a time, against their own history. No score, no
// ranking; every line shows the counts it comes from. Visible to the person and management (C-01).

export default async function ImprovementPage({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manage = canManageAll(user);
  const people = manage ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const personId = manage && sp.u && people.some((p) => p.id === sp.u) ? sp.u : user.id;
  const person = personId === user.id ? user.name : people.find((p) => p.id === personId)!.name;
  const r = await improvementFor(personId);
  const tone: Record<Verdict, string> = { BETTER: "ok", WORSE: "risk", SAME: "wait", THIN: "wait" };
  const word: Record<Verdict, [string, string]> = { BETTER: ["Mejor que tu base", "Better than your baseline"], WORSE: ["Peor que tu base", "Worse than your baseline"], SAME: ["Igual que tu base", "Same as your baseline"], THIN: ["Pocos datos", "Too little data"] };
  const steps: StepKey[] = ["contactToNeed", "needToQuote", "quoteToPresentation", "presentationToDecision", "decisionToDeal", "esagara"];
  const days: StepKey[] = ["decideDays", "payDays"];
  const sugg = [
    ...steps.filter((k) => r.rates[k]?.verdict === "WORSE"),
    ...days.filter((k) => r[k as "decideDays" | "payDays"].verdict === "WORSE"),
  ];
  const wins = [...steps.filter((k) => r.rates[k]?.verdict === "BETTER"), ...days.filter((k) => r[k as "decideDays" | "payDays"].verdict === "BETTER")];
  const one = (x: number | null) => (x == null ? "—" : i.n(Math.round(x)));

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{personId === user.id ? t("Mi mejora", "My improvement") : t(`Mejora de ${person}`, `${person}'s improvement`)}</h1>
          <p>{t(`Los últimos ${IMPROVE_RULES.windowDays} días comparados con tus ${IMPROVE_RULES.windowDays * IMPROVE_RULES.baselineWindows} días anteriores, paso a paso por el camino Contacto → Necesidad → Cotización → Presentación → Decisión → Negocio → Eságara → Cobro. Sin puntajes ni comparación con otras personas.`, `The last ${IMPROVE_RULES.windowDays} days compared with your previous ${IMPROVE_RULES.windowDays * IMPROVE_RULES.baselineWindows} days, step by step along Contact → Need → Quote → Presentation → Decision → Deal → Eságara → Collection. No scores and no comparison with other people.`)}</p>
        </div>
      </div>
      {manage && (
        <form method="get" className="goal-pick" style={{ marginBottom: 10 }}>
          <label>{t("Persona", "Person")}<select name="u" defaultValue={personId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button type="submit" className="secondary">{t("Ver", "View")}</button>
        </form>
      )}

      <section className="card" id="sugerencias">
        <b>{t("Dónde mejorar", "Where to improve")}</b>
        {sugg.length === 0 ? <p className="small muted">{t("Ningún paso empeoró frente a tu propia historia (o aún hay pocos datos).", "No step got worse against your own history (or there's still little data).")}</p> : <ul className="mk-ul">{sugg.map((k) => <li key={k}><b>{t(STEP_TEXT[k].es, STEP_TEXT[k].en)}:</b> {t(STEP_TEXT[k].worse.es, STEP_TEXT[k].worse.en)}</li>)}</ul>}
        {wins.length > 0 && <><b className="small" style={{ display: "block", marginTop: 8 }}>{t("Lo que va mejor", "What's going better")}</b><ul className="mk-ul small">{wins.map((k) => <li key={k}>{t(STEP_TEXT[k].better.es, STEP_TEXT[k].better.en)}</li>)}</ul></>}
      </section>

      <section className="card" id="camino">
        <b>{t("Paso a paso, con la evidencia", "Step by step, with the evidence")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Paso", "Step")}</th><th>{t("Últimos 90 días", "Last 90 days")}</th><th>{t("Tu base", "Your baseline")}</th><th>{t("Lectura", "Reading")}</th></tr></thead>
          <tbody>
            {steps.map((k) => { const c = r.rates[k]!; const money = k === "esagara"; const per = k === "contactToNeed";
              const show = (x: number | null) => (per ? (x == null ? "—" : t(`${i.n2(x / 100)} por contacto`, `${i.n2(x / 100)} per contact`)) : i.pct(x)); return (
              <tr key={k}>
                <td>{t(STEP_TEXT[k].es, STEP_TEXT[k].en)}</td>
                <td className="mono small">{show(c.curPct)} <span className="muted">({money ? t(`${i.money(c.cur.num)} de ${i.money(c.cur.den)} · ${r.sample.accepted} aceptadas`, `${i.money(c.cur.num)} of ${i.money(c.cur.den)} · ${r.sample.accepted} accepted`) : `${c.cur.num} / ${c.cur.den}`})</span></td>
                <td className="mono small">{show(c.basePct)} <span className="muted">({money ? t(`${r.sample.acceptedBase} aceptadas`, `${r.sample.acceptedBase} accepted`) : `${c.base.num} / ${c.base.den}`})</span></td>
                <td><span className={`sig ${tone[c.verdict]}`}>{t(...word[c.verdict])}</span></td>
              </tr>
            ); })}
            {days.map((k) => { const c = r[k as "decideDays" | "payDays"]; return (
              <tr key={k}>
                <td>{t(STEP_TEXT[k].es, STEP_TEXT[k].en)}</td>
                <td className="mono small">{one(c.cur)} {t("días", "days")} <span className="muted">({t(`mediana de ${c.n}`, `median of ${c.n}`)})</span></td>
                <td className="mono small">{one(c.base)} {t("días", "days")} <span className="muted">({t(`mediana de ${c.nBase}`, `median of ${c.nBase}`)})</span></td>
                <td><span className={`sig ${tone[c.verdict]}`}>{t(...word[c.verdict])}</span></td>
              </tr>
            ); })}
          </tbody>
        </table></div>
        <p className="src">{t(`Se compara solo con al menos ${IMPROVE_RULES.minSample} casos en cada periodo, y solo se marca un cambio si es de ${IMPROVE_RULES.minDeltaPts}+ puntos y ${IMPROVE_RULES.minRelative * 100} %+ relativo. Reglas ${IMPROVE_RULES.version}.`, `Compared only with at least ${IMPROVE_RULES.minSample} cases in each period, and a change is only flagged at ${IMPROVE_RULES.minDeltaPts}+ points and ${IMPROVE_RULES.minRelative * 100} %+ relative. Rules ${IMPROVE_RULES.version}.`)}</p>
      </section>
    </>
  );
}
