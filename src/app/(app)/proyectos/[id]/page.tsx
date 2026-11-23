import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { DATE_KINDS, EXT_DAYS, HOW, NUDGE_ANSWERS, POST_FILE_MAX, PRIORITIES, PROJECT_TAGS, QUIET_DAYS, STAGES, TEXT_MAX, canRunProject, healthText, initials, isSeated, priorityOf, projectHealth, projectThread, stageIndex, tagLabel, type PostNode } from "@/lib/projects";
import { addDate, addItem, addPeople, alarmForDate, alarmForProject, answerNudge, askProgress, closeProject, decideExtension, deletePost, editPost, flagPost, joinProject, leaveProject, moveStage, postComment, removeDate, removeItem, removeMember, reopenProject, requestExtension, saveTemplate, toggleDateDone, toggleItem, updateProject } from "../actions";

// Inside a project: the timeline (objectives → planning → execution → results), the clock of days without movement,
// the objective, the checklist of each stage, the round table, the dated things, and the forum in threads.

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
      items: { orderBy: [{ doneAt: { sort: "asc", nulls: "first" } }, { dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], include: { owner: { select: { id: true, name: true } } } },
      nudges: { where: { answeredAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, itemId: true, dateId: true, toUserId: true, fromName: true, createdAt: true, item: { select: { title: true } }, date: { select: { title: true } } } },
      extensions: { orderBy: { createdAt: "desc" }, take: 6 },
      account: { select: { id: true, name: true } }, deal: { select: { id: true, code: true, title: true } },
    },
  });
  if (!p) notFound();
  if (p.kind !== "PROJECT") { if (p.createdById === user.id) redirect("/proyectos/notas"); notFound(); }

  const my = p.members.find((m) => m.userId === user.id) ?? null;
  const seated = isSeated(my), run = canRunProject(user, p), ger = isGerencia(user);
  const [thread, people, myAlarms, allTeams, accounts] = await Promise.all([
    projectThread(id),
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    db.task.findMany({ where: { projectId: id, assigneeId: user.id, status: "OPEN" }, orderBy: { scheduledAt: "asc" }, select: { id: true, title: true, projectDateId: true, scheduledAt: true, dueDate: true, outlookEventId: true } }),
    ger ? db.projectTeam.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, members: { select: { user: { select: { name: true } } } } } }) : Promise.resolve([]),
    run ? db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, take: 600, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const teamsToAdd = allTeams.filter((x) => !p.teams.some((y) => y.team.id === x.id));
  const lastSeen = my?.seenAt ?? null;
  // Opening the project is what marks it as seen (an assignment leaves the bell, new comments stop counting, mentions are read).
  if (my && seated) await db.projectMember.update({ where: { id: my.id }, data: { seenAt: new Date() } });
  await db.projectMention.updateMany({ where: { projectId: id, userId: user.id, seenAt: null }, data: { seenAt: new Date() } });

  const now = today();
  const at = stageIndex(p.stage);
  const health = projectHealth(p, now);
  const stageName = (k: string) => { const s = STAGES[stageIndex(k)]; return t(s.es, s.en); };
  const role = (r: string) => { const l = ROLE_LABEL[r as keyof typeof ROLE_LABEL]; return l ? t(l.es, l.en) : r; };
  const kind = (k: string) => t(DATE_KINDS[k]?.es ?? k, DATE_KINDS[k]?.en ?? k);
  const ans = (k: string) => t(NUDGE_ANSWERS[k]?.es ?? k, NUDGE_ANSWERS[k]?.en ?? k);
  const when = (d: Date) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);
  const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const tableSeats = p.members.filter(isSeated), invited = p.members.filter((m) => !isSeated(m));
  const canAdd = people.filter((u) => u.id !== user.id && !tableSeats.some((m) => m.userId === u.id));
  const alarmOf = new Map(myAlarms.filter((a) => a.projectDateId).map((a) => [a.projectDateId!, a]));
  const freeAlarms = myAlarms.filter((a) => !a.projectDateId);
  const next = STAGES[at + 1], prev = at > 0 ? STAGES[at - 1] : null;
  const asksToMe = p.nudges.filter((n) => n.toUserId === user.id);
  const askedItem = new Set(p.nudges.filter((n) => n.itemId).map((n) => n.itemId!)), askedDate = new Set(p.nudges.filter((n) => n.dateId).map((n) => n.dateId!));
  const pendingExt = p.extensions.find((x) => x.status === "REQUESTED") ?? null;
  const canWork = seated || run;
  const sys = (n: PostNode) => {
    const b = n.body;
    if (b === "JOINED") return t("se unió a la mesa redonda", "joined the round table");
    if (b === "LEFT") return t("salió de la mesa redonda", "left the round table");
    if (b === "CLOSED") return t("cerró el proyecto con su resultado", "closed the project with its result");
    if (b === "REOPENED") return t("reabrió el proyecto", "reopened the project");
    if (b.startsWith("STAGE:")) return t(`pasó el proyecto a «${stageName(b.slice(6))}»`, `moved the project to “${stageName(b.slice(6))}”`);
    if (b.startsWith("EXT_REQ:")) return t(`pidió a Gerencia ${b.slice(8)} días más sin movimiento`, `asked Management for ${b.slice(8)} more days without movement`);
    if (b.startsWith("EXT_OK:")) return t(`aprobó ${b.slice(7)} días más`, `approved ${b.slice(7)} more days`);
    if (b.startsWith("EXT_NO:")) return t(`no aprobó la extensión${b.length > 7 ? `: ${b.slice(7)}` : ""}`, `did not approve the extension${b.length > 7 ? `: ${b.slice(7)}` : ""}`);
    if (b.startsWith("NUDGE:")) { const [head, ...rest] = b.split("\n"); const [, a, ...title] = head.split(":"); return t(`respondió sobre «${title.join(":")}»: ${ans(a)}${rest.length ? `. ${rest.join(" ")}` : ""}`, `answered about “${title.join(":")}”: ${ans(a)}${rest.length ? `. ${rest.join(" ")}` : ""}`); }
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
    "publicado-archivos": t("Comentario publicado, pero algún archivo no se guardó (más de 5 MB, o no es foto ni PDF).", "Comment posted, but a file was not saved (over 5 MB, or not a photo or PDF)."),
    editado: t("Comentario corregido. Queda marcado como «editado».", "Comment corrected. It is marked as “edited”."),
    fijado: t("Listo: cambió si la conversación queda fija arriba.", "Done: changed whether the conversation stays pinned at the top."),
    decision: t("Listo: cambió si el comentario cuenta como decisión.", "Done: changed whether the comment counts as a decision."),
    borrado: t("Comentario eliminado.", "Comment deleted."),
    etapa: t(`El proyecto está ahora en «${stageName(p.stage)}».`, `The project is now in “${stageName(p.stage)}”.`),
    resultado: t("Resultado guardado. El proyecto sigue abierto.", "Result saved. The project stays open."),
    cerrado: t("Proyecto cerrado con su resultado. Queda en la lista «Cerrados».", "Project closed with its result. It is kept in the “Closed” list."),
    reabierto: t("Proyecto reabierto.", "Project reopened."),
    fecha: t("Fecha agregada a la línea de tiempo. Cada persona decide si la pone en su Mi Día o en su Outlook.", "Date added to the timeline. Each person decides whether to put it in their My Day or their Outlook."),
    "fecha-hecha": t("Fecha actualizada.", "Date updated."),
    "fecha-quitada": t("Fecha quitada.", "Date removed."),
    tarea: t("Tarea agregada a la lista de la etapa.", "Task added to the stage's list."),
    "tarea-hecha": t("Tarea actualizada.", "Task updated."),
    "tarea-quitada": t("Tarea quitada.", "Task removed."),
    "avance-pedido": t("Listo: le llega a su campana y responde con un clic. La respuesta queda en el foro.", "Done: it reaches their bell and they answer in one click. The answer is written in the forum."),
    "avance-ya": t("Ya hay una pregunta de avance esperando respuesta.", "A progress question is already waiting for an answer."),
    "avance-dado": t("Respuesta enviada. Quedó escrita en el foro.", "Answer sent. It is written in the forum."),
    "ext-pedida": t("Extensión pedida. Le llega directo a Gerencia.", "Extension requested. It goes straight to Management."),
    "ext-ya": t("Ya hay una extensión esperando la decisión de Gerencia.", "An extension is already waiting for Management's decision."),
    "ext-aprobada": t("Extensión aprobada: el reloj del proyecto tiene más días.", "Extension approved: the project's clock has more days."),
    "ext-negada": t("Extensión no aprobada. Quedó anotado en el foro con el motivo.", "Extension not approved. It is noted in the forum with the reason."),
    plantilla: t("Plantilla guardada. Aparece al crear un proyecto, en «Empezar desde una plantilla».", "Template saved. It shows when creating a project, under “Start from a template”."),
    alarma: t("Alarma puesta: la verás en MI DÍA → Pendientes desde ya, y en «Tu agenda» de MI DÍA → Hoy cuando llegue el día.", "Alarm set: you will see it in MY DAY → To-dos from now, and in “Your agenda” in MY DAY → Today when the day comes."),
    "alarma-outlook": t("Alarma puesta en tu Mi Día y también en tu calendario de Outlook.", "Alarm set in your My Day and also in your Outlook calendar."),
    "alarma-ya": t("Esa fecha ya estaba en tu Mi Día.", "That date was already in your My Day."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Eso lo hace el responsable del proyecto, quien lo inició o Gerencia.", "That is done by the project lead, whoever started it, or Management."),
    datos: t("Faltan datos: el nombre, la descripción corta y el objetivo. No se guardó nada.", "Missing data: the name, the short description and the objective. Nothing was saved."),
    fechas: t("Las fechas de la línea de tiempo no están en orden: cada etapa debe terminar después de la anterior. No se guardó nada.", "The timeline dates are not in order: each stage must end after the one before. Nothing was saved."),
    necesidad: t("No existe una Necesidad con ese código. Revísalo (por ejemplo J-2611-0147) o deja la casilla vacía. No se guardó nada.", "No Need has that code. Check it (for example J-2611-0147) or leave the box empty. Nothing was saved."),
    mesa: t("Primero únete a la mesa redonda (botón «Unirme a la mesa redonda»). No necesita aprobación.", "Join the round table first (button “Join the round table”). It needs no approval."),
    responsable: t("El responsable no puede salir de la mesa redonda de su propio proyecto.", "The lead cannot leave the round table of their own project."),
    nadie: t("Marca al menos una persona o un equipo que aún no esté en la mesa redonda.", "Tick at least one person or team not at the round table yet."),
    vacio: t("El comentario está vacío. No se publicó nada.", "The comment is empty. Nothing was posted."),
    hilo: t("El comentario al que respondías ya no existe.", "The comment you were replying to no longer exists."),
    etapa: t("El proyecto ya está en esa etapa, o está cerrado.", "The project is already in that stage, or it is closed."),
    resultado: t("Escribe el resultado antes de guardar o cerrar.", "Write the result before saving or closing."),
    "fecha-datos": t("Faltan datos de la fecha: qué es, el título y el día. No se guardó nada.", "The date is missing data: what it is, the title and the day. Nothing was saved."),
    "tarea-datos": t("Escribe qué hay que hacer. No se guardó nada.", "Write what has to be done. Nothing was saved."),
    "avance-nadie": t("Esa tarea no tiene responsable (o ya está hecha): no hay a quién pedirle el avance.", "That task has nobody in charge (or is already done): there is nobody to ask."),
    "avance-propio": t("Esa es tuya: no hace falta pedirte el avance. Márcala hecha o cuéntalo en el foro.", "That one is yours: no need to ask yourself. Mark it done or tell it in the forum."),
    "avance-resp": t("Elige una de las cuatro respuestas.", "Choose one of the four answers."),
    "ext-datos": t("Escribe por qué el proyecto necesita más tiempo y elige cuántos días. No se envió nada.", "Write why the project needs more time and choose how many days. Nothing was sent."),
    "ext-permiso": t("La extensión la decide Gerencia.", "The extension is decided by Management."),
    "ext-motivo": t("Para no aprobar la extensión, escribe el motivo.", "To not approve the extension, write the reason."),
    "plantilla-nombre": t("Escribe el nombre de la plantilla.", "Write the template's name."),
    "plantilla-existe": t("Ya hay una plantilla con ese nombre. Elige otro.", "A template with that name already exists. Choose another."),
    pasada: t("Ese día ya pasó: una alarma solo se pone de hoy en adelante.", "That day has passed: an alarm can only be set from today on."),
    "alarma-dia": t("Elige el día de la alarma.", "Choose the day of the alarm."),
  };

  const Post = ({ n, depth }: { n: PostNode; depth: number }) => {
    if (n.system) return <li className="pj-sys" id={`c-${n.id}`}><span aria-hidden>•</span> <b>{n.authorName}</b> {sys(n)} · <span className="src">{when(n.createdAt)}</span></li>;
    const fresh = !!lastSeen && n.createdAt > lastSeen && n.authorId !== user.id;
    return (
      <li className="pj-post" id={`c-${n.id}`} data-new={fresh ? "1" : undefined} data-kind={n.decision ? "decision" : n.customerInput ? "customer" : undefined}>
        <div className="pj-ph"><i className="pj-av" aria-hidden>{initials(n.authorName)}</i><b>{n.deleted ? t("Comentario eliminado", "Deleted comment") : n.authorName}</b><span className="src">{when(n.createdAt)}{n.editedAt ? ` · ${t("editado", "edited")}` : ""}</span>
          {fresh && <span className="sig attn">{t("nuevo", "new")}</span>}
          {n.pinned && <span className="sig info">{t("Fijado", "Pinned")}</span>}
          {n.decision && <span className="sig ok">{t("Decisión", "Decision")}</span>}
          {n.customerInput && <span className="sig wait">{t("Lo dijo el cliente", "The customer said")}{n.customerName ? `: ${n.customerName}` : ""}</span>}
        </div>
        {!n.deleted && <p className="pj-body">{n.body}</p>}
        {n.files.length > 0 && <div className="pj-files">{n.files.map((f) => <a key={f.id} href={`/proyectos/archivo/${f.id}`} target="_blank" rel="noopener">{f.mime.startsWith("image/") ? "🖼" : "📄"} {f.name} <span className="src">{size(f.size)}</span></a>)}</div>}
        {n.mentions.length > 0 && <span className="src pj-ment">{t("Avisó a", "Notified")}: {n.mentions.join(", ")}</span>}
        {!n.deleted && (
          <div className="pj-acts">
            {seated && (
              <details className="pj-reply">
                <summary>{t("Responder", "Reply")}</summary>
                <form action={postComment.bind(null, id)}>
                  <input type="hidden" name="parentId" value={n.id} />
                  <textarea name="body" required rows={2} maxLength={TEXT_MAX.post} aria-label={t(`Responder a ${n.authorName}`, `Reply to ${n.authorName}`)} placeholder={t(`Responder a ${n.authorName}… (con @Nombre le avisas a alguien)`, `Reply to ${n.authorName}… (@Name notifies someone)`)} />
                  <label className="pj-file">{t("Foto o PDF (opcional)", "Photo or PDF (optional)")}<input type="file" name="files" multiple accept="image/*,application/pdf" /></label>
                  <button type="submit" className="sm">{t("Publicar respuesta", "Post reply")}</button>
                </form>
              </details>
            )}
            {n.authorId === user.id && (
              <details className="pj-reply">
                <summary>{t("Editar", "Edit")}</summary>
                <form action={editPost.bind(null, n.id)}>
                  <textarea name="body" required rows={3} maxLength={TEXT_MAX.post} defaultValue={n.body} aria-label={t("Corregir mi comentario", "Correct my comment")} />
                  <button type="submit" className="sm">{t("Guardar corrección", "Save correction")}</button>
                </form>
              </details>
            )}
            {run && depth === 0 && <form action={flagPost.bind(null, n.id, "pin")}><button type="submit" className="link small">{n.pinned ? t("Quitar de arriba", "Unpin") : t("Fijar arriba", "Pin to top")}</button></form>}
            {run && <form action={flagPost.bind(null, n.id, "decision")}><button type="submit" className="link small">{n.decision ? t("Ya no es decisión", "Not a decision") : t("Marcar como decisión", "Mark as decision")}</button></form>}
            {(n.authorId === user.id || ger) && <form action={deletePost.bind(null, n.id)} data-confirm={t("¿Eliminar este comentario? No se puede deshacer.", "Delete this comment? This can't be undone.")}><button type="submit" className="link small">{t("Eliminar", "Delete")}</button></form>}
          </div>
        )}
        {n.replies.length > 0 && <ul className={`pj-thread${depth >= 5 ? " flat" : ""}`}>{n.replies.map((r) => <Post key={r.id} n={r} depth={depth + 1} />)}</ul>}
      </li>
    );
  };

  const AskOrAsked = ({ kind: k, targetId, asked, toId, done }: { kind: "item" | "date"; targetId: string; asked: boolean; toId: string | null; done: boolean }) => {
    if (done || !toId || toId === user.id || !canWork) return null;
    return asked ? <span className="sig wait">{t("Avance pedido", "Progress asked")}</span> : <form action={askProgress.bind(null, k, targetId)}><button type="submit" className="link small">{t("Pedir avance", "Ask for progress")}</button></form>;
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/proyectos">{t("Proyectos y notas", "Projects and notes")}</Link> · {p.code}</div>
          <h1>{p.title} {!p.closedAt && <span className={`sig ${priorityOf(p.priority).tone}`}>{t(priorityOf(p.priority).es, priorityOf(p.priority).en)}</span>} <span className={`sig ${health.tone}`}>{healthText(health, t)}</span></h1>
          <p>{p.summary}</p>
          {p.tags.length > 0 && <div className="pj-tags">{p.tags.map((k) => <Link key={k} href={`/proyectos?tag=${encodeURIComponent(k)}`}>{tagLabel(k, i.es)}</Link>)}</div>}
          <p className="src">{t("Lo inició", "Started by")} <b>{p.createdBy.name}</b> · {i.day(p.createdAt)}{p.lead.id !== p.createdBy.id && <> · {t("responsable", "lead")} <b>{p.lead.name}</b></>}
            {p.account && <> · {t("Cliente", "Customer")}: <Link href={`/accounts/${p.account.id}`}>{p.account.name}</Link></>}
            {p.deal && <> · {t("Necesidad", "Need")}: <Link href={`/deals/${p.deal.id}`}>{p.deal.code ?? p.deal.title}</Link></>}</p>
        </div>
        <div className="grow" />
        {seated
          ? <span className="sig ok">{t("Estás en la mesa redonda", "You are at the round table")}</span>
          : <form action={joinProject.bind(null, id)}><button type="submit">{t("Unirme a la mesa redonda", "Join the round table")}</button></form>}
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      {my?.how === "INVITED" && <div className="note attn">{t(`${my.addedByName ?? "Alguien"} te invitó a este proyecto. Si quieres participar, haz clic en «Unirme a la mesa redonda».`, `${my.addedByName ?? "Someone"} invited you to this project. If you want to take part, click “Join the round table”.`)}</div>}

      {asksToMe.length > 0 && (
        <section className="card" id="avance" data-zone="act">
          <h2>{t("Te piden el avance", "You are asked for progress")} <span className="sig attn">{asksToMe.length}</span></h2>
          <ul className="pj-dl">
            {asksToMe.map((n) => (
              <li key={n.id}>
                <div className="pj-dh"><b>{n.item?.title ?? n.date?.title}</b><span className="src">{t("pregunta", "asked by")} {n.fromName} · {when(n.createdAt)}</span></div>
                <form action={answerNudge.bind(null, n.id)} className="pj-ans">
                  <input name="note" maxLength={400} placeholder={t("Una línea de contexto (opcional)", "One line of context (optional)")} aria-label={t("Contexto de la respuesta", "Context for the answer")} />
                  <span className="row">{Object.keys(NUDGE_ANSWERS).map((k) => <button key={k} type="submit" name="answer" value={k} className={k === "ON_TRACK" ? "sm" : "secondary sm"}>{ans(k)}</button>)}</span>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" id="linea">
        <h2>{t("Línea de tiempo", "Timeline")} {p.closedAt ? <span className="sig ok">{t("Cerrado el", "Closed on")} {i.day(p.closedAt)}</span> : <span className="src">{t("Etapa", "Stage")} {at + 1} {t("de", "of")} 4</span>}</h2>
        <ol className="pj-line">
          {STAGES.map((s, k) => {
            const by = p[s.field];
            const st = p.closedAt || k < at ? "done" : k === at ? "now" : "later";
            const late = st === "now" && by && by < now;
            const its = p.items.filter((x) => x.stage === s.key);
            return (
              <li key={s.key} data-st={late ? "late" : st}>
                <span className="pj-dot" aria-hidden>{st === "done" ? "✓" : k + 1}</span>
                <b>{t(s.es, s.en)}</b>
                <span className="src">{t(s.hintEs, s.hintEn)}</span>
                <span className={`pj-by${late ? " risk-t" : ""}`}>{by ? `${late ? t("Se pasó: era para el", "Past due: it was for") : t("Para el", "By")} ${i.day(by)}` : t("Abierto, sin fecha", "Open, no date")}</span>
                {its.length > 0 && <a className="src" href="#tareas">{its.filter((x) => x.doneAt).length}/{its.length} {t("tareas hechas", "tasks done")}</a>}
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

      {!p.closedAt && (
        <section className="card" id="reloj" data-zone={health.key === "quiet" ? "risk" : health.key === "soon" ? "act" : undefined}>
          <h2>{t("Reloj del proyecto", "Project clock")} <span className={`sig ${health.key === "quiet" ? "risk" : health.key === "soon" ? "attn" : "ok"}`}>{health.daysLeft < 0 ? t(`Se pasó hace ${-health.daysLeft} d`, `${-health.daysLeft} d over`) : health.daysLeft === 0 ? t("Vence hoy", "Due today") : t(`Quedan ${health.daysLeft} d`, `${health.daysLeft} d left`)}</span></h2>
          <p className="small">{t(`Un proyecto puede pasar máximo ${QUIET_DAYS} días sin movimiento. Un comentario, una fecha, una tarea o un cambio de etapa cuentan como movimiento y reinician el reloj.`, `A project may go at most ${QUIET_DAYS} days without movement. A comment, a date, a task or a stage change count as movement and restart the clock.`)}</p>
          <div className="pj-clock" role="img" aria-label={t(`Quedan ${Math.max(0, health.daysLeft)} días`, `${Math.max(0, health.daysLeft)} days left`)}><span data-tone={health.key === "quiet" ? "risk" : health.key === "soon" ? "attn" : "ok"} style={{ width: `${Math.max(4, Math.min(100, (Math.max(0, health.daysLeft) / QUIET_DAYS) * 100))}%` }} /></div>
          <p className="src">{t("Último movimiento", "Last movement")}: {when(p.updatedAt)} · {t("Sin movimiento hasta máximo el", "Without movement until at most")} <b>{i.day(health.limit)}</b>{p.quietUntil && p.quietUntil >= health.limit ? ` (${t("con extensión de Gerencia", "with Management's extension")})` : ""}</p>
          {pendingExt ? (
            <div className="pj-ext">
              <span className="sig attn">{t("Extensión esperando a Gerencia", "Extension waiting for Management")}</span>
              <span className="small"><b>{pendingExt.requestedByName}</b> {t(`pidió ${pendingExt.days} días más el`, `asked for ${pendingExt.days} more days on`)} {i.day(pendingExt.createdAt)}: {pendingExt.reason}</span>
              {ger && (
                <form action={decideExtension.bind(null, pendingExt.id)} className="pj-ans">
                  <input name="note" maxLength={300} placeholder={t("Nota (obligatoria si no se aprueba)", "Note (required when not approving)")} aria-label={t("Nota de la decisión", "Decision note")} />
                  <span className="row"><button type="submit" name="decision" value="APPROVED" className="sm">{t("Aprobar extensión", "Approve extension")}</button><button type="submit" name="decision" value="REJECTED" className="secondary sm">{t("No aprobar", "Do not approve")}</button></span>
                </form>
              )}
            </div>
          ) : canWork ? (
            <details className="pj-edit">
              <summary>{t("Solicitar extensión", "Request extension")}</summary>
              <form action={requestExtension.bind(null, id)} className="pj-form">
                <label><span className="fname">{t("¿Por qué necesita más tiempo sin movimiento?", "Why does it need more time without movement?")}</span><input name="reason" required maxLength={400} placeholder={t("Ej.: esperamos la respuesta del proveedor hasta fin de mes", "E.g. we are waiting for the supplier's answer until month end")} /></label>
                <label><span className="fname">{t("¿Cuántos días más?", "How many more days?")}</span><select name="days" required defaultValue={EXT_DAYS[0]}>{EXT_DAYS.map((d) => <option key={d} value={d}>{d} {t("días", "days")}</option>)}</select></label>
                <button type="submit">{t("Enviar a Gerencia", "Send to Management")}</button>
              </form>
            </details>
          ) : <p className="src">{t("Para pedir una extensión, únete a la mesa redonda.", "To request an extension, join the round table.")}</p>}
          {p.extensions.filter((x) => x.status !== "REQUESTED").length > 0 && <ul className="pj-al">{p.extensions.filter((x) => x.status !== "REQUESTED").map((x) => <li key={x.id} className="src"><span className={`sig ${x.status === "APPROVED" ? "ok" : "wait"}`}>{x.status === "APPROVED" ? t(`+${x.days} d aprobados`, `+${x.days} d approved`) : t("No aprobada", "Not approved")}</span> {x.decidedByName} · {i.day(x.decidedAt)} · {x.reason}{x.decisionNote ? ` → ${x.decisionNote}` : ""}</li>)}</ul>}
        </section>
      )}

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
                  </label>
                  <label className={p.objective ? undefined : "req-miss"}><span className="fname">{t("Objetivo", "Objective")}</span><textarea name="objective" required rows={3} maxLength={TEXT_MAX.objective} defaultValue={p.objective ?? ""} /></label>
                  <fieldset className="pj-set">
                    <legend>{t("Etiquetas (opcional)", "Tags (optional)")}</legend>
                    <div className="pj-tags pick">
                      {Object.keys(PROJECT_TAGS).map((k) => <label key={k}><input type="checkbox" name="tags" value={k} defaultChecked={p.tags.includes(k)} /> {tagLabel(k, i.es)}</label>)}
                    </div>
                    <label>{t("Otra etiqueta (opcional, separa con comas)", "Another tag (optional, separate with commas)")}<input name="ownTags" maxLength={80} defaultValue={p.tags.filter((k) => !(k in PROJECT_TAGS)).join(", ")} /></label>
                  </fieldset>
                  <div className="pj-dates two">
                    <label>{t("Cliente relacionado (opcional)", "Related customer (optional)")}<select name="accountId" defaultValue={p.accountId ?? ""}><option value="">{t("Ninguno", "None")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                    <label>{t("Necesidad relacionada (código, opcional)", "Related Need (code, optional)")}<input name="dealCode" maxLength={40} defaultValue={p.deal?.code ?? ""} placeholder="J-2611-0147" /></label>
                  </div>
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

          <section className="card" id="tareas">
            <h2>{t("Tareas por etapa", "Tasks by stage")} <span className="src">{p.items.filter((x) => x.doneAt).length}/{p.items.length}</span></h2>
            {p.items.length === 0 && <p className="small muted">{t("Aún no hay tareas. Sirven para repartir quién hace qué en cada etapa.", "No tasks yet. They help share out who does what in each stage.")}{canWork ? t(" Agrega la primera aquí abajo.", " Add the first one right below.") : ""}</p>}
            {STAGES.filter((s) => p.items.some((x) => x.stage === s.key)).map((s) => (
              <div key={s.key} className="pj-stage">
                <h3 className="ie-h">{t(s.es, s.en)}{s.key === p.stage ? <span className="sig info">{t("etapa actual", "current stage")}</span> : null}</h3>
                <ul className="pj-items">
                  {p.items.filter((x) => x.stage === s.key).map((x) => {
                    const late = !x.doneAt && x.dueOn && x.dueOn < now;
                    return (
                      <li key={x.id} data-done={x.doneAt ? "1" : undefined}>
                        {canWork ? <form action={toggleItem.bind(null, x.id)}><button type="submit" className="secondary sm pj-chk" aria-label={x.doneAt ? t(`Marcar pendiente: ${x.title}`, `Mark as pending: ${x.title}`) : t(`Marcar hecha: ${x.title}`, `Mark as done: ${x.title}`)}>{x.doneAt ? "✓" : ""}</button></form> : <span className="pj-chk ro" aria-hidden>{x.doneAt ? "✓" : ""}</span>}
                        <span className="pj-it"><b>{x.title}</b><span className="src">{x.owner ? x.owner.name : t("Sin responsable", "Nobody in charge")}{x.dueOn ? ` · ${late ? t("se pasó: era para el", "past due: it was for") : t("para el", "by")} ${i.day(x.dueOn)}` : ""}{x.doneAt ? ` · ${t("hecha por", "done by")} ${x.doneByName ?? ""}` : ""}</span></span>
                        <span className="pj-acts">
                          {late && <span className="sig attn">{t("Atrasada", "Overdue")}</span>}
                          <AskOrAsked kind="item" targetId={x.id} asked={askedItem.has(x.id)} toId={x.ownerId} done={!!x.doneAt} />
                          {(run || x.ownerId === user.id) && <form action={removeItem.bind(null, x.id)} data-confirm={t("¿Quitar esta tarea?", "Remove this task?")}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {canWork ? (
              <details className="pj-edit" open={p.items.length === 0}>
                <summary>{t("+ Nueva tarea", "+ New task")}</summary>
                <form action={addItem.bind(null, id)} className="pj-form">
                  <label><span className="fname">{t("¿Qué hay que hacer?", "What has to be done?")}</span><input name="title" required maxLength={TEXT_MAX.date} /></label>
                  <div className="pj-dates two">
                    <label>{t("Responsable (opcional)", "In charge (optional)")}<select name="ownerId" defaultValue="">{<option value="">{t("Nadie todavía", "Nobody yet")}</option>}{tableSeats.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select></label>
                    <label>{t("Para el (opcional)", "By (optional)")}<input type="date" name="dueOn" /></label>
                    <label>{t("Etapa", "Stage")}<select name="stage" defaultValue={p.stage}>{STAGES.map((s) => <option key={s.key} value={s.key}>{t(s.es, s.en)}</option>)}</select></label>
                  </div>
                  <button type="submit">{t("Agregar tarea", "Add task")}</button>
                </form>
              </details>
            ) : <p className="src">{t("Para agregar tareas, únete a la mesa redonda.", "To add tasks, join the round table.")}</p>}
          </section>

          <section className="card" id="foro">
            <h2>{t("Foro", "Forum")} <span className="src">{thread.total === 1 ? t("1 comentario", "1 comment") : t(`${thread.total} comentarios`, `${thread.total} comments`)}</span></h2>
            {(thread.decisions.length > 0 || thread.customer.length > 0) && (
              <div className="pj-keep">
                {thread.decisions.length > 0 && <div><b>{t("Decisiones y acuerdos", "Decisions and agreements")}</b><ul>{thread.decisions.map((n) => <li key={n.id}><a href={`#c-${n.id}`}>{n.body.slice(0, 140)}{n.body.length > 140 ? "…" : ""}</a> <span className="src">{n.authorName} · {when(n.createdAt)}</span></li>)}</ul></div>}
                {thread.customer.length > 0 && <div><b>{t("Lo que dijo el cliente", "What the customer said")}</b><ul>{thread.customer.map((n) => <li key={n.id}><a href={`#c-${n.id}`}>{n.body.slice(0, 140)}{n.body.length > 140 ? "…" : ""}</a> <span className="src">{n.customerName ? `${n.customerName} · ` : ""}{t("lo anotó", "noted by")} {n.authorName} · {when(n.createdAt)}</span></li>)}</ul></div>}
              </div>
            )}
            {seated ? (
              <form action={postComment.bind(null, id)} className="pj-new">
                <i className="pj-av" aria-hidden>{initials(user.name)}</i>
                <textarea name="body" required rows={3} maxLength={TEXT_MAX.post} aria-label={t("Nuevo comentario", "New comment")} placeholder={t("Abre una conversación: una idea, un avance, una pregunta… (con @Nombre le avisas a alguien)", "Start a conversation: an idea, progress, a question… (@Name notifies someone)")} />
                <details className="pj-more">
                  <summary>{t("Adjuntar, avisar a alguien o anotar lo que dijo el cliente", "Attach, notify someone or note what the customer said")}</summary>
                  <label className="pj-file">{t(`Fotos o PDF (hasta ${POST_FILE_MAX}, 5 MB cada uno)`, `Photos or PDF (up to ${POST_FILE_MAX}, 5 MB each)`)}<input type="file" name="files" multiple accept="image/*,application/pdf" /></label>
                  <span className="src">{t("Avisar a (les llega a la campana):", "Notify (it reaches their bell):")}</span>
                  <div className="pj-tags pick">{tableSeats.filter((m) => m.userId !== user.id).map((m) => <label key={m.userId}><input type="checkbox" name="notify" value={m.userId} /> {m.user.name.split(" ")[0]}</label>)}</div>
                  <label className="pj-cust"><input type="checkbox" name="customerInput" value="1" /> <span>{t("Esto lo dijo el cliente (lo anoto yo, que hablé con él)", "The customer said this (I am noting it, I talked to them)")}</span></label>
                  <label>{t("¿Quién lo dijo? (opcional)", "Who said it? (optional)")}<input name="customerName" maxLength={120} placeholder={t("Nombre y empresa", "Name and company")} /></label>
                  <span className="src">{t("SOLU nunca le escribe al cliente desde un proyecto: el contacto es decisión tuya.", "SOLU never writes to the customer from a project: contact is your decision.")}</span>
                </details>
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
            {p.dates.length === 0 && <p className="small muted">{t("Aún no hay reuniones, citas ni tareas con fecha.", "No meetings, appointments or dated tasks yet.")}{canWork ? t(" Agrega la primera aquí abajo.", " Add the first one right below.") : ""}</p>}
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
                      {canWork && <form action={toggleDateDone.bind(null, d.id)}><button type="submit" className="link small">{d.doneAt ? t("Marcar pendiente", "Mark as pending") : t("Marcar hecha", "Mark as done")}</button></form>}
                      <AskOrAsked kind="date" targetId={d.id} asked={askedDate.has(d.id)} toId={d.createdById} done={!!d.doneAt} />
                      {(d.createdById === user.id || run) && <form action={removeDate.bind(null, d.id)} data-confirm={t("¿Quitar esta fecha del proyecto?", "Remove this date from the project?")}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {canWork ? (
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
            <p className="src">{user.outlookConnectedAt ? t("Tu Outlook está conectado: la alarma también queda en tu calendario.", "Your Outlook is connected: the alarm also goes to your calendar.") : <>{t("Queda en SOLU. ", "It stays in SOLU. ")}<Link href="/profile#outlook">{t("Conecta Outlook", "Connect Outlook")}</Link>{t(" para verla también allá.", " to see it there too.")}</>} <Link href="/profile#avisos-proyectos">{t("Elegir mis avisos de proyectos", "Choose my project notices")}</Link></p>
          </section>

          {run && (
            <section className="card" id="plantilla">
              <h2>{t("Guardar como plantilla", "Save as template")}</h2>
              <p className="src">{t("Para el próximo proyecto de este tipo: guarda la descripción, el objetivo, las etiquetas, la prioridad y las tareas por etapa (sin personas ni fechas).", "For the next project of this kind: it keeps the description, objective, tags, priority and tasks by stage (no people or dates).")}</p>
              <form action={saveTemplate.bind(null, id)} className="pj-form">
                <label><span className="fname">{t("Nombre de la plantilla", "Template name")}</span><input name="name" required maxLength={60} placeholder={t("Ej.: Comité de Navidad", "E.g. Christmas committee")} /></label>
                <button type="submit" className="secondary">{t("Guardar plantilla", "Save template")}</button>
              </form>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
