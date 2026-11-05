"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";
import { normCode } from "@/lib/x360";

const txt = (fd: FormData, k: string, max = 500) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const KINDS = ["ALIAS", "PACKING", "COMPAT_OK", "COMPAT_NO", "SPEC"];

/** Record an observed fact about a product (alias, packing, compatibility, spec) with its source. */
export async function addProductFact(code: string, fd: FormData) {
  const user = await requireUser();
  const kind = String(fd.get("kind"));
  const text = txt(fd, "text");
  const c = normCode(code);
  if (!KINDS.includes(kind) || !text) redirect(`/productos/${encodeURIComponent(c)}?err=dato`);
  await db.productFact.create({ data: { code: c, kind, text: text!, source: txt(fd, "source", 200), observedAt: dayOf(fd.get("observedAt")) ?? today(), recordedByName: user.name } });
  refreshApp();
  redirect(`/productos/${encodeURIComponent(c)}?ok=hecho`);
}

/** Create a Need (a new Journey at LEAD) from a 360 context, keeping where it came from. */
export async function createNeedFromContext(fd: FormData) {
  const user = await requireUser();
  const accountId = txt(fd, "accountId", 40);
  const title = txt(fd, "title", 200);
  const back = txt(fd, "back", 300) ?? "/accounts";
  if (!accountId || !title) redirect(`${back}${back.includes("?") ? "&" : "?"}err=need`);
  const context = txt(fd, "context", 200);
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId! }, select: { id: true } });
  const deal = await db.$transaction(async (tx) => {
    const code = await nextCode("J", "deal", tx);
    return tx.deal.create({ data: { code, title: title!, accountId: account.id, ownerId: user.id, stage: "LEAD", needSpecs: txt(fd, "needSpecs", 1000), sourcingNote: txt(fd, "sourcingNote", 500) } });
  });
  await db.activity.create({ data: { type: "NOTE", subject: `Necesidad creada desde ${context ?? "360"}`.slice(0, 200), userId: user.id, accountId: account.id, dealId: deal.id, phase: "need", source: context } });
  refreshApp();
  redirect(`/deals/${deal.id}?tab=need`);
}
