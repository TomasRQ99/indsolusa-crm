"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEditOps, canEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays, today } from "@/lib/domain";
import { EXC_TEXT, MAX_RECEIPT_PHOTOS, lineException, lotsFor, quarantines } from "@/lib/stock-rules";

// Operaciones O6 · goods receipt (module 11 §34–35). Recorded by whoever handles the purchase (decision: Negociador
// Operativo, the Journey owner or management). Units in doubt go to quarantine; what we measured feeds the product's
// logistics passport as our own evidence, without overwriting what the supplier stated.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const num = (fd: FormData, k: string) => { const raw = String(fd.get(k) ?? "").trim().replace(",", "."); const n = Number(raw); return raw && Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null; };
const yes = (fd: FormData, k: string) => fd.get(k) !== "no";

export async function recordReceipt(spoId: string, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`/compras/${spoId}?${qs}#recepcion`); };
  const spo = await db.supplierPO.findUniqueOrThrow({ where: { id: spoId }, include: { lines: { orderBy: { position: "asc" } }, supplier: { select: { id: true, name: true } }, deal: { select: { id: true, ownerId: true, accountId: true } }, receipts: { include: { lines: true } } } });
  assertCanEditOps(user, spo.deal.ownerId);
  if (!spo.releasedAt) back("err=rec-borrador");
  const loc = await db.stockLocation.findFirst({ where: { id: String(fd.get("locationId") ?? ""), active: true } });
  const day = String(fd.get("receivedAt") ?? "");
  if (!loc) back("err=rec-lugar");
  const receivedAt = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : today();
  const lastDelivery = fd.get("lastDelivery") === "1";
  const pr = await db.purchaseRequirement.findUnique({ where: { supplierPoId: spoId }, select: { lines: { select: { position: true, allocations: { select: { dealId: true, qty: true } } } } } });
  const done = (pos: number) => spo.receipts.flatMap((r) => r.lines).filter((l) => l.position === pos).reduce((s, l) => s + l.qtyReceived, 0);
  const lines = spo.lines.map((l) => {
    const qtyReceived = Math.round(num(fd, `rq_${l.position}`) ?? 0);
    const remaining = Math.max(0, l.qty - done(l.position));
    const checks = { identityOk: yes(fd, `id_${l.position}`), conditionOk: yes(fd, `cond_${l.position}`), completeOk: yes(fd, `comp_${l.position}`), docsOk: yes(fd, `docs_${l.position}`) };
    const kind = qtyReceived > 0 || lastDelivery ? lineException({ qtyRemaining: remaining, qtyReceived, lastDelivery, ...checks }) : null;
    return { l, qtyReceived, remaining, checks, kind, note: txt(fd, `note_${l.position}`), serials: txt(fd, `ser_${l.position}`, 400) };
  }).filter((x) => x.qtyReceived > 0 || x.kind);
  if (!lines.length) back("err=rec-nada");
  // An exception is never recorded without saying what was seen.
  if (lines.some((x) => x.kind && !x.note)) back("err=rec-nota");
  const grossKg = num(fd, "grossKg");
  const dims = txt(fd, "dims", 160);
  const packages = num(fd, "packages");
  const rec = await db.$transaction(async (tx) => {
    const start = `REC-${String(receivedAt.getUTCFullYear()).slice(2)}${String(receivedAt.getUTCMonth() + 1).padStart(2, "0")}-`;
    const last = await tx.goodsReceipt.findFirst({ where: { code: { startsWith: start } }, orderBy: { code: "desc" }, select: { code: true } });
    const code = `${start}${String(last ? Number(last.code.slice(start.length)) + 1 : 1).padStart(4, "0")}`;
    const r = await tx.goodsReceipt.create({ data: { code, supplierPoId: spoId, locationId: loc!.id, receivedAt, receivedById: user.id, receivedByName: user.name, packages: packages != null ? Math.round(packages) : null, grossKg, dims, packagingOk: fd.get("packagingOk") === "no" ? false : fd.get("packagingOk") === "yes" ? true : null, notes: txt(fd, "notes", 500) } });
    for (const x of lines) {
      const line = await tx.goodsReceiptLine.create({ data: { receiptId: r.id, position: x.l.position, code: x.l.code, description: x.l.description, qtyExpected: x.remaining, qtyReceived: x.qtyReceived, ...x.checks, serials: x.serials, exceptionKind: x.kind, exceptionNote: x.kind ? x.note : null } });
      // Journeys still waiting for this line: what the requirement assigned, minus what earlier receipts already committed.
      const prLine = pr?.lines.find((p) => p.position === x.l.position);
      const allocs = prLine ? prLine.allocations : [{ dealId: spo.dealId, qty: x.l.qty }];
      const committed = await tx.stockLot.groupBy({ by: ["dealId"], where: { state: "COMMITTED", receiptLine: { position: x.l.position, receipt: { supplierPoId: spoId } } }, _sum: { qty: true } });
      const open = allocs.map((a) => ({ dealId: a.dealId, open: a.qty - (committed.find((c) => c.dealId === a.dealId)?._sum.qty ?? 0) }));
      for (const lot of lotsFor(x.qtyReceived, x.kind, open)) await tx.stockLot.create({ data: { receiptLineId: line.id, locationId: loc!.id, code: x.l.code, description: x.l.description, qty: lot.qty, state: lot.state, dealId: lot.dealId, stateByName: user.name, stateAt: new Date(), stateNote: quarantines(x.kind) ? x.note : null } });
      if (x.kind) await tx.operationalException.create({ data: {
        dealId: spo.dealId, supplierPoId: spoId, kind: x.kind === "IDENTITY" ? "WRONG_ITEM" : x.kind === "CONDITION" ? "DAMAGED" : x.kind === "DOCUMENTATION" ? "MISSING_DOCS" : "SHORT_SHIPMENT",
        whatHappened: `Recepción ${code}: ${EXC_TEXT[x.kind].es} en ${x.l.code ?? x.l.description}`.slice(0, 300), expected: `${x.remaining} × ${x.l.code ?? x.l.description}, correcto y completo`.slice(0, 300), actual: `${x.qtyReceived} recibidas · ${x.note}`.slice(0, 300),
        evidence: `Recepción ${code} en ${loc!.name}`, options: ["Reclamar al proveedor", "Aceptar como está", "Devolver"], recommended: quarantines(x.kind) ? "Resolver la cuarentena: liberar, marcar dañado o devolver" : "Aclarar con el proveedor y registrar la respuesta", impactAreas: [], ownerId: user.id, deadline: addDays(today(), 2), createdByName: user.name,
      } });
    }
    // Our own measurement is evidence for the product's passport (AC24): added as a new observation, never an overwrite.
    if (grossKg != null && spo.lines.length === 1 && spo.lines[0].code) {
      const part = await tx.part.findFirst({ where: { mpn: { equals: spo.lines[0].code, mode: "insensitive" } }, select: { id: true } });
      if (part) await tx.logisticsObservation.create({ data: { partId: part.id, supplierId: spo.supplier.id, dealId: spo.dealId, qtyContext: lines[0]?.qtyReceived ?? null, grossKg, packages: packages != null ? Math.round(packages) : null, status: "WAREHOUSE_MEASURED", source: `Recepción ${code} · ${loc!.name}`, observedAt: receivedAt, recordedByName: user.name } });
    }
    // The order counts as received only when every line arrived in full.
    const full = spo.lines.every((l) => done(l.position) + (lines.find((x) => x.l.position === l.position)?.qtyReceived ?? 0) >= l.qty);
    if (full && !spo.receivedAt) await tx.supplierPO.update({ where: { id: spoId }, data: { receivedAt } });
    await tx.activity.create({ data: { type: "NOTE", subject: `Recepción ${code} de ${spo.code} en ${loc!.name}${lines.some((x) => x.kind) ? " · con novedades" : ""}`.slice(0, 200), userId: user.id, accountId: spo.deal.accountId, dealId: spo.dealId, phase: "execute", source: "Recepción" } });
    return r;
  });
  back(`ok=recibido&rec=${rec.id}`);
}

/** Photos of a receipt (shrunk in the browser before upload). */
export async function addReceiptPhotos(receiptId: string, fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const r = await db.goodsReceipt.findUnique({ where: { id: receiptId }, select: { supplierPo: { select: { deal: { select: { ownerId: true } } } }, _count: { select: { photos: true } } } });
  if (!r || !canEditOps(user, r.supplierPo.deal.ownerId)) return { ok: false, error: "PERMISO" };
  const room = MAX_RECEIPT_PHOTOS - r._count.photos;
  if (room <= 0) return { ok: false, error: "LLENO" };
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0 && f.size <= 5 * 1024 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(f.type)).slice(0, room);
  if (!files.length) return { ok: false, error: "NADA" };
  for (const f of files) await db.goodsReceiptPhoto.create({ data: { receiptId, name: f.name.slice(0, 160) || "foto.jpg", mime: f.type, size: f.size, data: Buffer.from(await f.arrayBuffer()), uploadedByName: user.name } });
  refreshApp();
  return { ok: true };
}

/** Resolve a lot in doubt, or move stock out. Always with a written reason. */
export async function moveLot(lotId: string, fd: FormData) {
  const user = await requireUser();
  const go = (qs: string): never => { refreshApp(); redirect(`/operaciones/inventario?${qs}`); };
  const lot = await db.stockLot.findUnique({ where: { id: lotId }, select: { id: true, state: true, outAt: true, dealId: true, receiptLine: { select: { receipt: { select: { supplierPo: { select: { dealId: true, deal: { select: { ownerId: true, internal: true } } } } } } } } } });
  if (!lot) go("err=lote");
  if (!canEditOps(user, lot!.receiptLine.receipt.supplierPo.deal.ownerId)) go("err=permiso");
  const action = String(fd.get("action") ?? "");
  const note = txt(fd, "note");
  if (!note) go("err=nota");
  if (lot!.outAt) go("err=salio");
  const stamp = { stateNote: note, stateByName: user.name, stateAt: new Date() };
  if (action === "OUT") {
    // Units in doubt never leave towards a customer.
    if (lot!.state === "QUARANTINE" || lot!.state === "DAMAGED") go("err=bloqueado");
    await db.stockLot.update({ where: { id: lotId }, data: { outAt: new Date(), outNote: note } });
  } else if (lot!.state === "QUARANTINE" && action === "RELEASE") {
    // Released units return to the Journey of their purchase.
    const own = lot!.receiptLine.receipt.supplierPo;
    await db.stockLot.update({ where: { id: lotId }, data: own.deal.internal ? { state: "AVAILABLE", dealId: null, ...stamp } : { state: "COMMITTED", dealId: own.dealId, ...stamp } });
  } else if (lot!.state === "QUARANTINE" && (action === "DAMAGED" || action === "RETURN_PENDING")) {
    await db.stockLot.update({ where: { id: lotId }, data: { state: action, dealId: null, ...stamp } });
  } else go("err=accion");
  go("ok=lote");
}
