"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";

// Comercial C4 · product memory. §10: every logistics value is an observation with its context; a measurement at
// receipt is added, never written over. §11: an import is kept as a dated precedent, never as an authorization.

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const num = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? "").trim().replace(/\s/g, "").replace(",", "."); if (!s) return null; const v = Number(s); return Number.isFinite(v) && v >= 0 ? v : null; };
const dayOf = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null; };
const back = (partId: string, qs: string, hash: string): never => { refreshApp(); redirect(`/localizar/${partId}?${qs}#${hash}`); };

export async function addObservation(partId: string, fd: FormData) {
  const user = await requireUser();
  await db.part.findUniqueOrThrow({ where: { id: partId }, select: { id: true } });
  const status = ["SUPPLIER_REPORTED", "RECEIPT_MEASURED", "HISTORICAL", "ESTIMATED"].includes(String(fd.get("status"))) ? String(fd.get("status")) : null;
  const source = txt(fd, "source", 200);
  const observedAt = dayOf(fd, "observedAt") ?? today();
  const v = { netKg: num(fd, "netKg"), grossKg: num(fd, "grossKg"), lengthCm: num(fd, "lengthCm"), widthCm: num(fd, "widthCm"), heightCm: num(fd, "heightCm"), packages: num(fd, "packages"), origin: txt(fd, "origin", 60), hsSupplier: txt(fd, "hsSupplier", 20) };
  if (!status || !source) back(partId, "err=obs", "pasaporte");
  if (observedAt > today()) back(partId, "err=fecha", "pasaporte");
  if (Object.values(v).every((x) => x == null)) back(partId, "err=obs-vacia", "pasaporte");
  const dealId = txt(fd, "dealId", 40);
  await db.logisticsObservation.create({ data: { partId, status: status!, source: source!, observedAt, qtyContext: num(fd, "qtyContext") == null ? null : Math.round(num(fd, "qtyContext")!), packaging: txt(fd, "packaging", 120), ...v, packages: v.packages == null ? null : Math.round(v.packages), dealId: dealId && (await db.deal.findUnique({ where: { id: dealId }, select: { id: true } })) ? dealId : null, recordedByName: user.name } });
  back(partId, "ok=obs", "pasaporte");
}

export async function addImportExperience(partId: string, fd: FormData) {
  const user = await requireUser();
  const part = await db.part.findUniqueOrThrow({ where: { id: partId }, select: { mpn: true, name: true } });
  const importedAt = dayOf(fd, "importedAt");
  const source = txt(fd, "hsCriterion", 300);
  if (!importedAt || importedAt > today()) back(partId, "err=importacion", "importaciones");
  if (!txt(fd, "hsCode", 20) && !txt(fd, "documents", 600) && !txt(fd, "resolution", 600)) back(partId, "err=importacion-vacia", "importaciones");
  const cost = num(fd, "realCostUsd");
  const days = num(fd, "days");
  await db.importExperience.create({ data: {
    partId, productLabel: `${part.mpn} · ${part.name}`.slice(0, 200), hsCode: txt(fd, "hsCode", 20), hsCriterion: source, documents: txt(fd, "documents", 600), approvals: txt(fd, "approvals", 600),
    agentNotes: txt(fd, "agentNotes", 600), inspection: txt(fd, "inspection", 300), realCostUsd: cost, days: days == null ? null : Math.round(days), delays: txt(fd, "delays", 400), resolution: txt(fd, "resolution", 600),
    importedAt: importedAt!, dealId: txt(fd, "dealId", 40), recordedByName: user.name,
  } });
  back(partId, "ok=importacion", "importaciones");
}
