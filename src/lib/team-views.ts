import type { Prisma, Role } from "@prisma/client";
import { db } from "./db";
import { addDays, today } from "./domain";
import { canManageAll, isGerencia } from "./permissions";
import { FUNCTION_KEYS, inForce, roleClarity, type FunctionKey } from "./gerencia-rules";
import { charterVersions, chartersInForce, identityVersions } from "./gerencia-store";
import { goalBoard } from "./goals";
import { periodOf } from "./goal-rules";
import { improvementFor, STEP_TEXT, type StepKey } from "./improvement";
import {
  CAPABILITY_BLOCKS, ROLE_FUNCTION, authorityMissing, devFlags, gapTable, mayGuide, readableLevels, roleMissing, structureIssues, talentMap,
  type DevFlag, type Relation, type RoleView,
} from "./team-rules";
import { assignmentsOf, backupsWithSuitability, baseAssignments, getTeamPolicy, grantedByRole, privacyWhere, relationTo, reportIdsOf, roleData, roleVersions, rolesInForce, workPeople } from "./team-store";

// Módulo 16 · what each Equipo screen shows. Every read takes the viewer, works out how they stand towards the
// person, and asks the database only for what that relation may see.

type U = { id: string; role: Role };

// ---------- Mi Rol (§17, §23) ----------

/** The chain CompanyIdentity → FunctionCharter → RoleProfile → PersonRoleAssignment → Goals/Development → Evidence
 *  for one person. Goals and the development plan are read from where they live; nothing is copied (AC9). */
export async function myRoleView(viewer: U, personId: string, actingId?: string | null) {
  const T = today();
  const rel = await relationTo(viewer, personId);
  const [person, asg, identities, charters, allRoles] = await Promise.all([
    db.user.findUnique({ where: { id: personId }, select: { id: true, name: true, role: true, active: true } }),
    assignmentsOf(personId, T), identityVersions(), charterVersions(), roleVersions(),
  ]);
  if (!person) return null;
  const acting = actingId ? asg.acting.find((a) => a.id === actingId) ?? null : null;
  const assignment = acting ?? asg.base;
  const agreed = assignment?.roleProfile ?? null;
  // The contract in force is the latest published version of the role; the version the person was assigned under stays on record.
  const profileRow = agreed ? inForce(allRoles.filter((r) => r.roleKey === agreed.roleKey), T) ?? agreed : null;
  const profile = profileRow ? roleData(profileRow) : null;
  const functionKey = (profile?.functionKey ?? ROLE_FUNCTION[person.role] ?? null) as FunctionKey | null;
  const identity = inForce(identities, T);
  const charter = functionKey ? chartersInForce(charters, T).find((c) => c.functionKey === functionKey) ?? null : null;
  const seeGoals = rel.self || canManageAll(viewer);
  const levels = readableLevels(rel);
  const [goals, plan, gaps, readiness, support, tasksToday, granted] = await Promise.all([
    seeGoals ? goalBoard(personId, periodOf(T)) : null,
    levels.length ? db.developmentPlan.findFirst({ where: { userId: personId, status: "ACTIVE" }, include: { objectives: { where: { status: "OPEN", ...privacyWhere(rel) }, orderBy: { reviewOn: "asc" } } } }) : null,
    profile && mayGuide(rel) ? db.roleGapReview.findMany({ where: { userId: personId, roleKey: profile.roleKey }, orderBy: { createdAt: "desc" } }) : [],
    mayGuide(rel) || rel.gerencia ? db.readinessAssessment.findMany({ where: { userId: personId, supersededAt: null }, orderBy: { assessedOn: "desc" } }) : [],
    mayGuide(rel) || rel.gerencia ? db.supportGap.findMany({ where: { userId: personId, status: { not: "RESOLVED" } }, orderBy: { createdAt: "asc" }, include: { owner: { select: { name: true } } } }) : [],
    rel.self ? db.task.count({ where: { assigneeId: personId, status: "OPEN", dueDate: { lte: T } } }) : null,
    grantedByRole(),
  ]);
  const mine = granted.granted[person.role] ?? [];
  return {
    asOf: new Date(), rel, person, assignment, base: asg.base, actingRoles: asg.acting, viewingActing: !!acting,
    identity, charter, functionKey, profileRow, profile,
    agreedVersion: agreed?.version ?? null, reviewedVersion: assignment?.reviewedVersion ?? null, reviewedAt: assignment?.reviewedAt ?? null, reviewedByName: assignment?.reviewedByName ?? null,
    missingFields: profile ? roleMissing(profile) : [], clarity: roleClarity(profile),
    granted: mine, authorityGap: profile ? authorityMissing(profile.authorityDomains, mine) : [], roleMismatch: !!profile?.soluRole && profile.soluRole !== person.role,
    goals, plan, gapRows: profile ? gapTable(profile, gaps) : [], gapHistory: gaps, readiness, support, tasksToday,
    roleTitles: Object.fromEntries(rolesInForce(allRoles, T).map((r) => [r.roleKey, r.title])) as Record<string, string>,
  };
}
export type MyRole = NonNullable<Awaited<ReturnType<typeof myRoleView>>>;

// ---------- Team Member 360 (§2–3) ----------

export async function profile360(viewer: U, personId: string) {
  const rel = await relationTo(viewer, personId);
  const levels = readableLevels(rel);
  const person = await db.user.findUnique({ where: { id: personId }, select: { id: true, name: true, role: true, active: true, authLevel: true } });
  if (!person) return null;
  const [asg, history, entries, assessments, character, readiness] = await Promise.all([
    assignmentsOf(personId),
    levels.length ? db.personRoleAssignment.findMany({ where: { userId: personId }, orderBy: { effectiveFrom: "desc" }, include: { roleProfile: { select: { title: true, version: true } }, leader: { select: { name: true } } } }) : [],
    levels.length ? db.profileEntry.findMany({ where: { userId: personId, archivedAt: null, ...privacyWhere(rel) }, orderBy: [{ block: "asc" }, { createdAt: "asc" }] }) : [],
    // An assessment is the person's own; a leader or mentor reads it only when the person shared it. Gerencia never by role.
    rel.self || rel.leader || rel.mentor ? db.personAssessment.findMany({ where: { userId: personId, ...(rel.self ? {} : { privacy: "SHARED" }) }, orderBy: { takenOn: "desc" } }) : [],
    levels.length ? db.characterEvidence.findMany({ where: { userId: personId, withdrawnAt: null, ...privacyWhere(rel) }, orderBy: { observedOn: "desc" } }) : [],
    mayGuide(rel) || rel.gerencia ? db.readinessAssessment.findMany({ where: { userId: personId }, orderBy: [{ supersededAt: { sort: "desc", nulls: "first" } }, { assessedOn: "desc" }], take: 20 }) : [],
  ]);
  return { rel, person, base: asg.base, acting: asg.acting, history, entries, assessments, character, readiness };
}

// ---------- My Development (§5–6, §13) ----------

const planInclude = { leader: { select: { id: true, name: true } }, mentor: { select: { id: true, name: true } } } satisfies Prisma.DevelopmentPlanInclude;

async function devFacts(personIds: string[], T: Date) {
  const [plans, commitments, meetings] = await Promise.all([
    db.developmentPlan.findMany({ where: { userId: { in: personIds }, status: "ACTIVE" }, select: { id: true, userId: true, startsOn: true, endsOn: true, cycle: true, objectives: { select: { dimension: true, status: true, reviewOn: true } } } }),
    db.developmentCommitment.findMany({ where: { userId: { in: personIds }, status: "OPEN" }, select: { userId: true, dueOn: true } }),
    db.developmentMeeting.findMany({ where: { userId: { in: personIds }, status: { not: "CANCELLED" } }, select: { userId: true, withId: true, status: true, scheduledOn: true, heldOn: true, planId: true, checkpointDay: true, kind: true } }),
  ]);
  return { plans, commitments, meetings, T };
}
function flagsFor(personId: string, f: Awaited<ReturnType<typeof devFacts>>, pol: Awaited<ReturnType<typeof getTeamPolicy>>["value"]): DevFlag[] {
  const plan = f.plans.find((p) => p.userId === personId) ?? null;
  const meetings = f.meetings.filter((m) => m.userId === personId);
  const next = meetings.filter((m) => m.status === "PLANNED" && m.scheduledOn >= f.T).sort((a, b) => +a.scheduledOn - +b.scheduledOn)[0];
  return devFlags({
    plan, checkpointsMet: plan ? meetings.filter((m) => m.planId === plan.id && m.checkpointDay != null).map((m) => m.checkpointDay!) : [],
    openCommitmentsDue: f.commitments.filter((c) => c.userId === personId).map((c) => c.dueOn), nextMeetingOn: next?.scheduledOn ?? null,
  }, f.T, pol);
}

/** One person's development: current focus, commitments, evidence and the next conversation. A leader or mentor
 *  sees what the person shared; Gerencia sees that a cycle exists and what is organisational. */
export async function devView(viewer: U, personId: string) {
  const T = today();
  const rel = await relationTo(viewer, personId);
  const levels = readableLevels(rel);
  const person = await db.user.findUnique({ where: { id: personId }, select: { id: true, name: true, role: true, active: true } });
  if (!person) return null;
  const guide = mayGuide(rel);
  const pol = await getTeamPolicy();
  const [plan, closed, commitments, meetings, opportunities, facts, feedback] = await Promise.all([
    levels.length ? db.developmentPlan.findFirst({ where: { userId: personId, status: "ACTIVE" }, include: { ...planInclude, objectives: { where: privacyWhere(rel), orderBy: [{ status: "desc" }, { reviewOn: "asc" }], include: { evidence: { orderBy: { observedOn: "desc" } } } } } }) : null,
    levels.length ? db.developmentPlan.findMany({ where: { userId: personId, status: "CLOSED" }, orderBy: { cycle: "desc" }, take: 8, include: { objectives: { where: privacyWhere(rel), select: { id: true, dimension: true, title: true, status: true, closeReason: true, _count: { select: { evidence: true } } } } } }) : [],
    guide ? db.developmentCommitment.findMany({ where: { userId: personId, OR: [{ status: "OPEN" }, { closedAt: { gte: addDays(T, -60) } }] }, orderBy: [{ status: "desc" }, { dueOn: "asc" }], include: { owner: { select: { id: true, name: true } } } }) : [],
    // A conversation belongs to the two people in it; the person also sees every one that is about them.
    guide ? db.developmentMeeting.findMany({ where: { userId: personId, ...(rel.self ? {} : { withId: viewer.id }), scheduledOn: { gte: addDays(T, -200) } }, orderBy: { scheduledOn: "desc" }, take: 30, include: { with: { select: { id: true, name: true } } } }) : [],
    guide ? db.developmentOpportunity.findMany({ where: { userId: personId, status: "OPEN" }, orderBy: { createdAt: "desc" } }) : [],
    devFacts([personId], T),
    rel.self || rel.leader ? db.feedback.findMany({ where: { aboutId: personId, status: "GIVEN", givenAt: { gte: addDays(T, -200) } }, orderBy: { givenAt: "desc" }, take: 20, include: { from: { select: { name: true } } } }) : [],
  ]);
  const flags = levels.length ? flagsFor(personId, facts, pol.value) : [];
  const upcoming = meetings.filter((m) => m.status === "PLANNED").sort((a, b) => +a.scheduledOn - +b.scheduledOn);
  return { asOf: new Date(), rel, person, policy: pol, plan, closed, commitments, meetings, next: upcoming[0] ?? null, opportunities, feedback, flags, hasPlan: !!facts.plans.length };
}
export type DevView = NonNullable<Awaited<ReturnType<typeof devView>>>;

/** §14 Development Intelligence · patterns in the person's own work that may be worth a conversation. Shown only to
 *  the person; nothing is recorded unless they choose to turn one into a development opportunity. */
export async function devSuggestions(personId: string) {
  const imp = await improvementFor(personId);
  const out: { key: StepKey; text: { es: string; en: string }; step: { es: string; en: string } }[] = [];
  for (const k of Object.keys(STEP_TEXT) as StepKey[]) {
    const v = k === "decideDays" ? imp.decideDays.verdict : k === "payDays" ? imp.payDays.verdict : imp.rates[k]?.verdict;
    if (v === "WORSE") out.push({ key: k, text: STEP_TEXT[k].worse, step: { es: STEP_TEXT[k].es, en: STEP_TEXT[k].en } });
  }
  return out;
}
/** Recent records of the person's own work they may choose to attach as evidence. Never attached by SOLU. */
export async function workRecords(personId: string) {
  const since = addDays(today(), -60);
  const [visits, quotes] = await Promise.all([
    db.visitPlan.findMany({ where: { ownerId: personId, status: "DONE", happenedAt: { gte: since } }, orderBy: { happenedAt: "desc" }, take: 5, select: { id: true, happenedAt: true, account: { select: { name: true } } } }),
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: { gte: since }, deal: { ownerId: personId, internal: false } }, orderBy: { decidedAt: "desc" }, take: 5, select: { id: true, number: true, decidedAt: true, deal: { select: { account: { select: { name: true } } } } } }),
  ]);
  return [
    ...visits.map((v) => ({ href: `/visitas/${v.id}`, on: v.happenedAt!, es: `Visita a ${v.account.name}`, en: `Visit to ${v.account.name}` })),
    ...quotes.map((q) => ({ href: `/cotizaciones/${q.id}`, on: q.decidedAt!, es: `Cotización Nº ${q.number} aceptada · ${q.deal.account.name}`, en: `Quote No. ${q.number} accepted · ${q.deal.account.name}` })),
  ].sort((a, b) => +b.on - +a.on);
}

// ---------- My Team Development (§13, AC8) ----------

/** The people this leader accompanies: focus, last and next conversation, commitments and what asks for attention.
 *  It reads objectives the person shared and nothing from the 360: no reflection, test or story can appear here. */
export async function teamDevView(leader: U) {
  const T = today();
  const ids = await reportIdsOf(leader.id);
  const pol = await getTeamPolicy();
  if (!ids.length) return { asOf: new Date(), policy: pol, rows: [] as never[] };
  const [people, facts, objectives, commitments, base] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids }, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    devFacts(ids, T),
    db.developmentObjective.findMany({ where: { status: "OPEN", privacy: { in: ["SHARED", "ORG"] }, plan: { userId: { in: ids }, status: "ACTIVE" } }, orderBy: { reviewOn: "asc" }, select: { id: true, dimension: true, title: true, reviewOn: true, plan: { select: { userId: true } } } }),
    db.developmentCommitment.findMany({ where: { userId: { in: ids }, status: "OPEN" }, select: { userId: true, dueOn: true, ownerId: true } }),
    baseAssignments(),
  ]);
  const rows = people.map((p) => {
    const mine = facts.meetings.filter((m) => m.userId === p.id && m.withId === leader.id);
    const last = mine.filter((m) => m.status === "HELD").sort((a, b) => +(b.heldOn ?? b.scheduledOn) - +(a.heldOn ?? a.scheduledOn))[0] ?? null;
    const next = mine.filter((m) => m.status === "PLANNED").sort((a, b) => +a.scheduledOn - +b.scheduledOn)[0] ?? null;
    const cs = commitments.filter((c) => c.userId === p.id);
    const plan = facts.plans.find((x) => x.userId === p.id) ?? null;
    return {
      ...p, title: base.get(p.id)?.roleProfile?.title ?? base.get(p.id)?.contractualTitle ?? null, plan: plan ? { cycle: plan.cycle, endsOn: plan.endsOn } : null,
      focus: objectives.filter((o) => o.plan.userId === p.id).slice(0, 4), last: last ? last.heldOn ?? last.scheduledOn : null, next: next?.scheduledOn ?? null,
      commitments: cs.length, overdue: cs.filter((c) => c.dueOn < T).length, mineOverdue: cs.filter((c) => c.ownerId === leader.id && c.dueOn < T).length, flags: flagsFor(p.id, facts, pol.value),
    };
  });
  return { asOf: new Date(), policy: pol, rows };
}

// ---------- Team Role Clarity (§25) ----------

/** Person | Role | Level | Role Profile version | Expectations reviewed | Key gaps | Decision-right issues | Next
 *  development, for the people this viewer accompanies (everyone, for Gerencia). And where the structure itself has
 *  a hole. A person with no agreement in force is listed as a role clarity gap, never left out (AC1). */
export async function roleClarityView(viewer: U) {
  const T = today();
  const all = isGerencia(viewer);
  const scope = all ? null : await reportIdsOf(viewer.id);
  const [people, base, allRoles, granted] = await Promise.all([workPeople(), baseAssignments(), roleVersions(), grantedByRole()]);
  const inScope = people.filter((p) => all || scope!.includes(p.id));
  const ids = inScope.map((p) => p.id);
  const cur = rolesInForce(allRoles, T);
  const [gaps, objectives, meetings, support, backups] = await Promise.all([
    db.roleGapReview.findMany({ where: { userId: { in: ids }, supersededAt: null, result: "GAP" }, select: { userId: true, roleKey: true, dimension: true } }),
    db.developmentObjective.findMany({ where: { status: "OPEN", privacy: { in: ["SHARED", "ORG"] }, plan: { userId: { in: ids }, status: "ACTIVE" } }, orderBy: { reviewOn: "asc" }, select: { title: true, reviewOn: true, plan: { select: { userId: true } } } }),
    db.developmentMeeting.findMany({ where: { userId: { in: ids }, status: "PLANNED", scheduledOn: { gte: T } }, orderBy: { scheduledOn: "asc" }, select: { userId: true, scheduledOn: true } }),
    db.supportGap.findMany({ where: { userId: { in: ids }, status: { not: "RESOLVED" } }, select: { userId: true, kind: true, what: true, expectation: true } }),
    backupsWithSuitability(cur, T),
  ]);
  const rows = inScope.map((p) => {
    const a = base.get(p.id) ?? null;
    const agreed = a?.roleProfile ?? null;
    const row = agreed ? cur.find((r) => r.roleKey === agreed.roleKey) ?? agreed : null;
    const profile = row ? roleData(row) : null;
    const mine = granted.granted[p.role] ?? [];
    const obj = objectives.find((o) => o.plan.userId === p.id) ?? null;
    return {
      id: p.id, name: p.name, accessRole: p.role, assignment: a, roleKey: profile?.roleKey ?? null, title: profile?.title ?? null, level: a?.level ?? null,
      version: row?.version ?? null, agreedVersion: agreed?.version ?? null, clear: roleClarity(profile).clear, incomplete: profile ? roleMissing(profile).length : 0,
      reviewed: !!row && a?.reviewedVersion === row.version, reviewedAt: a?.reviewedAt ?? null, reviewedVersion: a?.reviewedVersion ?? null,
      keyGaps: profile ? gaps.filter((g) => g.userId === p.id && g.roleKey === profile.roleKey).map((g) => g.dimension) : [],
      authorityGap: profile ? authorityMissing(profile.authorityDomains, mine) : [], roleMismatch: !!profile?.soluRole && profile.soluRole !== p.role, expectedRole: profile?.soluRole ?? null,
      support: support.filter((s) => s.userId === p.id), nextObjective: obj, nextMeeting: meetings.find((m) => m.userId === p.id)?.scheduledOn ?? null,
    };
  });
  // Holders are counted over the whole company, also for a leader, so "nobody holds it" is never a matter of scope.
  const holders = new Map<string, number>();
  for (const a of base.values()) if (a.roleProfile) holders.set(a.roleProfile.roleKey, (holders.get(a.roleProfile.roleKey) ?? 0) + 1);
  const views: RoleView[] = cur.map((r) => ({ ...roleData(r), version: r.version, holders: holders.get(r.roleKey) ?? 0 }));
  const qualified: Record<string, number> = {};
  for (const b of backups) if (b.kind === "BACKUP" && b.suit.qualified) qualified[b.roleKey] = (qualified[b.roleKey] ?? 0) + 1;
  return {
    asOf: new Date(), all, rows, roles: cur, noProfile: rows.filter((r) => !r.roleKey),
    structure: all || canManageAll(viewer) ? structureIssues(views, granted.granted, qualified) : [],
    titles: Object.fromEntries(cur.map((r) => [r.roleKey, r.title])) as Record<string, string>,
  };
}

// ---------- Continuity and succession (§7–8, AC6) ----------

/** Each role in force with who holds it and who stands behind it. A role reports "no qualified backup" as a
 *  continuity risk when it is critical or rests on one person. */
export async function continuityView(now = today()) {
  const allRoles = await roleVersions();
  const cur = rolesInForce(allRoles, now);
  const horizon = addDays(now, 30);
  const [base, backups, people, away, coverages] = await Promise.all([
    baseAssignments(), backupsWithSuitability(cur, now), workPeople(),
    db.absenceRecord.findMany({ where: { status: "APPROVED", endsOn: { gte: now }, startsOn: { lte: horizon } }, orderBy: { startsOn: "asc" }, select: { id: true, userId: true, startsOn: true, endsOn: true, createdAt: true, user: { select: { name: true, active: true } } } }),
    db.coverageAssignment.findMany({ where: { revokedAt: null, endsAt: { gt: now } }, select: { id: true, originalUserId: true, startsAt: true, endsAt: true, actingUser: { select: { name: true } } } }),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const roles = cur.map((r) => {
    const d = roleData(r);
    const holders = [...base.values()].filter((a) => a.roleProfile?.roleKey === r.roleKey).map((a) => ({ id: a.userId, name: name.get(a.userId) ?? "—", level: a.level }));
    const mine = backups.filter((b) => b.roleKey === r.roleKey);
    const qualified = mine.filter((b) => b.kind === "BACKUP" && b.suit.qualified);
    const exposed = d.critical || holders.length <= 1;
    return { roleKey: r.roleKey, title: r.title, functionKey: r.functionKey, critical: d.critical, holders, backups: mine, qualified: qualified.length, risk: exposed && qualified.length === 0 };
  });
  const absences = away.filter((a) => a.user.active).map((a) => {
    const cover = coverages.find((c) => c.originalUserId === a.userId && c.startsAt <= addDays(a.endsOn, 1) && c.endsAt > a.startsOn) ?? null;
    return { id: a.id, userId: a.userId, name: a.user.name, startsOn: a.startsOn, endsOn: a.endsOn, now: a.startsOn <= now, unplanned: a.createdAt.getTime() >= a.startsOn.getTime(), coverId: cover?.id ?? null, coveredBy: cover?.actingUser.name ?? null };
  });
  return { asOf: new Date(), roles, risks: roles.filter((r) => r.risk), absences, noRoles: cur.length === 0 };
}

// ---------- Team Talent Map and Organizational Development (§9, §13) ----------

/** Capabilities people chose to make organisational. A leader sees their own team; Gerencia sees everyone. */
export async function talentView(viewer: U) {
  const all = isGerencia(viewer);
  const ids = all ? null : await reportIdsOf(viewer.id);
  const entries = await db.profileEntry.findMany({ where: { archivedAt: null, privacy: "ORG", block: { in: CAPABILITY_BLOCKS }, user: { active: true, ...(ids ? { id: { in: ids } } : {}) } }, select: { userId: true, block: true, kind: true, text: true, user: { select: { name: true } } } });
  const people = new Set(entries.map((e) => e.userId)).size;
  return { asOf: new Date(), all, people, scope: ids ? ids.length : null, ...talentMap(entries.map((e) => ({ userId: e.userId, name: e.user.name, block: e.block, kind: e.kind, text: e.text }))) };
}

/** Development as the organisation sees it: by function, how many people have a cycle in course and what asks for
 *  attention; readiness for each role; roles with nobody behind. Counts and organisational facts only. */
export async function orgDevView() {
  const T = today();
  const [people, base, pol, cont, readiness] = await Promise.all([
    workPeople(), baseAssignments(), getTeamPolicy(), continuityView(T),
    db.readinessAssessment.findMany({ where: { supersededAt: null, user: { active: true } }, select: { userId: true, roleKey: true, state: true, level: true, user: { select: { name: true } } } }),
  ]);
  const facts = await devFacts(people.map((p) => p.id), T);
  const fnOf = (p: { id: string; role: string }) => (base.get(p.id)?.roleProfile?.functionKey ?? ROLE_FUNCTION[p.role] ?? "GERENCIA") as FunctionKey;
  const byFunction = FUNCTION_KEYS.map((key) => {
    const mine = people.filter((p) => fnOf(p) === key);
    const flags = mine.map((p) => flagsFor(p.id, facts, pol.value));
    const count = (k: DevFlag["key"]) => flags.filter((f) => f.some((x) => x.key === k)).length;
    return { key, people: mine.length, withPlan: mine.length - count("NO_PLAN"), withProfile: mine.filter((p) => base.get(p.id)?.roleProfile).length, checkpointDue: count("CHECKPOINT_DUE"), overdue: count("COMMITMENT_OVERDUE"), noNext: count("NO_NEXT_MEETING"), ended: count("CYCLE_ENDED") };
  });
  return { asOf: new Date(), policy: pol, headcount: people.length, byFunction, continuity: cont, readiness };
}

// ---------- Conversations (§6) ----------

/** The agenda of a conversation, built from what is already known: commitments still open between the two, the
 *  evidence added since they last met, the current focus and the feedback received since then. Nothing is typed. */
export async function meetingAgenda(m: { id: string; userId: string; withId: string; scheduledOn: Date }) {
  const prev = await db.developmentMeeting.findFirst({ where: { userId: m.userId, withId: m.withId, status: "HELD", id: { not: m.id }, heldOn: { lt: m.scheduledOn } }, orderBy: { heldOn: "desc" }, select: { heldOn: true } });
  const since = prev?.heldOn ?? addDays(m.scheduledOn, -90);
  const [commitments, plan, feedback] = await Promise.all([
    db.developmentCommitment.findMany({ where: { userId: m.userId, status: "OPEN" }, orderBy: { dueOn: "asc" }, select: { id: true, what: true, expectedEvidence: true, dueOn: true, kind: true, owner: { select: { name: true } } } }),
    db.developmentPlan.findFirst({ where: { userId: m.userId, status: "ACTIVE" }, select: { id: true, cycle: true, startsOn: true, endsOn: true, objectives: { where: { privacy: { in: ["SHARED", "ORG"] }, status: "OPEN" }, orderBy: { reviewOn: "asc" }, select: { id: true, dimension: true, title: true, nextMovement: true, reviewOn: true, expectedEvidence: true, evidence: { where: { createdAt: { gte: since } }, orderBy: { observedOn: "desc" }, select: { what: true, observedOn: true, addedByName: true } } } } } }),
    db.feedback.count({ where: { aboutId: m.userId, status: "GIVEN", givenAt: { gte: since } } }),
  ]);
  return { since, lastHeld: prev?.heldOn ?? null, commitments, plan, feedbackSince: feedback };
}
export type Agenda = Awaited<ReturnType<typeof meetingAgenda>>;
