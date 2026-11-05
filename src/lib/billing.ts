import type { Prisma } from "@prisma/client";
import { addDays, daysBetween, invoiceCash, today } from "./domain";
import type { makeI18n } from "./i18n";

type I = ReturnType<typeof makeI18n>;

// ---------- Billing Readiness ----------
// "Ready to bill?" comes before "Create invoice": the customer's billing profile says what
// evidence its accounts-payable team needs, and SOLU checks each item against what's on file.

export const billingInclude = {
  account: true,
  contact: { select: { firstName: true, lastName: true, email: true } },
  owner: { select: { name: true } },
  items: true,
  deliveries: {
    orderBy: { deliveredAt: "asc" },
    include: { lines: { include: { dealItem: true } }, invoice: { select: { id: true, number: true } } },
  },
  invoices: {
    orderBy: { issuedAt: "asc" },
    include: {
      delivery: { select: { code: true } },
      promises: { orderBy: { createdAt: "desc" } },
      applications: { include: { payment: true } },
    },
  },
  billingRequests: { orderBy: { requestedAt: "desc" }, include: { requestedBy: { select: { name: true } } } },
} satisfies Prisma.DealInclude;

export type BillingDeal = Prisma.DealGetPayload<{ include: typeof billingInclude }>;
type BDelivery = BillingDeal["deliveries"][number];
type BInvoice = BillingDeal["invoices"][number];

export type ReqKey = "PO" | "POD" | "RECEPTION_CODE" | "PORTAL" | "TAX" | "PARTIAL";
/** Evidence that belongs to the whole Journey / customer rather than to one delivery. */
export const DEAL_LEVEL: ReqKey[] = ["PO", "PORTAL", "TAX"];
export const REQ_KEYS: ReqKey[] = ["PO", "POD", "RECEPTION_CODE", "PORTAL", "TAX", "PARTIAL"];

export type Req = {
  key: ReqKey;
  label: string;
  state: "ok" | "missing" | "na";
  detail: string;
  request: { at: Date; sentTo: string | null; by: string; note: string | null } | null;
};

export function reqLabel(i: I, k: ReqKey) {
  const { t } = i;
  return {
    PO: t("OC del cliente", "Customer PO"),
    POD: t("Prueba de entrega (POD)", "Proof of delivery (POD)"),
    RECEPTION_CODE: t("Código de recepción", "Receiving code"),
    PORTAL: t("Portal de proveedores", "Supplier portal"),
    TAX: t("Datos tributarios", "Tax references"),
    PARTIAL: t("Facturación parcial", "Partial billing"),
  }[k];
}

function openRequest(deal: BillingDeal, key: ReqKey, deliveryId: string | null) {
  const r = deal.billingRequests.find((x) => x.kind === key && !x.resolvedAt && (DEAL_LEVEL.includes(key) || x.deliveryId === deliveryId));
  return r ? { at: r.requestedAt, sentTo: r.sentTo, by: r.requestedBy.name, note: r.note } : null;
}

const units = (d: BDelivery) => d.lines.reduce((s, l) => s + l.qty, 0);

export function deliveryAmount(deal: BillingDeal, d: BDelivery) {
  if (d.lines.length) return d.lines.reduce((s, l) => s + l.qty * Number(l.dealItem.unitPrice), 0);
  const invoiced = deal.invoices.reduce((s, x) => s + Number(x.amount), 0);
  return Math.max(0, Number(deal.amount) - invoiced);
}

/** Whether invoicing this delivery covers only part of the PO, and how much. */
export function partialOf(deal: BillingDeal, d: BDelivery) {
  const ordered = deal.items.reduce((s, it) => s + it.qty, 0);
  const through = deal.deliveries.filter((x) => x.deliveredAt <= d.deliveredAt).reduce((s, x) => s + units(x), 0);
  const thisOne = units(d);
  const partial = ordered > 0 && thisOne < ordered;
  return { ordered, thisOne, through, remaining: Math.max(0, ordered - through), partial };
}

/** Requirement-by-requirement readiness of one delivery, derived from the billing profile and the evidence on file. */
export function readinessOf(deal: BillingDeal, d: BDelivery | null, i: I, now = today()): Req[] {
  const { t } = i;
  const a = deal.account;
  const did = d?.id ?? null;
  const R = (key: ReqKey, state: Req["state"], detail: string): Req => ({ key, label: reqLabel(i, key), state, detail, request: state === "missing" ? openRequest(deal, key, did) : null });
  const out: Req[] = [];

  out.push(deal.customerPo
    ? R("PO", "ok", t(`OC ${deal.customerPo}${deal.poAcceptedAt ? ` · aceptada ${i.day(deal.poAcceptedAt)}` : ""}`, `PO ${deal.customerPo}${deal.poAcceptedAt ? ` · accepted ${i.day(deal.poAcceptedAt)}` : ""}`))
    : R("PO", "missing", t("No hay OC del cliente registrada. Cuentas por pagar rechaza facturas sin ella.", "No customer PO on file. Accounts payable rejects invoices without it.")));

  if (!d) out.push(R("POD", "missing", t("Aún no hay entrega registrada.", "Nothing delivered yet.")));
  else out.push(d.podReceived
    ? R("POD", "ok", t(`Firmada${d.receivedByName ? ` por ${d.receivedByName}` : ""} · ${i.day(d.deliveredAt)}`, `Signed${d.receivedByName ? ` by ${d.receivedByName}` : ""} · ${i.day(d.deliveredAt)}`))
    : R("POD", "missing", t(`Entregado el ${i.day(d.deliveredAt)}, pero sin prueba de entrega firmada.`, `Delivered on ${i.day(d.deliveredAt)}, but no signed proof of delivery.`)));

  if (!a.requiresReceptionCode) out.push(R("RECEPTION_CODE", "na", t("Este cliente no lo exige.", "Not required by this customer.")));
  else if (d?.receptionCode) out.push(R("RECEPTION_CODE", "ok", t(`Entrada de mercancía ${d.receptionCode}`, `Goods receipt ${d.receptionCode}`)));
  else out.push(R("RECEPTION_CODE", "missing", t("Este cliente exige el código de entrada de mercancía en la factura.", "This customer requires the goods-receipt code on the invoice.")));

  if (!a.requiresPortal) out.push(R("PORTAL", "na", t("Este cliente no usa portal.", "This customer doesn't use a portal.")));
  else if (a.portalValidUntil && a.portalValidUntil >= now) out.push(R("PORTAL", "ok", t(`Registro vigente hasta ${i.day(a.portalValidUntil)}`, `Registration valid until ${i.day(a.portalValidUntil)}`)));
  else out.push(R("PORTAL", "missing", a.portalValidUntil
    ? t(`La factura se carga en su portal; el registro venció el ${i.day(a.portalValidUntil)}.`, `Invoices are uploaded to their portal; the registration expired on ${i.day(a.portalValidUntil)}.`)
    : t("La factura se carga en su portal y aún no estamos registrados.", "Invoices are uploaded to their portal and we're not registered yet.")));

  out.push(a.taxDataComplete
    ? R("TAX", "ok", a.taxId ? t(`NIT / Tax ID ${a.taxId}`, `Tax ID ${a.taxId}`) : t("Datos tributarios completos", "Tax data complete"))
    : R("TAX", "missing", t("Faltan datos tributarios del cliente (NIT / RUT).", "Customer tax data is incomplete (Tax ID / registration).")));

  if (d) {
    const p = partialOf(deal, d);
    const approved = deal.billingRequests.some((x) => x.kind === "PARTIAL" && x.deliveryId === d.id && x.resolvedAt);
    if (!p.partial) out.push(R("PARTIAL", "ok", p.ordered ? t(`Entrega completa: ${p.thisOne} de ${p.ordered} unidades.`, `Complete delivery: ${p.thisOne} of ${p.ordered} units.`) : t("Factura por el saldo de la OC.", "Invoice for the PO balance.")));
    else if (a.allowsPartialBilling || approved) out.push(R("PARTIAL", "ok", t(
      `Factura parcial: ${p.thisOne} de ${p.ordered} unidades. ${approved ? "El cliente la aprobó por escrito." : "Este cliente acepta facturas parciales."}${p.remaining ? ` Las ${p.remaining} restantes se facturan al entregarse.` : ""}`,
      `Partial invoice: ${p.thisOne} of ${p.ordered} units. ${approved ? "The customer approved it in writing." : "This customer accepts partial invoices."}${p.remaining ? ` The remaining ${p.remaining} are invoiced when delivered.` : ""}`)));
    else out.push(R("PARTIAL", "missing", t(
      `Este cliente solo acepta una factura por la OC completa: faltan ${p.remaining} de ${p.ordered} unidades. Espera la entrega o pide aprobación escrita.`,
      `This customer only accepts one invoice for the full PO: ${p.remaining} of ${p.ordered} units still to deliver. Wait for them or ask for written approval.`)));
  }
  return out;
}

export function pendingDeliveries(deal: BillingDeal) {
  return deal.deliveries.filter((d) => !d.invoice);
}

// ---------- Four separate cash truths per invoice ----------
// Contractual due ≠ SOLU expected cash ≠ customer promised ≠ actual cash.
// Actual cash only counts reconciled money; a bank receipt alone never makes an invoice paid.

type Tone = "ok" | "risk" | "attn" | "wait" | "info" | "dash";

/** How late this customer usually pays, from invoices fully collected and reconciled. */
export function payHistory(invoices: { dueAt: Date; amount: Prisma.Decimal | number; applications: { amount: Prisma.Decimal | number; payment: { reconciledAt: Date | null; receivedAt: Date } }[] }[]) {
  const delays: number[] = [];
  for (const inv of invoices) {
    const rec = inv.applications.filter((a) => a.payment.reconciledAt);
    const paid = rec.reduce((s, a) => s + Number(a.amount), 0);
    if (!rec.length || paid < Number(inv.amount) - 0.005) continue;
    const last = rec.reduce((m, a) => (a.payment.receivedAt > m ? a.payment.receivedAt : m), rec[0].payment.receivedAt);
    delays.push(daysBetween(inv.dueAt, last));
  }
  if (!delays.length) return { n: 0, avg: 0 };
  return { n: delays.length, avg: Math.round(delays.reduce((s, x) => s + x, 0) / delays.length) };
}

export type CashView = ReturnType<typeof cashViewOf>;

export function cashViewOf(inv: BInvoice, hist: { n: number; avg: number }, termsDays: number, i: I, now = today()) {
  const { t } = i;
  const c = invoiceCash(inv);
  const paid = c.balance <= 0.005;
  const recApps = inv.applications.filter((a) => a.payment.reconciledAt);
  const pendApps = inv.applications.filter((a) => !a.payment.reconciledAt);
  const lastRec = recApps.length ? recApps.reduce((m, a) => (a.payment.receivedAt > m ? a.payment.receivedAt : m), recApps[0].payment.receivedAt) : null;
  const lastPend = pendApps.length ? pendApps.reduce((m, a) => (a.payment.receivedAt > m ? a.payment.receivedAt : m), pendApps[0].payment.receivedAt) : null;

  const p = inv.promises[0] ?? null;
  const promise = p ? { date: p.promisedFor, by: p.promisedBy, source: p.source, broken: !paid && p.promisedFor < now && c.pendingReconcile < c.balance - 0.005 } : null;

  // SOLU expected cash
  let expected: { date: Date | null; basis: string };
  const coveredByPending = !paid && c.pendingReconcile >= c.balance - 0.005;
  if (paid) expected = { date: lastRec, basis: t("cobrada y conciliada", "collected and reconciled") };
  else if (coveredByPending) expected = { date: lastPend, basis: t("el dinero ya está en el banco; falta conciliar", "the cash is already in the bank; reconciliation pending") };
  else if (promise && !promise.broken) expected = { date: promise.date, basis: t(`promesa de ${promise.by}`, `promise from ${promise.by}`) };
  else {
    const base = addDays(inv.dueAt, Math.max(0, hist.avg));
    const why = hist.n
      ? hist.avg > 0
        ? t(`suele pagar ${hist.avg} días después del vencimiento (${hist.n} ${hist.n === 1 ? "factura" : "facturas"})`, `usually pays ${hist.avg} days after due (${hist.n} ${hist.n === 1 ? "invoice" : "invoices"})`)
        : t(`suele pagar a tiempo (${hist.n} ${hist.n === 1 ? "factura" : "facturas"})`, `usually pays on time (${hist.n} ${hist.n === 1 ? "invoice" : "invoices"})`)
      : t(`condiciones de ${termsDays} días; sin historial de pagos`, `${termsDays}-day terms; no payment history yet`);
    if (base < now) expected = { date: null, basis: promise?.broken
      ? t(`promesa del ${i.day(promise.date)} incumplida; sin fecha válida`, `promise of ${i.day(promise.date)} broken; no valid date`)
      : t("vencida y sin promesa: no hay fecha creíble", "past due with no promise: no credible date") };
    else expected = { date: base, basis: why };
  }

  // Actual cash (reconciled only)
  const actual = paid
    ? { label: t(`USD ${i.n2(c.reconciled)} conciliados`, `USD ${i.n2(c.reconciled)} reconciled`), date: lastRec, tone: "ok" as Tone }
    : c.reconciled > 0.005
      ? { label: t(`USD ${i.n2(c.reconciled)} de ${i.n2(c.amount)} conciliados`, `USD ${i.n2(c.reconciled)} of ${i.n2(c.amount)} reconciled`), date: lastRec, tone: "attn" as Tone }
      : { label: t("Sin cobro conciliado", "No reconciled cash"), date: null, tone: "dash" as Tone };

  // Short payment: customer paid, a small balance remains and no other cash is pending.
  const touched = recApps.length > 0 || pendApps.length > 0;
  const shortBy = !paid && touched && c.pendingReconcile < 0.005 ? c.balance : 0;
  const shortPay = shortBy > 0.005 && (inv.shortPayNote || shortBy <= c.amount * 0.05) ? { amount: shortBy, note: inv.shortPayNote } : null;

  let status: { label: string; tone: Tone };
  if (paid) status = { label: t("Pagada · conciliada", "Paid · reconciled"), tone: "ok" };
  else if (coveredByPending) status = { label: t("Dinero recibido · conciliación pendiente", "Cash received · reconciliation pending"), tone: "info" };
  else if (shortPay) status = { label: t(`Pago corto · USD ${i.n2(shortPay.amount)} abiertos`, `Short payment · USD ${i.n2(shortPay.amount)} open`), tone: "attn" };
  else if (c.reconciled > 0.005 || c.pendingReconcile > 0.005) status = { label: t(`Cobro parcial · USD ${i.n2(c.balance - c.pendingReconcile)} abiertos`, `Partly collected · USD ${i.n2(c.balance - c.pendingReconcile)} open`), tone: "wait" };
  else if (promise?.broken) status = { label: t("Promesa incumplida", "Promise broken"), tone: "risk" };
  else if (!expected.date) status = { label: t("Sin fecha de cobro creíble", "No credible cash date"), tone: "risk" };
  else status = { label: t(`Esperado ${i.dateShort(expected.date)}`, `Expected ${i.dateShort(expected.date)}`), tone: "wait" };

  return { inv, c, paid, due: inv.dueAt, promise, expected, actual, status, shortPay, lastPend };
}

export function syncLabel(i: I, s: "NOT_SENT" | "SENT" | "CONFIRMED" | "UNCERTAIN") {
  const { t } = i;
  return {
    NOT_SENT: { text: t("Contabilidad: no enviada", "Accounting: not sent"), cls: "dash" },
    SENT: { text: t("Contabilidad: enviada, sin confirmar", "Accounting: sent, not confirmed"), cls: "wait" },
    CONFIRMED: { text: t("Contabilidad: confirmada", "Accounting: confirmed"), cls: "ok" },
    UNCERTAIN: { text: t("Contabilidad: incierta", "Accounting: uncertain"), cls: "risk" },
  }[s];
}

// ---------- Cash that arrived but isn't allocated ----------

export function unallocatedOf(
  payments: { id: string; amount: Prisma.Decimal | number; receivedAt: Date; reference: string | null; residualNote: string | null; reconciledAt: Date | null; applications: { amount: Prisma.Decimal | number }[] }[],
  openCapacity: number,
) {
  return payments
    .map((p) => {
      const applied = p.applications.reduce((s, a) => s + Number(a.amount), 0);
      const rest = Number(p.amount) - applied;
      // With open invoices it can still be allocated; with none, it's money the customer overpaid.
      const kind: "ALLOCATION_PENDING" | "OVERPAYMENT" = openCapacity > 0.005 ? "ALLOCATION_PENDING" : "OVERPAYMENT";
      return { p, applied, rest, kind };
    })
    .filter((x) => x.rest > 0.005 && !x.p.reconciledAt);
}

// ---------- Cash future timeline ----------

export function cashTimeline(views: CashView[], now = today()) {
  const dates: Date[] = [now];
  for (const v of views) {
    if (v.paid) { if (v.expected.date) dates.push(v.expected.date); continue; }
    dates.push(v.due);
    if (v.promise) dates.push(v.promise.date);
    if (v.expected.date) dates.push(v.expected.date);
  }
  let start = addDays(dates.reduce((m, x) => (x < m ? x : m)), -3);
  let end = addDays(dates.reduce((m, x) => (x > m ? x : m)), 4);
  if (daysBetween(start, end) < 21) end = addDays(start, 21);
  const span = daysBetween(start, end);
  if (span > 200) start = addDays(end, -200);
  const pos = (x: Date) => Math.min(100, Math.max(0, (daysBetween(start, x) / daysBetween(start, end)) * 100));
  return { start, end, pos, nowPos: pos(now) };
}
