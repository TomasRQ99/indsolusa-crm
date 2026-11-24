import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import { db } from "./db";
import { canManageAll } from "./permissions";
import { addDays, daysBetween, today } from "./domain";
import { isWorkingDay } from "./holidays";
import { BRIEF_QUIET_DAYS } from "./day-brief";

// CALENDARIO DE CASOS (owner, 2026-11-23: "a functioning calendar that lets you see future and past cases, and shows
// if they were completed and what was the state of that case back in that date… if you go to future dates it tells
// you where you should be with those cases by then and shows you recommended deadlines").
// Nothing is stored for it: every line is read from the dates SOLU already keeps. Three kinds of line, never mixed:
//   fact         = something that happened that day (a record with its date)
//   commitment   = a date somebody set (promise, next move, wait, due date): kept, missed, or still ahead
//   recommended  = a deadline SOLU calculates backwards from a promise; it says how it was calculated

/** Working days we keep between "goods in our warehouse" and the date promised to the customer (same rule as the delay notice). */
export const RECEIPT_BEFORE_PROMISE_WD = 4;

export type CalKind = "fact" | "commitment" | "recommended";
export type CalTone = "done" | "missed" | "ahead" | "rec" | "fact";
export type CalEvent = { key: string; day: string; dealId: string | null; kind: CalKind; tone: CalTone; text: string; note?: string; href: string };
export type CalCase = { dealId: string; code: string; who: string; title: string; owner: string; href: string; then: string; now: string; changed: boolean; over: string | null; events: CalEvent[] };
export type CaseCalendar = Awaited<ReturnType<typeof buildCaseCalendar>>;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (d: Date) => { const b = new Date(d.getTime() - 5 * 3600e3); return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())); };
const strip = (s: string) => s.replace(/ \(ejemplo\)$/, "");
const backWorkingDays = (from: Date, n: number) => { let d = from, left = n; while (left > 0) { d = addDays(d, -1); if (isWorkingDay(d)) left--; } return d; };

export async function buildCaseCalendar(user: SessionUser, i: I18n, o: { month?: string; day?: string; team?: boolean }) {
  const { t } = i;
  const now = today();
  const canTeam = canManageAll(user);
  const team = !!o.team && canTeam;
  const picked = o.day && /^\d{4}-\d{2}-\d{2}$/.test(o.day) && !isNaN(new Date(`${o.day}T00:00:00Z`).getTime()) ? new Date(`${o.day}T00:00:00Z`) : null;
  const monthStr = o.month && /^\d{4}-\d{2}$/.test(o.month) ? o.month : iso(picked ?? now).slice(0, 7);
  const [y, m] = monthStr.split("-").map(Number);
  const first = new Date(Date.UTC(y, Math.min(11, Math.max(0, m - 1)), 1));
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  const last = addDays(next, -1);
  const sel = picked && picked >= first && picked < next ? picked : now >= first && now < next ? now : first;
  // Real timestamps against Bogotá days.
  const ts = (d: Date) => new Date(d.getTime() + 5 * 3600e3);

  const own = team ? {} : { ownerId: user.id };
  const [deals, tasks] = await Promise.all([
    db.deal.findMany({
      where: { ...own, internal: false, createdAt: { lt: ts(next) }, OR: [{ closedAt: null }, { closedAt: { gte: ts(first) } }] },
      orderBy: { updatedAt: "desc" }, take: 600,
      select: {
        id: true, code: true, title: true, stage: true, createdAt: true, updatedAt: true, locatedAt: true, poAcceptedAt: true, promisedDate: true, transitDays: true,
        nextMove: true, nextMoveDate: true, waitingFor: true, waitingUntil: true, offerValidUntil: true, resultAchievedAt: true, closedAt: true,
        owner: { select: { name: true } }, account: { select: { name: true } },
        quotes: { where: { status: { not: "SUPERSEDED" } }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, status: true, presentedAt: true, decisionAt: true } },
        supplierPos: { select: { id: true, code: true, releasedAt: true, shippedAt: true, receivedAt: true, eta: true, carrierEta: true } },
        deliveries: { orderBy: { deliveredAt: "asc" }, select: { id: true, code: true, deliveredAt: true } },
        invoices: { select: { id: true, number: true, issuedAt: true, dueAt: true, amount: true, promises: { where: { replacedAt: null }, select: { id: true, promisedFor: true, promisedBy: true } }, applications: { select: { amount: true, payment: { select: { receivedAt: true } } } } } },
        activities: { where: { occurredAt: { gte: ts(first), lt: ts(next) } }, orderBy: { occurredAt: "asc" }, take: 40, select: { id: true, subject: true, occurredAt: true, type: true, source: true } },
      },
    }),
    team ? Promise.resolve([]) : db.task.findMany({ where: { assigneeId: user.id, dueDate: { gte: first, lt: next } }, take: 200, select: { id: true, title: true, dueDate: true, status: true, completedAt: true, dealId: true, projectId: true } }),
  ]);

  type D = (typeof deals)[number];
  const STATE = [
    t("Necesidad registrada", "Need recorded"), t("Pieza localizada", "Piece located"), t("Cotización presentada", "Quote presented"), t("Pedido aceptado", "Order accepted"),
    t("Compra al proveedor liberada", "Supplier purchase released"), t("En tránsito desde el proveedor", "In transit from the supplier"), t("Mercancía en bodega", "Goods in the warehouse"),
    t("Entregado al cliente", "Delivered to the customer"), t("Facturado", "Invoiced"), t("Cobrado", "Collected"), t("Resultado confirmado", "Result confirmed"), t("Necesidad cerrada", "Need closed"),
  ];
  const minDate = (xs: (Date | null | undefined)[]) => { const v = xs.filter((x): x is Date => !!x).map((x) => x.getTime()); return v.length ? new Date(Math.min(...v)) : null; };
  const paidAt = (d: D) => {
    if (!d.invoices.length) return null;
    let lastPay: Date | null = null;
    for (const inv of d.invoices) {
      const got = inv.applications.reduce((s, a) => s + Number(a.amount), 0);
      if (got + 0.005 < Number(inv.amount)) return null;
      for (const a of inv.applications) if (!lastPay || a.payment.receivedAt > lastPay) lastPay = a.payment.receivedAt;
    }
    return lastPay;
  };
  /** When each state was reached (null = not yet). The same order as STATE. */
  const milestones = (d: D): (Date | null)[] => [
    d.createdAt, d.locatedAt, minDate(d.quotes.map((q) => q.presentedAt)), d.poAcceptedAt, minDate(d.supplierPos.map((s) => s.releasedAt)), minDate(d.supplierPos.map((s) => s.shippedAt)),
    d.supplierPos.length && d.supplierPos.every((s) => s.receivedAt) ? new Date(Math.max(...d.supplierPos.map((s) => s.receivedAt!.getTime()))) : null,
    d.deliveries[0]?.deliveredAt ?? null, minDate(d.invoices.map((x) => x.issuedAt)), paidAt(d), d.resultAchievedAt, d.closedAt,
  ];
  const stateAt = (ms: (Date | null)[], day: Date) => { let k = 0; ms.forEach((x, n) => { if (x && dayOf(x) <= day) k = n; }); return k; };

  const events: CalEvent[] = [];
  const inMonth = (d: Date | null | undefined): d is Date => !!d && d >= first && d < next;
  const put = (d: D | null, when: Date | null | undefined, real: boolean, e: Omit<CalEvent, "day" | "dealId">) => {
    if (!when) return;
    const day = real ? dayOf(when) : when;
    if (inMonth(day)) events.push({ ...e, day: iso(day), dealId: d?.id ?? null });
  };
  const dueTone = (when: Date, done: boolean): CalTone => (done ? "done" : when < now ? "missed" : "ahead");
  const recByDeal = new Map<string, { receiptBy: Date; shipBy: Date | null }>();

  for (const d of deals) {
    const href = `/deals/${d.id}`;
    const fact = (key: string, when: Date | null | undefined, text: string, to = href) => put(d, when, true, { key: `${key}-${d.id}`, kind: "fact", tone: "fact", text, href: to });
    fact("c", d.createdAt, t("Se registró la Necesidad.", "The Need was recorded."));
    fact("l", d.locatedAt, t("Se localizó la pieza.", "The piece was located."));
    for (const q of d.quotes) {
      if (q.presentedAt) put(d, q.presentedAt, true, { key: `q-${q.id}`, kind: "fact", tone: "fact", text: t(`Se presentó la cotización ${q.number}.`, `Quote ${q.number} was presented.`), href: `/cotizaciones/${q.id}` });
      if (q.decisionAt && q.status === "PRESENTED") put(d, dayOf(q.decisionAt), false, { key: `qd-${q.id}`, kind: "commitment", tone: dueTone(dayOf(q.decisionAt), false), text: t(`El cliente decide sobre la cotización ${q.number}.`, `The customer decides on quote ${q.number}.`), note: dayOf(q.decisionAt) < now ? t("La fecha pasó y la cotización sigue abierta.", "The date passed and the quote is still open.") : undefined, href: `/cotizaciones/${q.id}` });
    }
    fact("po", d.poAcceptedAt, t("Se aceptó la OC del cliente.", "The customer's PO was accepted."));
    for (const s of d.supplierPos) {
      put(d, s.releasedAt, true, { key: `sr-${s.id}`, kind: "fact", tone: "fact", text: t(`Se liberó la orden ${s.code} al proveedor.`, `Order ${s.code} was released to the supplier.`), href: `/compras/${s.id}` });
      put(d, s.shippedAt, true, { key: `ss-${s.id}`, kind: "fact", tone: "fact", text: t(`El proveedor despachó la orden ${s.code}.`, `The supplier shipped order ${s.code}.`), href: `/compras/${s.id}` });
      put(d, s.receivedAt, true, { key: `sx-${s.id}`, kind: "fact", tone: "fact", text: t(`La orden ${s.code} se recibió en bodega.`, `Order ${s.code} was received at the warehouse.`), href: `/compras/${s.id}` });
      const eta = s.carrierEta ?? s.eta;
      if (eta) put(d, dayOf(eta), false, { key: `se-${s.id}`, kind: "commitment", tone: dueTone(dayOf(eta), !!s.receivedAt), text: t(`Llegada estimada de la orden ${s.code}.`, `Estimated arrival of order ${s.code}.`), note: s.receivedAt ? t(`Se recibió el ${i.date(dayOf(s.receivedAt))}.`, `Received on ${i.date(dayOf(s.receivedAt))}.`) : dayOf(eta) < now ? t("La fecha pasó y no hay recepción registrada.", "The date passed and no receipt is recorded.") : undefined, href: `/compras/${s.id}` });
    }
    for (const x of d.deliveries) put(d, x.deliveredAt, true, { key: `dl-${x.id}`, kind: "fact", tone: "fact", text: t(`Se entregó al cliente (${x.code}).`, `Delivered to the customer (${x.code}).`), href });
    for (const inv of d.invoices) {
      const got = inv.applications.reduce((s, a) => s + Number(a.amount), 0);
      const paid = got + 0.005 >= Number(inv.amount);
      put(d, inv.issuedAt, true, { key: `iv-${inv.id}`, kind: "fact", tone: "fact", text: t(`Se emitió la factura ${inv.number} por ${i.money(inv.amount)}.`, `Invoice ${inv.number} was issued for ${i.money(inv.amount)}.`), href: `/administracion/cobrar?f=${inv.id}` });
      put(d, dayOf(inv.dueAt), false, { key: `id-${inv.id}`, kind: "commitment", tone: dueTone(dayOf(inv.dueAt), paid), text: t(`Vence la factura ${inv.number}.`, `Invoice ${inv.number} is due.`), note: paid ? t("Ya está pagada.", "It is already paid.") : dayOf(inv.dueAt) < now ? t(`Venció y tiene saldo de ${i.money(Number(inv.amount) - got)}.`, `Past due with a balance of ${i.money(Number(inv.amount) - got)}.`) : undefined, href: `/administracion/cobrar?f=${inv.id}` });
      for (const p of inv.promises) put(d, dayOf(p.promisedFor), false, { key: `pp-${p.id}`, kind: "commitment", tone: dueTone(dayOf(p.promisedFor), paid), text: t(`${p.promisedBy} prometió pagar la factura ${inv.number}.`, `${p.promisedBy} promised to pay invoice ${inv.number}.`), note: paid ? t("Ya está pagada.", "It is already paid.") : dayOf(p.promisedFor) < now ? t("La fecha pasó y el pago no está registrado.", "The date passed and the payment is not recorded.") : undefined, href: `/administracion/cobrar?f=${inv.id}` });
      const seen = new Set<string>();
      for (const a of inv.applications) { const k = iso(dayOf(a.payment.receivedAt)); if (seen.has(k)) continue; seen.add(k); put(d, a.payment.receivedAt, true, { key: `py-${inv.id}-${k}`, kind: "fact", tone: "fact", text: t(`Se recibió un pago de la factura ${inv.number}.`, `A payment for invoice ${inv.number} was received.`), href: `/administracion/cobrar?f=${inv.id}` }); }
    }
    fact("r", d.resultAchievedAt, t("El cliente confirmó el resultado.", "The customer confirmed the result."));
    fact("x", d.closedAt, t("Se cerró la Necesidad.", "The Need was closed."));
    for (const a of d.activities) put(d, a.occurredAt, true, { key: `a-${a.id}`, kind: "fact", tone: "fact", text: t(`Seguimiento: ${a.subject.slice(0, 140)}`, `Follow-up: ${a.subject.slice(0, 140)}`), href });

    const open = d.stage !== "LOST" && !d.closedAt;
    // The promise to the customer: kept, missed, or still ahead.
    if (d.promisedDate && d.stage === "WON") {
      const del = d.deliveries[0]?.deliveredAt ? dayOf(d.deliveries[0].deliveredAt) : null;
      const lateBy = del ? daysBetween(d.promisedDate, del) : 0;
      put(d, d.promisedDate, false, {
        key: `pr-${d.id}`, kind: "commitment", tone: del ? (lateBy > 0 ? "missed" : "done") : dueTone(d.promisedDate, false), text: t("Entrega prometida al cliente.", "Delivery promised to the customer."),
        note: del ? (lateBy > 0 ? t(`Se entregó ${lateBy} ${lateBy === 1 ? "día" : "días"} después, el ${i.date(del)}.`, `Delivered ${lateBy} day(s) later, on ${i.date(del)}.`) : t(`Cumplida: se entregó el ${i.date(del)}.`, `Kept: delivered on ${i.date(del)}.`)) : d.promisedDate < now ? t("La fecha pasó y no hay entrega registrada.", "The date passed and no delivery is recorded.") : undefined,
        href: !del && d.promisedDate < now ? `/deals/${d.id}/retraso` : href,
      });
      // Recommended deadlines, counted back from the promise. Only while there is still something to deliver.
      if (!del && open) {
        const receiptBy = backWorkingDays(d.promisedDate, RECEIPT_BEFORE_PROMISE_WD);
        const received = d.supplierPos.length > 0 && d.supplierPos.every((s) => s.receivedAt);
        const shipped = d.supplierPos.length > 0 && d.supplierPos.every((s) => s.shippedAt);
        const shipBy = d.transitDays && d.transitDays > 0 ? addDays(receiptBy, -d.transitDays) : null;
        recByDeal.set(d.id, { receiptBy, shipBy });
        put(d, receiptBy, false, { key: `rr-${d.id}`, kind: "recommended", tone: received ? "done" : receiptBy < now ? "missed" : "rec", text: t("Plazo recomendado: la mercancía en nuestra bodega.", "Recommended deadline: the goods in our warehouse."), note: t(`${RECEIPT_BEFORE_PROMISE_WD} días hábiles antes de la entrega prometida (${i.date(d.promisedDate)}), para recibir, revisar y entregar.${received ? " Ya se recibió." : ""}`, `${RECEIPT_BEFORE_PROMISE_WD} working days before the promised delivery (${i.date(d.promisedDate)}), to receive, check and deliver.${received ? " Already received." : ""}`), href });
        if (shipBy) put(d, shipBy, false, { key: `rs-${d.id}`, kind: "recommended", tone: shipped ? "done" : shipBy < now ? "missed" : "rec", text: t("Plazo recomendado: el proveedor despacha.", "Recommended deadline: the supplier ships."), note: t(`${d.transitDays} días de transporte antes de la fecha de bodega (${i.date(receiptBy)}).${shipped ? " Ya despachó." : ""}`, `${d.transitDays} transit days before the warehouse date (${i.date(receiptBy)}).${shipped ? " Already shipped." : ""}`), href });
      }
    }
    if (open && d.stage !== "WON") {
      if (d.waitingFor && d.waitingUntil) put(d, d.waitingUntil, false, { key: `w-${d.id}`, kind: "commitment", tone: dueTone(d.waitingUntil, false), text: t(`Espera con control hasta este día: «${d.waitingFor.slice(0, 100)}».`, `Controlled wait until this day: "${d.waitingFor.slice(0, 100)}".`), note: d.waitingUntil < now ? t("La fecha pasó y la espera sigue abierta.", "The date passed and the wait is still open.") : undefined, href });
      else if (d.nextMove && d.nextMoveDate) put(d, d.nextMoveDate, false, { key: `m-${d.id}`, kind: "commitment", tone: dueTone(d.nextMoveDate, false), text: t(`Movimiento acordado: «${d.nextMove.slice(0, 100)}».`, `Agreed move: "${d.nextMove.slice(0, 100)}".`), note: d.nextMoveDate < now ? t("La fecha pasó y sigue pendiente.", "The date passed and it is still pending.") : undefined, href });
      if (d.offerValidUntil) put(d, d.offerValidUntil, false, { key: `o-${d.id}`, kind: "commitment", tone: dueTone(d.offerValidUntil, false), text: t("Vence la oferta al cliente.", "The offer to the customer expires."), href });
      // A presented quote nobody planned a follow-up for: SOLU proposes one.
      const q = d.quotes.find((x) => x.status === "PRESENTED" && x.presentedAt);
      if (q && !d.nextMove && !d.waitingFor) {
        const lastTouch = d.activities.length ? d.activities[d.activities.length - 1].occurredAt : null;
        const base = lastTouch && lastTouch > q.presentedAt! ? lastTouch : q.presentedAt!;
        const when = addDays(dayOf(base), BRIEF_QUIET_DAYS);
        put(d, when, false, { key: `rq-${q.id}`, kind: "recommended", tone: when < now ? "missed" : "rec", text: t(`Plazo recomendado: seguimiento de la cotización ${q.number}.`, `Recommended deadline: follow-up on quote ${q.number}.`), note: t(`${BRIEF_QUIET_DAYS} días después del último contacto registrado (${i.date(dayOf(base))}).`, `${BRIEF_QUIET_DAYS} days after the last recorded contact (${i.date(dayOf(base))}).`), href: `/cotizaciones/${q.id}` });
      }
    }
  }
  for (const k of tasks) {
    const done = k.status === "DONE";
    events.push({ key: `t-${k.id}`, day: iso(k.dueDate!), dealId: k.dealId, kind: "commitment", tone: dueTone(k.dueDate!, done), text: t(`Pendiente: ${k.title.slice(0, 120)}`, `To-do: ${k.title.slice(0, 120)}`), note: done ? t("Hecho.", "Done.") : k.dueDate! < now ? t("La fecha pasó y sigue abierto.", "The date passed and it is still open.") : undefined, href: k.dealId ? `/deals/${k.dealId}` : k.projectId ? `/proyectos/${k.projectId}` : "/tasks" });
  }

  // ---- The month grid ----
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) (byDay.get(e.day) ?? byDay.set(e.day, []).get(e.day)!).push(e);
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells: ({ day: string; n: number; facts: number; done: number; missed: number; ahead: number; rec: number; today: boolean; past: boolean; selected: boolean } | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d < next; d = addDays(d, 1)) {
    const es = byDay.get(iso(d)) ?? [];
    const c = (tone: CalTone) => es.filter((e) => e.tone === tone).length;
    cells.push({ day: iso(d), n: d.getUTCDate(), facts: c("fact"), done: c("done"), missed: c("missed"), ahead: c("ahead"), rec: c("rec"), today: d.getTime() === now.getTime(), past: d < now, selected: d.getTime() === sel.getTime() });
  }

  // ---- The chosen day, case by case ----
  const future = sel > now;
  const dayEvents = byDay.get(iso(sel)) ?? [];
  const order: Record<CalTone, number> = { missed: 0, ahead: 1, rec: 2, done: 3, fact: 4 };
  const cases: CalCase[] = [];
  for (const d of deals) {
    const mine = dayEvents.filter((e) => e.dealId === d.id).sort((a, b) => order[a.tone] - order[b.tone]);
    if (!mine.length) continue;
    const ms = milestones(d);
    const nowIdx = stateAt(ms, now);
    let thenIdx = stateAt(ms, future ? now : sel);
    if (future) {
      // Where the dates already set say the case should be by that day.
      const rec = recByDeal.get(d.id);
      if (d.stage === "WON" && d.promisedDate && d.promisedDate <= sel) thenIdx = Math.max(thenIdx, 7);
      else if (rec && rec.receiptBy <= sel) thenIdx = Math.max(thenIdx, 6);
      else if (rec?.shipBy && rec.shipBy <= sel) thenIdx = Math.max(thenIdx, 5);
      if (d.invoices.length && d.invoices.every((x) => dayOf(x.dueAt) <= sel) && thenIdx >= 8) thenIdx = Math.max(thenIdx, 9);
    }
    cases.push({
      dealId: d.id, code: d.code ?? "", who: strip(d.account.name), title: d.title, owner: d.owner.name, href: `/deals/${d.id}`,
      then: STATE[thenIdx], now: STATE[nowIdx], changed: thenIdx !== nowIdx,
      over: d.stage === "LOST" ? t("Perdida", "Lost") : d.closedAt ? t("Cerrada", "Closed") : d.resultAchievedAt ? t("Resultado confirmado", "Result confirmed") : null,
      events: mine,
    });
  }
  const loose = dayEvents.filter((e) => !e.dealId || !deals.some((d) => d.id === e.dealId)).sort((a, b) => order[a.tone] - order[b.tone]);
  const worst = (c: CalCase) => Math.min(...c.events.map((e) => order[e.tone]));
  cases.sort((a, b) => worst(a) - worst(b) || a.code.localeCompare(b.code));

  const prev = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
  return {
    month: monthStr, first, last, prevMonth: iso(prev).slice(0, 7), nextMonth: iso(next).slice(0, 7), thisMonth: iso(now).slice(0, 7), today: iso(now),
    cells, sel, selIso: iso(sel), future, isToday: sel.getTime() === now.getTime(), cases, loose, team, canTeam,
    totals: { facts: events.filter((e) => e.tone === "fact").length, missed: events.filter((e) => e.tone === "missed").length, ahead: events.filter((e) => e.tone === "ahead").length, rec: events.filter((e) => e.tone === "rec").length },
  };
}
