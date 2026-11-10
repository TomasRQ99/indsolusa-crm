"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { scopeEquivalence } from "@/lib/supply-rules";
import type { FieldEvidence } from "@/lib/supply";

// Comercial C4 · Sourcing & Supply commands. Sourcing is edited by the Journey owner, an Operations Negotiator
// or management (same rule as Technical & Scope). Nothing here buys, pays or promises.

const page = (dealId: string) => `/deals/${dealId}/abastecimiento`;
const go = (dealId: string, qs: string, hash = ""): never => { refreshApp(); redirect(`${page(dealId)}?${qs}${hash ? `#${hash}` : ""}`); };
const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const num = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? "").trim().replace(/\s/g, "").replace(",", "."); if (!s) return null; const v = Number(s); return Number.isFinite(v) && v >= 0 ? v : null; };
const int = (fd: FormData, k: string) => { const v = num(fd, k); return v == null ? null : Math.round(v); };
const dayOf = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null; };

async function guard(dealId: string): Promise<{ user: SessionUser; deal: { id: string; ownerId: string; accountId: string } }> {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { id: true, ownerId: true, accountId: true } });
  if (!canEditOps(user, deal.ownerId)) go(dealId, "err=permiso");
  return { user, deal };
}
const log = (userId: string, deal: { id: string; accountId: string }, subject: string) =>
  db.activity.create({ data: { type: "NOTE", subject: subject.slice(0, 200), userId, accountId: deal.accountId, dealId: deal.id, phase: "source", source: "Abastecimiento" } });

// Fields of a supplier answer. Each value keeps where it came from and when (evidence per field, §12).
const FIELDS = ["price", "qty", "stockQty", "leadDaysMin", "leadDaysMax", "leadTrigger", "validUntil", "condition", "warranty", "incoterm", "pickup", "origin", "hsSupplier", "grossKg", "dims", "packages", "includedNote", "excludedNote"] as const;
type F = (typeof FIELDS)[number];

function readOption(fd: FormData) {
  const v: Record<F, unknown> = {
    price: num(fd, "price"), qty: int(fd, "qty"), stockQty: int(fd, "stockQty"), leadDaysMin: int(fd, "leadDaysMin"), leadDaysMax: int(fd, "leadDaysMax"),
    leadTrigger: txt(fd, "leadTrigger", 120), validUntil: dayOf(fd, "validUntil"), condition: txt(fd, "condition", 60), warranty: txt(fd, "warranty", 120),
    incoterm: txt(fd, "incoterm", 20), pickup: txt(fd, "pickup", 160), origin: txt(fd, "origin", 60), hsSupplier: txt(fd, "hsSupplier", 20),
    grossKg: num(fd, "grossKg"), dims: txt(fd, "dims", 80), packages: int(fd, "packages"), includedNote: txt(fd, "includedNote", 600), excludedNote: txt(fd, "excludedNote", 600),
  };
  if (v.price != null) v.price = money2(v.price as number);
  return v;
}
const same = (a: unknown, b: unknown) => (a == null && b == null) || (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : String(a ?? "") === String(b ?? "") || (a != null && b != null && Number(a) === Number(b) && !Number.isNaN(Number(a))));

/** Logistics data a supplier reported becomes an observation in the product's passport (never overwrites history). */
async function passportFromOption(partId: string | null, o: { supplierId: string; dealId: string; grossKg: unknown; dims: string | null; packages: number | null; origin: string | null; hsSupplier: string | null; qty: number | null }, src: string, at: Date, by: string) {
  if (!partId || (o.grossKg == null && !o.dims && o.packages == null && !o.origin && !o.hsSupplier)) return;
  const m = o.dims?.match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i);
  const d = (k: number) => (m ? Number(m[k].replace(",", ".")) : null);
  await db.logisticsObservation.create({ data: { partId, supplierId: o.supplierId, dealId: o.dealId, qtyContext: o.qty, grossKg: o.grossKg == null ? null : Number(o.grossKg), lengthCm: d(1), widthCm: d(2), heightCm: d(3), packages: o.packages, origin: o.origin, hsSupplier: o.hsSupplier, status: "SUPPLIER_REPORTED", source: src.slice(0, 200), observedAt: at, recordedByName: by } });
}

export async function addOption(dealId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const supplierId = txt(fd, "supplierId", 40);
  const label = txt(fd, "label", 200);
  const src = txt(fd, "source", 200);
  if (!supplierId || !label) go(dealId, "err=opcion", "opciones");
  if (!src) go(dealId, "err=fuente", "opciones");
  const at = dayOf(fd, "answeredAt") ?? today();
  if (at > today()) go(dealId, "err=fecha", "opciones");
  const v = readOption(fd);
  const evidence: FieldEvidence = {};
  for (const k of FIELDS) if (v[k] != null) evidence[k] = { src: src!, at: at.toISOString() };
  const covers = fd.getAll("covers").map(String).filter(Boolean);
  if (covers.length) evidence.covers = { src: src!, at: at.toISOString() };
  const o = await db.supplyOption.create({
    data: {
      dealId, supplierId: supplierId!, label: label!, covers, currency: (txt(fd, "currency", 3) ?? "USD").toUpperCase(),
      availability: ["QUOTE", "VERIFIED_AVAILABILITY", "HISTORICAL"].includes(String(fd.get("availability"))) ? String(fd.get("availability")) : "QUOTE",
      rfqId: txt(fd, "rfqId", 40), recordedByName: user.name, evidence, ...(v as object),
    } as never,
  });
  await passportFromOption(txt(fd, "partId", 40), { supplierId: o.supplierId, dealId, grossKg: o.grossKg, dims: o.dims, packages: o.packages, origin: o.origin, hsSupplier: o.hsSupplier, qty: o.qty }, src!, at, user.name);
  await log(user.id, deal, `Opción de suministro: ${label} (${(await db.supplier.findUnique({ where: { id: supplierId! }, select: { name: true } }))?.name ?? ""})`);
  go(dealId, "ok=opcion", `o-${o.id}`);
}

/** A registered supplier quote/proforma line becomes a candidate, with the document as evidence. */
export async function optionFromOffer(dealId: string, offerId: string) {
  const { user, deal } = await guard(dealId);
  const of = await db.supplierOffer.findUniqueOrThrow({ where: { id: offerId }, include: { doc: { select: { reference: true, kind: true, issuedAt: true, paymentTerms: true } }, part: { select: { id: true, mpn: true, name: true } } } });
  const exists = await db.supplyOption.findFirst({ where: { dealId, offerId }, select: { id: true } });
  if (exists) go(dealId, "ok=opcion", `o-${exists.id}`);
  const src = of.doc ? `${of.doc.kind === "PROFORMA" ? "Proforma" : "Cotización"} ${of.doc.reference ?? ""} del proveedor`.replace(/\s+/g, " ").trim() : `Oferta registrada (${of.source ?? of.recordedByName})`;
  const at = (of.doc?.issuedAt ?? of.createdAt).toISOString();
  const ev: FieldEvidence = { price: { src, at } };
  if (of.qty != null) ev.qty = { src, at };
  if (of.leadDaysMin != null) ev.leadDaysMin = { src, at };
  if (of.validUntil) ev.validUntil = { src, at };
  if (of.incoterm) ev.incoterm = { src, at };
  if (of.condition) ev.condition = { src, at };
  const o = await db.supplyOption.create({
    data: {
      dealId, supplierId: of.supplierId, offerId: of.id, label: `${of.codeAsQuoted}${of.description ? ` · ${of.description}` : ""}`.slice(0, 200),
      currency: of.currency, price: of.qty ? money2(Number(of.unitPrice) * of.qty) : money2(Number(of.unitPrice)), qty: of.qty, leadDaysMin: of.leadDaysMin, leadDaysMax: of.leadDaysMax, leadTrigger: of.leadText,
      validUntil: of.validUntil, incoterm: of.incoterm, condition: of.condition, availability: "QUOTE", evidence: ev, recordedByName: user.name,
    },
  });
  await log(user.id, deal, `Opción de suministro desde oferta: ${of.codeAsQuoted}`);
  go(dealId, "ok=opcion", `o-${o.id}`);
}

/** Edit a candidate. Only the fields that changed get the new evidence; the others keep theirs. */
export async function updateOption(optionId: string, fd: FormData) {
  const o = await db.supplyOption.findUniqueOrThrow({ where: { id: optionId } });
  const { user } = await guard(o.dealId);
  const src = txt(fd, "source", 200);
  const at = dayOf(fd, "answeredAt") ?? today();
  if (at > today()) go(o.dealId, "err=fecha", `o-${o.id}`);
  const v = readOption(fd);
  const covers = fd.getAll("covers").map(String).filter(Boolean);
  const ev = { ...((o.evidence ?? {}) as FieldEvidence) };
  const changed = FIELDS.filter((k) => !same(v[k], (o as Record<string, unknown>)[k]));
  const coversChanged = covers.sort().join(",") !== [...o.covers].sort().join(",");
  if ((changed.length || coversChanged) && !src) go(o.dealId, "err=fuente", `o-${o.id}`);
  for (const k of changed) { if (v[k] == null) delete ev[k]; else ev[k] = { src: src!, at: at.toISOString() }; }
  if (coversChanged) ev.covers = { src: src!, at: at.toISOString() };
  await db.supplyOption.update({ where: { id: optionId }, data: { ...(v as object), covers, label: txt(fd, "label", 200) ?? o.label, evidence: ev, importFeasibility: ["CONFIRMED", "CONDITIONAL", "NEEDS_REVIEW", "BLOCKED"].includes(String(fd.get("importFeasibility"))) ? String(fd.get("importFeasibility")) : o.importFeasibility, importNote: txt(fd, "importNote", 400), availability: ["QUOTE", "VERIFIED_AVAILABILITY", "HISTORICAL"].includes(String(fd.get("availability"))) ? String(fd.get("availability")) : o.availability } as never });
  if (changed.some((k) => ["grossKg", "dims", "packages", "origin", "hsSupplier"].includes(k))) await passportFromOption(txt(fd, "partId", 40), { supplierId: o.supplierId, dealId: o.dealId, grossKg: v.grossKg, dims: v.dims as string | null, packages: v.packages as number | null, origin: v.origin as string | null, hsSupplier: v.hsSupplier as string | null, qty: v.qty as number | null }, src ?? "Edición", at, user.name);
  go(o.dealId, "ok=editada", `o-${o.id}`);
}

export async function discardOption(optionId: string, fd: FormData) {
  const o = await db.supplyOption.findUniqueOrThrow({ where: { id: optionId } });
  const { user, deal } = await guard(o.dealId);
  const reason = txt(fd, "reason", 300);
  if (!reason) go(o.dealId, "err=motivo", `o-${o.id}`);
  const inBasis = await db.supplyBasis.findFirst({ where: { dealId: o.dealId, supersededAt: null, OR: [{ primaryId: o.id }, { backupId: o.id }] }, select: { id: true } });
  if (inBasis) go(o.dealId, "err=en-base", `o-${o.id}`);
  await db.supplyOption.update({ where: { id: optionId }, data: { status: "DISCARDED", discardReason: reason } });
  await log(user.id, deal, `Opción descartada: ${o.label} — ${reason}`);
  go(o.dealId, "ok=descartada", "opciones");
}

export async function restoreOption(optionId: string) {
  const o = await db.supplyOption.findUniqueOrThrow({ where: { id: optionId } });
  await guard(o.dealId);
  await db.supplyOption.update({ where: { id: optionId }, data: { status: "CANDIDATE", discardReason: null } });
  go(o.dealId, "ok=editada", `o-${o.id}`);
}

/** §9: a way to pay this supplier. Blank = unknown (never zero). "Confirmed" = the supplier said so. */
export async function addPaymentOption(optionId: string, fd: FormData) {
  const o = await db.supplyOption.findUniqueOrThrow({ where: { id: optionId } });
  await guard(o.dealId);
  const method = ["WIRE", "ACH", "CARD", "OTHER"].includes(String(fd.get("method"))) ? String(fd.get("method")) : null;
  if (!method) go(o.dealId, "err=pago", `o-${o.id}`);
  const pct = (k: string) => { const v = num(fd, k); return v == null ? null : Math.min(100, v); };
  await db.supplierPaymentOption.create({ data: { optionId, method: method!, surchargePct: pct("surchargePct"), fixedFee: num(fd, "fixedFee"), fxSpreadPct: pct("fxSpreadPct"), daysToRelease: int(fd, "daysToRelease"), releaseTrigger: txt(fd, "releaseTrigger", 160), confirmed: fd.get("confirmed") === "1", source: txt(fd, "source", 200), note: txt(fd, "note", 300) } });
  go(o.dealId, "ok=pago", `o-${o.id}`);
}

export async function removePaymentOption(id: string) {
  const p = await db.supplierPaymentOption.findUniqueOrThrow({ where: { id }, include: { option: { select: { dealId: true, id: true } } } });
  await guard(p.option.dealId);
  const used = await db.supplyBasis.findFirst({ where: { paymentOptionId: id, supersededAt: null }, select: { id: true } });
  if (used) go(p.option.dealId, "err=pago-en-base", `o-${p.option.id}`);
  await db.supplierPaymentOption.delete({ where: { id } });
  go(p.option.dealId, "ok=pago", `o-${p.option.id}`);
}

/** §12: the documented selection. Versioned (the previous one stays as history). It never creates a Supplier PO. */
export async function selectBasis(dealId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const primaryId = txt(fd, "primaryId", 40);
  const backupId = txt(fd, "backupId", 40);
  const paymentOptionId = txt(fd, "paymentOptionId", 40);
  const reason = txt(fd, "reason", 600);
  if (!primaryId || !reason) go(dealId, "err=base", "base");
  if (backupId && backupId === primaryId) go(dealId, "err=respaldo", "base");
  const [opts, lines] = await Promise.all([
    db.supplyOption.findMany({ where: { dealId, id: { in: [primaryId!, ...(backupId ? [backupId] : [])] }, status: "CANDIDATE" }, include: { supplier: { select: { name: true } }, paymentOptions: { select: { id: true } } } }),
    db.scopeLine.findMany({ where: { dealId }, select: { id: true, component: true, status: true, requiredForFunction: true } }),
  ]);
  const primary = opts.find((o) => o.id === primaryId);
  if (!primary || (backupId && !opts.some((o) => o.id === backupId))) go(dealId, "err=base", "base");
  if (paymentOptionId && !primary!.paymentOptions.some((p) => p.id === paymentOptionId)) go(dealId, "err=pago-base", "base");
  // §13: a primary that doesn't cover the needed scope can't back the promise unless someone says how the rest is covered.
  const needs = lines.filter((l) => l.requiredForFunction && l.status !== "EXCLUDED" && l.status !== "CUSTOMER_SUPPLIED").map((l) => ({ id: l.id, component: l.component }));
  const eq = scopeEquivalence(needs, [{ id: primary!.id, covers: primary!.covers, price: null, currency: primary!.currency }]);
  const missing = eq.known ? eq.byId.get(primary!.id)!.missing : [];
  const gapCover = txt(fd, "gapCover", 400);
  if (missing.length && !gapCover) go(dealId, `err=incompleta&n=${encodeURIComponent(missing.map((m) => m.component).join(", "))}`, "base");
  const risks = [txt(fd, "risks", 600), missing.length ? `Falta en la opción principal: ${missing.map((m) => m.component).join(", ")} — se cubre: ${gapCover}` : null].filter(Boolean).join("\n") || null;
  const backup = opts.find((o) => o.id === backupId);
  await db.$transaction(async (tx) => {
    await tx.supplyBasis.updateMany({ where: { dealId, supersededAt: null }, data: { supersededAt: new Date() } });
    await tx.supplyBasis.create({ data: { dealId, primaryId: primary!.id, backupId: backup?.id ?? null, paymentOptionId, reason: reason!, risks, selectedByName: user.name } });
    // The draft quote's supply text follows the documented basis (presented quotes are frozen and never touched).
    const draft = await tx.quote.findFirst({ where: { dealId, status: "DRAFT" }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (draft) await tx.quote.update({ where: { id: draft.id }, data: { supplyPrimary: `${primary!.supplier.name}: ${primary!.label}`.slice(0, 300), supplyAlt: backup ? `${backup.supplier.name}: ${backup.label}`.slice(0, 300) : null, supplierValidUntil: primary!.validUntil ?? undefined } });
  });
  await log(user.id, deal, `Base de suministro: ${primary!.supplier.name} — ${primary!.label}${backup ? ` (respaldo ${backup.supplier.name})` : ""}`);
  go(dealId, "ok=base", "base");
}

// ---------- §6 saved search (from Localizar repuestos, with a Journey in context) ----------

export async function saveSearch(dealId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const query = txt(fd, "q", 200);
  if (!query) go(dealId, "err=busqueda", "busquedas");
  let hits: { partId: string; mpn: string; brand: string | null; score: number }[] = [];
  try { hits = (JSON.parse(String(fd.get("hits") ?? "[]")) as typeof hits).filter((h) => h && typeof h.partId === "string").slice(0, 25); } catch { hits = []; }
  const candidates: unknown[] = []; const discarded: unknown[] = [];
  for (const h of hits) {
    const d = String(fd.get(`d_${h.partId}`) ?? "");
    const reason = txt(fd, `r_${h.partId}`, 200);
    if (d === "C") candidates.push({ partId: h.partId, mpn: h.mpn, brand: h.brand, score: h.score });
    else if (d === "D") { if (!reason) { refreshApp(); redirect(`/localizar?q=${encodeURIComponent(query!)}&deal=${dealId}&err=motivo`); } discarded.push({ partId: h.partId, mpn: h.mpn, reason }); }
  }
  const sources = fd.getAll("sources").map(String).filter((s) => /^[A-Z_]{2,20}$/.test(s)).slice(0, 10);
  await db.sourcingSearch.create({ data: { dealId, query: query!, sources, candidates: candidates as never, discarded: discarded as never, note: txt(fd, "note", 400), recordedByName: user.name } });
  await log(user.id, deal, `Búsqueda guardada: «${query}» · ${candidates.length} candidata(s), ${discarded.length} descartada(s)`);
  go(dealId, "ok=busqueda", "busquedas");
}
