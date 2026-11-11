"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia, WORK_ROLES } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { fDay, fPick, fText } from "@/lib/fd";
import { GAP_KINDS } from "@/lib/admin-rules";
import { canPublish, changedFields, inForce } from "@/lib/gerencia-rules";
import { charterVersions, chartersInForce, getGerenciaPolicy, identityInForce } from "@/lib/gerencia-store";
import { BACKUP_KINDS, DIMS, GAP_DIMS, ROLE_DATA_FIELDS, TEAM_POLICY_KEY, cleanTeamPolicy, gapResult, readinessIssues, roleFromForm, roleIssues } from "@/lib/team-rules";
import { getTeamPolicy, relationTo, reportIdsOf, roleData, roleVersions, rolesInForce } from "@/lib/team-store";

// Módulo 16 §17–26 · Role agreements and what hangs from them. Publishing never edits: it writes a new version with
// its date, reason and author, stamped with the company identity and function charter in force that day, so a later
// identity never rewrites the agreement someone worked under. Assigning a role never erases the previous assignment.

const go = (path: string): never => { refreshApp(); redirect(path); };
const backOf = (fd: FormData, fallback: string) => { const b = String(fd.get("back") ?? ""); return /^\/equipo\/[a-z0-9\-/]*(\?[^#\s]*)?$/i.test(b) ? b : fallback; };
const withQs = (path: string, qs: string, hash = "") => `${path}${path.includes("?") ? "&" : "?"}${qs}${hash}`;

export async function publishRole(fd: FormData) {
  const user = await requireUser();
  const pol = await getGerenciaPolicy();
  const input = roleFromForm((k, max = 300) => fText(fd, k, max), (k) => fd.getAll(k).map(String));
  const isNew = fd.get("mode") === "new";
  const back = isNew || !input.roleKey ? "/equipo/roles" : `/equipo/roles/${input.roleKey}`;
  if (!canPublish(user.role, pol.value)) go(`${back}?err=autoridad`);
  const meta = { effectiveFrom: fDay(fd, "effectiveFrom"), reason: fText(fd, "reason", 1000) };
  const issues = roleIssues(input, meta, WORK_ROLES);
  if (issues.length) go(`${back}?err=faltan&f=${issues.join(",")}#publicar`);
  const versions = await roleVersions(input.roleKey);
  if (isNew && versions.length) go(`/equipo/roles?err=existe&f=title#publicar`);
  const last = versions[0] ?? null;
  if (last && changedFields(roleData(last) as unknown as Record<string, unknown>, input as unknown as Record<string, unknown>, ROLE_DATA_FIELDS).length === 0) go(`${back}?ok=igual`);
  const [identity, charters] = await Promise.all([identityInForce(meta.effectiveFrom!), charterVersions()]);
  const charter = chartersInForce(charters, meta.effectiveFrom!).find((c) => c.functionKey === input.functionKey) ?? null;
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  await db.roleProfile.create({ data: {
    roleKey: input.roleKey, version: (last?.version ?? 0) + 1, title: input.title, functionKey: input.functionKey, soluRole: input.soluRole, critical: input.critical, purpose: input.purpose,
    outcomes: json(input.outcomes), functions: json(input.functions), responsibilities: json(input.responsibilities), decisionRights: json(input.decisionRights), authorityDomains: json(input.authorityDomains), boundaries: json(input.boundaries),
    inputs: json(input.inputs), outputs: json(input.outputs), customers: json(input.customers), qualityStandards: json(input.qualityStandards), behaviors: json(input.behaviors), methodologies: json(input.methodologies),
    performance: json(input.performance), competencies: json(input.competencies), risks: json(input.risks), rhythm: json(input.rhythm), successSignals: json(input.successSignals), attentionSignals: json(input.attentionSignals),
    careerLevels: json(input.careerLevels), careerExpectations: json(input.careerExpectations), companyCommitments: json(input.companyCommitments),
    identityVersion: identity?.version ?? null, charterVersion: charter?.version ?? null, effectiveFrom: meta.effectiveFrom!, reason: meta.reason!, publishedById: user.id, publishedByName: user.name,
  } });
  go(`/equipo/roles/${input.roleKey}?ok=publicada`);
}

/** Links a person to a role agreement. The base assignment in force is closed that day and a new one opens, so the
 *  history keeps every role the person held. An acting role has an end date and leaves the base one untouched. */
export async function assignRole(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/equipo/claridad");
  if (!isGerencia(user)) go(withQs(back, "err=asignar-permiso"));
  const roleKey = fText(fd, "roleKey", 80), from = fDay(fd, "effectiveFrom"), reason = fText(fd, "reason", 300);
  const acting = fd.get("acting") === "1", to = fDay(fd, "effectiveTo");
  const [person, all, charters] = await Promise.all([db.user.findUnique({ where: { id: personId }, select: { id: true, role: true, active: true } }), roleVersions(roleKey ?? "-"), charterVersions()]);
  const profile = from ? inForce(all, from) : null;
  if (!person?.active || !profile || !from || !reason) go(withQs(back, "err=asignar", `#p-${personId}`));
  if (acting && (!to || to <= from!)) go(withQs(back, "err=temporal", `#p-${personId}`));
  const current = await db.personRoleAssignment.findFirst({ where: { userId: personId, effectiveTo: null, acting: false }, orderBy: { effectiveFrom: "desc" } });
  if (!acting && current && from! <= current.effectiveFrom) go(withQs(back, "err=asignar-fecha", `#p-${personId}`));
  const leaderId = fText(fd, "leaderId", 40);
  const leader = leaderId && leaderId !== personId ? await db.user.findFirst({ where: { id: leaderId, active: true }, select: { id: true } }) : null;
  const [identity] = await Promise.all([identityInForce(from!)]);
  const charter = chartersInForce(charters, from!).find((c) => c.functionKey === profile!.functionKey) ?? null;
  const level = fText(fd, "level", 80);
  const data = {
    userId: personId, contractualTitle: fText(fd, "contractualTitle", 160) ?? current?.contractualTitle ?? profile!.title, operatingRole: person!.role, unit: current?.unit ?? null, location: current?.location ?? null,
    leaderId: fd.has("leaderId") ? leader?.id ?? null : current?.leaderId ?? null, effectiveFrom: from!, reason: reason!, setByName: user.name,
    roleProfileId: profile!.id, charterVersion: charter?.version ?? null, identityVersion: identity?.version ?? null, level,
  };
  if (acting) await db.personRoleAssignment.create({ data: { ...data, acting: true, effectiveTo: to! } });
  else await db.$transaction([
    ...(current ? [db.personRoleAssignment.update({ where: { id: current.id }, data: { effectiveTo: from! } })] : []),
    db.personRoleAssignment.create({ data }),
  ]);
  go(withQs(back, acting ? "ok=temporal" : "ok=asignado", `#p-${personId}`));
}

/** The person, or the leader who went through it with them, records that the expectations of the agreement in
 *  force were reviewed. It marks the assignment; it changes nothing of what was agreed. */
export async function reviewExpectations(assignmentId: string, fd: FormData) {
  const user = await requireUser();
  const a = await db.personRoleAssignment.findUnique({ where: { id: assignmentId }, select: { userId: true, effectiveTo: true, roleProfile: { select: { roleKey: true } } } });
  if (!a?.roleProfile) redirect("/equipo/mi-rol");
  const back = backOf(fd, a!.userId === user.id ? "/equipo/mi-rol" : `/equipo/mi-rol?p=${a!.userId}`);
  const rel = await relationTo(user, a!.userId);
  if (!(rel.self || rel.leader)) go(withQs(back, "err=permiso"));
  const cur = inForce(await roleVersions(a!.roleProfile!.roleKey), today());
  if (!cur) go(withQs(back, "err=permiso"));
  await db.personRoleAssignment.update({ where: { id: assignmentId }, data: { reviewedVersion: cur!.version, reviewedAt: new Date(), reviewedByName: user.name } });
  go(withQs(back, "ok=revisado", "#rol"));
}

/** AC7 (v1.1) · an expectation of the role that cannot be met because a tool, an authority, information, training
 *  or access is missing. It is a debt of the company with the role, owned by someone, never a mark on the person. */
export async function raiseRoleSupport(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, personId === user.id ? "/equipo/mi-rol" : `/equipo/mi-rol?p=${personId}`);
  const rel = await relationTo(user, personId);
  if (!(rel.self || rel.leader || rel.gerencia)) go(withQs(back, "err=permiso"));
  const kind = fPick(fd, "kind", GAP_KINDS), what = fText(fd, "what", 300), next = fText(fd, "nextMovement", 300), expectation = fText(fd, "expectation", 400);
  const owner = await db.user.findFirst({ where: { id: String(fd.get("ownerId") ?? ""), active: true }, select: { id: true } });
  if (!kind || !what || !next || !owner || !expectation) go(withQs(back, "err=soporte", "#soporte"));
  await db.supportGap.create({ data: { userId: personId, kind: kind!, what: what!, expectation, impact: fText(fd, "impact", 300), ownerId: owner!.id, nextMovement: next!, dueOn: fDay(fd, "dueOn"), raisedByName: user.name } });
  go(withQs(back, "ok=soporte", "#soporte"));
}

// ---------- Role Gap Analysis (§24) ----------

/** One dimension of the agreement against real evidence. Written by the leader (or Gerencia) with the person; the
 *  person always sees it. With no evidence the result is "not enough evidence", whatever was chosen (AC8). */
export async function saveGapReview(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, `/equipo/mi-rol?p=${personId}`);
  const rel = await relationTo(user, personId);
  if (rel.self || !(rel.leader || rel.gerencia)) go(withQs(back, "err=brecha-permiso", "#crecer"));
  const dimension = String(fd.get("dimension") ?? ""), roleKey = fText(fd, "roleKey", 80);
  const cur = roleKey ? inForce(await roleVersions(roleKey), today()) : null;
  if (!cur || !GAP_DIMS.some((d) => d.key === dimension)) go(withQs(back, "err=brecha", "#crecer"));
  const evidence = fText(fd, "evidence", 1000);
  const result = gapResult(fText(fd, "result", 20), evidence);
  await db.$transaction([
    db.roleGapReview.updateMany({ where: { userId: personId, roleKey: roleKey!, dimension, supersededAt: null }, data: { supersededAt: new Date() } }),
    db.roleGapReview.create({ data: { userId: personId, roleKey: roleKey!, version: cur!.version, dimension, result, evidence, reviewedById: user.id, reviewedByName: user.name, reviewedOn: today() } }),
  ]);
  // A gap may become a development opportunity: something to grow, said as such.
  if (result === "GAP" && fd.get("opportunity") === "1") {
    const label = GAP_DIMS.find((d) => d.key === dimension)!.label.es;
    const what = fText(fd, "opportunityText", 400) ?? `${label}: ${evidence}`;
    const ref = `${roleKey}:${dimension}`;
    if (!(await db.developmentOpportunity.count({ where: { userId: personId, source: "ROLE_GAP", sourceRef: ref, status: { not: "DISMISSED" } } }))) await db.developmentOpportunity.create({ data: { userId: personId, source: "ROLE_GAP", sourceRef: ref, dimension: fPick(fd, "oppDimension", DIMS), what: what.slice(0, 400), raisedById: user.id, raisedByName: user.name } });
  }
  go(withQs(back, result === "NOT_ENOUGH" && fText(fd, "result", 20) !== "NOT_ENOUGH" ? "ok=brecha-sin-evidencia" : "ok=brecha", "#crecer"));
}

// ---------- Readiness and succession (§7) ----------

export async function saveReadiness(personId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, `/equipo/perfil?p=${personId}`);
  const rel = await relationTo(user, personId);
  if (rel.self || !(rel.leader || rel.gerencia)) go(withQs(back, "err=readiness-permiso", "#readiness"));
  const r = { roleKey: fText(fd, "roleKey", 80), state: fText(fd, "state", 20), evidence: fText(fd, "evidence", 1000), gaps: fText(fd, "gaps", 1000), plan: fText(fd, "plan", 1000), assessedOn: fDay(fd, "assessedOn") ?? today() };
  const exists = r.roleKey ? rolesInForce(await roleVersions(r.roleKey)).length > 0 : false;
  if (!exists || readinessIssues(r, today()).length) go(withQs(back, "err=readiness", "#readiness"));
  const level = fText(fd, "level", 80);
  await db.$transaction([
    db.readinessAssessment.updateMany({ where: { userId: personId, roleKey: r.roleKey!, level, supersededAt: null }, data: { supersededAt: new Date() } }),
    db.readinessAssessment.create({ data: { userId: personId, roleKey: r.roleKey!, level, state: r.state!, evidence: r.evidence!, gaps: r.gaps, plan: r.plan, assessedById: user.id, assessedByName: user.name, assessedOn: r.assessedOn } }),
  ]);
  go(withQs(back, "ok=readiness", "#readiness"));
}

/** Who may arrange succession: Gerencia and Dirección for any role; a leader for the roles their people hold. */
async function maySucceed(user: Awaited<ReturnType<typeof requireUser>>, roleKey: string) {
  if (canManageAll(user)) return true;
  const ids = await reportIdsOf(user.id);
  return ids.length > 0 && (await db.personRoleAssignment.count({ where: { userId: { in: ids }, effectiveTo: null, acting: false, roleProfile: { roleKey } } })) > 0;
}

export async function setRoleBackup(fd: FormData) {
  const user = await requireUser();
  const back = "/equipo/continuidad";
  const roleKey = fText(fd, "roleKey", 80), kind = fPick(fd, "kind", BACKUP_KINDS), backupUserId = fText(fd, "backupUserId", 40), holderId = fText(fd, "holderId", 40);
  if (!roleKey || !(await maySucceed(user, roleKey))) go(`${back}?err=permiso`);
  const [exists, person] = await Promise.all([rolesInForce(await roleVersions(roleKey!)).length > 0, backupUserId ? db.user.findFirst({ where: { id: backupUserId, active: true }, select: { id: true } }) : null]);
  if (!exists || !kind || !person) go(`${back}?err=respaldo#r-${roleKey}`);
  // A person cannot be the backup of the very seat they hold.
  if (holderId && holderId === person!.id) go(`${back}?err=mismo#r-${roleKey}`);
  if (await db.roleBackup.count({ where: { roleKey: roleKey!, backupUserId: person!.id, kind: kind!, endedAt: null } })) go(`${back}?err=repetido#r-${roleKey}`);
  await db.roleBackup.create({ data: { roleKey: roleKey!, holderId: holderId || null, backupUserId: person!.id, kind: kind!, capabilityNote: fText(fd, "capabilityNote", 500), note: fText(fd, "note", 300), setByName: user.name } });
  go(`${back}?ok=respaldo#r-${roleKey}`);
}

export async function endRoleBackup(id: string) {
  const user = await requireUser();
  const b = await db.roleBackup.findUnique({ where: { id }, select: { roleKey: true, endedAt: true } });
  if (!b) redirect("/equipo/continuidad");
  if (!(await maySucceed(user, b!.roleKey))) go("/equipo/continuidad?err=permiso");
  if (!b!.endedAt) await db.roleBackup.update({ where: { id }, data: { endedAt: new Date(), endedByName: user.name } });
  go(`/equipo/continuidad?ok=respaldo-fin#r-${b!.roleKey}`);
}

// ---------- Policy ----------

/** The numbers of the development programme: Gerencia only, a new version with its reason. Cycles already open
 *  keep the dates they were opened with. */
export async function saveTeamPolicy(fd: FormData) {
  const back = "/equipo/organizacion";
  const user = await requireUser();
  if (!isGerencia(user)) go(`${back}?err=gerencia#politica`);
  const value = cleanTeamPolicy(Object.fromEntries(fd.entries()));
  const reason = fText(fd, "reason", 300);
  if (!value) go(`${back}?err=valores#politica`);
  if (!reason) go(`${back}?err=motivo#politica`);
  const cur = await getTeamPolicy();
  if (cur.version > 0 && JSON.stringify(cur.value) === JSON.stringify(value)) go(`${back}?ok=igual#politica`);
  await db.marketSetting.create({ data: { key: TEAM_POLICY_KEY, version: cur.version + 1, value: value as unknown as Prisma.InputJsonValue, updatedByName: user.name, reason } });
  go(`${back}?ok=guardada#politica`);
}
