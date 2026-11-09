// Mercado M6 · Need handoff (§12). Mercado never passes a "lead": it suggests a Need only when there is
// evidence of something concrete the company must solve, protect, avoid or achieve. A person confirms it;
// confirming creates the Journey transparently and it is born with everything Mercado already knew.
// Rule-based (no AI yet): the evidence is what people recorded, with its source.
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, daysBetween, nextCode, today } from "./domain";
import { impactRange, INSIGHT_BLOCKS } from "./market-rules";

type L = { es: string; en: string };
const HORIZON_DAYS = 180; // a future event further away than this is still a signal to watch, not a Need

export type NeedSuggestion = {
  ref: string; kind: "PROBLEM" | "FUTURE"; why: L;
  accountId: string; accountName: string; contactId: string | null; contactName: string | null;
  plantId: string | null; plantName: string | null; explorationId: string | null;
  title: string; desiredResult: string; evidence: string; neededBy: Date | null; nextMove: string | null;
  observedAt: Date; confidence: string; sourceRef: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const noDot = (s: string) => s.replace(/[.\s]+$/, "");

/** Suggestions for a company, a person or an exploration (its linked companies). */
export async function needSuggestions(scope: { accountIds?: string[]; contactId?: string }, now = new Date()): Promise<NeedSuggestion[]> {
  let accountIds = scope.accountIds ?? [];
  if (scope.contactId) {
    const c = await db.contact.findUnique({ where: { id: scope.contactId }, select: { accountId: true } });
    accountIds = c?.accountId ? [c.accountId] : [];
  }
  if (!accountIds.length) return [];
  const [notes, futures, used, dismissed, explorations] = await Promise.all([
    // A problem the person told us about. Problems learned from our own Journeys (INTERNAL) were already handled there.
    db.personNote.findMany({
      where: { kind: "PROBLEM", supersededAt: null, sourceType: { not: "INTERNAL" }, contact: { accountId: { in: accountIds } }, ...(scope.contactId ? { contactId: scope.contactId } : {}) },
      include: { contact: { select: { id: true, firstName: true, lastName: true, accountId: true, account: { select: { name: true } }, employments: { where: { endedOn: null }, select: { plantId: true, plant: { select: { name: true } } }, take: 1 } } } },
      orderBy: { observedAt: "desc" },
    }),
    scope.contactId ? Promise.resolve([]) : db.futureOpportunity.findMany({
      where: { accountId: { in: accountIds }, status: "OPEN", dealId: null, expectedAt: { lte: addDays(now, HORIZON_DAYS) } },
      include: { account: { select: { name: true } }, plant: { select: { name: true } } }, orderBy: { expectedAt: "asc" },
    }),
    db.deal.findMany({ where: { accountId: { in: accountIds }, originRef: { not: null } }, select: { originRef: true } }),
    db.needDismissal.findMany({ where: { accountId: { in: accountIds } }, select: { ref: true } }),
    db.explorationLink.findMany({ where: { kind: "ACCOUNT", refId: { in: accountIds }, exploration: { lifecycle: "ACTIVE" } }, select: { refId: true, explorationId: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const skip = new Set([...used.map((u) => u.originRef!), ...dismissed.map((d) => d.ref)]);
  const explOf = (accountId: string) => explorations.find((e) => e.refId === accountId)?.explorationId ?? null;
  const out: NeedSuggestion[] = [];
  for (const n of notes) {
    const ref = `note:${n.id}`;
    if (skip.has(ref) || !n.contact.accountId) continue;
    const emp = n.contact.employments[0];
    const name = `${n.contact.firstName} ${n.contact.lastName}`.trim();
    out.push({
      ref, kind: "PROBLEM",
      why: { es: `${name} nos contó una dificultad concreta. Parece una necesidad, no solo una señal.`, en: `${name} told us about a concrete difficulty. It looks like a need, not just a signal.` },
      accountId: n.contact.accountId, accountName: n.contact.account?.name ?? "", contactId: n.contact.id, contactName: name,
      plantId: emp?.plantId ?? null, plantName: emp?.plant?.name ?? null, explorationId: explOf(n.contact.accountId),
      title: clip(noDot(n.statement), 120), desiredResult: `Resolver: ${noDot(n.statement)}`.slice(0, 300),
      evidence: [n.statement, n.evidence].filter(Boolean).join(" · "), neededBy: null, nextMove: null,
      observedAt: n.observedAt, confidence: n.confidence, sourceRef: n.sourceRef,
    });
  }
  for (const f of futures) {
    const ref = `future:${f.id}`;
    if (skip.has(ref) || !f.accountId) continue;
    const days = f.expectedAt ? daysBetween(now, f.expectedAt) : null;
    out.push({
      ref, kind: "FUTURE",
      why: { es: `Se acerca algo que nos contaron${days != null ? ` (en ${Math.max(days, 0)} días)` : ""}. Si hay algo que preparar, mejor empezar con tiempo.`, en: `Something they told us about is coming up${days != null ? ` (in ${Math.max(days, 0)} days)` : ""}. If there's something to prepare, better to start early.` },
      accountId: f.accountId, accountName: f.account?.name ?? "", contactId: null, contactName: null,
      plantId: f.plantId, plantName: f.plant?.name ?? null, explorationId: f.explorationId ?? explOf(f.accountId),
      title: clip(noDot(f.description), 120), desiredResult: `Llegar a «${noDot(f.description)}» con lo necesario a tiempo`.slice(0, 300),
      evidence: [f.description, f.impact].filter(Boolean).join(" · "), neededBy: f.expectedAt, nextMove: f.nextMove,
      observedAt: f.observedAt, confidence: f.confidence, sourceRef: f.sourceRef,
    });
  }
  return out;
}

export type CtxGroup = "WHAT" | "PERSON" | "OPERATE" | "DECIDE" | "BUY" | "VALUE" | "HURT" | "IMPACT" | "TECH" | "SIGNAL" | "MISSING" | "NEXT";
export type CtxItem = { group: CtxGroup; text: string; source: string; confidence?: string };
export type NeedContext = { version: "need-v1"; at: string; accountName: string; plantName: string | null; personName: string | null; explorationId: string | null; explorationName: string | null; origin: string | null; items: CtxItem[] };

export const CTX_GROUPS: Record<CtxGroup, L> = {
  WHAT: { es: "Qué está pasando", en: "What's happening" },
  PERSON: { es: "Persona", en: "Person" },
  OPERATE: { es: INSIGHT_BLOCKS.OPERATE.es, en: INSIGHT_BLOCKS.OPERATE.en },
  DECIDE: { es: INSIGHT_BLOCKS.DECIDE.es, en: INSIGHT_BLOCKS.DECIDE.en },
  BUY: { es: INSIGHT_BLOCKS.BUY.es, en: INSIGHT_BLOCKS.BUY.en },
  VALUE: { es: "Qué valoran", en: "What they value" },
  HURT: { es: "Qué les duele", en: "What hurts" },
  IMPACT: { es: "Impacto operacional", en: "Operational impact" },
  TECH: { es: "Equipos conocidos", en: "Known equipment" },
  SIGNAL: { es: "Qué cambió", en: "What changed" },
  MISSING: { es: "Qué falta saber", en: "What we still need to know" },
  NEXT: { es: "Siguiente movimiento útil", en: "Next useful move" },
};

const n = (v: unknown) => (v == null ? null : Number(v));
const fmtNum = (v: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(v);

/** Everything Mercado knows that the Journey should be born with (§12.2), each item with its source id. */
export async function inheritedContext(o: { accountId: string; plantId?: string | null; contactId?: string | null; explorationId?: string | null; originRef?: string | null; evidence?: string | null }, now = new Date()): Promise<NeedContext> {
  const [account, plant, contact, exploration, insights, impacts, assets, signals, gaps, future] = await Promise.all([
    db.account.findUniqueOrThrow({ where: { id: o.accountId }, select: { name: true } }),
    o.plantId ? db.plant.findUnique({ where: { id: o.plantId }, select: { name: true } }) : null,
    o.contactId ? db.contact.findUnique({ where: { id: o.contactId }, select: { id: true, firstName: true, lastName: true, title: true, employments: { where: { endedOn: null }, select: { role: true, area: true }, take: 1 }, personNotes: { where: { supersededAt: null, kind: { in: ["DECISION_ROLE", "VALUES", "OBJECTIVE", "PREFERENCE"] } }, orderBy: { observedAt: "desc" } } } }) : null,
    o.explorationId ? db.exploration.findUnique({ where: { id: o.explorationId }, select: { id: true, name: true, nextMove: true } }) : null,
    db.accountInsight.findMany({ where: { accountId: o.accountId, supersededAt: null, OR: [{ plantId: null }, ...(o.plantId ? [{ plantId: o.plantId }] : [])] }, orderBy: { observedAt: "desc" } }),
    o.plantId ? db.impactProfile.findMany({ where: { plantId: o.plantId }, orderBy: { observedAt: "desc" }, take: 2 }) : [],
    o.plantId ? db.installedAsset.findMany({ where: { plantId: o.plantId }, orderBy: [{ critical: "desc" }, { observedAt: "desc" }], take: 5 }) : [],
    db.marketSignal.findMany({ where: { accountId: o.accountId, observedAt: { gte: addDays(now, -90) }, status: { not: "DISMISSED" } }, orderBy: { observedAt: "desc" }, take: 3 }),
    db.knowledgeGap.findMany({ where: { accountId: o.accountId, status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 5 }),
    o.originRef?.startsWith("future:") ? db.futureOpportunity.findUnique({ where: { id: o.originRef.slice(7) }, select: { nextMove: true } }) : null,
  ]);
  const items: CtxItem[] = [];
  const add = (group: CtxGroup, text: string | null | undefined, source: string, confidence?: string) => { if (text?.trim()) items.push({ group, text: text.trim(), source, confidence }); };
  add("WHAT", o.evidence, o.originRef ?? "manual");
  if (contact) {
    const role = contact.employments[0]?.role ?? contact.title;
    add("PERSON", `${contact.firstName} ${contact.lastName}`.trim() + (role ? ` · ${role}` : ""), `contact:${contact.id}`);
    for (const pn of contact.personNotes) add(pn.kind === "VALUES" ? "VALUE" : pn.kind === "DECISION_ROLE" ? "DECIDE" : "PERSON", pn.evidence ? `${pn.statement} (${pn.evidence})` : pn.statement, `note:${pn.id}`, pn.confidence);
  }
  for (const x of insights) {
    const g = (["OPERATE", "DECIDE", "BUY", "VALUE", "HURT"] as const).find((b) => b === x.block);
    if (!g) continue;
    const lead = [x.area, x.condition ? `si ${x.condition}` : null].filter(Boolean).join(", ");
    add(g, `${lead ? `${lead}: ` : ""}${x.statement}${x.evidence ? ` (${x.evidence})` : ""}`, `insight:${x.id}`, x.confidence);
  }
  for (const p of impacts) {
    const r = impactRange({ level: p.level, costPerHourMin: n(p.costPerHourMin), costPerHourMax: n(p.costPerHourMax), unitsPerHour: n(p.unitsPerHour), contributionUnit: n(p.contributionUnit), scrapPerHour: n(p.scrapPerHour), idleLaborPerHour: n(p.idleLaborPerHour) });
    const range = r ? `${p.currency} ${fmtNum(r.min)}–${fmtNum(r.max)} por hora` : null;
    add("IMPACT", [p.scope, p.stopsLine === "YES" ? "detiene la línea" : null, p.timeToImpact, range, p.basis].filter(Boolean).join(" · "), `impact:${p.id}`, p.confidence);
  }
  for (const a of assets) add("TECH", [a.name, [a.manufacturer, a.model].filter(Boolean).join(" "), a.critical ? "crítico" : null].filter(Boolean).join(" · "), `asset:${a.id}`, a.confidence);
  for (const s of signals) add("SIGNAL", s.what, `signal:${s.id}`, s.confidence);
  for (const g of gaps) add("MISSING", g.question, `gap:${g.id}`);
  add("NEXT", future?.nextMove ?? exploration?.nextMove, future?.nextMove ? o.originRef! : `exploration:${exploration?.id}`);
  return {
    version: "need-v1", at: now.toISOString(), accountName: account.name, plantName: plant?.name ?? null,
    personName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
    explorationId: exploration?.id ?? null, explorationName: exploration?.name ?? null, origin: o.originRef ?? null, items,
  };
}

/** Impact sentence for the Journey's "not solving it costs", from the strongest impact item. */
export const impactSentence = (ctx: NeedContext) => ctx.items.find((x) => x.group === "IMPACT")?.text ?? null;

export type ConfirmNeed = {
  accountId: string; title: string; desiredResult: string | null; impactIfNot: string | null; neededBy: Date | null;
  nextMove: string | null; nextMoveDate: Date | null; contactId: string | null; plantId: string | null; explorationId: string | null;
  originRef: string | null; evidence: string | null; ownerId: string;
};

/** Human confirmation → Journey (LEAD) with inherited context, lineage links and the next movement as a To-do. */
export async function createNeedJourney(input: ConfirmNeed, by: { id: string; name: string }) {
  if (input.originRef && (await db.deal.count({ where: { originRef: input.originRef } }))) throw new Error("ALREADY");
  const ctx = await inheritedContext({ ...input });
  // The person's confirmed next move replaces the one Mercado proposed (the exploration's own move stays on the exploration).
  if (input.nextMove) ctx.items = [...ctx.items.filter((x) => x.group !== "NEXT"), { group: "NEXT", text: input.nextMove, source: `confirmed:${by.id}` }];
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const code = await nextCode("J", "deal", tx);
    const deal = await tx.deal.create({
      data: {
        code, title: input.title, accountId: input.accountId, ownerId: input.ownerId, stage: "LEAD", contactId: input.contactId,
        plantId: input.plantId, explorationId: input.explorationId, originRef: input.originRef, needContext: ctx as unknown as Prisma.InputJsonValue,
        desiredResult: input.desiredResult, impactIfNot: input.impactIfNot ?? impactSentence(ctx), neededBy: input.neededBy,
        nextMove: input.nextMove, nextMoveDate: input.nextMoveDate,
      },
    });
    if (input.originRef?.startsWith("future:")) await tx.futureOpportunity.update({ where: { id: input.originRef.slice(7) }, data: { status: "CONVERTED", dealId: deal.id } });
    if (input.explorationId) await tx.explorationLink.upsert({ where: { explorationId_kind_refId: { explorationId: input.explorationId, kind: "JOURNEY", refId: deal.id } }, create: { explorationId: input.explorationId, kind: "JOURNEY", refId: deal.id, label: `${code} ${input.title}`.slice(0, 200), why: "Necesidad confirmada desde Mercado" }, update: {} });
    await tx.activity.create({ data: { type: "NOTE", subject: "Necesidad confirmada desde Mercado", body: [input.evidence ? `Evidencia: ${input.evidence}` : null, `Contexto heredado: ${ctx.items.length} dato(s) con su fuente.`, ctx.explorationName ? `Exploración: ${ctx.explorationName}` : null].filter(Boolean).join("\n"), userId: by.id, accountId: input.accountId, contactId: input.contactId, dealId: deal.id, phase: "need", source: "Mercado" } });
    if (input.nextMove) await tx.task.create({ data: { title: input.nextMove.slice(0, 200), dueDate: input.nextMoveDate ?? addDays(today(), 2), assigneeId: input.ownerId, accountId: input.accountId, contactId: input.contactId, dealId: deal.id } });
    return deal;
  });
}
