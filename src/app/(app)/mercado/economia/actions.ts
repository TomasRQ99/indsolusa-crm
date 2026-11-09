"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";

/** A company from a dataset becomes a prospect (Account) owned by whoever adds it; linked by NIT. Never twice. */
export async function addAsProspect(companyId: string) {
  const user = await requireUser();
  const c = await db.marketCompany.findUnique({ where: { id: companyId } });
  if (!c) redirect("/mercado/economia");
  if (c!.accountId) redirect(`/mercado/empresas/${c!.accountId}`);
  const same = (await db.account.findMany({ where: { taxId: { not: null } }, select: { id: true, taxId: true } })).find((a) => (a.taxId ?? "").replace(/\D/g, "").slice(0, 9) === c!.nit);
  const accountId = same?.id ?? (await db.account.create({ data: { name: c!.name, taxId: c!.nit, industry: c!.sector, address: [c!.city, c!.department].filter(Boolean).join(", ") || null, ownerId: user.id } })).id;
  await db.marketCompany.update({ where: { id: c!.id }, data: { accountId } });
  refreshApp();
  redirect(`/mercado/empresas/${accountId}?ok=prospecto`);
}
