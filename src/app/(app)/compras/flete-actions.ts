"use server";

import { redirect } from "next/navigation";
import { EXTRA_CHARGES, freightBreakdown, type Breakdown } from "@/lib/freight-rules";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { getOpsPolicy } from "@/lib/ops-home";
import { CLEARANCE_DAYS, LAST_MILE_DAYS, isDomestic } from "@/lib/purchasing";
import { WEIGHT_SOURCES, choiceNeedsReason, readQuotes } from "@/lib/freight-rules";

// Operaciones O5a · freight requirement and options for a Supplier PO (module 11 §25–28).

const back = (id: string, qs: string): never => { refreshApp(); redirect(`/compras/${id}?${qs}#flete`); };
const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const day = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null; };
const num = (fd: FormData, k: string) => { const raw = String(fd.get(k) ?? "").trim().replace(",", "."); const n = Number(raw); return raw && Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null; };
const tri = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return v === "yes" ? true : v === "no" ? false : null; };

async function load(spoId: string) {
  const user = await requireUser();
  const spo = await db.supplierPO.findUniqueOrThrow({ where: { id: spoId }, select: { id: true, deal: { select: { ownerId: true, promisedDate: true } }, supplier: { select: { country: true } }, freight: { include: { quotes: true } } } });
  assertCanEditOps(user, spo.deal.ownerId);
  return { user, spo };
}

export async function saveFreight(spoId: string, fd: FormData) {
  const { user, spo } = await load(spoId);
  const src = String(fd.get("weightSource") ?? "");
  const grossKg = num(fd, "grossKg");
  const changedWeight = spo.freight && Number(spo.freight.grossKg ?? -1) !== (grossKg ?? -1);
  const reconfirmNote = txt(fd, "reconfirmNote", 200);
  const data = {
    origin: txt(fd, "origin", 80), pickupAddress: txt(fd, "pickupAddress"), pickupContact: txt(fd, "pickupContact", 160), pickupHours: txt(fd, "pickupHours", 120), destination: txt(fd, "destination"),
    readyDate: day(fd, "readyDate"), packages: num(fd, "packages") != null ? Math.round(num(fd, "packages")!) : null, netKg: num(fd, "netKg"), grossKg, dims: txt(fd, "dims", 160), packagingType: txt(fd, "packagingType", 80),
    stackable: tri(fd, "stackable"), fragile: tri(fd, "fragile"), hazardous: tri(fd, "hazardous"), temperature: txt(fd, "temperature", 80), incoterm: txt(fd, "incoterm", 40),
    hasInvoice: fd.get("hasInvoice") === "1", hasPackingList: fd.get("hasPackingList") === "1", exportNote: txt(fd, "exportNote", 200), handling: txt(fd, "handling", 200), insurance: txt(fd, "insurance", 120), urgent: fd.get("urgent") === "1",
    weightSource: WEIGHT_SOURCES[src] ? src : "SUPPLIER_STATED", updatedByName: user.name,
    // A reconfirmation is a dated fact with its note; a changed weight without one clears the earlier reconfirmation.
    ...(reconfirmNote ? { reconfirmedAt: new Date(), reconfirmNote } : changedWeight ? { reconfirmedAt: null, reconfirmNote: null } : {}),
  };
  await db.freightRequirement.upsert({ where: { supplierPoId: spoId }, create: { supplierPoId: spoId, ...data }, update: data });
  back(spoId, "ok=flete");
}

export async function addFreightQuote(spoId: string, fd: FormData) {
  const { user, spo } = await load(spoId);
  if (!spo.freight) back(spoId, "err=flete-primero");
  const carrier = txt(fd, "carrier", 120);
  const typed = num(fd, "cost");
  const source = txt(fd, "source", 200);
  const bd = freightBreakdown({ tariff: num(fd, "b_tariff"), discountPct: num(fd, "b_discountPct"), pieceSurcharge: num(fd, "b_piece"), fuel: num(fd, "b_fuel"), insurance: num(fd, "b_insurance"), extras: Object.keys(EXTRA_CHARGES).map((k) => ({ key: k, amount: num(fd, `b_x_${k}`) })) });
  if (bd === "BAD") back(spoId, "err=flete-desglose");
  const b = bd as Breakdown | null;
  // With a breakdown SOLU does the sum. A total typed as well must agree with it: SOLU never picks one silently.
  if (b && typed != null && typed > 0 && Math.abs(typed - b.total) > 0.01) back(spoId, "err=flete-total");
  const cost = b ? b.total : typed;
  if (!carrier || cost == null || cost <= 0 || !source) back(spoId, "err=flete-opcion");
  const transit = num(fd, "transitDays");
  await db.freightQuote.create({ data: {
    requirementId: spo.freight!.id, carrier: carrier!, service: txt(fd, "service", 120), mode: txt(fd, "mode", 20), cost: money2(cost!), currency: (txt(fd, "currency", 3) ?? "USD").toUpperCase(),
    transitDays: transit != null ? Math.round(transit) : null, pickupDate: day(fd, "pickupDate"), cutoff: txt(fd, "cutoff", 80), insurance: txt(fd, "insurance", 120), customsNote: txt(fd, "customsNote", 200), reliability: txt(fd, "reliability", 200),
    validUntil: day(fd, "validUntil"), source: source!, recordedByName: user.name, ...(b ? { breakdown: b as unknown as Prisma.InputJsonValue } : {}),
  } });
  back(spoId, "ok=flete-opcion");
}

/** Choose the option. Not the cheapest, or one that doesn't protect the promise, needs its reason in writing. */
export async function chooseFreightQuote(quoteId: string, fd: FormData) {
  const q = await db.freightQuote.findUnique({ where: { id: quoteId }, select: { id: true, requirement: { select: { supplierPoId: true } } } });
  if (!q) redirect("/compras");
  const spoId = q!.requirement.supplierPoId;
  const { user, spo } = await load(spoId);
  const f = spo.freight!;
  const pol = await getOpsPolicy();
  const after = isDomestic(spo.supplier) ? LAST_MILE_DAYS : CLEARANCE_DAYS + LAST_MILE_DAYS;
  const reads = readQuotes(f.quotes.map((x) => ({ id: x.id, cost: Number(x.cost), currency: x.currency, transitDays: x.transitDays, pickupDate: x.pickupDate })), { readyDate: f.readyDate, promise: spo.deal.promisedDate, today: today(), afterArrivalDays: after, policy: pol.value });
  const r = reads.find((x) => x.id === quoteId)!;
  const reason = txt(fd, "reason", 300);
  if (choiceNeedsReason(r) && !reason) back(spoId, "err=flete-motivo");
  await db.$transaction([
    db.freightQuote.updateMany({ where: { requirementId: f.id, chosen: true }, data: { chosen: false } }),
    db.freightQuote.update({ where: { id: quoteId }, data: { chosen: true, chosenReason: reason, chosenByName: user.name, chosenAt: new Date() } }),
  ]);
  back(spoId, "ok=flete-elegida");
}
