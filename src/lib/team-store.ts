import type { Prisma, Role } from "@prisma/client";
import { db } from "./db";
import { today } from "./domain";
import { isGerencia, WORK_ROLES } from "./permissions";
import { getPurchasePolicy } from "./pr-auth";
import { APPROVER_ROLES } from "./esagara-gate";
import { getGerenciaPolicy } from "./gerencia-store";
import { inForce } from "./gerencia-rules";
import {
  DEFAULT_TEAM_POLICY, LENT_TO_AUTHORITY, TEAM_POLICY_KEY, grantedAuthority, readRoleProfile, readTeamPolicy, readableLevels, suitability,
  type AuthoritySources, type Relation, type RoleProfileData, type TeamPolicy,
} from "./team-rules";

// Módulo 16 · reads shared by the Equipo screens. One Person, different views: what a viewer may read is decided
// here, in the query itself, so a private line never travels to a page that may not show it (§12, AC3, AC8).

type U = { id: string; role: Role };

export async function getTeamPolicy(): Promise<{ value: TeamPolicy; version: number; by: string | null; at: Date | null; reason: string | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: TEAM_POLICY_KEY }, orderBy: { version: "desc" } });
  return s ? { value: readTeamPolicy(s.value), version: s.version, by: s.updatedByName, at: s.createdAt, reason: s.reason } : { value: DEFAULT_TEAM_POLICY, version: 0, by: null, at: null, reason: null };
}

/** People who work in SOLU every day (the board is not part of the team's development). */
export async function workPeople(includeInactive = false) {
  return db.user.findMany({ where: { role: { in: WORK_ROLES }, ...(includeInactive ? {} : { active: true }) }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, active: true } });
}

// ---------- Who leads whom ----------

/** The base assignment in force of each person (never an acting one). */
const BASE = { effectiveTo: null, acting: false } as const;

/** Everyone this person accompanies as formal leader or as leader of a team. */
export async function reportIdsOf(leaderId: string): Promise<string[]> {
  const [formal, teams] = await Promise.all([
    db.personRoleAssignment.findMany({ where: { ...BASE, leaderId, user: { active: true } }, select: { userId: true } }),
    db.team.findMany({ where: { leaderId, active: true }, select: { members: { where: { user: { active: true } }, select: { userId: true } } } }),
  ]);
  return [...new Set([...formal.map((a) => a.userId), ...teams.flatMap((t) => t.members.map((m) => m.userId))])].filter((id) => id !== leaderId);
}
export async function leaderIdsOf(personId: string): Promise<string[]> {
  const [formal, teams] = await Promise.all([
    db.personRoleAssignment.findFirst({ where: { ...BASE, userId: personId }, orderBy: { effectiveFrom: "desc" }, select: { leaderId: true } }),
    db.team.findMany({ where: { active: true, members: { some: { userId: personId } } }, select: { leaderId: true } }),
  ]);
  return [...new Set([formal?.leaderId, ...teams.map((t) => t.leaderId)].filter((x): x is string => !!x && x !== personId))];
}
/** How the viewer stands towards the person: themselves, their leader, their mentor in the cycle in course, or Gerencia. */
export async function relationTo(viewer: U, personId: string): Promise<Relation> {
  if (viewer.id === personId) return { self: true, leader: false, mentor: false, gerencia: isGerencia(viewer) };
  const [leaders, plan] = await Promise.all([
    leaderIdsOf(personId),
    db.developmentPlan.findFirst({ where: { userId: personId, status: "ACTIVE" }, select: { leaderId: true, mentorId: true } }),
  ]);
  return { self: false, leader: leaders.includes(viewer.id) || plan?.leaderId === viewer.id, mentor: plan?.mentorId === viewer.id, gerencia: isGerencia(viewer) };
}
/** The people whose Equipo pages this viewer may open: themselves, whoever they lead or mentor, everyone for Gerencia. */
export async function viewablePeople(viewer: U) {
  const people = await workPeople();
  if (isGerencia(viewer)) return people;
  const [reports, mentees] = await Promise.all([reportIdsOf(viewer.id), db.developmentPlan.findMany({ where: { status: "ACTIVE", OR: [{ mentorId: viewer.id }, { leaderId: viewer.id }] }, select: { userId: true } })]);
  const ids = new Set([viewer.id, ...reports, ...mentees.map((m) => m.userId)]);
  return people.filter((p) => ids.has(p.id));
}
/** The Prisma filter for records with a privacy level, as this viewer may read them. Nobody without a relation reads anything. */
export const privacyWhere = (r: Relation) => ({ privacy: { in: readableLevels(r) } });

// ---------- Role agreements ----------

export type RoleRow = Prisma.RoleProfileGetPayload<object>;
export async function roleVersions(roleKey?: string) {
  return db.roleProfile.findMany({ where: roleKey ? { roleKey } : {}, orderBy: [{ title: "asc" }, { roleKey: "asc" }, { version: "desc" }] });
}
/** The agreement in force of each role on a day: the highest version whose date has arrived. */
export function rolesInForce(all: RoleRow[], on = today()): RoleRow[] {
  const out: RoleRow[] = [];
  for (const key of new Set(all.map((r) => r.roleKey))) { const r = inForce(all.filter((x) => x.roleKey === key), on); if (r) out.push(r); }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
export const roleData = (r: RoleRow): RoleProfileData => readRoleProfile(r as unknown as Record<string, unknown>);

const assignmentInclude = { roleProfile: true, leader: { select: { id: true, name: true, active: true } } } satisfies Prisma.PersonRoleAssignmentInclude;
export type AssignmentRow = Prisma.PersonRoleAssignmentGetPayload<{ include: typeof assignmentInclude }>;
/** The base assignment of a person and any acting role that holds today. */
export async function assignmentsOf(personId: string, on = today()) {
  const rows = await db.personRoleAssignment.findMany({ where: { userId: personId, effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }] }, orderBy: { effectiveFrom: "desc" }, include: assignmentInclude });
  return { base: rows.find((r) => !r.acting) ?? null, acting: rows.filter((r) => r.acting) };
}
/** Base assignments of every active person, by person. */
export async function baseAssignments() {
  const rows = await db.personRoleAssignment.findMany({ where: { ...BASE, user: { active: true } }, orderBy: { effectiveFrom: "desc" }, include: assignmentInclude });
  const m = new Map<string, AssignmentRow>();
  for (const r of rows) if (!m.has(r.userId)) m.set(r.userId, r);
  return m;
}

// ---------- Authority: what the engines grant ----------

export async function authoritySources(): Promise<AuthoritySources & { purchaseVersion: number; gerenciaVersion: number }> {
  const [pp, gp] = await Promise.all([getPurchasePolicy(), getGerenciaPolicy()]);
  return { level1Roles: pp.value.level1Roles, level2Roles: pp.value.level2Roles, esagaraRoles: APPROVER_ROLES, publishRoles: gp.value.publishRoles, purchaseVersion: pp.version, gerenciaVersion: gp.version };
}
export async function grantedByRole() {
  const s = await authoritySources();
  return { sources: s, granted: Object.fromEntries(WORK_ROLES.map((r) => [r, grantedAuthority(r, s)])) as Record<string, string[]> };
}

// ---------- Backups and suitability (§7–8) ----------

/** Every backup and successor named for a role, with the four answers of suitability computed from today's facts. */
export async function backupsWithSuitability(roles: RoleRow[], now = today()) {
  const [backups, base, readiness, lent, away, covering, granted] = await Promise.all([
    db.roleBackup.findMany({ where: { endedAt: null }, orderBy: { createdAt: "asc" }, include: { backupUser: { select: { id: true, name: true, role: true, active: true } } } }),
    baseAssignments(),
    db.readinessAssessment.findMany({ where: { supersededAt: null, state: "READY_NOW" }, select: { userId: true, roleKey: true } }),
    db.delegatedAuthority.findMany({ where: { revokedAt: null, startsAt: { lte: new Date() }, endsAt: { gt: new Date() }, fromUser: { active: true } }, select: { toUserId: true, domain: true } }),
    // Only whether someone is away: the kind and the note of an absence are not read here.
    db.absenceRecord.findMany({ where: { status: "APPROVED", startsOn: { lte: now }, endsOn: { gte: now } }, select: { userId: true } }),
    db.coverageAssignment.findMany({ where: { revokedAt: null, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } }, select: { actingUserId: true } }),
    grantedByRole(),
  ]);
  const byKey = new Map(roles.map((r) => [r.roleKey, roleData(r)]));
  const awayIds = new Set(away.map((a) => a.userId));
  return backups.filter((b) => byKey.has(b.roleKey)).map((b) => {
    const role = byKey.get(b.roleKey)!;
    const s = suitability({
      sameRole: base.get(b.backupUserId)?.roleProfile?.roleKey === b.roleKey, readyNow: readiness.some((r) => r.userId === b.backupUserId && r.roleKey === b.roleKey), capabilityNote: b.capabilityNote,
      needs: role.authorityDomains, granted: granted.granted[b.backupUser.role] ?? [], lent: lent.filter((l) => l.toUserId === b.backupUserId).map((l) => LENT_TO_AUTHORITY[l.domain]).filter(Boolean),
      active: b.backupUser.active, accessRole: b.backupUser.role, expectedRole: role.soluRole, away: awayIds.has(b.backupUserId), coveringOthers: covering.filter((c) => c.actingUserId === b.backupUserId).length,
    });
    return { ...b, suit: s };
  });
}
export type BackupRow = Awaited<ReturnType<typeof backupsWithSuitability>>[number];
