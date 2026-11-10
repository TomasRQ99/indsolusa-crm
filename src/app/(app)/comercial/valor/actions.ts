"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { ATTR_STATUS } from "@/lib/proposal-rules";

// Comercial C5 §17 · value attribute catalog. Gerencia / Director Comercial review the 8 drafts and activate them.
// A text change raises the version; the audit log keeps the previous wording.

const go = (qs: string, hash = ""): never => { refreshApp(); redirect(`/comercial/valor?${qs}${hash ? `#${hash}` : ""}`); };
const txt = (fd: FormData, k: string, max = 600) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };

export async function saveAttribute(id: string, fd: FormData) {
  const user = await requireUser();
  if (!canManageAll(user)) go("err=permiso");
  const cur = await db.valueAttribute.findUnique({ where: { id } });
  if (!cur) go("err=atributo");
  const v = {
    nameEs: txt(fd, "nameEs", 80), nameEn: txt(fd, "nameEn", 80), definitionEs: txt(fd, "definitionEs"), definitionEn: txt(fd, "definitionEn"),
    appliesWhen: txt(fd, "appliesWhen", 400), restrictions: txt(fd, "restrictions", 400), evidenceHint: txt(fd, "evidenceHint", 400),
  };
  const status = txt(fd, "status", 10) ?? cur!.status;
  if (!v.nameEs || !v.nameEn || !v.definitionEs || !v.definitionEn || !ATTR_STATUS[status]) go("err=campos", `a-${id}`);
  const textChanged = (Object.keys(v) as (keyof typeof v)[]).some((k) => (v[k] ?? null) !== (cur![k] ?? null));
  await db.valueAttribute.update({ where: { id }, data: { ...v, nameEs: v.nameEs!, nameEn: v.nameEn!, definitionEs: v.definitionEs!, definitionEn: v.definitionEn!, status, version: textChanged ? cur!.version + 1 : cur!.version, updatedByName: user.name } });
  go("ok=guardado", `a-${id}`);
}
