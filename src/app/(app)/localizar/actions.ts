"use server";

import { redirect } from "next/navigation";
import { addWorkingDays } from "@/lib/holidays";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";
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

// ---------- One-click actions from a part ----------

const qtyOf = (fd: FormData) => Math.min(1_000_000, Math.max(1, Math.round(Number(String(fd.get("qty") ?? "1").replace(",", ".")) || 1)));
const priceOf = (fd: FormData) => {
  const v = Number(String(fd.get("unitPrice") ?? "").replace(",", "."));
  return Number.isFinite(v) && v >= 0 && v < 1e12 ? v : 0;
};
const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
/** Two working days from today (the usual time to get a supplier's answer). */
function inWorkingDays(n: number) {
  return addWorkingDays(today(), n);
}
const partLabel = (p: { mpn: string; name: string; brand: string | null }) => `${p.mpn} · ${p.name}${p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? ` (${p.brand})` : ""}`;

/** Puts the part on a Journey: a new one for a customer (starts at LEAD) or an existing one. */
export async function useInJourney(partId: string, fd: FormData) {
  const user = await requireUser();
  const p = await db.part.findUniqueOrThrow({ where: { id: partId } });
  const qty = qtyOf(fd), unitPrice = priceOf(fd);
  const dealRef = txt(fd, "dealId", 40);
  const accountId = txt(fd, "accountId", 40);
  const item = { qty, code: p.mpn, description: p.name.slice(0, 300), unitPrice };
  let dealId: string;
  if (dealRef) {
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealRef }, select: { id: true, ownerId: true, accountId: true } });
    if (!canEdit(user, deal.ownerId)) redirect(`/localizar/${partId}?err=permiso`);
    await db.dealItem.create({ data: { ...item, dealId: deal.id } });
    await db.activity.create({ data: { type: "NOTE", subject: `Agregado desde Localizar: ${qty} × ${partLabel(p)}`.slice(0, 200), userId: user.id, accountId: deal.accountId, dealId: deal.id, phase: "source", source: "Localizar repuestos" } });
    dealId = deal.id;
  } else {
    if (!accountId) redirect(`/localizar/${partId}?err=cliente`);
    const account = await db.account.findUniqueOrThrow({ where: { id: accountId! }, select: { id: true } });
    const deal = await db.$transaction(async (tx) => {
      const code = await nextCode("J", "deal", tx);
      return tx.deal.create({ data: { code, title: `${p.name} (${p.mpn})`.slice(0, 200), accountId: account.id, ownerId: user.id, stage: "LEAD", amount: qty * unitPrice, needSpecs: `${qty} × ${partLabel(p)}`.slice(0, 1000), items: { create: item } } });
    });
    await db.activity.create({ data: { type: "NOTE", subject: `Necesidad creada desde Localizar repuestos: ${partLabel(p)}`.slice(0, 200), userId: user.id, accountId: account.id, dealId: deal.id, phase: "need", source: "Localizar repuestos" } });
    dealId = deal.id;
  }
  refreshApp();
  redirect(`/deals/${dealId}?tab=source`);
}

/** Adds the part as a line to a quote that is still a draft. */
export async function addToQuote(partId: string, fd: FormData) {
  const user = await requireUser();
  const p = await db.part.findUniqueOrThrow({ where: { id: partId } });
  const quoteId = txt(fd, "quoteId", 40);
  const q = quoteId ? await db.quote.findUnique({ where: { id: quoteId }, select: { id: true, status: true, deal: { select: { ownerId: true } } } }) : null;
  if (!q || q.status !== "DRAFT") redirect(`/localizar/${partId}?err=cotizacion`);
  if (!canEdit(user, q!.deal.ownerId)) redirect(`/localizar/${partId}?err=permiso`);
  await db.quoteLine.create({ data: { quoteId: q!.id, qty: qtyOf(fd), code: p.mpn, description: p.name.slice(0, 300), unitPrice: priceOf(fd), position: await db.quoteLine.count({ where: { quoteId: q!.id } }) } });
  refreshApp();
  redirect(`/cotizaciones/${q!.id}?ok=linea`);
}

/** A reminder in "Pendientes" (and Mi Día): ask a supplier for a price, or follow up with a customer. */
export async function partReminder(partId: string, fd: FormData) {
  const user = await requireUser();
  const p = await db.part.findUniqueOrThrow({ where: { id: partId } });
  const kind = fd.get("kind") === "FOLLOW" ? "FOLLOW" : "PRICE";
  const dealId = txt(fd, "dealId", 40);
  const deal = dealId ? await db.deal.findUnique({ where: { id: dealId }, select: { id: true, accountId: true } }) : null;
  const supplierId = txt(fd, "supplierId", 40);
  const supplier = supplierId ? await db.supplier.findUnique({ where: { id: supplierId }, select: { name: true } }) : null;
  const accountId = deal?.accountId ?? txt(fd, "accountId", 40);
  const account = accountId ? await db.account.findUnique({ where: { id: accountId }, select: { id: true, name: true } }) : null;
  const qty = qtyOf(fd);
  const title = kind === "PRICE"
    ? `Pedir precio y plazo: ${qty} × ${partLabel(p)}${supplier ? ` a ${supplier.name}` : ""}`
    : `Seguimiento${account ? ` con ${account.name}` : ""}: ${partLabel(p)}`;
  await db.task.create({ data: { title: title.slice(0, 200), dueDate: dayOf(fd.get("dueDate")) ?? inWorkingDays(kind === "PRICE" ? 1 : 2), assigneeId: user.id, dealId: deal?.id ?? null, accountId: account?.id ?? null } });
  if (deal) await db.activity.create({ data: { type: "NOTE", subject: title.slice(0, 200), userId: user.id, accountId: deal.accountId, dealId: deal.id, phase: kind === "PRICE" ? "source" : "need", source: "Localizar repuestos" } });
  refreshApp();
  redirect(`/localizar/${partId}?ok=${kind === "PRICE" ? "rfq" : "seguimiento"}${deal ? `&deal=${deal.id}` : ""}`);
}

/** Brings new quote / Journey / PO codes into the catalog now (it also happens on its own every 10 minutes). */
export async function syncCatalog() {
  const user = await requireUser();
  if (!canManageAll(user)) redirect("/localizar?err=permiso");
  const r = await syncCatalogFromHistory();
  refreshApp();
  redirect(`/localizar?ok=sync&c=${r.created}&a=${r.linked}`);
}
