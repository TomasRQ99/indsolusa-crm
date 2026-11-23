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
import { DATE_KINDS, EXT_DAYS, EXT_MAX_DAYS, NUDGE_ANSWERS, POST_FILE_MAX, POST_FILE_MAX_BYTES, POST_FILE_MIMES, STAGES, TEXT_MAX, canRunProject, cleanTime, isSeated, isStage, mentionedIn, nextProjectCode, quietLimit, readPriority, readTags, stageIndex } from "@/lib/projects";

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
  const { link, badDeal } = await linkOf(fd);
  if (badDeal) list("err=necesidad#nuevo");
  const tplItems = await templateItems(fd, user.name);
  const p = await db.$transaction(async (tx) => tx.project.create({ data: {
    code: await nextProjectCode("PROJECT", tx), kind: "PROJECT", title: title!, summary: summary!, objective: objective!, tags: readTags(fd), priority: readPriority(fd), ...dates, ...link,
    items: { create: tplItems },
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
  const { link, badDeal } = await linkOf(fd);
  if (badDeal) page(id, "err=necesidad#objetivo");
  await db.project.update({ where: { id }, data: { title: title!, summary: summary!, objective: objective!, tags: readTags(fd), priority: readPriority(fd), ...dates, ...link } });
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
  const fromCustomer = fd.get("customerInput") === "1";
  const post = await db.projectPost.create({ data: { projectId: id, authorId: user.id, parentId, body: body!, customerInput: fromCustomer, customerName: fromCustomer ? fText(fd, "customerName", 120) : null } });
  const skipped = await afterPost(id, post.id, body!, fd, user);
  await Promise.all([
    db.project.update({ where: { id }, data: { updatedAt: new Date() } }),
    db.projectMember.updateMany({ where: { projectId: id, userId: user.id }, data: { seenAt: new Date() } }),
  ]);
  page(id, `ok=${skipped ? "publicado-archivos" : "publicado"}#c-${post.id}`);
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
  await db.project.update({ where: { id: d.projectId }, data: { updatedAt: new Date() } });
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

// =====================================================================================================
// Second wave (owner approved 2026-11-23): edit / pin / decision / customer input / files / mentions,
// a checklist per stage, "pedir avance", the month without movement and its extension, templates, alerts.
// =====================================================================================================

const touch = (id: string) => db.project.update({ where: { id }, data: { updatedAt: new Date() } });

/** The customer and the Need a project is about (both optional). A Need brings its customer. */
async function linkOf(fd: FormData) {
  const accId = String(fd.get("accountId") ?? "");
  const code = (fText(fd, "dealCode", 40) ?? "").toUpperCase();
  const deal = code ? await db.deal.findFirst({ where: { code: { equals: code, mode: "insensitive" } }, select: { id: true, accountId: true } }) : null;
  const acc = accId ? await db.account.findFirst({ where: { id: accId, internal: false }, select: { id: true } }) : null;
  return { link: { accountId: acc?.id ?? deal?.accountId ?? null, dealId: deal?.id ?? null }, badDeal: !!code && !deal };
}

async function templateItems(fd: FormData, by: string) {
  const id = String(fd.get("templateId") ?? "");
  if (!id) return [];
  const tpl = await db.projectTemplate.findUnique({ where: { id }, select: { items: true } });
  const rows = Array.isArray(tpl?.items) ? (tpl!.items as { stage?: unknown; title?: unknown }[]) : [];
  return rows.filter((x) => typeof x.title === "string" && typeof x.stage === "string" && isStage(x.stage as string)).slice(0, 60).map((x) => ({ stage: x.stage as string, title: String(x.title).slice(0, TEXT_MAX.date), createdByName: by }));
}

/** Files of a comment (photo or PDF) and the people it names: "@Nombre" in the text, or ticked under "Avisar a". */
async function afterPost(projectId: string, postId: string, body: string, fd: FormData, user: SessionUser) {
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, POST_FILE_MAX);
  let skipped = 0;
  for (const file of files) {
    if (file.size > POST_FILE_MAX_BYTES || !POST_FILE_MIMES.includes(file.type)) { skipped++; continue; }
    await db.projectPostFile.create({ data: { postId, name: file.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "archivo", mime: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()) } });
  }
  const people = await db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, select: { id: true, name: true } });
  const ticked = fd.getAll("notify").map(String).filter((x) => people.some((p) => p.id === x));
  const ids = [...new Set([...ticked, ...mentionedIn(body, people)])].filter((x) => x !== user.id).slice(0, 20);
  if (ids.length) await db.projectMention.createMany({ data: ids.map((userId) => ({ postId, projectId, userId, byName: user.name })), skipDuplicates: true });
  return skipped;
}

export async function editPost(postId: string, fd: FormData) {
  const user = await requireUser();
  const post = await db.projectPost.findUnique({ where: { id: postId }, select: { projectId: true, authorId: true, system: true, deletedAt: true } });
  if (!post) redirect("/proyectos");
  if (post!.system || post!.deletedAt || post!.authorId !== user.id) page(post!.projectId, "err=permiso#foro");
  const body = fText(fd, "body", TEXT_MAX.post);
  if (!body) page(post!.projectId, "err=vacio#foro");
  await db.projectPost.update({ where: { id: postId }, data: { body: body!, editedAt: new Date() } });
  page(post!.projectId, `ok=editado#c-${postId}`);
}

/** Pin a conversation to the top, or mark a comment as a decision: the lead, whoever started it, or Gerencia. */
export async function flagPost(postId: string, what: "pin" | "decision") {
  const user = await requireUser();
  const post = await db.projectPost.findUnique({ where: { id: postId }, select: { projectId: true, system: true, deletedAt: true, pinned: true, decision: true, parentId: true, project: { select: { leadId: true, createdById: true } } } });
  if (!post) redirect("/proyectos");
  if (post!.system || post!.deletedAt || !canRunProject(user, post!.project) || (what === "pin" && post!.parentId)) page(post!.projectId, "err=permiso#foro");
  await db.projectPost.update({ where: { id: postId }, data: what === "pin" ? { pinned: !post!.pinned } : { decision: !post!.decision } });
  page(post!.projectId, `ok=${what === "pin" ? "fijado" : "decision"}#c-${postId}`);
}

// ---------- Checklist per stage ----------

export async function addItem(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (!isSeated(await seatOf(id, user.id)) && !canRunProject(user, p)) page(id, "err=mesa#tareas");
  const title = fText(fd, "title", TEXT_MAX.date);
  if (!title) page(id, "err=tarea-datos#tareas");
  const stage = String(fd.get("stage") ?? "");
  const ownerId = String(fd.get("ownerId") ?? "");
  const owner = ownerId ? await db.projectMember.findFirst({ where: { projectId: id, userId: ownerId, how: { not: "INVITED" } }, select: { userId: true } }) : null;
  await db.projectItem.create({ data: { projectId: id, stage: isStage(stage) ? stage : p.stage, title: title!, ownerId: owner?.userId ?? null, dueOn: fDay(fd, "dueOn"), createdByName: user.name } });
  await touch(id);
  page(id, "ok=tarea#tareas");
}

async function loadItem(itemId: string) {
  const it = await db.projectItem.findUnique({ where: { id: itemId }, include: { project: { select: { id: true, kind: true, leadId: true, createdById: true } } } });
  if (!it || it.project.kind !== "PROJECT") redirect("/proyectos");
  return it!;
}

export async function toggleItem(itemId: string) {
  const user = await requireUser();
  const it = await loadItem(itemId);
  if (!isSeated(await seatOf(it.projectId, user.id)) && !canRunProject(user, it.project)) page(it.projectId, "err=mesa#tareas");
  await db.projectItem.update({ where: { id: itemId }, data: it.doneAt ? { doneAt: null, doneByName: null } : { doneAt: new Date(), doneByName: user.name } });
  await touch(it.projectId);
  page(it.projectId, "ok=tarea-hecha#tareas");
}

export async function removeItem(itemId: string) {
  const user = await requireUser();
  const it = await loadItem(itemId);
  if (!(canRunProject(user, it.project) || it.ownerId === user.id || it.createdByName === user.name)) page(it.projectId, "err=permiso#tareas");
  await db.projectItem.delete({ where: { id: itemId } });
  page(it.projectId, "ok=tarea-quitada#tareas");
}

// ---------- Pedir avance ----------

/** Someone at the table asks the person in charge how a checklist line or a date is going. One open question at a time. */
export async function askProgress(kind: "item" | "date", targetId: string) {
  const user = await requireUser();
  const target = kind === "item"
    ? await db.projectItem.findUnique({ where: { id: targetId }, select: { projectId: true, ownerId: true, doneAt: true } })
    : await db.projectDate.findUnique({ where: { id: targetId }, select: { projectId: true, createdById: true, doneAt: true } });
  if (!target) redirect("/proyectos");
  const projectId = target!.projectId;
  const p = await loadProject(projectId);
  const anchor = kind === "item" ? "#tareas" : "#fechas";
  if (!isSeated(await seatOf(projectId, user.id)) && !canRunProject(user, p)) page(projectId, `err=mesa${anchor}`);
  const toUserId = "ownerId" in target! ? target!.ownerId : (target as { createdById: string }).createdById;
  if (!toUserId || target!.doneAt) page(projectId, `err=avance-nadie${anchor}`);
  if (toUserId === user.id) page(projectId, `err=avance-propio${anchor}`);
  const open = await db.projectNudge.findFirst({ where: { ...(kind === "item" ? { itemId: targetId } : { dateId: targetId }), answeredAt: null }, select: { id: true } });
  if (open) page(projectId, `ok=avance-ya${anchor}`);
  await db.projectNudge.create({ data: { projectId, ...(kind === "item" ? { itemId: targetId } : { dateId: targetId }), toUserId: toUserId!, fromUserId: user.id, fromName: user.name } });
  page(projectId, `ok=avance-pedido${anchor}`);
}

/** One click to answer; the answer is written in the forum so the whole table sees it. */
export async function answerNudge(nudgeId: string, fd: FormData) {
  const user = await requireUser();
  const n = await db.projectNudge.findUnique({ where: { id: nudgeId }, include: { item: { select: { id: true, title: true } }, date: { select: { id: true, title: true } } } });
  if (!n) redirect("/proyectos");
  if (n!.toUserId !== user.id || n!.answeredAt) page(n!.projectId, "err=permiso#avance");
  const answer = String(fd.get("answer") ?? "");
  if (!(answer in NUDGE_ANSWERS)) page(n!.projectId, "err=avance-resp#avance");
  const note = fText(fd, "note", 400);
  const what = n!.item?.title ?? n!.date?.title ?? "";
  await db.projectNudge.update({ where: { id: nudgeId }, data: { answer, note, answeredAt: new Date() } });
  if (answer === "DONE") {
    if (n!.item) await db.projectItem.update({ where: { id: n!.item.id }, data: { doneAt: new Date(), doneByName: user.name } });
    if (n!.date) await db.projectDate.update({ where: { id: n!.date.id }, data: { doneAt: new Date() } });
  }
  const post = await db.projectPost.create({ data: { projectId: n!.projectId, authorId: user.id, body: `NUDGE:${answer}:${what}${note ? `\n${note}` : ""}`, system: true } });
  await touch(n!.projectId);
  page(n!.projectId, `ok=avance-dado#c-${post.id}`);
}

// ---------- The month without movement ----------

export async function requestExtension(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await loadProject(id);
  if (p.closedAt) page(id, "err=etapa#reloj");
  if (!isSeated(await seatOf(id, user.id)) && !canRunProject(user, p)) page(id, "err=mesa#reloj");
  const reason = fText(fd, "reason", 400);
  const days = fInt(fd, "days", 1, EXT_MAX_DAYS);
  if (!reason || !days || !(EXT_DAYS as readonly number[]).includes(days)) page(id, "err=ext-datos#reloj");
  if (await db.projectExtension.findFirst({ where: { projectId: id, status: "REQUESTED" }, select: { id: true } })) page(id, "ok=ext-ya#reloj");
  await db.projectExtension.create({ data: { projectId: id, requestedById: user.id, requestedByName: user.name, reason: reason!, days: days! } });
  await say(id, user.id, `EXT_REQ:${days}`);
  page(id, "ok=ext-pedida#reloj");
}

/** Gerencia decides. Approving moves the limit forward from the later of today and the current limit; it is not
 *  "movement", so the project's own clock is left as it was. */
export async function decideExtension(extId: string, fd: FormData) {
  const user = await requireUser();
  const x = await db.projectExtension.findUnique({ where: { id: extId }, include: { project: { select: { id: true, updatedAt: true, quietUntil: true } } } });
  if (!x) redirect("/proyectos");
  if (!isGerencia(user) || x!.status !== "REQUESTED") page(x!.projectId, "err=ext-permiso#reloj");
  const ok = fd.get("decision") === "APPROVED";
  const note = fText(fd, "note", 300);
  if (!ok && !note) page(x!.projectId, "err=ext-motivo#reloj");
  await db.projectExtension.update({ where: { id: extId }, data: { status: ok ? "APPROVED" : "REJECTED", decidedByName: user.name, decisionNote: note, decidedAt: new Date() } });
  if (ok) {
    const from = Math.max(today().getTime(), quietLimit(x!.project).getTime());
    await db.project.update({ where: { id: x!.projectId }, data: { quietUntil: new Date(from + x!.days * 864e5), updatedAt: x!.project.updatedAt } });
  }
  await say(x!.projectId, user.id, ok ? `EXT_OK:${x!.days}` : `EXT_NO:${note ?? ""}`);
  page(x!.projectId, `ok=${ok ? "ext-aprobada" : "ext-negada"}#reloj`);
}

// ---------- Templates ----------

export async function saveTemplate(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await db.project.findFirst({ where: { id, kind: "PROJECT" }, select: { id: true, summary: true, objective: true, tags: true, priority: true, leadId: true, createdById: true, items: { orderBy: { createdAt: "asc" }, select: { stage: true, title: true } } } });
  if (!p) redirect("/proyectos");
  if (!canRunProject(user, p!)) page(id, "err=permiso#plantilla");
  const name = fText(fd, "name", 60);
  if (!name) page(id, "err=plantilla-nombre#plantilla");
  if (await db.projectTemplate.findFirst({ where: { name: { equals: name!, mode: "insensitive" } }, select: { id: true } })) page(id, "err=plantilla-existe#plantilla");
  await db.projectTemplate.create({ data: { name: name!, summary: p!.summary, objective: p!.objective, tags: p!.tags, priority: p!.priority, items: p!.items, createdByName: user.name } });
  page(id, "ok=plantilla#plantilla");
}

export async function deleteTemplate(templateId: string) {
  const user = await requireUser();
  if (!isGerencia(user)) list("err=permiso#nuevo");
  await db.projectTemplate.deleteMany({ where: { id: templateId } });
  list("ok=plantilla-borrada#nuevo");
}

// ---------- My alerts (Mi perfil) ----------

export async function saveProjectAlerts(fd: FormData) {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { projectAlerts: fd.get("projectAlerts") === "1", projectAsks: fd.get("projectAsks") === "1" } });
  go("/profile?ok=avisos-proyectos#avisos-proyectos");
}
