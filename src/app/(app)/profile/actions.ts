"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { rememberLang } from "@/lib/lang-cookie";
import { refreshApp } from "@/lib/revalidate";
import { addDays, today } from "@/lib/domain";
import { bogotaTime, listEvents } from "@/lib/outlook";
import { outlookErrorCode } from "@/lib/outlook-sync";

export type PasswordState = { ok?: string; error?: string };

export async function changePassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const user = await requireUser();
  const { t } = makeI18n(user.lang);
  const schema = z
    .object({
      current: z.string().min(1, t("Escribe tu contraseña actual.", "Enter your current password.")),
      next: z.string().min(10, t("La nueva contraseña debe tener al menos 10 caracteres.", "New password must be at least 10 characters.")),
      confirm: z.string(),
    })
    .refine((v) => v.next === v.confirm, { message: t("Las contraseñas nuevas no coinciden.", "New passwords do not match.") });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const record = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await bcrypt.compare(parsed.data.current, record.passwordHash))) {
    return { error: t("La contraseña actual no es correcta.", "Current password is incorrect.") };
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.next, 12) },
  });
  return { ok: t("Contraseña actualizada.", "Password updated.") };
}

export async function setLanguage(formData: FormData) {
  const user = await requireUser();
  const lang = formData.get("lang") === "EN" ? "EN" : "ES";
  await db.user.update({ where: { id: user.id }, data: { lang } });
  await rememberLang(lang);
  refreshApp();
}

export async function setWorkday(formData: FormData) {
  const user = await requireUser();
  const hours = z.coerce.number().min(1).max(14).parse(formData.get("hours"));
  await db.user.update({ where: { id: user.id }, data: { workdayMinutes: Math.round(hours * 60) } });
  refreshApp();
}

/**
 * Connect the person's OWN Outlook calendar (the mailbox of the email they sign in with).
 * We read today's calendar once to prove access before saving the connection.
 */
export async function connectOutlook() {
  const user = await requireUser();
  let result = "ok";
  try {
    await listEvents(user.email, bogotaTime(today(), 0), bogotaTime(addDays(today(), 1), 0));
    await db.user.update({ where: { id: user.id }, data: { outlookConnectedAt: new Date() } });
  } catch (e) {
    result = outlookErrorCode(e);
  }
  refreshApp();
  redirect(`/profile?cal=${result}`);
}

export async function disconnectOutlook() {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { outlookConnectedAt: null } });
  refreshApp();
}
