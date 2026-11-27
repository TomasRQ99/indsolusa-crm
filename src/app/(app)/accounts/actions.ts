"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit, canManageAll } from "@/lib/permissions";
import { optionalDate, optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { cleanCountry, composeTaxId, joinPhone, looksLikeEmail, tidyWebsite } from "@/lib/customer-fields";
import { DOC_MIMES, MAX_DOC_BYTES, extractDocument, type ExtractedFields } from "@/lib/doc-extract";

const accountSchema = z.object({
  name: requiredText,
  industry: optionalText,
  website: optionalText,
  phone: optionalText,
  address: optionalText,
  region: optionalText,
  city: optionalText,
  postalCode: optionalText,
  ownerId: optionalId,
});

/** The shipping address sent by the "Dirección de envío" block: same as billing, or its own five boxes. */
function shipData(fd: FormData) {
  const v = (k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max) || null;
  const own = { shipAddress: v("shipAddress", 300), shipCity: v("shipCity", 120), shipRegion: v("shipRegion", 120), shipPostalCode: v("shipPostalCode", 20), shipCountry: cleanCountry(fd.get("shipCountry")) };
  return fd.get("shipSame") !== "1" && (own.shipAddress || own.shipCity) ? { shipSame: false, ...own } : { shipSame: true };
}

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
  // The check digit is optional and travels with the number ("900123456-7"); the phone is stored with its country code.
  const taxId = composeTaxId(formData.get("taxId"), formData.get("taxDv"));
  const billingContact = String(formData.get("billingContact") ?? "").trim() || null;
  const country = cleanCountry(formData.get("country"));
  const phone = joinPhone(formData.get("phoneCode"), formData.get("phone"));
  if (taxId && nitKey(taxId).length >= 6) {
    const key = nitKey(taxId);
    const same = (await db.account.findMany({ where: { taxId: { not: null } }, select: { id: true, name: true, taxId: true } }))
      .find((a) => a.taxId && nitKey(a.taxId) === key);
    if (same) redirect(`/accounts?err=${encodeURIComponent(same.id)}`);
  }
  const account = await db.account.create({ data: { ...data, website: tidyWebsite(data.website), phone, country, taxId, billingContact, ...shipData(formData), ownerId: user.id } });
  // Optional: the person who receives our news and promotions, with their permission on record.
  const txt = (k: string, max = 120) => String(formData.get(k) ?? "").trim().slice(0, max);
  // Nothing typed here stops the registration: an incomplete email is kept as written, and only a complete one can carry the permission.
  const cEmail = txt("contactEmail", 200).replace(/\s+/g, "").toLowerCase() || null;
  const cFirst = txt("contactFirstName") || txt("contactLastName") || (cEmail ? cEmail.split("@")[0] : "");
  if (cFirst) {
    const optIn = formData.get("promoOptIn") === "on" && !!cEmail && looksLikeEmail(cEmail);
    await db.contact.create({
      data: {
        accountId: account.id, firstName: cFirst, lastName: txt("contactLastName"), title: txt("contactTitle") || null, email: cEmail,
        phone: joinPhone(formData.get("contactPhoneCode"), formData.get("contactPhone")),
        promoOptIn: optIn, promoOptInAt: optIn ? new Date() : null, promoOptInBy: optIn ? user.name : null,
      },
    });
  }
  await saveDocuments(account.id, user.id, formData);
  refreshApp();
  redirect(`/accounts/${account.id}`);
}

export async function addAccountDocuments(id: string, formData: FormData) {
  const user = await requireUser();
  const existing = await db.account.findUniqueOrThrow({ where: { id }, select: { ownerId: true, taxId: true, address: true, city: true, region: true, country: true, phone: true, billingContact: true } });
  assertCanEdit(user, existing.ownerId);
  const f = await saveDocuments(id, user.id, formData);
  // Fill only the customer's empty boxes; never overwrite what a person already entered.
  const fill = {
    ...(!existing.taxId && f.taxId ? { taxId: f.taxId } : {}),
    ...(!existing.address && f.address ? { address: f.address } : {}),
    // An address typed before may already name the city: only fill city and department when the address is new too.
    ...(!existing.address && !existing.city && f.city ? { city: f.city } : {}),
    ...(!existing.address && !existing.region && f.department ? { region: f.department } : {}),
    // A RUT or a Cámara de Comercio certificate only exists for companies registered in Colombia.
    ...(!existing.country && f.taxId ? { country: "CO" } : {}),
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
  await db.account.update({ where: { id }, data: { ...data, website: tidyWebsite(data.website), country: cleanCountry(formData.get("country")), ...shipData(formData), ownerId: newOwner } });
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