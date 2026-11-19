"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { fDay, fMoney, fText } from "@/lib/fd";
import { nextInternalCode } from "@/lib/admin-store";
import { getPurchasePolicy } from "@/lib/pr-auth";
import { levelOf } from "@/lib/purchase-auth";
import { marketRate } from "@/lib/fx-market";
import { CATEGORIES, KINDS, RECEIPT_MAX_BYTES, RECEIPT_MAX_FILES, RECEIPT_MIMES } from "@/lib/internal-expenses";

// Operaciones → Compras internas: record a purchase the company made (or needs) for itself, with its receipt.
// It creates the same InternalPurchase that Administración decides; approving it is what puts it in the report.

const home = (qs: string): never => { refreshApp(); redirect(`/compras/internas?${qs}`); };

async function saveReceipts(purchaseId: string, fd: FormData, by: string, room: number) {
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, Math.max(0, room));
  let saved = 0, skipped = 0;
  for (const file of files) {
    if (file.size > RECEIPT_MAX_BYTES || !RECEIPT_MIMES.includes(file.type)) { skipped++; continue; }
    await db.internalPurchaseFile.create({ data: { purchaseId, name: file.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "recibo", mime: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()), uploadedByName: by } });
    saved++;
  }
  return { saved, skipped };
}

export async function submitInternalExpense(fd: FormData) {
  const user = await requireUser();
  const description = fText(fd, "description", 200), amount = fMoney(fd, "amount");
  const kind = String(fd.get("kind") ?? ""), category = String(fd.get("category") ?? "");
  const currency = (fText(fd, "currency", 3) ?? "USD").toUpperCase();
  if (!description || !amount || amount <= 0 || !KINDS[kind] || !/^[A-Z]{3}$/.test(currency)) home("err=datos#nueva");
  // Reports are in dollars: another currency is converted at the market rate of the moment (kept with the record).
  let amountUsd = amount!;
  if (currency !== "USD") {
    const r = await marketRate(currency);
    if (!r) home("err=tasa#nueva");
    amountUsd = Math.round(amount! * r!.usdPerUnit * 100) / 100;
  }
  const bought = fd.get("already") === "1";
  const boughtAt = bought ? fDay(fd, "boughtAt") ?? today() : null;
  if (boughtAt && boughtAt > today()) home("err=fecha#nueva");
  const pol = await getPurchasePolicy();
  const p = await db.$transaction(async (tx) => tx.internalPurchase.create({ data: {
    code: await nextInternalCode("IP", tx), purpose: "INTERNAL_USE", kind, category: CATEGORIES[category] ? category : "OTHER",
    description: description!, need: fText(fd, "need", 500) ?? description!, supplierName: fText(fd, "supplierName", 160),
    amount: amount!, currency, amountUsd, requesterId: user.id, boughtAt, boughtNote: boughtAt ? "Registrada como ya comprada" : null,
    level: levelOf(amountUsd, pol.value), policyVersion: pol.version,
  } }));
  const r = await saveReceipts(p.id, fd, user.name, RECEIPT_MAX_FILES);
  home(`ok=${r.skipped ? "pedida-archivos" : "pedida"}&id=${p.id}#mias`);
}

/** More receipts later: by whoever asked, or by Finance / Administration / Management. */
export async function addReceipts(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await db.internalPurchase.findUnique({ where: { id }, select: { requesterId: true, _count: { select: { files: true } } } });
  if (!p || !(p.requesterId === user.id || canFinance(user))) redirect(`/administracion/compras-internas/${id}?err=permiso`);
  const r = await saveReceipts(id, fd, user.name, RECEIPT_MAX_FILES - p!._count.files);
  refreshApp();
  redirect(`/administracion/compras-internas/${id}?ok=${r.saved ? "recibo" : "recibo-no"}#recibos`);
}
