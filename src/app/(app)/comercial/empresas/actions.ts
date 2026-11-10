"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { SELLER_KEYS, ensureSellers, sellerLocked, sellerMissing } from "@/lib/sellers";

// Selling entities: Gerencia keeps the company details; whoever runs a Journey states which company sells on it.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };

export async function saveSeller(key: string, fd: FormData) {
  const user = await requireUser();
  const go = (qs: string): never => { refreshApp(); redirect(`/comercial/empresas?${qs}#e-${key}`); };
  if (!isGerencia(user)) go("err=permiso");
  await ensureSellers();
  const cur = await db.sellingEntity.findUnique({ where: { key } });
  if (!cur) go("err=empresa");
  const iva = Number(String(fd.get("ivaPct") ?? "").replace(",", "."));
  if (!Number.isFinite(iva) || iva < 0 || iva > 40) go("err=iva");
  const next = {
    legalName: txt(fd, "legalName", 160) ?? "", taxIdLabel: txt(fd, "taxIdLabel", 20), taxId: txt(fd, "taxId", 40), addressLines: txt(fd, "addressLines", 300), phone: txt(fd, "phone", 40),
    ivaPct: Math.round(iva * 100) / 100, allowsCop: fd.get("allowsCop") === "1", active: fd.get("active") === "1",
  };
  // A company sells only once its legal details are complete; the USA company can't be switched off (it is the default).
  if (key === "USA") next.active = true;
  if (next.active && sellerMissing({ ...next, key }).length) go("err=incompleta");
  const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => String(next[k] ?? "") !== String((k === "ivaPct" ? Number(cur!.ivaPct) : cur![k]) ?? ""));
  if (!changed) go("ok=igual");
  await db.sellingEntity.update({ where: { key }, data: { ...next, version: cur!.version + 1, updatedByName: user.name } });
  go("ok=guardada");
}

/** Which of our companies sells on this Journey. Fixed once a quote was presented or an invoice exists. */
export async function setDealSeller(dealId: string, fd: FormData) {
  const user = await requireUser();
  const back = String(fd.get("back") ?? "");
  const to = back.startsWith("/cotizaciones/") || back.startsWith("/deals/") ? back : `/deals/${dealId}?tab=quote`;
  const go = (qs: string): never => { refreshApp(); redirect(`${to}${to.includes("?") ? "&" : "?"}${qs}`); };
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { ownerId: true, sellerKey: true } });
  if (!deal || !canEdit(user, deal.ownerId)) go("err=permiso");
  const key = String(fd.get("sellerKey") ?? "");
  if (!(SELLER_KEYS as readonly string[]).includes(key)) go("err=vendedor");
  if (key === deal!.sellerKey) go("ok=vendedor");
  await ensureSellers();
  const s = await db.sellingEntity.findUnique({ where: { key } });
  if (!s?.active) go("err=vendedor-inactivo");
  if (await sellerLocked(dealId)) go("err=vendedor-fijo");
  await db.$transaction([
    db.deal.update({ where: { id: dealId }, data: { sellerKey: key } }),
    db.activity.create({ data: { type: "NOTE", subject: `Vende: ${s!.legalName} (antes ${deal!.sellerKey})`.slice(0, 200), userId: user.id, dealId, phase: "quote", source: "Empresa que vende" } }),
  ]);
  go("ok=vendedor");
}
