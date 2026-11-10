import { db } from "./db";
import { addDays, today } from "./domain";
import { subMoney, sumMoney } from "./money";
import { DEFAULT_OPS_POLICY, OPS_POLICY_KEY, promiseHealth, type OpsPolicy } from "./ops-rules";
import { DEFAULT_GRACE_DAYS, commitmentReading } from "./commitment-rules";

// Operaciones O0 · Operations Home and Future (module 11 §46–47; AC37). Built over records that already exist:
// exceptions first, then what is ready to move, promises at risk, healthy waits and resource exposure.
// Volume of open orders is never the headline.

export async function getOpsPolicy(): Promise<{ value: OpsPolicy; version: number }> {
  const s = await db.marketSetting.findFirst({ where: { key: OPS_POLICY_KEY }, orderBy: { version: "desc" } });
  return s ? { value: { ...DEFAULT_OPS_POLICY, ...(s.value as Partial<OpsPolicy>) }, version: s.version } : { value: DEFAULT_OPS_POLICY, version: 0 };
}

const dealSel = { id: true, code: true, title: true, account: { select: { name: true } }, owner: { select: { name: true } } } as const;
type DealRef = { id: string; code: string | null; title: string; account: { name: string }; owner: { name: string } };
export type OpsRow = { key: string; href: string; deal: DealRef; what: { es: string; en: string }; at: Date | null; amount?: number; note?: string | null };

export async function opsHome() {
  const T = today();
  const { value: pol } = await getOpsPolicy();
  const soon = addDays(T, pol.upcomingDays);
  const [exceptions, holds, uncertain, toBuy, drafts, payReady, payToVerify, toPickUp, received, toInvoice, promised, waitingPos, waitingDeals, openPos, upcomingPay, invoices] = await Promise.all([
    db.operationalException.findMany({ where: { status: "OPEN" }, orderBy: { deadline: "asc" }, include: { deal: { select: dealSel }, owner: { select: { name: true } } } }),
    db.shipment.findMany({ where: { deliveredAt: null, OR: [{ customs: "HOLD" }, { receipt: "DISPUTED" }] }, select: { id: true, code: true, customs: true, customsNote: true, disputeNote: true, deal: { select: dealSel } } }),
    db.paymentExecution.findMany({ where: { state: "UNCERTAIN", resolvedAt: null }, select: { id: true, amount: true, sentAt: true, payment: { select: { id: true, supplierPo: { select: { code: true, deal: { select: dealSel } } } } } } }),
    db.deal.findMany({ where: { poAcceptedAt: { not: null }, resultAchievedAt: null, stage: { not: "LOST" }, supplierPos: { none: {} } }, orderBy: { poAcceptedAt: "asc" }, select: { ...dealSel, poAcceptedAt: true, promisedDate: true } }),
    db.supplierPO.findMany({ where: { releasedAt: null, receivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, code: true, amount: true, createdAt: true, supplier: { select: { name: true } }, deal: { select: dealSel } } }),
    db.supplierPayment.findMany({ where: { approvedAt: { not: null }, executedAt: null }, orderBy: { dueBy: "asc" }, select: { id: true, amountUsd: true, dueBy: true, supplierPo: { select: { code: true, deal: { select: dealSel } } } } }),
    db.supplierPayment.findMany({ where: { approvedAt: null, executedAt: null }, orderBy: { dueBy: "asc" }, select: { id: true, amountUsd: true, dueBy: true, verifiedAt: true, supplierPo: { select: { code: true, deal: { select: dealSel } } } } }),
    db.shipment.findMany({ where: { rtsAt: { not: null }, pickedUpAt: null, deliveredAt: null }, orderBy: { rtsAt: "asc" }, select: { id: true, code: true, rtsAt: true, plannedPickup: true, deal: { select: dealSel } } }),
    db.shipment.findMany({ where: { receipt: "CONFIRMED", toCustomer: false, deliveryId: null, deal: { resultAchievedAt: null, deliveries: { none: {} } } }, orderBy: { receivedAt: "asc" }, select: { id: true, code: true, receivedAt: true, deal: { select: dealSel } } }),
    db.delivery.findMany({ where: { invoice: null }, orderBy: { deliveredAt: "asc" }, select: { id: true, code: true, deliveredAt: true, deal: { select: dealSel } } }),
    db.deal.findMany({ where: { promisedDate: { not: null }, poAcceptedAt: { not: null }, resultAchievedAt: null, stage: { not: "LOST" }, deliveries: { none: {} } }, select: { ...dealSel, promisedDate: true, amount: true, shipments: { where: { deliveredAt: null }, select: { carrierEta: true, plannedDelivery: true, toCustomer: true } }, supplierPos: { where: { receivedAt: null }, select: { eta: true } } } }),
    db.supplierPO.findMany({ where: { releasedAt: { not: null }, receivedAt: null, eta: { gt: T } }, orderBy: { eta: "asc" }, select: { id: true, code: true, eta: true, supplier: { select: { name: true } }, deal: { select: dealSel } } }),
    db.deal.findMany({ where: { poAcceptedAt: { not: null }, resultAchievedAt: null, waitingFor: { not: null }, waitingUntil: { gt: T } }, orderBy: { waitingUntil: "asc" }, select: { ...dealSel, waitingFor: true, waitingUntil: true } }),
    db.supplierPO.findMany({ where: { releasedAt: { not: null }, receivedAt: null }, select: { amount: true, currency: true, supplierId: true, supplier: { select: { name: true } }, payments: { where: { executedAt: { not: null } }, select: { amountUsd: true } } } }),
    db.supplierPayment.findMany({ where: { executedAt: null, dueBy: { lte: soon } }, select: { amountUsd: true } }),
    db.invoice.findMany({ select: { amount: true, dueAt: true, applications: { select: { amount: true } } } }),
  ]);

  // Customer promise vs what is currently expected (the carrier's date informs, never replaces, the promise).
  const promises = promised.map((d) => {
    const dates = [...d.shipments.map((s) => s.carrierEta ?? s.plannedDelivery), ...(d.shipments.length ? [] : d.supplierPos.map((p) => p.eta))].filter((x): x is Date => !!x);
    const expected = dates.length ? new Date(Math.max(...dates.map((x) => +x))) : null;
    const h = promiseHealth(d.promisedDate!, expected, T, pol);
    return { deal: d as DealRef, promise: d.promisedDate!, expected, amount: Number(d.amount), ...h };
  });
  const order = { BREACHED: 0, AT_RISK: 1, NARROW: 2, UNKNOWN: 3, PROTECTED: 4 } as const;
  const atRisk = promises.filter((p) => p.health !== "PROTECTED").sort((a, b) => order[a.health] - order[b.health] || +a.promise - +b.promise);

  const row = (key: string, href: string, deal: DealRef, es: string, en: string, at: Date | null, amount?: number, note?: string | null): OpsRow => ({ key, href, deal, what: { es, en }, at, amount, note });
  // O4b: supplier commitments. Ahead of their date they are healthy waits; past the grace days without evidence, attention.
  const commits = await db.supplierCommitment.findMany({ where: { status: { in: ["REPORTED", "COMMITTED"] }, expectedDate: { not: null }, supplierPo: { receivedAt: null } }, orderBy: { expectedDate: "asc" }, select: { id: true, label: true, status: true, expectedDate: true, supplierPo: { select: { id: true, code: true, supplier: { select: { name: true } }, deal: { select: dealSel } } } } });
  const readC = commits.map((c) => ({ c, r: commitmentReading(c, T, DEFAULT_GRACE_DAYS) }));
  const attention: OpsRow[] = [
    ...readC.filter((x) => x.r.reading === "MISSED").map(({ c, r }) => row(`cm-${c.id}`, `/compras/${c.supplierPo.id}#compromisos`, c.supplierPo.deal, `${c.supplierPo.supplier.name}: «${c.label}» de ${c.supplierPo.code} sin evidencia ${r.days} día(s) después de la fecha`, `${c.supplierPo.supplier.name}: “${c.label}” of ${c.supplierPo.code} without evidence ${r.days} day(s) after the date`, c.expectedDate)),
    ...holds.map((s) => row(`h-${s.id}`, `/logistica/${s.id}`, s.deal, s.customs === "HOLD" ? "Envío retenido en aduana" : "Recepción en disputa", s.customs === "HOLD" ? "Shipment held at customs" : "Receipt in dispute", null, undefined, s.customs === "HOLD" ? s.customsNote : s.disputeNote)),
    ...uncertain.map((x) => row(`u-${x.id}`, `/administracion/pagos-proveedores/${x.payment.id}`, x.payment.supplierPo.deal, "Pago enviado sin confirmar: no reenviar hasta verificar con el banco", "Payment sent but unconfirmed: don't resend until checked with the bank", x.sentAt, Number(x.amount))),
  ];
  const ready: OpsRow[] = [
    ...readC.filter((x) => x.r.reading === "DUE").map(({ c }) => row(`cd-${c.id}`, `/compras/${c.supplierPo.id}#compromisos`, c.supplierPo.deal, `${c.supplierPo.supplier.name}: confirmar con evidencia «${c.label}» de ${c.supplierPo.code}`, `${c.supplierPo.supplier.name}: confirm with evidence “${c.label}” of ${c.supplierPo.code}`, c.expectedDate)),
    ...toBuy.map((d) => row(`b-${d.id}`, `/compras?deal=${d.id}`, d, "PO del cliente aceptada: falta la compra al proveedor", "Customer PO accepted: the supplier purchase is missing", d.poAcceptedAt)),
    ...drafts.map((p) => row(`d-${p.id}`, `/compras/${p.id}`, p.deal, `Compra ${p.code} a ${p.supplier.name} sin liberar`, `Purchase ${p.code} to ${p.supplier.name} not released`, p.createdAt, Number(p.amount))),
    ...payToVerify.map((p) => row(`v-${p.id}`, `/administracion/pagos-proveedores/${p.id}`, p.supplierPo.deal, p.verifiedAt ? `Pago de ${p.supplierPo.code} verificado: falta aprobarlo` : `Pago de ${p.supplierPo.code}: falta verificar los datos bancarios`, p.verifiedAt ? `Payment for ${p.supplierPo.code} verified: approval pending` : `Payment for ${p.supplierPo.code}: bank details to verify`, p.dueBy, Number(p.amountUsd))),
    ...payReady.map((p) => row(`p-${p.id}`, `/administracion/pagos-proveedores/${p.id}`, p.supplierPo.deal, `Pago de ${p.supplierPo.code} aprobado: falta ejecutarlo`, `Payment for ${p.supplierPo.code} approved: execution pending`, p.dueBy, Number(p.amountUsd))),
    ...toPickUp.map((s) => row(`k-${s.id}`, `/logistica/${s.id}`, s.deal, `Envío ${s.code} listo en origen: falta la recogida`, `Shipment ${s.code} ready at origin: pickup pending`, s.plannedPickup ?? s.rtsAt)),
    ...received.map((s) => row(`r-${s.id}`, `/deals/${s.deal.id}/despacho`, s.deal, `Mercancía recibida (${s.code}): falta despachar al cliente`, `Goods received (${s.code}): dispatch to the customer pending`, s.receivedAt)),
    ...toInvoice.map((d) => row(`i-${d.id}`, `/deals/${d.deal.id}/facturacion`, d.deal, `Entrega ${d.code} hecha: falta facturar`, `Delivery ${d.code} done: invoice pending`, d.deliveredAt)),
  ];
  const waiting: OpsRow[] = [
    ...readC.filter((x) => x.r.reading === "WAITING").map(({ c }) => row(`cw-${c.id}`, `/compras/${c.supplierPo.id}#compromisos`, c.supplierPo.deal, `${c.supplierPo.supplier.name}: ${c.label} (${c.supplierPo.code})${c.status === "COMMITTED" ? " · comprometido" : " · informado"}`, `${c.supplierPo.supplier.name}: ${c.label} (${c.supplierPo.code})${c.status === "COMMITTED" ? " · committed" : " · reported"}`, c.expectedDate)),
    ...waitingPos.map((p) => row(`w-${p.id}`, `/compras/${p.id}`, p.deal, `${p.supplier.name} entrega ${p.code}`, `${p.supplier.name} delivers ${p.code}`, p.eta)),
    ...waitingDeals.map((d) => row(`wd-${d.id}`, `/deals/${d.id}`, d, d.waitingFor!, d.waitingFor!, d.waitingUntil)),
  ].sort((a, b) => +(a.at ?? 0) - +(b.at ?? 0));

  // Resource exposure in facts, not a score. Supplier amounts in the PO's own currency are summed only when USD.
  const usdPos = openPos.filter((p) => p.currency === "USD");
  const bySupplier = new Map<string, { name: string; open: number; advanced: number }>();
  for (const p of openPos) {
    const g = bySupplier.get(p.supplierId) ?? { name: p.supplier.name, open: 0, advanced: 0 };
    if (p.currency === "USD") g.open = sumMoney([g.open, p.amount]);
    g.advanced = sumMoney([g.advanced, ...p.payments.map((x) => x.amountUsd)]);
    bySupplier.set(p.supplierId, g);
  }
  const open = invoices.map((i) => ({ due: i.dueAt, bal: subMoney(i.amount, ...i.applications.map((a) => a.amount)) })).filter((i) => i.bal > 0.005);
  const exposure = {
    openPurchases: sumMoney(usdPos.map((p) => p.amount)), otherCurrencyPos: openPos.length - usdPos.length,
    advancedNotReceived: sumMoney(openPos.flatMap((p) => p.payments.map((x) => x.amountUsd))),
    upcomingPayments: sumMoney(upcomingPay.map((p) => p.amountUsd)), upcomingDays: pol.upcomingDays,
    customerOpen: sumMoney(open.map((i) => i.bal)), customerOverdue: sumMoney(open.filter((i) => i.due < T).map((i) => i.bal)),
    topSuppliers: [...bySupplier.values()].filter((s) => s.advanced > 0 || s.open > 0).sort((a, b) => b.advanced - a.advanced || b.open - a.open).slice(0, 4),
  };
  return { policy: pol, exceptions, attention, ready, atRisk, protectedCount: promises.length - atRisk.length, waiting, exposure };
}

/** §2.1 Operational Handoff: everything Operaciones needs, assembled from the Journey (nothing is asked again). */
export async function operationalHandoff(dealId: string) {
  const d = await db.deal.findUnique({
    where: { id: dealId },
    include: {
      account: { select: { id: true, name: true, taxId: true, address: true, creditLimit: true, paymentTermsDays: true, requiresReceptionCode: true, requiresPortal: true } },
      contact: { select: { firstName: true, lastName: true, phone: true, email: true } },
      owner: { select: { name: true } },
      scopeLines: { orderBy: { position: "asc" }, select: { id: true, component: true, code: true, manufacturer: true, qty: true, status: true, requiredForFunction: true, note: true } },
      items: { select: { id: true, code: true, description: true, qty: true } },
      customerPos: { where: { acceptance: { isNot: null } }, orderBy: { receivedAt: "desc" }, take: 1, include: { acceptance: true, lines: { orderBy: { position: "asc" } } } },
      quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { id: true, number: true, rev: true, protSale: true, protCost: true, protEsagra: true, supplyPrimary: true, supplyAlt: true, incoterm: true, paymentTerms: true, shipTo: true, promiseText: true, promiseCondition: true, leadMinDays: true, leadMaxDays: true } },
      supplyBases: { where: { supersededAt: null }, take: 1, include: { primary: { select: { label: true, supplier: { select: { name: true } }, leadDaysMin: true, leadDaysMax: true, incoterm: true, pickup: true, importFeasibility: true, importNote: true, grossKg: true, dims: true, packages: true } }, backup: { select: { label: true, supplier: { select: { name: true } } } }, paymentOption: { select: { method: true, daysToRelease: true, releaseTrigger: true, note: true } } } },
      dispatches: { where: { supersededAt: null }, orderBy: { version: "desc" }, take: 1, select: { version: true, destination: true, contactName: true, contactPhone: true, windowFrom: true, windowTo: true, promiseDate: true, documents: true, entryRequirement: true, restrictions: true } },
      opsExceptions: { where: { status: "OPEN" }, select: { id: true, whatHappened: true, deadline: true } },
      supplierPos: { select: { id: true, code: true, releasedAt: true, supplier: { select: { name: true } } } },
      invoices: { select: { amount: true, applications: { select: { amount: true } } } },
    },
  });
  if (!d) return null;
  const ar = await db.invoice.findMany({ where: { accountId: d.accountId }, select: { amount: true, dueAt: true, applications: { select: { amount: true } } } });
  const bal = ar.map((i) => ({ due: i.dueAt, b: subMoney(i.amount, ...i.applications.map((a) => a.amount)) })).filter((x) => x.b > 0.005);
  return { d, po: d.customerPos[0] ?? null, quote: d.quotes[0] ?? null, basis: d.supplyBases[0] ?? null, dispatch: d.dispatches[0] ?? null, credit: { limit: d.account.creditLimit != null ? Number(d.account.creditLimit) : null, open: sumMoney(bal.map((x) => x.b)), overdue: sumMoney(bal.filter((x) => x.due < today()).map((x) => x.b)) } };
}
