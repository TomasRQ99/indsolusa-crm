"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { loadDemo, removeDemo } from "@/lib/demo";

const role = z.enum(["ADMIN", "MANAGER", "REP", "MARKETING"]);

const createSchema = z.object({
  name: requiredText,
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10, "Use at least 10 characters"),
  role,
});

export async function createUser(formData: FormData) {
  await requireRole("ADMIN");
  const { password, ...data } = parseForm(createSchema, formData);
  if (await db.user.findUnique({ where: { email: data.email } })) {
    throw new Error("A user with that email already exists.");
  }
  await db.user.create({ data: { ...data, passwordHash: await bcrypt.hash(password, 12) } });
  refreshApp();
}

export async function setUserRole(id: string, formData: FormData) {
  const admin = await requireRole("ADMIN");
  if (id === admin.id) throw new Error("You cannot change your own role.");
  const { role: next } = parseForm(z.object({ role }), formData);
  await db.user.update({ where: { id }, data: { role: next } });
  refreshApp();
}

export async function toggleUserActive(id: string) {
  const admin = await requireRole("ADMIN");
  if (id === admin.id) throw new Error("You cannot deactivate yourself.");
  const user = await db.user.findUniqueOrThrow({ where: { id }, select: { active: true } });
  await db.user.update({ where: { id }, data: { active: !user.active } });
  refreshApp();
}

export async function loadDemoData() {
  const admin = await requireRole("ADMIN");
  await loadDemo(admin.id);
  refreshApp();
}

export async function removeDemoData() {
  await requireRole("ADMIN");
  await removeDemo();
  refreshApp();
}