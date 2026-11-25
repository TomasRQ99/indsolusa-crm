"use client";

import { useState, type CSSProperties } from "react";
import { RATIO_FIELDS, RATIO_MAX, RECIPE_DEFAULTS, RECIPE_ROWS, recipeOf, shortMoney, type RecipeKey } from "@/lib/goal-recipe";

// Recetario mensual: the stepped chart of the owner's picture, drawn from what the person types (live), with what
// already happened this month at the right of each bar.

type Saved = { salesGoal: number; avgSale: number; quotesPerClose: number; meetingsPerQuote: number; pitchesPerMeeting: number; activitiesPerPitch: number } | null;

export default function Recetario({ es, name, saved, actual, avg12, workdays, canEdit, closed, action, savedBy, forOther }: {
  /** Written for someone else from EQUIPO → Organizar metas del equipo: the button doesn't say "mi". */
  forOther?: boolean;
  es: boolean; name: string; saved: Saved; actual: Partial<Record<RecipeKey, number>>; avg12: number | null; workdays: number;
  canEdit: boolean; closed: boolean; action: (fd: FormData) => void | Promise<void>; savedBy: string | null;
}) {
  const t = (a: string, b: string) => (es ? a : b);
  const [v, setV] = useState({
    salesGoal: saved ? String(saved.salesGoal) : "",
    avgSale: saved ? String(saved.avgSale) : "",
    quotesPerClose: String(saved?.quotesPerClose ?? RECIPE_DEFAULTS.quotesPerClose),
    meetingsPerQuote: String(saved?.meetingsPerQuote ?? RECIPE_DEFAULTS.meetingsPerQuote),
    pitchesPerMeeting: String(saved?.pitchesPerMeeting ?? RECIPE_DEFAULTS.pitchesPerMeeting),
    activitiesPerPitch: String(saved?.activitiesPerPitch ?? RECIPE_DEFAULTS.activitiesPerPitch),
  });
  const n = (s: string) => Number(s.replace(/,/g, ""));
  const ratio = (s: string) => { const x = Math.round(n(s)); return x >= 1 && x <= RATIO_MAX ? x : 1; };
  const r = recipeOf({ salesGoal: n(v.salesGoal), avgSale: n(v.avgSale), quotesPerClose: ratio(v.quotesPerClose), meetingsPerQuote: ratio(v.meetingsPerQuote), pitchesPerMeeting: ratio(v.pitchesPerMeeting), activitiesPerPitch: ratio(v.activitiesPerPitch) }, workdays);
  const changed = !saved || ["salesGoal", "avgSale", "quotesPerClose", "meetingsPerQuote", "pitchesPerMeeting", "activitiesPerPitch"].some((k) => n(v[k as keyof typeof v]) !== saved[k as keyof NonNullable<Saved>]);
  const fmtN = new Intl.NumberFormat(es ? "es-CO" : "en-US", { maximumFractionDigits: 0 });
  const show = (k: RecipeKey, x: number, money?: boolean) => (money ? shortMoney(x) : fmtN.format(x));
  const last = RECIPE_ROWS.length - 1;

  return (
    <section className="card rc" id="recetario">
      <div className="rc-head">
        <span className="rc-pill">{t("RECETARIO MENSUAL", "MONTHLY RECIPE")} · {name.toUpperCase()}</span>
        {saved && !changed && savedBy && <span className="src">{t(`Guardado por ${savedBy}`, `Saved by ${savedBy}`)}</span>}
        {changed && r && <span className="sig attn">{t("Vista previa: todavía sin guardar", "Preview: not saved yet")}</span>}
      </div>
      {!r ? (
        <p className="rc-empty">{t("Escribe abajo tu meta de ventas del mes y el valor de tu venta promedio: SOLU calcula cuántos negocios, cotizaciones, reuniones y actividades de prospección necesitas, y arma tu recetario.", "Type your sales goal for the month and your average sale below: SOLU works out how many deals, quotes, meetings and prospecting activities you need, and builds your recipe.")}</p>
      ) : (
        <ol className="rc-steps" aria-label={t("Recetario mensual", "Monthly recipe")}>
          {RECIPE_ROWS.map((row, idx) => {
            const val = r[row.k];
            const got = actual[row.k];
            const ratioN = row.ratio ? ratio(v[row.ratio]) : null;
            return (
              <li key={row.k} className={`rc-row${idx === 0 ? " top" : idx === last ? " end" : ""}`} style={{ "--i": idx } as CSSProperties} data-k={row.k}>
                <b className="rc-num" title={row.money ? `USD ${fmtN.format(val)}` : undefined}>{show(row.k, val, row.money)}</b>
                <span className="rc-label">
                  {t(row.label.es, row.label.en)}
                  {ratioN != null && <span className="rc-ratio"> ({t(`1 de ${ratioN}`, `1 of ${ratioN}`)})</span>}
                  {row.k === "daily" && <span className="rc-ratio"> · {t(`${workdays} días hábiles`, `${workdays} working days`)}</span>}
                </span>
                {got != null && (
                  <span className="rc-got">{row.k === "daily" ? t("Hoy", "Today") : t("Llevas", "So far")} <b>{show(row.k, got, row.money)}</b></span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {r && (
        <details className="rc-how">
          <summary className="small">{t("Cómo se cuenta lo que llevas", "How «so far» is counted")}</summary>
          <ul className="mk-ul small">
            <li>{t("Ventas y negocios cerrados: cotizaciones aceptadas en el mes, en tus Necesidades (valor de venta protegido). La venta promedio es la de esos negocios.", "Sales and closed deals: quotes accepted this month on your Needs (protected sale value). The average is that of those deals.")}</li>
            <li>{t("Cotizaciones: Necesidades tuyas con una cotización presentada en el mes (una revisión no cuenta otra vez).", "Quotes: your Needs with a quote presented this month (a revision doesn't count again).")}</li>
            <li>{t("Primeras reuniones: clientes con una reunión o visita realizada que registraste en el mes y que no habían tenido ninguna antes.", "First meetings: customers with a meeting or visit you logged as held this month and that had none before.")}</li>
            <li>{t("Speech a tomadores de decisión: contactos que registraste marcados «Supe quién decide».", "Pitches to decision makers: contacts you logged marked «Learned who decides».")}</li>
            <li>{t("Actividades de prospección: llamadas (también sin respuesta), correos y reuniones que registraste; una reunión que se está organizando o se canceló no cuenta.", "Prospecting activities: calls (unanswered too), emails and meetings you logged; a meeting being arranged or cancelled doesn't count.")}</li>
          </ul>
        </details>
      )}
      {canEdit && !closed && (
        <form action={action} className="qa-form cols rc-form">
          <label>{t("Meta de ventas del mes (USD)", "Sales goal for the month (USD)")}
            <input name="salesGoal" type="number" min={1} step="0.01" required value={v.salesGoal} onChange={(e) => setV({ ...v, salesGoal: e.target.value })} />
          </label>
          <label>{t("Valor de tu venta promedio (USD)", "Your average sale (USD)")}
            <input name="avgSale" type="number" min={1} step="0.01" required value={v.avgSale} onChange={(e) => setV({ ...v, avgSale: e.target.value })} />
          </label>
          {RATIO_FIELDS.map((f) => (
            <label key={f.k}>{t(f.label.es, f.label.en)}
              <input name={f.k} type="number" min={1} max={RATIO_MAX} step={1} required value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />
            </label>
          ))}
          {avg12 != null && <span className="src block wide rc-avg">{t(`Tu venta promedio real de los últimos 12 meses: USD ${fmtN.format(avg12)}`, `Your real average sale over the last 12 months: USD ${fmtN.format(avg12)}`)} · <button type="button" className="linklike" onClick={() => setV({ ...v, avgSale: String(avg12) })}>{t("Usar este valor", "Use this value")}</button></span>}
          <button type="submit">{forOther ? t("Guardar el recetario", "Save the recipe") : t("Guardar mi recetario", "Save my recipe")}</button>
          <span className="src block wide">{t("La gráfica cambia mientras escribes. Las cuatro proporciones vienen en 2, 2, 3 y 3; cámbialas por las tuyas. Cada mes tiene su propio recetario.", "The chart changes as you type. The four ratios start at 2, 2, 3 and 3; change them to yours. Each month has its own recipe.")}</span>
        </form>
      )}
      {closed && !saved && <p className="small muted">{t("Este mes ya cerró y no tuvo recetario.", "This month is closed and had no recipe.")}</p>}
      {!canEdit && !saved && !closed && <p className="small muted">{t("Esta persona todavía no ha escrito su recetario de este mes.", "This person hasn't written their recipe for this month yet.")}</p>}
    </section>
  );
}
