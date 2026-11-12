"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll, canProspect } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { clueEnough, probeApollo, revealByClue, revealPerson } from "@/lib/apollo";

// Explorar prospectos (Apollo). Revealing costs credits, so it is always one person, by one click, by a named user.

/** Back to the same search the person was looking at. Only an in-app path is accepted. */
const backTo = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/mercado/prospectos") ? s : "/mercado/prospectos";
};
const withParam = (url: string, key: string, value: string) => {
  const [path, query = ""] = url.split("?");
  const p = new URLSearchParams(query);
  for (const k of ["ok", "err"]) p.delete(k);
  p.set(key, value);
  return `${path}?${p}`;
};

export async function reveal(formData: FormData) {
  const user = await requireUser();
  const back = backTo(formData.get("back"));
  if (!canProspect(user)) redirect(withParam(back, "err", "permiso"));
  const apolloId = String(formData.get("apolloId") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(apolloId)) redirect(withParam(back, "err", "notfound"));
  const r = await revealPerson(apolloId, String(formData.get("foundWith") ?? ""), user);
  refreshApp();
  if (!r.ok) redirect(withParam(back, "err", r.error));
  redirect(withParam(back, "ok", r.fresh ? "revelado" : "yaestaba") + `#p-${r.prospectId}`);
}

/** Reveal someone the person already found elsewhere: by LinkedIn profile, or by name and company. */
export async function revealClue(formData: FormData) {
  const user = await requireUser();
  const back = backTo(formData.get("back"));
  if (!canProspect(user)) redirect(withParam(back, "err", "permiso"));
  const s = (k: string) => String(formData.get(k) ?? "").trim().slice(0, 200);
  const clue = { linkedinUrl: s("linkedin"), firstName: s("nombre"), lastName: s("apellido"), org: s("empresa"), domain: s("web") };
  if (!clueEnough(clue)) redirect(withParam(back, "err", "pista"));
  const r = await revealByClue(clue, user);
  refreshApp();
  if (!r.ok) redirect(withParam(back, "err", r.error));
  redirect(withParam(back, "ok", r.fresh ? "revelado" : "yaestaba") + `#p-${r.prospectId}`);
}

/** Free check of what this Apollo account allows. Managers only: it is about the account, not about a person. */
export async function probe(formData: FormData) {
  const user = await requireUser();
  const back = backTo(formData.get("back"));
  if (!canManageAll(user)) redirect(withParam(back, "err", "permiso"));
  const r = await probeApollo(user.name);
  redirect(withParam(withParam(back, "prueba", `${r.search},${r.reveal}`), "dijo", r.said.slice(0, 200)) + "#conexion");
}

/** Pass a revealed person to Mercado: the company becomes (or is matched to) a customer record, the person a contact. */
export async function addToMarket(prospectId: string, formData: FormData) {
  const user = await requireUser();
  const back = backTo(formData.get("back"));
  if (!canProspect(user)) redirect(withParam(back, "err", "permiso"));
  const p = await db.prospect.findUnique({ where: { id: prospectId } });
  if (!p) redirect(withParam(back, "err", "notfound"));
  if (p.contactId) redirect(withParam(back, "ok", "yapasado") + `#p-${p.id}`);

  // Reuse before creating: the same person (by email) or the same company (by web domain, then by exact name).
  const sameContact = p.email ? await db.contact.findFirst({ where: { email: { equals: p.email, mode: "insensitive" } }, select: { id: true, accountId: true } }) : null;
  let accountId = sameContact?.accountId ?? null;
  if (!accountId && p.orgDomain) accountId = (await db.account.findFirst({ where: { internal: false, website: { contains: p.orgDomain, mode: "insensitive" } }, select: { id: true } }))?.id ?? null;
  if (!accountId && p.orgName) accountId = (await db.account.findFirst({ where: { internal: false, name: { equals: p.orgName, mode: "insensitive" } }, select: { id: true } }))?.id ?? null;

  const out = await db.$transaction(async (tx) => {
    if (!accountId && p.orgName) {
      accountId = (await tx.account.create({ data: { name: p.orgName, industry: p.orgIndustry, website: p.orgWebsite ?? (p.orgDomain ? `https://${p.orgDomain}` : null), ownerId: user.id }, select: { id: true } })).id;
    }
    const contactId = sameContact?.id ?? (await tx.contact.create({ data: { firstName: p.firstName, lastName: p.lastName || "—", email: p.email, title: p.title, accountId }, select: { id: true } })).id;
    await tx.prospect.update({ where: { id: p.id }, data: { status: "ADDED", contactId, accountId } });
    return { contactId, reused: !!sameContact };
  });
  refreshApp();
  redirect(withParam(back, "ok", out.reused ? "yaexistia" : "pasado") + `#p-${p.id}`);
}

export async function setProspectStatus(prospectId: string, formData: FormData) {
  const user = await requireUser();
  const back = backTo(formData.get("back"));
  if (!canProspect(user)) redirect(withParam(back, "err", "permiso"));
  const to = formData.get("to") === "NEW" ? "NEW" : "DISMISSED";
  const p = await db.prospect.findUnique({ where: { id: prospectId }, select: { contactId: true } });
  if (p && !p.contactId) await db.prospect.update({ where: { id: prospectId }, data: { status: to } });
  refreshApp();
  redirect(back);
}
