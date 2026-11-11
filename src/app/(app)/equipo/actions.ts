"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { addDays, today } from "@/lib/domain";
import { fDay, fPick, fText } from "@/lib/fd";
import {
  ACTION_KINDS, DIMS, FEEDBACK_PARTS, FEEDBACK_RELATIONS, INSTRUMENTS, MEETING_KINDS, MENTOR_KINDS, PRIVACY, PROFILE_BLOCKS,
  assessmentIssues, characterIssues, closeIssues, commitmentIssues, cycleEnd, entryIssues, feedbackIssues, mayGuide, meetingCloseIssues, objectiveIssues,
} from "@/lib/team-rules";
import { getTeamPolicy, leaderIdsOf, relationTo } from "@/lib/team-store";
import { meetingAgenda } from "@/lib/team-views";

// Módulo 16 · the person's own records and the development cycle. The person writes about themselves; a leader or a
// mentor accompanies and may add what they observed, always visible to the person. Nobody else writes here.
// Every agreement leaves with its next movement, the evidence expected and the moment of review (§15).

const go = (path: string): never => { refreshApp(); redirect(path); };
/** Where to return: only inside Equipo, whatever the form says. */
const backOf = (fd: FormData, fallback: string) => { const b = String(fd.get("back") ?? ""); return /^\/equipo\/[a-z0-9\-/]*(\?[^#\s]*)?$/i.test(b) ? b : fallback; };
const withQs = (path: string, qs: string, hash = "") => `${path}${path.includes("?") ? "&" : "?"}${qs}${hash}`;
const personQs = (id: string, me: string) => (id === me ? "" : `?p=${id}`);

// ---------- Team Member 360 ----------

export async function addEntry(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, `/equipo/perfil${personQs(personId, user.id)}`);
  const rel = await relationTo(user, personId);
  const block = fPick(fd, "block", PROFILE_BLOCKS);
  // A leader may add what they see in the person's being, talents, doing and having; never a story or a reflection.
  const leaderMay = rel.leader && !!block && ["SER", "TALENT", "HACER", "TENER"].includes(block);
  if (!rel.self && !leaderMay) go(withQs(back, "err=permiso"));
  // What someone else writes about a person is never hidden from that person, so it cannot be private.
  const privacy = rel.self ? fPick(fd, "privacy", PRIVACY) ?? (block ? PROFILE_BLOCKS[block].defaultPrivacy : null) : "SHARED";
  const e = { block, kind: fText(fd, "kind", 30), text: fText(fd, "text", 400), privacy };
  if (entryIssues(e).length) go(withQs(back, "err=linea", `#b-${block ?? ""}`));
  await db.profileEntry.create({ data: { userId: personId, block: e.block!, kind: e.kind!, text: e.text!, detail: fText(fd, "detail", 600), privacy: e.privacy!, source: rel.self ? "SELF" : "LEADER", addedById: user.id, addedByName: user.name } });
  go(withQs(back, "ok=linea", `#b-${block}`));
}

/** Only the person decides who sees a line of their profile. */
export async function setEntryPrivacy(id: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/equipo/perfil");
  const e = await db.profileEntry.findUnique({ where: { id }, select: { userId: true, block: true, source: true } });
  const privacy = fPick(fd, "privacy", PRIVACY);
  if (!e || e.userId !== user.id || !privacy) go(withQs(back, "err=permiso"));
  // A line the leader wrote stays visible to the leader: the person may open it wider, not hide it from its author.
  if (e!.source === "LEADER" && privacy === "PRIVATE") go(withQs(back, "err=privado-lider", `#b-${e!.block}`));
  await db.profileEntry.update({ where: { id }, data: { privacy: privacy! } });
  go(withQs(back, "ok=privacidad", `#b-${e!.block}`));
}

export async function archiveEntry(id: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/equipo/perfil");
  const e = await db.profileEntry.findUnique({ where: { id }, select: { userId: true, block: true, addedById: true } });
  if (!e || !(e.userId === user.id || e.addedById === user.id)) go(withQs(back, "err=permiso"));
  await db.profileEntry.update({ where: { id }, data: { archivedAt: new Date() } });
  go(withQs(back, "ok=quitada", `#b-${e!.block}`));
}

/** Assessments are optional and belong to the person: only they add or remove one. */
export async function addAssessment(fd: FormData) {
  const user = await requireUser();
  const back = "/equipo/perfil";
  const a = { instrument: fPick(fd, "instrument", INSTRUMENTS), result: fText(fd, "result", 600), source: fText(fd, "source", 200), takenOn: fDay(fd, "takenOn"), privacy: fd.get("privacy") === "SHARED" ? "SHARED" : "PRIVATE" };
  if (assessmentIssues(a, today()).length) go(`${back}?err=assessment#assessments`);
  await db.personAssessment.create({ data: { userId: user.id, instrument: a.instrument!, label: fText(fd, "label", 80), result: a.result!, source: a.source!, takenOn: a.takenOn!, privacy: a.privacy, addedByName: user.name } });
  go(`${back}?ok=assessment#assessments`);
}
export async function removeAssessment(id: string) {
  const user = await requireUser();
  await db.personAssessment.deleteMany({ where: { id, userId: user.id } });
  go("/equipo/perfil?ok=quitada#assessments");
}

/** Character is recorded as something the person did, in a situation, on a day. Never from a test (AC2). */
export async function addCharacterEvidence(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, `/equipo/perfil${personQs(personId, user.id)}`);
  const rel = await relationTo(user, personId);
  if (!mayGuide(rel)) go(withQs(back, "err=permiso"));
  const pol = await getTeamPolicy();
  const e = { dimension: fText(fd, "dimension", 80), behavior: fText(fd, "behavior", 800), context: fText(fd, "context", 600), observedOn: fDay(fd, "observedOn"), sourceKind: rel.self ? "SELF" : fText(fd, "sourceKind", 20) };
  const issues = characterIssues(e, pol.value.dimensions, today());
  if (issues.includes("test")) go(withQs(back, "err=test", "#caracter"));
  if (issues.length) go(withQs(back, "err=caracter", "#caracter"));
  const asked = fPick(fd, "privacy", PRIVACY);
  const privacy = rel.self ? asked ?? "SHARED" : asked === "ORG" ? "ORG" : "SHARED";
  await db.characterEvidence.create({ data: { userId: personId, dimension: e.dimension!, behavior: e.behavior!, context: e.context!, observedOn: e.observedOn!, sourceKind: e.sourceKind!, sourceRef: fText(fd, "sourceRef", 200), privacy, recordedById: user.id, recordedByName: user.name } });
  go(withQs(back, "ok=caracter", "#caracter"));
}
export async function withdrawCharacterEvidence(id: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/equipo/perfil");
  const e = await db.characterEvidence.findUnique({ where: { id }, select: { recordedById: true, withdrawnAt: true } });
  const note = fText(fd, "note", 300);
  if (!e || e.recordedById !== user.id || e.withdrawnAt) go(withQs(back, "err=permiso"));
  if (!note) go(withQs(back, "err=nota", "#caracter"));
  await db.characterEvidence.update({ where: { id }, data: { withdrawnAt: new Date(), withdrawnNote: `${note} · ${user.name}` } });
  go(withQs(back, "ok=quitada", "#caracter"));
}

// ---------- Development cycle ----------

const devPath = (personId: string, me: string) => `/equipo/desarrollo${personQs(personId, me)}`;

export async function openPlan(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = devPath(personId, user.id);
  const rel = await relationTo(user, personId);
  if (!mayGuide(rel)) go(withQs(back, "err=permiso"));
  const startsOn = fDay(fd, "startsOn") ?? today();
  const [pol, active, last, leaders] = await Promise.all([
    getTeamPolicy(), db.developmentPlan.count({ where: { userId: personId, status: "ACTIVE" } }),
    db.developmentPlan.findFirst({ where: { userId: personId }, orderBy: { cycle: "desc" }, select: { id: true, cycle: true, endsOn: true } }), leaderIdsOf(personId),
  ]);
  if (active) go(withQs(back, "err=ciclo-abierto"));
  if (Math.abs(+startsOn - +today()) / 864e5 > 31) go(withQs(back, "err=inicio", "#ciclo"));
  const pick = async (k: string) => { const id = fText(fd, k, 40); return id && id !== personId ? (await db.user.findFirst({ where: { id, active: true }, select: { id: true } }))?.id ?? null : null; };
  const leaderId = (await pick("leaderId")) ?? leaders[0] ?? (rel.leader ? user.id : null);
  const mentorId = await pick("mentorId");
  await db.developmentPlan.create({ data: { userId: personId, cycle: (last?.cycle ?? 0) + 1, startsOn, endsOn: cycleEnd(startsOn, pol.value), purpose: fText(fd, "purpose", 800), leaderId, mentorId, mentorKind: mentorId ? fPick(fd, "mentorKind", MENTOR_KINDS) : null, previousId: last?.id ?? null, policyVersion: pol.version, createdByName: user.name } });
  go(withQs(back, "ok=ciclo"));
}

export async function updatePlan(planId: string, fd: FormData) {
  const user = await requireUser();
  const plan = await db.developmentPlan.findUnique({ where: { id: planId }, select: { userId: true, status: true } });
  if (!plan) redirect("/equipo/desarrollo");
  const back = devPath(plan!.userId, user.id);
  const rel = await relationTo(user, plan!.userId);
  if (!mayGuide(rel) || plan!.status !== "ACTIVE") go(withQs(back, "err=permiso"));
  const pick = async (k: string) => { const id = fText(fd, k, 40); return id && id !== plan!.userId ? (await db.user.findFirst({ where: { id, active: true }, select: { id: true } }))?.id ?? null : null; };
  const mentorId = await pick("mentorId");
  await db.developmentPlan.update({ where: { id: planId }, data: { purpose: fText(fd, "purpose", 800), leaderId: await pick("leaderId"), mentorId, mentorKind: mentorId ? fPick(fd, "mentorKind", MENTOR_KINDS) : null } });
  go(withQs(back, "ok=ciclo-guardado"));
}

/** A cycle closes when every objective has been closed, each with its evidence or its reason. */
export async function closePlan(planId: string, fd: FormData) {
  const user = await requireUser();
  const plan = await db.developmentPlan.findUnique({ where: { id: planId }, select: { userId: true, status: true, objectives: { where: { status: "OPEN" }, select: { id: true } } } });
  if (!plan) redirect("/equipo/desarrollo");
  const back = devPath(plan!.userId, user.id);
  const rel = await relationTo(user, plan!.userId);
  if (!mayGuide(rel) || plan!.status !== "ACTIVE") go(withQs(back, "err=permiso"));
  if (plan!.objectives.length) go(withQs(back, "err=abiertos", "#cerrar"));
  const note = fText(fd, "note", 1000);
  if (!note) go(withQs(back, "err=nota-cierre", "#cerrar"));
  await db.developmentPlan.update({ where: { id: planId }, data: { status: "CLOSED", closedAt: new Date(), closeNote: note, closedByName: user.name } });
  go(withQs(back, "ok=ciclo-cerrado"));
}

export async function addObjective(planId: string, fd: FormData) {
  const user = await requireUser();
  const plan = await db.developmentPlan.findUnique({ where: { id: planId }, select: { userId: true, status: true, startsOn: true, endsOn: true, objectives: { select: { dimension: true } } } });
  if (!plan) redirect("/equipo/desarrollo");
  const back = devPath(plan!.userId, user.id);
  const rel = await relationTo(user, plan!.userId);
  if (!mayGuide(rel) || plan!.status !== "ACTIVE") go(withQs(back, "err=permiso"));
  const pol = await getTeamPolicy();
  const o = { dimension: fPick(fd, "dimension", DIMS), title: fText(fd, "title", 200), expectedEvidence: fText(fd, "expectedEvidence", 500), nextMovement: fText(fd, "nextMovement", 300), reviewOn: fDay(fd, "reviewOn") };
  const issues = objectiveIssues(o, plan!, plan!.objectives.filter((x) => x.dimension === o.dimension).length, pol.value);
  if (issues.includes("max")) go(withQs(back, `err=max&d=${o.dimension}`, "#objetivos"));
  if (issues.length) go(withQs(back, `err=objetivo&f=${issues.join(",")}`, "#nuevo-objetivo"));
  const asked = fPick(fd, "privacy", PRIVACY);
  const oppId = fText(fd, "opportunityId", 40);
  const opp = oppId ? await db.developmentOpportunity.findFirst({ where: { id: oppId, userId: plan!.userId, status: "OPEN" }, select: { id: true, source: true } }) : null;
  const obj = await db.developmentObjective.create({ data: {
    planId, dimension: o.dimension!, title: o.title!, why: fText(fd, "why", 500), expectedEvidence: o.expectedEvidence!, nextMovement: o.nextMovement!, reviewOn: o.reviewOn!,
    // Only the person can keep an objective to themselves; what a leader or mentor writes is shared with the person.
    privacy: rel.self ? asked ?? "SHARED" : asked === "ORG" ? "ORG" : "SHARED", origin: opp ? opp.source : rel.self ? "SELF" : "LEADER", originRef: opp?.id ?? null, createdByName: user.name,
  } });
  if (opp) await db.developmentOpportunity.update({ where: { id: opp.id }, data: { status: "IN_PLAN", objectiveId: obj.id } });
  go(withQs(back, "ok=objetivo", `#o-${obj.id}`));
}

async function objectiveFor(id: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const o = await db.developmentObjective.findUnique({ where: { id }, select: { id: true, status: true, privacy: true, plan: { select: { userId: true, status: true, startsOn: true, endsOn: true } }, _count: { select: { evidence: true } } } });
  if (!o) redirect("/equipo/desarrollo");
  const rel = await relationTo(user, o!.plan.userId);
  const back = devPath(o!.plan.userId, user.id);
  // A private objective is the person's alone, even for whoever accompanies them.
  const may = mayGuide(rel) && (rel.self || o!.privacy !== "PRIVATE");
  return { o: o!, rel, back, may };
}

export async function moveObjective(id: string, fd: FormData) {
  const user = await requireUser();
  const { o, back, may } = await objectiveFor(id, user);
  if (!may || o.status !== "OPEN") go(withQs(back, "err=permiso"));
  const next = fText(fd, "nextMovement", 300), on = fDay(fd, "reviewOn");
  if (!next || !on || on < o.plan.startsOn || on > o.plan.endsOn) go(withQs(back, "err=mover", `#o-${id}`));
  await db.developmentObjective.update({ where: { id }, data: { nextMovement: next!, reviewOn: on! } });
  go(withQs(back, "ok=movido", `#o-${id}`));
}

export async function setObjectivePrivacy(id: string, fd: FormData) {
  const user = await requireUser();
  const { o, rel, back } = await objectiveFor(id, user);
  const privacy = fPick(fd, "privacy", PRIVACY);
  if (!rel.self || !privacy) go(withQs(back, "err=permiso"));
  await db.developmentObjective.update({ where: { id: o.id }, data: { privacy: privacy! } });
  go(withQs(back, "ok=privacidad", `#o-${id}`));
}

export async function addEvidence(objectiveId: string, fd: FormData) {
  const user = await requireUser();
  const { o, rel, back, may } = await objectiveFor(objectiveId, user);
  if (!may || o.plan.status !== "ACTIVE") go(withQs(back, "err=permiso"));
  const what = fText(fd, "what", 600), on = fDay(fd, "observedOn") ?? today();
  // A work record is attached only by the person and only when they choose it: SOLU suggests, it never watches (§14).
  const ref = fText(fd, "ref", 300);
  const work = rel.self && !!ref && ref.startsWith("/");
  if (!what || on > today()) go(withQs(back, "err=evidencia", `#o-${objectiveId}`));
  await db.developmentEvidence.create({ data: { objectiveId, what: what!, ref, observedOn: on, kind: work ? "WORK" : rel.self ? "SELF" : rel.leader ? "LEADER" : "MENTOR", addedById: user.id, addedByName: user.name } });
  go(withQs(back, "ok=evidencia", `#o-${objectiveId}`));
}

/** AC7 · achieved needs evidence on record; any other close needs its reason written. */
export async function closeObjective(id: string, fd: FormData) {
  const user = await requireUser();
  const { o, back, may } = await objectiveFor(id, user);
  if (!may || o.status !== "OPEN") go(withQs(back, "err=permiso"));
  const outcome = String(fd.get("outcome") ?? ""), reason = fText(fd, "reason", 500);
  const issues = closeIssues({ outcome, evidenceCount: o._count.evidence, reason });
  if (issues.includes("evidence")) go(withQs(back, "err=sin-evidencia", `#o-${id}`));
  if (issues.length) go(withQs(back, "err=sin-motivo", `#o-${id}`));
  await db.developmentObjective.update({ where: { id }, data: { status: outcome, closeReason: reason, closedAt: new Date(), closedByName: user.name } });
  go(withQs(back, "ok=objetivo-cerrado", "#objetivos"));
}

// ---------- Commitments ----------

export async function addCommitment(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, devPath(personId, user.id));
  const rel = await relationTo(user, personId);
  const objectiveId = fText(fd, "objectiveId", 40), meetingId = fText(fd, "meetingId", 40), sharedWithId = fText(fd, "sharedWithId", 40);
  const meet = meetingId ? await db.developmentMeeting.findFirst({ where: { id: meetingId, userId: personId, status: { not: "CANCELLED" } }, select: { id: true, withId: true } }) : null;
  // Whoever sits in a conversation with the person may write down what was agreed in it.
  if (!mayGuide(rel) && meet?.withId !== user.id) go(withQs(back, "err=permiso"));
  const ownerId = fText(fd, "ownerId", 40) ?? personId;
  // The one who commits is the person, someone who accompanies them (leader or mentor), or the other person in the conversation.
  const owner = await db.user.findFirst({ where: { id: ownerId, active: true }, select: { id: true, role: true } });
  const ownerOk = !!owner && (owner.id === personId || owner.id === meet?.withId || mayGuide(await relationTo(owner, personId)));
  const c = { kind: fPick(fd, "kind", ACTION_KINDS), what: fText(fd, "what", 400), expectedEvidence: fText(fd, "expectedEvidence", 400), dueOn: fDay(fd, "dueOn"), ownerOk };
  if (commitmentIssues(c).length) go(withQs(back, "err=compromiso", "#compromisos"));
  const [obj, shared] = await Promise.all([
    objectiveId ? db.developmentObjective.findFirst({ where: { id: objectiveId, plan: { userId: personId } }, select: { id: true } }) : null,
    sharedWithId && sharedWithId !== ownerId ? db.user.findFirst({ where: { id: sharedWithId, active: true }, select: { id: true } }) : null,
  ]);
  await db.developmentCommitment.create({ data: { userId: personId, ownerId, sharedWithId: shared?.id ?? null, objectiveId: obj?.id ?? null, meetingId: meet?.id ?? null, kind: c.kind!, what: c.what!, expectedEvidence: c.expectedEvidence!, dueOn: c.dueOn!, createdByName: user.name } });
  go(withQs(back, "ok=compromiso", "#compromisos"));
}

export async function closeCommitment(id: string, fd: FormData) {
  const user = await requireUser();
  const c = await db.developmentCommitment.findUnique({ where: { id }, select: { userId: true, ownerId: true, sharedWithId: true, status: true } });
  if (!c) redirect("/equipo/desarrollo");
  const back = backOf(fd, devPath(c!.userId, user.id));
  const rel = await relationTo(user, c!.userId);
  if (!(mayGuide(rel) || c!.ownerId === user.id || c!.sharedWithId === user.id) || c!.status !== "OPEN") go(withQs(back, "err=permiso"));
  const done = fd.get("action") === "DONE", note = fText(fd, "note", 500);
  // A commitment is kept when there is something to show for it; dropped, when the reason is written.
  if (!note) go(withQs(back, done ? "err=compromiso-evidencia" : "err=compromiso-motivo", "#compromisos"));
  await db.developmentCommitment.update({ where: { id }, data: { status: done ? "DONE" : "DROPPED", closedAt: new Date(), closeNote: `${note} · ${user.name}` } });
  go(withQs(back, "ok=compromiso-cerrado", "#compromisos"));
}

// ---------- Conversations ----------

export async function scheduleMeeting(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, `/equipo/reuniones${personQs(personId, user.id)}`);
  const rel = await relationTo(user, personId);
  if (!mayGuide(rel)) go(withQs(back, "err=permiso"));
  const kind = fPick(fd, "kind", MEETING_KINDS), on = fDay(fd, "scheduledOn");
  // The person chooses whom to meet; whoever accompanies them schedules a conversation with themselves.
  const withId = rel.self ? fText(fd, "withId", 40) : user.id;
  const other = withId && withId !== personId ? await db.user.findFirst({ where: { id: withId, active: true }, select: { id: true } }) : null;
  if (!kind || !on || !other || on < addDays(today(), -30)) go(withQs(back, "err=reunion", "#nueva"));
  const plan = await db.developmentPlan.findFirst({ where: { userId: personId, status: "ACTIVE" }, select: { id: true } });
  const pol = await getTeamPolicy();
  const cp = kind === "CHECKPOINT" ? Number(fd.get("checkpointDay")) : NaN;
  if (kind === "CHECKPOINT" && (!plan || !pol.value.checkpoints.includes(cp))) go(withQs(back, "err=checkpoint", "#nueva"));
  const m = await db.developmentMeeting.create({ data: { userId: personId, withId: other!.id, kind: kind!, scheduledOn: on!, planId: plan?.id ?? null, checkpointDay: kind === "CHECKPOINT" ? cp : null, createdByName: user.name } });
  go(`/equipo/reuniones/${m.id}?ok=programada`);
}

async function meetingFor(id: string, user: { id: string }) {
  const m = await db.developmentMeeting.findUnique({ where: { id } });
  if (!m || !(m.userId === user.id || m.withId === user.id)) redirect("/equipo/reuniones");
  return m!;
}

/** Closing keeps the agenda as it stood and asks for the next conversation, or the reason there is none. */
export async function closeMeeting(id: string, fd: FormData) {
  const user = await requireUser();
  const m = await meetingFor(id, user);
  const back = `/equipo/reuniones/${id}`;
  if (m.status !== "PLANNED") go(`${back}?err=estado`);
  const heldOn = fDay(fd, "heldOn") ?? today(), nextOn = fDay(fd, "nextOn"), noNextReason = fText(fd, "noNextReason", 300);
  const issues = meetingCloseIssues({ heldOn, nextOn, noNextReason }, today());
  if (issues.length) go(`${back}?err=${issues.includes("next") ? "siguiente" : "fechas"}#cerrar`);
  const agenda = await meetingAgenda(m);
  const snapshot = { since: agenda.since.toISOString(), commitments: agenda.commitments.map((c) => ({ what: c.what, dueOn: c.dueOn.toISOString(), owner: c.owner.name })), focus: (agenda.plan?.objectives ?? []).map((o) => ({ dimension: o.dimension, title: o.title, nextMovement: o.nextMovement, newEvidence: o.evidence.length })), feedbackSince: agenda.feedbackSince };
  const nextKind = m.kind === "CHECKPOINT" ? "ONE_ON_ONE" : m.kind;
  await db.$transaction(async (tx) => {
    const next = nextOn ? await tx.developmentMeeting.create({ data: { userId: m.userId, withId: m.withId, kind: nextKind, scheduledOn: nextOn, planId: m.planId, createdByName: user.name } }) : null;
    await tx.developmentMeeting.update({ where: { id }, data: { status: "HELD", heldOn, notes: fText(fd, "notes", 4000), agenda: snapshot as Prisma.InputJsonValue, nextMeetingId: next?.id ?? null, noNextReason: next ? null : noNextReason, closedByName: user.name } });
  });
  go(`${back}?ok=cerrada`);
}

export async function cancelMeeting(id: string, fd: FormData) {
  const user = await requireUser();
  const m = await meetingFor(id, user);
  const back = `/equipo/reuniones/${id}`;
  const reason = fText(fd, "reason", 300);
  if (m.status !== "PLANNED" || !reason) go(`${back}?err=cancelar#cancelar`);
  await db.developmentMeeting.update({ where: { id }, data: { status: "CANCELLED", cancelReason: `${reason} · ${user.name}` } });
  go(`${back}?ok=cancelada`);
}

export async function moveMeeting(id: string, fd: FormData) {
  const user = await requireUser();
  const m = await meetingFor(id, user);
  const on = fDay(fd, "scheduledOn");
  if (m.status !== "PLANNED" || !on || on < today()) go(`/equipo/reuniones/${id}?err=fechas`);
  await db.developmentMeeting.update({ where: { id }, data: { scheduledOn: on! } });
  go(`/equipo/reuniones/${id}?ok=movida`);
}

// ---------- Feedback 360 ----------

const FB = "/equipo/feedback";
const parts = (fd: FormData) => Object.fromEntries(FEEDBACK_PARTS.map((p) => [p.key, fText(fd, p.key, 1500)])) as Record<(typeof FEEDBACK_PARTS)[number]["key"], string | null>;

/** Ask someone for feedback about yourself, or (as leader) about a person you accompany. */
export async function requestFeedback(fd: FormData) {
  const user = await requireUser();
  const aboutId = fText(fd, "aboutId", 40) ?? user.id;
  const rel = await relationTo(user, aboutId);
  const fromId = fText(fd, "fromId", 40), relation = fPick(fd, "relation", FEEDBACK_RELATIONS);
  const from = fromId ? await db.user.findFirst({ where: { id: fromId, active: true }, select: { id: true } }) : null;
  if (!(rel.self || rel.leader)) go(`${FB}?err=permiso`);
  if (!from || !relation || (relation === "SELF") !== (from.id === aboutId)) go(`${FB}?err=pedir#pedir`);
  if (await db.feedback.count({ where: { aboutId, fromId: from!.id, status: "REQUESTED" } })) go(`${FB}?err=ya-pedido#pedir`);
  await db.feedback.create({ data: { aboutId, fromId: from!.id, relation: relation!, topic: fText(fd, "topic", 300), requestedByName: user.name } });
  go(`${FB}?ok=pedido`);
}

/** Answer a request, or offer feedback nobody asked for. Continue / Start / Improve / Reduce: at least one. */
export async function giveFeedback(fd: FormData) {
  const user = await requireUser();
  const id = fText(fd, "id", 40);
  const p = parts(fd);
  if (id) {
    const f = await db.feedback.findUnique({ where: { id }, select: { fromId: true, status: true } });
    if (!f || f.fromId !== user.id || f.status !== "REQUESTED") go(`${FB}?err=permiso`);
    if (feedbackIssues(p).length) go(`${FB}?err=vacio#f-${id}`);
    await db.feedback.update({ where: { id }, data: { ...p, status: "GIVEN", givenAt: new Date() } });
    go(`${FB}?ok=dado`);
  }
  const aboutId = fText(fd, "aboutId", 40), relation = fPick(fd, "relation", FEEDBACK_RELATIONS);
  const about = aboutId ? await db.user.findFirst({ where: { id: aboutId, active: true }, select: { id: true } }) : null;
  if (!about || !relation || (relation === "SELF") !== (about.id === user.id)) go(`${FB}?err=dar#dar`);
  if (feedbackIssues(p).length) go(`${FB}?err=vacio#dar`);
  await db.feedback.create({ data: { aboutId: about!.id, fromId: user.id, relation: relation!, topic: fText(fd, "topic", 300), ...p, status: "GIVEN", givenAt: new Date(), requestedByName: user.name } });
  go(`${FB}?ok=dado`);
}

export async function declineFeedback(id: string) {
  const user = await requireUser();
  await db.feedback.updateMany({ where: { id, fromId: user.id, status: "REQUESTED" }, data: { status: "DECLINED" } });
  go(`${FB}?ok=declinado`);
}

// ---------- Development opportunities ----------

/** From feedback, a role gap, a pattern in the work or a conversation: something worth developing. It names what
 *  could grow, never what the person "is". */
export async function addOpportunity(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, devPath(personId, user.id));
  const rel = await relationTo(user, personId);
  if (!mayGuide(rel)) go(withQs(back, "err=permiso"));
  const what = fText(fd, "what", 400);
  const source = fPick(fd, "source", { FEEDBACK: 1, ROLE_GAP: 1, IMPROVEMENT: 1, SELF: 1, LEADER: 1 }) ?? (rel.self ? "SELF" : "LEADER");
  if (!what) go(withQs(back, "err=oportunidad", "#oportunidades"));
  // Feedback is turned into an opportunity only by the person it is about or by their leader, and only once.
  const ref = fText(fd, "sourceRef", 80);
  if (source === "FEEDBACK") {
    const f = ref ? await db.feedback.findFirst({ where: { id: ref, aboutId: personId, status: "GIVEN" }, select: { id: true } }) : null;
    if (!f || !(rel.self || rel.leader)) go(withQs(back, "err=permiso"));
  }
  if (source === "IMPROVEMENT" && !rel.self) go(withQs(back, "err=permiso"));
  if (ref && (await db.developmentOpportunity.count({ where: { userId: personId, source, sourceRef: ref, status: { not: "DISMISSED" } } }))) go(withQs(back, "ok=oportunidad-existe", "#oportunidades"));
  await db.developmentOpportunity.create({ data: { userId: personId, source, sourceRef: ref, dimension: fPick(fd, "dimension", DIMS), what: what!, raisedById: user.id, raisedByName: user.name } });
  go(withQs(back, "ok=oportunidad", "#oportunidades"));
}

export async function dismissOpportunity(id: string, fd: FormData) {
  const user = await requireUser();
  const o = await db.developmentOpportunity.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!o) redirect("/equipo/desarrollo");
  const back = devPath(o!.userId, user.id);
  const rel = await relationTo(user, o!.userId);
  const note = fText(fd, "note", 300);
  if (!mayGuide(rel) || o!.status !== "OPEN") go(withQs(back, "err=permiso"));
  if (!note) go(withQs(back, "err=nota", "#oportunidades"));
  await db.developmentOpportunity.update({ where: { id }, data: { status: "DISMISSED", dismissNote: `${note} · ${user.name}` } });
  go(withQs(back, "ok=oportunidad-descartada", "#oportunidades"));
}
