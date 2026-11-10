import type { Prisma, Role } from "@prisma/client";
import { cmpMoney, lineAmount, linesTotal, money2, percentOf, subMoney, sumMoney } from "./money";
import { addDays, bankDiscrepancies, daysBetween, paymentState, today, type PaymentState } from "./domain";
import { db } from "./db";
import type { makeI18n } from "./i18n";

// Supplier PO + Treasury.
// Purchase Requirement (what the Journey needs) → Supplier PO (prepared from Supply Basis + PR, versioned,
// released by a command) → Payment Requirement (milestones of the supplier's terms) → Payment Request
// (verify / duplicates / authority / approve) → Payment Execution (outside SOLU: sent, uncertain, confirmed).
// Only a CONFIRMED execution is "paid".

type I = ReturnType<typeof makeI18n>;

/** Same rules the Journey uses for SOLU's expected date: customs clearance + last mile. */
export const CLEARANCE_DAYS = 3;
export const LAST_MILE_DAYS = 1;

/** Approval authority (example limits until the real treasury policy is decided). */
export const AUTHORITY = {
  version: 1,
  note: "Límites de ejemplo, pendientes de definir por Gerencia",
  // Finanzas approves up to the same limit as Director Comercial (user decision 2026-11-09).
  approve: { DIRECTOR_COMERCIAL: 25000, FINANZAS: 25000, ADMINISTRACION: 25000, GERENCIA: Infinity } as Partial<Record<Role, number>>,
};

export const spoInclude = {
  supplier: true,
  lines: { orderBy: { position: "asc" } },
  requirements: { orderBy: { position: "asc" }, include: { payments: { include: { executions: { orderBy: { sentAt: "asc" } } } } } },
  payments: { include: { executions: true } },
  deal: {
    include: {
      account: true,
      contact: true,
      owner: { select: { id: true, name: true } },
      items: true,
      quotes: { where: { status: { in: ["ACCEPTED", "PRESENTED"] } }, orderBy: [{ status: "asc" }, { rev: "desc" }], include: { lines: { orderBy: { position: "asc" } } } },
      supplierPos: { select: { id: true, code: true, amount: true, supplierId: true } },
    },
  },
} satisfies Prisma.SupplierPOInclude;
export type SpoFull = Prisma.SupplierPOGetPayload<{ include: typeof spoInclude }>;

type DealForPr = {
  promisedDate: Date | null;
  promiseText: string | null;
  customerPo: string | null;
  items: { qty: number; code: string | null; description: string }[];
  quotes: { status: string; number: string; rev: number; supplyPrimary: string | null; supplyAlt: string | null; supplierCost: Prisma.Decimal; supplierSrc: string | null; costCurrency: string; fxRate: Prisma.Decimal | null; lines: { qty: number; code: string | null; description: string; unitPrice: Prisma.Decimal }[] }[];
};

/** Customs clearance only applies to suppliers outside the company's country. */
export const HOME_COUNTRY = "Colombia";
export const isDomestic = (s: { country: string | null } | null | undefined) => !!s?.country && s.country.trim().toLowerCase() === HOME_COUNTRY.toLowerCase();

/** Purchase Requirement: derived from the Deal (accepted quote + customer promise). Nobody types it. */
export function purchaseRequirement(deal: DealForPr, domestic = false) {
  const quote = deal.quotes.find((q) => q.status === "ACCEPTED") ?? deal.quotes[0] ?? null;
  const lines = quote ? quote.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, sale: lineAmount(l.qty, l.unitPrice) })) : deal.items.map((l) => ({ qty: l.qty, code: l.code, description: l.description, sale: 0 }));
  const clearance = domestic ? 0 : CLEARANCE_DAYS;
  const atDestinationBy = deal.promisedDate ? addDays(deal.promisedDate, -(clearance + LAST_MILE_DAYS)) : null;
  return {
    quote,
    lines,
    supply: quote?.supplyPrimary ?? null,
    supplyAlt: quote?.supplyAlt ?? null,
    targetCost: quote ? money2(quote.supplierCost) : null,
    currency: quote?.costCurrency ?? "USD",
    costSource: quote?.supplierSrc ?? null,
    promise: deal.promisedDate,
    promiseText: deal.promiseText,
    atDestinationBy,
    clearance,
    customerPo: deal.customerPo,
  };
}

/** Which registered supplier the Supply Basis names (by name tokens). */
export function matchSupplier<T extends { name: string }>(supply: string | null, suppliers: T[]) {
  if (!supply) return null;
  const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(ejemplo\)/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const sw = new Set(n(supply));
  let best: T | null = null;
  let score = 0;
  for (const s of suppliers) {
    const toks = n(s.name);
    const hit = toks.filter((w) => sw.has(w)).length / Math.max(1, toks.length);
    if (hit > score) { score = hit; best = s; }
  }
  return score >= 0.6 ? best : null;
}

/** Payment milestones from the supplier's terms: advance % at release, rest against dispatch notice. */
export function milestones(total: number, advancePct: number, releaseDay: Date, shipBy: Date | null) {
  const a = Math.max(0, Math.min(100, advancePct));
  const advance = percentOf(total, a);
  const out = [] as { label: string; percent: number; amount: number; trigger: string; dueBy: Date | null }[];
  if (a > 0) out.push({ label: a === 100 ? "Pago total antes de despacho" : `Anticipo ${a} %`, percent: a, amount: advance, trigger: a === 100 ? "El proveedor despacha contra pago" : "Al liberar la Supplier PO", dueBy: a === 100 && shipBy ? addDays(shipBy, -1) : addDays(releaseDay, 2) });
  if (a < 100) out.push({ label: `Saldo ${100 - a} %`, percent: 100 - a, amount: subMoney(total, advance), trigger: "Contra aviso de despacho", dueBy: shipBy });
  return out;
}

export function spoTotal(lines: { qty: number; unitCost: Prisma.Decimal | number }[]) {
  return linesTotal(lines, (l) => l.qty, (l) => l.unitCost);
}

type Check = { ok: boolean; text: string; fix?: string; info?: boolean };

/** Supplier PO: release readiness and the payment chain of each milestone. */
export function buildSpo(spo: SpoFull, i: I) {
  const { t } = i;
  const now = today();
  const pr = purchaseRequirement(spo.deal, isDomestic(spo.supplier));
  const total = spo.lines.length ? spoTotal(spo.lines) : money2(spo.amount);
  const released = !!spo.releasedAt;
  const fx = pr.quote?.fxRate ? Number(pr.quote.fxRate) : 1;
  const costDiff = pr.targetCost != null ? subMoney(total, pr.targetCost) : 0;
  const s = spo.supplier;
  const arrival = spo.shipBy && s.transitDays != null ? addDays(spo.shipBy, s.transitDays) : null;
  const reqPct = spo.requirements.reduce((a, r) => a + r.percent, 0);
  const qtyOk = pr.lines.every((l) => spo.lines.some((x) => (x.code && l.code ? x.code === l.code : x.description === l.description) && x.qty === l.qty));

  const ready: Check[] = [
    { ok: !!pr.customerPo, text: pr.customerPo ? t(`OC del cliente aceptada (${pr.customerPo})`, `Customer PO accepted (${pr.customerPo})`) : t("OC del cliente aceptada", "Customer PO accepted"), fix: t("No se compra antes de aceptar la OC del cliente", "We don't buy before accepting the customer's PO") },
    { ok: spo.lines.length > 0 && qtyOk, text: t("Productos y cantidades = requerimiento de compra", "Products and quantities = purchase requirement"), fix: t("La PO al proveedor no coincide con lo que el cliente compró", "The supplier PO doesn't match what the customer bought") },
    { ok: Math.abs(costDiff) <= Math.max(1, (pr.targetCost ?? 0) * 0.01) || !!spo.costNote, text: pr.targetCost != null ? (Math.abs(costDiff) <= Math.max(1, pr.targetCost * 0.01) ? t(`Costo = el de la cotización (${pr.currency} ${i.n2(pr.targetCost)})`, `Cost = the quote's (${pr.currency} ${i.n2(pr.targetCost)})`) : t(`Costo difiere de la cotización en ${pr.currency} ${i.n2(costDiff)}${spo.costNote ? ` · explicado: ${spo.costNote}` : ""}`, `Cost differs from the quote by ${pr.currency} ${i.n2(costDiff)}${spo.costNote ? ` · explained: ${spo.costNote}` : ""}`)) : t("Costo con fuente", "Cost with a source"), fix: t("Explica la diferencia: cambia la eságara protegida", "Explain the difference: it changes the protected eságara") },
    { ok: !!spo.shipBy && (!arrival || !pr.atDestinationBy || arrival <= pr.atDestinationBy), text: spo.shipBy ? (arrival && pr.atDestinationBy && arrival > pr.atDestinationBy ? t(`Con despacho el ${i.day(spo.shipBy)} llega el ${i.day(arrival)}, tarde para la promesa`, `Dispatch on ${i.day(spo.shipBy)} arrives ${i.day(arrival)}, late for the promise`) : t(`Despacho pedido el ${i.day(spo.shipBy)} sostiene la promesa`, `Dispatch requested ${i.day(spo.shipBy)} supports the promise`)) : t("Fecha de despacho definida", "Dispatch date defined"), fix: t("Pide un despacho que llegue a tiempo", "Request a dispatch that arrives in time") },
    { ok: reqPct === 100, text: t(`Hitos de pago suman 100 % (${spo.terms ?? s.paymentTerms ?? "—"})`, `Payment milestones add up to 100 % (${spo.terms ?? s.paymentTerms ?? "—"})`), fix: t("Revisa los términos del proveedor", "Check the supplier's terms") },
    { ok: !!s.bankVerifiedAt, info: true, text: s.bankVerifiedAt ? t(`Perfil bancario verificado (${i.day(s.bankVerifiedAt)})`, `Bank profile verified (${i.day(s.bankVerifiedAt)})`) : t("Perfil bancario sin verificar", "Bank profile not verified"), fix: t("No impide liberar; el primer pago exigirá verificación independiente", "Doesn't block release; the first payment will need independent verification") },
  ];
  const blocking = ready.filter((c) => !c.ok && !c.info);

  // Payment chain per milestone: Required → Requested → Approved → Sent → Paid (confirmed). Never collapsed.
  const plan = spo.requirements.map((r) => {
    const pays = r.payments;
    const live = pays[pays.length - 1] ?? null;
    const st: PaymentState | "REQUIRED" = live ? paymentState({ ...live, discrepancies: bankDiscrepancies(s, live).length, executions: live.executions }) : "REQUIRED";
    const paid = sumMoney(pays.filter((p) => p.executedAt).map((p) => p.amount));
    return { r, live, st, paid, due: r.dueBy, late: !!r.dueBy && r.dueBy < now && st !== "DONE" };
  });
  const paidTotal = sumMoney(plan.map((p) => p.paid));
  const committed = sumMoney(spo.payments.map((p) => p.amount));

  return { pr, total, released, costDiff, arrival, ready, blocking, plan, paidTotal, committed, fx, now };
}

/** Treasury checks of one Payment Request. */
export async function treasuryChecks(
  p: { id: string; amount: Prisma.Decimal; currency: string; amountUsd: Prisma.Decimal | null; docSource: string | null; requirementId: string | null; requestedById: string; verifiedById: string | null; supplierPoId: string; createdAt: Date },
  spo: { id: string; amount: Prisma.Decimal; supplierId: string },
  i: I,
) {
  const { t } = i;
  const amt = money2(p.amount);
  const since = addDays(today(), -120);
  const others = await db.supplierPayment.findMany({
    where: { id: { not: p.id }, supplierPo: { supplierId: spo.supplierId }, createdAt: { gte: since } },
    include: { executions: true, supplierPo: { select: { code: true } } },
  });
  const alive = others.filter((o) => !(o.executions.length && o.executions.every((e) => e.state === "FAILED")));
  const sameAmount = alive.filter((o) => Math.abs(Number(o.amount) - amt) <= amt * 0.01);
  const sameDoc = p.docSource ? alive.filter((o) => o.docSource && o.docSource.trim().toLowerCase() === p.docSource!.trim().toLowerCase()) : [];
  const sameReq = p.requirementId ? alive.filter((o) => o.requirementId === p.requirementId) : [];
  const onPo = sumMoney([...alive.filter((o) => o.supplierPoId === spo.id).map((o) => o.amount), amt]);
  const over = subMoney(onPo, spo.amount) > 0.5;
  const hits = [
    ...sameDoc.map((o) => ({ id: o.id, text: t(`Mismo documento (${o.docSource}) · ${o.supplierPo.code}`, `Same document (${o.docSource}) · ${o.supplierPo.code}`), paid: !!o.executedAt, hard: true })),
    ...sameReq.filter((o) => !sameDoc.includes(o)).map((o) => ({ id: o.id, text: t(`Ya hay una solicitud para este mismo hito · ${o.supplierPo.code}`, `There's already a request for this milestone · ${o.supplierPo.code}`), paid: !!o.executedAt, hard: true })),
    ...sameAmount.filter((o) => !sameDoc.includes(o) && !sameReq.includes(o)).map((o) => ({ id: o.id, text: t(`Mismo proveedor y monto · ${o.supplierPo.code} · ${i.day(o.createdAt)}`, `Same supplier and amount · ${o.supplierPo.code} · ${i.day(o.createdAt)}`), paid: !!o.executedAt, hard: false })),
  ];
  const dup = {
    hits,
    over,
    onPo,
    hard: over || hits.some((h) => h.hard),
    text: over ? t(`Lo solicitado para esta PO (${p.currency} ${i.n2(onPo)}) supera su valor (${i.n2(spo.amount)})`, `Requested on this PO (${p.currency} ${i.n2(onPo)}) exceeds its value (${i.n2(spo.amount)})`) : hits.length ? t(`${hits.length} posible(s) duplicado(s)`, `${hits.length} possible duplicate(s)`) : t("Sin duplicados: ni mismo documento, ni mismo hito, ni mismo monto en 120 días", "No duplicates: same document, milestone or amount in 120 days"),
  };
  const usd = p.currency === "USD" ? amt : p.amountUsd != null ? money2(p.amountUsd) : null;
  return { dup, usd };
}

/** Who may approve this request, and whether this person can. */
export function authorityFor(user: { id: string; role: Role }, p: { requestedById: string; verifiedById: string | null }, usd: number | null, i: I) {
  const { t } = i;
  const limit = AUTHORITY.approve[user.role] ?? 0;
  const reasons: string[] = [];
  if (limit === 0) reasons.push(t("Tu rol no aprueba pagos", "Your role doesn't approve payments"));
  if (usd == null) reasons.push(t("Falta el equivalente en USD para aplicar el límite", "USD equivalent missing to apply the limit"));
  else if (usd > limit) reasons.push(t(`Supera tu límite (USD ${i.n(limit)})`, `Exceeds your limit (USD ${i.n(limit)})`));
  if (p.requestedById === user.id) reasons.push(t("Tú solicitaste este pago", "You requested this payment"));
  if (p.verifiedById === user.id) reasons.push(t("Tú verificaste el banco", "You verified the bank"));
  const lim = i.n(AUTHORITY.approve.DIRECTOR_COMERCIAL ?? 0);
  const rule = t(`Aprueban Director Comercial y Finanzas hasta USD ${lim}; Gerencia sin límite. Siempre una persona distinta de quien solicitó y de quien verificó. Política v${AUTHORITY.version} (${AUTHORITY.note.toLowerCase()}).`, `Commercial Director and Finance approve up to USD ${lim}; Management without limit. Always someone other than the requester and the verifier. Policy v${AUTHORITY.version} (example limits).`);
  return { can: reasons.length === 0, reasons, rule, limit };
}

export const ageDays = (d: Date) => daysBetween(d, new Date());
