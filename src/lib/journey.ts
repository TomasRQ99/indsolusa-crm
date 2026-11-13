import type { Prisma } from "@prisma/client";
import { addDays, daysBetween, esagra, invoiceCash, today } from "./domain";
import type { makeI18n } from "./i18n";
import { expectedOf } from "./logistics";

// Journey Workspace: everything the page needs to tell the Journey as a living story.
// Three separate truths are never merged: Carrier ETA (what the carrier says),
// SOLU Expected (what SOLU calculates for the customer) and Customer Promise (what we said).

type I = ReturnType<typeof makeI18n>;

/** Days SOLU adds after the carrier's arrival: customs/receiving + final delivery to the customer. */
export const CLEARANCE_DAYS = 3;
export const LAST_MILE_DAYS = 1;

export const journeyInclude = {
  account: true,
  contact: true,
  owner: { select: { id: true, name: true } },
  items: { include: { deliveryLines: { select: { qty: true } } }, orderBy: { id: "asc" } },
  supplierPos: {
    include: { supplier: true, payments: { orderBy: { createdAt: "desc" }, include: { executions: true } } },
    orderBy: { createdAt: "asc" },
  },
  deliveries: { include: { lines: true, invoice: { select: { id: true, number: true } } }, orderBy: { deliveredAt: "asc" } },
  shipments: { include: { events: { where: { material: true }, orderBy: { at: "desc" }, take: 5 } }, orderBy: { createdAt: "asc" } },
  invoices: {
    include: {
      applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true, reference: true } } } },
      promises: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { issuedAt: "asc" },
  },
  recoveries: { where: { resolvedAt: null }, select: { id: true, whatChanged: true, openedAt: true } },
  tasks: { where: { status: "OPEN" }, include: { assignee: { select: { name: true } } }, orderBy: { dueDate: "asc" } },
  activities: { orderBy: { occurredAt: "desc" }, take: 80, include: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.DealInclude;

export type JourneyDeal = Prisma.DealGetPayload<{ include: typeof journeyInclude }>;

export type Tone = "risk" | "move" | "clarity" | "ok" | "wait";
export type TabKey = "resumen" | "need" | "source" | "quote" | "execute" | "finance" | "file" | "result";
export type PathKey = "need" | "source" | "quote" | "po" | "purchase" | "pay" | "ship" | "deliver" | "invoice" | "cash" | "result";
export type PathState = "done" | "now" | "late" | "wait" | "risk" | "later" | "gap";
export type PathStep = { key: PathKey; label: string; tab: TabKey; state: PathState };
/** What a Journey asks of the person looking at a list, from the few fields a list already has. */
export function cardAsk(d: { stage: string; nextMove: string | null; nextMoveDate: Date | null; waitingFor: string | null; waitingUntil: Date | null; promisedDate: Date | null; resultAchievedAt: Date | null; deliveries: number }, now: Date): PathState | null {
  if (d.stage === "LOST") return "later";
  if (d.resultAchievedAt) return "done";
  if (d.stage === "WON" && d.promisedDate && d.promisedDate < now && d.deliveries === 0) return "risk";
  if (d.waitingFor) return d.waitingUntil && d.waitingUntil < now ? "late" : "wait";
  if (d.nextMove) return !d.nextMoveDate ? "now" : d.nextMoveDate > now ? "later" : d.nextMoveDate < now ? "late" : "now";
  return d.stage === "WON" ? null : "now";
}
export type Fact = { key: string; text: string; when: Date | null; src: string; uncertain?: boolean; activityId?: string; poId?: string };
export type Change = { at: Date; what: string; cons?: string };
export type Doc = { kind: string; title: string; sub: string; href?: string };

const day0 = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const maxDate = (ds: (Date | null | undefined)[]) => ds.filter((d): d is Date => !!d).reduce<Date | null>((m, d) => (!m || d > m ? d : m), null);

export function buildJourney(deal: JourneyDeal, i: I, viewerId: string, since: Date | null) {
  const { t } = i;
  const now = today();
  const eg = esagra(deal);
  const won = deal.stage === "WON";
  const lost = deal.stage === "LOST";

  // ---------- Chain facts ----------
  const ordered = deal.items.reduce((s, it) => s + it.qty, 0);
  const delivered = deal.items.reduce((s, it) => s + it.deliveryLines.reduce((x, l) => x + l.qty, 0), 0);
  const cash = deal.invoices.map((inv) => ({ inv, ...invoiceCash(inv) }));
  const invoiced = cash.reduce((s, c) => s + c.amount, 0);
  const reconciled = cash.reduce((s, c) => s + c.reconciled, 0);
  const balance = cash.reduce((s, c) => s + c.balance, 0);
  const fullyDelivered = ordered > 0 ? delivered >= ordered : deal.deliveries.length > 0;
  const fullyInvoiced = Number(deal.amount) > 0 && invoiced >= Number(deal.amount) - 0.5;
  const fullyCollected = fullyInvoiced && cash.every((c) => c.balance <= 0.005);
  const lastDelivery = maxDate(deal.deliveries.map((d) => d.deliveredAt));
  const openPos = deal.supplierPos.filter((p) => !p.receivedAt);
  const allReceived = deal.supplierPos.length > 0 && openPos.length === 0;
  const overdueInv = cash.filter((c) => c.balance > 0.005 && c.inv.dueAt < now);
  const uninvoicedDeliveries = deal.deliveries.filter((d) => !d.invoice);

  // ---------- Three truths ----------
  // 0. Shipments are the source of the carrier's truth when they exist (the latest-expected open one).
  const openShips = deal.shipments
    .filter((s) => s.receipt !== "CONFIRMED")
    .map((s) => ({ s, e: expectedOf({ ...s, customs: s.customs, receipt: s.receipt }, i) }))
    .sort((a, b) => (b.e.date?.getTime() ?? Infinity) - (a.e.date?.getTime() ?? Infinity));
  const mainShip = openShips[0] ?? null;
  const shippedPoIds = new Set(deal.shipments.map((s) => s.supplierPoId).filter(Boolean));
  // 1. Carrier ETA: the most relevant open PO (latest date among those still travelling).
  const carrierPo = openPos.filter((p) => p.carrierEta && !shippedPoIds.has(p.id)).sort((a, b) => +b.carrierEta! - +a.carrierEta!)[0] ?? null;
  const supplierEtaPo = openPos.filter((p) => p.eta).sort((a, b) => +b.eta! - +a.eta!)[0] ?? null;
  const shipDate = mainShip ? mainShip.s.deliveredAt ?? mainShip.s.carrierEta : null;
  const carrier = mainShip && shipDate
    ? {
        date: shipDate,
        who: mainShip.s.carrierName,
        src: mainShip.s.deliveredAt ? t("Entregado según el transportista", "Delivered per carrier") : mainShip.s.carrierEtaSource ?? (mainShip.s.tracking ? `${t("Guía", "Tracking")} ${mainShip.s.tracking}` : mainShip.s.code),
        reportedAt: mainShip.s.carrierEtaAt,
        stale: !mainShip.s.deliveredAt && !!mainShip.s.carrierEtaAt && daysBetween(day0(mainShip.s.carrierEtaAt), now) > 3,
        late: !mainShip.s.deliveredAt && shipDate < now,
        po: null as (typeof deal.supplierPos)[number] | null,
        ship: mainShip.s as (typeof deal.shipments)[number] | null,
        fallback: false,
      }
    : carrierPo
    ? {
        date: carrierPo.carrierEta!,
        who: carrierPo.carrierName ?? t("Transportista", "Carrier"),
        src: carrierPo.carrierEtaSource ?? (carrierPo.tracking ? `${t("Guía", "Tracking")} ${carrierPo.tracking}` : carrierPo.code),
        reportedAt: carrierPo.carrierEtaAt,
        stale: !!carrierPo.carrierEtaAt && daysBetween(day0(carrierPo.carrierEtaAt), now) > 3,
        late: carrierPo.carrierEta! < now,
        po: carrierPo as (typeof deal.supplierPos)[number] | null,
        ship: null as (typeof deal.shipments)[number] | null,
        fallback: false,
      }
    : supplierEtaPo
      ? {
          date: supplierEtaPo.eta!,
          who: supplierEtaPo.supplier.name,
          src: t(`ETA del proveedor · ${supplierEtaPo.code}`, `Supplier ETA · ${supplierEtaPo.code}`),
          reportedAt: null as Date | null,
          stale: false,
          late: supplierEtaPo.eta! < now,
          po: supplierEtaPo as (typeof deal.supplierPos)[number] | null,
          ship: null as (typeof deal.shipments)[number] | null,
          fallback: true,
        }
      : null;

  // 2. SOLU Expected: when the customer should actually have it.
  let expected: { date: Date | null; done: boolean; calc: string } = { date: null, done: false, calc: "" };
  if (fullyDelivered && lastDelivery) {
    expected = { date: lastDelivery, done: true, calc: t("Entregado al cliente", "Delivered to the customer") };
  } else if (mainShip && (mainShip.e.date || mainShip.s.receipt === "DISPUTED")) {
    expected = { date: mainShip.e.date, done: false, calc: `${mainShip.s.code} · ${mainShip.e.calc}` };
  } else if (allReceived) {
    const base = maxDate([...deal.supplierPos.map((p) => p.receivedAt), now])!;
    expected = { date: addDays(base, LAST_MILE_DAYS), done: false, calc: t(`Todo está en bodega · + ${LAST_MILE_DAYS} día de entrega`, `Everything is in the warehouse · + ${LAST_MILE_DAYS} day to deliver`) };
  } else if (carrier) {
    const base = carrier.late ? now : carrier.date;
    const buf = CLEARANCE_DAYS + LAST_MILE_DAYS;
    expected = {
      date: addDays(base, buf),
      done: false,
      calc: carrier.late
        ? t(`La ETA (${i.day(carrier.date)}) pasó sin llegada · hoy + ${buf} días`, `ETA (${i.day(carrier.date)}) passed with no arrival · today + ${buf} days`)
        : t(`${carrier.fallback ? "ETA proveedor" : "ETA transportista"} ${i.day(carrier.date)} + ${CLEARANCE_DAYS} días recibo/aduana + ${LAST_MILE_DAYS} de entrega`, `${carrier.fallback ? "Supplier ETA" : "Carrier ETA"} ${i.day(carrier.date)} + ${CLEARANCE_DAYS} days receiving/customs + ${LAST_MILE_DAYS} to deliver`),
    };
  } else if (deal.supplierPos.length) {
    expected = { date: null, done: false, calc: t("Falta una ETA del proveedor o del transportista para calcular", "Needs a supplier or carrier ETA to calculate") };
  } else {
    expected = { date: null, done: false, calc: won ? t("Aún no hay compra al proveedor", "No supplier purchase yet") : t("Se calcula cuando exista la compra", "Calculated once there is a purchase") };
  }

  // 3. Customer promise and the gap against SOLU Expected.
  const promise = { text: deal.promiseText, date: deal.promisedDate };
  const gapDays = expected.date && promise.date ? daysBetween(promise.date, expected.date) : null; // > 0 = later than promised
  const promisePast = !!promise.date && promise.date < now && !fullyDelivered;
  const promiseState: { tone: Tone; text: string } = !promise.date
    ? { tone: "clarity", text: t("Sin fecha prometida", "No promised date") }
    : expected.done
      ? gapDays! > 0
        ? { tone: "wait", text: t(`Entregado ${gapDays} días después de lo prometido`, `Delivered ${gapDays} days after the promise`) }
        : { tone: "ok", text: t("Cumplida", "Kept") }
      : promisePast
        ? { tone: "risk", text: t(`Se pasó hace ${daysBetween(promise.date, now)} días sin entrega completa`, `Passed ${daysBetween(promise.date, now)} days ago without full delivery`) }
        : gapDays == null
          ? { tone: "wait", text: t("Aún sin cálculo de SOLU para comparar", "No SOLU estimate yet to compare") }
          : gapDays > 0
            ? { tone: "risk", text: t(`En riesgo: SOLU espera ${gapDays} días después`, `At risk: SOLU expects ${gapDays} days later`) }
            : gapDays === 0
              ? { tone: "move" as Tone, text: t("Se cumple justo, sin margen", "On track, with no margin") }
              : { tone: "ok", text: t(`Se cumple con ${-gapDays} día(s) de margen`, `On track with ${-gapDays} day(s) of margin`) };

  // ---------- Next useful movement (FORWARD) ----------
  const waitExpired = !!deal.waitingFor && !!deal.waitingUntil && deal.waitingUntil < now;
  const moveDue = !!deal.nextMove && !!deal.nextMoveDate && deal.nextMoveDate <= now;
  let suggestion: { what: string; why: string; tab: TabKey } | null = null;
  if (!lost && !deal.resultAchievedAt && !deal.closedAt && deal.resultState !== "NO_LONGER_RELEVANT") {
    if (won) {
      const unconfirmed = deal.supplierPos.find((p) => !p.confirmedAt);
      const noEta = deal.supplierPos.find((p) => p.shippedAt && !p.receivedAt && !p.carrierEta && !shippedPoIds.has(p.id));
      if (!deal.supplierPos.length) suggestion = { what: t("Emitir la compra al proveedor", "Issue the supplier purchase"), why: t("La OC del cliente está aceptada y aún no hay Supplier PO.", "The customer PO is accepted and there is no supplier PO yet."), tab: "execute" };
      else if (unconfirmed) suggestion = { what: t(`Confirmar ${unconfirmed.code} con ${unconfirmed.supplier.name}`, `Confirm ${unconfirmed.code} with ${unconfirmed.supplier.name}`), why: t("Sin confirmación del proveedor no hay fecha confiable.", "Without supplier confirmation there is no reliable date."), tab: "execute" };
      else if (noEta) suggestion = { what: t(`Pedir la ETA del transportista para ${noEta.code}`, `Ask the carrier for the ETA of ${noEta.code}`), why: t("Ya salió, pero SOLU no puede calcular la llegada sin la fecha del transportista.", "It has shipped, but SOLU can't estimate arrival without the carrier's date."), tab: "execute" };
      else if (carrier?.stale) suggestion = { what: t(`Actualizar la ETA con ${carrier.who}`, `Update the ETA with ${carrier.who}`), why: t(`La última ETA se reportó el ${i.day(carrier.reportedAt)}.`, `The last ETA was reported on ${i.day(carrier.reportedAt)}.`), tab: "execute" };
      else if (allReceived && !fullyDelivered) suggestion = { what: t("Programar la entrega al cliente", "Schedule delivery to the customer"), why: t("Todo está en bodega.", "Everything is in the warehouse."), tab: "execute" };
      else if (uninvoicedDeliveries.length) suggestion = { what: t(`Facturar ${uninvoicedDeliveries[0].code}`, `Invoice ${uninvoicedDeliveries[0].code}`), why: t("Entregado sin facturar no se puede cobrar.", "Delivered but not invoiced can't be collected."), tab: "finance" };
      else if (overdueInv.length) suggestion = { what: t(`Conseguir fecha de pago de ${overdueInv[0].inv.number}`, `Get a payment date for ${overdueInv[0].inv.number}`), why: t(`Venció el ${i.day(overdueInv[0].inv.dueAt)}.`, `It was due on ${i.day(overdueInv[0].inv.dueAt)}.`), tab: "finance" };
      else if (fullyDelivered && !deal.resultAchievedAt) suggestion = { what: t("Confirmar con el cliente que logró su resultado", "Confirm with the customer that they achieved the result"), why: t("Entregar no es resolver.", "Delivering is not solving."), tab: "result" };
    } else {
      if (!deal.desiredResult) suggestion = { what: t("Acordar con el cliente el resultado que busca", "Agree with the customer on the result they want"), why: t("Sin resultado deseado no sabemos qué es éxito.", "Without a desired result we don't know what success is."), tab: "need" };
      else if (!deal.items.length && Number(deal.amount) === 0) suggestion = { what: t("Armar la cotización", "Build the quote"), why: t("Ya sabemos qué necesita; falta ponerle precio.", "We know what they need; it needs a price."), tab: "quote" };
      else if (!deal.quoteSentAt) suggestion = { what: t("Enviar la cotización", "Send the quote"), why: t("La cotización está lista pero no figura como enviada.", "The quote is ready but not marked as sent."), tab: "quote" };
      else if (deal.offerValidUntil && daysBetween(now, deal.offerValidUntil) <= 3) suggestion = { what: t("Pedir la decisión antes de que venza la oferta", "Ask for the decision before the offer expires"), why: t(`La oferta vence el ${i.day(deal.offerValidUntil)}.`, `The offer expires on ${i.day(deal.offerValidUntil)}.`), tab: "quote" };
      else suggestion = { what: t("Hacer seguimiento a la cotización", "Follow up on the quote"), why: t(`Enviada el ${i.day(deal.quoteSentAt)}.`, `Sent on ${i.day(deal.quoteSentAt)}.`), tab: "quote" };
    }
  }
  const forward = deal.waitingFor
    ? { mode: "wait" as const, what: deal.waitingFor, date: deal.waitingUntil, late: waitExpired }
    : deal.nextMove
      ? { mode: "move" as const, what: deal.nextMove, date: deal.nextMoveDate, late: !!deal.nextMoveDate && deal.nextMoveDate < now }
      : { mode: "none" as const, what: suggestion?.what ?? null, date: null, late: false };

  // ---------- Attention signal (derived, with its cause) ----------
  let signal: { tone: Tone; label: string; why: string };
  if (lost) signal = { tone: "wait", label: t("Perdido", "Lost"), why: t("Esta Necesidad se cerró sin venta.", "This Necessity closed without a sale.") };
  else if (deal.closedAt) signal = { tone: "ok", label: t("Cerrado", "Closed"), why: deal.closureLearning ? t(`Aprendizaje: ${deal.closureLearning}`, `Learning: ${deal.closureLearning}`) : t("Necesidad cerrada.", "Necessity closed.") };
  else if (deal.recoveries.length) signal = { tone: "risk", label: t("Recovery abierta", "Recovery open"), why: deal.recoveries[0].whatChanged };
  else if (deal.resultState === "NOT_ACHIEVED") signal = { tone: "risk", label: t("Resultado no logrado", "Result not achieved"), why: t("El producto llegó pero no resolvió.", "The product arrived but didn't solve it.") };
  else if (deal.resultAchievedAt && fullyCollected) signal = { tone: "ok", label: t("Resultado logrado", "Result achieved"), why: t("El cliente confirmó su resultado y todo está cobrado.", "The customer confirmed the result and everything is collected.") };
  else if (promisePast) signal = { tone: "risk", label: t("Promesa vencida", "Promise missed"), why: promiseState.text };
  else if (gapDays != null && gapDays > 0 && !expected.done) signal = { tone: "risk", label: t("Promesa en riesgo", "Promise at risk"), why: t(`SOLU espera ${i.day(expected.date)}; prometimos ${i.day(promise.date)}.`, `SOLU expects ${i.day(expected.date)}; we promised ${i.day(promise.date)}.`) };
  else if (overdueInv.length) signal = { tone: "risk", label: t("Cobro vencido", "Payment overdue"), why: t(`${overdueInv[0].inv.number} venció el ${i.day(overdueInv[0].inv.dueAt)} · saldo USD ${i.n(overdueInv[0].balance)}`, `${overdueInv[0].inv.number} was due ${i.day(overdueInv[0].inv.dueAt)} · balance USD ${i.n(overdueInv[0].balance)}`) };
  else if (waitExpired) signal = { tone: "move", label: t("La espera venció", "Wait expired"), why: t(`Esperábamos «${deal.waitingFor}» hasta el ${i.day(deal.waitingUntil)}.`, `We were waiting for "${deal.waitingFor}" until ${i.day(deal.waitingUntil)}.`) };
  else if (moveDue) signal = { tone: "move", label: forward.late ? t("Movimiento atrasado", "Move overdue") : t("Movimiento para hoy", "Move for today"), why: deal.nextMove! };
  else if (!won && deal.offerValidUntil && deal.offerValidUntil >= now && daysBetween(now, deal.offerValidUntil) <= 3) signal = { tone: "move", label: t("La oferta vence pronto", "Offer expires soon"), why: t(`Vigente hasta el ${i.day(deal.offerValidUntil)}.`, `Valid until ${i.day(deal.offerValidUntil)}.`) };
  else if (!deal.desiredResult) signal = { tone: "clarity", label: t("Falta claridad", "Needs clarity"), why: t("No está escrito qué resultado busca el cliente.", "The customer's desired result isn't written down.") };
  else if (!won && forward.mode === "none") signal = { tone: "clarity", label: t("Sin siguiente movimiento", "No next movement"), why: t("Nadie tiene definido qué sigue.", "Nobody has defined what's next.") };
  else signal = {
    tone: "ok",
    label: t("Bajo control", "Under control"),
    why: forward.mode === "wait"
      ? t(`Esperando «${forward.what}» hasta el ${i.day(forward.date)}.`, `Waiting for "${forward.what}" until ${i.day(forward.date)}.`)
      : forward.mode === "move"
        ? t(`Siguiente: ${forward.what}${forward.date ? ` · ${i.day(forward.date)}` : ""}.`, `Next: ${forward.what}${forward.date ? ` · ${i.day(forward.date)}` : ""}.`)
        : t("SOLU sigue la compra, el envío, la entrega y el cobro.", "SOLU follows purchase, shipping, delivery and cash."),
  };

  // ---------- NOW: facts with date and source ----------
  const facts: Fact[] = [];
  if (deal.customerPo) facts.push({ key: "po", text: t(`OC ${deal.customerPo} aceptada`, `PO ${deal.customerPo} accepted`), when: deal.poAcceptedAt, src: t("OC del cliente", "Customer PO") });
  else if (deal.quoteSentAt) facts.push({ key: "quote", text: t(`Cotización enviada${Number(deal.amount) ? ` · USD ${i.n(deal.amount)}` : ""}`, `Quote sent${Number(deal.amount) ? ` · USD ${i.n(deal.amount)}` : ""}`), when: deal.quoteSentAt, src: t("Cotización", "Quote") });
  for (const p of deal.supplierPos) {
    if (p.receivedAt) facts.push({ key: `po-${p.id}`, text: t(`${p.code} llegó a bodega`, `${p.code} arrived at the warehouse`), when: p.receivedAt, src: p.supplier.name });
    else if (p.shippedAt) {
      facts.push({ key: `po-${p.id}`, text: t(`${p.supplier.name} despachó ${p.code}`, `${p.supplier.name} shipped ${p.code}`), when: p.shippedAt, src: p.code });
      if (shippedPoIds.has(p.id)) { /* the Shipment carries the carrier's truth */ }
      else if (p.carrierEta) {
        const stale = !!p.carrierEtaAt && daysBetween(day0(p.carrierEtaAt), now) > 3;
        const late = p.carrierEta < now;
        facts.push({
          key: `eta-${p.id}`,
          text: late
            ? t(`${p.carrierName ?? "El transportista"} dijo que llegaba el ${i.day(p.carrierEta)} y no ha llegado`, `${p.carrierName ?? "The carrier"} said it would arrive ${i.day(p.carrierEta)} and it hasn't`)
            : t(`${p.carrierName ?? "El transportista"} reporta llegada el ${i.day(p.carrierEta)}`, `${p.carrierName ?? "The carrier"} reports arrival on ${i.day(p.carrierEta)}`),
          when: p.carrierEtaAt,
          src: p.carrierEtaSource ?? (p.tracking ? `${t("Guía", "Tracking")} ${p.tracking}` : t("Transportista", "Carrier")),
          uncertain: stale || late,
          poId: p.id,
        });
      } else facts.push({ key: `eta-${p.id}`, text: t(`Sin ETA del transportista para ${p.code}`, `No carrier ETA for ${p.code}`), when: null, src: t("Falta el dato", "Data missing"), uncertain: true, poId: p.id });
    } else if (p.confirmedAt) facts.push({ key: `po-${p.id}`, text: t(`${p.supplier.name} confirmó ${p.code}${p.eta ? ` · ETA ${i.day(p.eta)}` : ""}`, `${p.supplier.name} confirmed ${p.code}${p.eta ? ` · ETA ${i.day(p.eta)}` : ""}`), when: p.confirmedAt, src: p.code });
    else facts.push({ key: `po-${p.id}`, text: t(`${p.code} enviada a ${p.supplier.name}, sin confirmar`, `${p.code} sent to ${p.supplier.name}, not confirmed`), when: p.createdAt, src: p.code, uncertain: daysBetween(day0(p.createdAt), now) > 2 });
    const pay = p.payments[0];
    if (pay) {
      const sent = pay.executions.find((e) => e.state === "SENT" || e.state === "UNCERTAIN");
      facts.push({
        key: `pay-${pay.id}`,
        text: pay.executedAt ? t(`Pago a ${p.supplier.name} confirmado`, `Payment to ${p.supplier.name} confirmed`)
          : sent ? (sent.state === "UNCERTAIN" ? t(`Pago a ${p.supplier.name}: ejecución incierta`, `Payment to ${p.supplier.name}: uncertain execution`) : t(`Pago a ${p.supplier.name} enviado al banco, sin confirmar`, `Payment to ${p.supplier.name} sent to bank, not confirmed`))
          : pay.approvedAt ? t(`Pago a ${p.supplier.name} aprobado, no enviado`, `Payment to ${p.supplier.name} approved, not sent`)
          : t(`Pago a ${p.supplier.name} solicitado`, `Payment to ${p.supplier.name} requested`),
        when: pay.executedAt ?? sent?.sentAt ?? pay.approvedAt ?? pay.createdAt,
        src: pay.executedRef ?? pay.docSource ?? t("Pago a proveedor", "Supplier payment"),
        uncertain: !!sent,
      });
    }
  }
  for (const { s, e } of openShips) {
    const ex = s.events[0];
    facts.push({
      key: `shp-${s.id}`,
      text: s.receipt === "DISPUTED" ? t(`${s.carrierName} dice entregado; el cliente disputa el recibo`, `${s.carrierName} says delivered; customer disputes receipt`)
        : s.customs === "HOLD" ? t(`${s.code} retenido en aduana`, `${s.code} held at customs`)
        : s.deliveredAt ? t(`${s.carrierName} entregó ${s.code}`, `${s.carrierName} delivered ${s.code}`)
        : s.carrierEta ? t(`${s.carrierName} reporta llegada el ${i.day(s.carrierEta)}${e.date ? ` · SOLU espera ${i.day(e.date)}` : ""}`, `${s.carrierName} reports arrival on ${i.day(s.carrierEta)}${e.date ? ` · SOLU expects ${i.day(e.date)}` : ""}`)
        : t(`${s.code} sin ETA del transportista`, `${s.code} without carrier ETA`),
      when: ex?.at ?? s.carrierEtaAt ?? s.createdAt,
      src: s.tracking ? `${s.carrierName} · ${s.tracking}` : s.code,
      uncertain: s.receipt === "DISPUTED" || s.customs === "HOLD" || !s.carrierEta,
    });
  }
  if (deal.deliveries.length) facts.push({ key: "deliv", text: ordered ? t(`Entregadas ${delivered} de ${ordered} unidades`, `${delivered} of ${ordered} units delivered`) : t(`${deal.deliveries.length} entrega(s) registradas`, `${deal.deliveries.length} deliveries recorded`), when: lastDelivery, src: deal.deliveries[deal.deliveries.length - 1].code });
  for (const c of cash) {
    const prom = c.inv.promises[0];
    facts.push({ key: `inv-${c.inv.id}`, text: c.balance <= 0.005 ? t(`Factura ${c.inv.number} cobrada`, `Invoice ${c.inv.number} collected`) : t(`Factura ${c.inv.number} · saldo USD ${i.n(c.balance)} · vence ${i.day(c.inv.dueAt)}`, `Invoice ${c.inv.number} · balance USD ${i.n(c.balance)} · due ${i.day(c.inv.dueAt)}`), when: c.inv.issuedAt, src: t("Factura", "Invoice") });
    if (prom && c.balance > 0.005) facts.push({ key: `prom-${prom.id}`, text: t(`${prom.promisedBy} prometió pagar el ${i.day(prom.promisedFor)}`, `${prom.promisedBy} promised to pay on ${i.day(prom.promisedFor)}`), when: prom.createdAt, src: prom.source, uncertain: prom.promisedFor < now });
  }
  const manual = deal.activities.filter((a) => a.phase && a.phase !== "promise").slice(0, 4);
  for (const a of manual) facts.push({ key: `a-${a.id}`, text: a.subject, when: a.occurredAt, src: a.source ?? a.user.name, uncertain: a.uncertain, activityId: a.id });
  const lastTalk = deal.activities.find((a) => a.type !== "NOTE");
  if (lastTalk && !manual.some((m) => m.id === lastTalk.id)) facts.push({ key: `talk-${lastTalk.id}`, text: lastTalk.subject, when: lastTalk.occurredAt, src: `${typeLabel(i, lastTalk.type)} · ${lastTalk.user.name}` });
  facts.sort((a, b) => Number(!!b.uncertain) - Number(!!a.uncertain) || (b.when?.getTime() ?? 0) - (a.when?.getTime() ?? 0));
  const nowFacts = facts.slice(0, 6);

  // ---------- What changed since the last visit ----------
  const from = since ?? addDays(new Date(), -7);
  const changes: Change[] = [];
  const add = (at: Date | null | undefined, what: string, cons?: string) => { if (at && at > from) changes.push({ at, what, cons }); };
  for (const a of deal.activities) {
    if (a.user.id === viewerId) continue;
    add(a.occurredAt > new Date() ? null : a.occurredAt, `${a.user.name}: ${a.subject}`, a.body && a.body !== "✓" ? a.body : a.uncertain ? t("Pendiente de confirmar", "Needs confirming") : undefined);
  }
  add(deal.poAcceptedAt, t(`El cliente aceptó la OC ${deal.customerPo ?? ""}`, `The customer accepted PO ${deal.customerPo ?? ""}`), t("Comienza la compra", "Purchasing starts"));
  // Shipments: only material events reach "what changed" (normal scans never do).
  for (const s of deal.shipments) for (const e of s.events) add(e.at, `${s.code}: ${e.text}`);
  for (const p of deal.supplierPos) {
    add(p.createdAt,t(`Se emitió ${p.code} a ${p.supplier.name}`, `${p.code} issued to ${p.supplier.name}`));
    add(p.confirmedAt, t(`${p.supplier.name} confirmó ${p.code}`, `${p.supplier.name} confirmed ${p.code}`));
    add(p.shippedAt, t(`${p.supplier.name} despachó ${p.code}`, `${p.supplier.name} shipped ${p.code}`));
    if (!shippedPoIds.has(p.id)) add(p.carrierEtaAt, t(`ETA del transportista: ${i.day(p.carrierEta)}`, `Carrier ETA: ${i.day(p.carrierEta)}`), expected.date && !expected.done ? t(`SOLU ahora espera ${i.day(expected.date)}`, `SOLU now expects ${i.day(expected.date)}`) : undefined);
    add(p.receivedAt, t(`${p.code} llegó a bodega`, `${p.code} arrived at the warehouse`));
    for (const pay of p.payments) {
      add(pay.createdAt, t(`Se solicitó pago a ${p.supplier.name}`, `Payment to ${p.supplier.name} requested`));
      add(pay.approvedAt, t(`Pago a ${p.supplier.name} aprobado (aún no pagado)`, `Payment to ${p.supplier.name} approved (not paid yet)`));
      add(pay.executedAt, t(`Pago a ${p.supplier.name} confirmado`, `Payment to ${p.supplier.name} confirmed`));
    }
  }
  for (const d of deal.deliveries) add(d.createdAt, t(`Entrega ${d.code} registrada`, `Delivery ${d.code} recorded`), d.invoice ? undefined : t("Falta facturarla", "Needs invoicing"));
  for (const c of cash) {
    add(c.inv.createdAt, t(`Factura ${c.inv.number} emitida · USD ${i.n(c.amount)}`, `Invoice ${c.inv.number} issued · USD ${i.n(c.amount)}`));
    for (const pr of c.inv.promises) add(pr.createdAt, t(`${pr.promisedBy} prometió pagar el ${i.day(pr.promisedFor)}`, `${pr.promisedBy} promised to pay on ${i.day(pr.promisedFor)}`));
    for (const ap of c.inv.applications) add(ap.payment.receivedAt, t(`Pago recibido · USD ${i.n(ap.amount)}`, `Payment received · USD ${i.n(ap.amount)}`), ap.payment.reconciledAt ? undefined : t("Falta conciliarlo", "Needs reconciling"));
  }
  add(deal.resultAchievedAt, t("El cliente confirmó su resultado", "The customer confirmed the result"));
  changes.sort((a, b) => +b.at - +a.at);

  // ---------- Evidence and conversation ----------
  const docs: Doc[] = [];
  if (deal.customerPo) docs.push({ kind: "OC", title: t(`OC del cliente ${deal.customerPo}`, `Customer PO ${deal.customerPo}`), sub: i.day(deal.poAcceptedAt) });
  for (const p of deal.supplierPos) {
    docs.push({ kind: "SPO", title: p.code, sub: `${p.supplier.name} · ${p.currency} ${i.n(p.amount)}` });
    for (const pay of p.payments) if (pay.docSource) docs.push({ kind: "PF", title: pay.docSource, sub: t("Instrucción de pago del proveedor", "Supplier payment instruction"), href: `/administracion/pagos-proveedores/${pay.id}` });
  }
  for (const d of deal.deliveries) docs.push({ kind: "REM", title: d.code, sub: `${i.day(d.deliveredAt)}${d.podReceived ? t(" · con prueba de entrega", " · with proof of delivery") : t(" · sin prueba de entrega", " · no proof of delivery")}`, href: `/operaciones/remisiones/${d.id}` });
  for (const c of cash) docs.push({ kind: "FAC", title: c.inv.number, sub: `USD ${i.n(c.amount)} · ${i.day(c.inv.issuedAt)}` });
  const conversation = deal.activities.filter((a) => a.type !== "NOTE").slice(0, 3);

  // ---------- Progressive tabs ----------
  const has: Record<Exclude<TabKey, "resumen">, boolean> = {
    need: true,
    source: deal.supplierPos.length > 0 || !!deal.sourcingNote || Number(deal.supplierCost) > 0 || ["PROPOSAL", "NEGOTIATION", "WON"].includes(deal.stage),
    quote: deal.items.length > 0 || Number(deal.amount) > 0 || !!deal.quoteSentAt || ["PROPOSAL", "NEGOTIATION", "WON"].includes(deal.stage),
    execute: !!deal.customerPo || deal.supplierPos.length > 0 || deal.deliveries.length > 0,
    finance: deal.invoices.length > 0 || deal.supplierPos.some((p) => p.payments.length > 0),
    file: true,
    result: !!deal.resultAchievedAt || fullyDelivered || !!deal.resultNote || deal.resultState !== "PENDING" || deal.recoveries.length > 0,
  };

  // ---------- Timeline (Real / Expected / Promise) ----------
  const real: { at: Date; label: string }[] = [];
  if (deal.poAcceptedAt) real.push({ at: deal.poAcceptedAt, label: t("OC", "PO") });
  for (const p of deal.supplierPos) {
    if (p.shippedAt) real.push({ at: p.shippedAt, label: t("Despacho", "Shipped") });
    if (p.receivedAt) real.push({ at: p.receivedAt, label: t("Bodega", "Warehouse") });
  }
  for (const d of deal.deliveries) real.push({ at: d.deliveredAt, label: t("Entrega", "Delivery") });
  for (const c of cash) real.push({ at: c.inv.issuedAt, label: t("Factura", "Invoice") });
  const exp: { at: Date; label: string; kind: "carrier" | "solu" }[] = [];
  if (carrier && !carrier.fallback) exp.push({ at: carrier.date, label: t("ETA transp.", "Carrier ETA"), kind: "carrier" });
  else if (carrier) exp.push({ at: carrier.date, label: t("ETA prov.", "Supplier ETA"), kind: "carrier" });
  if (expected.date && !expected.done) exp.push({ at: expected.date, label: "SOLU ≈", kind: "solu" });
  const anchors = [now, ...real.map((r) => r.at), ...exp.map((e) => e.at), promise.date].filter((d): d is Date => !!d);
  let start = anchors.reduce((m, d) => (d < m ? d : m), addDays(now, -10));
  let end = anchors.reduce((m, d) => (d > m ? d : m), addDays(now, 14));
  start = addDays(start, -2);
  end = addDays(end, 3);
  if (daysBetween(start, end) > 150) start = addDays(end, -150);
  const span = Math.max(1, daysBetween(start, end));
  const pos = (d: Date) => Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));
  const ticks: { left: number; label: string }[] = [];
  const step = span > 70 ? 14 : 7;
  for (let d = addDays(start, (8 - start.getUTCDay()) % 7); d <= end; d = addDays(d, step)) ticks.push({ left: pos(d), label: i.day(d) });
  const timeline = {
    ticks,
    nowLeft: pos(now),
    real: real.filter((r) => r.at >= start).map((r) => ({ left: pos(r.at), label: r.label, date: r.at })),
    expected: exp.map((e) => ({ left: pos(e.at), label: e.label, date: e.at, kind: e.kind, late: !!promise.date && e.at > promise.date })),
    promise: promise.date ? { left: pos(promise.date), date: promise.date } : null,
  };

  // ---------- Material risk (only when it changes the result) ----------
  const risk = (promisePast || (gapDays != null && gapDays > 0 && !expected.done))
    ? {
        title: promisePast ? t("La fecha prometida ya pasó", "The promised date has passed") : t("SOLU espera llegar después de lo prometido", "SOLU expects to arrive after the promise"),
        why: expected.date ? t(`SOLU espera ${i.day(expected.date)} · prometimos ${i.day(promise.date)}`, `SOLU expects ${i.day(expected.date)} · we promised ${i.day(promise.date)}`) : t(`Prometimos ${i.day(promise.date)} y no hay fecha calculada`, `We promised ${i.day(promise.date)} and there is no calculated date`),
        impact: deal.impactIfNot ?? (deal.desiredResult ? t(`El cliente no logra a tiempo: ${deal.desiredResult}`, `The customer doesn't achieve on time: ${deal.desiredResult}`) : t("El cliente recibe tarde lo que necesita.", "The customer gets what they need late.")),
        missing: !carrier ? t("La ETA del transportista", "The carrier ETA") : carrier.stale || carrier.late ? t("Una ETA actualizada del transportista", "An updated carrier ETA") : t("Una decisión sobre cómo cerrar la diferencia", "A decision on how to close the gap"),
        who: deal.owner.name,
        options: [
          t("Avisar al cliente hoy con una fecha nueva y realista", "Tell the customer today with a new, realistic date"),
          t("Pedir al proveedor o transportista un envío más rápido", "Ask the supplier or carrier for faster shipping"),
          ordered > delivered ? t("Proponer una entrega parcial con lo que ya hay", "Offer a partial delivery with what is available") : t("Acordar con el cliente una medida temporal", "Agree a temporary measure with the customer"),
        ],
      }
    : null;

  // ---------- Catch me up (short story) ----------
  const story: string[] = [];
  story.push(deal.desiredResult ? t(`${deal.account.name} quiere: ${deal.desiredResult}.`, `${deal.account.name} wants: ${deal.desiredResult}.`) : t(`${deal.account.name} aún no tiene escrito su resultado deseado.`, `${deal.account.name} has no desired result written down yet.`));
  if (promise.date) story.push(t(`Le prometimos ${promise.text ? `«${promise.text}» ` : ""}para el ${i.day(promise.date)} — ${promiseState.text.toLowerCase()}.`, `We promised ${promise.text ? `"${promise.text}" ` : ""}for ${i.day(promise.date)} — ${promiseState.text.toLowerCase()}.`));
  if (nowFacts.length) story.push(t(`Hoy: ${nowFacts.slice(0, 2).map((f) => f.text).join("; ")}.`, `Now: ${nowFacts.slice(0, 2).map((f) => f.text).join("; ")}.`));
  if (expected.date && !expected.done) story.push(t(`SOLU espera que el cliente lo tenga el ${i.day(expected.date)}${carrier && !carrier.fallback ? ` (el transportista dice ${i.day(carrier.date)})` : ""}.`, `SOLU expects the customer to have it on ${i.day(expected.date)}${carrier && !carrier.fallback ? ` (the carrier says ${i.day(carrier.date)})` : ""}.`));
  story.push(forward.mode === "wait" ? t(`Estamos esperando «${forward.what}» hasta el ${i.day(forward.date)}.`, `We are waiting for "${forward.what}" until ${i.day(forward.date)}.`) : forward.mode === "move" ? t(`Lo siguiente: ${forward.what}${forward.date ? ` (${i.day(forward.date)})` : ""}.`, `Next: ${forward.what}${forward.date ? ` (${i.day(forward.date)})` : ""}.`) : suggestion ? t(`Nadie definió qué sigue; SOLU sugiere: ${suggestion.what.toLowerCase()}.`, `Nobody defined what's next; SOLU suggests: ${suggestion.what.toLowerCase()}.`) : "");
  story.push(changes.length ? t(`Desde tu última visita: ${changes.length} cambio(s), el más reciente «${changes[0].what}».`, `Since your last visit: ${changes.length} change(s), most recent "${changes[0].what}".`) : t("Nada cambió desde tu última visita.", "Nothing changed since your last visit."));

  // ---------- Ask SOLU: answers from this Journey's own data ----------
  const answers: { q: string; a: string }[] = [
    {
      q: t("¿Cuándo lo tiene el cliente?", "When will the customer have it?"),
      a: expected.done
        ? t(`Ya lo tiene: entregado el ${i.day(expected.date)}.`, `They have it: delivered on ${i.day(expected.date)}.`)
        : expected.date
          ? t(`SOLU espera el ${i.day(expected.date)} (${expected.calc}). ${promiseState.text}.`, `SOLU expects ${i.day(expected.date)} (${expected.calc}). ${promiseState.text}.`)
          : t(`Aún no se puede calcular: ${expected.calc.toLowerCase()}.`, `Can't calculate yet: ${expected.calc.toLowerCase()}.`),
    },
    {
      q: t("¿Qué le prometimos?", "What did we promise?"),
      a: promise.date || promise.text ? t(`${promise.text ?? "Entrega"} para el ${i.day(promise.date)}. ${promiseState.text}.`, `${promise.text ?? "Delivery"} for ${i.day(promise.date)}. ${promiseState.text}.`) : t("No hay promesa registrada. Regístrala para que SOLU la cuide.", "No promise recorded. Record it so SOLU can watch it."),
    },
    {
      q: t("¿Quién tiene la pelota?", "Who has the ball?"),
      a: forward.mode === "wait" ? t(`El otro lado: esperamos «${forward.what}» hasta el ${i.day(forward.date)}.`, `The other side: we're waiting for "${forward.what}" until ${i.day(forward.date)}.`) : forward.mode === "move" ? t(`${deal.owner.name}: ${forward.what}.`, `${deal.owner.name}: ${forward.what}.`) : t(`Nadie. ${suggestion ? `Sugerencia: ${suggestion.what}.` : ""}`, `Nobody. ${suggestion ? `Suggestion: ${suggestion.what}.` : ""}`),
    },
    {
      q: t("¿Qué falta para cobrar?", "What's left to get paid?"),
      a: fullyCollected
        ? t("Nada: todo está cobrado y conciliado.", "Nothing: everything is collected and reconciled.")
        : !fullyDelivered
          ? t(`Entregar primero${ordered ? ` (${ordered - delivered} unidades pendientes)` : ""}; luego facturar y cobrar.`, `Deliver first${ordered ? ` (${ordered - delivered} units pending)` : ""}; then invoice and collect.`)
          : uninvoicedDeliveries.length
            ? t(`Facturar ${uninvoicedDeliveries.map((d) => d.code).join(", ")}.`, `Invoice ${uninvoicedDeliveries.map((d) => d.code).join(", ")}.`)
            : t(`Cobrar USD ${i.n(balance)}${overdueInv.length ? `; ${overdueInv.length} factura(s) vencida(s)` : ""}.`, `Collect USD ${i.n(balance)}${overdueInv.length ? `; ${overdueInv.length} overdue invoice(s)` : ""}.`),
    },
    {
      q: t("¿Cuánta eságara deja?", "How much eságara does it leave?"),
      a: t(`USD ${i.n(eg.value)} (${i.pct(eg.pct)}) = venta ${i.n(deal.amount)} − proveedor ${i.n(deal.supplierCost)} − fletes ${i.n(deal.freightCost)} − otros ${i.n(deal.otherCosts)}.`, `USD ${i.n(eg.value)} (${i.pct(eg.pct)}) = sale ${i.n(deal.amount)} − supplier ${i.n(deal.supplierCost)} − freight ${i.n(deal.freightCost)} − other ${i.n(deal.otherCosts)}.`),
    },
    {
      q: t("¿Qué se habló la última vez?", "What was said last time?"),
      a: lastTalk ? `${i.day(lastTalk.occurredAt)} · ${typeLabel(i, lastTalk.type)} · ${lastTalk.user.name}: ${lastTalk.subject}${lastTalk.body ? ` — ${lastTalk.body}` : ""}` : t("No hay llamadas, reuniones ni correos registrados.", "No calls, meetings or emails recorded."),
    },
  ];

  // ---------- The path (audit 2026-11-12): the life of the order as steps, each with one colour ----------
  // done = green · now = blue, the one step that is ours to move · wait = amber, someone else has it · risk = red ·
  // later = grey · gap = a step behind us that was never written down. Only one step is "now", "wait" or "risk".
  const advanced = ["PROPOSAL", "NEGOTIATION", "WON"].includes(deal.stage);
  const pays = deal.supplierPos.flatMap((p) => p.payments);
  const rawSteps: { key: PathKey; es: string; en: string; tab: TabKey; done: boolean; soft?: boolean }[] = [
    { key: "need", es: "Necesidad", en: "Need", tab: "need", done: !!deal.desiredResult, soft: true },
    { key: "source", es: "Fuente", en: "Source", tab: "source", done: deal.supplierPos.length > 0 || Number(deal.supplierCost) > 0 || !!deal.sourcingNote, soft: true },
    { key: "quote", es: "Cotización", en: "Quote", tab: "quote", done: !!deal.quoteSentAt || deal.stage === "NEGOTIATION" || won, soft: true },
    { key: "po", es: "OC del cliente", en: "Customer PO", tab: "quote", done: !!deal.poAcceptedAt || won },
    { key: "purchase", es: "Compra", en: "Purchase", tab: "execute", done: deal.supplierPos.length > 0 && deal.supplierPos.every((p) => !!p.confirmedAt) },
    { key: "pay", es: "Pago al proveedor", en: "Supplier payment", tab: "finance", done: pays.length > 0 && pays.every((p) => !!p.executedAt), soft: pays.length === 0 },
    { key: "ship", es: "Envío", en: "Shipment", tab: "execute", done: allReceived || fullyDelivered },
    { key: "deliver", es: "Entrega", en: "Delivery", tab: "execute", done: fullyDelivered },
    { key: "invoice", es: "Factura", en: "Invoice", tab: "finance", done: fullyInvoiced },
    { key: "cash", es: "Cobro", en: "Collection", tab: "finance", done: fullyCollected },
    { key: "result", es: "Resultado", en: "Result", tab: "result", done: !!deal.resultAchievedAt },
  ];
  const laterDone = (n: number) => rawSteps.slice(n + 1).some((s) => s.done);
  // A step behind us that later facts prove happened, but nobody wrote down here: shown as a gap, never as the live step.
  const goodsMoved = allReceived || fullyDelivered || deal.deliveries.length > 0;
  const implied = (s: (typeof rawSteps)[number], n: number) => (s.soft && laterDone(n)) || (s.key === "purchase" && goodsMoved);
  const over = lost || !!deal.closedAt || deal.resultState === "NO_LONGER_RELEVANT";
  const curIdx = over ? -1 : rawSteps.findIndex((s, n) => !s.done && !implied(s, n));
  // In transit with a carrier date that is still ahead and fresh, and nobody noted a movement of ours: the carrier has it.
  const carrierHasIt = curIdx >= 0 && rawSteps[curIdx].key === "ship" && forward.mode === "none" && !!carrier && !carrier.late && !carrier.stale && carrier.date >= now;
  const curState: PathState = forward.late ? "late" : forward.mode === "wait" || carrierHasIt ? "wait" : "now";
  // What each step needs to be done, in plain words: this is what the blue box says.
  const NEEDS: Record<PathKey, [string, string]> = {
    need: ["Escribir el resultado que busca el cliente", "Write down the result the customer wants"],
    source: ["Registrar la fuente y su costo", "Record the source and its cost"],
    quote: ["Enviar la cotización al cliente", "Send the quote to the customer"],
    po: ["Recibir y aceptar la OC del cliente", "Receive and accept the customer PO"],
    purchase: ["Emitir la compra y confirmarla con el proveedor", "Issue the purchase and confirm it with the supplier"],
    pay: ["Ejecutar el pago al proveedor", "Execute the supplier payment"],
    ship: ["Recibir la mercancía del proveedor", "Receive the goods from the supplier"],
    deliver: ["Entregar al cliente", "Deliver to the customer"],
    invoice: ["Facturar lo entregado", "Invoice what was delivered"],
    cash: ["Cobrar y conciliar el pago", "Collect and reconcile the payment"],
    result: ["Confirmar con el cliente que logró su resultado", "Confirm with the customer that they achieved the result"],
  };
  const idxOf = (k: PathKey) => rawSteps.findIndex((s) => s.key === k);
  // A risk sits on the step it belongs to, which is not always the step that is ours now (same order as the signal).
  let riskIdx = -1;
  if (!over && signal.tone === "risk") {
    if (deal.recoveries.length || deal.resultState === "NOT_ACHIEVED") riskIdx = idxOf("result");
    else if (promisePast || (gapDays != null && gapDays > 0 && !expected.done)) riskIdx = curIdx >= idxOf("purchase") && curIdx <= idxOf("deliver") ? curIdx : idxOf("deliver");
    else if (overdueInv.length) riskIdx = idxOf("cash");
  }
  const path = {
    over, lost, closed: !!deal.closedAt || deal.resultState === "NO_LONGER_RELEVANT",
    current: curIdx >= 0 ? {
      key: rawSteps[curIdx].key, state: curState, tab: rawSteps[curIdx].tab, label: t(rawSteps[curIdx].es, rawSteps[curIdx].en),
      what: t(...NEEDS[rawSteps[curIdx].key]),
      noted: forward.mode === "wait" ? t(`Esperando: ${forward.what}${forward.date ? ` · revisar el ${i.day(forward.date)}` : ""}`, `Waiting: ${forward.what}${forward.date ? ` · check on ${i.day(forward.date)}` : ""}`)
        : forward.mode === "move" ? t(`Siguiente movimiento anotado: ${forward.what}${forward.date ? ` · ${i.day(forward.date)}` : ""}`, `Next movement noted: ${forward.what}${forward.date ? ` · ${i.day(forward.date)}` : ""}`)
        : carrierHasIt ? t(`Lo tiene ${carrier!.who} · llega el ${i.day(carrier!.date)}`, `${carrier!.who} has it · arrives on ${i.day(carrier!.date)}`)
        : suggestion ? t(`SOLU sugiere: ${suggestion.what}`, `SOLU suggests: ${suggestion.what}`) : null,
      late: forward.late,
    } : null,
    risk: riskIdx >= 0 ? { key: rawSteps[riskIdx].key, tab: rawSteps[riskIdx].tab, label: t(rawSteps[riskIdx].es, rawSteps[riskIdx].en), what: `${signal.label}: ${signal.why}` } : null,
    steps: rawSteps.map((s, n): PathStep => ({ key: s.key, label: t(s.es, s.en), tab: s.tab, state: n === riskIdx ? "risk" : s.done ? "done" : n === curIdx ? curState : !over && implied(s, n) ? "gap" : "later" })),
  };

  return {
    path,
    now, eg, won, lost, ordered, delivered, invoiced, reconciled, balance, fullyDelivered, fullyInvoiced, fullyCollected,
    carrier, expected, promise, promiseState, gapDays,
    forward, suggestion, signal, nowFacts, changes, since: from, docs, conversation, has, timeline, risk, story: story.filter(Boolean), answers,
    uninvoicedDeliveries, overdueInv, cash,
  };
}

export function typeLabel(i: I, type: string) {
  return type === "CALL" ? i.t("Llamada", "Call") : type === "MEETING" ? i.t("Reunión", "Meeting") : type === "EMAIL" ? i.t("Correo", "Email") : i.t("Nota", "Note");
}
