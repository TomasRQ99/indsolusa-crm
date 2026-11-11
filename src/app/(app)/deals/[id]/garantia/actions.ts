"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays, today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { CLAIM_KINDS, RESPONSIBLE, closeProblem } from "@/lib/warranty-rules";

// Operaciones O9d · warranty and customer claims (module 11 §45.1). The delivery history is never rewritten: a claim
// and its notes are added on top, and its cost goes to the Journey's cost ledger.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").trim().slice(0, max); return v || null; };
const day = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null; };
const int = (fd: FormData, k: string) => { const n = Number(String(fd.get(k) ?? "").trim()); return Number.isInteger(n) && n > 0 && n <= 240 ? n : null; };
const back = (id: string, qs: string): never => { refreshApp(); redirect(`/deals/${id}/garantia?${qs}`); };

async function gate(dealId: string) {
  const user = await requireUser();
  const d = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true, accountId: true, economicsState: true } });
  if (!canEditOps(user, d.ownerId)) back(dealId, "err=permiso");
  return { user, d };
}

export async function addWarranty(dealId: string, fd: FormData) {
  const { user } = await gate(dealId);
  const item = txt(fd, "item", 200);
  const startsOn = day(fd, "startsOn");
  const months = int(fd, "months");
  if (!item || !startsOn || !months) back(dealId, "err=garantia");
  await db.warranty.create({ data: { dealId, item: item!, serial: txt(fd, "serial", 200), startsOn: startsOn!, months: months!, terms: txt(fd, "terms", 300), supplierName: txt(fd, "supplierName", 120), supplierMonths: int(fd, "supplierMonths"), createdByName: user.name } });
  back(dealId, "ok=garantia");
}

/** A warranty typed by mistake can be removed only while no claim hangs from it. */
export async function removeWarranty(id: string) {
  const w = await db.warranty.findUnique({ where: { id }, select: { dealId: true, _count: { select: { claims: true } } } });
  if (!w) redirect("/operaciones/garantias");
  await gate(w!.dealId);
  if (w!._count.claims) back(w!.dealId, "err=con-casos");
  await db.warranty.delete({ where: { id } });
  back(w!.dealId, "ok=quitada");
}

export async function openClaim(dealId: string, fd: FormData) {
  const { user, d } = await gate(dealId);
  const kind = String(fd.get("kind") ?? "");
  const what = txt(fd, "whatHappened", 500);
  if (!CLAIM_KINDS[kind] || !what) back(dealId, "err=caso");
  const wid = String(fd.get("warrantyId") ?? "");
  const w = wid ? await db.warranty.findFirst({ where: { id: wid, dealId }, select: { id: true } }) : null;
  const reportedAt = day(fd, "reportedAt") ?? today();
  const c = await db.$transaction(async (tx) => {
    const start = `GAR-${String(reportedAt.getUTCFullYear()).slice(2)}${String(reportedAt.getUTCMonth() + 1).padStart(2, "0")}-`;
    const last = await tx.customerClaim.findFirst({ where: { code: { startsWith: start } }, orderBy: { code: "desc" }, select: { code: true } });
    const code = `${start}${String(last ? Number(last.code.slice(start.length)) + 1 : 1).padStart(4, "0")}`;
    const c = await tx.customerClaim.create({ data: { code, dealId, warrantyId: w?.id ?? null, kind, whatHappened: what!, reportedBy: txt(fd, "reportedBy", 120), reportedAt, createdByName: user.name } });
    // It also enters the Operations attention list, like any other exception.
    await tx.operationalException.create({ data: { dealId, kind: "CUSTOMER_CLAIM", whatHappened: `${code}: ${what}`.slice(0, 300), expected: "Producto funcionando como se prometió", actual: what!.slice(0, 300), evidence: `Caso ${code}`, options: ["Reparar o reemplazar", "Tramitar con el proveedor", "Explicar al cliente por qué no procede"], recommended: "Confirmar qué pasó y si está cubierto antes de prometer una solución", impactAreas: [], ownerId: user.id, deadline: addDays(today(), 2), createdByName: user.name } });
    await tx.activity.create({ data: { type: "NOTE", subject: `Caso ${code} abierto (${CLAIM_KINDS[kind].es})`.slice(0, 200), userId: user.id, accountId: d.accountId, dealId, phase: "execute", source: "Garantía" } });
    return c;
  });
  back(dealId, `ok=caso#c-${c.id}`);
}

export async function addClaimNote(claimId: string, fd: FormData) {
  const c = await db.customerClaim.findUnique({ where: { id: claimId }, select: { dealId: true } });
  if (!c) redirect("/operaciones/garantias");
  const { user } = await gate(c!.dealId);
  const text = txt(fd, "text", 500);
  if (!text) back(c!.dealId, "err=nota");
  await db.claimNote.create({ data: { claimId, text: text!, byName: user.name } });
  back(c!.dealId, `ok=nota#c-${claimId}`);
}

/** Close the case: what was done, who was responsible and what it cost us. The cost enters the Journey's real costs. */
export async function closeClaim(claimId: string, fd: FormData) {
  const c = await db.customerClaim.findUnique({ where: { id: claimId }, select: { dealId: true, code: true, status: true } });
  if (!c) redirect("/operaciones/garantias");
  const { user, d } = await gate(c!.dealId);
  if (c!.status !== "OPEN") back(c!.dealId, "err=cerrado");
  const status = fd.get("status") === "REJECTED" ? "REJECTED" : "RESOLVED";
  const resolution = txt(fd, "resolution", 500);
  const responsible = String(fd.get("responsible") ?? "UNKNOWN");
  const problem = closeProblem({ status, resolution, responsible });
  if (problem) back(c!.dealId, problem === "RESOLUTION" ? "err=resolucion" : "err=responsable");
  const raw = String(fd.get("costUsd") ?? "").trim().replace(",", ".");
  const cost = raw && Number.isFinite(Number(raw)) && Number(raw) > 0 ? money2(Number(raw)) : null;
  // A closed economics statement is not changed silently: the cost stays on the case and is flagged.
  const toLedger = cost != null && d.economicsState !== "FINAL";
  await db.$transaction(async (tx) => {
    await tx.customerClaim.update({ where: { id: claimId }, data: { status, resolution, responsible: RESPONSIBLE[responsible] ? responsible : "UNKNOWN", costUsd: cost, resolvedAt: new Date(), resolvedByName: user.name } });
    if (toLedger) await tx.dealCost.create({ data: { dealId: c!.dealId, category: "OTHER", amount: cost!, description: `Caso ${c!.code}: ${resolution}`.slice(0, 200), evidence: `Caso ${c!.code}`, spentOn: today(), createdByName: user.name } });
    await tx.operationalException.updateMany({ where: { dealId: c!.dealId, kind: "CUSTOMER_CLAIM", status: "OPEN", evidence: `Caso ${c!.code}` }, data: { status: "RESOLVED", resolution: `Caso ${c!.code} cerrado: ${resolution}`.slice(0, 400), resolvedAt: new Date(), resolvedByName: user.name } });
  });
  back(c!.dealId, `ok=${cost != null && !toLedger ? "cerrado-final" : "cerrado"}#c-${claimId}`);
}
