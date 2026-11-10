"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";

// Comercial C6 · v1.3 §58 Dispatch Instruction. Commercial states the customer obligation (what, where, when, with
// which documents); Operations executes it. An issued version is never edited: a change issues the next version.

const go = (dealId: string, qs: string): never => { refreshApp(); redirect(`/deals/${dealId}/despacho?${qs}`); };
const txt = (fd: FormData, k: string, max = 400) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null; };

export async function issueDispatch(dealId: string, fd: FormData) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { id: true, ownerId: true, accountId: true } });
  if (!canEdit(user, deal.ownerId)) go(dealId, "err=permiso");
  const poId = txt(fd, "poId", 40);
  const po = poId ? await db.customerPO.findFirst({ where: { id: poId, OR: [{ dealId }, { allocations: { some: { dealId } } }] }, select: { id: true, number: true, acceptance: { select: { id: true } } } }) : null;
  // A dispatch instruction exists only for an accepted customer commitment (never from a verbal yes, AC16).
  if (!po || !po.acceptance) go(dealId, "err=sin-po");
  const n = Number(fd.get("lines") ?? 0);
  const items = Array.from({ length: Math.min(n, 60) }, (_, k) => ({ code: txt(fd, `code_${k}`, 60), description: txt(fd, `desc_${k}`, 300) ?? "", qty: Math.max(0, Math.round(Number(fd.get(`qty_${k}`) ?? 0) || 0)) })).filter((x) => x.qty > 0 && x.description);
  const destination = txt(fd, "destination", 400);
  if (!items.length || !destination) go(dealId, "err=campos");
  const windowFrom = dayOf(fd, "windowFrom");
  const windowTo = dayOf(fd, "windowTo");
  if (windowFrom && windowTo && windowTo < windowFrom) go(dealId, "err=ventana");
  const current = await db.dispatchInstruction.findFirst({ where: { dealId, poId: po!.id, supersededAt: null }, select: { id: true, version: true } });
  const changeReason = txt(fd, "changeReason", 300);
  if (current && !changeReason) go(dealId, `err=motivo&po=${po!.id}`);
  await db.$transaction(async (tx) => {
    if (current) await tx.dispatchInstruction.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
    await tx.dispatchInstruction.create({ data: {
      dealId, poId: po!.id, version: (current?.version ?? 0) + 1, items: items as Prisma.InputJsonValue, destination: destination!,
      contactName: txt(fd, "contactName", 120), contactPhone: txt(fd, "contactPhone", 60), windowFrom, windowTo, promiseDate: dayOf(fd, "promiseDate"),
      documents: txt(fd, "documents"), entryRequirement: txt(fd, "entryRequirement"), restrictions: txt(fd, "restrictions"), changeReason, issuedByName: user.name,
    } });
    await tx.activity.create({ data: { type: "NOTE", subject: `Instrucción de despacho v${(current?.version ?? 0) + 1} para la PO ${po!.number}${changeReason ? ` · ${changeReason}` : ""}`.slice(0, 200), userId: user.id, accountId: deal.accountId, dealId, phase: "execute", source: "Comercial → Operaciones" } });
  });
  go(dealId, `ok=emitida&po=${po!.id}`);
}
