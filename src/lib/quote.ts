import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { linesTotal, money2, mulMoney, subMoney, sumMoney } from "./money";
import { addDays, daysBetween, today } from "./domain";
import type { makeI18n } from "./i18n";

// Quote v3: a Quote is the solution that protects a customer result (solution · economics · promise).
// Before presenting: "is it ready?". After presenting: "how and when does the customer decide?".
// No invented close probability anywhere.

type I = ReturnType<typeof makeI18n>;

export const quoteInclude = {
  lines: { orderBy: { position: "asc" } },
  scenarios: { orderBy: { position: "asc" } },
  createdBy: { select: { name: true } },
  deal: {
    include: {
      account: true,
      contact: true,
      owner: { select: { id: true, name: true, email: true } },
      quotes: { orderBy: [{ number: "desc" }, { rev: "asc" }], select: { id: true, number: true, rev: true, status: true, supplierCost: true, freightCost: true, otherCosts: true, fxRate: true, changeNote: true, presentedAt: true, createdAt: true, lines: { select: { qty: true, unitPrice: true } } } },
      invoices: { select: { amount: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } },
    },
  },
} satisfies Prisma.QuoteInclude;

export type QuoteFull = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

export const quoteNo = (q: { number: string; rev: number }) => `${q.number}${q.rev > 0 ? ` Rev. ${q.rev}` : ""}`;

// The Eságara floor now comes from the Eságara Protection Gate (esagara-gate.ts: quoteFloor / quoteFloors),
// not from the commission tiers: the commission policy decides pay, the gate decides who must approve.

export function saleOf(lines: { qty: number; unitPrice: Prisma.Decimal | number }[]) {
  return linesTotal(lines, (l) => l.qty, (l) => l.unitPrice);
}

export function costOf(q: { supplierCost: Prisma.Decimal | number; freightCost: Prisma.Decimal | number; otherCosts: Prisma.Decimal | number; fxRate?: Prisma.Decimal | number | null }) {
  return sumMoney([q.fxRate ? mulMoney(q.supplierCost, q.fxRate) : q.supplierCost, q.freightCost, q.otherCosts]);
}

/** Lead time as printed: "12 - 15 days (17 - 20 November)". Calculated, never typed. */
export function leadTimeText(q: { leadMinDays: number | null; leadMaxDays: number | null; lang: "ES" | "EN" }, from: Date = today()) {
  if (q.leadMinDays == null || q.leadMaxDays == null) return null;
  const en = q.lang === "EN";
  const a = addDays(from, q.leadMinDays);
  const b = addDays(from, q.leadMaxDays);
  const f = (d: Date, withMonth: boolean) => new Intl.DateTimeFormat(en ? "en-US" : "es-CO", { day: "numeric", ...(withMonth ? { month: "long" } : {}), timeZone: "UTC" }).format(d);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const range = en
    ? sameMonth ? `${f(a, false)} - ${f(b, false)} ${new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(b)}` : `${f(a, true)} - ${f(b, true)}`
    : sameMonth ? `${f(a, false)} - ${f(b, true)}` : `${f(a, true)} - ${f(b, true)}`;
  return `${q.leadMinDays} - ${q.leadMaxDays} ${en ? "days" : "días"} (${range})`;
}

export function validUntil(q: { issuedAt: Date | null; presentedAt: Date | null; validityDays: number }) {
  const base = q.presentedAt ?? q.issuedAt ?? today();
  const d0 = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  return addDays(d0, q.validityDays);
}

type Check = { ok: boolean; text: string; fix?: string; tab?: string };

export function buildQuote(q: QuoteFull, i: I, policy: { version: number | null; floorPct: number | null; threshold?: number; approvedBy?: string | null }) {
  const { t } = i;
  const now = today();
  const d = q.deal;
  const a = d.account;
  const sale = saleOf(q.lines);
  const cost = costOf(q);
  const esagra = subMoney(sale, cost);
  const pct = sale > 0 ? (esagra / sale) * 100 : null;
  const presented = q.status !== "DRAFT";
  const offerUntil = validUntil(q);
  // Two decimals, as the policy reads it (19.99 % triggers, 20.00 % doesn't).
  const pctR = pct == null ? null : Math.round(pct * 100) / 100;
  const belowFloor = policy.floorPct != null && pctR != null && pctR < policy.floorPct;
  const underThreshold = policy.threshold != null && pctR != null && pctR < policy.threshold;

  // Current expected economics: the latest known costs on the Journey (they can move after presenting).
  const dealCost = sumMoney([d.supplierCost, d.freightCost, d.otherCosts]);
  const currentCost = presented && dealCost > 0 ? dealCost : cost;
  const protSale = q.protSale != null ? money2(q.protSale) : null;
  const curSale = protSale ?? sale;
  const curEsagra = subMoney(curSale, currentCost);
  const curPct = curSale > 0 ? (curEsagra / curSale) * 100 : null;
  const econChanged = presented && q.protCost != null && Math.abs(subMoney(q.protCost, currentCost)) > 0.5;
  const econAlert = presented && policy.floorPct != null && curPct != null && curPct < policy.floorPct;

  // Versions of the landed cost (one column per version of this number).
  const versions = d.quotes
    .filter((x) => x.number === q.number)
    .map((x) => ({ id: x.id, rev: x.rev, status: x.status, supplier: x.fxRate ? mulMoney(x.supplierCost, x.fxRate) : money2(x.supplierCost), freight: money2(x.freightCost), other: money2(x.otherCosts), sale: saleOf(x.lines), note: x.changeNote, current: x.id === q.id }));

  // ---------- Ready to Present (blocks) and Ready If Customer Says Yes (doesn't block) ----------
  const ready: Check[] = [
    { ok: !!d.desiredResult, text: t("El resultado deseado del cliente está escrito", "The customer's desired result is written"), fix: t("Escríbelo en la necesidad del Journey", "Write it in the Journey need"), tab: "solution" },
    { ok: !!q.solution, text: t("La solución está en una frase", "The solution is one sentence"), fix: t("Escribe qué logra el cliente", "Write what the customer achieves"), tab: "solution" },
    { ok: q.lines.length > 0 && q.lines.every((l) => Number(l.unitPrice) > 0), text: t("Todas las líneas tienen precio", "Every line has a price"), fix: t("Completa los precios", "Fill in the prices"), tab: "lines" },
    { ok: Number(q.supplierCost) > 0 && !!q.supplierSrc, text: t("El costo del proveedor tiene fuente", "The supplier cost has a source"), fix: t("Indica de dónde sale (proforma, correo)", "Say where it comes from (proforma, email)"), tab: "costs" },
    { ok: q.leadMinDays != null && q.leadMaxDays != null, text: t("El tiempo de entrega está definido", "Lead time is defined"), fix: t("Indica días después de la OC", "Set days after PO"), tab: "terms" },
    { ok: !!q.promiseText, text: t("La promesa posible tiene su condición", "The possible promise has its condition"), fix: t("Escribe qué prometemos y bajo qué condición", "Write what we promise and under what condition"), tab: "solution" },
    belowFloor
      ? { ok: false, text: t(`La Eságara (${i.pct2(pctR)}) está bajo el umbral de la política (${policy.threshold ?? policy.floorPct} %)`, `Eságara (${i.pct2(pctR)}) is below the policy threshold (${policy.threshold ?? policy.floorPct} %)`), fix: t("Revisa precio o costos, o pide una excepción con su razón", "Review price or costs, or request an exception with its reason"), tab: "costs" }
      : underThreshold
        ? { ok: true, text: t(`Eságara ${i.pct2(pctR)} bajo el umbral, con excepción aprobada${policy.approvedBy ? ` por ${policy.approvedBy}` : ""}`, `Eságara ${i.pct2(pctR)} below the threshold, with an approved exception${policy.approvedBy ? ` by ${policy.approvedBy}` : ""}`) }
        : { ok: true, text: t(`La Eságara (${i.pct(pct)}) no baja del umbral de la política v${policy.version} (${policy.threshold ?? policy.floorPct} %)`, `Eságara (${i.pct(pct)}) is not below policy v${policy.version} threshold (${policy.threshold ?? policy.floorPct} %)`) },
  ];
  const ifYes: Check[] = [
    { ok: a.taxDataComplete, text: t("Datos tributarios del cliente completos", "Customer tax data complete"), fix: t("Si dice sí hoy, no se podría facturar", "If they say yes today, it couldn't be invoiced") },
    { ok: !!q.supplierValidUntil && (!q.decisionAt || q.supplierValidUntil >= q.decisionAt), text: q.supplierValidUntil ? t(`La vigencia del proveedor (${i.day(q.supplierValidUntil)}) cubre la decisión del cliente`, `Supplier validity (${i.day(q.supplierValidUntil)}) covers the customer's decision`) : t("Vigencia del precio del proveedor registrada", "Supplier price validity recorded"), fix: t("Si el cliente decide después, el costo puede cambiar", "If the customer decides later, the cost may change") },
    { ok: q.supplyConfirmed, text: t("El proveedor confirmó disponibilidad y plazo", "Supplier confirmed availability and lead time"), fix: t("Si dice sí, la promesa dependería de un plazo no confirmado", "If they say yes, the promise would rest on an unconfirmed lead time") },
    ...(a.creditLimit != null ? [{ ok: true, text: t(`Cupo de crédito registrado (USD ${i.n(a.creditLimit)})`, `Credit limit on file (USD ${i.n(a.creditLimit)})`) }] : [{ ok: false, text: t("Cupo de crédito del cliente definido", "Customer credit limit defined"), fix: t("Administración tendría que aprobar el crédito antes de comprar", "Administration would need to approve credit before buying") }]),
    ...(a.requiresPortal ? [{ ok: !!a.portalValidUntil && a.portalValidUntil >= now, text: t("Registro en el portal del cliente vigente", "Customer portal registration valid"), fix: t("Sin portal vigente la factura sería rechazada", "Without a valid portal the invoice would be rejected") }] : []),
  ];
  const blocking = ready.filter((c) => !c.ok);

  // ---------- Customer Decision Future (after presenting) ----------
  const waiting = !!d.waitingFor && !!d.waitingUntil && d.waitingUntil >= now;
  const clocks = [
    q.decisionAt && { key: "decision", label: q.decisionLabel ?? t("Decisión del cliente", "Customer decision"), at: q.decisionAt, kind: "customer" as const },
    q.promiseDecideBy && { key: "promise", label: t("La promesa se sostiene si decide antes de", "Promise holds if they decide by"), at: q.promiseDecideBy, kind: "promise" as const },
    q.supplierValidUntil && { key: "supplier", label: t("Vigencia del proveedor", "Supplier validity"), at: q.supplierValidUntil, kind: "supplier" as const },
    { key: "offer", label: t("Vigencia de la oferta al cliente", "Offer validity to customer"), at: offerUntil, kind: "offer" as const },
  ].filter(Boolean) as { key: string; label: string; at: Date; kind: "customer" | "promise" | "supplier" | "offer" }[];
  clocks.sort((x, y) => +x.at - +y.at);

  // Influence window: from today until the first limit that changes the result.
  const limits = clocks.filter((c) => c.kind !== "customer");
  const firstLimit = limits[0] ?? null;
  const windowEnd = q.decisionAt && firstLimit ? (q.decisionAt < firstLimit.at ? q.decisionAt : firstLimit.at) : q.decisionAt ?? firstLimit?.at ?? null;

  let next: { kind: "move" | "wait" | "clarity" | "risk"; title: string; why: string } | null = null;
  if (q.status === "PRESENTED") {
    if (q.supplierValidUntil && q.decisionAt && q.supplierValidUntil < q.decisionAt) {
      next = { kind: "risk", title: t("Pedir al proveedor que extienda su vigencia", "Ask the supplier to extend its validity"), why: t(`El precio del proveedor vence el ${i.day(q.supplierValidUntil)}, antes de ${q.decisionLabel ?? "la decisión"} (${i.day(q.decisionAt)}).`, `The supplier price expires ${i.day(q.supplierValidUntil)}, before ${q.decisionLabel ?? "the decision"} (${i.day(q.decisionAt)}).`) };
    } else if (q.decisionAt && offerUntil < q.decisionAt) {
      next = { kind: "risk", title: t("Extender la vigencia de la oferta", "Extend the offer validity"), why: t(`La oferta vence el ${i.day(offerUntil)} y el cliente decide el ${i.day(q.decisionAt)}.`, `The offer expires ${i.day(offerUntil)} and the customer decides ${i.day(q.decisionAt)}.`) };
    } else if (waiting) {
      next = { kind: "wait", title: t("Nada que hacer hoy", "No action today"), why: t(`Esperando con control: «${d.waitingFor}». SOLU vuelve a ponerlo en Mi Día el ${i.day(d.waitingUntil)}${q.decisionAt ? ` o si cambia algo antes de ${q.decisionLabel ?? "la decisión"}` : ""}.`, `Waiting with control: "${d.waitingFor}". SOLU brings it back to My Day on ${i.day(d.waitingUntil)}${q.decisionAt ? ` or if anything changes before ${q.decisionLabel ?? "the decision"}` : ""}.`) };
    } else if (!q.decisionAt) {
      next = { kind: "clarity", title: t("Averiguar cómo y cuándo decide el cliente", "Find out how and when the customer decides"), why: t("Sin fecha de decisión no sabemos si los relojes del proveedor y de la promesa alcanzan.", "Without a decision date we can't tell whether the supplier and promise clocks are enough.") };
    } else if (daysBetween(now, q.decisionAt) >= 1) {
      next = { kind: "move", title: t(`Antes de ${q.decisionLabel ?? "la decisión"}: confirmar qué necesita ver quien decide`, `Before ${q.decisionLabel ?? "the decision"}: confirm what the decision-maker needs to see`), why: t(`Todavía hay ${daysBetween(now, q.decisionAt)} día(s) en los que una acción cambia el resultado.`, `There are still ${daysBetween(now, q.decisionAt)} day(s) where an action changes the result.`) };
    } else {
      next = { kind: "move", title: t("Preguntar por la decisión", "Ask about the decision"), why: t(`${q.decisionLabel ?? "La decisión"} era el ${i.day(q.decisionAt)}.`, `${q.decisionLabel ?? "The decision"} was on ${i.day(q.decisionAt)}.`) };
    }
  }

  return {
    sale, cost, esagra, pct, presented, offerUntil, belowFloor, underThreshold, versions,
    protSale, currentCost, curSale, curEsagra, curPct, econChanged, econAlert,
    ready, ifYes, blocking, clocks, windowEnd, next, waiting, now,
    leadText: leadTimeText(q, q.presentedAt ?? now),
  };
}

/** Where a quote lands in the person's Commercial Future. */
export function futureZone(b: ReturnType<typeof buildQuote>) {
  if (!b.next) return null;
  if (b.next.kind === "wait") return "waiting" as const;
  if (b.next.kind === "clarity") return "clarity" as const;
  if (b.next.kind === "risk") return "today" as const;
  if (b.windowEnd && daysBetween(b.now, b.windowEnd) <= 3) return "window" as const;
  return "today" as const;
}
