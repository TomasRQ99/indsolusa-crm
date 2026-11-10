import { db } from "./db";
import { today } from "./domain";
import { partKey } from "./parts";
import { categoryIn } from "./part-lexicon";
import { looksColombianNit, maybeHazmat, passportOf, passportLearning, rfqAsks, scopeEquivalence, comparablePrices, freshnessOf, type AskContext, type Obs } from "./supply-rules";

// Comercial C4 · read model for sourcing & supply. Nothing here writes.

const n = (v: unknown) => (v == null ? null : Number(v));

export const obsSelect = { id: true, status: true, observedAt: true, grossKg: true, netKg: true, lengthCm: true, widthCm: true, heightCm: true, packages: true, origin: true, hsSupplier: true, qtyContext: true, packaging: true, dealId: true, source: true, recordedByName: true, supplier: { select: { name: true } } } as const;

export const toObs = (o: { id: string; status: string; observedAt: Date; grossKg: unknown; netKg: unknown; lengthCm: unknown; widthCm: unknown; heightCm: unknown; packages: number | null; origin: string | null; hsSupplier: string | null; qtyContext: number | null; packaging: string | null; dealId: string | null; source: string }): Obs => ({
  id: o.id, status: o.status, observedAt: o.observedAt, grossKg: n(o.grossKg), netKg: n(o.netKg), lengthCm: n(o.lengthCm), widthCm: n(o.widthCm), heightCm: n(o.heightCm),
  packages: o.packages, origin: o.origin, hsSupplier: o.hsSupplier, qtyContext: o.qtyContext, packaging: o.packaging, dealId: o.dealId, source: o.source,
});

export type FieldEvidence = Record<string, { src: string; at: string }>;
/** When the supplier last confirmed price or stock (from per-field evidence); the record's creation otherwise. */
export function confirmedAtOf(o: { evidence: unknown; createdAt: Date }) {
  const ev = (o.evidence ?? {}) as FieldEvidence;
  const ds = ["price", "stockQty", "leadDaysMin"].map((k) => ev[k]?.at).filter(Boolean).map((x) => new Date(x!)).filter((x) => !Number.isNaN(x.getTime()));
  return ds.length ? new Date(Math.max(...ds.map((x) => x.getTime()))) : o.createdAt;
}

/** Logistics passport + import precedents of one part (part page and Journey). */
export async function partLogistics(partId: string) {
  const [obs, imports] = await Promise.all([
    db.logisticsObservation.findMany({ where: { partId }, orderBy: { observedAt: "desc" }, select: obsSelect }),
    db.importExperience.findMany({ where: { partId }, orderBy: { importedAt: "desc" } }),
  ]);
  const o = obs.map(toObs);
  return { obs, passport: passportOf(o, today()), learning: passportLearning(o), imports };
}

/** §7 context for the RFQ form: import or not (and why), assembly, urgency, and what we already know. */
export async function rfqAskContext(partIds: string[], dealId: string | null, urgent: boolean) {
  const [deal, parts, obs, imports] = await Promise.all([
    dealId ? db.deal.findUnique({ where: { id: dealId }, select: { account: { select: { name: true, taxId: true } }, scopeLines: { select: { id: true, family: true } }, title: true, needSpecs: true } }) : null,
    db.part.findMany({ where: { id: { in: partIds } }, select: { id: true, mpn: true, name: true, category: true } }),
    partIds.length ? db.logisticsObservation.findMany({ where: { partId: { in: partIds } }, select: { ...obsSelect, partId: true } }) : [],
    partIds.length ? db.importExperience.findMany({ where: { partId: { in: partIds }, hsCode: { not: null } }, orderBy: { importedAt: "desc" }, select: { partId: true, hsCode: true, importedAt: true } }) : [],
  ]);
  const now = today();
  let importsToColombia: boolean | null = null;
  let importWhy: AskContext["importWhy"];
  if (deal && looksColombianNit(deal.account.taxId)) { importsToColombia = true; importWhy = { es: `el cliente (${deal.account.name}) tiene NIT colombiano`, en: `the customer (${deal.account.name}) has a Colombian NIT` }; }
  else if (deal && deal.account.taxId) importsToColombia = false;
  // "Known" only when every part has a fresh value; one part without data means we still ask.
  const per = parts.map((p) => passportOf(obs.filter((o) => o.partId === p.id).map(toObs), now));
  const allFresh = (k: "grossKg" | "origin" | "hsSupplier") => per.length > 0 && per.every((x) => x[k] && !x[k]!.stale);
  const known: AskContext["known"] = {};
  if (allFresh("grossKg") && per.every((x) => x.dims)) known.PACKAGES = { es: parts.map((p, k) => `${p.mpn} ${per[k].grossKg!.value} kg (${per[k].grossKg!.status === "RECEIPT_MEASURED" ? "medido" : "reportado"} ${per[k].grossKg!.at.toISOString().slice(0, 10)})`).join("; "), en: parts.map((p, k) => `${p.mpn} ${per[k].grossKg!.value} kg (${per[k].grossKg!.status === "RECEIPT_MEASURED" ? "measured" : "reported"} ${per[k].grossKg!.at.toISOString().slice(0, 10)})`).join("; ") };
  if (allFresh("origin")) known.ORIGIN = { es: per.map((x) => x.origin!.value).join(", "), en: per.map((x) => x.origin!.value).join(", ") };
  const hsAll = parts.every((p) => imports.some((m) => m.partId === p.id));
  if (hsAll && parts.length) { const s = parts.map((p) => { const m = imports.find((x) => x.partId === p.id)!; return `${p.mpn} ${m.hsCode} (${m.importedAt.toISOString().slice(0, 10)})`; }).join("; "); known.HS = { es: `subpartida usada antes: ${s} — precedente, no vigente por sí sola`, en: `subheading used before: ${s} — a precedent, not current by itself` }; }
  const text = [deal?.title, deal?.needSpecs, ...parts.map((p) => p.name)].filter(Boolean).join(" ");
  const ctx: AskContext = {
    importsToColombia, importWhy,
    assembly: (deal?.scopeLines.length ?? 0) > 1 || /\b(completo|complete|kit|conjunto|assembly|motorreductor|gearmotor)\b/i.test(text),
    urgent,
    known,
    maybeHazmat: parts.some((p) => maybeHazmat(p.name, p.category ?? categoryIn(p.name) ?? null)),
  };
  return { ctx, asks: rfqAsks(ctx) };
}

/** Everything the Journey's sourcing page needs. */
export async function supplyWorkspace(dealId: string) {
  const d = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: {
      id: true, code: true, title: true, ownerId: true, desiredResult: true, neededBy: true,
      account: { select: { id: true, name: true, taxId: true } },
      items: { select: { code: true, description: true, qty: true } },
      scopeLines: { orderBy: { position: "asc" }, select: { id: true, component: true, status: true, requiredForFunction: true, code: true } },
      quotes: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, number: true, rev: true, lines: { select: { code: true } } } },
    },
  });
  const [options, bases, searches, rfqs] = await Promise.all([
    db.supplyOption.findMany({ where: { dealId }, orderBy: { createdAt: "asc" }, include: { supplier: { select: { id: true, name: true, country: true } }, paymentOptions: { orderBy: { createdAt: "asc" } }, offer: { select: { id: true, docId: true } } } }),
    db.supplyBasis.findMany({ where: { dealId }, orderBy: { createdAt: "desc" }, include: { primary: { select: { id: true, label: true, supplier: { select: { name: true } } } }, backup: { select: { id: true, label: true, supplier: { select: { name: true } } } }, paymentOption: true } }),
    db.sourcingSearch.findMany({ where: { dealId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.rfq.findMany({ where: { dealId }, orderBy: { createdAt: "desc" }, select: { id: true, code: true, createdAt: true, asked: true, recipients: { select: { id: true, status: true, repliedAt: true, supplier: { select: { id: true, name: true } } } } } }),
  ]);
  // Parts of this Journey (catalog matches of its item codes) → offers not yet used, passports, precedents.
  // Part numbers from the Journey's items, its scope lines and its latest quote.
  const codes = [...d.items.map((x) => x.code), ...d.scopeLines.map((x) => x.code), ...(d.quotes[0]?.lines.map((x) => x.code) ?? [])].filter((x): x is string => !!x && x.trim().length > 1);
  const keys = [...new Set(codes.map((c) => partKey(c)))].filter(Boolean);
  const parts = keys.length ? await db.part.findMany({ where: { mpnKey: { in: keys }, mergedIntoId: null }, select: { id: true, mpn: true, name: true, brand: true } }) : [];
  const partIds = parts.map((p) => p.id);
  const [offers, obs, imports] = await Promise.all([
    partIds.length ? db.supplierOffer.findMany({ where: { partId: { in: partIds } }, orderBy: { createdAt: "desc" }, take: 40, include: { supplier: { select: { id: true, name: true } }, part: { select: { mpn: true } } } }) : [],
    partIds.length ? db.logisticsObservation.findMany({ where: { partId: { in: partIds } }, orderBy: { observedAt: "desc" }, select: { ...obsSelect, partId: true } }) : [],
    partIds.length ? db.importExperience.findMany({ where: { partId: { in: partIds } }, orderBy: { importedAt: "desc" } }) : [],
  ]);
  const now = today();
  const used = new Set(options.map((o) => o.offerId).filter(Boolean));
  const passports = parts.map((p) => { const o = obs.filter((x) => x.partId === p.id).map(toObs); return { part: p, passport: passportOf(o, now), learning: passportLearning(o), count: o.length }; });

  // Scope the solution needs from suppliers: required to operate and not excluded / customer-supplied.
  const needs = d.scopeLines.filter((l) => l.requiredForFunction && l.status !== "EXCLUDED" && l.status !== "CUSTOMER_SUPPLIED").map((l) => ({ id: l.id, component: l.component }));
  const live = options.filter((o) => o.status === "CANDIDATE");
  const scopes = live.map((o) => ({ id: o.id, covers: o.covers, price: n(o.price), currency: o.currency }));
  const eq = scopeEquivalence(needs, scopes);
  const lowest = comparablePrices(scopes, eq);
  const current = bases.find((b) => !b.supersededAt) ?? null;
  // Freshness counts from the date the supplier gave the price/stock (its evidence), never from the last edit.
  const freshFor = (o: (typeof options)[number]) => freshnessOf({ validUntil: o.validUntil, confirmedAt: confirmedAtOf(o) }, now);
  return { d, options, live, needs, eq, lowest, current, history: bases.filter((b) => b.supersededAt), searches, rfqs, parts, offers: offers.filter((o) => !used.has(o.id)), passports, imports, freshFor };
}
export type SupplyWorkspace = Awaited<ReturnType<typeof supplyWorkspace>>;
