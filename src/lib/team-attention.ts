import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import { db } from "./db";
import { addDays, today } from "./domain";
import { canManageAll } from "./permissions";
import { inForce } from "./gerencia-rules";
import { checkpointsOf, isUnplanned } from "./team-rules";
import { getTeamPolicy, reportIdsOf } from "./team-store";

// Módulo 16 · what Equipo adds to the bell: only what waits for THIS person. Feedback asked of them, a conversation
// whose day arrived, a commitment of theirs past its date, a checkpoint or review of their own cycle, a role
// agreement to go through, the return from an absence, and (for whoever leads) someone away without notice and
// with nobody covering. Nothing here tells one person about the development of another.

export async function teamAttention(user: SessionUser, i: I18n) {
  const { t } = i;
  const T = today(), now = new Date();
  const manage = canManageAll(user);
  const [asked, meetings, commitments, plan, base, back, reports, pol] = await Promise.all([
    db.feedback.findMany({ where: { fromId: user.id, status: "REQUESTED" }, take: 20, select: { id: true, aboutId: true, about: { select: { name: true } } } }),
    db.developmentMeeting.findMany({ where: { status: "PLANNED", scheduledOn: { lte: T }, OR: [{ userId: user.id }, { withId: user.id }] }, take: 20, select: { id: true, userId: true, scheduledOn: true, user: { select: { name: true } }, with: { select: { name: true } } } }),
    db.developmentCommitment.findMany({ where: { ownerId: user.id, status: "OPEN", dueOn: { lt: T } }, take: 20, select: { id: true, userId: true, what: true } }),
    db.developmentPlan.findFirst({ where: { userId: user.id, status: "ACTIVE" }, select: { id: true, startsOn: true, endsOn: true, objectives: { where: { status: "OPEN", reviewOn: { lt: T } }, select: { id: true } } } }),
    db.personRoleAssignment.findFirst({ where: { userId: user.id, effectiveTo: null, acting: false, roleProfileId: { not: null } }, orderBy: { effectiveFrom: "desc" }, select: { reviewedVersion: true, roleProfile: { select: { roleKey: true } } } }),
    db.coverageAssignment.findMany({ where: { originalUserId: user.id, returnedAt: null, startsAt: { lte: now }, OR: [{ revokedAt: { gte: addDays(T, -14) } }, { revokedAt: null, endsAt: { lte: now, gte: addDays(T, -14) } }] }, take: 5, select: { id: true, actingUser: { select: { name: true } } } }),
    reportIdsOf(user.id), getTeamPolicy(),
  ]);
  const [planMeetings, versions, away] = await Promise.all([
    plan ? db.developmentMeeting.findMany({ where: { planId: plan.id, checkpointDay: { not: null }, status: { not: "CANCELLED" } }, select: { checkpointDay: true } }) : [],
    base?.roleProfile ? db.roleProfile.findMany({ where: { roleKey: base.roleProfile.roleKey }, select: { version: true, effectiveFrom: true } }) : [],
    // Someone away today whose absence nobody could plan: only for whoever leads them, or for management.
    manage || reports.length ? db.absenceRecord.findMany({ where: { status: "APPROVED", startsOn: { lte: T }, endsOn: { gte: T }, user: { active: true }, ...(manage ? { userId: { not: user.id } } : { userId: { in: reports } }) }, select: { id: true, userId: true, startsOn: true, createdAt: true, user: { select: { name: true } } } }) : [],
  ]);
  const unplanned = away.filter(isUnplanned);
  const covered = unplanned.length ? await db.coverageAssignment.findMany({ where: { originalUserId: { in: unplanned.map((a) => a.userId) }, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, select: { originalUserId: true } }) : [];
  const uncovered = unplanned.filter((a) => !covered.some((c) => c.originalUserId === a.userId));
  const met = new Set(planMeetings.map((m) => m.checkpointDay));
  const cpDue = plan ? checkpointsOf(plan.startsOn, pol.value).filter((c) => c.on < T && !met.has(c.day)) : [];
  const cur = versions.length ? inForce(versions, T) : null;

  const alerts = [
    ...uncovered.map((a) => ({ key: `tu${a.id}`, tone: "risk" as const, href: `/comercial/cobertura?scan=${a.userId}#escaneo`, text: t(`${a.user.name} está ausente sin aviso y nadie cubre: revisa qué no puede esperar`, `${a.user.name} is away without notice and nobody covers: check what can't wait`) })),
    ...back.map((c) => ({ key: `tr${c.id}`, tone: "attn" as const, href: `/comercial/cobertura/${c.id}#regreso`, text: t(`Regresaste: mira qué pasó mientras ${c.actingUser.name} te cubría y recibe tu trabajo de vuelta`, `You are back: see what happened while ${c.actingUser.name} covered you and take your work back`) })),
    ...asked.map((f) => ({ key: `tf${f.id}`, tone: "attn" as const, href: `/equipo/feedback#f-${f.id}`, text: f.aboutId === user.id ? t("Tienes un autofeedback pendiente", "You have a self-feedback pending") : t(`Te pidieron feedback sobre ${f.about.name}`, `Feedback about ${f.about.name} was asked of you`) })),
    ...meetings.map((m) => ({ key: `tm${m.id}`, tone: "attn" as const, href: `/equipo/reuniones/${m.id}`, text: t(`Conversación de desarrollo con ${m.userId === user.id ? m.with.name : m.user.name}: ${m.scheduledOn < T ? "su fecha ya pasó, falta cerrarla" : "es hoy"}`, `Development conversation with ${m.userId === user.id ? m.with.name : m.user.name}: ${m.scheduledOn < T ? "its date has passed, it needs closing" : "is today"}`) })),
    ...commitments.map((c) => ({ key: `tc${c.id}`, tone: "attn" as const, href: `/equipo/desarrollo${c.userId === user.id ? "" : `?p=${c.userId}`}#compromisos`, text: t(`Compromiso de desarrollo que pasó su fecha: ${c.what}`, `Development commitment past its date: ${c.what}`) })),
    ...(plan && T > plan.endsOn ? [{ key: `te${plan.id}`, tone: "attn" as const, href: "/equipo/desarrollo#cerrar", text: t("Tu ciclo de desarrollo terminó: toca cerrarlo y abrir el siguiente", "Your development cycle ended: time to close it and open the next") }] : []),
    ...cpDue.slice(0, 1).map((c) => ({ key: `tk${plan!.id}-${c.day}`, tone: "attn" as const, href: "/equipo/reuniones#nueva", text: t(`Punto de control del día ${c.day} de tu ciclo sin conversación programada`, `Day-${c.day} checkpoint of your cycle with no conversation scheduled`) })),
    ...(plan && plan.objectives.length ? [{ key: `to${plan.id}`, tone: "attn" as const, href: "/equipo/desarrollo#objetivos", text: t(`${plan.objectives.length} objetivo(s) de desarrollo pasaron su fecha de revisión`, `${plan.objectives.length} development objective(s) are past their review date`) }] : []),
    ...(cur && base && base.reviewedVersion !== cur.version ? [{ key: `tv${base.roleProfile!.roleKey}-${cur.version}`, tone: "attn" as const, href: "/equipo/mi-rol#rol", text: t("Tu acuerdo de rol tiene expectativas por revisar con tu líder", "Your role agreement has expectations to review with your leader") }] : []),
  ];
  return { alerts, risk: alerts.some((a) => a.tone === "risk") };
}
