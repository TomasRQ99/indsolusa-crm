// The "Localizar" step of a Need: which of the suppliers the company has already worked with is the best place to
// look for THIS piece. Facts only, each with its reason in plain words (owner, 2026-11-19: "usar la lista de
// proveedores con los que ha trabajado la empresa históricamente para ubicar la mejor opción"). No score is shown as
// a number: the order is explained by what SOLU knows about each supplier and this part.

import { db } from "./db";

type Txt = { es: string; en: string };
export type LocateOption = {
  supplierId: string; name: string; country: string | null; email: string | null;
  /** the strongest fact first */
  reasons: Txt[];
  lastCost: { amount: number; currency: string; at: Date } | null;
  leadText: string | null;
  rank: number;
};

const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const day = (d: Date, en: boolean) => d.toLocaleDateString(en ? "en-US" : "es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function locateOptions(dealId: string): Promise<{ options: LocateOption[]; codes: string[]; brands: string[]; totalSuppliers: number }> {
  const deal = await db.deal.findUnique({ where: { id: dealId }, select: { items: { select: { code: true } } } });
  const codes = [...new Set((deal?.items ?? []).map((x) => x.code?.trim()).filter((c): c is string => !!c))];
  const keys = codes.map(norm).filter(Boolean);
  const parts = keys.length ? await db.part.findMany({ where: { mpnKey: { in: keys } }, select: { id: true, brand: true, category: true } }) : [];
  const brands = [...new Set(parts.map((p) => p.brand).filter((b): b is string => !!b))];
  const partIds = parts.map((p) => p.id);

  const [suppliers, boughtLines, offers, brandOffers, received] = await Promise.all([
    db.supplier.findMany({ select: { id: true, name: true, country: true, email: true, transitDays: true } }),
    codes.length ? db.supplierPOLine.findMany({ where: { OR: codes.map((c) => ({ code: { equals: c, mode: "insensitive" as const } })), supplierPo: { releasedAt: { not: null } } }, orderBy: { supplierPo: { releasedAt: "desc" } }, take: 200, select: { unitCost: true, supplierPo: { select: { supplierId: true, currency: true, releasedAt: true } } } }) : [],
    partIds.length || codes.length ? db.supplierOffer.findMany({ where: { OR: [...(partIds.length ? [{ partId: { in: partIds } }] : []), ...codes.map((c) => ({ codeAsQuoted: { equals: c, mode: "insensitive" as const } }))] }, orderBy: { createdAt: "desc" }, take: 200, select: { supplierId: true, unitPrice: true, currency: true, createdAt: true, leadText: true, leadDaysMin: true, leadDaysMax: true } }) : [],
    brands.length ? db.supplierOffer.findMany({ where: { part: { brand: { in: brands } }, ...(partIds.length ? { partId: { notIn: partIds } } : {}) }, take: 400, select: { supplierId: true, part: { select: { brand: true } } } }) : [],
    db.supplierPO.groupBy({ by: ["supplierId"], where: { receivedAt: { not: null } }, _count: { _all: true }, _max: { receivedAt: true } }),
  ]);

  const out: LocateOption[] = [];
  for (const s of suppliers) {
    const bought = boughtLines.filter((l) => l.supplierPo.supplierId === s.id);
    const quoted = offers.filter((o) => o.supplierId === s.id);
    const sameBrand = [...new Set(brandOffers.filter((o) => o.supplierId === s.id).map((o) => o.part.brand).filter(Boolean))] as string[];
    const rec = received.find((r) => r.supplierId === s.id);
    const n = rec?._count._all ?? 0;
    if (!bought.length && !quoted.length && !sameBrand.length && n === 0) continue;
    const reasons: Txt[] = [];
    let lastCost: LocateOption["lastCost"] = null, leadText: string | null = null;
    if (bought.length) {
      const b = bought[0];
      lastCost = { amount: Number(b.unitCost), currency: b.supplierPo.currency, at: b.supplierPo.releasedAt! };
      reasons.push({ es: `Ya le compramos esta misma referencia ${bought.length === 1 ? "una vez" : `${bought.length} veces`}; la última el ${day(b.supplierPo.releasedAt!, false)} a ${b.supplierPo.currency} ${Number(b.unitCost).toFixed(2)} la unidad`, en: `We already bought this same part from them ${bought.length === 1 ? "once" : `${bought.length} times`}; last on ${day(b.supplierPo.releasedAt!, true)} at ${b.supplierPo.currency} ${Number(b.unitCost).toFixed(2)} each` });
    }
    if (quoted.length) {
      const o = quoted[0];
      if (!lastCost) lastCost = { amount: Number(o.unitPrice), currency: o.currency, at: o.createdAt };
      leadText = o.leadText ?? (o.leadDaysMin != null && o.leadDaysMax != null ? `${o.leadDaysMin}–${o.leadDaysMax} d` : null);
      reasons.push({ es: `Nos cotizó esta referencia el ${day(o.createdAt, false)} a ${o.currency} ${Number(o.unitPrice).toFixed(2)}${leadText ? ` · entrega ${leadText}` : ""}`, en: `They quoted this part on ${day(o.createdAt, true)} at ${o.currency} ${Number(o.unitPrice).toFixed(2)}${leadText ? ` · lead time ${leadText}` : ""}` });
    }
    if (sameBrand.length) reasons.push({ es: `Maneja la marca ${sameBrand.join(", ")} (nos ha cotizado otras referencias)`, en: `Carries the brand ${sameBrand.join(", ")} (has quoted us other parts)` });
    if (n > 0) reasons.push({ es: `${n} compra(s) recibida(s) de este proveedor; la última el ${day(rec!._max.receivedAt!, false)}`, en: `${n} purchase(s) received from this supplier; last on ${day(rec!._max.receivedAt!, true)}` });
    if (s.transitDays != null) reasons.push({ es: `Tránsito habitual: ${s.transitDays} días`, en: `Usual transit: ${s.transitDays} days` });
    const rank = (bought.length ? 1000 + Math.min(bought.length, 20) * 5 : 0) + (quoted.length ? 600 : 0) + (sameBrand.length ? 300 : 0) + Math.min(n, 50) * 2;
    out.push({ supplierId: s.id, name: s.name, country: s.country, email: s.email, reasons, lastCost, leadText, rank });
  }
  out.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  return { options: out, codes, brands, totalSuppliers: suppliers.length };
}
