"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { getFocusPolicy } from "@/lib/focus";
import { FOCUS_POLICY_KEY, validCloseTime } from "@/lib/focus-rules";

// Comercial C8c · focus policy (materiality, no-movement days, decisions horizon, daily close time). Versioned.
const go = (qs: string): never => { refreshApp(); redirect(`/comercial/foco?${qs}#politica`); };

export async function saveFocusPolicy(fd: FormData) {
  const user = await requireUser();
  if (!canManageAll(user)) go("err=permiso");
  const n = (k: string, min: number, max: number) => { const v = Number(fd.get(k)); return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null; };
  const closeTime = String(fd.get("closeTime") ?? "").trim();
  const value = { materialEsagaraUsd: n("materialEsagaraUsd", 0, 1e7), staleDays: n("staleDays", 1, 90), decisionsDays: n("decisionsDays", 1, 90), closeTime };
  if (value.materialEsagaraUsd == null || value.staleDays == null || value.decisionsDays == null || !validCloseTime(closeTime)) go("err=valor");
  const cur = await getFocusPolicy();
  if (JSON.stringify(cur.value) === JSON.stringify(value)) go("ok=igual");
  await db.marketSetting.create({ data: { key: FOCUS_POLICY_KEY, version: cur.version + 1, value, updatedByName: user.name } });
  go("ok=guardada");
}
