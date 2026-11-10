"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { DHL_KEY, SECRET_REF } from "@/lib/carriers/dhl";

// Operaciones O5b · carrier accounts. Gerencia registers which company owns which carrier account. No credential is
// ever typed here: the account points to environment variables by a secret reference.

const go = (qs: string): never => { refreshApp(); redirect(`/operaciones/transportadores?${qs}`); };
const txt = (fd: FormData, k: string, max = 120) => { const v = String(fd.get(k) ?? "").trim().slice(0, max); return v || null; };

export async function saveCarrierAccount(fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=permiso");
  const secretRef = (txt(fd, "secretRef", 32) ?? "").toUpperCase();
  const label = txt(fd, "label");
  const sellerKey = fd.get("sellerKey") === "CO" ? "CO" : "USA";
  if (!label || !SECRET_REF.test(secretRef)) go("err=datos");
  // Only the last 4 digits are kept, for recognition; the full number stays in the environment.
  const last4 = (txt(fd, "accountLast4", 40) ?? "").replace(/\D/g, "").slice(-4) || null;
  const data = { carrier: DHL_KEY, sellerKey, label: label!, accountLast4: last4, country: txt(fd, "country", 60), currency: (txt(fd, "currency", 3) ?? "USD").toUpperCase(), environment: fd.get("environment") === "PRODUCTION" ? "PRODUCTION" : "TEST", active: fd.get("active") === "1", updatedByName: user.name };
  await db.carrierAccount.upsert({ where: { secretRef }, create: { secretRef, ...data }, update: data });
  go("ok=guardada");
}
