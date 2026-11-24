import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { buildCaseCalendar, type CalEvent, type CalTone } from "@/lib/case-calendar";

// CALENDARIO DE CASOS: one month at a time. A past day shows what happened and where each case stood that day;
// a future day shows what is due, where each case should be by then, and the deadlines SOLU recommends.

export default async function CaseCalendarPage({ searchParams }: { searchParams: Promise<{ m?: string; d?: string; eq?: string }> }) {
  const [sp, user] = await Promise.all([searchParams, requireUser()]);
  const i = makeI18n(user.lang);
  const { t } = i;
  const c = await buildCaseCalendar(user, i, { month: sp.m, day: sp.d, team: sp.eq === "1" });
  const href = (o: { m?: string; d?: string; eq?: boolean }) => {
    const q = new URLSearchParams();
    if (o.d) q.set("d", o.d); else q.set("m", o.m ?? c.month);
    if (o.eq ?? c.team) q.set("eq", "1");
    return `/mi-dia/calendario?${q}`;
  };
  const monthName = new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(c.first);
  const dayName = new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(c.sel);
  const week = i.es ? ["L", "M", "X", "J", "V", "S", "D"] : ["M", "T", "W", "T", "F", "S", "S"];
  const TONE: Record<CalTone, { sig: string; label: string }> = {
    fact: { sig: "wait", label: t("Pasó", "Happened") },
    done: { sig: "ok", label: t("Cumplido", "Kept") },
    missed: { sig: "risk", label: t("No se cumplió", "Not kept") },
    ahead: { sig: "info", label: t("Compromiso", "Commitment") },
    rec: { sig: "attn", label: t("Plazo recomendado", "Recommended deadline") },
  };
  const Line = ({ e }: { e: CalEvent }) => (
    <li>
      <span className={`sig ${TONE[e.tone].sig}`}>{e.kind === "recommended" && e.tone !== "rec" ? `${t("Plazo recomendado", "Recommended deadline")} · ${TONE[e.tone].label}` : TONE[e.tone].label}</span>
      <span className="cc-t"><Link href={e.href}>{e.text}</Link>{e.note && <span className="src">{e.note}</span>}</span>
    </li>
  );
  const nothing = c.cases.length === 0 && c.loose.length === 0;

  return (
    <div className="cc">
      <div className="ph">
        <div>
          <h1>{t("Calendario de casos", "Case calendar")}</h1>
          <p>{t("Lo que pasó y lo que viene en tus casos, día por día. Un día pasado muestra en qué estaba cada caso ese día; un día futuro, en qué debería estar y los plazos que SOLU recomienda.", "What happened and what is coming in your cases, day by day. A past day shows where each case stood that day; a future day, where it should be and the deadlines SOLU recommends.")}</p>
        </div>
        <span className="grow" />
        {c.canTeam && (
          <nav className="seg" aria-label={t("De quién", "Whose")}>
            <Link href={href({ d: c.selIso, eq: false })} className={!c.team ? "on" : undefined} aria-current={!c.team ? "true" : undefined}>{t("Mío", "Mine")}</Link>
            <Link href={href({ d: c.selIso, eq: true })} className={c.team ? "on" : undefined} aria-current={c.team ? "true" : undefined}>{t("Equipo", "Team")}</Link>
          </nav>
        )}
      </div>

      <div className="cc-two">
        <section className="card cc-month" aria-label={monthName}>
          <div className="cc-nav">
            <Link className="btn secondary sm" href={href({ m: c.prevMonth })}>{t("← Mes anterior", "← Previous month")}</Link>
            <b>{monthName.charAt(0).toUpperCase() + monthName.slice(1)}</b>
            <Link className="btn secondary sm" href={href({ m: c.nextMonth })}>{t("Mes siguiente →", "Next month →")}</Link>
          </div>
          {c.month !== c.thisMonth && <p className="cc-back"><Link href={href({ d: c.today })}>{t("Volver a hoy", "Back to today")}</Link></p>}
          <div className="cc-grid" role="grid">
            {week.map((w, k) => <span key={k} className="cc-wd" role="columnheader">{w}</span>)}
            {c.cells.map((x, k) => x === null ? <span key={`e${k}`} /> : (
              <Link key={x.day} href={href({ d: x.day })} scroll={false} role="gridcell" className={`cc-day${x.selected ? " on" : ""}${x.today ? " today" : ""}${x.past ? " past" : ""}`} aria-current={x.selected ? "date" : undefined}
                title={[x.missed && t(`${x.missed} no se cumplió`, `${x.missed} not kept`), x.ahead && t(`${x.ahead} compromisos`, `${x.ahead} commitments`), x.rec && t(`${x.rec} plazos recomendados`, `${x.rec} recommended deadlines`), x.done && t(`${x.done} cumplidos`, `${x.done} kept`), x.facts && t(`${x.facts} hechos`, `${x.facts} facts`)].filter(Boolean).join(" · ") || t("Sin registros", "Nothing recorded")}>
                <b>{x.n}</b>
                <span className="cc-dots" aria-hidden>
                  {x.missed > 0 && <i data-t="missed">{x.missed}</i>}
                  {x.ahead > 0 && <i data-t="ahead">{x.ahead}</i>}
                  {x.rec > 0 && <i data-t="rec">{x.rec}</i>}
                  {x.done > 0 && <i data-t="done">{x.done}</i>}
                  {x.facts > 0 && <i data-t="fact">{x.facts}</i>}
                </span>
              </Link>
            ))}
          </div>
          <ul className="cc-legend">
            <li><i data-t="missed" />{t("No se cumplió", "Not kept")}</li>
            <li><i data-t="ahead" />{t("Compromiso con fecha", "Dated commitment")}</li>
            <li><i data-t="rec" />{t("Plazo recomendado por SOLU", "Deadline recommended by SOLU")}</li>
            <li><i data-t="done" />{t("Cumplido", "Kept")}</li>
            <li><i data-t="fact" />{t("Algo que pasó", "Something that happened")}</li>
          </ul>
          <p className="src">{t(`En ${monthName}: ${c.totals.facts} hechos registrados, ${c.totals.ahead} compromisos por delante, ${c.totals.missed} que no se cumplieron y ${c.totals.rec} plazos recomendados.`, `In ${monthName}: ${c.totals.facts} recorded facts, ${c.totals.ahead} commitments ahead, ${c.totals.missed} not kept and ${c.totals.rec} recommended deadlines.`)}</p>
        </section>

        <section className="card cc-daybox" id="dia" aria-live="polite">
          <b>{dayName.toUpperCase()}</b>
          <p className="cc-mode">{c.isToday ? <span className="sig info">{t("Hoy", "Today")}</span> : c.future ? <span className="sig attn">{t("Día futuro: dónde deberías estar", "Future day: where you should be")}</span> : <span className="sig wait">{t("Día pasado: qué pasó y en qué estaba cada caso", "Past day: what happened and where each case stood")}</span>}</p>
          {nothing ? (
            <p className="quiet-p">{c.future ? t("No hay compromisos ni plazos para este día. ", "No commitments or deadlines for this day. ") : t("No hay nada registrado este día. ", "Nothing is recorded on this day. ")}<Link href="/deals">{t("Ver las Necesidades", "See Needs")}</Link></p>
          ) : (
            <>
              {c.cases.map((k) => (
                <article className="cc-case" key={k.dealId}>
                  <header>
                    <Link href={k.href}><b>{k.code}</b> {k.who}</Link>
                    <span className="src">{k.title.slice(0, 90)}{c.team ? ` · ${k.owner}` : ""}</span>
                  </header>
                  <p className="cc-state">
                    {c.isToday
                      ? <>{t("Hoy está en: ", "Today it is at: ")}<b>{k.now}</b></>
                      : c.future
                        ? <>{t("Para ese día debería estar en: ", "By that day it should be at: ")}<b>{k.then}</b>{k.changed ? <> · {t("hoy está en: ", "today it is at: ")}<b>{k.now}</b></> : <> · {t("es donde está hoy", "that is where it is today")}</>}</>
                        : <>{t("Ese día estaba en: ", "That day it was at: ")}<b>{k.then}</b>{k.changed ? <> · {t("hoy está en: ", "today it is at: ")}<b>{k.now}</b></> : <> · {t("sigue ahí hoy", "still there today")}</>}</>}
                    {k.over && <> <span className="sig wait">{k.over}</span></>}
                  </p>
                  <ul className="cc-lines">{k.events.map((e) => <Line key={e.key} e={e} />)}</ul>
                </article>
              ))}
              {c.loose.length > 0 && (
                <article className="cc-case">
                  <header><b>{t("Pendientes sin Necesidad", "To-dos without a Need")}</b></header>
                  <ul className="cc-lines">{c.loose.map((e) => <Line key={e.key} e={e} />)}</ul>
                </article>
              )}
            </>
          )}
          <p className="src">{t("Los plazos recomendados son calculados por SOLU a partir de la fecha prometida al cliente; cada uno dice cómo se calculó. No reemplazan la fecha que confirme el proveedor.", "Recommended deadlines are calculated by SOLU from the date promised to the customer; each one says how it was calculated. They do not replace the date the supplier confirms.")}</p>
        </section>
      </div>
    </div>
  );
}
