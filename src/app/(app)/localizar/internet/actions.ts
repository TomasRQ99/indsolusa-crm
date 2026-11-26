"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { aiGate } from "@/lib/ai";
import { launchHunt, type HuntAnswers } from "@/lib/web-hunt";

const txt = (fd: FormData, k: string, max = 300) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};

/** Starts a search of the internet for a piece. The page that follows shows "searching…" until it is done. */
export async function startHunt(fd: FormData) {
  const user = await requireUser();
  const q = txt(fd, "q", 200);
  const dealId = txt(fd, "deal", 40), partId = txt(fd, "part", 40);
  const back = `/localizar?${new URLSearchParams({ ...(q ? { q } : {}), ...(dealId ? { deal: dealId } : {}) })}`;
  if (!q || q.replace(/\s/g, "").length < 3) redirect(`${back}${back.includes("=") ? "&" : ""}err=internet-corto#internet`);
  const gate = await aiGate();
  if (!gate.ok) redirect(`${back}&err=internet-${gate.reason === "OFF" ? "apagada" : "tope"}#internet`);
  // The answers to the questions the last search left open travel as extra details.
  const extra = [...fd.entries()].filter(([k, v]) => k.startsWith("qa_") && String(v).trim()).map(([k, v]) => `${String(fd.get(`qq_${k.slice(3)}`) ?? "").trim().slice(0, 200)} ${String(v).trim().slice(0, 200)}`.trim());
  const details = [txt(fd, "details", 600), ...extra].filter(Boolean).join(" · ").slice(0, 900);
  const answers: HuntAnswers = {
    brand: txt(fd, "brand", 80) ?? undefined, qty: txt(fd, "qty", 20) ?? undefined, country: txt(fd, "country", 60) ?? undefined,
    condition: fd.get("condition") === "ANY" ? "ANY" : "NEW", equivalents: fd.get("equivalents") === "1", details: details || undefined,
  };
  // A double click, or going back and pressing again, must not pay for the same search twice.
  const same = await db.webHunt.findFirst({ where: { userId: user.id, query: q!, status: "RUNNING", createdAt: { gt: new Date(Date.now() - 3 * 60_000) } }, select: { id: true } });
  if (same) redirect(`/localizar/internet/${same.id}`);
  const [deal, part] = await Promise.all([
    dealId ? db.deal.findUnique({ where: { id: dealId }, select: { id: true } }) : null,
    partId ? db.part.findUnique({ where: { id: partId }, select: { id: true } }) : null,
  ]);
  const hunt = await db.webHunt.create({ data: { query: q!, answers, lang: user.lang === "EN" ? "EN" : "ES", dealId: deal?.id ?? null, partId: part?.id ?? null, userId: user.id, userName: user.name } });
  launchHunt(hunt.id);
  redirect(`/localizar/internet/${hunt.id}`);
}

const leadLine = (l: { seller: string; country: string | null; url: string; price: unknown; currency: string | null; email: string | null; phone: string | null; contactUrl: string | null }) =>
  [`${l.seller}${l.country ? ` (${l.country})` : ""}`, l.url, l.price != null ? `precio visto ${l.currency ?? ""} ${Number(l.price).toFixed(2)} (referencia de internet, sin confirmar)`.replace("  ", " ") : null, l.email, l.phone, !l.email && !l.phone ? l.contactUrl : null].filter(Boolean).join(" · ");

/** Turns a saved option into the Need's source: the seller becomes a supplier on file (or the one already there is
 *  reused) and the Need's "Fuente" says who it is and where it was found. No cost is written: a price seen on a web
 *  page is a reference, not an offer. */
async function makeSource(leadId: string, userId: string, userName: string) {
  const l = await db.webLead.findUniqueOrThrow({ where: { id: leadId }, include: { deal: { select: { id: true, accountId: true, sourcingNote: true } } } });
  if (!l.deal) return null;
  const origin = (() => { try { return new URL(l.url).origin; } catch { return null; } })();
  const found = l.supplierId ? await db.supplier.findUnique({ where: { id: l.supplierId } }) : null;
  const existing = found
    ?? (await db.supplier.findFirst({ where: { website: { contains: l.host, mode: "insensitive" } } }))
    ?? (await db.supplier.findFirst({ where: { name: { equals: l.seller, mode: "insensitive" } } }));
  const supplier = existing
    // A supplier already on file keeps its data; only what was empty is filled.
    ? await db.supplier.update({ where: { id: existing.id }, data: { email: existing.email ?? l.email, phone: existing.phone ?? l.phone, website: existing.website ?? origin, country: existing.country ?? l.country } })
    : await db.supplier.create({ data: { name: l.seller, country: l.country, email: l.email, phone: l.phone, website: origin, currency: l.currency ?? "USD" } });
  const line = `Fuente (internet): ${leadLine(l)}`;
  const note = l.deal.sourcingNote?.includes(l.url) ? l.deal.sourcingNote : [l.deal.sourcingNote, line].filter(Boolean).join("\n").slice(0, 2000);
  await db.$transaction([
    db.deal.update({ where: { id: l.deal.id }, data: { sourcingNote: note, locatedSupplierId: supplier.id } }),
    db.webLead.update({ where: { id: l.id }, data: { supplierId: supplier.id, sourceAt: new Date() } }),
    db.activity.create({ data: { type: "NOTE", subject: `Fuente elegida desde internet: ${l.seller}${existing ? "" : " (proveedor nuevo creado)"} · ${userName}`.slice(0, 200), userId, accountId: l.deal.accountId, dealId: l.deal.id, phase: "source", source: "Búsqueda en internet" } }),
  ]);
  return l.deal.id;
}

/** Saves one found seller on a Need. With intent "source" it also becomes that Need's source. */
export async function saveLead(leadId: string, fd: FormData) {
  const user = await requireUser();
  const lead = await db.webLead.findUniqueOrThrow({ where: { id: leadId }, select: { id: true, huntId: true, seller: true, url: true, dealId: true } });
  const here = `/localizar/internet/${lead.huntId}`;
  const dealId = txt(fd, "dealId", 40);
  if (!dealId) redirect(`${here}?err=necesidad&l=${lead.id}#l-${lead.id}`);
  const deal = await db.deal.findUnique({ where: { id: dealId! }, select: { id: true, ownerId: true, accountId: true, code: true } });
  if (!deal || !canEdit(user, deal.ownerId)) redirect(`${here}?err=permiso&l=${lead.id}#l-${lead.id}`);
  if (lead.dealId !== deal!.id) {
    await db.$transaction([
      db.webLead.update({ where: { id: lead.id }, data: { dealId: deal!.id, savedByName: user.name, savedAt: new Date(), supplierId: null, sourceAt: null } }),
      db.activity.create({ data: { type: "NOTE", subject: `Opción de internet guardada: ${lead.seller} · ${lead.url}`.slice(0, 200), userId: user.id, accountId: deal!.accountId, dealId: deal!.id, phase: "source", source: "Búsqueda en internet" } }),
    ]);
  }
  if (fd.get("intent") === "source") {
    await makeSource(lead.id, user.id, user.name);
    refreshApp();
    redirect(`/deals/${deal!.id}?tab=source&ok=fuente-internet#internet`);
  }
  refreshApp();
  redirect(`${here}?ok=guardada&l=${lead.id}#l-${lead.id}`);
}

/** From the Need: go ahead with a saved option (it becomes the source). */
export async function leadAsSource(leadId: string) {
  const user = await requireUser();
  const lead = await db.webLead.findUniqueOrThrow({ where: { id: leadId }, select: { id: true, huntId: true, deal: { select: { id: true, ownerId: true } } } });
  if (!lead.deal) redirect(`/localizar/internet/${lead.huntId}`);
  if (!canEdit(user, lead.deal!.ownerId)) redirect(`/deals/${lead.deal!.id}?tab=source&err=permiso-internet#internet`);
  await makeSource(lead.id, user.id, user.name);
  refreshApp();
  redirect(`/deals/${lead.deal!.id}?tab=source&ok=fuente-internet#internet`);
}

/** From the Need: take a saved option off it (the search result itself is kept). */
export async function unsaveLead(leadId: string, fd: FormData) {
  const user = await requireUser();
  const lead = await db.webLead.findUniqueOrThrow({ where: { id: leadId }, select: { id: true, huntId: true, deal: { select: { id: true, ownerId: true } } } });
  if (!lead.deal) redirect(`/localizar/internet/${lead.huntId}`);
  const tab = fd.get("tab") === "locate" ? "locate" : "source";
  if (!canEdit(user, lead.deal!.ownerId)) redirect(`/deals/${lead.deal!.id}?tab=${tab}&err=permiso-internet#internet`);
  await db.webLead.update({ where: { id: lead.id }, data: { dealId: null, savedByName: null, savedAt: null, supplierId: null, sourceAt: null } });
  refreshApp();
  redirect(`/deals/${lead.deal!.id}?tab=${tab}&ok=internet-quitada#internet`);
}
