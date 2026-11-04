"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearFailures, isLimited, recordFailure } from "@/lib/rate-limit";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";

export type LoginState = { error?: string };

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Enter your email and password." };

  // Max 5 failed attempts per account and 20 per IP address within 15 minutes.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const emailKey = `email:${parsed.data.email}`;
  const ipKey = `ip:${ip}`;
  if (isLimited(emailKey, 5) || isLimited(ipKey, 20)) {
    return { error: "Too many failed attempts. Wait 15 minutes and try again." };
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.active || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    recordFailure(emailKey);
    recordFailure(ipKey);
    return { error: "Invalid email or password." };
  }

  clearFailures(emailKey);
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
