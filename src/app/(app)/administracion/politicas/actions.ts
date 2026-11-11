"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fText } from "@/lib/fd";
import { ADMIN_POLICY_KEY, cleanAdminPolicy } from "@/lib/admin-rules";
import { getAdminPolicy } from "@/lib/admin-store";

// Módulo 14 §2L · the Administración policy. Gerencia changes it; every change is a new version with its reason,
// in force from the moment it is saved. Earlier decisions keep the version they were made with (AC9, AC15).

const go = (qs: string): never => { refreshApp(); redirect(`/administracion/politicas?${qs}#admin`); };

export async function saveAdminPolicy(fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=gerencia");
  const value = cleanAdminPolicy(Object.fromEntries(fd.entries()));
  const reason = fText(fd, "reason", 300);
  if (!value) go("err=valores");
  if (!reason) go("err=motivo");
  const cur = await getAdminPolicy();
  if (cur.version > 0 && JSON.stringify(cur.value) === JSON.stringify(value)) go("ok=igual");
  await db.marketSetting.create({ data: { key: ADMIN_POLICY_KEY, version: cur.version + 1, value: value as unknown as Prisma.InputJsonValue, updatedByName: user.name, reason } });
  go("ok=guardada");
}
