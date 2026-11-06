import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { daysBetween } from "@/lib/domain";
import { buildMiDia, type AgendaItem, type Need } from "@/lib/midia";
import { OutlookNote } from "@/components/OutlookNote";
import { Popovers } from "@/components/Popovers";
import { blockDone, defineNext, doneAndNext, logHappened, moveBlock, newPromise, postpone, removeBlock, reserveTime, scheduleMove, scheduleMoveAt } from "./actions";

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

export default async function MiDiaPage({ searchParams }: { searchParams: Promise<{ cal?: string; ok?: string; t?: string; d?: string }> }) {
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
          <Link className="btn secondary sm" href={n.context}>{t("Ver contexto", "See context")}</Link>
        </div>
      </div>
      <QuickActions n={n} />
    </article>
  );

  // ----- Quick actions on each card: act without leaving Mi Día -----
  const nowB = new Date(Date.now() - 5 * 3600e3); // Bogotá wall clock as UTC fields
  const todayStr = nowB.toISOString().slice(0, 10);
  const tomorrowStr = new Date(nowB.getTime() + 864e5).toISOString().slice(0, 10);
  const half = Math.ceil((nowB.getUTCHours() * 60 + nowB.getUTCMinutes() + 1) / 30) * 30;
  const nextSlot = half >= 17 * 60 || half < 8 * 60 ? "09:00" : `${String(Math.floor(half / 60)).padStart(2, "0")}:${String(half % 60).padStart(2, "0")}`;
  const slotDay = half >= 17 * 60 ? tomorrowStr : todayStr;
  const Dur = ({ v = 30 }: { v?: number }) => (
    <select name="minutes" defaultValue={String(v)} aria-label={t("Duración", "Duration")}>
      {[15, 30, 45, 60, 90, 120].map((x) => <option key={x} value={x}>{x < 60 ? `${x} min` : `${x / 60} h`.replace(".5", ",5")}</option>)}
    </select>
  );
  const QA = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
    <details className="qa">
      <summary className="qa-btn">{label}</summary>
      <div className={`qa-pop${wide ? " wide" : ""}`}>{children}</div>
    </details>
  );

  const QuickActions = ({ n }: { n: Need }) => {
    const j = n.journey;
    if (!j && !n.promise) return null;
    return (
      <div className="qa-bar" aria-label={t("Acciones rápidas", "Quick actions")}>
        {j && j.mode !== "none" && (
          <QA label={j.mode === "wait" ? t("✓ Ya llegó", "✓ It arrived") : t("✓ Hecho", "✓ Done")} wide>
            <form action={doneAndNext.bind(null, j.dealId)} className="qa-form">
              <b>{j.mode === "wait" ? t("Llegó lo que esperabas. ¿Qué sigue?", "What you waited for arrived. What's next?") : t("Hecho. ¿Qué sigue?", "Done. What's next?")}</b>
              <label>{t("Qué pasó (opcional)", "What happened (optional)")}<input name="note" placeholder={t("Ej.: aceptó el plazo, pide descuento", "E.g.: accepted the lead time, asks for a discount")} /></label>
              <label>{t("Siguiente movimiento", "Next move")}<input name="nextMove" placeholder={t("Ej.: enviar proforma a Carlos", "E.g.: send proforma to Carlos")} /></label>
              <label>{t("o quedo esperando a…", "or I'm now waiting for…")}<input name="waitingFor" placeholder={t("Ej.: OC del cliente", "E.g.: customer PO")} /></label>
              <label>{t("Para el / hasta el", "On / until")}<input name="nextDate" type="date" defaultValue={tomorrowStr} /></label>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </QA>
        )}
        {j && j.mode === "none" && (
          <QA label={t("Definir qué sigue", "Set what's next")} wide>
            <form action={defineNext.bind(null, j.dealId)} className="qa-form">
              <label>{t("Siguiente movimiento", "Next move")}<input name="nextMove" placeholder={t("Ej.: llamar a Marta y proponer visita", "E.g.: call Marta and propose a visit")} /></label>
              <label>{t("o quedo esperando a…", "or I'm waiting for…")}<input name="waitingFor" /></label>
              <label>{t("Para el / hasta el", "On / until")}<input name="nextDate" type="date" defaultValue={todayStr} /></label>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </QA>
        )}
        {n.schedule && (
          <QA label={n.schedule.scheduledAt ? t("Cambiar hora", "Change time") : t("Agendar", "Schedule")}>
            <div className="qa-form">
              {user.outlookConnectedAt && !n.schedule.scheduledAt && (
                <form action={scheduleMove.bind(null, n.schedule.dealId, n.schedule.title)}>
                  <button type="submit" className="wide">{t("Primer espacio libre de hoy", "First free slot today")}</button>
                </form>
              )}
              <form action={scheduleMoveAt.bind(null, n.schedule.dealId, n.schedule.title)} className="qa-form">
                <b>{t("o a esta hora", "or at this time")}</b>
                <div className="qa-row"><input name="date" type="date" defaultValue={slotDay} required /><input name="time" type="time" defaultValue={nextSlot} step={900} required /><Dur /></div>
                <button type="submit" className="secondary">{t("Agendar a esta hora", "Schedule at this time")}</button>
                {!user.outlookConnectedAt && <span className="src">{t("Queda en tu agenda de SOLU. ", "It stays in your SOLU agenda. ")}<Link href="/profile#outlook">{t("Conecta Outlook", "Connect Outlook")}</Link>{t(" para verlo también allá.", " to see it there too.")}</span>}
              </form>
            </div>
          </QA>
        )}
        {j && j.mode !== "none" && (
          <QA label={j.mode === "wait" ? t("Extender espera", "Extend wait") : t("Posponer", "Postpone")}>
            <form action={postpone.bind(null, j.dealId)} className="qa-form">
              <div className="qa-row">
                <button type="submit" name="days" value="1" className="secondary">{t("Mañana", "Tomorrow")}</button>
                <button type="submit" name="days" value="3" className="secondary">{t("En 3 días", "In 3 days")}</button>
                <button type="submit" name="days" value="7" className="secondary">{t("1 semana", "1 week")}</button>
              </div>
              <div className="qa-row"><input name="date" type="date" defaultValue={tomorrowStr} /><button type="submit">{t("A esa fecha", "To that date")}</button></div>
            </form>
          </QA>
        )}
        {j && (
          <QA label={t("Registrar lo que pasó", "Log what happened")}>
            <form action={logHappened.bind(null, j.dealId)} className="qa-form">
              <div className="qa-row">
                <select name="type" defaultValue="CALL" aria-label={t("Tipo", "Type")}>
                  <option value="CALL">{t("Llamada", "Call")}</option>
                  <option value="EMAIL">{t("Correo", "Email")}</option>
                  <option value="MEETING">{t("Reunión", "Meeting")}</option>
                  <option value="NOTE">{t("Nota", "Note")}</option>
                </select>
              </div>
              <input name="subject" required placeholder={t("Qué pasó, en una línea", "What happened, in one line")} />
              <button type="submit">{t("Registrar", "Log")}</button>
            </form>
          </QA>
        )}
        {n.promise && (
          <QA label={t("Registrar nueva promesa", "Record new promise")} wide>
            <form action={newPromise.bind(null, n.promise.invoiceId)} className="qa-form">
              <label>{t("Nueva fecha de pago", "New payment date")}<input name="promisedFor" type="date" defaultValue={tomorrowStr} required /></label>
              <label>{t("Quién lo promete", "Who promises")}<input name="promisedBy" defaultValue={n.promise.promisedBy} required /></label>
              <label>{t("Fuente", "Source")}<input name="source" required placeholder={t("Ej.: llamada de hoy", "E.g.: today's call")} /></label>
              <button type="submit">{t("Guardar promesa", "Save promise")}</button>
            </form>
          </QA>
        )}
      </div>
    );
  };

  // ----- Tu agenda: today + tomorrow, managed here -----
  const time = (d: Date) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);
  const inputDate = (d: Date) => new Date(d.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
  const AgendaRow = ({ a }: { a: AgendaItem }) => (
    <div className={`ag-row ${a.kind}`}>
      <span className="ag-time">{time(a.start)}<small>–{time(a.end)}</small></span>
      <span className="ag-title">
        {a.dealId ? <Link href={`/deals/${a.dealId}`}>{a.title}</Link> : a.title}
        <small>{a.kind === "solu" ? <>{t("Bloque SOLU", "SOLU block")}{a.purpose && a.purpose !== a.title ? ` · ${a.purpose}` : ""}</> : "Outlook"}</small>
        {a.flags?.map((f) => <small key={f} className="ag-flag">⚠ {f}</small>)}
      </span>
      <span className="ag-act">
        {a.kind === "solu" && a.taskId ? (
          <>
            <QA label={t("Mover", "Move")}>
              <form action={moveBlock.bind(null, a.taskId)} className="qa-form">
                <div className="qa-row"><input name="date" type="date" defaultValue={inputDate(a.start)} required /><input name="time" type="time" defaultValue={time(a.start)} step={900} required /><Dur v={a.minutes} /></div>
                <button type="submit">{t("Mover", "Move")}</button>
              </form>
            </QA>
            <form action={blockDone.bind(null, a.taskId)}><button type="submit" className="qa-btn">✓</button></form>
            <form action={removeBlock.bind(null, a.taskId)}><button type="submit" className="qa-btn" title={t("Quitar del calendario", "Remove from calendar")} aria-label={t("Quitar", "Remove")}>✕</button></form>
          </>
        ) : a.webLink ? (
          <a className="qa-btn" href={a.webLink} target="_blank" rel="noreferrer">{t("Abrir", "Open")}</a>
        ) : null}
      </span>
    </div>
  );

  const okMsg: Record<string, string> = {
    agendado: t(`Listo: quedó agendado a las ${sp.t ?? ""}.`, `Done: scheduled at ${sp.t ?? ""}.`),
    reservado: t(`Listo: reservaste tiempo a las ${sp.t ?? ""}.`, `Done: time reserved at ${sp.t ?? ""}.`),
    movido: t(`Listo: el bloque quedó a las ${sp.t ?? ""}.`, `Done: the block is now at ${sp.t ?? ""}.`),
    quitado: t("Listo: lo quitaste del calendario.", "Done: removed from the calendar."),
    "bloque-hecho": t("Bloque hecho. Si era el movimiento de un Journey, usa «✓ Hecho» en su tarjeta para decir qué sigue.", "Block done. If it was a Journey move, use \"✓ Done\" on its card to say what's next."),
    hecho: t("Listo: quedó registrado como hecho.", "Done: logged as done."),
    siguiente: t("Listo: el Journey ya tiene su siguiente movimiento.", "Done: the Journey has its next move."),
    espera: t("Listo: quedó como espera con control; SOLU te avisa en la fecha.", "Done: it's a controlled wait; SOLU will remind you on the date."),
    pospuesto: t(`Listo: pospuesto para el ${sp.d ? i.dateShort(new Date(`${sp.d}T00:00:00Z`)) : ""}.`, `Done: postponed to ${sp.d ? i.dateShort(new Date(`${sp.d}T00:00:00Z`)) : ""}.`),
    registrado: t("Listo: quedó registrado en el Journey.", "Done: logged on the Journey."),
    promesa: t("Listo: nueva promesa registrada; SOLU la vigila.", "Done: new promise recorded; SOLU watches it."),
    "sin-dato": t("Escribe el siguiente movimiento o lo que esperas.", "Write the next move or what you're waiting for."),
    "sin-fecha": t("Elige una fecha.", "Pick a date."),
  };

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
              <>{t("Hay ", m.needCount === 1 ? "There is " : "There are ")}<b>{m.needCount} {m.needCount === 1 ? t("situación", "situation") : t("situaciones", "situations")}</b>{t(" donde tu intervención puede cambiar un resultado hoy. ", m.needCount === 1 ? " where your move can change a result today. " : " where your move can change a result today. ")}</>
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
      {sp.ok && okMsg[sp.ok] && <div className={`note${sp.ok.startsWith("sin-") ? " attn" : " okn"}`} role="status">{okMsg[sp.ok]}</div>}
      <Popovers />

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
          {/* TU AGENDA — today and tomorrow, managed right here */}
          <section className="mblock" aria-labelledby="h-ag">
            <div className="bhead">
              <b id="h-ag">{t("TU AGENDA", "YOUR AGENDA")}</b>
              <span>{m.agenda.connected ? (m.agenda.error ? t("Outlook no respondió", "Outlook didn't respond") : t("sincronizada con Outlook", "synced with Outlook")) : t("solo SOLU · Outlook sin conectar", "SOLU only · Outlook not connected")}</span>
              <span className="grow" />
              <Link href="/mi-plan" className="small">{t("Ver semana", "See week")}</Link>
            </div>
            <div className="agenda">
              <div className="ag-day">{t("Hoy", "Today")}</div>
              {m.calendar.today.length ? m.calendar.today.map((a) => <AgendaRow key={a.key} a={a} />) : <p className="quiet-p">{t("Nada agendado hoy.", "Nothing scheduled today.")}</p>}
              {m.calendar.tomorrow.length > 0 && (
                <>
                  <div className="ag-day">{t("Mañana", "Tomorrow")}</div>
                  {m.calendar.tomorrow.map((a) => <AgendaRow key={a.key} a={a} />)}
                </>
              )}
              <details className="qa ag-add">
                <summary className="qa-btn">+ {t("Reservar tiempo", "Reserve time")}</summary>
                <div className="qa-pop wide">
                  <form action={reserveTime} className="qa-form">
                    <label>{t("Para qué", "What for")}<input name="title" required placeholder={t("Ej.: preparar oferta para Química Andina", "E.g.: prepare offer for Química Andina")} /></label>
                    <label>{t("Journey (opcional)", "Journey (optional)")}
                      <select name="dealId" defaultValue="">
                        <option value="">{t("— Ninguno —", "— None —")}</option>
                        {m.openDeals.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                      </select>
                    </label>
                    <div className="qa-row"><input name="date" type="date" defaultValue={slotDay} required aria-label={t("Fecha", "Date")} /><input name="time" type="time" defaultValue={nextSlot} step={900} required aria-label={t("Hora", "Time")} /><Dur /></div>
                    <button type="submit">{user.outlookConnectedAt ? t("Reservar en mi Outlook", "Reserve in my Outlook") : t("Reservar", "Reserve")}</button>
                  </form>
                </div>
              </details>
              {!user.outlookConnectedAt && <Link href="/profile#outlook" className="small">{t("Conectar Outlook para ver tus reuniones aquí", "Connect Outlook to see your meetings here")}</Link>}
            </div>
          </section>

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
                        <div className="fmeta">
                          <span className={`chip${f.window ? " win" : ""}`}>{f.chip}</span>
                          <span className="grow" />
                          <QA label={t("Reservar tiempo", "Reserve time")}>
                            <form action={reserveTime} className="qa-form">
                              <input type="hidden" name="title" value={`${f.link.label}: ${f.title}`} />
                              {f.link.href.startsWith("/deals/") && <input type="hidden" name="dealId" value={f.link.href.slice(7)} />}
                              <b>{f.link.label}</b>
                              <div className="qa-row"><input name="date" type="date" defaultValue={slotDay} required /><input name="time" type="time" defaultValue={nextSlot} step={900} required /><Dur /></div>
                              <button type="submit">{t("Reservar", "Reserve")}</button>
                            </form>
                          </QA>
                          <Link className="flink" href={f.link.href}>{f.link.label}</Link>
                        </div>
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
