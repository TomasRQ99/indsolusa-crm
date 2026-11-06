"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit, canManageAll } from "@/lib/permissions";
import { optionalDate, optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { DOC_MIMES, MAX_DOC_BYTES, extractDocument, type ExtractedFields } from "@/lib/doc-extract";

const accountSchema = z.object({
  name: requiredText,
  industry: optionalText,
  website: optionalText,
  phone: optionalText,
  address: optionalText,
  ownerId: optionalId,
});

/** Same NIT whether typed "900.123.456-7", "900123456-7" or "9001234567". */
const nitKey = (s: string) => s.replace(/\D/g, "").slice(0, 9);

/** Stores the uploaded files of a customer, with what SOLU could read from each one. */
async function saveDocuments(accountId: string, userId: string, formData: FormData) {
  const files = formData.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
  const found: ExtractedFields = {};
  for (const file of files.slice(0, 6)) {
    if (file.size > MAX_DOC_BYTES || !DOC_MIMES.includes(file.type)) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ex = await extractDocument(bytes, file.type).catch(() => null);
    // The RUT wins over other documents when both bring the same field.
    if (ex) for (const [k, v] of Object.entries(ex.fields) as [keyof ExtractedFields, string][]) if (v && (!found[k] || ex.kind === "RUT")) found[k] = v;
    await db.accountDocument.create({
      data: {
        accountId, uploadedById: userId, name: file.name.slice(0, 160), mime: file.type, size: file.size,
        data: Buffer.from(bytes), kind: ex?.kind ?? "OTHER", extracted: ex ? { fields: ex.fields, readable: ex.readable } : undefined,
      },
    });
  }
  return found;
}

export async function createAccount(formData: FormData) {
  const user = await requireUser();
  const { ownerId: _ignored, ...data } = parseForm(accountSchema, formData);
  const taxId = String(formData.get("taxId") ?? "").trim() || null;
  const billingContact = String(formData.get("billingContact") ?? "").trim() || null;
  if (taxId && nitKey(taxId).length >= 6) {
    const key = nitKey(taxId);
    const same = (await db.account.findMany({ where: { taxId: { not: null } }, select: { id: true, name: true, taxId: true } }))
      .find((a) => a.taxId && nitKey(a.taxId) === key);
    if (same) redirect(`/accounts?err=${encodeURIComponent(same.id)}`);
  }
  const account = await db.account.create({ data: { ...data, taxId, billingContact, ownerId: user.id } });
  await saveDocuments(account.id, user.id, formData);
  refreshApp();
  redirect(`/accounts/${account.id}`);
}

export async function addAccountDocuments(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.account.findUniqueOrThrow({ where: { id }, select: { ownerId: true, taxId: true, address: true, phone: true, billingContact: true } });
  assertCanEdit(user, existing.ownerId);
  const f = await saveDocuments(id, user.id, formData);
  // Fill only the customer's empty boxes; never overwrite what a person already entered.
  const address = [f.address, f.city, f.department && f.department !== f.city ? f.department : undefined].filter(Boolean).join(", ");
  const fill = {
    ...(!existing.taxId && f.taxId ? { taxId: f.taxId } : {}),
    ...(!existing.address && address ? { address } : {}),
    ...(!existing.phone && f.phone ? { phone: f.phone } : {}),
    ...(!existing.billingContact && f.email ? { billingContact: f.email } : {}),
  };
  if (Object.keys(fill).length) await db.account.update({ where: { id }, data: fill });
  refreshApp();
}

export async function deleteAccountDocument(accountId: string, docId: string) {
  const user = await requireUser();
  const existing = await db.account.findUniqueOrThrow({ where: { id: accountId }, select: { ownerId: true } });
  assertCanEdit(user, existing.ownerId);
  await db.accountDocument.deleteMany({ where: { id: docId, accountId } });
  refreshApp();
}

export async function updateAccount(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.account.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
  assertCanEdit(user, existing.ownerId);

  const { ownerId, ...data } = parseForm(accountSchema, formData);
  // Only managers and admins may reassign ownership.
  const newOwner = canManageAll(user) && ownerId ? ownerId : existing.ownerId;
  await db.account.update({ where: { id }, data: { ...data, ownerId: newOwner } });
  refreshApp();
}

export async function deleteAccount(id: string) {
  const user = await requireUser();
  const existing = await db.account.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
  assertCanEdit(user, existing.ownerId);
  await db.account.delete({ where: { id } });
  refreshApp();
  redirect("/accounts");
}

/** Billing requirements: they decide what blocks invoicing a delivery. */
export async function updateBilling(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.account.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
  assertCanEdit(user, existing.ownerId);
  const data = parseForm(
    z.object({
      taxId: optionalText,
      paymentTermsDays: z.coerce.number().int().min(0).max(365),
      portalValidUntil: optionalDate,
    }),
    formData,
  );
  await db.account.update({
    where: { id },
    data: {
      ...data,
      taxDataComplete: formData.get("taxDataComplete") === "on",
      requiresReceptionCode: formData.get("requiresReceptionCode") === "on",
      requiresPortal: formData.get("requiresPortal") === "on",
    },
  });
  refreshApp();
}