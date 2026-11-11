"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditOps, canFinance, isGerencia } from "@/lib/permissions";
import { splitProblem, type SplitRow } from "@/lib/commission-split";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { COST_CATS, ECON_STATES, SPLIT_METHODS, splitShared, type Part } from "@/lib/economics-rules";
import { dealEconomics } from "@/lib/economics";

// Operaciones O9c · cost ledger and economics close (module 11 §43.1, §44).

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").trim().slice(0, max); return v || null; };
const num = (fd: FormData, k: string) => { const raw = String(fd.get(k) ?? "").trim().replace(",", "."); const n = Number(raw); return raw && Number.isFinite(n) && n >= 0 && n < 1e8 ? n : null; };
const day = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : today(); };
const back = (id: string, qs: string): never => { refreshApp(); redirect(`/deals/${id}/economia?${qs}`); };

async function gate(dealId: string) {
  const user = await requireUser();
  const d = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true, economicsState: true } });
  if (!(canEditOps(user, d.ownerId) || canFinance(user))) back(dealId, "err=permiso");
  // A final close is a statement: costs change again only after it is reopened.
  if (d.economicsState === "FINAL") back(dealId, "err=final");
  return user;
}

/** A real cost of this Journey that no other record already holds. */
export async function addDealCost(dealId: string, fd: FormData) {
  const user = await gate(dealId);
  const category = String(fd.get("category") ?? "");
  const amount = num(fd, "amount");
  const description = txt(fd, "description", 200);
  if (!COST_CATS[category] || amount == null || amount <= 0 || !description) back(dealId, "err=costo");
  await db.dealCost.create({ data: { dealId, category, amount: money2(amount!), description: description!, evidence: txt(fd, "evidence", 200), spentOn: day(fd, "spentOn"), createdByName: user.name } });
  back(dealId, "ok=costo");
}

/** One cost shared between several Journeys. By sale value unless the person chooses another split; the method is kept. */
export async function addSharedCost(dealId: string, fd: FormData) {
  const user = await gate(dealId);
  const category = String(fd.get("category") ?? "");
  const total = num(fd, "amount");
  const description = txt(fd, "description", 200);
  const method = String(fd.get("method") ?? "VALUE");
  const note = txt(fd, "splitNote", 200);
  const codes = [...new Set(String(fd.get("others") ?? "").split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  if (!COST_CATS[category] || total == null || total <= 0 || !description || !SPLIT_METHODS[method] || !codes.length) back(dealId, "err=compartido");
  if (method === "MANUAL" && !note) back(dealId, "err=compartido-motivo");
  const others = await db.deal.findMany({ where: { code: { in: codes }, internal: false, id: { not: dealId } }, select: { id: true, code: true, economicsState: true } });
  if (others.length !== codes.length) back(dealId, "err=compartido-journey");
  if (others.some((o) => o.economicsState === "FINAL")) back(dealId, "err=compartido-final");
  const ids = [dealId, ...others.map((o) => o.id)];
  // By hand: this Journey's share in its own box, the others as "CODE=amount" pairs.
  const typed = new Map<string, number>();
  for (const m of String(fd.get("manualOthers") ?? "").matchAll(/([A-Za-z0-9-]+)\s*[=:]\s*(\d+(?:[.,]\d+)?)/g)) typed.set(m[1].toUpperCase(), Number(m[2].replace(",", ".")));
  const parts: Part[] = [];
  for (const id of ids) { const e = await dealEconomics(id); parts.push({ id, sale: e?.econ?.prot.sale ?? 0, units: e?.units ?? 0, manual: method === "MANUAL" ? (id === dealId ? num(fd, "manual_self") : typed.get((e?.d.code ?? "").toUpperCase()) ?? null) : null }); }
  const split = splitShared(total!, parts, method);
  if (!split) back(dealId, method === "MANUAL" ? "err=compartido-suma" : "err=compartido-base");
  const sharedId = randomUUID();
  const spentOn = day(fd, "spentOn");
  await db.dealCost.createMany({ data: split!.filter((s) => s.amount > 0).map((s) => ({ dealId: s.id, category, amount: s.amount, description: description!, evidence: txt(fd, "evidence", 200), spentOn, sharedId, sharedTotal: money2(total!), splitMethod: method, splitNote: note, createdByName: user.name })) });
  back(dealId, "ok=compartido");
}

/** Remove a ledger line typed by mistake. A shared cost is removed from every Journey it was split into. */
export async function removeDealCost(costId: string) {
  const c = await db.dealCost.findUnique({ where: { id: costId }, select: { dealId: true, sharedId: true } });
  if (!c) redirect("/deals");
  await gate(c!.dealId);
  if (c!.sharedId) {
    if (await db.dealCost.count({ where: { sharedId: c!.sharedId, deal: { economicsState: "FINAL" } } })) back(c!.dealId, "err=compartido-final");
    await db.dealCost.deleteMany({ where: { sharedId: c!.sharedId } });
  } else await db.dealCost.delete({ where: { id: costId } });
  back(c!.dealId, "ok=quitado");
}

/** §44.2 Close state. Finanzas, Administración or management decide; FINAL keeps the figures as they were that day. */
export async function setEconomicsState(dealId: string, fd: FormData) {
  const user = await requireUser();
  if (!canFinance(user)) back(dealId, "err=permiso-cierre");
  const state = String(fd.get("state") ?? "");
  const note = txt(fd, "note");
  const cur = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { economicsState: true } });
  if (!ECON_STATES[state] || state === cur.economicsState) back(dealId, "err=estado");
  // Reopening a final close always says why.
  if (cur.economicsState === "FINAL" && !note) back(dealId, "err=reabrir");
  let snap: Prisma.InputJsonValue | typeof undefined = undefined;
  if (state === "FINAL") {
    const e = await dealEconomics(dealId);
    if (!e?.econ || !e.econ.facts) back(dealId, "err=sin-factura");
    snap = { prot: e!.econ!.prot, final: e!.econ!.facts, lines: e!.econ!.lines, sums: e!.sums, claimRecovered: e!.claimRecovered, at: new Date().toISOString() } as unknown as Prisma.InputJsonValue;
  }
  await db.deal.update({ where: { id: dealId }, data: { economicsState: state, economicsNote: note, economicsByName: user.name, economicsAt: new Date(), ...(state === "FINAL" ? { economicsFinal: snap } : {}) } });
  back(dealId, "ok=estado");
}

/** Módulo 12 §12 · who shares this sale's commission. Gerencia decides, always with a reason. The earlier split is
 *  kept as history; halves already approved or paid are not touched. */
export async function saveAllocations(dealId: string, fd: FormData) {
  const user = await requireUser();
  const go = (qs: string): never => { refreshApp(); redirect(`/deals/${dealId}/economia?${qs}#reparto`); };
  if (!isGerencia(user)) go("err=reparto-permiso");
  const reason = txt(fd, "reason", 300);
  const rows: SplitRow[] = [];
  for (const pool of ["COMMERCIAL", "OPERATIONAL"]) for (let k = 0; k < 3; k++) {
    const userId = String(fd.get(`${pool}_u${k}`) ?? "");
    if (!userId) continue;
    const raw = String(fd.get(`${pool}_p${k}`) ?? "").trim().replace(",", ".");
    rows.push({ userId, pool, splitPct: raw && Number.isFinite(Number(raw)) ? Math.round(Number(raw) * 100) / 100 : null });
  }
  if (!reason) go("err=reparto-motivo");
  const problem = splitProblem(rows);
  if (problem) go(`err=reparto-${problem.toLowerCase()}`);
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) }, active: true }, select: { id: true } });
  if (users.length !== new Set(rows.map((r) => r.userId)).size) go("err=reparto-persona");
  await db.$transaction([
    db.commissionAllocation.updateMany({ where: { dealId, supersededAt: null }, data: { supersededAt: new Date() } }),
    db.commissionAllocation.createMany({ data: rows.map((r) => ({ dealId, userId: r.userId, pool: r.pool, splitPct: r.splitPct!, reason: reason!, setByName: user.name })) }),
  ]);
  go("ok=reparto");
}