"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { isEditable, parsePct } from "@/lib/sales-budget-rules";
import { canWriteBudget } from "@/lib/sales-budget";

// Presupuesto comercial · sites or plants of a company, and sales shared between two negotiators (writes).
// Sites: the company stays the unit of the budget (spec §1); a budget may say what share of its goals each site
// carries, and a Need may name its site so the real figures can be read by site.
// Shared sales (spec §3 "Asignación", AT-13): Dirección Comercial or Gerencia give part of a Need's money figures to
// another negotiator; the owner keeps the rest, so a document always adds up to 100 %.

const BASE = "/comercial/presupuesto";
type Ctx = { year: number; slot: string; userId: string };
const page = (c: Ctx, qs: string, hash: string) => `${BASE}/${c.slot}?y=${c.year}&u=${c.userId}&${qs}${hash}`;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function addPlant(c: Ctx, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(page(c, qs, "#sedes")); };
  if (!canWriteBudget(user, c.userId)) back("err=permiso");
  const account = await db.account.findFirst({ where: { id: c.slot, internal: false }, select: { id: true } });
  const name = clean(fd.get("name"), 120);
  if (!account || !name) back("err=sede-nombre");
  const same = await db.plant.findFirst({ where: { accountId: account!.id, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (same) back("err=sede-repetida");
  await db.plant.create({ data: { accountId: account!.id, name, city: clean(fd.get("city"), 80) || null, sourceType: "INTERNAL", sourceRef: "Presupuesto comercial", observedAt: new Date(), capturedByName: user.name } });
  back("ok=sede");
}

/** The share of the budget's annual goals each site carries. Only while the proposal can still be changed. */
export async function saveSites(c: Ctx, budgetId: string, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(page(c, qs, "#sedes")); };
  if (!canWriteBudget(user, c.userId)) back("err=permiso");
  const b = await db.salesBudget.findUnique({ where: { id: budgetId }, select: { id: true, slot: true, userId: true, state: true, supersededAt: true } });
  if (!b || b.slot !== c.slot || b.userId !== c.userId) back("err=estado");
  if (!isEditable(b!.state) || b!.supersededAt) back("err=aprobado");
  const plants = await db.plant.findMany({ where: { accountId: c.slot }, select: { id: true } });
  const rows: { budgetId: string; plantId: string; pct: number }[] = [];
  for (const p of plants) {
    const v = parsePct(fd.get(`pct_${p.id}`));
    if (v == null || v === 0) continue;
    if (Number.isNaN(v) || v < 0 || v > 100) back("err=sede-pct");
    rows.push({ budgetId, plantId: p.id, pct: Math.round(v * 100) / 100 });
  }
  if (rows.reduce((s, r) => s + r.pct, 0) > 100.001) back("err=sede-suma");
  await db.$transaction([db.salesBudgetSite.deleteMany({ where: { budgetId } }), db.salesBudgetSite.createMany({ data: rows })]);
  back("ok=sedes");
}

/** Which site a Need belongs to. The Need's owner, Gerencia or Dirección Comercial. */
export async function setDealPlant(c: Ctx, dealId: string, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(page(c, qs, "#necesidades")); };
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { id: true, ownerId: true, accountId: true } });
  if (!deal || deal.accountId !== c.slot) back("err=estado");
  if (deal!.ownerId !== user.id && !canManageAll(user)) back("err=permiso-sede");
  const plantId = String(fd.get("plantId") ?? "") || null;
  if (plantId && !(await db.plant.findFirst({ where: { id: plantId, accountId: c.slot }, select: { id: true } }))) back("err=estado");
  await db.deal.update({ where: { id: dealId }, data: { plantId } });
  back("ok=sede-necesidad");
}

export async function addShare(c: Ctx, dealId: string, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(page(c, qs, "#necesidades")); };
  if (!canManageAll(user)) back("err=permiso-compartir");
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { id: true, ownerId: true, accountId: true, salesShares: { select: { userId: true, pct: true } } } });
  if (!deal || deal.accountId !== c.slot) back("err=estado");
  const userId = String(fd.get("userId") ?? "");
  const person = await db.user.findUnique({ where: { id: userId }, select: { active: true } });
  if (!person?.active || userId === deal!.ownerId) back("err=compartir-persona");
  const pct = parsePct(fd.get("pct"));
  if (pct == null || Number.isNaN(pct) || pct < 1 || pct > 99) back("err=compartir-pct");
  const others = deal!.salesShares.filter((s) => s.userId !== userId).reduce((s, x) => s + Number(x.pct), 0);
  // The owner always keeps a part: a Need given away whole is a change of owner, not a shared sale.
  if (others + pct! > 99) back("err=compartir-suma");
  const reason = clean(fd.get("reason"), 300) || null;
  await db.salesShare.upsert({ where: { dealId_userId: { dealId, userId } }, create: { dealId, userId, pct: pct!, reason, byName: user.name }, update: { pct: pct!, reason, byName: user.name } });
  back("ok=compartida");
}

export async function removeShare(c: Ctx, shareId: string) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(page(c, qs, "#necesidades")); };
  if (!canManageAll(user)) back("err=permiso-compartir");
  await db.salesShare.deleteMany({ where: { id: shareId, deal: { accountId: c.slot } } });
  back("ok=compartida-quitada");
}
