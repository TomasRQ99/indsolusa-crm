import { db } from "./db";
import { today } from "./domain";
import { leadTimeText, saleOf, validUntil } from "./quote";
import { VALUE_SEED, briefingQuestions, claimState, looksCommittee, presentationAdvice, readRoutes } from "./proposal-rules";

// Comercial C5 · read model for the Solution Case, Value Bridge and the customer-facing proposal. Nothing here writes,
// except the one-time catalog seed (8 draft attributes, decision C-14).

export async function ensureValueCatalog() {
  if ((await db.valueAttribute.count()) > 0) return;
  await db.valueAttribute.createMany({ data: VALUE_SEED.map((v) => ({ ...v, status: "DRAFT", updatedByName: "SOLU (borrador inicial del spec)" })), skipDuplicates: true });
}

const SCOPE_DIFF = new Set(["EXCLUDED", "OPTIONAL", "CUSTOMER_SUPPLIED", "TO_CONFIRM"]);

export async function solutionWorkspace(dealId: string) {
  await ensureValueCatalog();
  const d = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: {
      id: true, code: true, title: true, ownerId: true, accountId: true, desiredResult: true, needSpecs: true, neededBy: true, successMeasure: true, impactIfNot: true,
      account: { select: { id: true, name: true } },
      contact: { select: { firstName: true, lastName: true } },
      scopeLines: { orderBy: { position: "asc" }, select: { id: true, component: true, status: true, requiredForFunction: true, code: true, qty: true } },
      quotes: { orderBy: [{ createdAt: "desc" }], select: { id: true, number: true, rev: true, status: true, lang: true, solution: true, decisionLabel: true, decisionPath: true, presentedAt: true, lines: { select: { code: true, qty: true, unitPrice: true } }, scenarios: { select: { id: true } } } },
      solutionCase: { include: { claims: { orderBy: { createdAt: "asc" }, include: { attribute: true } }, presentations: { orderBy: { at: "desc" }, include: { quote: { select: { number: true, rev: true } } } } } },
      supplyOptions: { select: { supplier: { select: { name: true } } } },
      supplierPos: { select: { supplier: { select: { name: true } } } },
      supplyBases: { where: { supersededAt: null }, take: 1, select: { reason: true, primary: { select: { label: true, leadDaysMin: true, leadDaysMax: true, warranty: true, incoterm: true } } } },
    },
  });
  const attributes = await db.valueAttribute.findMany({ orderBy: { createdAt: "asc" } });
  const now = today();
  const c = d.solutionCase;
  const routes = readRoutes(c?.routes);
  const latest = d.quotes.find((q) => q.status !== "SUPERSEDED") ?? d.quotes[0] ?? null;
  const sale = latest ? saleOf(latest.lines) : 0;
  // Repeat purchase: another Journey of this customer already accepted a quote with all these codes.
  const codes = [...new Set((latest?.lines ?? []).map((l) => l.code?.trim().toLowerCase()).filter((x): x is string => !!x))];
  const repeat = codes.length > 0 && (await db.quote.count({ where: { status: "ACCEPTED", deal: { accountId: d.accountId, id: { not: d.id } }, AND: codes.map((code) => ({ lines: { some: { code: { equals: code, mode: "insensitive" as const } } } })) } })) > 0;
  const scopeDiff = d.scopeLines.filter((l) => SCOPE_DIFF.has(l.status));
  const alternatives = Math.max(routes.length, latest?.scenarios.length ?? 0);
  const committee = looksCommittee(!!c?.committee, latest?.decisionLabel, latest?.decisionPath);
  const advice = presentationAdvice({ saleUsd: sale, scopeDiffs: scopeDiff.length, alternatives, committee, impactWritten: !!d.impactIfNot, repeatPurchase: repeat });
  const questions = briefingQuestions({
    decisionPathKnown: !!latest?.decisionPath, committee, alternatives,
    toConfirm: d.scopeLines.filter((l) => l.status === "TO_CONFIRM").map((l) => l.component),
    customerSupplied: d.scopeLines.filter((l) => l.status === "CUSTOMER_SUPPLIED").map((l) => l.component),
    neededByKnown: !!d.neededBy, successKnown: !!d.successMeasure,
  });
  const privateNames = supplierNamesOf(d);
  const names = (...s: (string | null)[]) => privateNames.filter((n) => s.some((x) => x?.toLowerCase().includes(n.toLowerCase())));
  const claims = (c?.claims ?? []).map((x) => ({ ...x, state: claimState(x, x.attribute.status, now), namesSupplier: names(x.need, x.impact, x.advantage, x.benefit, x.evidence) }));
  return { privateNames, d, c, routes, latest, sale, repeat, scopeDiff, alternatives, committee, advice, questions, claims, attributes, basis: d.supplyBases[0] ?? null, now };
}
export type SolutionWorkspace = Awaited<ReturnType<typeof solutionWorkspace>>;

/** Everything a customer may see in a Solution Proposal (§18). Built field by field from customer-safe data:
 *  no supplier names, no costs, no Eságara, no internal scoring (AC11); claims only with evidence (AC12). */
export async function proposalData(quoteId: string) {
  const q = await db.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true, number: true, rev: true, status: true, lang: true, issuedAt: true, presentedAt: true, validityDays: true, solution: true, promiseText: true, promiseCondition: true,
      leadMinDays: true, leadMaxDays: true, incoterm: true, paymentTerms: true, condition: true,
      lines: { orderBy: { position: "asc" }, select: { qty: true, code: true, description: true, unitPrice: true } },
      scenarios: { orderBy: { position: "asc" }, select: { label: true, price: true, leadMinDays: true, leadMaxDays: true, promise: true, recommended: true, why: true } },
      deal: { select: { id: true, title: true, desiredResult: true, needSpecs: true, impactIfNot: true, neededBy: true, successMeasure: true, owner: { select: { name: true, email: true } }, account: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } },
        scopeLines: { orderBy: { position: "asc" }, select: { component: true, code: true, qty: true, status: true } },
        supplyOptions: { select: { supplier: { select: { name: true } } } },
        supplierPos: { select: { supplier: { select: { name: true } } } },
        solutionCase: { select: { understood: true, routes: true, decisionNeeded: true, claims: { where: { hidden: false }, orderBy: { createdAt: "asc" }, select: { need: true, impact: true, advantage: true, benefit: true, evidence: true, evidenceAt: true, validUntil: true, hidden: true, audience: true, attribute: { select: { nameEs: true, nameEn: true, status: true } } } } } } } },
    },
  });
  if (!q) return null;
  const now = today();
  const d = q.deal;
  const sc = d.solutionCase;
  const claims = (sc?.claims ?? []).filter((c) => claimState(c, c.attribute.status, now).inProposal).map((c) => ({ attrEs: c.attribute.nameEs, attrEn: c.attribute.nameEn, need: c.need, impact: c.impact, advantage: c.advantage, benefit: c.benefit, evidence: c.evidence!, evidenceAt: c.evidenceAt, audience: c.audience }));
  const by = (s: string) => d.scopeLines.filter((l) => l.status === s).map((l) => ({ component: l.component, code: l.code, qty: l.qty }));
  return {
    number: q.number, rev: q.rev, draft: q.status === "DRAFT", lang: q.lang, date: q.presentedAt ?? q.issuedAt ?? now, validUntil: validUntil(q),
    customer: d.account.name, contact: d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : null, title: d.title, owner: d.owner.name, ownerEmail: d.owner.email,
    understood: sc?.understood ?? d.needSpecs ?? null, desiredResult: d.desiredResult, impactIfNot: d.impactIfNot, neededBy: d.neededBy, successMeasure: d.successMeasure,
    solution: q.solution,
    scope: { included: by("INCLUDED"), excluded: by("EXCLUDED"), customer: by("CUSTOMER_SUPPLIED"), optional: by("OPTIONAL"), toConfirm: by("TO_CONFIRM") },
    alternatives: q.scenarios.map((s) => ({ label: s.label, price: Number(s.price), lead: `${s.leadMinDays}–${s.leadMaxDays}`, promise: s.promise, recommended: s.recommended, why: s.why })),
    routes: readRoutes(sc?.routes),
    claims,
    leadText: leadTimeText({ leadMinDays: q.leadMinDays, leadMaxDays: q.leadMaxDays, lang: q.lang }, q.presentedAt ?? now), promise: q.promiseText, promiseCondition: q.promiseCondition,
    lines: q.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) })), total: saleOf(q.lines),
    incoterm: q.incoterm, paymentTerms: q.paymentTerms, condition: q.condition,
    decisionNeeded: sc?.decisionNeeded ?? null,
    /** Never rendered: supplier names of this Journey, so the route can refuse a proposal that names them. */
    privateNames: supplierNamesOf(d),
  };
}
export type ProposalData = NonNullable<Awaited<ReturnType<typeof proposalData>>>;

/** Supplier names (without the demo tag) a customer document must not reveal. Short or generic names are skipped. */
export function supplierNamesOf(d: { supplyOptions: { supplier: { name: string } }[]; supplierPos: { supplier: { name: string } }[] }) {
  const names = [...d.supplyOptions, ...d.supplierPos].map((x) => x.supplier.name.replace(/\s*\(ejemplo\)\s*$/i, "").trim()).filter((x) => x.length >= 4);
  return [...new Set(names)];
}
