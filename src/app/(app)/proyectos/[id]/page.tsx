import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { DATE_KINDS, HOW, PRIORITIES, PROJECT_TAGS, STAGES, TEXT_MAX, canRunProject, initials, isSeated, projectThread, priorityOf, stageIndex, tagLabel, type PostNode } from "@/lib/projects";
import { addDate, addPeople, alarmForDate, alarmForProject, closeProject, deletePost, joinProject, leaveProject, moveStage, postComment, removeDate, removeMember, reopenProject, toggleDateDone, updateProject } from "../actions";

// Inside a project: the timeline (objectives → planning → execution → results), the objective, the round table,
// the dated things, and the forum where the people at the table talk in threads.

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const p = await db.project.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } }, lead: { select: { id: true, name: true } },
      members: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, role: true } } } },
      dates: { orderBy: [{ day: "asc" }, { time: "asc" }] },
      teams: { orderBy: { createdAt: "asc" }, select: { team: { select: { id: true, name: true } } } },
    },
  });
  if (!p) notFound();
  if (p.kind !== "PROJECT") { if (p.createdById === user.id) redirect("/proyectos/notas"); notFound(); }

  const my = p.members.find((m) => m.userId === user.id) ?? null;
  const seated = isSeated(my), run = canRunProject(user, p), ger = isGerencia(user);
  const [thread, people, myAlarms, allTeams] = await Promise.all([
    projectThread(id),
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    db.task.findMany({ where: { projectId: id, assigneeId: user.id, status: "OPEN" }, orderBy: { scheduledAt: "asc" }, select: { id: true, title: true, projectDateId: true, scheduledAt: true, dueDate: true, outlookEventId: true } }),
    isGerencia(user) ? db.projectTeam.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, members: { select: { user: { select: { name: true } } } } } }) : Promise.resolve([]),
  ]);
  const teamsToAdd = allTeams.filter((x) => !p.teams.some((y) => y.team.id === x.id));
  const lastSeen = my?.seenAt ?? null;
  // Opening the project is what marks it as seen (an assignment leaves the bell, new comments stop counting).
  if (my && seated) await db.projectMember.update({ where: { id: my.id }, data: { seenAt: new Date() } });

  const now = today();
  const at = stageIndex(p.stage);
  const stageName = (k: string) => { const s = STAGES[stageIndex(k)]; return t(s.es, s.en); };
  const role = (r: string) => { const l = ROLE_LABEL[r as keyof typeof ROLE_LABEL]; return l ? t(l.es, l.en) : r; };
  const kind = (k: string) => t(DATE_KINDS[k]?.es ?? k, DATE_KINDS[k]?.en ?? k);
  const when = (d: Date) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);
  const tableSeats = p.members.filter(isSeated), invited = p.members.filter((m) => !isSeated(m));
  const canAdd = people.filter((u) => u.id !== user.id && !tableSeats.some((m) => m.userId === u.id));
  const alarmOf = new Map(myAlarms.filter((a) => a.projectDateId).map((a) => [a.projectDateId!, a]));
  const freeAlarms = myAlarms.filter((a) => !a.projectDateId);
  const next = STAGES[at + 1], prev = at > 0 ? STAGES[at - 1] : null;
  const sys = (n: PostNode) => {
    const b = n.body;
    if (b === "JOINED") return t("se unió a la mesa redonda", "joined the round table");
    if (b === "LEFT") return t("salió de la mesa redonda", "left the round table");
    if (b === "CLOSED") return t("cerró el proyecto con su resultado", "closed the project with its result");
    if (b === "REOPENED") return t("reabrió el proyecto", "reopened the project");
    if (b.startsWith("STAGE:")) return t(`pasó el proyecto a «${stageName(b.slice(6))}»`, `moved the project to “${stageName(b.slice(6))}”`);
    return b;
  };

  const okMsg: Record<string, string> = {
    creado: t("Proyecto creado. Ya está a la vista de todos. Sigue por la etapa «Objetivos»: cuéntalo en el foro y pon las primeras fechas.", "Project created. Everyone can see it now. Go on with the “Objectives” stage: tell it in the forum and set the first dates."),
    convertida: t("La nota ahora es un proyecto que todos ven. Falta escribir su objetivo: hazlo aquí abajo.", "The note is now a project everyone sees. Its objective is missing: write it right below."),
    guardado: t("Cambios guardados.", "Changes saved."),
    unido: t("Ya estás en la mesa redonda: puedes comentar, responder y poner fechas.", "You are at the round table now: you can comment, reply and set dates."),
    saliste: t("Saliste de la mesa redonda. El proyecto sigue visible y puedes volver cuando quieras.", "You left the round table. The project stays visible and you can come back whenever you want."),
    asignados: t("Listo: quedaron asignadas a la mesa redonda. SOLU les avisa en la campana.", "Done: they are assigned to the round table. SOLU tells them through the bell."),
    invitados: t("Invitación enviada. Cada persona decide si entra; SOLU le avisa en la campana.", "Invitation sent. Each person decides whether to join; SOLU tells them through the bell."),
    quitado: t("La persona ya no está en la mesa redonda.", "The person is no longer at the round table."),
    publicado: t("Comentario publicado.", "Comment posted."),
    borrado: t("Comentario eliminado.", "Comment deleted."),
    etapa: t(`El proyecto está ahora en «${stageName(p.stage)}».`, `The project is now in “${stageName(p.stage)}”.`),
    resultado: t("Resultado guardado. El proyecto sigue abierto.", "Result saved. The project stays open."),
    cerrado: t("Proyecto cerrado con su resultado. Queda en la lista «Cerrados».", "Project closed with its result. It is kept in the “Closed” list."),
    reabierto: t("Proyecto reabierto.", "Project reopened."),
    fecha: t("Fecha agregada a la línea de tiempo. Cada persona decide si la pone en su Mi Día o en su Outlook.", "Date added to the timeline. Each person decides whether to put it in their My Day or their Outlook."),
    "fecha-hecha": t("Fecha actualizada.", "Date updated."),
    "fecha-quitada": t("Fecha quitada.", "Date removed."),
    alarma: t("Alarma puesta: la verás en MI DÍA → Pendientes desde ya, y en «Tu agenda» de MI DÍA → Hoy cuando llegue el día.", "Alarm set: you will see it in MY DAY → To-dos from now, and in “Your agenda” in MY DAY → Today when the day comes."),
    "alarma-outlook": t("Alarma puesta en tu Mi Día y también en tu calendario de Outlook.", "Alarm set in your My Day and also in your Outlook calendar."),
    "alarma-ya": t("Esa fecha ya estaba en tu Mi Día.", "That date was already in your My Day."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Eso lo hace el responsable del proyecto, quien lo inició o Gerencia.", "That is done by the project lead, whoever started it, or Management."),
    datos: t("Faltan datos: el nombre, la descripción corta y el objetivo. No se guardó nada.", "Missing data: the name, the short description and the objective. Nothing was saved."),
    fechas: t("Las fechas de la línea de tiempo no están en orden: cada etapa debe terminar después de la anterior. No se guardó nada.", "The timeline dates are not in order: each stage must end after the one before. Nothing was saved."),
    mesa: t("Primero únete a la mesa redonda (botón «Unirme a la mesa redonda»). No necesita aprobación.", "Join the round table first (button “Join the round table”). It needs no approval."),
    responsable: t("El responsable no puede salir de la mesa redonda de su propio proyecto.", "The lead cannot leave the round table of their own project."),
    nadie: t("Marca al menos una persona o un equipo que aún no esté en la mesa redonda.", "Tick at least one person or team not at the round table yet."),
    vacio: t("El comentario está vacío. No se publicó nada.", "The comment is empty. Nothing was posted."),
    hilo: t("El comentario al que respondías ya no existe.", "The comment you were replying to no longer exists."),
    etapa: t("El proyecto ya está en esa etapa, o está cerrado.", "The project is already in that stage, or it is closed."),
    resultado: t("Escribe el resultado antes de guardar o cerrar.", "Write the result before saving or closing."),
    "fecha-datos": t("Faltan datos de la fecha: qué es, el título y el día. No se guardó nada.", "The date is missing data: what it is, the title and the day. Nothing was saved."),
    pasada: t("Ese día ya pasó: una alarma solo se pone de hoy en adelante.", "That day has passed: an alarm can only be set from today on."),
    "alarma-dia": t("Elige el día de la alarma.", "Choose the day of the alarm."),
  };

  const Post = ({ n, depth }: { n: PostNode; depth: number }) => {
    if (n.system) return <li className="pj-sys" id={`c-${n.id}`}><span aria-hidden>•</span> <b>{n.authorName}</b> {sys(n)} · <span className="src">{when(n.createdAt)}</span></li>;
    const fresh = !!lastSeen && n.createdAt > lastSeen && n.authorId !== user.id;
    return (
      <li className="pj-post" id={`c-${n.id}`} data-new={fresh ? "1" : undefined}>
        <div className="pj-ph"><i className="pj-av" aria-hidden>{initials(n.authorName)}</i><b>{n.deleted ? t("Comentario eliminado", "Deleted comment") : n.authorName}</b><span className="src">{when(n.createdAt)}</span>{fresh && <span className="sig attn">{t("nuevo", "new")}</span>}</div>
        {!n.deleted && <p className="pj-body">{n.body}</p>}
        {!n.deleted && (
          <div className="pj-acts">
            {seated && (
              <details className="pj-reply">
                <summary>{t("Responder", "Reply")}</summary>
                <form action={postComment.bind(null, id)}>
                  <input type="hidden" name="parentId" value={n.id} />
                  <textarea name="body" required rows={2} maxLength={TEXT_MAX.post} aria-label={t(`Responder a ${n.authorName}`, `Reply to ${n.authorName}`)} placeholder={t(`Responder a ${n.authorName}…`, `Reply to ${n.authorName}…`)} />
                  <button type="submit" className="sm">{t("Publicar respuesta", "Post reply")}</button>
                </form>
              </details>
            )}
            {(n.authorId === user.id || ger) && <form action={deletePost.bind(null, n.id)} data-confirm={t("¿Eliminar este comentario? No se puede deshacer.", "Delete this comment? This can't be undone.")}><button type="submit" className="link small">{t("Eliminar", "Delete")}</button></form>}
          </div>
        )}
        {n.replies.length > 0 && <ul className={`pj-thread${depth >= 5 ? " flat" : ""}`}>{n.replies.map((r) => <Post key={r.id} n={r} depth={depth + 1} />)}</ul>}
      </li>
    );
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/proyectos">{t("Proyectos y notas", "Projects and notes")}</Link> · {p.code}</div>
          <h1>{p.title} {!p.closedAt && <span className={`sig ${priorityOf(p.priority).tone}`}>{t(priorityOf(p.priority).es, priorityOf(p.priority).en)}</span>}</h1>
          <p>{p.summary}</p>
          {p.tags.length > 0 && <div className="pj-tags">{p.tags.map((k) => <Link key={k} href={`/proyectos?tag=${encodeURIComponent(k)}`}>{tagLabel(k, i.es)}</Link>)}</div>}
          <p className="src">{t("Lo inició", "Started by")} <b>{p.createdBy.name}</b> · {i.day(p.createdAt)}{p.lead.id !== p.createdBy.id && <> · {t("responsable", "lead")} <b>{p.lead.name}</b></>}</p>
        </div>
        <div className="grow" />
        {seated
          ? <span className="sig ok">{t("Estás en la mesa redonda", "You are at the round table")}</span>
          : <form action={joinProject.bind(null, id)}><button type="submit">{t("Unirme a la mesa redonda", "Join the round table")}</button></form>}
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {my?.how === "INVITED" && <div className="note attn">{t(`${my.addedByName ?? "Alguien"} te invitó a este proyecto. Si quieres participar, haz clic en «Unirme a la mesa redonda».`, `${my.addedByName ?? "Someone"} invited you to this project. If you want to take part, click “Join the round table”.`)}</div>}

      <section className="card" id="linea">
        <h2>{t("Línea de tiempo", "Timeline")} {p.closedAt ? <span className="sig ok">{t("Cerrado el", "Closed on")} {i.day(p.closedAt)}</span> : <span className="src">{t("Etapa", "Stage")} {at + 1} {t("de", "of")} 4</span>}</h2>
        <ol className="pj-line">
          {STAGES.map((s, k) => {
            const by = p[s.field];
            const st = p.closedAt || k < at ? "done" : k === at ? "now" : "later";
            const late = st === "now" && by && by < now;
            return (
              <li key={s.key} data-st={late ? "late" : st}>
                <span className="pj-dot" aria-hidden>{st === "done" ? "✓" : k + 1}</span>
                <b>{t(s.es, s.en)}</b>
                <span className="src">{t(s.hintEs, s.hintEn)}</span>
                <span className={`pj-by${late ? " risk-t" : ""}`}>{by ? `${late ? t("Se pasó: era para el", "Past due: it was for") : t("Para el", "By")} ${i.day(by)}` : t("Abierto, sin fecha", "Open, no date")}</span>
              </li>
            );
          })}
        </ol>
        {run && !p.closedAt && (
          <div className="row pj-move">
            {next && <form action={moveStage.bind(null, id, next.key)}><button type="submit">{t(`Pasar a «${next.es}»`, `Move to “${next.en}”`)} →</button></form>}
            {prev && <form action={moveStage.bind(null, id, prev.key)}><button type="submit" className="secondary">← {t(`Volver a «${prev.es}»`, `Back to “${prev.en}”`)}</button></form>}
            <span className="src">{t("Solo el responsable, quien lo inició o Gerencia mueven la etapa. Queda anotado en el foro.", "Only the lead, whoever started it, or Management move the stage. It is noted in the forum.")}</span>
          </div>
        )}
      </section>

      <div className="pj-cols">
        <div className="pj-main">
          <section className="card" id="objetivo">
            <h2>{t("Objetivo", "Objective")}</h2>
            {p.objective
              ? <p className="pj-body">{p.objective}</p>
              : run
                ? <p><a className="chk-a risk-t" href="#editar">{t("Falta: escribir el objetivo", "Missing: write the objective")} <span aria-hidden>→</span></a></p>
                : <p className="small muted">{t("Aún no tiene objetivo escrito.", "No objective written yet.")}</p>}
            {p.startOn && <p className="src">{t("Empieza el", "Starts on")} {i.day(p.startOn)}</p>}
            {run && (
              <details className="pj-edit" id="editar" open={!p.objective}>
                <summary>{t("Cambiar nombre, objetivo y fechas", "Change name, objective and dates")}</summary>
                <form action={updateProject.bind(null, id)} className="pj-form">
                  <label><span className="fname">{t("Nombre del proyecto", "Project name")}</span><input name="title" required maxLength={TEXT_MAX.title} defaultValue={p.title} /></label>
                  <label><span className="fname">{t("Descripción corta", "Short description")}</span><input name="summary" required maxLength={TEXT_MAX.summary} defaultValue={p.summary} /></label>
                  <label><span className="fname">{t("Prioridad", "Priority")}</span>
                    <select name="priority" defaultValue={p.priority}>{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select>
                    <span className="src">{t("La lista se ordena por prioridad: primero lo que hay que escoger y ejecutar antes.", "The list is ordered by priority: what must be chosen and done first comes first.")}</span>
                  </label>
                  <label className={p.objective ? undefined : "req-miss"}><span className="fname">{t("Objetivo", "Objective")}</span><textarea name="objective" required rows={3} maxLength={TEXT_MAX.objective} defaultValue={p.objective ?? ""} /></label>

                  <fieldset className="pj-set">
                    <legend>{t("Etiquetas (opcional)", "Tags (optional)")}</legend>
                    <p className="src">{t("De qué trata el proyecto. Se ven en la lista y sirven para filtrarla.", "What the project is about. They show in the list and filter it.")}</p>
                    <div className="pj-tags pick">
                      {Object.keys(PROJECT_TAGS).map((k) => <label key={k}><input type="checkbox" name="tags" value={k} defaultChecked={p.tags.includes(k)} /> {tagLabel(k, i.es)}</label>)}
                    </div>
                    <label>{t("Otra etiqueta (opcional, separa con comas)", "Another tag (optional, separate with commas)")}<input name="ownTags" maxLength={80} defaultValue={p.tags.filter((k) => !(k in PROJECT_TAGS)).join(", ")} /></label>
                  </fieldset>
                  <div className="pj-dates">
                    <label>{t("Empieza", "Starts")}<input type="date" name="startOn" defaultValue={dayInput(p.startOn)} /></label>
                    {STAGES.map((s) => <label key={s.key}>{t(s.es, s.en)}<input type="date" name={s.field} defaultValue={dayInput(p[s.field])} /></label>)}
                  </div>
                  <button type="submit">{t("Guardar cambios", "Save changes")}</button>
                </form>
              </details>
            )}
          </section>

          {(at === 3 || p.result || p.closedAt) && (
            <section className="card" id="resultado">
              <h2>{t("Resultado", "Result")}</h2>
              {p.result ? <p className="pj-body">{p.result}</p> : <p className="small muted">{run ? t("Escribe aquí qué se logró frente al objetivo.", "Write here what was achieved against the objective.") : t("El responsable aún no ha escrito el resultado.", "The lead has not written the result yet.")}</p>}
              {run && !p.closedAt && (
                <form action={closeProject.bind(null, id)} className="pj-form">
                  <label><span className="fname">{t("¿Qué se logró?", "What was achieved?")}</span><textarea name="result" required rows={3} maxLength={TEXT_MAX.objective} defaultValue={p.result ?? ""} /></label>
                  <div className="row">
                    <button type="submit" name="close" value="1">{t("Guardar y cerrar el proyecto", "Save and close the project")}</button>
                    <button type="submit" className="secondary">{t("Solo guardar el resultado", "Only save the result")}</button>
                  </div>
                </form>
              )}
              {run && p.closedAt && <form action={reopenProject.bind(null, id)}><button type="submit" className="secondary">{t("Reabrir el proyecto", "Reopen the project")}</button></form>}
            </section>
          )}

          <section className="card" id="foro">
            <h2>{t("Foro", "Forum")} <span className="src">{thread.total === 1 ? t("1 comentario", "1 comment") : t(`${thread.total} comentarios`, `${thread.total} comments`)}</span></h2>
            {seated ? (
              <form action={postComment.bind(null, id)} className="pj-new">
                <i className="pj-av" aria-hidden>{initials(user.name)}</i>
                <textarea name="body" required rows={3} maxLength={TEXT_MAX.post} aria-label={t("Nuevo comentario", "New comment")} placeholder={t("Abre una conversación: una idea, un avance, una pregunta…", "Start a conversation: an idea, progress, a question…")} />
                <button type="submit">{t("Publicar", "Post")}</button>
              </form>
            ) : (
              <div className="pj-join">
                <span>{t("Para comentar y responder, únete a la mesa redonda. No necesita aprobación.", "To comment and reply, join the round table. It needs no approval.")}</span>
                <form action={joinProject.bind(null, id)}><button type="submit">{t("Unirme y participar", "Join and take part")}</button></form>
              </div>
            )}
            {thread.top.length === 0
              ? <p className="small muted">{seated ? t("Nadie ha escrito todavía. Abre la primera conversación en la casilla de arriba.", "Nobody has written yet. Start the first conversation in the box above.") : t("Nadie ha escrito todavía.", "Nobody has written yet.")}</p>
              : <ul className="pj-thread root">{thread.top.map((n) => <Post key={n.id} n={n} depth={0} />)}</ul>}
          </section>
        </div>

        <aside className="pj-side">
          <section className="card" id="mesa">
            <h2>{t("Mesa redonda", "Round table")} <span className="src">{tableSeats.length}</span></h2>
            {p.teams.length > 0 && <p className="pj-table"><span className="src">{t("Equipos guardados", "Saved teams")}:</span>{p.teams.map((x) => <Link key={x.team.id} className="pj-team" href={`/proyectos/equipos#e-${x.team.id}`}>{x.team.name}</Link>)}</p>}
            <ul className="pj-seats">
              {tableSeats.map((m) => (
                <li key={m.id}>
                  <i className="pj-av" aria-hidden>{initials(m.user.name)}</i>
                  <span><b>{m.user.name}</b>{m.userId === user.id ? t(" (tú)", " (you)") : ""}<span className="src block">{t(HOW[m.how]?.es ?? m.how, HOW[m.how]?.en ?? m.how)} · {role(m.user.role)}</span></span>
                  {(ger || p.leadId === user.id) && m.userId !== p.leadId && m.userId !== user.id && <form action={removeMember.bind(null, id, m.userId)} data-confirm={t(`¿Quitar a ${m.user.name} de la mesa redonda?`, `Remove ${m.user.name} from the round table?`)}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>}
                </li>
              ))}
              {invited.map((m) => (
                <li key={m.id} className="inv">
                  <i className="pj-av" aria-hidden>{initials(m.user.name)}</i>
                  <span><b>{m.user.name}</b>{m.userId === user.id ? t(" (tú)", " (you)") : ""}<span className="src block">{t(HOW.INVITED.es, HOW.INVITED.en)}</span></span>
                </li>
              ))}
            </ul>
            {seated && p.leadId !== user.id && <form action={leaveProject.bind(null, id)} data-confirm={t("¿Salir de la mesa redonda de este proyecto?", "Leave the round table of this project?")}><button type="submit" className="link small">{t("Salir de la mesa redonda", "Leave the round table")}</button></form>}
            {(ger || seated) && (canAdd.length > 0 || teamsToAdd.length > 0) && (
              <details className="pj-edit">
                <summary>{ger ? t("Asignar personas o equipos", "Assign people or teams") : t("Invitar personas", "Invite people")}</summary>
                <form action={addPeople.bind(null, id)} className="pj-form">
                  {teamsToAdd.length > 0 && (
                    <div className="pj-people one">
                      {teamsToAdd.map((tm) => <label key={tm.id} className="check"><input type="checkbox" name="teams" value={tm.id} /> <span>{t("Equipo", "Team")}: {tm.name}<span className="src block">{tm.members.map((m) => m.user.name.split(" ")[0]).join(", ")}</span></span></label>)}
                    </div>
                  )}
                  <div className="pj-people one">
                    {canAdd.map((u) => <label key={u.id} className="check"><input type="checkbox" name="people" value={u.id} /> <span>{u.name}<span className="src block">{role(u.role)}</span></span></label>)}
                  </div>
                  <button type="submit">{ger ? t("Asignar a la mesa redonda", "Assign to the round table") : t("Enviar invitación", "Send invitation")}</button>
                </form>
              </details>
            )}
          </section>

          <section className="card" id="fechas">
            <h2>{t("Fechas del proyecto", "Project dates")}</h2>
            {p.dates.length === 0 && <p className="small muted">{t("Aún no hay reuniones, citas ni tareas con fecha.", "No meetings, appointments or dated tasks yet.")}{(seated || run) ? t(" Agrega la primera aquí abajo.", " Add the first one right below.") : ""}</p>}
            <ul className="pj-dl">
              {p.dates.map((d) => {
                const mineAlarm = alarmOf.get(d.id);
                const past = d.day < now;
                return (
                  <li key={d.id} data-done={d.doneAt ? "1" : undefined}>
                    <div className="pj-dh"><span className="sig info">{kind(d.kind)}</span><b>{d.title}</b></div>
                    <span className="src">{i.day(d.day)}{d.time ? ` · ${d.time} (${t("hora Colombia", "Colombia time")}) · ${d.minutes} min` : ""} · {stageName(d.stage)} · {d.createdByName}{d.doneAt ? ` · ${t("hecha", "done")}` : past ? ` · ${t("ya pasó", "already past")}` : ""}</span>
                    <div className="pj-acts">
                      {!d.doneAt && !past && (mineAlarm
                        ? <span className="sig ok">{mineAlarm.outlookEventId ? t("En tu Mi Día y en tu Outlook", "In your My Day and your Outlook") : t("En tu Mi Día", "In your My Day")}</span>
                        : <form action={alarmForDate.bind(null, d.id)}><button type="submit" className="sm">{t("Poner en mi Mi Día", "Put in my My Day")}</button></form>)}
                      {!d.doneAt && !past && <a className="btn secondary sm" href={`/proyectos/fecha/${d.id}`}>{t("Agregar a Outlook", "Add to Outlook")}</a>}
                      {(seated || run) && <form action={toggleDateDone.bind(null, d.id)}><button type="submit" className="link small">{d.doneAt ? t("Marcar pendiente", "Mark as pending") : t("Marcar hecha", "Mark as done")}</button></form>}
                      {(d.createdById === user.id || run) && <form action={removeDate.bind(null, d.id)} data-confirm={t("¿Quitar esta fecha del proyecto?", "Remove this date from the project?")}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {(seated || run) ? (
              <details className="pj-edit" open={p.dates.length === 0}>
                <summary>{t("+ Nueva fecha", "+ New date")}</summary>
                <form action={addDate.bind(null, id)} className="pj-form">
                  <label><span className="fname">{t("¿Qué es?", "What is it?")}</span>
                    <select name="kind" required defaultValue="MEETING">{Object.entries(DATE_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select>
                  </label>
                  <label><span className="fname">{t("Título", "Title")}</span><input name="title" required maxLength={TEXT_MAX.date} placeholder={t("Ej.: Revisar el plan con el equipo", "E.g. Review the plan with the team")} /></label>
                  <div className="pj-dates two">
                    <label>{t("Día", "Day")}<input type="date" name="day" required min={dayInput(now)} /></label>
                    <label>{t("Hora (opcional)", "Time (optional)")}<input type="time" name="time" /></label>
                    <label>{t("Duración (min)", "Duration (min)")}<input type="number" name="minutes" min={5} max={600} step={5} defaultValue={30} /></label>
                    <label>{t("Etapa", "Stage")}<select name="stage" defaultValue={p.stage}>{STAGES.map((s) => <option key={s.key} value={s.key}>{t(s.es, s.en)}</option>)}</select></label>
                  </div>
                  <button type="submit">{t("Agregar fecha", "Add date")}</button>
                </form>
              </details>
            ) : <p className="src">{t("Para agregar fechas, únete a la mesa redonda.", "To add dates, join the round table.")}</p>}
          </section>

          <section className="card" id="alarma">
            <h2>{t("Recordármelo en Mi Día", "Remind me in My Day")}</h2>
            <p className="src">{t("Una alarma solo para ti sobre este proyecto. Nadie más la ve.", "An alarm just for you about this project. Nobody else sees it.")}</p>
            {freeAlarms.length > 0 && <ul className="pj-al">{freeAlarms.map((a) => <li key={a.id}><span className="sig ok">{a.scheduledAt ? when(a.scheduledAt) : i.day(a.dueDate)}</span> {a.title}</li>)}</ul>}
            <form action={alarmForProject.bind(null, id)} className="pj-form">
              <div className="pj-dates two">
                <label>{t("Día", "Day")}<input type="date" name="day" required min={dayInput(now)} /></label>
                <label>{t("Hora (opcional)", "Time (optional)")}<input type="time" name="time" /></label>
              </div>
              <label><span className="fname">{t("¿Qué quieres recordar? (opcional)", "What do you want to remember? (optional)")}</span><input name="what" maxLength={140} /></label>
              <button type="submit">{t("Poner alarma", "Set alarm")}</button>
            </form>
            <p className="src">{user.outlookConnectedAt ? t("Tu Outlook está conectado: la alarma también queda en tu calendario.", "Your Outlook is connected: the alarm also goes to your calendar.") : <>{t("Queda en SOLU. ", "It stays in SOLU. ")}<Link href="/profile#outlook">{t("Conecta Outlook", "Connect Outlook")}</Link>{t(" para verla también allá.", " to see it there too.")}</>}</p>
          </section>
        </aside>
      </div>
    </>
  );
}
