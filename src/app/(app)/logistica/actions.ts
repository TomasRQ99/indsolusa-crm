"use server";

import { redirect } from "next/navigation";
import type { Prisma, ShipmentMode } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays, nextCode, today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { buildShipment, defaultDocs, LAST_MILE_DAYS, CLEARANCE_DAYS, shipInclude, type OptKey, type ShipDoc } from "@/lib/logistics";
import { isDomestic } from "@/lib/purchasing";

const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const txt = (fd: FormData, k: string, max = 300) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const back = (id: string, qs: string): never => {
  refreshApp();
  redirect(`/logistica/${id}?${qs}`);
};
const MODES: ShipmentMode[] = ["AIR", "COURIER", "OCEAN", "GROUND"];

async function load(id: string) {
  const user = await requireUser();
  const s = await db.shipment.findUniqueOrThrow({ where: { id }, include: shipInclude });
  assertCanEditOps(user, s.deal.ownerId);
  return { user, s };
}
const fact = (userId: string, s: { dealId: string; deal: { accountId: string } }, subject: string, source: string | null) =>
  db.activity.create({ data: { type: "NOTE", subject: subject.slice(0, 200), userId, accountId: s.deal.accountId, dealId: s.dealId, phase: "execute", source } });

/** Record an external shipment: carrier + tracking + ETA. Contents default to what is still undelivered. */
export async function recordShipment(dealId: string, fd: FormData) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { items: { include: { deliveryLines: { select: { qty: true } } } }, supplierPos: { include: { supplier: true } }, account: true } });
  assertCanEditOps(user, deal.ownerId);
  const carrierName = txt(fd, "carrierName", 120);
  if (!carrierName) redirect(`/deals/${dealId}?tab=execute&ok=envio-sin-dato`);
  const spo = deal.supplierPos.find((p) => p.id === txt(fd, "supplierPoId", 40)) ?? deal.supplierPos.find((p) => !p.receivedAt) ?? null;
  const international = spo ? !isDomestic(spo.supplier) : fd.get("international") === "1";
  const mode = (MODES as string[]).includes(String(fd.get("mode"))) ? (String(fd.get("mode")) as ShipmentMode) : "AIR";
  const carrierEta = dayOf(fd.get("carrierEta"));
  const pickedUpAt = dayOf(fd.get("pickedUpAt")) ?? today();
  const lines = deal.items
    .map((it) => ({ dealItemId: it.id, qty: it.qty - it.deliveryLines.reduce((a, l) => a + l.qty, 0), description: it.code ? `${it.code} · ${it.description}` : it.description }))
    .filter((l) => l.qty > 0);
  const created = await db.$transaction(async (tx) => {
    const code = await nextCode("SHP", "shipment", tx);
    const s = await tx.shipment.create({
      data: {
        code, dealId, supplierPoId: spo?.id ?? null, carrierName, tracking: txt(fd, "tracking", 80), mode,
        origin: txt(fd, "origin", 120) ?? spo?.supplier.country ?? null, destination: txt(fd, "destination", 120) ?? deal.account.name,
        international, toCustomer: fd.get("toCustomer") === "1", customs: international ? "PENDING" : "NOT_REQUIRED",
        plannedPickup: pickedUpAt, pickedUpAt, rtsAt: pickedUpAt, plannedRts: pickedUpAt,
        plannedDelivery: carrierEta, carrierEta, carrierEtaAt: carrierEta ? new Date() : null, carrierEtaSource: txt(fd, "source", 200),
        docs: defaultDocs(mode, international) as unknown as Prisma.InputJsonValue,
        createdByName: user.name,
        lines: { create: lines },
        events: { create: [{ at: new Date(), kind: "NOTE", text: "Envío registrado en SOLU", source: txt(fd, "source", 200), recordedByName: user.name }] },
      },
    });
    if (spo && !spo.shippedAt) await tx.supplierPO.update({ where: { id: spo.id }, data: { shippedAt: pickedUpAt } });
    return s;
  });
  await fact(user.id, { dealId, deal }, `Envío ${created.code} registrado · ${carrierName}${created.tracking ? ` ${created.tracking}` : ""}`, txt(fd, "source", 200));
  back(created.id, "ok=registrado");
}

/** New ETA from the carrier. Only material if it makes SOLU Expected cross the promise. */
export async function updateEta(id: string, fd: FormData) {
  const { user, s } = await load(id);
  const eta = dayOf(fd.get("carrierEta"));
  if (!eta) back(id, "err=fecha");
  const buffer = (s.international && s.customs === "PENDING" ? CLEARANCE_DAYS : 0) + (s.toCustomer ? 0 : LAST_MILE_DAYS);
  const crosses = !!s.deal.promisedDate && addDays(eta!, buffer) > s.deal.promisedDate;
  const source = txt(fd, "source", 200);
  await db.$transaction([
    db.shipmentEvent.create({ data: { shipmentId: id, at: new Date(), kind: "ETA_CHANGE", text: `ETA del transportista: ${s.carrierEta?.toISOString().slice(0, 10) ?? "—"} → ${eta!.toISOString().slice(0, 10)}`, etaBefore: s.carrierEta, etaAfter: eta, material: crosses, source, recordedByName: user.name } }),
    db.shipment.update({ where: { id }, data: { carrierEta: eta, carrierEtaAt: new Date(), carrierEtaSource: source, plannedDelivery: s.plannedDelivery ?? eta } }),
  ]);
  if (crosses) await fact(user.id, s, `${s.code}: la nueva ETA del transportista cruza la promesa`, source);
  back(id, crosses ? "ok=eta-riesgo" : "ok=eta-protegido");
}

/** A carrier checkpoint. Normal scans are just summarised; exceptions are interpreted. */
export async function addCheckpoint(id: string, fd: FormData) {
  const { user, s } = await load(id);
  const exception = fd.get("exception") === "1";
  const text = txt(fd, "text", 300);
  if (!text) back(id, "err=texto");
  await db.$transaction([
    db.shipmentEvent.create({ data: { shipmentId: id, at: new Date(), kind: exception ? "EXCEPTION" : "SCAN", location: txt(fd, "location", 120), text: text!, material: exception, source: txt(fd, "source", 200), recordedByName: user.name } }),
    ...(s.pickedUpAt ? [] : [db.shipment.update({ where: { id }, data: { pickedUpAt: new Date() } })]),
  ]);
  if (exception) await fact(user.id, s, `${s.code}: excepción del transportista · ${text}`, txt(fd, "source", 200));
  back(id, exception ? "ok=excepcion" : "ok=lectura");
}

export async function setCustoms(id: string, state: "HOLD" | "CLEARED", fd: FormData) {
  const { user, s } = await load(id);
  const note = txt(fd, "note", 300);
  if (state === "HOLD" && !note) back(id, "err=nota");
  await db.$transaction([
    db.shipment.update({ where: { id }, data: { customs: state, customsNote: state === "HOLD" ? note : s.customsNote } }),
    db.shipmentEvent.create({ data: { shipmentId: id, at: new Date(), kind: "CUSTOMS", location: s.destination, text: state === "HOLD" ? `Retenido en aduana: ${note}` : `Liberado por la aduana${note ? `: ${note}` : ""}`, material: state === "HOLD", recordedByName: user.name } }),
  ]);
  await fact(user.id, s, state === "HOLD" ? `${s.code}: retenido en aduana · ${note}` : `${s.code}: liberado por la aduana`, note);
  back(id, state === "HOLD" ? "ok=retenido" : "ok=liberado");
}

export async function toggleDoc(id: string, key: string) {
  const { s } = await load(id);
  const docs = ((Array.isArray(s.docs) ? s.docs : []) as unknown as ShipDoc[]).map((d) => (d.key === key ? { ...d, ready: !d.ready } : d));
  await db.shipment.update({ where: { id }, data: { docs: docs as unknown as Prisma.InputJsonValue } });
  back(id, "ok=docs");
}

/** The carrier says it was delivered (to the customer or to the broker/warehouse). */
export async function markDelivered(id: string, fd: FormData) {
  const { user, s } = await load(id);
  const note = txt(fd, "note", 200);
  await db.$transaction([
    db.shipment.updateMany({ where: { id, deliveredAt: null }, data: { deliveredAt: today(), deliveredNote: note } }),
    db.shipmentEvent.create({ data: { shipmentId: id, at: new Date(), kind: "DELIVERED", location: s.destination, text: `Entregado según ${s.carrierName}${note ? ` · ${note}` : ""}`, recordedByName: user.name } }),
  ]);
  back(id, "ok=entregado");
}

/** The customer confirms receipt: creates the delivery note (remisión) so invoicing can start. */
export async function confirmReceipt(id: string, fd: FormData) {
  const { user, s } = await load(id);
  const by = txt(fd, "receivedByName", 120);
  if (!by) back(id, "err=quien");
  if (s.receipt === "CONFIRMED") back(id, "ok=recibido");
  const lines = s.lines.filter((l) => l.dealItemId && l.qty > 0);
  await db.$transaction(async (tx) => {
    let deliveryId: string | null = null;
    if (lines.length) {
      const code = await nextCode("REM", "delivery", tx);
      const d = await tx.delivery.create({ data: { code, dealId: s.dealId, deliveredAt: today(), deliveredBy: s.carrierName, receivedByName: by, podReceived: true, notes: `Desde envío ${s.code}${s.tracking ? ` · ${s.tracking}` : ""}`, lines: { create: lines.map((l) => ({ dealItemId: l.dealItemId!, qty: l.qty })) } } });
      deliveryId = d.id;
    }
    const n = await tx.shipment.updateMany({ where: { id, receipt: { not: "CONFIRMED" } }, data: { receipt: "CONFIRMED", receivedAt: today(), receivedByName: by, receiptNote: txt(fd, "note", 300), deliveryId, deliveredAt: s.deliveredAt ?? today() } });
    if (!n.count) throw new Error("already confirmed");
    await tx.shipmentEvent.create({ data: { shipmentId: id, at: new Date(), kind: "NOTE", text: `Recibo confirmado por ${by}`, recordedByName: user.name } });
    if (s.supplierPoId) await tx.supplierPO.updateMany({ where: { id: s.supplierPoId, receivedAt: null }, data: { receivedAt: today() } });
  });
  await fact(user.id, s, `${s.code}: recibo confirmado por ${by}`, txt(fd, "note", 300));
  back(id, "ok=recibido");
}

/** The customer disputes receipt (missing, short, damaged). Blocks the remisión until resolved. */
export async function disputeReceipt(id: string, fd: FormData) {
  const { user, s } = await load(id);
  const note = txt(fd, "note", 300);
  if (!note) back(id, "err=nota");
  await db.$transaction([
    db.shipment.update({ where: { id }, data: { receipt: "DISPUTED", disputedAt: new Date(), disputeNote: note, deliveredAt: s.deliveredAt ?? today() } }),
    db.shipmentEvent.create({ data: { shipmentId: id, at: new Date(), kind: "NOTE", text: `El cliente disputa el recibo: ${note}`, material: true, recordedByName: user.name } }),
  ]);
  await fact(user.id, s, `${s.code}: el cliente disputa el recibo · ${note}`, null);
  back(id, "ok=disputa");
}

/** Choose a concrete option: recorded as a decision and becomes the Journey's next movement. */
export async function chooseOption(id: string, key: OptKey, fd: FormData) {
  const { user, s } = await load(id);
  const i = makeI18n(user.lang);
  const B = buildShipment(s, i);
  const o = B.opts.find((x) => x.key === key);
  if (!o) back(id, "err=opcion");
  await db.$transaction([
    db.shipmentDecision.create({ data: { shipmentId: id, option: key, title: o!.title, note: txt(fd, "note", 300), newExpected: o!.newExpected, decidedByName: user.name } }),
    db.deal.update({ where: { id: s.dealId }, data: { nextMove: `${o!.title} (${s.code})`.slice(0, 200), nextMoveDate: today() } }),
  ]);
  await fact(user.id, s, `${s.code}: opción elegida · ${o!.title}`, txt(fd, "note", 300));
  back(id, "ok=opcion");
}

/** O5a §30: the dates that complete the set (planned and actual departure, expected customs release). */
export async function saveShipmentDates(id: string, fd: FormData) {
  await load(id);
  const d = (k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null; };
  await db.shipment.update({ where: { id }, data: { plannedDeparture: d("plannedDeparture"), departedAt: d("departedAt"), customsExpectedRelease: d("customsExpectedRelease") } });
  back(id, "ok=fechas");
}