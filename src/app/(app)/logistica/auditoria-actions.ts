"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEditOps, canEditMoney, isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { auditInvoice, type Rule } from "@/lib/freight-audit";

// Operaciones O7 · freight invoice audit, claims and the customs case of a shipment (module 11 §31–33).

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const day = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null; };
const num = (fd: FormData, k: string) => { const raw = String(fd.get(k) ?? "").trim().replace(",", "."); const n = Number(raw); return raw && Number.isFinite(n) && n >= 0 && n < 1e8 ? n : null; };
const back = (id: string, qs: string, hash = "auditoria"): never => { refreshApp(); redirect(`/logistica/${id}?${qs}#${hash}`); };
const carrierKey = (s: string) => { const u = s.toUpperCase(); return u.includes("DHL") ? "DHL" : u.includes("FEDEX") ? "FEDEX" : u.includes("UPS") ? "UPS" : u.trim(); };

/** The rule for a carrier (and service), falling back to the carrier's general rule and then to DEFAULT. */
async function ruleFor(carrier: string, service: string | null): Promise<Rule> {
  const key = carrierKey(carrier);
  const rows = await db.carrierRatingRule.findMany({ where: { carrier: { in: [key, "DEFAULT"] } } });
  const r = rows.find((x) => x.carrier === key && x.service === (service ?? "")) ?? rows.find((x) => x.carrier === key && x.service === "") ?? rows.find((x) => x.carrier === "DEFAULT");
  return r ? { carrier: r.carrier, divisor: r.divisor, roundingKg: Number(r.roundingKg), minChargeKg: r.minChargeKg != null ? Number(r.minChargeKg) : null, tolerancePct: Number(r.tolerancePct), toleranceUsd: Number(r.toleranceUsd), claimPct: Number(r.claimPct), confirmed: r.confirmed, version: r.version }
    : { carrier: "DEFAULT", divisor: 5000, roundingKg: 0.5, minChargeKg: null, tolerancePct: 3, toleranceUsd: 10, claimPct: 10, confirmed: false, version: 0 };
}

async function load(id: string) {
  const user = await requireUser();
  const s = await db.shipment.findUniqueOrThrow({ where: { id }, select: { id: true, carrierName: true, supplierPoId: true, dealId: true, deal: { select: { ownerId: true, accountId: true } }, carrierInvoices: { select: { id: true, number: true } } } });
  assertCanEditOps(user, s.deal.ownerId);
  return { user, s };
}

export async function recordCarrierInvoice(shipmentId: string, fd: FormData) {
  const { user, s } = await load(shipmentId);
  const carrier = txt(fd, "carrier", 80) ?? s.carrierName ?? "";
  const number = txt(fd, "number", 60);
  const amount = num(fd, "amount");
  const source = txt(fd, "source", 200);
  if (!carrier || !number || amount == null || amount <= 0 || !source) back(shipmentId, "err=fac-datos");
  if (await db.carrierInvoice.findUnique({ where: { carrier_number: { carrier, number: number! } }, select: { id: true } })) back(shipmentId, "err=fac-repetida");
  const service = txt(fd, "service", 80);
  const surcharges = [0, 1, 2].map((k) => ({ name: txt(fd, `sname_${k}`, 60) ?? "", amount: num(fd, `samt_${k}`) ?? 0 })).filter((x) => x.name && x.amount > 0);
  const [rule, fr, rec] = await Promise.all([
    ruleFor(carrier, service),
    s.supplierPoId ? db.freightRequirement.findUnique({ where: { supplierPoId: s.supplierPoId }, select: { grossKg: true, dims: true, packages: true, quotes: { where: { chosen: true }, select: { cost: true, currency: true } } } }) : null,
    s.supplierPoId ? db.goodsReceipt.findFirst({ where: { supplierPoId: s.supplierPoId, OR: [{ grossKg: { not: null } }, { dims: { not: null } }] }, orderBy: { receivedAt: "desc" }, select: { grossKg: true, dims: true, packages: true } }) : null,
  ]);
  const currency = (txt(fd, "currency", 3) ?? "USD").toUpperCase();
  const invoice = { amount: money2(amount!), currency, billedKg: num(fd, "billedKg"), billedPieces: num(fd, "billedPieces") != null ? Math.round(num(fd, "billedPieces")!) : null, surcharges };
  const audit = auditInvoice({
    quote: fr?.quotes[0] ? { cost: Number(fr.quotes[0].cost), currency: fr.quotes[0].currency } : null,
    stated: fr ? { kg: fr.grossKg != null ? Number(fr.grossKg) : null, dims: fr.dims, packages: fr.packages } : null,
    measured: rec ? { kg: rec.grossKg != null ? Number(rec.grossKg) : null, dims: rec.dims, packages: rec.packages } : null,
    invoice, duplicateOf: s.carrierInvoices[0]?.number ?? null,
  }, rule);
  await db.carrierInvoice.create({ data: { shipmentId, carrier, service, number: number!, invoiceDate: day(fd, "invoiceDate") ?? today(), currency, amount: invoice.amount, billedKg: invoice.billedKg, billedPieces: invoice.billedPieces, surcharges, source: source!, status: audit.status, audit: audit as unknown as Prisma.InputJsonValue, recordedByName: user.name } });
  back(shipmentId, "ok=fac");
}

export async function openClaim(invoiceId: string, fd: FormData) {
  const inv = await db.carrierInvoice.findUnique({ where: { id: invoiceId }, include: { claim: true } });
  if (!inv) redirect("/logistica");
  const { user } = await load(inv!.shipmentId);
  const disputed = num(fd, "disputedAmount");
  const evidence = txt(fd, "evidence", 400);
  const expectedCalc = txt(fd, "expectedCalc", 300);
  if (inv!.claim) back(inv!.shipmentId, "ok=reclamo");
  if (disputed == null || disputed <= 0 || disputed > Number(inv!.amount) || !evidence || !expectedCalc) back(inv!.shipmentId, "err=reclamo-datos");
  await db.$transaction([
    db.freightClaim.create({ data: { invoiceId, disputedAmount: money2(disputed!), expectedCalc: expectedCalc!, billedCalc: txt(fd, "billedCalc", 300) ?? `${inv!.currency} ${Number(inv!.amount).toFixed(2)}${inv!.billedKg != null ? ` · ${Number(inv!.billedKg)} kg cobrables` : ""}`, evidence: evidence!, claimDate: day(fd, "claimDate") ?? today(), openedByName: user.name } }),
    db.carrierInvoice.update({ where: { id: invoiceId }, data: { status: "CLAIM_OPEN" } }),
  ]);
  back(inv!.shipmentId, "ok=reclamo");
}

/** The carrier's answer. Money counts as recovered only with the credit note and the amount really received. */
export async function updateClaim(claimId: string, fd: FormData) {
  const c = await db.freightClaim.findUnique({ where: { id: claimId }, include: { invoice: { select: { id: true, shipmentId: true, carrier: true, number: true, currency: true, amount: true, shipment: { select: { supplierPoId: true, dealId: true, supplierPo: { select: { supplierId: true } }, deal: { select: { ownerId: true } } } } } } } });
  if (!c) redirect("/logistica");
  const user = await requireUser();
  const sh = c!.invoice.shipment;
  if (!canEditMoney(user, sh.deal.ownerId)) back(c!.invoice.shipmentId, "err=permiso");
  if (c!.status === "RECOVERED") back(c!.invoice.shipmentId, "ok=reclamo");
  const action = String(fd.get("action") ?? "");
  const response = txt(fd, "response", 400);
  if (action === "RECOVERED") {
    const amount = num(fd, "recoveredAmount");
    const creditNote = txt(fd, "creditNote", 120);
    // AC20: a verbal "yes" is not a recovery.
    if (amount == null || amount <= 0 || amount > Number(c!.disputedAmount) + 0.005 || !creditNote) back(c!.invoice.shipmentId, "err=reclamo-credito");
    await db.$transaction([
      db.freightClaim.update({ where: { id: claimId }, data: { status: "RECOVERED", recoveredAmount: money2(amount!), creditNote, recoveredAt: day(fd, "recoveredAt") ?? today(), response: response ?? c!.response, updatedByName: user.name } }),
      db.carrierInvoice.update({ where: { id: c!.invoice.id }, data: { status: "CREDIT_RECEIVED" } }),
      // A real recovery is a verifiable saving: it goes to the ledger with its evidence.
      db.savingsEntry.create({ data: { kind: "CLAIM_RECOVERY", dealId: sh.dealId, supplierPoId: sh.supplierPoId, supplierId: sh.supplierPo?.supplierId ?? null, baselineAmount: c!.invoice.amount, finalAmount: money2(Number(c!.invoice.amount) - amount!), savingsAmount: money2(amount!), currency: c!.invoice.currency, baselineSource: `Factura ${c!.invoice.carrier} ${c!.invoice.number}`, evidence: `Nota crédito ${creditNote}`, responsibleId: user.id, responsibleName: user.name, at: day(fd, "recoveredAt") ?? today() } }),
    ]);
  } else if (action === "ACCEPTED" || action === "REJECTED") {
    if (!response) back(c!.invoice.shipmentId, "err=reclamo-respuesta");
    await db.freightClaim.update({ where: { id: claimId }, data: { status: action, response, updatedByName: user.name } });
  } else back(c!.invoice.shipmentId, "err=reclamo-datos");
  back(c!.invoice.shipmentId, "ok=reclamo");
}

export async function saveCustomsCase(shipmentId: string, fd: FormData) {
  const { user } = await load(shipmentId);
  const cs = String(fd.get("classificationStatus") ?? "");
  const classification = txt(fd, "classification", 40);
  const classificationSource = txt(fd, "classificationSource", 200);
  // A classification is never recorded as currently validated without saying who validated it.
  if (classification && cs === "VALIDATED_CURRENT" && !classificationSource) back(shipmentId, "err=clasificacion", "aduana");
  const data = {
    broker: txt(fd, "broker", 120), consignee: txt(fd, "consignee", 160), declarationNo: txt(fd, "declarationNo", 60), classification, classificationStatus: !classification ? "PENDING" : cs === "VALIDATED_CURRENT" ? "VALIDATED_CURRENT" : "HISTORICAL", classificationSource,
    origin: txt(fd, "origin", 80), declaredValue: num(fd, "declaredValue"), hasTransportDoc: fd.get("hasTransportDoc") === "1", permits: txt(fd, "permits", 300), dutiesExpected: num(fd, "dutiesExpected"), dutiesActual: num(fd, "dutiesActual"), vatTreatment: txt(fd, "vatTreatment", 120),
    inspection: txt(fd, "inspection", 200), holdReason: txt(fd, "holdReason", 300), correctiveSteps: txt(fd, "correctiveSteps", 300), expectedDays: num(fd, "expectedDays") != null ? Math.round(num(fd, "expectedDays")!) : null, arrivedAt: day(fd, "arrivedAt"), releasedAt: day(fd, "releasedAt"), updatedByName: user.name,
  };
  await db.customsCase.upsert({ where: { shipmentId }, create: { shipmentId, ...data }, update: data });
  back(shipmentId, "ok=aduana", "aduana");
}

/** Carrier rating rule and tolerances. Gerencia only; each change raises the version used by later audits. */
export async function saveRatingRule(fd: FormData) {
  const user = await requireUser();
  const go = (qs: string): never => { refreshApp(); redirect(`/operaciones/transportadores?${qs}#reglas`); };
  if (!isGerencia(user)) go("err=permiso");
  const carrier = (txt(fd, "carrier", 40) ?? "").toUpperCase();
  const service = txt(fd, "service", 60) ?? "";
  const divisor = num(fd, "divisor"), rounding = num(fd, "roundingKg"), tol = num(fd, "tolerancePct"), tolUsd = num(fd, "toleranceUsd"), claim = num(fd, "claimPct");
  if (!carrier || divisor == null || divisor < 1000 || divisor > 10000 || rounding == null || rounding > 5 || tol == null || tolUsd == null || claim == null || claim < tol) go("err=regla");
  const data = { divisor: Math.round(divisor!), roundingKg: rounding!, minChargeKg: num(fd, "minChargeKg"), tolerancePct: tol!, toleranceUsd: tolUsd!, claimPct: claim!, confirmed: fd.get("confirmed") === "1", note: txt(fd, "note", 200), updatedByName: user.name };
  const cur = await db.carrierRatingRule.findUnique({ where: { carrier_service: { carrier, service } }, select: { version: true } });
  await db.carrierRatingRule.upsert({ where: { carrier_service: { carrier, service } }, create: { carrier, service, ...data }, update: { ...data, version: (cur?.version ?? 0) + 1 } });
  go("ok=regla");
}
