"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { aiPing } from "@/lib/ai";

/** "Probar la conexión": one tiny paid request that proves the company's AI key works from this server. */
export async function testAiConnection() {
  const user = await requireUser();
  if (!canManageAll(user) && user.role !== "ADMINISTRACION") redirect("/administracion/ia?err=permiso");
  const r = await aiPing(user.name);
  if (r.ok) redirect("/administracion/ia?ok=prueba");
  if (r.code === "API" || r.code === "AUTH") console.error("[administracion/ia]", r.code, r.message);
  redirect(`/administracion/ia?err=${r.code}${r.message ? `&msg=${encodeURIComponent(r.message.slice(0, 200))}` : ""}`);
}
