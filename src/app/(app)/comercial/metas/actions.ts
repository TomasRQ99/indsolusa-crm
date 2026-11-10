"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { money2, sameMoney } from "@/lib/money";
import { METRIC_KEYS, isClosed, validPeriod } from "@/lib/goal-rules";

// Comercial C7 · Gerencia / Director Comercial set a person's monthly targets (decision C-15). Each change supersedes
// the current row and keeps it as history; a closed month never changes (AC5).

const go = (u: string, p: string, qs: string): never => { refreshApp(); redirect(`/comercial/metas?u=${u}&p=${p}&${qs}`); };

export async function saveTargets(userId: string, period: string, fd: FormData) {
  const user = await requireUser();
  const p = validPeriod(period) ? period : "";
  if (!canManageAll(user)) go(userId, p, "err=permiso");
  if (!p) go(userId, period, "err=periodo");
  if (isClosed(p, new Date())) go(userId, p, "err=cerrado");
  const person = await db.user.findUnique({ where: { id: userId }, select: { id: true, active: true } });
  if (!person?.active) go(userId, p, "err=persona");
  const rationale = String(fd.get("rationale") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 500) || null;
  const current = await db.goalTarget.findMany({ where: { userId, period: p, supersededAt: null } });
  const changes: { metric: string; target: number | null; prev: (typeof current)[number] | null }[] = [];
  for (const metric of METRIC_KEYS) {
    const raw = String(fd.get(metric) ?? "").trim();
    const n = raw === "" ? null : Number(raw);
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 1e9)) go(userId, p, "err=valor");
    const target = n == null || n === 0 ? null : money2(n);
    const prev = current.find((c) => c.metric === metric) ?? null;
    if (target == null && !prev) continue;
    if (prev && target != null && sameMoney(prev.target, target)) continue;
    changes.push({ metric, target, prev });
  }
  if (!changes.length) go(userId, p, "ok=sin-cambios");
  // Changing a target someone already works against needs a reason they can read.
  if (changes.some((c) => c.prev) && !rationale) go(userId, p, "err=motivo");
  await db.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.prev) await tx.goalTarget.update({ where: { id: c.prev.id }, data: { supersededAt: new Date() } });
      if (c.target != null) await tx.goalTarget.create({ data: { userId, metric: c.metric, period: p, target: c.target, rationale, setByName: user.name, version: (c.prev?.version ?? 0) + 1 } });
    }
  });
  go(userId, p, "ok=guardado");
}
