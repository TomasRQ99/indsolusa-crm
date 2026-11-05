import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import type { ModuleKey } from "./nav";
import { db } from "./db";
import { canManageAll } from "./permissions";
import { invoiceBlockers } from "./domain";
import { loadCredit, loadReceivables, loadSupplierPayments } from "./queries";
import { buildMiDia } from "./midia";

// Attention for the shell: a module shows a counter only when it holds objects that
// need THIS person (amber = needs movement or clarity, red = result at risk).
// The bell counts only events that need human judgment.

export type Counter = { n: number; tone: "attn" | "risk" };
export type Alert = { key: string; text: string; href: string; tone: "attn" | "risk" };

export async function shellAttention(user: SessionUser, i: I18n) {
  const { t } = i;
  const manager = canManageAll(user);
  const mineDeal = manager ? {} : { ownerId: user.id };

  const [midia, receivables, payments, ready, credit] = await Promise.all([
    buildMiDia(user, i, { agenda: false }), // same number Mi Día shows in its heading
    loadReceivables({ deal: mineDeal }),
    loadSupplierPayments({ executedAt: null }),
    db.delivery.findMany({ where: { invoice: null, deal: mineDeal }, include: { deal: { include: { account: true } } } }),
    manager ? loadCredit() : Promise.resolve([]),
  ]);

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
  set("operaciones", readyToInvoice, "attn");
  if (broken.length || toReconcile.length) set("administracion", broken.length + toVerify.length + toReconcile.length, "risk");
  else set("administracion", toVerify.length, "attn");
  set("gerencia", toApprove.length + creditDecisions.length, "attn");

  const alerts: Alert[] = [
    ...broken.map((r) => ({ key: `b${r.id}`, tone: "risk" as const, href: `/administracion/cobrar?f=${r.id}`, text: t(`Compromiso incumplido: ${r.account.name} · ${i.money(r.cash.balance)}`, `Commitment missed: ${r.account.name} · ${i.money(r.cash.balance)}`) })),
    ...toVerify.map((p) => ({ key: `v${p.id}`, tone: "risk" as const, href: `/administracion/pagos-proveedores/${p.id}`, text: t(`Verificar datos bancarios de ${p.supplierPo.supplier.name}`, `Verify ${p.supplierPo.supplier.name}'s bank data`) })),
    ...toReconcile.map((p) => ({ key: `u${p.id}`, tone: "risk" as const, href: `/administracion/pagos-proveedores/${p.id}`, text: t(`Conciliar pago incierto a ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`, `Reconcile uncertain payment to ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`) })),
    ...toApprove.map((p) => ({ key: `a${p.id}`, tone: "attn" as const, href: `/administracion/pagos-proveedores/${p.id}`, text: t(`Aprobar pago a ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`, `Approve payment to ${p.supplierPo.supplier.name} · ${p.currency} ${i.n(p.amount)}`) })),
    ...creditDecisions.map(({ a, d }) => ({ key: `c${d.id}`, tone: "attn" as const, href: `/administracion/cupos#${a.id}`, text: t(`Decidir el cupo de ${a.name}`, `Decide ${a.name}'s credit limit`) })),
  ];

  return { counters, alerts };
}
