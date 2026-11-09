// Mercado (Módulo 09) — read models for the Home ("Explorar") and the exploration workspace.
// Everything shown keeps its source and certainty; nothing here scores or ranks people or companies.
import { db } from "./db";
import { horizonOf, type Horizon } from "./market-rules";

const DAY = 864e5;
const strip = (n: string) => n.replace(/\s*\(ejemplo\)\s*$/, "");

/** What SOLU already knows about a company from our own history (facts only). */
async function historyOf(accountIds: string[]) {
  if (!accountIds.length) return new Map<string, { deals: number; won: number; lastDealAt: Date | null; contacts: { id: string; name: string; title: string | null }[] }>();
  const [deals, contacts] = await Promise.all([
    db.deal.findMany({ where: { accountId: { in: accountIds } }, select: { accountId: true, stage: true, createdAt: true } }),
    db.contact.findMany({ where: { accountId: { in: accountIds } }, select: { id: true, firstName: true, lastName: true, title: true, accountId: true }, orderBy: { updatedAt: "desc" } }),
  ]);
  const out = new Map<string, { deals: number; won: number; lastDealAt: Date | null; contacts: { id: string; name: string; title: string | null }[] }>();
  for (const id of accountIds) out.set(id, { deals: 0, won: 0, lastDealAt: null, contacts: [] });
  for (const d of deals) {
    const h = out.get(d.accountId)!;
    h.deals++; if (d.stage === "WON") h.won++;
    if (!h.lastDealAt || d.createdAt > h.lastDealAt) h.lastDealAt = d.createdAt;
  }
  for (const c of contacts) if (c.accountId) out.get(c.accountId)?.contacts.push({ id: c.id, name: strip(`${c.firstName} ${c.lastName}`), title: c.title });
  return out;
}

/** Suggested first move for a signal: always a conversation to understand, never "create an opportunity". */
function suggestMove(account: string | null, contact: { name: string; title: string | null } | undefined) {
  if (contact) return { es: `Conversar con ${contact.name}${contact.title ? ` (${contact.title})` : ""} para entender qué significa este cambio para su operación.`, en: `Talk with ${contact.name}${contact.title ? ` (${contact.title})` : ""} to understand what this change means for their operation.` };
  if (account) return { es: `Encontrar quién en ${strip(account)} lleva este cambio y pedir una conversación corta.`, en: `Find who at ${strip(account)} owns this change and ask for a short conversation.` };
  return { es: "Identificar qué empresas toca este cambio antes de buscar a alguien.", en: "Identify which companies this change touches before reaching out." };
}

export async function marketHome(now = new Date()) {
  const since = new Date(now.getTime() - 14 * DAY);
  const [signals, explorations, whites, futures, recentSignals, recentAnswers, recentPlants, recentFutures, accounts] = await Promise.all([
    db.marketSignal.findMany({ where: { status: "NEW" }, orderBy: { observedAt: "desc" }, take: 12, include: { account: { select: { id: true, name: true } }, plant: { select: { name: true, city: true } } } }),
    db.exploration.findMany({
      where: { lifecycle: { not: "CLOSED" } }, orderBy: [{ updatedAt: "desc" }], take: 30,
      include: { owner: { select: { name: true } }, _count: { select: { links: true, signals: true, futures: true } }, gaps: { where: { status: "OPEN" }, select: { id: true } } },
    }),
    db.whiteSpace.findMany({ where: { status: { in: ["OPEN", "EXPLORING"] } }, orderBy: { createdAt: "desc" }, take: 12, include: { account: { select: { id: true, name: true } }, exploration: { select: { id: true, name: true } } } }),
    db.futureOpportunity.findMany({ where: { status: "OPEN" }, orderBy: [{ expectedAt: "asc" }], take: 40, include: { account: { select: { id: true, name: true } }, plant: { select: { name: true } }, exploration: { select: { id: true, name: true } } } }),
    db.marketSignal.findMany({ where: { createdAt: { gte: since } }, select: { id: true, what: true, createdAt: true, capturedByName: true, account: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.knowledgeGap.findMany({ where: { resolvedAt: { gte: since }, status: "RESOLVED" }, select: { id: true, question: true, answer: true, resolvedAt: true, resolvedByName: true, explorationId: true }, orderBy: { resolvedAt: "desc" }, take: 10 }),
    db.plant.findMany({ where: { createdAt: { gte: since } }, select: { id: true, name: true, createdAt: true, capturedByName: true, account: { select: { name: true } } }, take: 10 }),
    db.futureOpportunity.findMany({ where: { createdAt: { gte: since } }, select: { id: true, description: true, createdAt: true, capturedByName: true, explorationId: true }, take: 10 }),
    db.account.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Signal cards: what changed · why it matters · what we know · what we don't · suggested move · source.
  const accIds = [...new Set(signals.map((s) => s.accountId).filter((x): x is string => !!x))];
  const [hist, openGaps] = await Promise.all([
    historyOf(accIds),
    accIds.length ? db.knowledgeGap.findMany({ where: { accountId: { in: accIds }, status: "OPEN" }, select: { accountId: true, question: true } }) : Promise.resolve([]),
  ]);
  const cards = signals.map((s) => {
    const h = s.accountId ? hist.get(s.accountId) : undefined;
    return {
      ...s,
      ageDays: Math.max(0, Math.floor((now.getTime() - s.observedAt.getTime()) / DAY)),
      history: h ?? null,
      unknowns: openGaps.filter((g) => g.accountId === s.accountId).map((g) => g.question),
      suggested: suggestMove(s.account?.name ?? null, h?.contacts[0]),
    };
  });

  // What changed (last 14 days), newest first. Facts with who captured them; no counts per person.
  type Change = { at: Date; es: string; en: string; by: string; href?: string };
  const changes: Change[] = [
    ...recentSignals.map((s) => ({ at: s.createdAt, es: `Señal: ${s.what}${s.account ? ` (${strip(s.account.name)})` : ""}`, en: `Signal: ${s.what}${s.account ? ` (${strip(s.account.name)})` : ""}`, by: s.capturedByName })),
    ...recentAnswers.map((g) => ({ at: g.resolvedAt!, es: `Aprendimos: ${g.answer ?? g.question}`, en: `We learned: ${g.answer ?? g.question}`, by: g.resolvedByName ?? "", href: g.explorationId ? `/mercado/exploraciones/${g.explorationId}` : undefined })),
    ...recentPlants.map((p) => ({ at: p.createdAt, es: `Planta registrada: ${p.name} (${strip(p.account.name)})`, en: `Plant recorded: ${p.name} (${strip(p.account.name)})`, by: p.capturedByName })),
    ...recentFutures.map((f) => ({ at: f.createdAt, es: `Oportunidad futura: ${f.description}`, en: `Future opportunity: ${f.description}`, by: f.capturedByName, href: f.explorationId ? `/mercado/exploraciones/${f.explorationId}` : undefined })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 12);

  // Relationships that can grow: companies with open white space or open questions (not a ranking).
  const grow = new Map<string, { id: string; name: string; whites: string[] }>();
  for (const w of whites) if (w.account) { const g = grow.get(w.account.id) ?? { id: w.account.id, name: w.account.name, whites: [] }; g.whites.push(w.what); grow.set(w.account.id, g); }

  const byHorizon: Record<Horizon, typeof futures> = { H30: [], H90: [], H365: [], LATER: [], UNKNOWN: [] };
  for (const f of futures) byHorizon[horizonOf(f.expectedAt, now)].push(f);

  return { cards, explorations, whites, changes, grow: [...grow.values()], byHorizon, futuresCount: futures.length, accounts };
}

export async function explorationWorkspace(id: string) {
  const e = await db.exploration.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      links: { orderBy: { kind: "asc" } },
      signals: { orderBy: { observedAt: "desc" }, include: { account: { select: { name: true } } } },
      gaps: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
      whiteSpaces: { orderBy: { createdAt: "desc" }, include: { account: { select: { id: true, name: true } } } },
      futures: { orderBy: { expectedAt: "asc" }, include: { account: { select: { name: true } }, plant: { select: { name: true } } } },
      tasks: { where: { status: "OPEN" }, select: { id: true, title: true, dueDate: true } },
    },
  });
  if (!e) return null;
  const accountIds = e.links.filter((l) => l.kind === "ACCOUNT").map((l) => l.refId);
  const [hist, plants, accounts, origin] = await Promise.all([
    historyOf(accountIds),
    accountIds.length ? db.plant.findMany({ where: { accountId: { in: accountIds } }, orderBy: { name: "asc" }, include: { account: { select: { name: true } } } }) : Promise.resolve([]),
    db.account.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    e.createdFromSignalId ? db.marketSignal.findUnique({ where: { id: e.createdFromSignalId }, select: { what: true, observedAt: true, sourceType: true, sourceRef: true } }) : Promise.resolve(null),
  ]);
  // "También proveedor": a supplier with the same NIT is the same organization (decision: keep separate, link by NIT).
  const linked = accountIds.length ? await db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, taxId: true, industry: true } }) : [];
  const nits = linked.map((a) => nitKey(a.taxId)).filter(Boolean) as string[];
  const suppliers = nits.length ? (await db.supplier.findMany({ where: { taxId: { not: null } }, select: { id: true, name: true, taxId: true } })).filter((s) => nits.includes(nitKey(s.taxId) ?? "")) : [];
  const companies = linked.map((a) => ({ ...a, history: hist.get(a.id)!, plants: plants.filter((p) => p.accountId === a.id), alsoSupplier: suppliers.find((s) => nitKey(s.taxId) === nitKey(a.taxId)) ?? null }));
  return { e, companies, accounts, origin };
}

/** NIT comparison key: digits only, first 9 (drops the check digit). Same rule as accounts. */
export function nitKey(v: string | null | undefined) {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 6 ? d.slice(0, 9) : null;
}
