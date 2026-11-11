"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance, canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { periodOf } from "@/lib/goal-rules";
import { cleanConfig } from "@/lib/report-builder";

// Módulo 13 §15 · saved views. A view stores the question (period, grouping, filters), never figures.

export async function saveView(fd: FormData) {
  const user = await requireUser();
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const config = cleanConfig(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])), periodOf(new Date()));
  if (!name) { redirect("/informes/constructor?err=nombre"); }
  // Sharing a view with everyone is for management and money roles; anyone keeps personal views.
  const shared = fd.get("shared") === "1" && (canManageAll(user) || canFinance(user));
  const v = await db.reportView.create({ data: { name, ownerId: user.id, shared, config } });
  refreshApp();
  redirect(`/informes/constructor?v=${v.id}&ok=vista`);
}

export async function deleteView(id: string) {
  const user = await requireUser();
  await db.reportView.deleteMany({ where: { id, ownerId: user.id } });
  refreshApp();
  redirect("/informes/constructor?ok=borrada");
}
