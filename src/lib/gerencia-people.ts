import { db } from "./db";
import { addDays, today } from "./domain";
import { focusItems, getFocusPolicy } from "./focus";
import { WORK_ROLES as ROLES } from "./permissions";

// Módulo 15 §9, §21 · People & capacity as Gerencia sees it: who is away and whether someone covers, who carries too
// much cover, which relationships and roles have nobody behind them, what support the company owes. It reads facts
// only: no private reflection, no test, no development note, and never the kind of an absence (AC13).

export async function peopleCapacity(now = today()) {
  const horizon = addDays(now, 30);
  const pol = await getFocusPolicy();
  const [people, absences, coverages, backups, strategic, teams, gaps, items, openDeals, overdueMoves] = await Promise.all([
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    // The kind and the note of an absence are deliberately not read here.
    db.absenceRecord.findMany({ where: { status: "APPROVED", endsOn: { gte: now }, startsOn: { lte: horizon } }, orderBy: { startsOn: "asc" }, select: { id: true, userId: true, startsOn: true, endsOn: true, user: { select: { name: true, active: true } } } }),
    db.coverageAssignment.findMany({ where: { revokedAt: null, endsAt: { gt: now } }, select: { id: true, originalUserId: true, actingUserId: true, startsAt: true, endsAt: true, actingUser: { select: { name: true } }, originalUser: { select: { name: true } } } }),
    db.relationshipBackup.findMany({ select: { accountId: true, backupUserId: true, backupUser: { select: { name: true, active: true } } } }),
    db.strategicAccount.findMany({ where: { active: true }, select: { accountId: true } }),
    db.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, leader: { select: { id: true, name: true, active: true } }, members: { select: { userId: true } } } }),
    db.supportGap.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, what: true, impact: true, status: true, dueOn: true, nextMovement: true, user: { select: { name: true } }, owner: { select: { name: true } } } }),
    focusItems(null, pol.value),
    db.deal.groupBy({ by: ["ownerId"], where: { internal: false, stage: { notIn: ["WON", "LOST"] } }, _count: { _all: true } }),
    db.deal.groupBy({ by: ["ownerId"], where: { internal: false, stage: { notIn: ["WON", "LOST"] }, nextMoveDate: { lt: now } }, _count: { _all: true } }),
  ]);

  // Absences in the next 30 days, and whether somebody covers them.
  const away = absences.filter((a) => a.user.active).map((a) => {
    const cover = coverages.find((c) => c.originalUserId === a.userId && c.startsAt <= addDays(a.endsOn, 1) && c.endsAt > a.startsOn);
    return { id: a.id, userId: a.userId, name: a.user.name, startsOn: a.startsOn, endsOn: a.endsOn, coveredBy: cover?.actingUser.name ?? null, now: a.startsOn <= now };
  });

  // Coverage overload: one person standing in for two or more at the same time, or covering while away themselves.
  const active = coverages.filter((c) => c.startsAt <= now);
  const byActing = new Map<string, { name: string; for: string[] }>();
  for (const c of active) { const g = byActing.get(c.actingUserId) ?? { name: c.actingUser.name, for: [] }; g.for.push(c.originalUser.name); byActing.set(c.actingUserId, g); }
  const overload = [...byActing.entries()].map(([id, g]) => ({ id, name: g.name, covering: g.for, alsoAway: away.some((a) => a.userId === id && a.now) })).filter((x) => x.covering.length >= 2 || x.alsoAway).sort((a, b) => a.name.localeCompare(b.name));

  // Critical relationships with nobody behind them: strategic accounts and customers with material Eságara in play.
  const backupBy = new Map(backups.map((b) => [b.accountId, b]));
  const material = new Map<string, { name: string; owner: string; ownerId: string; esagara: number }>();
  for (const x of items) {
    if (x.esagara == null || !x.quoteStatus || x.quoteStatus === "DRAFT") continue;
    const g = material.get(x.accountId) ?? { name: x.account, owner: x.owner, ownerId: x.ownerId, esagara: 0 };
    g.esagara = Math.round((g.esagara + x.esagara) * 100) / 100; material.set(x.accountId, g);
  }
  const strategicIds = new Set(strategic.map((s) => s.accountId));
  const missingNames = [...strategicIds].filter((id) => !material.has(id));
  const extra = missingNames.length ? await db.account.findMany({ where: { id: { in: missingNames }, internal: false }, select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } } }) : [];
  for (const a of extra) material.set(a.id, { name: a.name, owner: a.owner.name, ownerId: a.ownerId, esagara: 0 });
  const noBackup = [...material.entries()]
    .filter(([id, g]) => strategicIds.has(id) || g.esagara >= pol.value.materialEsagaraUsd)
    .map(([id, g]) => { const b = backupBy.get(id); const state = !b ? "NONE" as const : !b.backupUser.active ? "INACTIVE" as const : b.backupUserId === g.ownerId ? "SAME" as const : null; return { id, name: g.name, owner: g.owner, esagara: g.esagara, strategic: strategicIds.has(id), state }; })
    .filter((x): x is typeof x & { state: "NONE" | "INACTIVE" | "SAME" } => x.state != null)
    .sort((a, b) => Number(b.strategic) - Number(a.strategic) || b.esagara - a.esagara);

  // Roles held by one person only (or by nobody): if that person is away, the role stops.
  const singleRoles = ROLES.map((r) => ({ role: r, holders: people.filter((p) => p.role === r) })).filter((x) => x.holders.length <= 1).map((x) => ({ role: x.role, holder: x.holders[0]?.name ?? null, away: x.holders[0] ? away.find((a) => a.userId === x.holders[0].id) ?? null : null }));

  const inTeam = new Set(teams.flatMap((t) => [t.leader.id, ...t.members.map((m) => m.userId)]));
  const openBy = new Map(openDeals.map((g) => [g.ownerId, g._count._all])), lateBy = new Map(overdueMoves.map((g) => [g.ownerId, g._count._all]));
  const load = people.map((p) => ({ id: p.id, name: p.name, role: p.role, open: openBy.get(p.id) ?? 0, overdue: lateBy.get(p.id) ?? 0, covering: byActing.get(p.id)?.for.length ?? 0, away: away.some((a) => a.userId === p.id && a.now) })).filter((p) => p.open > 0 || p.covering > 0 || p.away);

  return {
    asOf: new Date(), headcount: people.length, materialEsagaraUsd: pol.value.materialEsagaraUsd,
    away, uncovered: away.filter((a) => !a.coveredBy), overload, noBackup, singleRoles,
    teams: teams.map((t) => ({ id: t.id, name: t.name, leader: t.leader.name, leaderActive: t.leader.active, leaderAway: away.some((a) => a.userId === t.leader.id && a.now), members: t.members.length })),
    noTeam: people.filter((p) => !inTeam.has(p.id) && p.role !== "GERENCIA").map((p) => ({ id: p.id, name: p.name, role: p.role })),
    gaps: gaps.map((g) => ({ id: g.id, userId: g.userId, who: g.user.name, what: g.what, impact: g.impact, escalated: g.status === "ESCALATED", late: !!g.dueOn && g.dueOn < now, owner: g.owner.name, next: g.nextMovement })),
    load,
  };
}
export type PeopleCapacity = Awaited<ReturnType<typeof peopleCapacity>>;
