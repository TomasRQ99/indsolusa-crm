"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { BILLING_BASIS, ENTRY_KINDS, EVIDENCE_KINDS, FAIL_CAUSES, MAX_DELIVERY_EVIDENCE, PHASES, RESOURCES, canDeliver, canDispatch, consumeLots, remainingByItem, type Line, type StateIn } from "@/lib/dispatch-rules";

// Operaciones O8 · dispatch orders (module 11 §38–40, v1.2 §44). Operations runs the physical delivery of what
// Commercial instructed. Each step is its own fact with who and when; a failed attempt is never erased.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const day = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null; };
const num = (fd: FormData, k: string) => { const raw = String(fd.get(k) ?? "").trim().replace(",", "."); const n = Number(raw); return raw && Number.isFinite(n) && n >= 0 && n < 1e8 ? n : null; };
const to = (id: string, qs: string): never => { refreshApp(); redirect(`/operaciones/despachos/${id}?${qs}`); };

async function load(id: string) {
  const user = await requireUser();
  const o = await db.dispatchOrder.findUnique({ where: { id }, include: { deal: { select: { id: true, code: true, ownerId: true, accountId: true, account: { select: { requiresReceptionCode: true, deliveryRequirements: { where: { active: true }, select: { id: true, phase: true, text: true } } } }, dispatches: { where: { supersededAt: null }, select: { id: true }, take: 1 } } }, delivery: { select: { id: true, receptionCode: true, invoice: { select: { id: true } } } }, _count: { select: { evidence: true } } } });
  if (!o) redirect("/operaciones/despachos");
  if (!canEditOps(user, o!.deal.ownerId)) to(id, "err=permiso");
  const s: StateIn = { cancelled: !!o!.cancelledAt, hasInstruction: o!.deal.dispatches.length > 0, reqs: o!.deal.account.deliveryRequirements, checks: (o!.checks ?? {}) as Record<string, unknown>, customerHold: !!o!.customerHoldSince, scheduledFor: o!.scheduledFor, dispatchedAt: o!.dispatchedAt, deliveredAt: o!.deliveredAt, entryRequired: o!.deal.account.requiresReceptionCode, entryRef: o!.delivery?.receptionCode ?? null, invoiced: !!o!.delivery?.invoice };
  return { user, o: o!, s };
}

/** New dispatch order for a Journey, for the units still to deliver (a partial delivery is just fewer units). */
export async function createDispatchOrder(dealId: string, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`/deals/${dealId}/despacho?${qs}#operaciones`); };
  const d = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true, items: { select: { id: true, qty: true, code: true, description: true } }, deliveries: { select: { lines: { select: { dealItemId: true, qty: true } } } }, dispatchOrders: { where: { cancelledAt: null, deliveredAt: null }, select: { lines: true } }, dispatches: { where: { supersededAt: null }, select: { id: true }, take: 1 } } });
  if (!canEditOps(user, d.ownerId)) back("err=permiso");
  const kind = String(fd.get("resourceKind") ?? "");
  if (!RESOURCES[kind]) back("err=recurso");
  const rem = remainingByItem(d.items, d.deliveries.flatMap((x) => x.lines), d.dispatchOrders.flatMap((x) => x.lines as unknown as Line[]));
  const lines: Line[] = d.items.map((it) => ({ dealItemId: it.id, code: it.code, description: it.description, qty: Math.round(num(fd, `q_${it.id}`) ?? 0) })).filter((l) => l.qty > 0);
  if (!lines.length) back("err=nada");
  // Never more than what is still owed to the customer.
  if (lines.some((l) => l.qty > (rem.find((r) => r.id === l.dealItemId)?.remaining ?? 0))) back("err=exceso");
  const o = await db.$transaction(async (tx) => {
    const T = today();
    const start = `DSP-${String(T.getUTCFullYear()).slice(2)}${String(T.getUTCMonth() + 1).padStart(2, "0")}-`;
    const last = await tx.dispatchOrder.findFirst({ where: { code: { startsWith: start } }, orderBy: { code: "desc" }, select: { code: true } });
    const code = `${start}${String(last ? Number(last.code.slice(start.length)) + 1 : 1).padStart(4, "0")}`;
    return tx.dispatchOrder.create({ data: { code, dealId, instructionId: d.dispatches[0]?.id ?? null, lines: lines as unknown as Prisma.InputJsonValue, resourceKind: kind, resourceName: txt(fd, "resourceName", 120), scheduledFor: day(fd, "scheduledFor"), scheduledByName: day(fd, "scheduledFor") ? user.name : null, createdByName: user.name } });
  });
  to(o.id, "ok=creado");
}

export async function toggleCheck(id: string, reqId: string) {
  const { user, o, s } = await load(id);
  const req = s.reqs.find((r) => r.id === reqId);
  if (!req || o.cancelledAt) to(id, "err=accion");
  const checks = { ...(s.checks as Record<string, { by: string; at: string }>) };
  // What allowed the order to leave can't be unticked once it left.
  if (checks[reqId] && req!.phase === "BEFORE_DISPATCH" && o.dispatchedAt) to(id, "err=accion");
  if (checks[reqId]) delete checks[reqId]; else checks[reqId] = { by: user.name, at: new Date().toISOString() };
  await db.dispatchOrder.update({ where: { id }, data: { checks } });
  to(id, "ok=requisito");
}

export async function scheduleOrder(id: string, fd: FormData) {
  const { user, o } = await load(id);
  if (o.dispatchedAt || o.cancelledAt) to(id, "err=accion");
  const kind = String(fd.get("resourceKind") ?? "");
  const when = day(fd, "scheduledFor");
  if (!RESOURCES[kind]) to(id, "err=recurso");
  await db.dispatchOrder.update({ where: { id }, data: { resourceKind: kind, resourceName: txt(fd, "resourceName", 120), tracking: txt(fd, "tracking", 80), scheduledFor: when, scheduledByName: when ? user.name : null } });
  to(id, "ok=programado");
}

/** A wait the customer controls. It is recorded as theirs so it never counts as our delay. */
export async function setCustomerHold(id: string, fd: FormData) {
  const { o } = await load(id);
  if (o.dispatchedAt || o.cancelledAt) to(id, "err=accion");
  if (fd.get("clear") === "1") await db.dispatchOrder.update({ where: { id }, data: { customerHoldReason: null, customerHoldSince: null } });
  else {
    const reason = txt(fd, "reason");
    if (!reason) to(id, "err=motivo");
    await db.dispatchOrder.update({ where: { id }, data: { customerHoldReason: reason, customerHoldSince: o.customerHoldSince ?? new Date() } });
  }
  to(id, "ok=espera");
}

/** The goods leave. Committed stock of this Journey leaves the warehouse with the order (oldest first). */
export async function markDispatched(id: string, fd: FormData) {
  const { user, o, s } = await load(id);
  if (!canDispatch(s)) to(id, "err=no-listo");
  const at = day(fd, "at") ?? today();
  await db.$transaction(async (tx) => {
    const n = await tx.dispatchOrder.updateMany({ where: { id, dispatchedAt: null }, data: { dispatchedAt: at, dispatchedByName: user.name, tracking: txt(fd, "tracking", 80) ?? o.tracking } });
    if (!n.count) return;
    for (const l of o.lines as unknown as Line[]) {
      const lots = await tx.stockLot.findMany({ where: { dealId: o.dealId, state: "COMMITTED", outAt: null, ...(l.code ? { code: { equals: l.code, mode: "insensitive" } } : { description: l.description }) }, orderBy: { createdAt: "asc" } });
      for (const t of consumeLots(lots, l.qty).take) {
        const lot = lots.find((x) => x.id === t.id)!;
        const out = { outAt: new Date(), outNote: `Despacho ${o.code}` };
        if (t.whole) await tx.stockLot.update({ where: { id: lot.id }, data: out });
        else {
          // Part of a lot leaves: the rest stays as its own lot.
          await tx.stockLot.update({ where: { id: lot.id }, data: { qty: lot.qty - t.qty } });
          await tx.stockLot.create({ data: { receiptLineId: lot.receiptLineId, locationId: lot.locationId, code: lot.code, description: lot.description, qty: t.qty, state: lot.state, dealId: lot.dealId, stateByName: lot.stateByName, stateAt: lot.stateAt, stateNote: lot.stateNote, ...out } });
        }
      }
    }
    await tx.activity.create({ data: { type: "NOTE", subject: `Despacho ${o.code} salió hacia el cliente`.slice(0, 200), userId: user.id, accountId: o.deal.accountId, dealId: o.dealId, phase: "execute", source: "Despacho" } });
  });
  to(id, "ok=despachado");
}

/** One delivery attempt. A failure stays as history and the order goes back to be scheduled again. */
export async function recordAttempt(id: string, fd: FormData) {
  const { user, o, s } = await load(id);
  if (!o.dispatchedAt || o.deliveredAt || o.cancelledAt) to(id, "err=accion");
  const outcome = String(fd.get("outcome") ?? "");
  const at = day(fd, "at") ?? today();
  if (outcome === "FAILED") {
    const cause = String(fd.get("cause") ?? "");
    const reason = txt(fd, "reason");
    if (!FAIL_CAUSES[cause] || !reason) to(id, "err=intento");
    await db.$transaction([
      db.deliveryAttempt.create({ data: { orderId: id, at, outcome: "FAILED", cause, reason, recordedByName: user.name } }),
      db.dispatchOrder.update({ where: { id }, data: { dispatchedAt: null, dispatchedByName: null, scheduledFor: null, scheduledByName: null, ...(cause === "CUSTOMER" ? { customerHoldReason: reason, customerHoldSince: new Date() } : {}) } }),
      // The goods came back: what left the warehouse with this order is in stock again, committed to the same Journey.
      db.stockLot.updateMany({ where: { dealId: o.dealId, outNote: `Despacho ${o.code}`, outAt: { not: null } }, data: { outAt: null, outNote: null } }),
      db.operationalException.create({ data: { dealId: o.dealId, kind: "DELIVERY_FAILED", whatHappened: `Despacho ${o.code}: intento de entrega fallido`, expected: "Entrega recibida por el cliente", actual: reason!, evidence: `Despacho ${o.code}`, options: ["Reprogramar la entrega", "Acordar nueva cita con el cliente", "Cambiar el recurso de entrega"], recommended: cause === "CUSTOMER" ? "Acordar con el cliente cuándo puede recibir" : "Reprogramar y avisar al cliente", impactAreas: [], ownerId: user.id, deadline: today(), createdByName: user.name } }),
    ]);
    to(id, "ok=fallido");
  }
  if (outcome !== "DELIVERED") to(id, "err=accion");
  const receiver = txt(fd, "receiverName", 120);
  if (!receiver) to(id, "err=quien");
  if (!canDeliver(s)) to(id, "err=al-entregar");
  const lines = (o.lines as unknown as Line[]).filter((l) => l.qty > 0);
  await db.$transaction(async (tx) => {
    const code = await nextCode("REM", "delivery", tx);
    const d = await tx.delivery.create({ data: { code, dealId: o.dealId, deliveredAt: at, place: txt(fd, "place", 200), deliveredBy: o.resourceName ?? RESOURCES[o.resourceKind]?.es ?? null, receivedByName: receiver, podReceived: fd.get("pod") === "1", notes: `Desde despacho ${o.code}`, lines: { create: lines.map((l) => ({ dealItemId: l.dealItemId, qty: l.qty, serials: txt(fd, `ser_${l.dealItemId}`, 400) })) } } });
    const n = await tx.dispatchOrder.updateMany({ where: { id, deliveredAt: null }, data: { deliveredAt: at, deliveryId: d.id } });
    if (!n.count) throw new Error("already delivered");
    await tx.deliveryAttempt.create({ data: { orderId: id, at, outcome: "DELIVERED", receiverName: receiver, recordedByName: user.name } });
    await tx.activity.create({ data: { type: "NOTE", subject: `Despacho ${o.code} entregado · recibió ${receiver} · remisión ${code}`.slice(0, 200), userId: user.id, accountId: o.deal.accountId, dealId: o.dealId, phase: "execute", source: "Despacho" } });
  });
  to(id, "ok=entregado");
}

/** MIGO / goods receipt / entry number given by the customer after delivery. */
export async function saveEntryRef(id: string, fd: FormData) {
  const { o } = await load(id);
  const kind = String(fd.get("kind") ?? "");
  const ref = txt(fd, "ref", 80);
  if (!o.deliveryId || !ENTRY_KINDS[kind] || !ref) to(id, "err=entrada");
  await db.delivery.update({ where: { id: o.deliveryId! }, data: { receptionCode: ref, receptionKind: kind, receptionAt: day(fd, "at") ?? today() } });
  to(id, "ok=entrada");
}

export async function saveCost(id: string, fd: FormData) {
  const { o } = await load(id);
  const cost = num(fd, "cost");
  if (o.cancelledAt || cost == null) to(id, "err=costo");
  await db.dispatchOrder.update({ where: { id }, data: { cost: money2(cost!), costCurrency: (txt(fd, "currency", 3) ?? "USD").toUpperCase(), costNote: txt(fd, "note", 200) } });
  to(id, "ok=costo");
}

export async function addEvidence(id: string, fd: FormData) {
  const { user, o } = await load(id);
  const kind = String(fd.get("kind") ?? "");
  const room = MAX_DELIVERY_EVIDENCE - o._count.evidence;
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0 && f.size <= 5 * 1024 * 1024 && ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type)).slice(0, Math.max(0, room));
  if (!EVIDENCE_KINDS[kind] || !files.length) to(id, room <= 0 ? "err=lleno" : "err=archivo");
  for (const f of files) await db.deliveryEvidence.create({ data: { orderId: id, kind, name: f.name.slice(0, 160) || "evidencia", mime: f.type, size: f.size, data: Buffer.from(await f.arrayBuffer()), uploadedByName: user.name } });
  to(id, "ok=evidencia");
}

export async function cancelOrder(id: string, fd: FormData) {
  const { o } = await load(id);
  const reason = txt(fd, "reason");
  // Once the goods left, the story continues with attempts, never with a silent cancellation.
  if (o.dispatchedAt || o.deliveredAt || o.cancelledAt) to(id, "err=accion");
  if (!reason) to(id, "err=motivo");
  await db.dispatchOrder.update({ where: { id }, data: { cancelledAt: new Date(), cancelReason: reason } });
  to(id, "ok=cancelado");
}

/** Delivery Profile of the customer: one requirement, in its phase. */
export async function addRequirement(accountId: string, backTo: string, fd: FormData) {
  const user = await requireUser();
  const phase = String(fd.get("phase") ?? "");
  const text = txt(fd, "text", 200);
  const go = (qs: string): never => { refreshApp(); redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}${qs}`); };
  if (!backTo.startsWith("/operaciones/despachos") && !backTo.startsWith("/deals/")) redirect("/operaciones/despachos");
  if (!(user.role === "NEGOCIADOR_OPERATIVO" || canEdit(user, (await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { ownerId: true } })).ownerId))) go("err=permiso");
  if (!PHASES[phase] || !text) go("err=requisito");
  await db.deliveryRequirement.create({ data: { accountId, phase, text: text!, site: txt(fd, "site", 120) ?? "", createdByName: user.name } });
  go("ok=perfil");
}

export async function retireRequirement(reqId: string, backTo: string) {
  const user = await requireUser();
  const r = await db.deliveryRequirement.findUnique({ where: { id: reqId }, select: { account: { select: { ownerId: true } } } });
  if (!backTo.startsWith("/operaciones/despachos") && !backTo.startsWith("/deals/")) redirect("/operaciones/despachos");
  if (r && (user.role === "NEGOCIADOR_OPERATIVO" || canEdit(user, r.account.ownerId))) await db.deliveryRequirement.update({ where: { id: reqId }, data: { active: false } });
  refreshApp(); redirect(`${backTo}${backTo.includes("?") ? "&" : "?"}ok=perfil`);
}

/** §40 Billing Basis of the Journey: what must have happened before an invoice makes sense. */
export async function setBillingBasis(dealId: string, fd: FormData) {
  const user = await requireUser();
  const basis = String(fd.get("billingBasis") ?? "");
  const d = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true } });
  if (canEdit(user, d.ownerId) && BILLING_BASIS[basis]) await db.deal.update({ where: { id: dealId }, data: { billingBasis: basis } });
  refreshApp(); redirect(`/deals/${dealId}/despacho?ok=base#operaciones`);
}
