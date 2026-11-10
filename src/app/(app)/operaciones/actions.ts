"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEditOps, canEditOps } from "@/lib/permissions";
import { money2 } from "@/lib/money";
import { EXC_KINDS, IMPACT_AREAS } from "@/lib/ops-rules";
import { optionalDate, optionalText, parseForm, requiredText } from "@/lib/forms";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";

const money = z.coerce.number().min(0).max(1e12);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "3-letter currency code").default("USD");

async function dealOwnerCheck(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true } });
  assertCanEditOps(user, deal.ownerId);
  return user;
}

// ---------- Supplier POs ----------

export async function createSupplierPo(dealId: string, formData: FormData) {
  await dealOwnerCheck(dealId);
  const data = parseForm(
    z.object({ supplierId: z.string().min(1, "Pick a supplier"), amount: money, currency, eta: optionalDate }),
    formData,
  );
  await db.$transaction(async (tx) => {
    const code = await nextCode("SPO", "supplierPO", tx);
    await tx.supplierPO.create({ data: { ...data, code, dealId } });
  });
  refreshApp();
}

const spoStep = z.enum(["confirmedAt", "shippedAt", "receivedAt"]);

export async function markSupplierPo(spoId: string, step: z.infer<typeof spoStep>, formData: FormData) {
  const spo = await db.supplierPO.findUniqueOrThrow({ where: { id: spoId }, select: { dealId: true } });
  await dealOwnerCheck(spo.dealId);
  const { eta } = parseForm(z.object({ eta: optionalDate }), formData);
  await db.supplierPO.update({
    where: { id: spoId },
    data: { [spoStep.parse(step)]: today(), ...(eta ? { eta } : {}) },
  });
  refreshApp();
}

// ---------- Deliveries (remisiones) ----------

export async function createDelivery(dealId: string, formData: FormData) {
  await dealOwnerCheck(dealId);
  const base = parseForm(
    z.object({
      deliveredAt: z.string().min(1).transform((v) => new Date(v)),
      place: optionalText,
      deliveredBy: optionalText,
      receivedByName: optionalText,
      receptionCode: optionalText,
      notes: optionalText,
    }),
    formData,
  );
  const podReceived = formData.get("podReceived") === "on";
  const items = await db.dealItem.findMany({ where: { dealId }, include: { deliveryLines: { select: { qty: true } } } });

  const lines: { dealItemId: string; qty: number; serials: string | null }[] = [];
  for (const it of items) {
    const qty = Number(formData.get(`qty_${it.id}`) || 0);
    if (!qty) continue;
    const delivered = it.deliveryLines.reduce((s, l) => s + l.qty, 0);
    if (!Number.isInteger(qty) || qty < 0 || qty > it.qty - delivered) {
      throw new Error(`${it.description}: max ${it.qty - delivered}`);
    }
    const serials = String(formData.get(`serials_${it.id}`) ?? "").trim() || null;
    lines.push({ dealItemId: it.id, qty, serials });
  }
  if (items.length > 0 && lines.length === 0) throw new Error("Indica al menos una cantidad entregada / Enter at least one delivered quantity.");

  const created = await db.$transaction(async (tx) => {
    const code = await nextCode("REM", "delivery", tx);
    return tx.delivery.create({ data: { ...base, podReceived, code, dealId, lines: { create: lines } } });
  });
  refreshApp();
  redirect(`/operaciones/remisiones/${created.id}`);
}

export async function updateDelivery(id: string, formData: FormData) {
  const d = await db.delivery.findUniqueOrThrow({ where: { id }, select: { dealId: true, invoice: { select: { id: true } } } });
  await dealOwnerCheck(d.dealId);
  const data = parseForm(
    z.object({ receivedByName: optionalText, receptionCode: optionalText, notes: optionalText, place: optionalText }),
    formData,
  );
  await db.delivery.update({ where: { id }, data: { ...data, podReceived: formData.get("podReceived") === "on" } });
  refreshApp();
}

// ---------- Suppliers ----------

const supplierSchema = z.object({
  name: requiredText,
  country: optionalText,
  currency,
  email: optionalText,
  phone: optionalText,
  // Public website (for finding part pages via its sitemap). "acme.com" becomes "https://acme.com".
  website: optionalText.transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v)),
  // NIT / tax ID: a customer with the same NIT is the same organization (Mercado §4.3).
  taxId: optionalText,
});

export async function createSupplier(formData: FormData) {
  await requireUser();
  const data = parseForm(supplierSchema, formData);
  // Bank data typed here is a starting point only: it stays unverified until an
  // independent verification confirms it on the first payment.
  const bank = parseForm(
    z.object({ bankBeneficiary: optionalText, bankName: optionalText, bankAccount: optionalText, bankSwift: optionalText }),
    formData,
  );
  await db.supplier.create({ data: { ...data, ...bank } });
  refreshApp();
}

export async function updateSupplier(id: string, formData: FormData) {
  await requireUser();
  const data = parseForm(supplierSchema, formData);
  await db.supplier.update({ where: { id }, data });
  refreshApp();
}

// ---------- O0 · Operational exceptions (module 11 §50, §48) ----------

const exTxt = (fd: FormData, k: string, max = 600) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };

/** Record a deviation that needs a decision. It can't be saved as a bare alert: expected, actual, the recommended
 *  next move, an owner and a deadline are required (AC35). Touching promise, scope, price, compliance or the
 *  relationship brings Comercial in once, through the Journey owner (Commercial Impact Gate). */
export async function openException(fd: FormData) {
  const user = await requireUser();
  const back = String(fd.get("back") ?? "/operaciones");
  const to = back.startsWith("/operaciones") || back.startsWith("/deals/") ? back : "/operaciones";
  const go = (qs: string): never => { refreshApp(); redirect(`${to}${to.includes("?") ? "&" : "?"}${qs}`); };
  const dealId = String(fd.get("dealId") ?? "");
  const deal = dealId ? await db.deal.findUnique({ where: { id: dealId }, select: { id: true, ownerId: true, accountId: true, code: true, title: true } }) : null;
  if (!deal) go("err=exc-journey");
  if (!canEditOps(user, deal!.ownerId)) go("err=exc-permiso");
  const kind = String(fd.get("kind") ?? "");
  const whatHappened = exTxt(fd, "whatHappened", 300), expected = exTxt(fd, "expected", 300), actual = exTxt(fd, "actual", 300), recommended = exTxt(fd, "recommended", 300);
  const ownerId = String(fd.get("ownerId") ?? "");
  const day = String(fd.get("deadline") ?? "");
  const owner = ownerId ? await db.user.findFirst({ where: { id: ownerId, active: true }, select: { id: true } }) : null;
  if (!EXC_KINDS[kind] || !whatHappened || !expected || !actual || !recommended || !owner || !/^\d{4}-\d{2}-\d{2}$/.test(day)) go("err=exc-campos#excepcion");
  const areas = Object.keys(IMPACT_AREAS).filter((a) => fd.get(`area_${a}`) === "1");
  const econ = Number(String(fd.get("economicImpactUsd") ?? "").replace(",", "."));
  const options = [0, 1, 2].map((k) => exTxt(fd, `option_${k}`, 200)).filter((x): x is string => !!x);
  await db.$transaction(async (tx) => {
    await tx.operationalException.create({ data: {
      dealId: deal!.id, kind, whatHappened: whatHappened!, expected: expected!, actual: actual!, recommended: recommended!, ownerId: owner!.id, deadline: new Date(`${day}T00:00:00Z`),
      customerImpact: exTxt(fd, "customerImpact", 300), economicImpactUsd: Number.isFinite(econ) && econ !== 0 ? money2(econ) : null, evidence: exTxt(fd, "evidence", 300), rootHypothesis: exTxt(fd, "rootHypothesis", 300),
      options, impactAreas: areas, createdByName: user.name,
    } });
    await tx.activity.create({ data: { type: "NOTE", subject: `Excepción operativa: ${whatHappened}`.slice(0, 200), body: `Esperado: ${expected}\nReal: ${actual}\nPróximo paso: ${recommended}`, userId: user.id, dealId: deal!.id, accountId: deal!.accountId, phase: "execute", source: "Operaciones" } });
    // Commercial Impact Gate: one task for the relationship owner, only when the customer side is touched.
    if (areas.length && deal!.ownerId !== user.id) await tx.task.create({ data: { title: `Operaciones: ${whatHappened} (${deal!.code ?? deal!.title})`.slice(0, 200), assigneeId: deal!.ownerId, dealId: deal!.id, accountId: deal!.accountId, dueDate: new Date(`${day}T00:00:00Z`) } });
  });
  go("ok=exc-abierta");
}

export async function resolveException(id: string, fd: FormData) {
  const user = await requireUser();
  const e = await db.operationalException.findUnique({ where: { id }, select: { id: true, status: true, ownerId: true, dealId: true, whatHappened: true, deal: { select: { ownerId: true, accountId: true } } } });
  const go = (qs: string): never => { refreshApp(); redirect(`/operaciones?${qs}`); };
  if (!e) go("err=exc-journey");
  if (!(user.id === e!.ownerId || canEditOps(user, e!.deal.ownerId))) go("err=exc-permiso");
  const resolution = exTxt(fd, "resolution", 400);
  if (!resolution) go(`err=exc-resolucion#x-${id}`);
  if (e!.status === "OPEN") await db.$transaction([
    db.operationalException.update({ where: { id }, data: { status: "RESOLVED", resolution, resolvedAt: new Date(), resolvedByName: user.name } }),
    db.activity.create({ data: { type: "NOTE", subject: `Excepción resuelta: ${e!.whatHappened}`.slice(0, 200), body: resolution, userId: user.id, dealId: e!.dealId, accountId: e!.deal.accountId, phase: "execute", source: "Operaciones" } }),
  ]);
  go("ok=exc-resuelta");
}
