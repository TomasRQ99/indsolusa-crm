import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { ACTION_KINDS, DIMS, MEETING_KINDS, type Dim } from "@/lib/team-rules";
import { meetingAgenda } from "@/lib/team-views";
import { Notes, tOf } from "../../ui";
import { addCommitment, cancelMeeting, closeMeeting, moveMeeting } from "../../actions";

// Módulo 16 §6 · one conversation. Before: the agenda, built from earlier commitments, new evidence and current
// focus. During: commitments are written with what will show them and by when. At the close: the next conversation,
// or the reason there is none. Only the two people in it can open this page.

type Snapshot = { commitments?: { what: string; dueOn: string; owner: string }[]; focus?: { dimension: string; title: string; nextMovement: string; newEvidence: number }[]; feedbackSince?: number };

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const { id } = await params;
  const sp = await searchParams;
  const m = await db.developmentMeeting.findUnique({ where: { id }, include: { user: { select: { id: true, name: true } }, with: { select: { id: true, name: true } } } });
  if (!m || !(m.userId === user.id || m.withId === user.id)) notFound();
  const T = today();
  const planned = m.status === "PLANNED";
  const [agenda, made, next] = await Promise.all([
    planned ? meetingAgenda(m) : null,
    db.developmentCommitment.findMany({ where: { meetingId: m.id }, orderBy: { dueOn: "asc" }, include: { owner: { select: { name: true } } } }),
    m.nextMeetingId ? db.developmentMeeting.findUnique({ where: { id: m.nextMeetingId }, select: { id: true, scheduledOn: true, status: true } }) : null,
  ]);
  const snap = (m.agenda ?? null) as Snapshot | null;
  const back = `/equipo/reuniones/${m.id}`;
  const dev = `/equipo/desarrollo${m.userId === user.id ? "" : `?p=${m.userId}`}`;
  const ok = { programada: t("Conversación programada.", "Conversation scheduled."), cerrada: t("Conversación cerrada. La agenda quedó guardada como estaba.", "Conversation closed. The agenda was kept as it stood."), cancelada: t("Conversación cancelada.", "Conversation cancelled."), movida: t("Fecha cambiada.", "Date changed."), compromiso: t("Compromiso registrado.", "Commitment recorded.") };
  const err = {
    estado: t("Esta conversación ya no está abierta.", "This conversation is no longer open."),
    siguiente: t("Antes de cerrar, programa la próxima conversación o escribe por qué no hace falta. No se cerró.", "Before closing, schedule the next conversation or write why none is needed. It was not closed."),
    fechas: t("Revisa las fechas: la conversación no puede ser futura y la próxima debe ser posterior.", "Check the dates: the conversation can't be in the future and the next one must be later."),
    cancelar: t("Escribe por qué se cancela.", "Write why it is cancelled."),
    compromiso: t("Faltan datos del compromiso: qué se hará, qué lo mostrará, para cuándo y quién.", "Commitment data is missing: what will be done, what will show it, by when and who."),
    permiso: t("No tienes permiso para esto.", "You don't have permission for this."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <div className="crumb"><Link href="/equipo/reuniones">{t("Conversaciones de desarrollo", "Development conversations")}</Link></div>
        <h1>{tx(MEETING_KINDS[m.kind] ?? MEETING_KINDS.ONE_ON_ONE)}{m.checkpointDay != null ? ` · ${t("día", "day")} ${m.checkpointDay}` : ""}: {m.user.name} {t("con", "with")} {m.with.name}</h1>
        <p>{planned ? i.date(m.scheduledOn) : m.status === "HELD" ? t(`Realizada el ${i.date(m.heldOn)}`, `Held on ${i.date(m.heldOn)}`) : t("Cancelada", "Cancelled")} <span className={`sig ${planned ? (m.scheduledOn < T ? "attn" : "info") : m.status === "HELD" ? "ok" : "wait"}`} style={{ marginLeft: 6 }}>{planned ? (m.scheduledOn < T ? t("su fecha ya pasó", "its date has passed") : t("programada", "scheduled")) : m.status === "HELD" ? t("cerrada", "closed") : t("cancelada", "cancelled")}</span></p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />

      {agenda && (
        <section className="card" id="agenda"><b>{t("AGENDA", "AGENDA")}</b> <span className="small muted">{agenda.lastHeld ? t(`desde la última conversación, el ${i.day(agenda.lastHeld)}`, `since the last conversation, on ${i.day(agenda.lastHeld)}`) : t("primera conversación registrada entre los dos", "first conversation on record between the two")}</span>
          <h3>{t("Compromisos pendientes", "Pending commitments")}</h3>
          {agenda.commitments.length === 0 ? <p className="small muted">{t("Ninguno pendiente.", "None pending.")}</p> : <ul className="plain">{agenda.commitments.map((c) => <li key={c.id}><span className={`sig ${c.dueOn < T ? "attn" : "wait"}`}>{c.dueOn < T ? t("vencido", "overdue") : i.day(c.dueOn)}</span> <b>{c.owner.name}</b>: {c.what}<span className="src block">{t("Lo mostrará", "It will be shown by")}: {c.expectedEvidence}</span></li>)}</ul>}
          <h3>{t("Foco actual y evidencia nueva", "Current focus and new evidence")}</h3>
          {!agenda.plan ? <p className="small muted">{t("Sin ciclo de desarrollo activo: un buen primer tema.", "No active development cycle: a good first topic.")} <Link href={dev}>{t("Abrir el ciclo", "Open the cycle")}</Link></p> : agenda.plan.objectives.length === 0 ? <p className="small muted">{t("El ciclo aún no tiene objetivos compartidos.", "The cycle has no shared objectives yet.")}</p> : (
            <ul className="plain">{agenda.plan.objectives.map((o) => <li key={o.id}><span className="sig info">{tx(DIMS[o.dimension as Dim] ?? DIMS.SER)}</span> <Link href={`${dev}#o-${o.id}`}>{o.title}</Link>{o.reviewOn < T ? <span className="sig attn" style={{ marginLeft: 6 }}>{t("pasó su revisión", "past its review")}</span> : null}
              <span className="src block">{t("Próximo movimiento", "Next movement")}: {o.nextMovement} · {t("evidencia esperada", "expected evidence")}: {o.expectedEvidence}</span>
              {o.evidence.length ? o.evidence.map((e, k) => <span key={k} className="src block">＋ {e.what} · {i.day(e.observedOn)} · {e.addedByName}</span>) : <span className="src block">{t("Sin evidencia nueva desde la última conversación.", "No new evidence since the last conversation.")}</span>}</li>)}</ul>
          )}
          {agenda.feedbackSince > 0 && <p className="small">{t(`${agenda.feedbackSince} feedback recibido(s) desde entonces.`, `${agenda.feedbackSince} feedback received since then.`)} <Link href="/equipo/feedback">{t("Ver", "See")}</Link></p>}
          <p className="src">{t("La agenda se arma sola con lo que ya está registrado; nadie tiene que escribirla.", "The agenda builds itself from what is already on record; nobody has to write it.")}</p>
        </section>
      )}

      {!planned && snap && (
        <section className="card" id="agenda"><b>{t("AGENDA COMO ESTABA AL CERRAR", "AGENDA AS IT STOOD AT THE CLOSE")}</b>
          {(snap.commitments ?? []).length > 0 && <><h3>{t("Compromisos pendientes ese día", "Commitments pending that day")}</h3><ul className="plain">{snap.commitments!.map((c, k) => <li key={k}><b>{c.owner}</b>: {c.what} <span className="src">· {i.day(new Date(c.dueOn))}</span></li>)}</ul></>}
          {(snap.focus ?? []).length > 0 && <><h3>{t("Foco", "Focus")}</h3><ul className="plain">{snap.focus!.map((o, k) => <li key={k}><span className="sig info">{tx(DIMS[o.dimension as Dim] ?? DIMS.SER)}</span> {o.title} <span className="src">· {t("próximo movimiento", "next movement")}: {o.nextMovement} · {t(`${o.newEvidence} evidencia(s) nueva(s)`, `${o.newEvidence} new evidence`)}</span></li>)}</ul></>}
        </section>
      )}

      {m.status === "HELD" && (
        <section className="card" id="notas"><b>{t("LO CONVERSADO", "WHAT WAS DISCUSSED")}</b>
          <p className="small gm-pre">{m.notes ?? <span className="muted">{t("Sin notas.", "No notes.")}</span>}</p>
          <p className="small">{next ? <>{t("Próxima conversación", "Next conversation")}: <Link href={`/equipo/reuniones/${next.id}`}>{i.date(next.scheduledOn)}</Link></> : <>{t("Sin próxima conversación", "No next conversation")}: {m.noNextReason}</>} <span className="src">· {t("cerró", "closed by")} {m.closedByName}</span></p>
        </section>
      )}
      {m.status === "CANCELLED" && <p className="small">{t("Motivo", "Reason")}: {m.cancelReason}</p>}

      <section className="card" id="compromisos"><b>{t("COMPROMISOS DE ESTA CONVERSACIÓN", "COMMITMENTS FROM THIS CONVERSATION")}</b>
        {made.length === 0 ? <p className="small muted">{t("Ninguno todavía.", "None yet.")}</p> : <ul className="plain">{made.map((c) => <li key={c.id}><span className={`sig ${c.status === "OPEN" ? "info" : c.status === "DONE" ? "ok" : "wait"}`}>{c.status === "OPEN" ? i.day(c.dueOn) : c.status === "DONE" ? t("cumplido", "kept") : t("retirado", "dropped")}</span> <span className="sig wait">{tx(ACTION_KINDS[c.kind] ?? ACTION_KINDS.PRACTICE)}</span> <b>{c.owner.name}</b>: {c.what}<span className="src block">{t("Lo mostrará", "It will be shown by")}: {c.expectedEvidence}</span></li>)}</ul>}
        {m.status !== "CANCELLED" && (
          <details open={sp.err === "compromiso"}><summary className="small">{t("Agregar un compromiso", "Add a commitment")}</summary>
            <form action={addCommitment.bind(null, m.userId)} className="qa-form">
              <input type="hidden" name="back" value={back} /><input type="hidden" name="meetingId" value={m.id} />
              <div className="qa-row">
                <label>{t("Quién se compromete", "Who commits")}<select name="ownerId" defaultValue={m.userId}><option value={m.userId}>{m.user.name}</option><option value={m.withId}>{m.with.name}</option></select></label>
                <label>{t("Compartido con (opcional)", "Shared with (optional)")}<select name="sharedWithId" defaultValue=""><option value="">—</option><option value={m.userId}>{m.user.name}</option><option value={m.withId}>{m.with.name}</option></select></label>
                <label>{t("Tipo de acción", "Kind of action")}<select name="kind">{Object.entries(ACTION_KINDS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                <label>{t("Para cuándo", "By when")}<input type="date" name="dueOn" required min={dayInput(T)} /></label>
              </div>
              <label>{t("Qué se hará", "What will be done")}<input name="what" required maxLength={400} /></label>
              <label>{t("Qué mostrará que se hizo", "What will show it was done")}<input name="expectedEvidence" required maxLength={400} /></label>
              <div><button type="submit" className="secondary sm">{t("Agregar", "Add")}</button></div>
            </form>
          </details>
        )}
      </section>

      {planned && (
        <>
          <section className="card" id="cerrar"><b>{t("CERRAR LA CONVERSACIÓN", "CLOSE THE CONVERSATION")}</b>
            <form action={closeMeeting.bind(null, m.id)} className="qa-form">
              <label>{t("Lo conversado y lo acordado (lo ven los dos)", "What was discussed and agreed (both see it)")}<textarea name="notes" rows={4} maxLength={4000} /></label>
              <div className="qa-row">
                <label>{t("Se realizó el", "Held on")}<input type="date" name="heldOn" max={dayInput(T)} defaultValue={dayInput(m.scheduledOn <= T ? m.scheduledOn : T)} /></label>
                <label>{t("Próxima conversación", "Next conversation")}<input type="date" name="nextOn" min={dayInput(T)} /></label>
                <label style={{ flex: 2 }}>{t("O por qué no hace falta programarla", "Or why none needs scheduling")}<input name="noNextReason" maxLength={300} /></label>
              </div>
              <div><button type="submit">{t("Cerrar", "Close")}</button> <span className="src">{t("El desarrollo que no se revisa termina convirtiéndose en intención.", "Development that is not reviewed ends up as intention.")}</span></div>
            </form>
          </section>
          <section className="card" id="cancelar"><b>{t("MOVER O CANCELAR", "MOVE OR CANCEL")}</b>
            <div className="qa-row" style={{ alignItems: "flex-end" }}>
              <form action={moveMeeting.bind(null, m.id)} className="qa-row"><label>{t("Nueva fecha", "New date")}<input type="date" name="scheduledOn" required min={dayInput(T)} /></label><button type="submit" className="secondary sm">{t("Mover", "Move")}</button></form>
              <form action={cancelMeeting.bind(null, m.id)} className="qa-row"><label>{t("Motivo para cancelar", "Reason to cancel")}<input name="reason" required maxLength={300} /></label><button type="submit" className="secondary sm">{t("Cancelar la conversación", "Cancel the conversation")}</button></form>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
