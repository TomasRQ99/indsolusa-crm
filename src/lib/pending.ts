// "Pendientes por aprobar": one list of everything that waits for THIS person's decision, each with a link to the
// exact place where it is decided, and a second list of what they asked for that waits for someone else (so nobody
// wonders why a button is not there). Asked by the owner on 2026-11-18: "create a new option in the profile section
// called pending for approvals… a list of actions you must take as gerencia, one of these, an approval of an OC".
// Nothing is decided here: every approval stays in its own screen, with its own rules.

import { db } from "./db";
import type { SessionUser } from "./auth";
import { canManageAll } from "./permissions";
import { getPurchasePolicy } from "./pr-auth";
import { canApprovePurchase, mayApproveOwn } from "./purchase-auth";
import { loadSupplierPayments } from "./queries";
import { neededItems } from "./gerencia-store";

type Txt = { es: string; en: string };
export type PendingRow = { key: string; kind: Txt; title: Txt; detail: Txt | null; amount: string | null; since: Date | null; href: string; cta: Txt; waitsFor?: Txt };

const t = (es: string, en: string): Txt => ({ es, en });
const money = (cur: string, v: unknown) => `${cur} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function pendingFor(user: SessionUser): Promise<{ mine: PendingRow[]; waiting: PendingRow[] }> {
  const manager = canManageAll(user);
  const dealScope = manager ? {} : { deal: { ownerId: user.id } };
  const [pol, approvals, drafts, customerPos, payments, needed] = await Promise.all([
    getPurchasePolicy(),
    db.purchaseApproval.findMany({ where: { status: "REQUESTED" }, orderBy: { requestedAt: "asc" }, select: { id: true, prId: true, level: true, amount: true, requestedById: true, requestedByName: true, requestedAt: true, pr: { select: { code: true, currency: true, supplier: { select: { name: true } }, deal: { select: { code: true, account: { select: { name: true } } } } } } } }),
    db.supplierPO.findMany({ where: { releasedAt: null, ...dealScope }, orderBy: { createdAt: "asc" }, select: { id: true, code: true, amount: true, currency: true, createdAt: true, supplier: { select: { name: true } }, deal: { select: { code: true, account: { select: { name: true } } } } } }),
    db.customerPO.findMany({ where: { rejectedAt: null, acceptance: null, ...dealScope }, orderBy: { receivedAt: "asc" }, select: { id: true, number: true, receivedAt: true, deal: { select: { code: true, account: { select: { name: true } } } } } }),
    loadSupplierPayments({ executedAt: null }),
    neededItems(user),
  ]);

  const mine: PendingRow[] = [], waiting: PendingRow[] = [];

  // 1 · Authorization of a purchase (first purchase from a new supplier, stock, cost above the quote…).
  for (const a of approvals) {
    const can = canApprovePurchase({ id: user.id, role: user.role }, a, pol.value, mayApproveOwn(user.role));
    const what = `${a.pr.code}${a.pr.supplier ? ` · ${a.pr.supplier.name}` : ""}${a.pr.deal ? ` · ${a.pr.deal.code ?? ""} ${a.pr.deal.account.name}` : ""}`;
    const row: PendingRow = {
      key: `pa-${a.id}`, kind: t("Autorizar una compra", "Authorize a purchase"), title: t(`Autorizar la compra ${what}`, `Authorize purchase ${what}`),
      detail: t(`La pidió ${a.requestedByName}${a.requestedById === user.id ? " (tú)" : ""}. Sin esta autorización la orden al proveedor no se puede liberar.`, `Requested by ${a.requestedByName}${a.requestedById === user.id ? " (you)" : ""}. Without it the supplier order cannot be released.`),
      amount: money(a.pr.currency, a.amount), since: a.requestedAt, href: `/compras/requerimientos/${a.prId}#autorizacion`, cta: t("Abrir y autorizar", "Open and authorize"),
    };
    if (can) mine.push(row);
    else if (a.requestedById === user.id) { waiting.push({ ...row, cta: t("Ver la solicitud", "See the request"), waitsFor: t(a.level === 2 ? "La decide Gerencia" : "La decide Finanzas, Administración o Gerencia", a.level === 2 ? "Management decides" : "Finance, Administration or Management decide") }); }
  }

  // 2 · The customer's PO recorded and not accepted yet.
  for (const p of customerPos) mine.push({
    key: `cpo-${p.id}`, kind: t("Aceptar la OC del cliente", "Accept the customer's PO"), title: t(`Aceptar la OC ${p.number} de ${p.deal.account.name}`, `Accept PO ${p.number} from ${p.deal.account.name}`),
    detail: t(`${p.deal.code ? `Necesidad ${p.deal.code}. ` : ""}En la OC, cuando todas las precondiciones estén en «✓», haz clic en «Aceptar PO».`, `${p.deal.code ? `Need ${p.deal.code}. ` : ""}On the PO, once every precondition shows “✓”, click “Accept PO”.`),
    amount: null, since: p.receivedAt, href: `/po/${p.id}`, cta: t("Abrir la OC", "Open the PO"),
  });

  // 3 · Orders to a supplier still in draft: they need "Liberar Supplier PO".
  for (const s of drafts) mine.push({
    key: `spo-${s.id}`, kind: t("Liberar la orden de compra al proveedor", "Release the supplier purchase order"), title: t(`Liberar la orden ${s.code} a ${s.supplier.name}`, `Release order ${s.code} to ${s.supplier.name}`),
    detail: t(`${s.deal.code ? `Necesidad ${s.deal.code} · ` : ""}${s.deal.account.name}. En la orden, cuando «LISTA PARA LIBERAR» no tenga pendientes, haz clic en «Liberar Supplier PO».`, `${s.deal.code ? `Need ${s.deal.code} · ` : ""}${s.deal.account.name}. On the order, once “RELEASE READINESS” has nothing open, click “Release Supplier PO”.`),
    amount: money(s.currency, s.amount), since: s.createdAt, href: `/compras/${s.id}`, cta: t("Abrir la orden", "Open the order"),
  });

  // 4 · Payments to suppliers: verify (never the requester) and approve (never the requester nor the verifier).
  for (const p of payments) {
    if (p.state !== "VERIFY" && p.state !== "APPROVE") continue;
    const what = `${p.supplierPo.supplier.name} · ${p.supplierPo.code}`;
    const verify = p.state === "VERIFY";
    const row: PendingRow = {
      key: `sp-${p.id}`, kind: verify ? t("Verificar un pago a proveedor", "Verify a supplier payment") : t("Aprobar un pago a proveedor", "Approve a supplier payment"),
      title: verify ? t(`Verificar el pago a ${what}`, `Verify the payment to ${what}`) : t(`Aprobar el pago a ${what}`, `Approve the payment to ${what}`),
      detail: t(p.reason ?? "", p.reason ?? ""), amount: money(p.currency, p.amount), since: p.createdAt ?? null, href: `/administracion/pagos-proveedores/${p.id}`, cta: verify ? t("Abrir y verificar", "Open and verify") : t("Abrir y aprobar", "Open and approve"),
    };
    // Gerencia may verify and approve a payment it requested itself (owner's decision 2026-11-18).
    const own = user.role !== "GERENCIA" && (p.requestedById === user.id || (!verify && p.verifiedById === user.id));
    if (own) waiting.push({ ...row, cta: t("Ver el pago", "See the payment"), waitsFor: t(verify ? "Lo pediste tú: lo verifica otra persona" : "Lo pediste o lo verificaste tú: lo aprueba otra persona", verify ? "You requested it: another person verifies it" : "You requested or verified it: another person approves it") });
    else if (manager) mine.push(row);
  }

  // 5 · Everything else that waits for this person's authority (credit, Eságara exceptions, internal purchases,
  // policy changes, questions asked of Gerencia). Purchases and payments are already listed above.
  const KIND: Record<string, Txt> = {
    REQUEST: t("Decisión pedida a Gerencia", "Decision asked of Management"), INTERNAL: t("Aprobar una compra interna", "Approve an internal purchase"),
    ESAGARA: t("Excepción de Eságara", "Eságara exception"), CREDIT_REQUEST: t("Revisión de cupo de crédito", "Credit limit review"),
    CREDIT_LIMIT: t("Cliente sobre su cupo", "Customer above its limit"), POLICY: t("Cambio de política", "Policy change"),
  };
  for (const n of needed) {
    if (n.source === "PURCHASE" || n.source === "PAYMENT") continue;
    mine.push({ key: `n-${n.key}`, kind: KIND[n.source] ?? t("Decisión", "Decision"), title: n.question, detail: n.whyNow, amount: n.impact, since: null, href: n.href, cta: t("Abrir y decidir", "Open and decide") });
  }
  return { mine, waiting };
}
