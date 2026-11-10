"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { newWorkerKey, retryJob, runWorker } from "@/lib/jobs";
import { refreshApp } from "@/lib/revalidate";

/** Creates a new key for the GitHub schedule. The old one stops working. Shown once, never stored in clear. */
export async function createWorkerKey(_prev: unknown, _fd: FormData): Promise<{ key: string }> {
  const user = await requireRole("GERENCIA");
  const key = await newWorkerKey(user.name);
  refreshApp();
  return { key };
}

export async function runNow() {
  await requireRole("GERENCIA");
  let qs = "ok=run";
  try { await runWorker({ trigger: "MANUAL", budgetMs: 40_000 }); } catch (e) { console.error("manual worker run failed", e); qs = "err=run"; }
  refreshApp();
  redirect(`/admin/trabajos?${qs}`);
}

export async function retry(id: string) {
  await requireRole("GERENCIA");
  await retryJob(id);
  refreshApp();
  redirect("/admin/trabajos?ok=retry");
}
