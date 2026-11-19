"use server";

import { z } from "zod";
import { joinPhone } from "@/lib/customer-fields";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";

const contactSchema = z.object({
  firstName: requiredText,
  // Only the first name is needed to keep a person; the rest can be completed later.
  lastName: z.string().trim().max(200).optional().transform((v) => v ?? ""),
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email().nullable()),
  phone: optionalText,
  title: optionalText,
  accountId: optionalId,
});

export async function createContact(formData: FormData) {
  const user = await requireUser();
  const data = parseForm(contactSchema, formData);
  // Permission to receive promotions only means something with an email to send them to.
  const optIn = formData.get("promoOptIn") === "on" && !!data.email;
  const phone = formData.has("phoneCode") ? joinPhone(formData.get("phoneCode"), data.phone) : data.phone;
  await db.contact.create({ data: { ...data, phone, promoOptIn: optIn, promoOptInAt: optIn ? new Date() : null, promoOptInBy: optIn ? user.name : null } });
  refreshApp();
}

/** Records that a person agreed to receive promotional material by email, or that they no longer want it. */
export async function setPromoOptIn(id: string, on: boolean) {
  const user = await requireUser();
  const contact = await db.contact.findUniqueOrThrow({ where: { id }, select: { email: true, account: { select: { ownerId: true } } } });
  if (contact.account) assertCanEdit(user, contact.account.ownerId);
  const optIn = on && !!contact.email;
  await db.contact.update({ where: { id }, data: { promoOptIn: optIn, promoOptInAt: optIn ? new Date() : null, promoOptInBy: optIn ? user.name : null } });
  refreshApp();
}

// A contact inherits edit rights from its account's owner; unattached contacts are editable by anyone.
export async function deleteContact(id: string) {
  const user = await requireUser();
  const contact = await db.contact.findUniqueOrThrow({
    where: { id },
    select: { account: { select: { ownerId: true } } },
  });
  if (contact.account) assertCanEdit(user, contact.account.ownerId);
  await db.contact.delete({ where: { id } });
  refreshApp();
}
