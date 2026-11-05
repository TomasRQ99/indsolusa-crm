"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearFailures, isLimited, recordFailure } from "@/lib/rate-limit";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { rememberLang } from "@/lib/lang-cookie";

export type LoginState = { error?: string };

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function setLoginLanguage(formData: FormData) {
  await rememberLang(formData.get("lang") === "EN" ? "EN" : "ES");
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { t } = await getI18n();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t("Escribe tu correo y contraseña.", "Enter your email and password.") };

  // Max 5 failed attempts per account and 20 per IP address within 15 minutes.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const emailKey = `email:${parsed.data.email}`;
  const ipKey = `ip:${ip}`;
  if (isLimited(emailKey, 5) || isLimited(ipKey, 20)) {
    return { error: t("Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.", "Too many failed attempts. Wait 15 minutes and try again.") };
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.active || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    recordFailure(emailKey);
    recordFailure(ipKey);
    return { error: t("Correo o contraseña incorrectos.", "Invalid email or password.") };
  }

  clearFailures(emailKey);
  await createSession(user.id);
  await rememberLang(user.lang);
  redirect("/mi-dia");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
