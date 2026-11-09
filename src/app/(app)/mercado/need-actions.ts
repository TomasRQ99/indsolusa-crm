"use server";

// Mercado M6 · confirming (or setting aside) a suggested Need. Confirming creates the Journey with inherited context.
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { createNeedJourney } from "@/lib/need-handoff";

const txt = (fd: FormData, k: string, max = 500) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (v: FormDataEntryValue | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${String(v)}T00:00:00Z`) : null);
const id = (fd: FormData, k: string) => { const v = txt(fd, k, 40); return v && /^[a-z0-9]+$/i.test(v) ? v : null; };
const backOf = (fd: FormData) => { const b = txt(fd, "back", 300) ?? "/mercado"; return b.startsWith("/") && !b.startsWith("//") ? b : "/mercado"; };
const withQs = (back: string, qs: string) => { const [p, h] = back.split("#"); return `${p}${p.includes("?") ? "&" : "?"}${qs}${h ? `#${h}` : "#necesidad"}`; };

export async function confirmNeed(fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd);
  const accountId = id(fd, "accountId");
  const title = txt(fd, "title", 200);
  if (!accountId || !title) { refreshApp(); redirect(withQs(back, "err=need")); }
  // A Need goes to someone who will work it commercially (Marketing explores; it doesn't own Journeys).
  const ownerId = id(fd, "ownerId") ?? user.id;
  const owner = await db.user.findFirst({ where: { id: ownerId, active: true, role: { not: "MARKETING" } }, select: { id: true } });
  if (!owner) { refreshApp(); redirect(withQs(back, "err=owner")); }
  const ref = txt(fd, "originRef", 60);
  let dealId: string;
  try {
    const d = await createNeedJourney({
      accountId: accountId!, title: title!, desiredResult: txt(fd, "desiredResult", 300), impactIfNot: txt(fd, "impactIfNot", 400), neededBy: dayOf(fd.get("neededBy")),
      nextMove: txt(fd, "nextMove", 200), nextMoveDate: dayOf(fd.get("nextMoveDate")), contactId: id(fd, "contactId"), plantId: id(fd, "plantId"), explorationId: id(fd, "explorationId"),
      originRef: ref && /^(note|future):[a-z0-9]+$/i.test(ref) ? ref : null, evidence: txt(fd, "evidence", 600), ownerId: owner!.id,
    }, { id: user.id, name: user.name });
    dealId = d.id;
  } catch (e) {
    refreshApp();
    redirect(withQs(back, (e as Error).message === "ALREADY" ? "err=ya" : "err=need"));
  }
  refreshApp();
  redirect(`/deals/${dealId!}?tab=need&ok=mercado`);
}

/** "No es una necesidad": SOLU stops suggesting it. The evidence itself stays where it was recorded. */
export async function dismissNeed(fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd);
  const ref = txt(fd, "originRef", 60);
  const accountId = id(fd, "accountId");
  if (ref && accountId && /^(note|future):[a-z0-9]+$/i.test(ref)) await db.needDismissal.upsert({ where: { ref }, create: { ref, accountId, note: txt(fd, "note", 300), byName: user.name }, update: {} });
  refreshApp();
  redirect(withQs(back, "ok=descartada"));
}
