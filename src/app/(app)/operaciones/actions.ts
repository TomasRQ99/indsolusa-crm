"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEditOps } from "@/lib/permissions";
import { optionalDate, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";

const money = z.coerce.number().min(0).max(1e12);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter currency code").default("USD");

async function dealOwnerCheck(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true } });
  assertCanEditOps(user, deal.ownerId);
  return user;
}

// ---------- Supplier POs ----------

export async function createSupplierPo(dealId: string, formData: FormData) {
  await dealOwnerCheck(dealId);
  const data = parseForm(
    z.object({ supplierId: z.string().min(1, "Pick a supplier"), amount: money, currency, eta: optionalDate }),
    formData,
  );
  await db.$transaction(async (tx) => {
    const code = await nextCode("SPO", "supplierPO", tx);
    await tx.supplierPO.create({ data: { ...data, code, dealId } });
  });
  refreshApp();
}

const spoStep = z.enum(["confirmedAt", "shippedAt", "receivedAt"]);

export async function markSupplierPo(spoId: string, step: z.infer<typeof spoStep>, formData: FormData) {
  const spo = await db.supplierPO.findUniqueOrThrow({ where: { id: spoId }, select: { dealId: true } });
  await dealOwnerCheck(spo.dealId);
  const { eta } = parseForm(z.object({ eta: optionalDate }), formData);
  await db.supplierPO.update({
    where: { id: spoId },
    data: { [spoStep.parse(step)]: today(), ...(eta ? { eta } : {}) },
  });
  refreshApp();
}

// ---------- Deliveries (remisiones) ----------

export async function createDelivery(dealId: string, formData: FormData) {
  await dealOwnerCheck(dealId);
  const base = parseForm(
    z.object({
      deliveredAt: z.string().min(1).transform((v) => new Date(v)),
      place: optionalText,
      deliveredBy: optionalText,
      receivedByName: optionalText,
      receptionCode: optionalText,
      notes: optionalText,
    }),
    formData,
  );
  const podReceived = formData.get("podReceived") === "on";
  const items = await db.dealItem.findMany({ where: { dealId }, include: { deliveryLines: { select: { qty: true } } } });

  const lines: { dealItemId: string; qty: number; serials: string | null }[] = [];
  for (const it of items) {
    const qty = Number(formData.get(`qty_${it.id}`) || 0);
    if (!qty) continue;
    const delivered = it.deliveryLines.reduce((s, l) => s + l.qty, 0);
    if (!Number.isInteger(qty) || qty < 0 || qty > it.qty - delivered) {
      throw new Error(`${it.description}: max ${it.qty - delivered}`);
    }
    const serials = String(formData.get(`serials_${it.id}`) ?? "").trim() || null;
    lines.push({ dealItemId: it.id, qty, serials });
  }
  if (items.length > 0 && lines.length === 0) throw new Error("Indica al menos una cantidad entregada / Enter at least one delivered quantity.");

  const created = await db.$transaction(async (tx) => {
    const code = await nextCode("REM", "delivery", tx);
    return tx.delivery.create({ data: { ...base, podReceived, code, dealId, lines: { create: lines } } });
  });
  refreshApp();
  redirect(`/operaciones/remisiones/${created.id}`);
}

export async function updateDelivery(id: string, formData: FormData) {
  const d = await db.delivery.findUniqueOrThrow({ where: { id }, select: { dealId: true, invoice: { select: { id: true } } } });
  await dealOwnerCheck(d.dealId);
  const data = parseForm(
    z.object({ receivedByName: optionalText, receptionCode: optionalText, notes: optionalText, place: optionalText }),
    formData,
  );
  await db.delivery.update({ where: { id }, data: { ...data, podReceived: formData.get("podReceived") === "on" } });
  refreshApp();
}

// ---------- Suppliers ----------

const supplierSchema = z.object({
  name: requiredText,
  country: optionalText,
  currency,
  email: optionalText,
  phone: optionalText,
  // Public website (for finding part pages via its sitemap). "acme.com" becomes "https://acme.com".
  website: optionalText.transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v)),
  // NIT / tax ID: a customer with the same NIT is the same organization (Mercado §4.3).
  taxId: optionalText,
});

export async function createSupplier(formData: FormData) {
  await requireUser();
  const data = parseForm(supplierSchema, formData);
  // Bank data typed here is a starting point only: it stays unverified until an
  // independent verification confirms it on the first payment.
  const bank = parseForm(
    z.object({ bankBeneficiary: optionalText, bankName: optionalText, bankAccount: optionalText, bankSwift: optionalText }),
    formData,
  );
  await db.supplier.create({ data: { ...data, ...bank } });
  refreshApp();
}

export async function updateSupplier(id: string, formData: FormData) {
  await requireUser();
  const data = parseForm(supplierSchema, formData);
  await db.supplier.update({ where: { id }, data });
  refreshApp();
}
