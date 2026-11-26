"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { MAX_SIGNATURE_BYTES, MAX_SIGNATURES, SIGNATURE_MIMES } from "@/lib/signatures";

// Mi perfil → Firmas de correo. Every action touches only the signatures of the person who is logged in.

const go = (qs: string): never => { refreshApp(); redirect(`/profile?${qs}#firmas`); };
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

export async function addSignature(fd: FormData) {
  const user = await requireUser();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) go("err=firma-archivo");
  const f = file as File;
  if (!SIGNATURE_MIMES.includes(f.type)) go("err=firma-tipo");
  if (f.size > MAX_SIGNATURE_BYTES) go("err=firma-peso");
  const count = await db.mailSignature.count({ where: { userId: user.id } });
  if (count >= MAX_SIGNATURES) go("err=firma-tope");
  const name = clean(fd.get("name")) || f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Firma";
  // The first one becomes the usual one; later ones only when the person ticks it.
  const makeDefault = count === 0 || fd.get("isDefault") === "1";
  await db.$transaction(async (tx) => {
    if (makeDefault) await tx.mailSignature.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await tx.mailSignature.create({ data: { userId: user.id, name, mime: f.type, size: f.size, data: new Uint8Array(await f.arrayBuffer()), isDefault: makeDefault } });
  });
  go("ok=firma");
}

export async function setDefaultSignature(id: string) {
  const user = await requireUser();
  const mine = await db.mailSignature.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!mine) go("err=firma-archivo");
  await db.$transaction([
    db.mailSignature.updateMany({ where: { userId: user.id }, data: { isDefault: false } }),
    db.mailSignature.update({ where: { id }, data: { isDefault: true } }),
  ]);
  go("ok=firma-usual");
}

export async function renameSignature(id: string, fd: FormData) {
  const user = await requireUser();
  const name = clean(fd.get("name"));
  if (!name) go("err=firma-nombre");
  await db.mailSignature.updateMany({ where: { id, userId: user.id }, data: { name } });
  go("ok=firma-nombre");
}

export async function removeSignature(id: string) {
  const user = await requireUser();
  const mine = await db.mailSignature.findFirst({ where: { id, userId: user.id }, select: { isDefault: true } });
  if (!mine) go("ok=firma-quitada");
  await db.mailSignature.delete({ where: { id } });
  // If the usual one was removed, the oldest one left takes its place.
  if (mine!.isDefault) {
    const next = await db.mailSignature.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (next) await db.mailSignature.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  go("ok=firma-quitada");
}
