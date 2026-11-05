import { db } from "./db";

// Universal search: customer (name or NIT), Journey (code, title, customer PO), invoice,
// supplier PO, delivery note and supplier. Shared by /buscar and "Pregúntale a SOLU".

export type Hit = { kind: "journey" | "customer" | "invoice" | "spo" | "delivery" | "supplier"; id: string; label: string; sub: string; href: string };

export async function universalSearch(q: string): Promise<Hit[]> {
  q = q.trim();
  if (!q) return [];
  const like = { contains: q, mode: "insensitive" as const };
  const [accounts, deals, invoices, spos, deliveries, suppliers] = await Promise.all([
    db.account.findMany({ where: { OR: [{ name: like }, { taxId: like }] }, take: 10, select: { id: true, name: true, taxId: true } }),
    db.deal.findMany({ where: { OR: [{ code: like }, { title: like }, { customerPo: like }] }, take: 15, include: { account: { select: { name: true } } } }),
    db.invoice.findMany({ where: { number: like }, take: 10, include: { account: { select: { name: true } } } }),
    db.supplierPO.findMany({ where: { code: like }, take: 10, include: { supplier: { select: { name: true } }, deal: { select: { id: true, code: true } } } }),
    db.delivery.findMany({ where: { OR: [{ code: like }, { receptionCode: like }] }, take: 10, include: { deal: { select: { code: true, account: { select: { name: true } } } } } }),
    db.supplier.findMany({ where: { name: like }, take: 10, select: { id: true, name: true, country: true } }),
  ]);
  return [
    ...deals.map((d) => ({ kind: "journey" as const, id: d.id, label: `${d.code ?? ""} · ${d.title}`, sub: `${d.account.name}${d.customerPo ? ` · OC ${d.customerPo}` : ""}`, href: `/deals/${d.id}` })),
    ...accounts.map((a) => ({ kind: "customer" as const, id: a.id, label: a.name, sub: a.taxId ? `NIT ${a.taxId}` : "", href: `/accounts/${a.id}` })),
    ...invoices.map((v) => ({ kind: "invoice" as const, id: v.id, label: v.number, sub: v.account.name, href: `/administracion/cobrar?f=${v.id}` })),
    ...spos.map((s) => ({ kind: "spo" as const, id: s.id, label: s.code, sub: `${s.supplier.name} · ${s.deal.code ?? ""}`, href: `/deals/${s.deal.id}` })),
    ...deliveries.map((r) => ({ kind: "delivery" as const, id: r.id, label: r.code, sub: `${r.deal.account.name} · ${r.deal.code ?? ""}`, href: `/operaciones/remisiones/${r.id}` })),
    ...suppliers.map((s) => ({ kind: "supplier" as const, id: s.id, label: s.name, sub: s.country ?? "", href: `/suppliers#${s.id}` })),
  ];
}
