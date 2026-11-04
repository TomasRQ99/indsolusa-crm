"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";

const contactSchema = z.object({
  firstName: requiredText,
  lastName: requiredText,
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
  await requireUser();
  const data = parseForm(contactSchema, formData);
  await db.contact.create({ data });
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
