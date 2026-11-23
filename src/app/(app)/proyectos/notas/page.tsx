import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { TEXT_MAX } from "@/lib/projects";
import { alarmForNote, createNote, deleteNote, noteToProject, toggleNote } from "../actions";

// PROYECTOS Y NOTAS → Mis notas. Something a person just wants to remember: only they see it. A note can carry an
// alarm for Mi Día, and it can grow into a project everyone sees.

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; hechas?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const showDone = sp.hechas === "1";
  const [notes, doneCount] = await Promise.all([
    db.project.findMany({
      where: { kind: "NOTE", createdById: user.id, ...(showDone ? {} : { closedAt: null }) }, orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], take: 200,
      include: { tasks: { where: { assigneeId: user.id, status: "OPEN" }, orderBy: { scheduledAt: "asc" }, select: { id: true, scheduledAt: true, dueDate: true, outlookEventId: true } } },
    }),
    db.project.count({ where: { kind: "NOTE", createdById: user.id, closedAt: { not: null } } }),
  ]);
  const now = today();
  const when = (d: Date) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);
  const okMsg: Record<string, string> = {
    nota: t("Nota guardada. Solo tú la ves.", "Note saved. Only you see it."),
    "nota-alarma": t("Nota guardada con su alarma: la verás en MI DÍA → Pendientes desde ya, y en «Tu agenda» de MI DÍA → Hoy cuando llegue el día.", "Note saved with its alarm: you will see it in MY DAY → To-dos from now, and in “Your agenda” in MY DAY → Today when the day comes."),
    "nota-alarma-outlook": t("Nota guardada con su alarma, en tu Mi Día y también en tu calendario de Outlook.", "Note saved with its alarm, in your My Day and also in your Outlook calendar."),
    alarma: t("Alarma puesta: la verás en MI DÍA → Pendientes desde ya, y en «Tu agenda» de MI DÍA → Hoy cuando llegue el día.", "Alarm set: you will see it in MY DAY → To-dos from now, and in “Your agenda” in MY DAY → Today when the day comes."),
    "alarma-outlook": t("Alarma puesta en tu Mi Día y también en tu calendario de Outlook.", "Alarm set in your My Day and also in your Outlook calendar."),
    "nota-hecha": t("Nota marcada como hecha. Sus alarmas se cerraron.", "Note marked as done. Its alarms were closed."),
    "nota-abierta": t("La nota volvió a quedar pendiente.", "The note is pending again."),
    "nota-borrada": t("Nota eliminada.", "Note deleted."),
  };
  const errMsg: Record<string, string> = {
    datos: t("Escribe qué quieres recordar. No se guardó nada.", "Write what you want to remember. Nothing was saved."),
    pasada: t("Ese día ya pasó: una alarma solo se pone de hoy en adelante.", "That day has passed: an alarm can only be set from today on."),
    "alarma-dia": t("Elige el día de la alarma.", "Choose the day of the alarm."),
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/proyectos">{t("Proyectos y notas", "Projects and notes")}</Link></div>
          <h1>{t("Mis notas", "My notes")}</h1>
          <p>{t("Lo que solo quieres recordar. Nadie más las ve. Ponle una alarma para que aparezca en tu Mi Día, o conviértela en proyecto cuando necesites a más personas.", "What you just want to remember. Nobody else sees them. Give one an alarm so it shows in your My Day, or turn it into a project when you need more people.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="nueva">
        <h2>{t("Escribir una nota", "Write a note")}</h2>
        <form action={createNote} className="pj-form">
          <label><span className="fname">1 · {t("¿Qué quieres recordar?", "What do you want to remember?")}</span><input name="title" required maxLength={TEXT_MAX.title} /></label>
          <label><span className="fname">2 · {t("Detalle (opcional)", "Detail (optional)")}</span><textarea name="summary" rows={2} maxLength={TEXT_MAX.note} /></label>
          <fieldset className="pj-set">
            <legend>3 · {t("Alarma en Mi Día (opcional)", "Alarm in My Day (optional)")}</legend>
            <div className="pj-dates two">
              <label>{t("Día", "Day")}<input type="date" name="day" min={dayInput(now)} /></label>
              <label>{t("Hora", "Time")}<input type="time" name="time" /></label>
            </div>
            <span className="src">{t("Sin día, la nota queda guardada sin alarma. Sin hora, la alarma queda a las 08:00.", "Without a day, the note is saved with no alarm. Without a time, the alarm is set for 08:00.")}</span>
          </fieldset>
          <button type="submit">{t("Guardar nota", "Save note")}</button>
        </form>
      </section>

      <section className="card" id="notas">
        <div className="pj-head"><b>{showDone ? t("TODAS MIS NOTAS", "ALL MY NOTES") : t("NOTAS PENDIENTES", "PENDING NOTES")}</b><span className="grow" />
          {showDone ? <Link href="/proyectos/notas#notas">{t("Ver solo pendientes", "See pending only")}</Link> : doneCount > 0 && <Link href="/proyectos/notas?hechas=1#notas">{t(`Ver también las hechas (${doneCount})`, `Also see done ones (${doneCount})`)}</Link>}
        </div>
        {notes.length === 0 ? <p className="small muted">{t("No tienes notas pendientes. ", "You have no pending notes. ")}<a href="#nueva">{t("Escribe una arriba", "Write one above")} →</a></p> : (
          <ul className="pj-notes">
            {notes.map((n) => (
              <li key={n.id} id={`n-${n.id}`} data-done={n.closedAt ? "1" : undefined}>
                <form action={toggleNote.bind(null, n.id)}><button type="submit" className="secondary sm" aria-label={n.closedAt ? t("Marcar pendiente", "Mark as pending") : t("Marcar hecha", "Mark as done")} title={n.closedAt ? t("Marcar pendiente", "Mark as pending") : t("Marcar hecha", "Mark as done")}>{n.closedAt ? "↺" : "✓"}</button></form>
                <div className="pj-nb">
                  <b>{n.title}</b>
                  {n.summary && <p className="pj-body">{n.summary}</p>}
                  <span className="src">{i.day(n.createdAt)} · {n.code}{n.closedAt ? ` · ${t("hecha", "done")}` : ""}</span>
                  {n.tasks.length > 0 && <div className="pj-acts">{n.tasks.map((a) => <span key={a.id} className="sig ok">{t("Alarma", "Alarm")}: {a.scheduledAt ? when(a.scheduledAt) : i.day(a.dueDate)}{a.outlookEventId ? ` · Outlook` : ""}</span>)}</div>}
                  {!n.closedAt && (
                    <div className="pj-acts">
                      <details className="pj-reply">
                        <summary>{t("Poner alarma", "Set alarm")}</summary>
                        <form action={alarmForNote.bind(null, n.id)} className="row">
                          <label>{t("Día", "Day")}<input type="date" name="day" required min={dayInput(now)} /></label>
                          <label>{t("Hora", "Time")}<input type="time" name="time" /></label>
                          <button type="submit" className="sm">{t("Guardar alarma", "Save alarm")}</button>
                        </form>
                      </details>
                      <form action={noteToProject.bind(null, n.id)} data-confirm={t("La nota pasa a ser un proyecto que todos ven. ¿Continuar?", "The note becomes a project everyone sees. Continue?")}><button type="submit" className="link small">{t("Convertir en proyecto", "Turn into a project")}</button></form>
                      <form action={deleteNote.bind(null, n.id)} data-confirm={t("¿Eliminar esta nota? No se puede deshacer.", "Delete this note? This can't be undone.")}><button type="submit" className="link small">{t("Eliminar", "Delete")}</button></form>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
