import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import type { ModuleKey } from "./nav";
import { db } from "./db";
import { canManageAll } from "./permissions";
import { invoiceBlockers } from "./domain";
import { loadCredit, loadReceivables, loadSupplierPayments } from "./queries";
import { buildMiDia } from "./midia";
import { forwardOf } from "./logistics";
import { APPROVER_ROLES } from "./esagara-gate";

// Attention for the shell: a module shows a counter only when it holds objects that
// need THIS person (amber = needs movement or clarity, red = result at risk).
// The bell counts only events that need human judgment.

export type Counter = { n: number; tone: "attn" | "risk" };
export type Alert = { key: string; text: string; href: string; tone: "attn" | "risk" };

export async function shellAttention(user: SessionUser, i: I18n) {
  const { t } = i;
  const manager = canManageAll(user);
  const mineDeal = manager ? {} : { ownerId: user.id };

  const approver = APPROVER_ROLES.includes(user.role);
  const excInclude = { quote: { select: { id: true, deal: { select: { account: { select: { name: true } } } } } } } as const;
  const [midia, receivables, payments, ready, credit, ships, excToDecide, excBack] = await Promise.all([
    buildMiDia(user, i, { agenda: false }), // same number Mi Día shows in its heading
    loadReceivables({ deal: mineDeal }),
    loadSupplierPayments({ executedAt: null }),
    db.delivery.findMany({ where: { invoice: null, deal: mineDeal }, include: { deal: { include: { account: true } } } }),
    manager ? loadCredit() : Promise.resolve([]),
    db.shipment.findMany({ where: { receipt: { not: "CONFIRMED" }, deal: mineDeal }, include: { deal: { select: { promisedDate: true, account: { select: { name: true } } } } } }),
    // Eságara exceptions: the approver sees what waits for them; the requester sees a question sent back.
    approver ? db.esagaraException.findMany({ where: { status: "REQUESTED", requestedById: { not: user.id } }, include: excInclude }) : Promise.resolve([]),
    db.esagaraException.findMany({ where: { status: "RETURNED", requestedById: user.id }, include: excInclude }),
  ]);
  // Shipments interrupt only when the result is at stake — never per carrier scan.
  const shipNeeds = ships
    .map((s) => ({ s, k: forwardOf({ ...s, promisedDate: s.deal.promisedDate }, i) }))
    .filter((x) => x.k === "RISK" || x.k === "DISPUTED" || x.k === "HOLD");

  const broken = receivables.filter((r) => r.state === "BROKEN");
  const toVerify = payments.filter((p) => p.state === "VERIFY" && p.requestedById !== user.id);
  const toReconcile = payments.filter((p) => p.state === "UNCERTAIN");
  const toApprove = manager ? payments.filter((p) => p.state === "APPROVE" && p.requestedById !== user.id && p.verifiedById !== user.id) : [];
  const readyToInvoice = ready.filter((d) => invoiceBlockers(d, d.deal, d.deal.account).length === 0).length;
  const creditDecisions = credit.flatMap((a) => a.blocking.map((d) => ({ a, d })));

  const counters: Partial<Record<ModuleKey, Counter>> = {};
  const set = (k: ModuleKey, n: number, tone: Counter["tone"]) => {
    if (n > 0) counters[k] = { n, tone };
  };
  set("midia", midia.needCount, midia.needs.some((n) => n.tone === "risk") ? "risk" : "attn");
  set("operaciones", readyToInvoice + shipNeeds.length, shipNeeds.some((x) => x.k !== "HOLD") ? "risk" : "attn");
  if (broken.length || toReconcile.length) set("administracion", broken.length + toVerify.length + toReconcile.length, "risk");
  else set("administracion", toVerify.length, "attn");
  set("gerencia", toApprove.length + creditDecisions.length, "attn");
  set("comercial", excToDecide.length + excBack.length, "attn");

  const alerts: Alert[] = [
    ...broken.map((r) => ({ key: `b${r.id}`, tone: "risk" as const, href: `/administracion/cobrar?f=${r.id}`, text: t(`Compromiso incumplido: ${r.account.name} · ${i.money(r.cash.balance)}`, `Commitment missed: ${r.account.name} · ${i.money(r.cash.balance)}`) })),
    ...toVerify.map((p) => ({ key: `v${p.id}`, tone: "risk" as const, href: `/administracion/pagos-proveedores/${p.id}`, text: t(`Verificar datos bancarios de ${p.supplierPo.supplier.name}`, `Verify ${p.supplierPo.supplier.name}'s bank data`) })),
    ...shipNeeds.map(({ s, k }) => ({ key: `s${s.id}`, tone: (k === "HOLD" ? "attn" : "risk") as "attn" | "risk", href: `/logistica/${s.id}`, text: k === "RISK" ? t(`Resultado en riesgo: envío ${s.code} · ${s.deal.account.name}`, `Result at Risk: shipment ${s.code} · ${s.deal.account.name}`) : k === "DISPUTED" ? t(`Recibo en disputa: ${s.code} · ${s.deal.account.name}`, `Receipt disputed: ${s.code} · ${s.deal.account.name}`) : t(`Retenido en aduana: ${s.code} · ${s.deal.account.name}`, `Held at customs: ${s.code} · ${s.deal.account.name}`) })),
    ...toReconcile.map((p) => ({ key: `u${p.id}`, tone: "risk" as const, href: `/administracion/pagos-proveedores/${p.id}`, text: t(`Conciliar pago incierto a ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`, `Reconcile uncertain payment to ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`) })),
    ...toApprove.map((p) => ({ key: `a${p.id}`, tone: "attn" as const, href: `/administracion/pagos-proveedores/${p.id}`, text: t(`Aprobar pago a ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`, `Approve payment to ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`) })),
    ...excToDecide.map((e) => ({ key: `x${e.id}`, tone: "attn" as const, href: `/comercial/esagara#e-${e.id}`, text: t(`Decidir excepción de Eságara: ${e.quote.deal.account.name} · ${i.pct2(Number(e.esagaraPct))}`, `Decide Eságara exception: ${e.quote.deal.account.name} · ${i.pct2(Number(e.esagaraPct))}`) })),
    ...excBack.map((e) => ({ key: `y${e.id}`, tone: "attn" as const, href: `/cotizaciones/${e.quote.id}#esagara`, text: t(`Te devolvieron una pregunta sobre la excepción de ${e.quote.deal.account.name}`, `You got a question back on the ${e.quote.deal.account.name} exception`) })),
    ...creditDecisions.map(({ a, d }) => ({ key: `c${d.id}`, tone: "attn" as const, href: `/administracion/cupos#${a.id}`, text: t(`Decidir el cupo de ${a.name}`, `Decide ${a.name}'s credit limit`) })),
  ];

  return { counters, alerts };
}
