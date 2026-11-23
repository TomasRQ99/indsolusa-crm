"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { getDelayTags } from "@/lib/delay";
import { DELAY_TAGS_KEY, MAX_DELAY_TAGS, cleanDelayTags } from "@/lib/delay-rules";

// Causas de retraso: the list people pick from when a delivery is late. Gerencia, Dirección Comercial and
// Administración change it; every change is a new version (the earlier ones stay in the change history).

const go = (qs: string): never => { refreshApp(); redirect(`/administracion/causas-retraso?${qs}`); };

export async function saveDelayTags(fd: FormData) {
  const user = await requireUser();
  if (!canManageAll(user) && user.role !== "ADMINISTRACION") go("err=permiso");
  const rows: Record<string, unknown>[] = [];
  for (let n = 0; n < MAX_DELAY_TAGS + 1; n++) {
    if (!fd.has(`label_${n}`)) continue;
    if (fd.get(`remove_${n}`) === "1") continue;
    rows.push({ key: fd.get(`key_${n}`), label: fd.get(`label_${n}`), cause: fd.get(`cause_${n}`), explainEs: fd.get(`explainEs_${n}`), explainEn: fd.get(`explainEn_${n}`), solutionEs: fd.get(`solutionEs_${n}`), solutionEn: fd.get(`solutionEn_${n}`), active: fd.get(`active_${n}`) === "1" });
  }
  const value = cleanDelayTags(rows);
  if (!value.some((x) => x.active)) go("err=vacia");
  const cur = await getDelayTags();
  if (JSON.stringify(cur.value) === JSON.stringify(value) && cur.version > 0) go("ok=igual");
  await db.marketSetting.create({ data: { key: DELAY_TAGS_KEY, version: cur.version + 1, value: value as unknown as Prisma.InputJsonValue, updatedByName: user.name } });
  go("ok=guardada");
}
