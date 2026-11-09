// Comercial C1 · Technical & Scope — database side.
import { db } from "./db";
import { completeness, findAmbiguities, fold, keyOf, REL_KINDS, type Line, type QuoteLine, type Source } from "./scope-rules";

/** The quote that speaks for the Journey right now: the open draft, otherwise the latest version. */
async function currentQuote(dealId: string) {
  const qs = await db.quote.findMany({ where: { dealId }, orderBy: [{ createdAt: "desc" }], include: { lines: { orderBy: { position: "asc" } } } });
  return qs.find((q) => q.status === "DRAFT") ?? qs.find((q) => q.status !== "SUPERSEDED") ?? qs[0] ?? null;
}

const sourcesOf = (d: { title: string; desiredResult: string | null; needSpecs: string | null }, q: { solution: string | null; lines: { description: string }[] } | null, lines: { component: string; note: string | null; source: string | null }[]): Source[] => [
  { where: "Journey", text: d.title },
  { where: "Resultado deseado", text: d.desiredResult },
  { where: "Especificaciones", text: d.needSpecs },
  ...(q ? [{ where: "Solución de la cotización", text: q.solution }, ...q.lines.map((l) => ({ where: "Línea de la cotización", text: l.description }))] : []),
  ...lines.map((l) => ({ where: `Alcance · ${l.component}`, text: [l.note, l.source].filter(Boolean).join(" · ") || null })),
];

const resolvedOf = (cs: { terms: string[] }[]) => [...new Set(cs.flatMap((c) => c.terms))];

/** Completeness for the quote's Ready to Present rail (same rules as the workspace). */
export async function scopeState(dealId: string, quoteLines: QuoteLine[] | null, quote?: { solution: string | null; lines: { description: string }[] } | null) {
  const [d, lines, confs] = await Promise.all([
    db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { title: true, desiredResult: true, needSpecs: true } }),
    db.scopeLine.findMany({ where: { dealId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.scopeConfirmation.findMany({ where: { dealId }, select: { terms: true } }),
  ]);
  const sources = sourcesOf(d, quote ?? null, lines);
  return completeness({ lines: lines as Line[], ambiguities: findAmbiguities(sources), resolvedTerms: resolvedOf(confs), quoteLines, sources });
}

export async function scopeWorkspace(dealId: string) {
  const [d, lines, confs, q] = await Promise.all([
    db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { account: { select: { id: true, name: true } }, contact: { select: { firstName: true, lastName: true } }, owner: { select: { name: true } } } }),
    db.scopeLine.findMany({ where: { dealId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { facts: { orderBy: { createdAt: "desc" } }, confirmation: { select: { confirmedBy: true, confirmedAt: true } } } }),
    db.scopeConfirmation.findMany({ where: { dealId }, orderBy: { confirmedAt: "desc" } }),
    currentQuote(dealId),
  ]);
  const sources = sourcesOf(d, q, lines);
  const ambiguities = findAmbiguities(sources);
  const resolvedTerms = resolvedOf(confs);
  const quoteLines: QuoteLine[] | null = q ? q.lines.map((l) => ({ code: l.code, description: l.description })) : null;
  const state = completeness({ lines: lines as Line[], ambiguities, resolvedTerms, quoteLines, sources });

  // Evidenced relationships touching the components in the matrix → suggestions, never automatic additions.
  const keys = [...new Set(lines.flatMap((l) => [l.code ? keyOf(l.code) : null, keyOf(l.component)]).filter(Boolean) as string[])];
  const rels = keys.length ? await db.productRelationship.findMany({ where: { supersededAt: null, OR: [{ fromKey: { in: keys } }, { toKey: { in: keys } }] }, orderBy: { createdAt: "desc" } }) : [];
  const inMatrix = (k: string) => lines.some((l) => (l.code && keyOf(l.code) === k) || keyOf(l.component) === k || fold(l.component) === fold(k));
  const suggestions = rels
    .filter((r) => ["REQUIRES", "DRIVES", "MATES_WITH", "ASSEMBLED_WITH", "SOLD_AS_ASSEMBLY", "PART_OF"].includes(r.kind))
    .map((r) => (keys.includes(r.fromKey) ? { rel: r, other: { key: r.toKey, label: r.toLabel } } : { rel: r, other: { key: r.fromKey, label: r.fromLabel } }))
    .filter((s) => !inMatrix(s.other.key))
    .filter((s, n, all) => all.findIndex((x) => x.other.key === s.other.key) === n); // one suggestion per component

  return { d, lines, confs, q, quoteLines, sources, ambiguities, resolvedTerms, state, rels, suggestions, relKinds: REL_KINDS };
}
export type ScopeWorkspace = Awaited<ReturnType<typeof scopeWorkspace>>;
