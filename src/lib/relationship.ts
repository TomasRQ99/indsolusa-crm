import { db } from "./db";
import { addDays, daysBetween, today } from "./domain";
import { compose, checkMessage, ifNoReply, PURPOSES, type Ctx, type Fact, type Lang, type Purpose } from "./comm-policy";
import { suggestQuestions } from "./market-rules";
import { invoiceFacts, promiseFacts, toPayInvoice } from "./pay-rules";

// Mercado M5 · Relationship Intelligence (§11.4, §13.5) and Prepare Connection (§11.6, §13.12).
// Everything here is read from what SOLU already knows; nothing is retyped and nothing is invented.

export const NOTE_KINDS: Record<string, { es: string; en: string; hint: string }> = {
  DECISION_ROLE: { es: "Su papel real en las decisiones", en: "Their real role in decisions", hint: "Ej.: detecta la necesidad y define la especificación; Compras emite la orden" },
  VALUES: { es: "Lo que ha dicho que valora", en: "What they've said they value", hint: "Ej.: que le avisen antes si un plazo cambia" },
  OBJECTIVE: { es: "Objetivo de su área", en: "Their area's objective", hint: "Ej.: bajar las paradas no programadas de la línea UHT" },
  PROBLEM: { es: "Problema que nos contó", en: "Problem they told us about", hint: "Ej.: los sellos de la bomba duran menos de lo esperado" },
  TOPIC: { es: "Tema de negocio que le interesa", en: "Business topic they care about", hint: "Ej.: eficiencia energética en la planta" },
  PREFERENCE: { es: "Cómo prefiere que lo contactemos", en: "How they prefer to be contacted", hint: "Ej.: WhatsApp en la mañana; correo para cotizaciones" },
};

export type Loop = { key: string; side: "OURS" | "THEIRS"; what: string; dueAt: Date | null; origin: string; href: string | null; explicitId?: string };

const BILLING_ROLE = /tesor|cartera|cuentas por pagar|pagos|contab|financ|treasur|payable|accounting/i;

export async function personRelationship(contactId: string) {
  const now = today();
  const c = await db.contact.findUnique({
    where: { id: contactId },
    include: {
      account: { select: { id: true, name: true, billingContact: true, paymentTermsDays: true } },
      employments: { where: { endedOn: null }, include: { plant: { select: { name: true } } } },
      personNotes: { orderBy: [{ supersededAt: "asc" }, { observedAt: "desc" }] },
      openLoops: { where: { status: "OPEN" }, orderBy: { dueAt: "asc" } },
      tasks: { where: { status: "OPEN" }, orderBy: { dueDate: "asc" }, select: { id: true, title: true, dueDate: true } },
      activities: { orderBy: { occurredAt: "desc" }, take: 12, select: { id: true, type: true, subject: true, occurredAt: true, source: true, user: { select: { name: true } } } },
      threads: { orderBy: { lastAt: "desc" }, take: 6, select: { id: true, channel: true, subject: true, lastAt: true, lastInAt: true, lastOutAt: true } },
      deals: {
        orderBy: { createdAt: "desc" }, take: 12,
        select: {
          id: true, code: true, title: true, stage: true, desiredResult: true, resultState: true, actualResult: true, waitingFor: true, waitingUntil: true, closedAt: true, createdAt: true,
          recoveries: { where: { resolvedAt: null }, select: { id: true, whatChanged: true, impact: true, options: true, openedAt: true } },
          invoices: { select: { id: true, number: true, amount: true, issuedAt: true, dueAt: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } }, promises: { select: { promisedFor: true, createdAt: true }, orderBy: { createdAt: "asc" } } } },
        },
      },
      prepared: { orderBy: { generatedAt: "desc" }, take: 8 },
    },
  });
  if (!c) return null;
  const accountId = c.accountId;
  const [insights, gaps, signals, futures, plantsN, assetsN, impactsN, people, accountInvoices] = accountId ? await Promise.all([
    db.accountInsight.findMany({ where: { accountId, supersededAt: null }, orderBy: { observedAt: "desc" } }),
    db.knowledgeGap.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: 40 }),
    db.marketSignal.findMany({ where: { accountId, status: { not: "DISMISSED" }, observedAt: { gte: addDays(now, -90) } }, orderBy: { observedAt: "desc" }, take: 6 }),
    db.futureOpportunity.findMany({ where: { accountId, status: "OPEN" }, orderBy: { expectedAt: "asc" }, take: 6 }),
    db.plant.count({ where: { accountId } }),
    db.installedAsset.count({ where: { plant: { accountId } } }),
    db.impactProfile.count({ where: { plant: { accountId } } }),
    db.contact.count({ where: { accountId } }),
    db.invoice.findMany({ where: { accountId }, select: { id: true, number: true, amount: true, issuedAt: true, dueAt: true, deal: { select: { contactId: true } }, applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } }, promises: { select: { promisedFor: true, createdAt: true }, orderBy: { createdAt: "asc" } } } }),
  ]) : [[], [], [], [], 0, 0, 0, 0, []];

  // Open loops: explicit ones + what other modules already hold (read, never copied).
  const loops: Loop[] = [
    ...c.openLoops.map((l) => ({ key: `loop:${l.id}`, side: l.side as Loop["side"], what: l.what, dueAt: l.dueAt, origin: "Compromiso anotado", href: null, explicitId: l.id })),
    ...c.tasks.map((x) => ({ key: `task:${x.id}`, side: "OURS" as const, what: x.title, dueAt: x.dueDate, origin: "Pendiente", href: "/tasks" })),
    // Journey "waiting for" is free text that can be internal (e.g. our Treasury), so it isn't read as this person's commitment.
    ...c.deals.flatMap((d) => d.recoveries.map((r) => ({ key: `recovery:${r.id}`, side: "OURS" as const, what: `Resolver: ${r.whatChanged}`, dueAt: null, origin: `Recovery · ${d.code ?? ""}`.trim(), href: `/deals/${d.id}?tab=result` }))),
  ];
  // Their payment promises still pending on invoices of this person's Journeys.
  for (const d of c.deals) for (const inv of d.invoices) {
    const f = invoiceFacts(toPayInvoice(inv), now);
    const p = inv.promises[inv.promises.length - 1];
    if (f.open > 0 && p) loops.push({ key: `promise:${inv.id}`, side: "THEIRS", what: `Pago de la factura ${inv.number}`, dueAt: p.promisedFor, origin: "Promesa de pago", href: `/deals/${d.id}/facturacion#inv-${inv.id}` });
  }
  loops.sort((a, b) => +(a.dueAt ?? addDays(now, 9999)) - +(b.dueAt ?? addDays(now, 9999)));

  const hasHistory = c.activities.length > 0 || c.threads.length > 0 || c.deals.length > 0;
  const lastTouch = [c.activities[0]?.occurredAt, c.threads[0]?.lastAt].filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null;
  const notes = c.personNotes.filter((n) => !n.supersededAt);
  const role = c.employments[0]?.role ?? c.title ?? null;
  const decisionRole = notes.filter((n) => n.kind === "DECISION_ROLE");
  const known = { blocks: new Set(insights.map((x) => x.block)), assets: assetsN, impacts: impactsN, futures: futures.length, people };
  const questions = suggestQuestions(known, new Set(gaps.map((g) => g.question)), 3);

  // Overdue invoices for this person to validate (only if it's their Journey or they handle payments).
  const handlesPayments = BILLING_ROLE.test(`${c.title ?? ""} ${role ?? ""}`) || (!!c.email && !!c.account?.billingContact && c.account.billingContact.toLowerCase().includes(c.email.toLowerCase()));
  const overdue = accountInvoices
    .filter((inv) => handlesPayments || inv.deal.contactId === c.id)
    .map((inv) => ({ inv, f: invoiceFacts(toPayInvoice(inv), now), pr: promiseFacts([toPayInvoice(inv)], now) }))
    .filter((x) => x.f.open > 0 && x.f.pendingReconcile < x.f.open && (x.f.overdueDays > 0 || (x.inv.promises.length > 0 && x.inv.promises[x.inv.promises.length - 1].promisedFor < now)))
    .sort((a, b) => b.f.overdueDays - a.f.overdueDays);

  return { c, now, loops, hasHistory, lastTouch, notes, oldNotes: c.personNotes.filter((n) => n.supersededAt), role, decisionRole, insights, gaps, signals, futures, questions, overdue, handlesPayments };
}
export type Relationship = NonNullable<Awaited<ReturnType<typeof personRelationship>>>;

export type Reason = { purpose: Purpose; fact: Fact; weight: number };

/** Legitimate reasons to contact now (§11.6). No reason → no outreach "just because of the calendar". */
export function reasonsOf(r: Relationship): Reason[] {
  const out: Reason[] = [];
  const now = r.now;
  for (const d of r.c.deals) for (const rec of d.recoveries) out.push({ purpose: "RECOVERY", weight: 100, fact: { id: `recovery:${rec.id}`, kind: "FACT", text: { es: `Hay una recuperación abierta en ${d.code ?? d.title}: ${rec.whatChanged}.`, en: `There's an open recovery on ${d.code ?? d.title}: ${rec.whatChanged}.` } } });
  for (const o of r.overdue.slice(0, 1)) out.push({ purpose: "COLLECTION", weight: 80, fact: { id: `invoice:${o.inv.id}`, kind: "FACT", text: { es: `La factura ${o.inv.number} ${o.f.overdueDays > 0 ? `venció hace ${o.f.overdueDays} días` : "tenía fecha de pago prometida"} y no vemos el pago conciliado.`, en: `Invoice ${o.inv.number} ${o.f.overdueDays > 0 ? `has been due for ${o.f.overdueDays} days` : "had a promised payment date"} and we don't see reconciled payment.` } } });
  for (const l of r.loops) {
    if (l.side === "OURS" && l.dueAt && daysBetween(now, l.dueAt) <= 3) out.push({ purpose: "FOLLOW_UP", weight: 70, fact: { id: l.key, kind: "FACT", text: { es: `Tenemos un compromiso con esta persona${daysBetween(now, l.dueAt) < 0 ? " que ya pasó su fecha" : " para los próximos días"}: ${l.what}.`, en: `We have a commitment to this person${daysBetween(now, l.dueAt) < 0 ? " that's past its date" : " due in the next few days"}: ${l.what}.` } } });
    if (l.side === "THEIRS" && l.dueAt && l.dueAt < now && !l.key.startsWith("promise:")) out.push({ purpose: "FOLLOW_UP", weight: 60, fact: { id: l.key, kind: "FACT", text: { es: `Esperábamos de su lado: ${l.what} (para el ${l.dueAt.toISOString().slice(0, 10)}).`, en: `We were expecting from them: ${l.what} (by ${l.dueAt.toISOString().slice(0, 10)}).` } } });
  }
  for (const s of r.signals.filter((x) => x.status === "NEW").slice(0, 2)) out.push({ purpose: "RECONNECT", weight: 50, fact: { id: `signal:${s.id}`, kind: s.confidence === "INFERRED" ? "INFERENCE" : "FACT", text: { es: `Vi esta noticia: ${trimEnd(s.what)}.`, en: `I saw this news: ${trimEnd(s.what)}.` } } });
  for (const f of r.futures.filter((x) => x.expectedAt && daysBetween(now, x.expectedAt) <= 120 && daysBetween(now, x.expectedAt) >= -7).slice(0, 1)) out.push({ purpose: "RECONNECT", weight: 45, fact: { id: `future:${f.id}`, kind: "FACT", text: { es: `Se acerca un tema que tenemos anotado: ${lower(f.description)} (hacia el ${dayEs(f.expectedAt!)}).`, en: `Something we have noted is coming up: ${lower(f.description)} (around ${dayEn(f.expectedAt!)}).` } } });
  if (r.gaps.some((g) => g.status === "OPEN") || r.questions.length) out.push({ purpose: "EXPLORE", weight: 20, fact: { id: `gaps:${r.c.accountId ?? r.c.id}`, kind: "FACT", text: { es: "Todavía hay cosas importantes que no sabemos de cómo trabajan.", en: "There are still important things we don't know about how they work." } } });
  return out.sort((a, b) => b.weight - a.weight);
}
const trimEnd = (s: string) => s.replace(/[.\s]+$/, "");
const dayEs = (d: Date) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: "UTC" }).format(d);
const dayEn = (d: Date) => new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", timeZone: "UTC" }).format(d);
const lower = (s: string) =>(s && !/^[A-ZÁÉÍÓÚÑ]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s).replace(/[.\s]+$/, "");

/** Suggested channel: the one that has worked with this person, else what we have on file. */
export function channelOf(r: Relationship, purpose: Purpose): string {
  const out = r.c.threads.find((x) => x.lastInAt);
  if (purpose === "RECOVERY" && r.c.phone) return "CALL";
  if (out) return out.channel === "WHATSAPP" ? "WHATSAPP" : out.channel === "EMAIL" ? "EMAIL" : "CALL";
  if (r.c.email) return "EMAIL";
  if (r.c.phone) return "WHATSAPP";
  return "INTRO";
}

/** The Connection Readiness Brief (§11.6) with its draft through the communication policy. */
export function connectionBrief(r: Relationship, o: { purpose?: string | null; lang: Lang; senderName: string; ownFault?: boolean }) {
  const reasons = reasonsOf(r);
  const chosen = (o.purpose && o.purpose in PURPOSES ? reasons.find((x) => x.purpose === o.purpose) : null) ?? reasons[0] ?? null;
  const purposes = [...new Set(reasons.map((x) => x.purpose))];
  if (!chosen) return { reasons, purposes, chosen: null, draft: null, checks: [], channel: channelOf(r, "EXPLORE"), noReply: null };
  const valueNote = r.notes.find((n) => n.kind === "VALUES" || n.kind === "OBJECTIVE");
  const ctx: Ctx = {
    lang: o.lang, purpose: chosen.purpose, recipientFirstName: r.c.firstName || null, senderName: o.senderName, hasHistory: r.hasHistory,
    reason: chosen.purpose === "EXPLORE" ? undefined : chosen.fact,
    theirInterest: valueNote ? { id: `note:${valueNote.id}`, kind: "FACT", text: { es: valueNote.statement, en: valueNote.statement } } : undefined,
    question: r.questions[0] ? { es: r.questions[0].es, en: r.questions[0].en } : undefined,
  };
  if (chosen.purpose === "FOLLOW_UP") {
    const l = r.loops.find((x) => x.key === chosen.fact.id)!;
    ctx.loop = { side: l.side, what: l.what, dueAt: l.dueAt };
    ctx.reason = undefined;
  }
  if (chosen.purpose === "COLLECTION") {
    const ov = r.overdue[0];
    const proms = ov.inv.promises;
    ctx.invoice = { number: ov.inv.number, dueAt: ov.inv.dueAt, promisedFor: proms.length ? proms[proms.length - 1].promisedFor : null, brokenPromises: ov.pr.broken };
    ctx.reason = undefined;
  }
  if (chosen.purpose === "RECOVERY") {
    const rec = r.c.deals.flatMap((d) => d.recoveries).find((x) => `recovery:${x.id}` === chosen.fact.id)!;
    ctx.recovery = { whatChanged: rec.whatChanged, impact: rec.impact, ourFault: !!o.ownFault, options: ((rec.options as { title?: string }[] | null) ?? []).map((x) => x.title ?? "").filter(Boolean) };
    ctx.reason = undefined;
  }
  const draft = compose(ctx);
  draft.meta.sourceContextIds = [...new Set([chosen.fact.id, ...draft.meta.sourceContextIds, ...(r.questions[0] ? [`playbook:${r.questions[0].key}`] : [])])];
  if (!draft.meta.factsUsed.some((f) => f.id === chosen.fact.id)) (chosen.fact.kind === "FACT" ? draft.meta.factsUsed : draft.meta.inferencesUsed).push({ id: chosen.fact.id, text: chosen.fact.text.es });
  return { reasons, purposes, chosen, draft, ctx, checks: checkMessage(draft.text, ctx), channel: channelOf(r, chosen.purpose), noReply: ifNoReply(chosen.purpose) };
}
