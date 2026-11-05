import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { daysBetween } from "@/lib/domain";
import { buildMiDia, type Need } from "@/lib/midia";
import { OutlookNote } from "@/components/OutlookNote";
import { scheduleMove } from "./actions";

const Spark = ({ s = 12 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" /></svg>
);
const ToneIcon = ({ tone }: { tone: Need["tone"] }) =>
  tone === "risk" ? (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M6 1.5l4.8 8.5H1.2L6 1.5z" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M6 5v2.2" stroke="currentColor" strokeWidth="1.5" /></svg>
  ) : tone === "move" ? (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2 6h6.5M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><text x="6" y="10" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" fontFamily="sans-serif">?</text></svg>
  );

export default async function MiDiaPage({ searchParams }: { searchParams: Promise<{ cal?: string; agendado?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const m = await buildMiDia(user, i);

  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Bogota" }).format(new Date()));
  const hello = hour < 12 ? t("Buenos días", "Good morning") : hour < 19 ? t("Buenas tardes", "Good afternoon") : t("Buenas noches", "Good evening");
  const first = user.name.split(" ")[0];
  const toneLabel = { risk: t("Resultado en riesgo", "Result at risk"), move: t("Necesita movimiento", "Needs a move"), clarity: t("Necesita claridad", "Needs clarity") };

  const Card = ({ n }: { n: Need }) => (
    <article className="att">
      <div className="att-top">
        <span className={`tsig ${n.tone}`}><ToneIcon tone={n.tone} />{toneLabel[n.tone]}</span>
        <span className="due">{n.due.main}{n.due.sub && <small> · {n.due.sub}</small>}</span>
      </div>
      <div className="att-who"><b>{n.who.title}</b><span>{n.who.sub}</span></div>
      <dl className="key">
        <dt>{t("Por qué ahora", "Why now")}</dt><dd>{n.why.text}{n.why.src && <span className="src">{n.why.src}</span>}</dd>
        <dt>{t("Qué cambió", "What changed")}</dt><dd>{n.changed.text}{n.changed.src && <span className="src">{n.changed.src}</span>}</dd>
        <dt>{t("Impacto", "Impact")}</dt><dd>{n.impact.text}{n.impact.src && <span className="src">{n.impact.src}</span>}</dd>
      </dl>
      <div className="next">
        <div className="next-text">
          <div className="k">{t("Próximo movimiento", "Next move")}</div>
          <p>{n.next}</p>
          {n.schedule?.scheduledAt && (
            <span className="cal-note">{t(`En tu Outlook: ${i.dateShort(n.schedule.scheduledAt)}`, `In your Outlook: ${i.dateShort(n.schedule.scheduledAt)}`)} · {new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(n.schedule.scheduledAt)}</span>
          )}
        </div>
        <div className="actions">
          <Link className="btn sm" href={n.primary.href}>{n.primary.label}</Link>
          {n.schedule && !n.schedule.scheduledAt && user.outlookConnectedAt && (
            <form action={scheduleMove.bind(null, n.schedule.dealId, n.schedule.title)}>
              <button type="submit" className="secondary sm">{t("Agendar en Outlook", "Schedule in Outlook")}</button>
            </form>
          )}
          <Link className="btn secondary sm" href={n.context}>{t("Ver contexto", "See context")}</Link>
        </div>
      </div>
    </article>
  );

  // Minimal 21-day timeline for "Futuro".
  const pos = (d: Date) => Math.min(100, Math.max(0, (daysBetween(m.now, d) / 21) * 100));
  const firstWindow = m.future.find((f) => f.window);

  return (
    <div className="midia">
      <section className="greet">
        <div className="grow">
          <h1>{hello}, {first}.</h1>
          <p>
            {m.needCount === 0 ? (
              t("Nada requiere tu criterio hoy. ", "Nothing needs your judgment today. ")
            ) : (
              <>{t("Hay ", "There ")}<b>{m.needCount} {m.needCount === 1 ? t("situación", "situation") : t("situaciones", "situations")}</b>{t(" donde tu intervención puede cambiar un resultado hoy. ", m.needCount === 1 ? " where your move can change a result today. " : " where your move can change a result today. ")}</>
            )}
            <b>{m.controlledCount} {m.controlledCount === 1 ? "Journey" : "Journeys"}</b>
            {m.controlledCount === 1 ? t(" está avanzando o esperando con control.", " is moving or waiting under control.") : t(" están avanzando o esperando con control.", " are moving or waiting under control.")}
          </p>
        </div>
        <div className="agenda-line">
          {m.agenda.connected ? (
            m.agenda.error ? (
              <Link href="/profile#outlook" className="warn">{t("Outlook no respondió · revisar conexión", "Outlook didn't respond · check connection")}</Link>
            ) : (
              <>
                <span>{t("Outlook hoy", "Outlook today")}: <b>{m.agenda.todayCount}</b> {m.agenda.todayCount === 1 ? t("reunión", "meeting") : t("reuniones", "meetings")}</span>
                {m.agenda.next && <span className="muted"> · {t("próxima", "next")} {m.agenda.next.time} {m.agenda.next.subject}</span>}
              </>
            )
          ) : (
            <Link href="/profile#outlook">{t("Conectar mi calendario de Outlook", "Connect my Outlook calendar")}</Link>
          )}
        </div>
      </section>

      <OutlookNote code={sp.cal} t={t} />
      {sp.agendado && <div className="note" style={{ marginBottom: 16 }}>{t(`Listo: quedó en tu calendario de Outlook a las ${sp.agendado}.`, `Done: it's in your Outlook calendar at ${sp.agendado}.`)}</div>}

      <div className="cols">
        {/* 50 % — NECESITA DE TI */}
        <div className="col">
          <section className="mblock" aria-labelledby="h-need">
            <div className="bhead"><b id="h-need">{t("NECESITA DE TI", "NEEDS YOU")}</b><span>{t("tu criterio puede cambiar el resultado hoy", "your judgment can change the result today")}</span></div>
            {m.needs.length === 0 ? (
              <div className="att calm"><b>{t("Nada requiere tu criterio hoy", "Nothing needs your judgment today")}</b><span>{t("Buen momento para mover el futuro: lo que actúes antes sale más barato que reaccionar después.", "Good time to move the future: acting early costs less than reacting later.")}</span></div>
            ) : (
              m.needs.map((n) => <Card key={n.key} n={n} />)
            )}
            {m.moreNeeds.length > 0 && (
              <details className="more">
                <summary>{t(`${m.moreNeeds.length} situaciones más, de menor consecuencia`, `${m.moreNeeds.length} more situations, lower consequence`)}</summary>
                <div className="more-list">{m.moreNeeds.map((n) => <Card key={n.key} n={n} />)}</div>
              </details>
            )}
          </section>
        </div>

        <div className="col">
          {/* 20 % — FUTURO */}
          <section className="mblock" aria-labelledby="h-fut">
            <div className="bhead"><b id="h-fut">{t("FUTURO QUE VALE LA PENA MOVER", "FUTURE WORTH MOVING")}</b><span>{t("actuar antes mejora el resultado", "acting early improves the result")}</span></div>
            {m.future.length === 0 ? (
              <p className="quiet-p">{t("No hay ventanas que se cierren en las próximas 3 semanas.", "No windows closing in the next 3 weeks.")}</p>
            ) : (
              <>
                <div className="ftl" aria-hidden>
                  <div className="axis" />
                  {firstWindow && <div className="win" style={{ left: 0, width: `${pos(firstWindow.at)}%` }} />}
                  <div className="now" />
                  {m.future.map((f, k) => <div key={f.key} className="mk" style={{ left: `${pos(f.at)}%` }}>{k + 1}</div>)}
                  <span className="tick" style={{ left: 0, transform: "none" }}>{t("Hoy", "Today")} {i.day(m.now)}</span>
                  <span className="tick" style={{ left: "33.3%" }}>+7 d</span>
                  <span className="tick" style={{ left: "66.7%" }}>+14 d</span>
                  <span className="tick" style={{ left: "100%", transform: "translateX(-100%)" }}>+21 d</span>
                </div>
                <div className="fut">
                  {m.future.map((f, k) => (
                    <div className="fitem" key={f.key}>
                      <span className="num">{k + 1}</span>
                      <div>
                        <b>{f.title}</b>
                        <p>{f.text}</p>
                        <div className="fmeta"><span className={`chip${f.window ? " win" : ""}`}>{f.chip}</span><Link className="flink" href={f.link.href}>{f.link.label}</Link></div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* 15 % — ESPERANDO CON CONTROL */}
          <section className="mblock" aria-labelledby="h-wait">
            <div className="bhead"><b id="h-wait">{t("ESPERANDO CON CONTROL", "WAITING UNDER CONTROL")}</b><span>{t("SOLU vigila; no necesitas hacer nada", "SOLU watches; nothing for you to do")}</span></div>
            {m.waits.length > 0 ? (
              <details className="waits">
                <summary>
                  <span className="ok-dot" aria-hidden />
                  <span className="t">
                    <b>{t(`${m.waits.length} ${m.waits.length === 1 ? "espera vigilada" : "esperas vigiladas"} · ninguna vencida`, `${m.waits.length} watched wait(s) · none overdue`)}</b>
                    <span>{t(`Próxima revisión: ${i.dateShort(m.waits[0].until)}`, `Next check: ${i.dateShort(m.waits[0].until)}`)}</span>
                  </span>
                  <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
                </summary>
                <div className="wait">
                  {m.waits.map((w) => (
                    <Link className="wrow" key={w.key} href={w.href}>
                      <span><b>{w.what}</b> · {w.from}</span>
                      <span className="until">{i.dateShort(w.until)}</span>
                      <span className="trig">{w.trigger}</span>
                    </Link>
                  ))}
                </div>
              </details>
            ) : (
              <p className="quiet-p">{t("Nada está esperando a un tercero.", "Nothing is waiting on a third party.")}</p>
            )}
            {m.normal > 0 && <div className="quiet"><span className="hollow" aria-hidden />{m.normal === 1 ? t("1 Journey avanza normal y no requiere nada.", "1 Journey is moving normally and needs nothing.") : t(`${m.normal} Journeys avanzan normal y no requieren nada.`, `${m.normal} Journeys are moving normally and need nothing.`)}</div>}
          </section>

          {/* 10 % — SEÑALES */}
          {m.signals.length > 0 && (
            <section className="mblock" aria-labelledby="h-sig">
              <div className="bhead"><b id="h-sig">{t("SEÑALES", "SIGNALS")}</b><span>{t("pueden cambiar cómo negocias", "may change how you negotiate")}</span></div>
              <div className="sigl">
                {m.signals.map((s) => (
                  <div className="srow" key={s.key}>
                    <b>{s.inferred && <span className="infer"><Spark /> </span>}{s.href ? <Link href={s.href}>{s.title}</Link> : s.title}</b>
                    <p>{s.text}</p>
                    <span className="src">{s.src}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
