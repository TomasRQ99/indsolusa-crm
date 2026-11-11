"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { ELIGIBILITY, REVIEW } from "@/lib/experience-rules";

// Operaciones O10 · product experience base (module 11 §36–37). Anyone on the team can write down what was learned;
// only management or Mercadeo tick the confidentiality review. Nothing here is ever published by SOLU.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const go = (qs: string): never => { refreshApp(); redirect(`/operaciones/experiencias?${qs}`); };

export async function saveExperience(id: string | null, fd: FormData) {
  const user = await requireUser();
  const title = txt(fd, "title", 160);
  const summary = txt(fd, "summary", 1200);
  const eligibility = String(fd.get("eligibility") ?? "INTERNAL_ONLY");
  if (!title || !summary || !ELIGIBILITY[eligibility]) go(`err=datos${id ? `#e-${id}` : ""}`);
  const code = String(fd.get("dealCode") ?? "").trim().toUpperCase();
  const deal = code ? await db.deal.findFirst({ where: { code, internal: false }, select: { id: true } }) : null;
  if (code && !deal) go(`err=journey${id ? `#e-${id}` : ""}`);
  const data = { title: title!, summary: summary!, code: txt(fd, "code", 80), manufacturer: txt(fd, "manufacturer", 120), application: txt(fd, "application", 200), industry: txt(fd, "industry", 120), eligibility, customerApproval: txt(fd, "customerApproval", 200), draft: txt(fd, "draft", 3000), dealId: deal?.id ?? null, updatedByName: user.name };
  if (id) {
    const cur = await db.productExperience.findUnique({ where: { id }, select: { draft: true, eligibility: true } });
    // The review was given for a specific text: if the public text or its eligibility changes, it is reviewed again.
    const reset = cur && (cur.draft ?? "") !== (data.draft ?? "") || cur?.eligibility !== eligibility;
    await db.productExperience.update({ where: { id }, data: { ...data, ...(reset ? { checks: {} } : {}) } });
    go(`ok=${reset ? "guardada-revisar" : "guardada"}#e-${id}`);
  }
  const e = await db.productExperience.create({ data: { ...data, createdByName: user.name } });
  go(`ok=creada#e-${e.id}`);
}

export async function toggleReview(id: string, key: string) {
  const user = await requireUser();
  if (!(canManageAll(user) || user.role === "MARKETING")) go(`err=permiso#e-${id}`);
  const e = await db.productExperience.findUnique({ where: { id }, select: { checks: true, eligibility: true } });
  if (!e || !REVIEW[key] || e.eligibility === "INTERNAL_ONLY") go(`err=revision#e-${id}`);
  const checks = { ...((e!.checks ?? {}) as Record<string, { by: string; at: string }>) };
  if (checks[key]) delete checks[key]; else checks[key] = { by: user.name, at: new Date().toISOString() };
  await db.productExperience.update({ where: { id }, data: { checks } });
  go(`ok=revision#e-${id}`);
}
