import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { isGerencia } from "./permissions";

// Proyectos y notas (owner, 2026-11-23).
// A project is open to the whole company: everyone sees it, its round table and who started it, and anyone joins
// without asking. Only people seated at the round table write in its forum. A note is a personal reminder: only its
// author sees it. Gerencia creates projects for anyone and assigns people; everyone else creates their own and
// invites people, who decide whether to sit.

export const STAGES = [
  { key: "OBJETIVOS", es: "Objetivos", en: "Objectives", field: "objectivesBy", hintEs: "Qué se quiere lograr y cómo se sabrá que se logró.", hintEn: "What is to be achieved and how we will know it was." },
  { key: "PLANIFICACION", es: "Planificación", en: "Planning", field: "planBy", hintEs: "Quién hace qué, con qué y para cuándo.", hintEn: "Who does what, with what and by when." },
  { key: "EJECUCION", es: "Ejecución", en: "Execution", field: "executionBy", hintEs: "Se hace el trabajo y se va contando en el foro.", hintEn: "The work is done and reported in the forum." },
  { key: "RESULTADOS", es: "Resultados", en: "Results", field: "resultsBy", hintEs: "Qué se logró frente al objetivo.", hintEn: "What was achieved against the objective." },
] as const;
export type StageKey = (typeof STAGES)[number]["key"];
export const stageIndex = (k: string) => Math.max(0, STAGES.findIndex((s) => s.key === k));
export const isStage = (k: string): k is StageKey => STAGES.some((s) => s.key === k);

export const DATE_KINDS: Record<string, { es: string; en: string }> = {
  MEETING: { es: "Reunión", en: "Meeting" },
  APPOINTMENT: { es: "Cita", en: "Appointment" },
  DELIVERABLE: { es: "Tarea a ejecutar", en: "Task to do" },
};

/** Tags of a project (owner, 2026-11-23): the owner's own examples first, then the areas of the company. A project
 *  may also carry a few tags of its own, typed by hand. */
export const PROJECT_TAGS: Record<string, { es: string; en: string }> = {
  MARKETING: { es: "Mercadeo", en: "Marketing" },
  LOGISTICS: { es: "Logística", en: "Logistics" },
  PLANNING: { es: "Planeación", en: "Planning" },
  COMMITTEE: { es: "Comité", en: "Committee" },
  // Committees "for fun" too (owner, same day): parties, Christmas, the end-of-year activity, gifts.
  COMMITTEE_PARTY: { es: "Comité de fiestas", en: "Party committee" },
  COMMITTEE_CHRISTMAS: { es: "Comité de Navidad", en: "Christmas committee" },
  COMMITTEE_YEAR_END: { es: "Comité de fin de año", en: "End-of-year committee" },
  COMMITTEE_GIFTS: { es: "Comité de regalos", en: "Gift committee" },
  PURCHASING: { es: "Compras", en: "Purchasing" },
  // The work the company orders by priority (owner, same day): requests, quotes, purchase orders, deliveries.
  REQUESTS: { es: "Solicitudes", en: "Requests" },
  QUOTES: { es: "Cotizaciones", en: "Quotes" },
  PURCHASE_ORDERS: { es: "Órdenes de compra", en: "Purchase orders" },
  DELIVERIES: { es: "Entregas", en: "Deliveries" },
  PRIORITIES: { es: "Prioridades", en: "Priorities" },
  ACTIVITY: { es: "Actividad", en: "Activity" },
  DESIGN: { es: "Diseño", en: "Design" },
  COMMERCIAL: { es: "Comercial", en: "Commercial" },
  OPERATIONS: { es: "Operaciones", en: "Operations" },
  ADMINISTRATION: { es: "Administración", en: "Administration" },
  FINANCE: { es: "Finanzas", en: "Finance" },
  TEAM: { es: "Equipo", en: "Team" },
  TRAINING: { es: "Capacitación", en: "Training" },
  TECHNOLOGY: { es: "Tecnología", en: "Technology" },
  MANAGEMENT: { es: "Gerencia", en: "Management" },
};
export const TAGS_MAX = 6;
export const tagLabel = (k: string, es: boolean) => { const x = PROJECT_TAGS[k]; return x ? (es ? x.es : x.en) : k; };
/** Ticked tags plus the hand-typed ones ("a, b"), without repeats, at most TAGS_MAX. */
export function readTags(fd: FormData) {
  const picked = fd.getAll("tags").map(String).filter((k) => k in PROJECT_TAGS);
  const known = new Map(Object.entries(PROJECT_TAGS).flatMap(([k, v]) => [[v.es.toLowerCase(), k], [v.en.toLowerCase(), k]] as [string, string][]));
  const own = String(fd.get("ownTags") ?? "").split(/[,;\n]/).map((s) => s.replace(/[#"«»<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 24)).filter(Boolean).map((s) => known.get(s.toLowerCase()) ?? s);
  const out: string[] = [];
  for (const x of [...picked, ...own]) if (!out.some((y) => y.toLowerCase() === x.toLowerCase())) out.push(x);
  return out.slice(0, TAGS_MAX);
}

/** Priority of a project: what to choose and do first. The list is ordered by it. */
export const PRIORITIES: Record<string, { es: string; en: string; rank: number; tone: string }> = {
  ALTA: { es: "Prioridad alta", en: "High priority", rank: 0, tone: "attn" },
  MEDIA: { es: "Prioridad media", en: "Medium priority", rank: 1, tone: "info" },
  BAJA: { es: "Prioridad baja", en: "Low priority", rank: 2, tone: "wait" },
};
export const priorityOf = (k: string) => PRIORITIES[k] ?? PRIORITIES.MEDIA;
export const readPriority = (fd: FormData) => { const k = String(fd.get("priority") ?? ""); return k in PRIORITIES ? k : "MEDIA"; };

/** How a person came to the round table. INVITED is not seated yet. */
export const HOW: Record<string, { es: string; en: string }> = {
  LEAD: { es: "Responsable", en: "Lead" },
  ASSIGNED: { es: "Asignado por Gerencia", en: "Assigned by Management" },
  JOINED: { es: "Se unió", en: "Joined" },
  INVITED: { es: "Invitado, aún no entra", en: "Invited, not in yet" },
};
export const isSeated = (m: { how: string } | null | undefined) => !!m && m.how !== "INVITED";

type P = { leadId: string; createdById: string };
/** Moves the stage, edits objective and dates, writes the result, closes: the lead, whoever started it, or Gerencia. */
export const canRunProject = (u: Pick<SessionUser, "id" | "role">, p: P) => isGerencia(u) || u.id === p.leadId || u.id === p.createdById;

export const TEXT_MAX = { title: 120, summary: 280, objective: 2000, post: 4000, note: 2000, date: 140 };

/** PY-0001 for projects, NT-0001 for notes. */
export async function nextProjectCode(kind: "PROJECT" | "NOTE", tx: Prisma.TransactionClient = db) {
  const prefix = kind === "NOTE" ? "NT-" : "PY-";
  const last = await tx.project.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: "desc" }, select: { code: true } });
  return `${prefix}${String((last ? Number(last.code.slice(prefix.length)) : 0) + 1).padStart(4, "0")}`;
}

export const initials = (name: string) => name.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

/** "HH:MM" or null. */
export const cleanTime = (v: unknown) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? "").trim()); return m ? `${m[1]}:${m[2]}` : null; };

// ---------- The 14 days without movement (owner, 2026-11-23: first "1 month", then "14 days MAX") ----------
// A project may go at most QUIET_DAYS without movement. Each project shows its timer. Before or after it runs out,
// anyone at the table presses "Solicitar extensión": it goes straight to Gerencia, who approves up to EXT_MAX_DAYS more.
export const QUIET_DAYS = 14;
export const EXT_DAYS = [7, 14] as const;
export const EXT_MAX_DAYS = 14;
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** The last day the project may stay without movement: a month after it last moved, or the day Gerencia extended it to. */
export function quietLimit(p: { updatedAt: Date; quietUntil: Date | null }) {
  const base = new Date(dayOf(new Date(p.updatedAt.getTime() - 5 * 3600e3)).getTime() + QUIET_DAYS * 864e5);
  return p.quietUntil && p.quietUntil > base ? p.quietUntil : base;
}
export type Health = { key: "closed" | "quiet" | "late" | "soon" | "ok"; daysLeft: number; limit: Date; tone: "ok" | "risk" | "attn" | "info" };
/** One colour per project: red = the month ran out, amber = the current stage is past its date or the month is about
 *  to run out, green = on time. */
export function projectHealth(p: { updatedAt: Date; quietUntil: Date | null; closedAt: Date | null; stage: string; objectivesBy: Date | null; planBy: Date | null; executionBy: Date | null; resultsBy: Date | null }, now: Date): Health {
  const limit = quietLimit(p);
  const daysLeft = Math.round((limit.getTime() - now.getTime()) / 864e5);
  if (p.closedAt) return { key: "closed", daysLeft, limit, tone: "ok" };
  if (daysLeft < 0) return { key: "quiet", daysLeft, limit, tone: "risk" };
  const by = p[STAGES[stageIndex(p.stage)].field];
  if (by && by < now) return { key: "late", daysLeft, limit, tone: "attn" };
  if (daysLeft <= 3) return { key: "soon", daysLeft, limit, tone: "attn" };
  return { key: "ok", daysLeft, limit, tone: "ok" };
}
export function healthText(h: Health, t: (es: string, en: string) => string) {
  if (h.key === "closed") return t("Cerrado", "Closed");
  if (h.key === "quiet") return t(`Sin movimiento hace más de ${QUIET_DAYS} días`, `No movement for over ${QUIET_DAYS} days`);
  if (h.key === "late") return t("Etapa atrasada", "Stage past its date");
  if (h.key === "soon") return h.daysLeft === 0 ? t(`Hoy cumple ${QUIET_DAYS} días sin movimiento`, `${QUIET_DAYS} days without movement today`) : t(`Quedan ${h.daysLeft} d sin movimiento`, `${h.daysLeft} d left without movement`);
  return t("Al día", "On time");
}

// ---------- Forum extras ----------
export const POST_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const POST_FILE_MAX = 4;
export const POST_FILE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
/** "@Paola" in a comment: a first name that belongs to exactly one person. */
export function mentionedIn(body: string, people: { id: string; name: string }[]) {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const first = new Map<string, string[]>();
  for (const p of people) { const k = norm(p.name.trim().split(/\s+/)[0] ?? ""); if (k) first.set(k, [...(first.get(k) ?? []), p.id]); }
  const out = new Set<string>();
  for (const m of body.matchAll(/@([\p{L}]{2,30})/gu)) { const ids = first.get(norm(m[1])); if (ids?.length === 1) out.add(ids[0]); }
  return [...out];
}

export const NUDGE_ANSWERS: Record<string, { es: string; en: string; tone: string }> = {
  ON_TRACK: { es: "Va bien", en: "On track", tone: "ok" },
  LATE: { es: "Va con retraso", en: "Running late", tone: "attn" },
  DONE: { es: "Ya está hecha", en: "Already done", tone: "ok" },
  BLOCKED: { es: "Está bloqueada", en: "It is blocked", tone: "risk" },
};

const listInclude = {
  createdBy: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true } },
  members: { orderBy: { createdAt: "asc" }, select: { userId: true, how: true, seenAt: true, user: { select: { name: true } } } },
  dates: { where: { doneAt: null }, orderBy: { day: "asc" }, take: 1, select: { title: true, day: true, time: true } },
  teams: { orderBy: { createdAt: "asc" }, select: { team: { select: { id: true, name: true } } } },
  account: { select: { id: true, name: true } },
  deal: { select: { id: true, code: true } },
  items: { where: { doneAt: null }, select: { id: true } },
  extensions: { where: { status: "REQUESTED" }, select: { id: true } },
  _count: { select: { posts: { where: { system: false, deletedAt: null } } } },
} satisfies Prisma.ProjectInclude;

/** Every project (never notes), highest priority first, with how many forum posts are new for this person. */
export async function projectList(userId: string) {
  const rows = await db.project.findMany({ where: { kind: "PROJECT" }, orderBy: [{ updatedAt: "desc" }], take: 200, include: listInclude });
  const mine = rows.flatMap((p) => { const m = p.members.find((x) => x.userId === userId); return m && isSeated(m) ? [{ id: p.id, since: m.seenAt ?? new Date(0) }] : []; });
  const fresh = new Map<string, number>();
  await Promise.all(mine.map(async (x) => { const n = await db.projectPost.count({ where: { projectId: x.id, createdAt: { gt: x.since }, authorId: { not: userId }, deletedAt: null, system: false } }); if (n) fresh.set(x.id, n); }));
  // Highest priority first; inside each priority, what moved last.
  return rows.map((p) => ({ ...p, my: p.members.find((x) => x.userId === userId) ?? null, fresh: fresh.get(p.id) ?? 0 })).sort((a, b) => priorityOf(a.priority).rank - priorityOf(b.priority).rank || b.updatedAt.getTime() - a.updatedAt.getTime());
}

export type PostNode = {
  id: string; body: string; system: boolean; deleted: boolean; createdAt: Date; editedAt: Date | null; authorId: string; authorName: string;
  pinned: boolean; decision: boolean; customerInput: boolean; customerName: string | null;
  files: { id: string; name: string; mime: string; size: number }[]; mentions: string[]; replies: PostNode[];
};

/** The forum as a tree: pinned conversations first, then newest first; replies under each one in the order written. */
export async function projectThread(projectId: string): Promise<{ top: PostNode[]; total: number; decisions: PostNode[]; customer: PostNode[] }> {
  const rows = await db.projectPost.findMany({
    where: { projectId }, orderBy: { createdAt: "asc" }, take: 2000,
    select: { id: true, parentId: true, body: true, system: true, deletedAt: true, createdAt: true, editedAt: true, authorId: true, pinned: true, decision: true, customerInput: true, customerName: true, author: { select: { name: true } }, files: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, mime: true, size: true } }, mentions: { select: { user: { select: { name: true } } } } },
  });
  const by = new Map<string, PostNode>();
  for (const r of rows) by.set(r.id, { id: r.id, body: r.deletedAt ? "" : r.body, system: r.system, deleted: !!r.deletedAt, createdAt: r.createdAt, editedAt: r.editedAt, authorId: r.authorId, authorName: r.author.name, pinned: r.pinned && !r.deletedAt, decision: r.decision && !r.deletedAt, customerInput: r.customerInput && !r.deletedAt, customerName: r.customerName, files: r.deletedAt ? [] : r.files, mentions: r.deletedAt ? [] : r.mentions.map((m) => m.user.name), replies: [] });
  const top: PostNode[] = [];
  for (const r of rows) { const n = by.get(r.id)!; const parent = r.parentId ? by.get(r.parentId) : null; if (parent) parent.replies.push(n); else top.push(n); }
  // A deleted post with nothing under it is not shown at all.
  const prune = (list: PostNode[]): PostNode[] => list.map((n) => ({ ...n, replies: prune(n.replies) })).filter((n) => !n.deleted || n.replies.length > 0);
  const ordered = prune(top).reverse();
  const all = [...by.values()].filter((n) => !n.deleted && !n.system);
  return { top: [...ordered.filter((n) => n.pinned), ...ordered.filter((n) => !n.pinned)], total: all.length, decisions: all.filter((n) => n.decision), customer: all.filter((n) => n.customerInput) };
}

// ---------- "Mi trabajo": what is mine across every project ----------
export async function myProjectWork(userId: string, now: Date) {
  const seats = await db.projectMember.findMany({ where: { userId, how: { not: "INVITED" }, project: { kind: "PROJECT", closedAt: null } }, select: { projectId: true } });
  const ids = seats.map((s) => s.projectId);
  const soon = new Date(now.getTime() + 14 * 864e5);
  const [dates, items, asks, mentions, led] = await Promise.all([
    ids.length ? db.projectDate.findMany({ where: { projectId: { in: ids }, doneAt: null, day: { lte: soon } }, orderBy: [{ day: "asc" }, { time: "asc" }], take: 40, select: { id: true, title: true, kind: true, day: true, time: true, createdById: true, project: { select: { id: true, title: true } } } }) : Promise.resolve([]),
    db.projectItem.findMany({ where: { ownerId: userId, doneAt: null, project: { kind: "PROJECT", closedAt: null } }, orderBy: [{ dueOn: { sort: "asc", nulls: "last" } }], take: 40, select: { id: true, title: true, dueOn: true, stage: true, project: { select: { id: true, title: true } } } }),
    db.projectNudge.findMany({ where: { toUserId: userId, answeredAt: null, project: { closedAt: null } }, orderBy: { createdAt: "asc" }, take: 30, select: { id: true, fromName: true, createdAt: true, item: { select: { title: true } }, date: { select: { title: true } }, project: { select: { id: true, title: true } } } }),
    db.projectMention.findMany({ where: { userId, seenAt: null, post: { deletedAt: null } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, byName: true, postId: true, projectId: true, post: { select: { body: true, project: { select: { title: true } } } } } }),
    db.project.findMany({ where: { kind: "PROJECT", closedAt: null, OR: [{ leadId: userId }, { createdById: userId }] }, select: { id: true, title: true, stage: true, updatedAt: true, quietUntil: true, closedAt: true, objectivesBy: true, planBy: true, executionBy: true, resultsBy: true } }),
  ]);
  const mineDates = dates.filter((d) => d.day >= now || d.createdById === userId); // a past date only nags whoever set it
  return {
    dates: mineDates, items, asks, mentions,
    overdueDates: mineDates.filter((d) => d.day < now), tomorrow: mineDates.filter((d) => d.day.getTime() - now.getTime() <= 864e5 && d.day >= now),
    overdueItems: items.filter((x) => x.dueOn && x.dueOn < now),
    ledTrouble: led.map((p) => ({ p, h: projectHealth(p, now) })).filter((x) => x.h.key === "quiet" || x.h.key === "late" || x.h.key === "soon"),
  };
}

// ---------- Gerencia: the weekly look (Cierre ejecutivo) ----------
export async function projectsForManagement(now: Date) {
  const rows = await db.project.findMany({ where: { kind: "PROJECT", closedAt: null }, orderBy: { updatedAt: "asc" }, take: 300, select: { id: true, code: true, title: true, priority: true, stage: true, updatedAt: true, quietUntil: true, closedAt: true, objectivesBy: true, planBy: true, executionBy: true, resultsBy: true, lead: { select: { name: true } }, dates: { where: { doneAt: null, day: { gte: now } }, take: 1, select: { id: true } }, items: { where: { doneAt: null, dueOn: { gte: now } }, take: 1, select: { id: true } } } });
  const withH = rows.map((p) => ({ ...p, h: projectHealth(p, now) }));
  const requests = await db.projectExtension.findMany({ where: { status: "REQUESTED", project: { closedAt: null } }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, days: true, reason: true, requestedByName: true, createdAt: true, project: { select: { id: true, title: true, code: true } } } });
  return {
    open: rows.length,
    quiet: withH.filter((p) => p.h.key === "quiet"), late: withH.filter((p) => p.h.key === "late"), soon: withH.filter((p) => p.h.key === "soon"),
    noNext: withH.filter((p) => p.priority === "ALTA" && p.dates.length === 0 && p.items.length === 0),
    requests,
  };
}

/** Bell and menu counter: only what asks this person for something.
 *  1 · an invitation to answer, or a project Gerencia assigned that the person has not opened;
 *  2 · someone mentioned them, or asked how something of theirs is going (they can switch the second one off);
 *  3 · ONE quiet line that sums up their dates and delays (they can switch it off);
 *  4 · for Gerencia, each extension request; for whoever leads it, a project whose month ran out. */
export async function projectAttention(user: Pick<SessionUser, "id" | "role">, t: (es: string, en: string) => string) {
  const now = (await import("./domain")).today();
  const [seats, prefs, work, requests] = await Promise.all([
    db.projectMember.findMany({
      where: { userId: user.id, OR: [{ how: "INVITED" }, { how: "ASSIGNED", seenAt: null }], project: { kind: "PROJECT", closedAt: null } },
      orderBy: { createdAt: "asc" }, take: 30,
      select: { how: true, addedByName: true, project: { select: { id: true, title: true } } },
    }),
    db.user.findUnique({ where: { id: user.id }, select: { projectAlerts: true, projectAsks: true } }),
    myProjectWork(user.id, now),
    isGerencia(user) ? db.projectExtension.findMany({ where: { status: "REQUESTED", project: { closedAt: null } }, orderBy: { createdAt: "asc" }, take: 20, select: { id: true, days: true, requestedByName: true, project: { select: { id: true, title: true } } } }) : Promise.resolve([]),
  ]);
  type A = { key: string; tone: "attn" | "risk"; href: string; text: string };
  const out: A[] = seats.map((s) => ({
    key: `pj${s.project.id}`, tone: "attn" as const,
    href: s.how === "INVITED" ? "/proyectos#invitaciones" : `/proyectos/${s.project.id}`,
    text: s.how === "INVITED"
      ? t(`${s.addedByName ?? "Alguien"} te invitó al proyecto «${s.project.title}»`, `${s.addedByName ?? "Someone"} invited you to the project "${s.project.title}"`)
      : t(`Gerencia te asignó al proyecto «${s.project.title}»`, `Management assigned you to the project "${s.project.title}"`),
  }));
  for (const r of requests) out.push({ key: `pjx${r.id}`, tone: "attn", href: `/proyectos/${r.project.id}#reloj`, text: t(`${r.requestedByName} pide ${r.days} días más para el proyecto «${r.project.title}»`, `${r.requestedByName} asks for ${r.days} more days for the project "${r.project.title}"`) });
  for (const m of work.mentions) out.push({ key: `pjm${m.id}`, tone: "attn", href: `/proyectos/${m.projectId}#c-${m.postId}`, text: t(`${m.byName} te mencionó en «${m.post.project.title}»`, `${m.byName} mentioned you in "${m.post.project.title}"`) });
  if (prefs?.projectAsks !== false) for (const a of work.asks) out.push({ key: `pja${a.id}`, tone: "attn", href: `/proyectos/${a.project.id}#avance`, text: t(`${a.fromName} te pide el avance de «${a.item?.title ?? a.date?.title ?? ""}»`, `${a.fromName} asks how "${a.item?.title ?? a.date?.title ?? ""}" is going`) });
  for (const x of work.ledTrouble.filter((y) => y.h.key === "quiet")) out.push({ key: `pjq${x.p.id}`, tone: "risk", href: `/proyectos/${x.p.id}#reloj`, text: t(`El proyecto «${x.p.title}» lleva más de ${QUIET_DAYS} días sin movimiento: muévelo o pide una extensión`, `The project "${x.p.title}" has gone over ${QUIET_DAYS} days without movement: move it or ask for an extension`) });
  if (prefs?.projectAlerts !== false) {
    const parts: string[] = [];
    const n = (k: number, es1: string, esN: string, en1: string, enN: string) => { if (k) parts.push(k === 1 ? t(es1, en1) : t(`${k} ${esN}`, `${k} ${enN}`)); };
    n(work.tomorrow.length, "1 fecha entre hoy y mañana", "fechas entre hoy y mañana", "1 date today or tomorrow", "dates today or tomorrow");
    n(work.overdueDates.length, "1 fecha tuya que ya pasó", "fechas tuyas que ya pasaron", "1 date of yours already past", "dates of yours already past");
    n(work.overdueItems.length, "1 tarea tuya atrasada", "tareas tuyas atrasadas", "1 task of yours overdue", "tasks of yours overdue");
    n(work.ledTrouble.filter((y) => y.h.key === "late").length, "1 proyecto tuyo con la etapa atrasada", "proyectos tuyos con la etapa atrasada", "1 project of yours with its stage past due", "projects of yours with their stage past due");
    if (parts.length) out.push({ key: "pjsum", tone: "attn", href: "/proyectos#mi-trabajo", text: t(`Proyectos: ${parts.join(" · ")}`, `Projects: ${parts.join(" · ")}`) });
  }
  return out;
}
