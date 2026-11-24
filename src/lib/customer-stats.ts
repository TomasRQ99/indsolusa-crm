import { db } from "./db";
import { invoiceFacts, toPayInvoice } from "./pay-rules";

// Customer statistics (owner, 2026-11-24): "keeping records for each client on how they have performed for us …
// monthly comparisons for every stat … general performance stats that are confirmable on a large scale timeline".
// Every figure is built from dated records (a Need, a quote, an order, an invoice, a reconciled payment, an email,
// a change of the credit limit). Each record keeps its date, value and link, so any month can be opened and checked.

export type Unit = "n" | "usd" | "days" | "hours";
/** Which direction is good news (for the colour of the change). */
export type Good = "up" | "down" | "none";
export type StatGroup = "pide" | "dinero" | "tiempos" | "comunica" | "credito";

/** One dated record behind a figure. `value` = 1 for counts, the amount for money, the days/hours for times. */
export type StatEvent = { at: Date; value: number; text: string; href: string | null };

export type StatDef = {
  key: string; group: StatGroup; unit: Unit; agg: "sum" | "avg" | "last"; good: Good;
  es: string; en: string; defEs: string; defEn: string;
};

export const STAT_GROUPS: { key: StatGroup; es: string; en: string }[] = [
  { key: "pide", es: "Lo que nos pide", en: "What they ask us for" },
  { key: "dinero", es: "Lo que compra y paga", en: "What they buy and pay" },
  { key: "tiempos", es: "Cuánto tarda cada paso", en: "How long each step takes" },
  { key: "comunica", es: "Comunicación", en: "Communication" },
  { key: "credito", es: "Cupo y reclamos", en: "Credit limit and claims" },
];

export const STATS: StatDef[] = [
  { key: "needs", group: "pide", unit: "n", agg: "sum", good: "up", es: "Solicitudes (Necesidades creadas)", en: "Requests (Needs created)", defEs: "Cada Necesidad abierta para este cliente, en el mes en que se creó.", defEn: "Each Need opened for this customer, in the month it was created." },
  { key: "quotedN", group: "pide", unit: "n", agg: "sum", good: "up", es: "Necesidades cotizadas", en: "Needs quoted", defEs: "Necesidades con al menos una cotización presentada, en el mes de la primera presentación.", defEn: "Needs with at least one quote presented, in the month of the first presentation." },
  { key: "pos", group: "pide", unit: "n", agg: "sum", good: "up", es: "Órdenes de compra recibidas", en: "Purchase orders received", defEs: "Órdenes de compra del cliente, en el mes en que llegaron. Las rechazadas no cuentan.", defEn: "The customer's purchase orders, in the month they arrived. Rejected ones don't count." },
  { key: "accepted", group: "pide", unit: "n", agg: "sum", good: "up", es: "Cotizaciones aceptadas", en: "Quotes accepted", defEs: "Cotizaciones que el cliente aceptó, en el mes de su decisión.", defEn: "Quotes the customer accepted, in the month of the decision." },
  { key: "declined", group: "pide", unit: "n", agg: "sum", good: "down", es: "Cotizaciones rechazadas", en: "Quotes declined", defEs: "Cotizaciones que el cliente rechazó, en el mes de su decisión.", defEn: "Quotes the customer declined, in the month of the decision." },
  { key: "quotedUsd", group: "dinero", unit: "usd", agg: "sum", good: "up", es: "Valor cotizado (lo que pidió)", en: "Value quoted (what they asked for)", defEs: "Precio de venta de la última revisión presentada de cada Necesidad, en el mes de su primera presentación. USD sin IVA.", defEn: "Sale price of each Need's last presented revision, in the month of its first presentation. USD before VAT." },
  { key: "invoicedUsd", group: "dinero", unit: "usd", agg: "sum", good: "up", es: "Facturado (lo que gastó)", en: "Invoiced (what they spent)", defEs: "Valor de las facturas emitidas, en el mes de emisión. USD sin IVA.", defEn: "Value of the invoices issued, in the month of issue. USD before VAT." },
  { key: "paidUsd", group: "dinero", unit: "usd", agg: "sum", good: "up", es: "Pagado (dinero conciliado)", en: "Paid (reconciled money)", defEs: "Pagos en dinero ya conciliados por Tesorería, en el mes en que se recibieron. Las retenciones no son dinero y no cuentan.", defEn: "Cash payments already reconciled by Treasury, in the month received. Withholdings are not cash and don't count." },
  { key: "esagaraUsd", group: "dinero", unit: "usd", agg: "sum", good: "up", es: "Eságara facturada", en: "Eságara invoiced", defEs: "La Eságara de cada factura al momento de emitirla, en el mes de emisión.", defEn: "Each invoice's Eságara when it was issued, in the month of issue." },
  { key: "quoteDays", group: "tiempos", unit: "days", agg: "avg", good: "down", es: "Nuestro tiempo para cotizar", en: "Our time to quote", defEs: "Días desde que se creó la Necesidad hasta la primera cotización presentada. Promedio del mes de la presentación.", defEn: "Days from creating the Need to the first quote presented. Average of the month of presentation." },
  { key: "decideDays", group: "tiempos", unit: "days", agg: "avg", good: "down", es: "Respuesta del cliente a la cotización", en: "Customer's answer to the quote", defEs: "Días desde la primera cotización presentada hasta su orden de compra o su rechazo. Promedio del mes de la respuesta.", defEn: "Days from the first quote presented to their purchase order or their refusal. Average of the month of the answer." },
  { key: "mailHours", group: "tiempos", unit: "hours", agg: "avg", good: "down", es: "Respuesta a nuestros correos", en: "Reply to our emails", defEs: "Horas desde que SOLU envió un correo al cliente hasta su respuesta. Promedio del mes de la respuesta.", defEn: "Hours from SOLU sending the customer an email to their reply. Average of the month of the reply." },
  { key: "deliverDays", group: "tiempos", unit: "days", agg: "avg", good: "down", es: "Tiempo de entrega", en: "Delivery time", defEs: "Días desde su orden de compra hasta la última entrega de esa Necesidad. Promedio del mes de la entrega.", defEn: "Days from their purchase order to the last delivery of that Need. Average of the month of delivery." },
  { key: "payDays", group: "tiempos", unit: "days", agg: "avg", good: "down", es: "Días para pagar", en: "Days to pay", defEs: "Días desde la factura hasta quedar pagada con dinero conciliado. Promedio del mes en que quedó pagada.", defEn: "Days from the invoice until it was fully paid with reconciled cash. Average of the month it was paid." },
  { key: "payLate", group: "tiempos", unit: "days", agg: "avg", good: "down", es: "Atraso frente al vencimiento", en: "Delay against the due date", defEs: "Días entre el vencimiento de la factura y su pago (negativo = pagó antes). Promedio del mes en que quedó pagada.", defEn: "Days between the invoice's due date and its payment (negative = paid early). Average of the month it was paid." },
  { key: "mailsIn", group: "comunica", unit: "n", agg: "sum", good: "none", es: "Correos recibidos del cliente", en: "Emails received from the customer", defEs: "Correos de sus personas que llegaron al buzón conectado a SOLU, en el mes de llegada.", defEn: "Emails from their people that reached the mailbox connected to SOLU, in the month they arrived." },
  { key: "whatsIn", group: "comunica", unit: "n", agg: "sum", good: "none", es: "Mensajes de WhatsApp recibidos", en: "WhatsApp messages received", defEs: "Mensajes de WhatsApp del cliente registrados en SOLU, en el mes de llegada.", defEn: "The customer's WhatsApp messages recorded in SOLU, in the month they arrived." },
  { key: "mailsOut", group: "comunica", unit: "n", agg: "sum", good: "none", es: "Correos que le enviamos desde SOLU", en: "Emails we sent from SOLU", defEs: "Correos enviados al cliente desde SOLU (cotizaciones, seguimientos, cobros), en el mes de envío.", defEn: "Emails sent to the customer from SOLU (quotes, follow-ups, collection), in the month sent." },
  { key: "touches", group: "comunica", unit: "n", agg: "sum", good: "none", es: "Interacciones registradas", en: "Interactions recorded", defEs: "Llamadas, reuniones, correos y notas que el equipo registró con este cliente.", defEn: "Calls, meetings, emails and notes the team recorded with this customer." },
  { key: "credit", group: "credito", unit: "usd", agg: "last", good: "none", es: "Cupo de crédito al cierre del mes", en: "Credit limit at month end", defEs: "El cupo vigente el último día del mes, según el historial de cambios de SOLU.", defEn: "The limit in force on the last day of the month, from SOLU's change history." },
  { key: "claims", group: "credito", unit: "n", agg: "sum", good: "down", es: "Reclamos y garantías", en: "Claims and warranties", defEs: "Reclamos, devoluciones y garantías que reportó el cliente, en el mes del reporte.", defEn: "Claims, returns and warranties the customer reported, in the month reported." },
];
export const statDef = (key: string) => STATS.find((s) => s.key === key) ?? null;

// ---------- Months (Bogotá calendar) ----------

const BOGOTA_MS = 5 * 3600e3;
/** "2026-11" for a moment, read on Bogotá's calendar. */
export const monthOf = (d: Date) => { const b = new Date(d.getTime() - BOGOTA_MS); return `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, "0")}`; };
export const isMonthKey = (s: string | undefined | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const shift = (key: string, k: number) => { const [y, m] = key.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
/** The last moment of a month on Bogotá's calendar. */
const monthEnd = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m, 1) + BOGOTA_MS - 1); };
/** `n` month keys ending with `last`, oldest first. */
export const monthRange = (last: string, n: number) => Array.from({ length: n }, (_, k) => shift(last, k - n + 1));
export const prevYear = (key: string) => shift(key, -12);
export const monthDate = (key: string) => { const [y, m] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 15)); };

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 864e5;
const r1 = (x: number) => Math.round(x * 10) / 10;

// ---------- Loading ----------

/** `initial` = the limit set when the customer was created. */
export type CreditChange = { at: Date; before: number | null; after: number | null; by: string; initial: boolean };
export type CustomerStats = {
  events: Record<string, StatEvent[]>;
  creditChanges: CreditChange[];
  creditNow: number | null;
  /** The first month with any record (for "all history"). */
  firstMonth: string;
};

/** Every dated record of one customer, grouped by statistic. Pure reads; nothing is stored. */
export async function loadCustomerStats(accountId: string): Promise<CustomerStats> {
  const [acc, deals, invoices, payments, messages, mails, activities, audits, claims] = await Promise.all([
    db.account.findUnique({ where: { id: accountId }, select: { createdAt: true, creditLimit: true } }),
    db.deal.findMany({
      where: { accountId, internal: false },
      select: {
        id: true, code: true, title: true, createdAt: true,
        quotes: { where: { presentedAt: { not: null } }, orderBy: { presentedAt: "asc" }, select: { id: true, number: true, rev: true, status: true, presentedAt: true, decidedAt: true, protSale: true } },
        customerPos: { where: { rejectedAt: null }, orderBy: { receivedAt: "asc" }, select: { id: true, number: true, receivedAt: true } },
        deliveries: { orderBy: { deliveredAt: "asc" }, select: { code: true, deliveredAt: true } },
      },
    }),
    db.invoice.findMany({
      where: { accountId },
      select: { id: true, number: true, amount: true, issuedAt: true, dueAt: true, esagraAtIssue: true, dealId: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } } },
    }),
    db.customerPayment.findMany({ where: { accountId, kind: "CASH", reconciledAt: { not: null } }, select: { amount: true, receivedAt: true, reference: true } }),
    db.commMessage.findMany({ where: { direction: "IN", thread: { accountId } }, select: { sentAt: true, authorName: true, thread: { select: { id: true, channel: true, subject: true } } } }),
    db.outboundMail.findMany({ where: { accountId, partyKind: "CUSTOMER", status: "SENT" }, select: { sentAt: true, repliedAt: true, subject: true, refCode: true, toAddr: true, dealId: true } }),
    db.activity.findMany({ where: { accountId }, select: { occurredAt: true, type: true, subject: true, dealId: true } }),
    db.auditEvent.findMany({ where: { model: "Account", entityId: accountId }, orderBy: { at: "asc" }, select: { at: true, actorName: true, action: true, changes: true } }),
    db.customerClaim.findMany({ where: { deal: { accountId } }, select: { code: true, kind: true, reportedAt: true, whatHappened: true, dealId: true } }),
  ]);

  const ev: Record<string, StatEvent[]> = Object.fromEntries(STATS.map((s) => [s.key, [] as StatEvent[]]));
  const push = (k: string, e: StatEvent) => ev[k].push(e);
  const label = (d: { code: string | null; title: string }) => `${d.code ?? ""} ${d.title}`.trim();

  for (const d of deals) {
    const need = `/deals/${d.id}`;
    push("needs", { at: d.createdAt, value: 1, text: label(d), href: need });
    const first = d.quotes[0];
    if (first?.presentedAt) {
      const lastRev = d.quotes[d.quotes.length - 1];
      push("quotedN", { at: first.presentedAt, value: 1, text: `${label(d)} · ${first.number}`, href: `/cotizaciones/${first.id}` });
      push("quotedUsd", { at: first.presentedAt, value: Number(lastRev.protSale ?? 0), text: `${label(d)} · ${lastRev.number}${lastRev.rev ? ` rev ${lastRev.rev}` : ""}`, href: `/cotizaciones/${lastRev.id}` });
      push("quoteDays", { at: first.presentedAt, value: r1(Math.max(0, days(d.createdAt, first.presentedAt))), text: `${label(d)} · ${first.number}`, href: `/cotizaciones/${first.id}` });
      const po = d.customerPos.find((p) => p.receivedAt >= first.presentedAt!) ?? null;
      const refused = d.quotes.find((q) => q.status === "DECLINED" && q.decidedAt);
      const answer = po ? { at: po.receivedAt, text: `OC ${po.number}` } : refused ? { at: refused.decidedAt!, text: refused.number } : null;
      if (answer) push("decideDays", { at: answer.at, value: r1(Math.max(0, days(first.presentedAt, answer.at))), text: `${label(d)} · ${answer.text}`, href: need });
    }
    for (const q of d.quotes) {
      if (q.status === "ACCEPTED" && q.decidedAt) push("accepted", { at: q.decidedAt, value: 1, text: `${label(d)} · ${q.number}${q.rev ? ` rev ${q.rev}` : ""}`, href: `/cotizaciones/${q.id}` });
      if (q.status === "DECLINED" && q.decidedAt) push("declined", { at: q.decidedAt, value: 1, text: `${label(d)} · ${q.number}${q.rev ? ` rev ${q.rev}` : ""}`, href: `/cotizaciones/${q.id}` });
    }
    for (const p of d.customerPos) push("pos", { at: p.receivedAt, value: 1, text: `${label(d)} · OC ${p.number}`, href: need });
    const po0 = d.customerPos[0];
    const lastDel = d.deliveries[d.deliveries.length - 1];
    if (po0 && lastDel && lastDel.deliveredAt >= po0.receivedAt) push("deliverDays", { at: lastDel.deliveredAt, value: r1(days(po0.receivedAt, lastDel.deliveredAt)), text: `${label(d)} · ${lastDel.code}`, href: need });
  }

  const dealOf = new Map(deals.map((d) => [d.id, d]));
  for (const inv of invoices) {
    const d = dealOf.get(inv.dealId);
    const href = `/deals/${inv.dealId}/facturacion`;
    const txt = `${inv.number}${d ? ` · ${label(d)}` : ""}`;
    push("invoicedUsd", { at: inv.issuedAt, value: Number(inv.amount), text: txt, href });
    push("esagaraUsd", { at: inv.issuedAt, value: Number(inv.esagraAtIssue), text: txt, href });
    // Same rule as the payment behavior: only reconciled money makes an invoice paid.
    const f = invoiceFacts(toPayInvoice(inv), new Date());
    if (f.paidAt && f.actualDays != null) {
      push("payDays", { at: f.paidAt, value: f.actualDays, text: txt, href });
      push("payLate", { at: f.paidAt, value: f.delay ?? 0, text: txt, href });
    }
  }
  for (const p of payments) push("paidUsd", { at: p.receivedAt, value: Number(p.amount), text: p.reference ? `Ref. ${p.reference}` : "—", href: `/administracion/pagos-recibidos?account=${accountId}` });
  for (const m of messages) {
    const k = m.thread.channel === "EMAIL" ? "mailsIn" : m.thread.channel === "WHATSAPP" ? "whatsIn" : null;
    if (k) push(k, { at: m.sentAt, value: 1, text: `${m.authorName}${m.thread.subject ? ` · ${m.thread.subject}` : ""}`, href: `/comunicacion?t=${m.thread.id}` });
  }
  for (const m of mails) {
    const href = m.dealId ? `/deals/${m.dealId}` : null;
    push("mailsOut", { at: m.sentAt, value: 1, text: `${m.subject} → ${m.toAddr}`, href });
    if (m.repliedAt && m.repliedAt >= m.sentAt) push("mailHours", { at: m.repliedAt, value: r1((m.repliedAt.getTime() - m.sentAt.getTime()) / 3600e3), text: m.subject, href });
  }
  for (const a of activities) push("touches", { at: a.occurredAt, value: 1, text: a.subject, href: a.dealId ? `/deals/${a.dealId}` : null });
  for (const c of claims) push("claims", { at: c.reportedAt, value: 1, text: `${c.code} · ${c.whatHappened}`, href: `/deals/${c.dealId}/garantia` });

  // Credit limit: every recorded change (Account.creditLimit is audited), oldest first.
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const creditChanges: CreditChange[] = [];
  for (const a of audits) {
    const ch = (a.changes ?? {}) as Record<string, [unknown, unknown]>;
    if (!ch.creditLimit) continue;
    const [b, f] = ch.creditLimit;
    if (num(b) === num(f)) continue;
    creditChanges.push({ at: a.at, before: num(b), after: num(f), by: a.actorName, initial: a.action === "CREATE" });
  }
  const creditNow = acc?.creditLimit != null ? Number(acc.creditLimit) : null;
  for (const c of creditChanges) push("credit", { at: c.at, value: c.after ?? 0, text: `${c.before ?? "—"} → ${c.after ?? "—"} · ${c.by}`, href: `/administracion/cupos#${accountId}` });

  for (const k of Object.keys(ev)) ev[k].sort((x, y) => +x.at - +y.at);
  const all = Object.values(ev).flat().map((e) => e.at);
  const first = [acc?.createdAt ?? new Date(), ...all].reduce((m, d) => (d < m ? d : m));
  return { events: ev, creditChanges, creditNow, firstMonth: monthOf(first) };
}

// ---------- Aggregation ----------

export type Cell = { value: number | null; n: number };

/** The figure of one statistic for one month. null = no record that month (a time average with no case). */
export function cellOf(s: CustomerStats, def: StatDef, key: string): Cell {
  if (def.agg === "last") return { value: creditAt(s, monthEnd(key)), n: s.events.credit.filter((e) => monthOf(e.at) === key).length };
  const xs = s.events[def.key].filter((e) => monthOf(e.at) === key);
  if (def.agg === "avg") { const a = avg(xs.map((e) => e.value)); return { value: a == null ? null : r1(a), n: xs.length }; }
  return { value: xs.reduce((t, e) => t + e.value, 0), n: xs.length };
}

/** The figure for a run of months: sum, weighted average, or the value at the end. */
export function periodOf(s: CustomerStats, def: StatDef, keys: string[]): Cell {
  if (!keys.length) return { value: null, n: 0 };
  if (def.agg === "last") return cellOf(s, def, keys[keys.length - 1]);
  const set = new Set(keys);
  const xs = s.events[def.key].filter((e) => set.has(monthOf(e.at)));
  if (def.agg === "avg") { const a = avg(xs.map((e) => e.value)); return { value: a == null ? null : r1(a), n: xs.length }; }
  return { value: xs.reduce((t, e) => t + e.value, 0), n: xs.length };
}

/** The credit limit in force at a moment, rebuilt from the change history. */
export function creditAt(s: CustomerStats, at: Date): number | null {
  const ch = s.creditChanges;
  if (!ch.length) return s.creditNow;
  const last = [...ch].reverse().find((c) => c.at <= at);
  return last ? last.after : ch[0].before;
}

/** Records of one statistic in one month (what a person opens to check a figure). */
export const eventsIn = (s: CustomerStats, key: string, month: string) => s.events[key].filter((e) => monthOf(e.at) === month);

// ---------- Formatting ----------

type Fmt = { es: boolean; n: (v: unknown) => string; money: (v: unknown) => string };
const one = (es: boolean, v: number) => v.toLocaleString(es ? "es-CO" : "en-US", { maximumFractionDigits: 1 });
/** A figure written in full, with its unit. */
export function fmtStat(i: Fmt, unit: Unit, v: number | null): string {
  if (v == null) return "—";
  if (unit === "usd") return i.money(v);
  if (unit === "days") return `${one(i.es, v)} d`;
  if (unit === "hours") return Math.abs(v) >= 48 ? `${one(i.es, v / 24)} d` : `${one(i.es, v)} h`;
  return i.n(v);
}
/** A short figure for a chart label (1.2 k, 3.4 M). */
export function shortStat(i: Fmt, unit: Unit, v: number): string {
  if (unit === "usd") return Math.abs(v) >= 1e6 ? `${one(i.es, v / 1e6)} M` : Math.abs(v) >= 1e3 ? `${one(i.es, v / 1e3)} k` : String(Math.round(v));
  if (unit === "hours") return Math.abs(v) >= 48 ? `${one(i.es, v / 24)}d` : `${one(i.es, v)}h`;
  if (unit === "days") return `${one(i.es, v)}`;
  return String(Math.round(v));
}
/** Month name for a key ("nov 2026"), on the UTC calendar of the key itself. */
export function monthLabel(es: boolean, key: string, withYear = true) {
  const f = new Intl.DateTimeFormat(es ? "es-CO" : "en-US", { month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  return f.format(monthDate(key)).replace(".", "").replace(" de ", " ");
}
