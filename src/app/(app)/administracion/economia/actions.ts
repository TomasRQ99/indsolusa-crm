"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { ESAGARA_POLICY_KEY, cleanEsagaraPolicy } from "@/lib/economics-rules";
import { getEsagaraPolicy } from "@/lib/economics";

// Módulo 12 R0 · Eságara policy (§3, §33): which direct costs count and the closure materiality. Versioned: a change
// is a new version, and economics already closed as final keep the figures of their day (never recalculated).

export async function saveEsagaraPolicy(fd: FormData) {
  const user = await requireUser();
  const go = (qs: string): never => { refreshApp(); redirect(`/administracion/economia?${qs}#politica`); };
  if (!isGerencia(user)) go("err=permiso");
  const value = cleanEsagaraPolicy(Object.fromEntries(fd.entries()));
  if (!value) go("err=politica");
  const cur = await getEsagaraPolicy();
  if (JSON.stringify(cur.value) !== JSON.stringify(value)) await db.marketSetting.create({ data: { key: ESAGARA_POLICY_KEY, version: cur.version + 1, value: value as unknown as Prisma.InputJsonValue, updatedByName: user.name } });
  go("ok=politica");
}
