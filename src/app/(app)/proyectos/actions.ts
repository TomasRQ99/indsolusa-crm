"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { dayInput, today } from "@/lib/domain";
import { fDay, fInt, fText } from "@/lib/fd";
import { bogotaInput, createEvent } from "@/lib/outlook";
import { taskEventContent } from "@/lib/outlook-sync";
import { DATE_KINDS, STAGES, TEXT_MAX, canRunProject, cleanTime, isSeated, isStage, nextProjectCode, readPriority, readTags, stageIndex } from "@/lib/projects";

// Proyectos y notas. Rules (owner, 2026-11-23): Gerencia creates projects for anyone and assigns people; anyone
// creates their own and invites people; everything is visible to everyone; joining needs no approval; only people
// seated at the round table write in the forum.

const go = (path: string): never => { refreshApp(); redirect(path); };
const list = (qs: string) => go(`/proyectos?${qs}`);
const page = (id: string, qs: string) => go(`/proyectos/${id}?${qs}`);
const notes = (qs: string) => go(`/proyectos/notas?${qs}`);

async function loadProject(id: string) {
  const p = await db.project.findUnique({ where: { id }, select: { id: true, kind: true, title: true, stage: true, leadId: true, createdById: true, closedAt: true } });
  if (!p || p.kind !== "PROJECT") redirect("/proyectos");
  return p!;
}
const seatOf = (projectId: string, userId: string) => db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { id: true, how: true } });
const say = (projectId: string, authorId: string, body: string) => db.projectPost.create({ data: { projectId, authorId, body, system: true } });

/** Saved teams ticked on a form: only Gerencia adds them. Each brings its current people. */
async function pickedTeams(fd: FormData, ger: boolean) {
  const ids = ger ? [...new Set(fd.getAll("teams").map(String).filter(Boolean))] : [];
  return ids.length ? db.projectTeam.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, members: { select: { userId: true } } } }) : [];
}

async function activePeople(ids: string[], except: string[]) {
  const wanted = [...new Set(ids)].filter((x) => x && !except.includes(x));
  if (!wanted.length) return [];
  return db.user.findMany({ where: { id: { in: wanted }, active: true, role: { not: "JUNTA" } }, select: { id: true, name: true } });
}

/** The four "finish by" dates of the form, and whether they are in order. */
function timeline(fd: FormData) {
  const startOn = fDay(fd, "startOn");
  const by = { objectivesBy: fDay(fd, "objectivesBy"), planBy: fDay(fd, "planBy"), executionBy: fDay(fd, "executionBy"), resultsBy: fDay(fd, "resultsBy") };
  const seq = [startOn, by.objectivesBy, by.planBy, by.executionBy, by.resultsBy].filter((d): d is Date => !!d);
  return { startOn, ...by, inOrder: seq.every((d, k) => k === 0 || d >= seq[k - 1]) };
}

/** An alarm = a to-do of the person with day and hour: it shows in Mi Día → Hoy («Tu agenda») when the day comes,
 *  in Pendientes from now, and in the person's Outlook when it is connected. */
async function makeAlarm(user: SessionUser, a: { projectId: string; dateId?: string; title: string; day: Date; time: string | null; minutes: number }) {
  const at = bogotaInput(dayInput(a.day), a.time ?? "08:00");
  const task = await db.task.create({ data: { title: a.title.slice(0, 200), dueDate: a.day, plannedFor: a.day, scheduledAt: at, estimateMinutes: a.minutes, assigneeId: user.id, projectId: a.projectId, projectDateId: a.dateId ?? null } });
  if (!user.outlookConnectedAt || at.getTime() < Date.now()) return false;
  try {
    const c = await taskEventContent(user, task.id);
    const ev = await createEvent(user.email, { subject: c.subject, start: at, minutes: a.minutes, body: a.title, html: c.html, link: c.link, transactionId: `solu-task-${task.id}` });
    await db.task.update({ where: { id: task.id }, data: { outlookEventId: ev.id } });
    return true;
  } catch { return false; } // the alarm stays in SOLU even when Outlook does not answer
}

// ---------- Create ----------

export async function createProject(fd: FormData) {
  const user = await requireUser();
  const title = fText(fd, "title", TEXT_MAX.title), summary = fText(fd, "summary", TEXT_MAX.summary), objective = fText(fd, "objective", TEXT_MAX.objective);
  if (!title || !summary || !objective) list("err=datos#nuevo");
  const tl = timeline(fd);
  if (!tl.inOrder) list("err=fechas#nuevo");
  const ger = isGerencia(user);
  // Gerencia may create it for someone else; everyone else creates their own.
  let leadId = user.id;
  const forId = String(fd.get("leadId") ?? "");
  if (ger && forId && forId !== user.id) { const [lead] = await activePeople([forId], []); if (!lead) list("err=persona#nuevo"); leadId = lead!.id; }
  const teams = await pickedTeams(fd, ger);
  const people = await activePeople([...fd.getAll("people").map(String), ...teams.flatMap((x) => x.members.map((m) => m.userId))], [leadId]);
  const { inOrder: _o, ...dates } = tl; void _o;
  const p = await db.$transaction(async (tx) => tx.project.create({ data: {
    code: await nextProjectCode("PROJECT", tx), kind: "PROJECT", title: title!, summary: summary!, objective: objective!, tags: readTags(fd), priority: readPriority(fd), ...dates,
    createdById: user.id, leadId,
    teams: { create: teams.map((x) => ({ teamId: x.id, addedByName: user.name })) },
    members: { create: [
      { userId: leadId, how: "LEAD", addedByName: user.name, seenAt: leadId === user.id ? new Date() : null },
      // Gerencia assigns (the person is in); anyone else invites (the person decides). The creator never invites themselves.
      ...people.filter((x) => x.id !== user.id || ger).map((x) => ({ userId: x.id, how: x.id === user.id ? "JOINED" : ger ? "ASSIGNED" : "INVITED", addedByName: user.name, seenAt: x.id === user.id ? new Date() : null })),
    ] },
  } }));
  page(p.id, "ok=creado");
}

export async function updateProject(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (!canRunProject(user, p)) page(id, "err=permiso");
  const title = fText(fd, "title", TEXT_MAX.title), summary = fText(fd, "summary", TEXT_MAX.summary), objective = fText(fd, "objective", TEXT_MAX.objective);
  if (!title || !summary || !objective) page(id, "err=datos#objetivo");
  const { inOrder, ...dates } = timeline(fd);
  if (!inOrder) page(id, "err=fechas#objetivo");
  await db.project.update({ where: { id }, data: { title: title!, summary: summary!, objective: objective!, tags: readTags(fd), priority: readPriority(fd), ...dates } });
  page(id, "ok=guardado#objetivo");
}

// ---------- Round table ----------

export async function joinProject(id: string) {
  const user = await requireUser();
  const p = await loadProject(id);
  const seat = await seatOf(id, user.id);
  if (!isSeated(seat)) {
    await db.projectMember.upsert({ where: { projectId_userId: { projectId: id, userId: user.id } }, create: { projectId: id, userId: user.id, how: "JOINED", seenAt: new Date() }, update: { how: "JOINED", seenAt: new Date() } });
    await say(id, user.id, "JOINED");
    await db.project.update({ where: { id }, data: { updatedAt: new Date() } });
  }
  page(p.id, "ok=unido#foro");
}

export async function declineInvite(id: string) {
  const user = await requireUser();
  await db.projectMember.deleteMany({ where: { projectId: id, userId: user.id, how: "INVITED" } });
  list("ok=ahora-no");
}

export async function leaveProject(id: string) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (p.leadId === user.id) page(id, "err=responsable#mesa");
  const r = await db.projectMember.deleteMany({ where: { projectId: id, userId: user.id } });
  if (r.count) await say(id, user.id, "LEFT");
  page(id, "ok=saliste");
}

/** Anyone seated invites; Gerencia assigns. People already at the table are left as they are. */
export async function addPeople(id: string, fd: FormData) {
  const user = await requireUser();
  await loadProject(id);
  const ger = isGerencia(user);
  if (!ger && !isSeated(await seatOf(id, user.id))) page(id, "err=mesa#mesa");
  const current = await db.projectMember.findMany({ where: { projectId: id }, select: { userId: true, how: true } });
  const seated = current.filter(isSeated).map((m) => m.userId);
  const teams = await pickedTeams(fd, ger);
  const linked = new Set((await db.projectTeamLink.findMany({ where: { projectId: id }, select: { teamId: true } })).map((x) => x.teamId));
  const newTeams = teams.filter((x) => !linked.has(x.id));
  const people = await activePeople([...fd.getAll("people").map(String), ...teams.flatMap((x) => x.members.map((m) => m.userId))], [...seated, ...(teams.length ? [] : [user.id])]);
  if (!people.length && !newTeams.length) page(id, "err=nadie#mesa");
  if (newTeams.length) await db.projectTeamLink.createMany({ data: newTeams.map((x) => ({ projectId: id, teamId: x.id, addedByName: user.name })), skipDuplicates: true });
  for (const x of people) {
    const how = ger ? "ASSIGNED" : "INVITED";
    await db.projectMember.upsert({ where: { projectId_userId: { projectId: id, userId: x.id } }, create: { projectId: id, userId: x.id, how, addedByName: user.name }, update: ger ? { how, addedByName: user.name, seenAt: null } : {} });
  }
  page(id, `ok=${ger ? "asignados" : "invitados"}#mesa`);
}

/** Gerencia or the lead takes someone off the table (never the lead). */
export async function removeMember(id: string, userId: string) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (!(isGerencia(user) || p.leadId === user.id) || userId === p.leadId) page(id, "err=permiso#mesa");
  await db.projectMember.deleteMany({ where: { projectId: id, userId } });
  page(id, "ok=quitado#mesa");
}

// ---------- Forum ----------

export async function postComment(id: string, fd: FormData) {
  const user = await requireUser();
  await loadProject(id);
  if (!isSeated(await seatOf(id, user.id))) page(id, "err=mesa#foro");
  const body = fText(fd, "body", TEXT_MAX.post);
  if (!body) page(id, "err=vacio#foro");
  const parentId = String(fd.get("parentId") ?? "") || null;
  if (parentId) { const parent = await db.projectPost.findFirst({ where: { id: parentId, projectId: id, system: false }, select: { id: true } }); if (!parent) page(id, "err=hilo#foro"); }
  const post = await db.projectPost.create({ data: { projectId: id, authorId: user.id, parentId, body: body! } });
  await Promise.all([
    db.project.update({ where: { id }, data: { updatedAt: new Date() } }),
    db.projectMember.updateMany({ where: { projectId: id, userId: user.id }, data: { seenAt: new Date() } }),
  ]);
  page(id, `ok=publicado#c-${post.id}`);
}

export async function deletePost(postId: string) {
  const user = await requireUser();
  const post = await db.projectPost.findUnique({ where: { id: postId }, select: { projectId: true, authorId: true, system: true } });
  if (!post) redirect("/proyectos");
  if (post!.system || !(post!.authorId === user.id || isGerencia(user))) page(post!.projectId, "err=permiso#foro");
  await db.projectPost.update({ where: { id: postId }, data: { deletedAt: new Date() } });
  page(post!.projectId, "ok=borrado#foro");
}

// ---------- Timeline ----------

export async function moveStage(id: string, stage: string) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (!canRunProject(user, p)) page(id, "err=permiso#linea");
  if (!isStage(stage) || stage === p.stage || p.closedAt) page(id, "err=etapa#linea");
  await db.project.update({ where: { id }, data: { stage } });
  await say(id, user.id, `STAGE:${stage}`);
  page(id, "ok=etapa#linea");
}

export async function closeProject(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (!canRunProject(user, p)) page(id, "err=permiso#resultado");
  const result = fText(fd, "result", TEXT_MAX.objective);
  if (!result) page(id, "err=resultado#resultado");
  const close = fd.get("close") === "1";
  await db.project.update({ where: { id }, data: { result: result!, stage: "RESULTADOS", closedAt: close ? p.closedAt ?? new Date() : p.closedAt } });
  if (close && !p.closedAt) await say(id, user.id, "CLOSED");
  else if (p.stage !== "RESULTADOS") await say(id, user.id, "STAGE:RESULTADOS");
  page(id, `ok=${close ? "cerrado" : "resultado"}#resultado`);
}

export async function reopenProject(id: string) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (!canRunProject(user, p)) page(id, "err=permiso#resultado");
  if (p.closedAt) { await db.project.update({ where: { id }, data: { closedAt: null } }); await say(id, user.id, "REOPENED"); }
  page(id, "ok=reabierto#linea");
}

export async function addDate(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (!isSeated(await seatOf(id, user.id)) && !canRunProject(user, p)) page(id, "err=mesa#fechas");
  const title = fText(fd, "title", TEXT_MAX.date), day = fDay(fd, "day"), kind = String(fd.get("kind") ?? "");
  if (!title || !day || !DATE_KINDS[kind]) page(id, "err=fecha-datos#fechas");
  const stage = String(fd.get("stage") ?? "");
  await db.projectDate.create({ data: { projectId: id, title: title!, day: day!, kind, time: cleanTime(fd.get("time")), minutes: fInt(fd, "minutes", 5, 600) ?? 30, stage: isStage(stage) ? stage : STAGES[stageIndex(p.stage)].key, createdById: user.id, createdByName: user.name } });
  await db.project.update({ where: { id }, data: { updatedAt: new Date() } });
  page(id, "ok=fecha#fechas");
}

async function loadDate(dateId: string) {
  const d = await db.projectDate.findUnique({ where: { id: dateId }, include: { project: { select: { id: true, kind: true, title: true, code: true, leadId: true, createdById: true } } } });
  if (!d || d.project.kind !== "PROJECT") redirect("/proyectos");
  return d!;
}

export async function toggleDateDone(dateId: string) {
  const user = await requireUser();
  const d = await loadDate(dateId);
  if (!isSeated(await seatOf(d.projectId, user.id)) && !canRunProject(user, d.project)) page(d.projectId, "err=mesa#fechas");
  await db.projectDate.update({ where: { id: dateId }, data: { doneAt: d.doneAt ? null : new Date() } });
  page(d.projectId, "ok=fecha-hecha#fechas");
}

export async function removeDate(dateId: string) {
  const user = await requireUser();
  const d = await loadDate(dateId);
  if (!(d.createdById === user.id || canRunProject(user, d.project))) page(d.projectId, "err=permiso#fechas");
  await db.projectDate.delete({ where: { id: dateId } });
  page(d.projectId, "ok=fecha-quitada#fechas");
}

// ---------- Alarms in Mi Día ----------

/** One date of the timeline → my Mi Día (and my Outlook when connected). Once per person and date. */
export async function alarmForDate(dateId: string) {
  const user = await requireUser();
  const d = await loadDate(dateId);
  if (d.day < today()) page(d.projectId, "err=pasada#fechas");
  const has = await db.task.findFirst({ where: { projectDateId: dateId, assigneeId: user.id, status: "OPEN" }, select: { id: true } });
  if (has) page(d.projectId, "ok=alarma-ya#fechas");
  const k = DATE_KINDS[d.kind] ?? DATE_KINDS.DELIVERABLE;
  const inOutlook = await makeAlarm(user, { projectId: d.projectId, dateId, title: `${user.lang === "EN" ? k.en : k.es}: ${d.title} · ${d.project.title}`, day: d.day, time: d.time, minutes: d.minutes });
  page(d.projectId, `ok=${inOutlook ? "alarma-outlook" : "alarma"}#fechas`);
}

/** A free alarm about the project: the day, the hour and what to remember. */
export async function alarmForProject(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await loadProject(id);
  const day = fDay(fd, "day");
  if (!day) page(id, "err=alarma-dia#alarma");
  if (day! < today()) page(id, "err=pasada#alarma");
  const what = fText(fd, "what", 140) ?? (user.lang === "EN" ? "Check the project" : "Revisar el proyecto");
  const inOutlook = await makeAlarm(user, { projectId: id, title: `${what} · ${p.title}`, day: day!, time: cleanTime(fd.get("time")), minutes: 15 });
  page(id, `ok=${inOutlook ? "alarma-outlook" : "alarma"}#alarma`);
}

// ---------- Notes (personal: only the author sees them) ----------

export async function createNote(fd: FormData) {
  const user = await requireUser();
  const title = fText(fd, "title", TEXT_MAX.title);
  if (!title) notes("err=datos#nueva");
  const day = fDay(fd, "day");
  if (day && day < today()) notes("err=pasada#nueva");
  const n = await db.$transaction(async (tx) => tx.project.create({ data: { code: await nextProjectCode("NOTE", tx), kind: "NOTE", title: title!, summary: fText(fd, "summary", TEXT_MAX.note) ?? "", createdById: user.id, leadId: user.id } }));
  let inOutlook = false;
  if (day) inOutlook = await makeAlarm(user, { projectId: n.id, title: title!, day, time: cleanTime(fd.get("time")), minutes: 15 });
  notes(`ok=${day ? (inOutlook ? "nota-alarma-outlook" : "nota-alarma") : "nota"}#n-${n.id}`);
}

async function loadNote(id: string, userId: string) {
  const n = await db.project.findFirst({ where: { id, kind: "NOTE", createdById: userId }, select: { id: true, title: true, summary: true, closedAt: true } });
  if (!n) redirect("/proyectos/notas");
  return n!;
}

export async function alarmForNote(id: string, fd: FormData) {
  const user = await requireUser();
  const n = await loadNote(id, user.id);
  const day = fDay(fd, "day");
  if (!day) notes(`err=alarma-dia#n-${id}`);
  if (day! < today()) notes(`err=pasada#n-${id}`);
  const inOutlook = await makeAlarm(user, { projectId: id, title: n.title, day: day!, time: cleanTime(fd.get("time")), minutes: 15 });
  notes(`ok=${inOutlook ? "alarma-outlook" : "alarma"}#n-${id}`);
}

/** Done / not done. Marking it done also closes its open alarms. */
export async function toggleNote(id: string) {
  const user = await requireUser();
  const n = await loadNote(id, user.id);
  await db.project.update({ where: { id }, data: { closedAt: n.closedAt ? null : new Date() } });
  if (!n.closedAt) await db.task.updateMany({ where: { projectId: id, assigneeId: user.id, status: "OPEN" }, data: { status: "DONE", completedAt: new Date() } });
  notes(`ok=${n.closedAt ? "nota-abierta" : "nota-hecha"}`);
}

export async function deleteNote(id: string) {
  const user = await requireUser();
  await loadNote(id, user.id);
  await db.project.delete({ where: { id } });
  notes("ok=nota-borrada");
}

/** A note that grew: it becomes a project everyone sees, with its author as lead. The objective is asked next. */
export async function noteToProject(id: string) {
  const user = await requireUser();
  const n = await loadNote(id, user.id);
  await db.$transaction(async (tx) => {
    await tx.project.update({ where: { id }, data: { kind: "PROJECT", code: await nextProjectCode("PROJECT", tx), summary: (n.summary || n.title).slice(0, TEXT_MAX.summary), closedAt: null } });
    await tx.projectMember.create({ data: { projectId: id, userId: user.id, how: "LEAD", addedByName: user.name, seenAt: new Date() } });
  });
  page(id, "ok=convertida#objetivo");
}
