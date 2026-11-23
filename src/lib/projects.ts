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

const listInclude = {
  createdBy: { select: { id: true, name: true } },
  lead: { select: { id: true, name: true } },
  members: { orderBy: { createdAt: "asc" }, select: { userId: true, how: true, seenAt: true, user: { select: { name: true } } } },
  dates: { where: { doneAt: null }, orderBy: { day: "asc" }, take: 1, select: { title: true, day: true, time: true } },
  teams: { orderBy: { createdAt: "asc" }, select: { team: { select: { id: true, name: true } } } },
  _count: { select: { posts: { where: { system: false, deletedAt: null } } } },
} satisfies Prisma.ProjectInclude;

/** Every project (never notes), newest movement first, with how many forum posts are new for this person. */
export async function projectList(userId: string) {
  const rows = await db.project.findMany({ where: { kind: "PROJECT" }, orderBy: [{ updatedAt: "desc" }], take: 200, include: listInclude });
  const mine = rows.flatMap((p) => { const m = p.members.find((x) => x.userId === userId); return m && isSeated(m) ? [{ id: p.id, since: m.seenAt ?? new Date(0) }] : []; });
  const fresh = new Map<string, number>();
  await Promise.all(mine.map(async (x) => { const n = await db.projectPost.count({ where: { projectId: x.id, createdAt: { gt: x.since }, authorId: { not: userId }, deletedAt: null, system: false } }); if (n) fresh.set(x.id, n); }));
  // Highest priority first; inside each priority, what moved last.
  return rows.map((p) => ({ ...p, my: p.members.find((x) => x.userId === userId) ?? null, fresh: fresh.get(p.id) ?? 0 })).sort((a, b) => priorityOf(a.priority).rank - priorityOf(b.priority).rank || b.updatedAt.getTime() - a.updatedAt.getTime());
}

export type PostNode = { id: string; body: string; system: boolean; deleted: boolean; createdAt: Date; authorId: string; authorName: string; replies: PostNode[] };

/** The forum as a tree: conversations newest first, replies under each one in the order they were written. */
export async function projectThread(projectId: string): Promise<{ top: PostNode[]; total: number }> {
  const rows = await db.projectPost.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, take: 2000, select: { id: true, parentId: true, body: true, system: true, deletedAt: true, createdAt: true, authorId: true, author: { select: { name: true } } } });
  const by = new Map<string, PostNode>();
  for (const r of rows) by.set(r.id, { id: r.id, body: r.deletedAt ? "" : r.body, system: r.system, deleted: !!r.deletedAt, createdAt: r.createdAt, authorId: r.authorId, authorName: r.author.name, replies: [] });
  const top: PostNode[] = [];
  for (const r of rows) { const n = by.get(r.id)!; const parent = r.parentId ? by.get(r.parentId) : null; if (parent) parent.replies.push(n); else top.push(n); }
  // A deleted post with nothing under it is not shown at all.
  const prune = (list: PostNode[]): PostNode[] => list.map((n) => ({ ...n, replies: prune(n.replies) })).filter((n) => !n.deleted || n.replies.length > 0);
  return { top: prune(top).reverse(), total: rows.filter((r) => !r.system && !r.deletedAt).length };
}

/** Bell and menu counter: only what asks this person for something. An invitation waits for a yes or a "not now";
 *  a project Gerencia assigned stays until the person opens it once. */
export async function projectAttention(user: Pick<SessionUser, "id">, t: (es: string, en: string) => string) {
  const seats = await db.projectMember.findMany({
    where: { userId: user.id, OR: [{ how: "INVITED" }, { how: "ASSIGNED", seenAt: null }], project: { kind: "PROJECT", closedAt: null } },
    orderBy: { createdAt: "asc" }, take: 30,
    select: { how: true, addedByName: true, project: { select: { id: true, title: true } } },
  });
  return seats.map((s) => ({
    key: `pj${s.project.id}`, tone: "attn" as const,
    href: s.how === "INVITED" ? "/proyectos#invitaciones" : `/proyectos/${s.project.id}`,
    text: s.how === "INVITED"
      ? t(`${s.addedByName ?? "Alguien"} te invitó al proyecto «${s.project.title}»`, `${s.addedByName ?? "Someone"} invited you to the project "${s.project.title}"`)
      : t(`Gerencia te asignó al proyecto «${s.project.title}»`, `Management assigned you to the project "${s.project.title}"`),
  }));
}
