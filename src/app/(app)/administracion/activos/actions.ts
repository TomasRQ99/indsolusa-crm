"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canAdminPeople, canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { fDay, fInt, fMoney, fPick, fText } from "@/lib/fd";
import { ASSET_CATS } from "@/lib/admin-rules";
import { nextInternalCode } from "@/lib/admin-store";

// Módulo 14 §2H · Assets & custody. The asset row holds where things stand today; every change is also written as
// an event that is never edited, so who had the asset and when can always be answered (AC11).

const list = (qs: string): never => { refreshApp(); redirect(`/administracion/activos?${qs}`); };
const one = (id: string, qs: string): never => { refreshApp(); redirect(`/administracion/activos/${id}?${qs}`); };
type U = { id: string; role: string };
const canManage = (u: U) => canFinance(u as never) || canAdminPeople(u as never);

export async function createAsset(fd: FormData) {
  const user = await requireUser();
  if (!canManage(user)) list("err=permiso");
  const name = fText(fd, "name", 160), category = fPick(fd, "category", ASSET_CATS), legalOwner = fText(fd, "legalOwner", 120);
  if (!name || !category || !legalOwner) list("err=datos#nuevo");
  const ipId = fText(fd, "internalPurchaseId", 40);
  const ip = ipId ? await db.internalPurchase.findFirst({ where: { id: ipId, status: "APPROVED", asset: null }, select: { id: true } }) : null;
  const acquiredOn = fDay(fd, "acquiredOn");
  const a = await db.$transaction(async (tx) => {
    const row = await tx.asset.create({ data: {
      code: await nextInternalCode("AS", tx), name: name!, category: category!, legalOwner: legalOwner!, value: fMoney(fd, "value"), currency: (fText(fd, "currency", 3) ?? "USD").toUpperCase(), acquiredOn,
      serial: fText(fd, "serial", 80), location: fText(fd, "location", 120), warrantyUntil: fDay(fd, "warrantyUntil"), insurer: fText(fd, "insurer", 120), insuranceUntil: fDay(fd, "insuranceUntil"),
      nextMaintenanceOn: fDay(fd, "nextMaintenanceOn"), documentsNote: fText(fd, "documentsNote", 500), plate: fText(fd, "plate", 20), odometerKm: fInt(fd, "odometerKm", 0, 5e6), internalPurchaseId: ip?.id ?? null, createdByName: user.name,
    } });
    await tx.assetEvent.create({ data: { assetId: row.id, kind: "ACQUIRED", at: acquiredOn ?? today(), location: row.location, note: ip ? "Registrado desde una compra interna" : null, byName: user.name } });
    return row;
  });
  one(a.id, "ok=creado");
}

/** One fact in the life of the asset. Custody changes say from whom and to whom; nothing earlier is touched. */
export async function recordAssetEvent(id: string, fd: FormData) {
  const user = await requireUser();
  const a = await db.asset.findUnique({ where: { id }, include: { custodian: { select: { name: true } } } });
  if (!a) list("err=no-existe");
  const kind = String(fd.get("kind") ?? "");
  const holder = a!.custodianId === user.id;
  // The person who has the asset may report its kilometres and maintenance; everything else is Administración.
  if (!(canManage(user) || (holder && (kind === "ODOMETER" || kind === "MAINTENANCE")))) one(id, "err=permiso");
  if (a!.status === "DISPOSED") one(id, "err=baja");
  const at = fDay(fd, "at") ?? today();
  if (at > today()) one(id, "err=fecha");
  const note = fText(fd, "note", 500), evidence = fText(fd, "evidence", 200), location = fText(fd, "location", 120);
  const base = { assetId: id, kind, at, note, evidence, byName: user.name, fromName: a!.custodian?.name ?? null };
  if (kind === "ASSIGNED" || kind === "TRANSFERRED") {
    const to = await db.user.findFirst({ where: { id: String(fd.get("toUserId") ?? ""), active: true }, select: { id: true, name: true } });
    if (kind === "ASSIGNED" && !to) one(id, "err=persona#mover");
    if (!to && !location) one(id, "err=persona#mover");
    if (to && to.id === a!.custodianId && (location ?? a!.location) === a!.location) one(id, "err=igual#mover");
    await db.$transaction([
      db.assetEvent.create({ data: { ...base, kind: a!.custodianId && kind === "ASSIGNED" ? "TRANSFERRED" : kind, toUserId: to?.id ?? null, toName: to?.name ?? null, location: location ?? a!.location } }),
      db.asset.update({ where: { id }, data: { custodianId: to ? to.id : a!.custodianId, status: to || a!.custodianId ? "ASSIGNED" : a!.status, location: location ?? a!.location } }),
    ]);
  } else if (kind === "RETURNED") {
    if (!a!.custodianId) one(id, "err=igual#mover");
    await db.$transaction([db.assetEvent.create({ data: { ...base, location: location ?? a!.location } }), db.asset.update({ where: { id }, data: { custodianId: null, status: "ACQUIRED", location: location ?? a!.location } })]);
  } else if (kind === "MAINTENANCE") {
    if (!note) one(id, "err=nota#hecho");
    const next = fDay(fd, "nextOn");
    const km = fInt(fd, "odometerKm", 0, 5e6);
    if (km != null && a!.odometerKm != null && km < a!.odometerKm) one(id, "err=km#hecho");
    await db.$transaction([db.assetEvent.create({ data: { ...base, costUsd: fMoney(fd, "costUsd"), odometerKm: km } }), db.asset.update({ where: { id }, data: { nextMaintenanceOn: next, ...(km != null ? { odometerKm: km } : {}) } })]);
  } else if (kind === "ODOMETER") {
    const km = fInt(fd, "odometerKm", 0, 5e6);
    // Kilometres never go backwards: a lower reading is a typing mistake or something to look into.
    if (km == null || (a!.odometerKm != null && km < a!.odometerKm)) one(id, "err=km#hecho");
    await db.$transaction([db.assetEvent.create({ data: { ...base, odometerKm: km } }), db.asset.update({ where: { id }, data: { odometerKm: km } })]);
  } else if (kind === "INSURANCE") {
    const until = fDay(fd, "until"), insurer = fText(fd, "insurer", 120);
    if (!until || !insurer) one(id, "err=seguro#hecho");
    await db.$transaction([db.assetEvent.create({ data: { ...base, note: `${insurer} · hasta ${until!.toISOString().slice(0, 10)}${note ? ` · ${note}` : ""}`, costUsd: fMoney(fd, "costUsd") } }), db.asset.update({ where: { id }, data: { insurer, insuranceUntil: until } })]);
  } else if (kind === "DOCUMENT") {
    if (!note) one(id, "err=nota#hecho");
    await db.assetEvent.create({ data: base });
  } else if (kind === "DISPOSED") {
    if (!note) one(id, "err=nota#baja");
    await db.$transaction([db.assetEvent.create({ data: base }), db.asset.update({ where: { id }, data: { status: "DISPOSED", disposedAt: at, custodianId: null } })]);
  } else one(id, "err=datos");
  one(id, "ok=registrado");
}
