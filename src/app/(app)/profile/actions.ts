"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";

export type PasswordState = { ok?: string; error?: string };

const schema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: z.string().min(10, "New password must be at least 10 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "New passwords do not match." });

export async function changePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const record = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await bcrypt.compare(parsed.data.current, record.passwordHash))) {
    return { error: "Current password is incorrect." };
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.next, 12) },
  });
  return { ok: "Password updated." };
}

export async function setLanguage(formData: FormData) {
  const user = await requireUser();
  const lang = formData.get("lang") === "EN" ? "EN" : "ES";
  await db.user.update({ where: { id: user.id }, data: { lang } });
  refreshApp();
}

export async function setWorkday(formData: FormData) {
  const user = await requireUser();
  const hours = z.coerce.number().min(1).max(14).parse(formData.get("hours"));
  await db.user.update({ where: { id: user.id }, data: { workdayMinutes: Math.round(hours * 60) } });
  refreshApp();
}