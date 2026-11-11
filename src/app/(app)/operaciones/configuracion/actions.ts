"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { OPS_POLICY_KEY, cleanOpsPolicy } from "@/lib/ops-rules";
import { getOpsPolicy } from "@/lib/ops-home";

// Operaciones · settings (decision O-15): thresholds are versioned policy, never fixed in code. Gerencia changes
// them; every change is a new version with who and when, and the earlier ones stay as history.

const go = (qs: string): never => { refreshApp(); redirect(`/operaciones/configuracion?${qs}`); };

export async function saveOpsPolicy(fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=permiso");
  const value = cleanOpsPolicy(Object.fromEntries(fd.entries()));
  if (!value) go("err=valor");
  const cur = await getOpsPolicy();
  if (JSON.stringify(cur.value) === JSON.stringify(value)) go("ok=igual");
  await db.marketSetting.create({ data: { key: OPS_POLICY_KEY, version: cur.version + 1, value: value as unknown as Prisma.InputJsonValue, updatedByName: user.name } });
  go("ok=politica");
}

export async function saveLocation(fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=permiso#bodegas");
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const country = String(fd.get("country") ?? "").trim().slice(0, 60) || null;
  if (!name) go("err=bodega#bodegas");
  if (id) {
    const active = fd.get("active") === "1";
    // A warehouse that still holds stock can't be switched off: the units would disappear from every screen.
    if (!active && await db.stockLot.count({ where: { locationId: id, outAt: null } })) go("err=bodega-stock#bodegas");
    await db.stockLocation.update({ where: { id }, data: { name, country, active } });
  } else {
    const key = name.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
    if (!key || await db.stockLocation.findUnique({ where: { key }, select: { id: true } })) go("err=bodega-repetida#bodegas");
    await db.stockLocation.create({ data: { key, name, country } });
  }
  go("ok=bodega#bodegas");
}
