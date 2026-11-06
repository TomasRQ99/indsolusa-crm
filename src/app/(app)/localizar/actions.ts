"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { CATEGORIES, brandIn, categoryIn } from "@/lib/part-lexicon";
import { mergeParts, partKey, syncCatalogFromHistory } from "@/lib/parts";

const txt = (fd: FormData, k: string, max = 300) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const ALIAS_KINDS = ["OEM", "AFTERMARKET", "CROSSREF", "SUPERSEDED", "VARIANT", "NAME"];
const CONDITIONS = ["NEW", "REFURBISHED", "USED"];
const LIFECYCLES = ["ACTIVE", "DISCONTINUED", "OBSOLETE"];
const pick = (v: string | null, allowed: string[]) => (v && allowed.includes(v) ? v : null);

/** Adds a part the company doesn't have yet (anyone on the team can). */
export async function createPart(fd: FormData) {
  const user = await requireUser();
  const mpn = txt(fd, "mpn", 80);
  const name = txt(fd, "name");
  const key = mpn ? partKey(mpn) : "";
  if (!mpn || !name || key.length < 2) redirect(`/localizar?q=${encodeURIComponent(mpn ?? name ?? "")}&err=falta`);
  const taken = (await db.part.findUnique({ where: { mpnKey: key }, select: { id: true, mergedIntoId: true } })) ?? (await db.partAlias.findFirst({ where: { codeKey: key }, select: { partId: true } }).then((a) => (a ? { id: a.partId, mergedIntoId: null } : null)));
  if (taken) redirect(`/localizar/${taken.mergedIntoId ?? taken.id}?err=existe`);
  const brand = txt(fd, "brand", 80) ?? brandIn(name!) ?? null;
  const p = await db.part.create({
    data: { mpn: mpn!, mpnKey: key, name: name!, brand, category: pick(txt(fd, "category", 30), Object.keys(CATEGORIES)) ?? categoryIn(name!) ?? null, createdByName: user.name },
  });
  refreshApp();
  redirect(`/localizar/${p.id}?ok=creado`);
}

/** Edits the part's identity (number, brand, names, line, condition, lifecycle, compatibility). */
export async function updatePart(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await db.part.findUniqueOrThrow({ where: { id } });
  const mpn = txt(fd, "mpn", 80) ?? p.mpn;
  const key = partKey(mpn);
  const name = txt(fd, "name") ?? p.name;
  if (key.length < 2) redirect(`/localizar/${id}?err=falta`);
  if (key !== p.mpnKey) {
    const clash = await db.part.findUnique({ where: { mpnKey: key }, select: { id: true } });
    if (clash) redirect(`/localizar/${id}?err=numero&otro=${clash.id}`);
  }
  const compat = String(fd.get("compatibleModels") ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 40);
  await db.$transaction(async (tx) => {
    // The old number keeps working: it becomes a SUPERSEDED alias.
    if (key !== p.mpnKey && !(await tx.partAlias.findUnique({ where: { partId_codeKey: { partId: id, codeKey: p.mpnKey } } })))
      await tx.partAlias.create({ data: { partId: id, code: p.mpn, codeKey: p.mpnKey, kind: "SUPERSEDED", source: `Número anterior · ${user.name}`, createdByName: user.name } });
    await tx.partAlias.deleteMany({ where: { partId: id, codeKey: key } });
    await tx.part.update({
      where: { id },
      data: {
        mpn, mpnKey: key, name,
        nameEn: txt(fd, "nameEn"), brand: txt(fd, "brand", 80),
        category: pick(txt(fd, "category", 30), Object.keys(CATEGORIES)),
        condition: pick(txt(fd, "condition", 20), CONDITIONS),
        lifecycle: pick(txt(fd, "lifecycle", 20), LIFECYCLES),
        gtin: txt(fd, "gtin", 20), compatibleModels: compat, notes: txt(fd, "notes", 1000),
      },
    });
  });
  refreshApp();
  redirect(`/localizar/${id}?ok=guardado`);
}

/** Records another number or name the same part is known by. */
export async function addAlias(id: string, fd: FormData) {
  const user = await requireUser();
  const code = txt(fd, "code", 120);
  const kind = pick(txt(fd, "kind", 20), ALIAS_KINDS) ?? "CROSSREF";
  if (!code) redirect(`/localizar/${id}?err=alias`);
  const codeKey = partKey(code!);
  if (codeKey.length < 2) redirect(`/localizar/${id}?err=alias`);
  const p = await db.part.findUniqueOrThrow({ where: { id }, select: { mpnKey: true } });
  if (kind !== "NAME") {
    const other = (await db.part.findFirst({ where: { mpnKey: codeKey, id: { not: id }, mergedIntoId: null }, select: { id: true } })) ?? (await db.partAlias.findFirst({ where: { codeKey, partId: { not: id }, kind: { not: "NAME" } }, select: { partId: true } }).then((a) => (a ? { id: a.partId } : null)));
    // Same number on another part: probably a duplicate. Don't link silently; offer the merge.
    if (other) redirect(`/localizar/${id}?err=enotro&otro=${other.id}`);
  }
  if (codeKey === p.mpnKey) redirect(`/localizar/${id}?ok=ya`);
  await db.partAlias.upsert({
    where: { partId_codeKey: { partId: id, codeKey } },
    create: { partId: id, code: code!, codeKey, kind, brand: txt(fd, "brand", 80), source: txt(fd, "source", 200), createdByName: user.name },
    update: {},
  });
  refreshApp();
  redirect(`/localizar/${id}?ok=alias`);
}

export async function removeAlias(id: string, aliasId: string) {
  const user = await requireUser();
  const a = await db.partAlias.findUniqueOrThrow({ where: { id: aliasId } });
  if (a.partId !== id || (!canManageAll(user) && a.createdByName !== user.name)) redirect(`/localizar/${id}?err=permiso`);
  await db.partAlias.delete({ where: { id: aliasId } });
  refreshApp();
  redirect(`/localizar/${id}?ok=quitado`);
}

/** Merges a duplicate into this part (managers only). The duplicate's number keeps finding this part. */
export async function mergeInto(canonicalId: string, fd: FormData) {
  const user = await requireUser();
  if (!canManageAll(user)) redirect(`/localizar/${canonicalId}?err=permiso`);
  const ref = txt(fd, "dup", 80);
  const dup = ref
    ? (await db.part.findUnique({ where: { id: ref } })) ?? (await db.part.findUnique({ where: { mpnKey: partKey(ref) } }))
    : null;
  if (!dup || dup.id === canonicalId || dup.mergedIntoId) redirect(`/localizar/${canonicalId}?err=dup`);
  await mergeParts(dup!.id, canonicalId, user.name);
  refreshApp();
  redirect(`/localizar/${canonicalId}?ok=fusionado&n=${encodeURIComponent(dup!.mpn)}`);
}

/** Brings new quote / Journey / PO codes into the catalog now (it also happens on its own every 10 minutes). */
export async function syncCatalog() {
  const user = await requireUser();
  if (!canManageAll(user)) redirect("/localizar?err=permiso");
  const r = await syncCatalogFromHistory();
  refreshApp();
  redirect(`/localizar?ok=sync&c=${r.created}&a=${r.linked}`);
}
