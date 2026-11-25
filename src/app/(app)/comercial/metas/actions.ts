"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll, canOrganizeGoals } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { money2, sameMoney } from "@/lib/money";
import { METRIC_KEYS, isClosed, validPeriod } from "@/lib/goal-rules";
import { RATIO_MAX, RECIPE_DEFAULTS } from "@/lib/goal-recipe";
import { BAT_KEYS, BAT_ROWS } from "@/lib/batting";

// Comercial C7 · Gerencia / Director Comercial set a person's monthly targets (decision C-15). Each change supersedes
// the current row and keeps it as history; a closed month never changes (AC5).

const go = (u: string, p: string, qs: string): never => { refreshApp(); redirect(`/comercial/metas?u=${u}&p=${p}&${qs}`); };

/** Recetario mensual: the person writes their own recipe (or a manager for them). Editing replaces the month's row. */
export async function saveRecipe(userId: string, period: string, fd: FormData) {
  return writeRecipe(userId, period, fd, false);
}

/** The same recipe, written from EQUIPO → Organizar metas del equipo (owner, 2026-11-25): back to that page. */
export async function saveTeamRecipe(userId: string, period: string, fd: FormData) {
  return writeRecipe(userId, period, fd, true);
}

async function writeRecipe(userId: string, period: string, fd: FormData, team: boolean) {
  const user = await requireUser();
  const p = validPeriod(period) ? period : "";
  const back = (qs: string): never => {
    refreshApp();
    redirect(team ? `/equipo/metas?p=${p || period}&u=${userId}&${qs}#recetario` : `/comercial/metas?p=${p || period}${userId !== user.id ? `&u=${userId}` : ""}&${qs}#recetario`);
  };
  if (userId !== user.id && !canOrganizeGoals(user)) back("err=permiso-recetario");
  if (!p) back("err=periodo");
  if (isClosed(p, new Date())) back("err=cerrado");
  const person = await db.user.findUnique({ where: { id: userId }, select: { active: true } });
  if (!person?.active) back("err=persona");
  const num = (k: string) => Number(String(fd.get(k) ?? "").replace(/,/g, "").trim());
  const salesGoal = num("salesGoal"), avgSale = num("avgSale");
  if (!(salesGoal > 0) || !(avgSale > 0) || salesGoal > 1e9 || avgSale > 1e9) back("err=recetario-valor");
  const ratios = {} as Record<keyof typeof RECIPE_DEFAULTS, number>;
  for (const k of Object.keys(RECIPE_DEFAULTS) as (keyof typeof RECIPE_DEFAULTS)[]) {
    const n = num(k);
    if (!Number.isInteger(n) || n < 1 || n > RATIO_MAX) back("err=recetario-proporcion");
    ratios[k] = n;
  }
  const data = { salesGoal: money2(salesGoal), avgSale: money2(avgSale), ...ratios, setByName: user.name };
  await db.goalRecipe.upsert({ where: { userId_period: { userId, period: p } }, create: { userId, period: p, ...data }, update: data });
  back("ok=recetario");
}

/** Tabla de bateo: the person (or a manager for them) writes the month's goals for requests, quotes and purchase
 *  orders. Stored as GoalTarget rows with the BAT_ keys; a change supersedes the row and keeps it. */
export async function saveBatTargets(userId: string, period: string, fd: FormData) {
  const user = await requireUser();
  const p = validPeriod(period) ? period : "";
  const back = (qs: string): never => { refreshApp(); redirect(`/comercial/metas?p=${p || period}${userId !== user.id ? `&u=${userId}` : ""}&${qs}#bateo`); };
  if (userId !== user.id && !canManageAll(user)) back("err=permiso-bateo");
  if (!p) back("err=periodo");
  if (isClosed(p, new Date())) back("err=cerrado");
  const person = await db.user.findUnique({ where: { id: userId }, select: { active: true } });
  if (!person?.active) back("err=persona");
  const current = await db.goalTarget.findMany({ where: { userId, period: p, supersededAt: null, metric: { in: BAT_KEYS } } });
  const changes: { metric: string; target: number | null; prev: (typeof current)[number] | null }[] = [];
  for (const row of BAT_ROWS) {
    const raw = String(fd.get(row.k) ?? "").replace(/,/g, "").trim();
    const n = raw === "" ? null : Number(raw);
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 1e9 || (row.unit === "n" && !Number.isInteger(n)))) back("err=bateo-valor");
    const target = n == null || n === 0 ? null : money2(n);
    const prev = current.find((c) => c.metric === row.k) ?? null;
    if (target == null && !prev) continue;
    if (prev && target != null && sameMoney(prev.target, target)) continue;
    changes.push({ metric: row.k, target, prev });
  }
  if (!changes.length) back("ok=sin-cambios");
  await db.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.prev) await tx.goalTarget.update({ where: { id: c.prev.id }, data: { supersededAt: new Date() } });
      if (c.target != null) await tx.goalTarget.create({ data: { userId, metric: c.metric, period: p, target: c.target, setByName: user.name, version: (c.prev?.version ?? 0) + 1 } });
    }
  });
  back("ok=bateo");
}

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
