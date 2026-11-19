// A reminder for whoever carries a Need: its costs or its Eságara changed on the Need while a quote was already
// open as a draft, and a draft does not follow the Need by itself (owner, 2026-11-19: "crea una notificación para
// recordar al agente"). It is an ordinary pending task: it shows in Mi Día → Pendientes and on the Need, and it
// closes by itself when the costs of that quote are saved.

import { db } from "./db";
import { today } from "./domain";

const PREFIX = { ES: "Ajustar la cotización", EN: "Adjust quote" } as const;
const titleOf = (lang: "ES" | "EN", number: string) =>
  lang === "EN"
    ? `${PREFIX.EN} ${number}: the Eságara or the costs changed on the Need`
    : `${PREFIX.ES} ${number}: la Eságara o los costos cambiaron en la Necesidad`;
const mine = (dealId: string) => ({ dealId, status: "OPEN" as const, OR: [{ title: { startsWith: `${PREFIX.ES} ` } }, { title: { startsWith: `${PREFIX.EN} ` } }] });

/** The Need changed: if it has a draft quote, leave the reminder (once). Returns that quote, or null. */
export async function remindQuoteAdjust(dealId: string, lang: "ES" | "EN") {
  const q = await db.quote.findFirst({ where: { dealId, status: "DRAFT" }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, deal: { select: { ownerId: true, accountId: true } } } });
  if (!q) return null;
  const open = await db.task.findFirst({ where: mine(dealId), select: { id: true } });
  if (!open) await db.task.create({ data: { title: titleOf(lang, q.number), dueDate: today(), assigneeId: q.deal.ownerId, accountId: q.deal.accountId, dealId, estimateMinutes: 5 } });
  return { id: q.id, number: q.number };
}

/** The open reminder of a Need with the draft quote it points to (for the notice on the Need). */
export async function quoteAdjustPending(dealId: string) {
  const task = await db.task.findFirst({ where: mine(dealId), select: { id: true } });
  if (!task) return null;
  return db.quote.findFirst({ where: { dealId, status: "DRAFT" }, orderBy: { createdAt: "desc" }, select: { id: true, number: true } });
}

/** The quote's costs were saved (or it stopped being a draft): the reminder is done. */
export async function clearQuoteAdjust(dealId: string) {
  await db.task.updateMany({ where: mine(dealId), data: { status: "DONE", completedAt: new Date() } });
}
