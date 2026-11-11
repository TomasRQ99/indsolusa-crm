"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditOps, isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { TRM_SOURCE, trmFor } from "@/lib/fx";
import { AUTH_POLICY_KEY, LEVELS, authStep, cleanAuthPolicy, type Level } from "@/lib/auth-levels";
import { getAuthPolicy } from "@/lib/auth-levels-store";

// Authorisation by level. Gerencia changes the ranges (each change is a new version) and sets each person's level.
// On a Journey, whoever runs it records who authorised it; SOLU says which step the amount needs.

const cfg = (qs: string): never => { refreshApp(); redirect(`/profile/autorizaciones?${qs}`); };

export async function saveAuthPolicy(fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) cfg("err=permiso");
  const value = cleanAuthPolicy(Object.fromEntries(fd.entries()));
  if (!value) cfg("err=valores");
  const cur = await getAuthPolicy();
  if (JSON.stringify(cur.value) === JSON.stringify(value)) cfg("ok=igual");
  await db.marketSetting.create({ data: { key: AUTH_POLICY_KEY, version: cur.version + 1, value: value as unknown as Prisma.InputJsonValue, updatedByName: user.name } });
  cfg("ok=rangos");
}

export async function setUserLevel(userId: string, fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) cfg("err=permiso#personas");
  const lv = String(fd.get("authLevel") ?? "");
  await db.user.update({ where: { id: userId }, data: { authLevel: LEVELS[lv as Level] ? lv : null } });
  cfg("ok=nivel#personas");
}

/** Record who authorised this Journey. The amount, the rate and the step are frozen as they were that day. */
export async function recordAuthorization(dealId: string, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`/deals/${dealId}/autorizacion?${qs}`); };
  const d = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true, amount: true, owner: { select: { authLevel: true } }, quotes: { where: { status: { in: ["ACCEPTED", "PRESENTED"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { protSale: true } } } });
  if (!(canEditOps(user, d.ownerId) || isGerencia(user))) back("err=permiso");
  const level = d.owner.authLevel as Level | null;
  if (!level || !LEVELS[level]) back("err=nivel");
  const usd = d.quotes[0]?.protSale != null ? Number(d.quotes[0].protSale) : Number(d.amount);
  if (!(usd > 0)) back("err=valor");
  const typed = Number(String(fd.get("trm") ?? "").trim().replace(/\./g, "").replace(",", "."));
  const official = await trmFor(today().toISOString().slice(0, 10)).catch(() => null);
  // The official rate of the day when SOLU can read it; otherwise the one the person types, marked as typed.
  const trm = official?.rate ?? (Number.isFinite(typed) && typed >= 500 && typed <= 20000 ? typed : null);
  if (trm == null) back("err=trm");
  const by = String(fd.get("authorizedBy") ?? "").trim().slice(0, 200);
  if (!by) back("err=quien");
  const pol = await getAuthPolicy();
  const cop = money2(usd * trm!);
  const r = authStep(level!, cop, pol.value);
  const mentor = String(fd.get("mentorInformed") ?? "").trim().slice(0, 120) || null;
  // The two "mentor informed" steps are not complete without saying which mentor was told.
  if ((r.step === "PEER" || r.step === "SENIOR_PEER") && !mentor) back("err=mentor");
  await db.dealAuthorization.create({ data: { dealId, amountUsd: money2(usd), amountCop: cop, trm: trm!, trmSource: official ? TRM_SOURCE : "Escrita a mano", level: level!, step: r.step, authorizedBy: by, mentorInformed: mentor, partnersNote: String(fd.get("partnersNote") ?? "").trim().slice(0, 300) || null, note: String(fd.get("note") ?? "").trim().slice(0, 300) || null, policyVersion: pol.version, recordedByName: user.name } });
  back("ok=registrada");
}
