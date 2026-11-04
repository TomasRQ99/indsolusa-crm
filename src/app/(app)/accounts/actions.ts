"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit, canManageAll } from "@/lib/permissions";
import { optionalId, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";

const accountSchema = z.object({
  name: requiredText,
  industry: optionalText,
  website: optionalText,
  phone: optionalText,
  address: optionalText,
  ownerId: optionalId,
});

export async function createAccount(formData: FormData) {
  const user = await requireUser();
  const { ownerId: _ignored, ...data } = parseForm(accountSchema, formData);
  const account = await db.account.create({ data: { ...data, ownerId: user.id } });
  refreshApp();
  redirect(`/accounts/${account.id}`);
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
