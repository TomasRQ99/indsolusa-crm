import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import { db } from "./db";
import { canManageAll } from "./permissions";
import { addDays, daysBetween, today } from "./domain";
import { BRIEF_QUIET_DAYS } from "./day-brief";

// MI TABLERO (owner, 2026-11-23): on Mi Día, four sections of the order route (Necesidades, Cotizaciones, Pedidos,
// En tránsito). Each says how many are open now, how many went quiet and how many passed their date; the chosen one
// shows how many were created in the period against the period just before, how old the open ones are, and the
// oldest ones to open. Read-only: every figure is counted from the records, nothing is stored.

export const BOARD_SECTIONS = ["needs", "quotes", "orders", "transit"] as const;
export type BoardSection = (typeof BOARD_SECTIONS)[number];
/** Period → [bucket size in days, number of buckets]. Same-size buckets keep both periods exactly comparable. */
export const BOARD_PERIODS: Record<string, [number, number]> = { "7": [1, 7], "30": [3, 10], "90": [7, 13], "365": [28, 13] };
const AGE_BANDS: [number, number | null][] = [[0, 15], [16, 30], [31, 60], [61, 90], [91, 180], [181, null]];

type Row = { id: string; code: string; who: string; what: string; owner: string; created: Date; quiet: boolean; late: boolean; href: string };
export type BoardCard = { key: BoardSection; label: string; active: number; quiet: number; late: number; listHref: string };
export type Board = Awaited<ReturnType<typeof buildBoard>>;

const dayOf = (d: Date) => { const b = new Date(d.getTime() - 5 * 3600e3); return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())); };
const strip = (s: string) => s.replace(/ \(ejemplo\)$/, "");

export async function buildBoard(user: SessionUser, i: I18n, o: { section?: string; period?: string; team?: boolean }) {
  const { t } = i;
  const canTeam = canManageAll(user);
  const team = !!o.team && canTeam;
  const section: BoardSection = (BOARD_SECTIONS as readonly string[]).includes(o.section ?? "") ? (o.section as BoardSection) : "needs";
  const period = o.period && BOARD_PERIODS[o.period] ? o.period : "30";
  const [size, count] = BOARD_PERIODS[period];
  const span = size * count;
  const now = today();
  const end = addDays(now, 1); // exclusive
  const start = addDays(end, -span);
  const prevStart = addDays(start, -span);
  const own = team ? {} : { ownerId: user.id };
  const dealScope = { ...own, internal: false };
  // Real timestamps are compared with Bogotá days: shift the window by the 5 hours between Bogotá and UTC.
  const ts = (d: Date) => new Date(d.getTime() + 5 * 3600e3);
  const quietBefore = ts(addDays(now, -BRIEF_QUIET_DAYS + 1));

  const lastAct = { activities: { orderBy: { occurredAt: "desc" as const }, take: 1, select: { occurredAt: true } } };
  const [needs, quotes, orders, transit] = await Promise.all([
    db.deal.findMany({ where: { ...dealScope, stage: { notIn: ["WON", "LOST"] }, closedAt: null }, select: { id: true, code: true, title: true, createdAt: true, updatedAt: true, nextMoveDate: true, waitingFor: true, waitingUntil: true, owner: { select: { name: true } }, account: { select: { name: true } }, ...lastAct } }),
    db.quote.findMany({ where: { status: { in: ["DRAFT", "PRESENTED"] }, deal: { ...dealScope, stage: { notIn: ["WON", "LOST"] }, closedAt: null } }, select: { id: true, number: true, rev: true, status: true, createdAt: true, presentedAt: true, decisionAt: true, deal: { select: { title: true, owner: { select: { name: true } }, account: { select: { name: true } }, ...lastAct } } } }),
    db.deal.findMany({ where: { ...dealScope, stage: "WON", closedAt: null, resultAchievedAt: null, deliveries: { none: {} } }, select: { id: true, code: true, title: true, createdAt: true, poAcceptedAt: true, promisedDate: true, owner: { select: { name: true } }, account: { select: { name: true } }, ...lastAct } }),
    db.shipment.findMany({ where: { receipt: { not: "CONFIRMED" }, deal: dealScope }, select: { id: true, code: true, carrierName: true, createdAt: true, carrierEta: true, plannedDelivery: true, carrierEtaAt: true, deal: { select: { code: true, owner: { select: { name: true } }, account: { select: { name: true } } } } } }),
  ]);

  const rows: Record<BoardSection, Row[]> = {
    needs: needs.map((d) => {
      const last = d.activities[0] && d.activities[0].occurredAt > d.updatedAt ? d.activities[0].occurredAt : d.updatedAt;
      const controlled = (d.waitingFor && (!d.waitingUntil || d.waitingUntil >= now)) || (d.nextMoveDate && d.nextMoveDate > now);
      return { id: d.id, code: d.code ?? "", who: strip(d.account.name), what: d.title, owner: d.owner.name, created: d.createdAt, quiet: !controlled && last < quietBefore, late: !!((d.waitingFor && d.waitingUntil && d.waitingUntil < now) || (!d.waitingFor && d.nextMoveDate && d.nextMoveDate < now)), href: `/deals/${d.id}` };
    }),
    quotes: quotes.map((q) => {
      const a = q.deal.activities[0]?.occurredAt;
      const last = q.presentedAt ? (a && a > q.presentedAt ? a : q.presentedAt) : a && a > q.createdAt ? a : q.createdAt;
      return { id: q.id, code: `${q.number}${q.rev ? ` Rev. ${q.rev}` : ""}`, who: strip(q.deal.account.name), what: q.status === "DRAFT" ? t("Borrador, sin presentar", "Draft, not presented") : q.deal.title, owner: q.deal.owner.name, created: q.createdAt, quiet: last < quietBefore, late: !!q.decisionAt && dayOf(q.decisionAt) < now, href: `/cotizaciones/${q.id}` };
    }),
    orders: orders.map((d) => {
      const late = !!d.promisedDate && d.promisedDate < now;
      const a = d.activities[0]?.occurredAt;
      return { id: d.id, code: d.code ?? "", who: strip(d.account.name), what: d.title, owner: d.owner.name, created: d.poAcceptedAt ?? d.createdAt, quiet: !a || a < quietBefore, late, href: late ? `/deals/${d.id}/retraso` : `/deals/${d.id}` };
    }),
    transit: transit.map((s) => {
      const eta = s.carrierEta ?? s.plannedDelivery;
      return { id: s.id, code: s.code, who: strip(s.deal.account.name), what: [s.carrierName, s.deal.code].filter(Boolean).join(" · "), owner: s.deal.owner.name, created: s.createdAt, quiet: !eta || (!!s.carrierEtaAt && s.carrierEtaAt < quietBefore), late: !!eta && dayOf(eta) < now, href: `/logistica/${s.id}` };
    }),
  };
  const META: Record<BoardSection, { label: string; listHref: string; quiet: string; late: string; created: string }> = {
    needs: { label: t("Necesidades", "Needs"), listHref: "/deals", quiet: t("sin movimiento", "no movement"), late: t("con movimiento atrasado", "with an overdue move"), created: t("Necesidades creadas", "Needs created") },
    quotes: { label: t("Cotizaciones", "Quotes"), listHref: "/cotizaciones", quiet: t("sin seguimiento", "no follow-up"), late: t("pasaron la fecha de decisión", "past the decision date"), created: t("Cotizaciones creadas", "Quotes created") },
    orders: { label: t("Pedidos por entregar", "Orders to deliver"), listHref: "/operaciones/despachos", quiet: t("sin seguimiento", "no follow-up"), late: t("pasaron la fecha prometida", "past the promised date"), created: t("Pedidos aceptados", "Orders accepted") },
    transit: { label: t("En tránsito", "In transit"), listHref: "/logistica", quiet: t("sin fecha de llegada al día", "no up-to-date arrival date"), late: t("pasaron la fecha de llegada", "past the arrival date"), created: t("Envíos registrados", "Shipments recorded") },
  };
  const cards: BoardCard[] = BOARD_SECTIONS.map((k) => ({ key: k, label: META[k].label, active: rows[k].length, quiet: rows[k].filter((r) => r.quiet).length, late: rows[k].filter((r) => r.late).length, listHref: META[k].listHref }));

  // ---- Created in the period against the period just before (every record, open or already closed) ----
  const range = { gte: ts(prevStart), lt: ts(end) };
  const createdDates: Date[] =
    section === "needs" ? (await db.deal.findMany({ where: { ...dealScope, createdAt: range }, select: { createdAt: true } })).map((x) => x.createdAt)
    : section === "quotes" ? (await db.quote.findMany({ where: { deal: dealScope, rev: 0, createdAt: range }, select: { createdAt: true } })).map((x) => x.createdAt)
    : section === "orders" ? (await db.deal.findMany({ where: { ...dealScope, poAcceptedAt: range }, select: { poAcceptedAt: true } })).map((x) => x.poAcceptedAt!)
    : (await db.shipment.findMany({ where: { deal: dealScope, createdAt: range }, select: { createdAt: true } })).map((x) => x.createdAt);
  const cur = Array<number>(count).fill(0), prev = Array<number>(count).fill(0);
  for (const d of createdDates) {
    const k = Math.floor(daysBetween(prevStart, dayOf(d)) / size);
    if (k >= 0 && k < count) prev[k]++;
    else if (k >= count && k < 2 * count) cur[k - count]++;
  }
  const buckets = cur.map((v, k) => {
    const from = addDays(start, k * size), to = addDays(from, size - 1);
    const pFrom = addDays(prevStart, k * size), pTo = addDays(pFrom, size - 1);
    const label = (a: Date, b: Date) => (size === 1 ? i.day(a) : `${i.day(a)} – ${i.day(b)}`);
    return { label: i.day(from), range: label(from, to), prevRange: label(pFrom, pTo), now: v, prev: prev[k] };
  });
  const totalNow = cur.reduce((s, v) => s + v, 0), totalPrev = prev.reduce((s, v) => s + v, 0);

  // ---- How old the open ones are ----
  const list = rows[section].map((r) => ({ ...r, age: Math.max(0, daysBetween(dayOf(r.created), now)) })).sort((a, b) => b.age - a.age);
  const ages = AGE_BANDS.map(([lo, hi]) => ({ label: hi == null ? `+${lo - 1} d` : `${lo === 0 ? 1 : lo}–${hi} d`, n: list.filter((r) => r.age >= lo && (hi == null || r.age <= hi)).length, tone: lo >= 91 ? ("risk" as const) : lo >= 31 ? ("attn" as const) : ("info" as const) }));

  return {
    section, period, team, canTeam, cards, meta: META[section],
    span, start, end: addDays(end, -1), prevStart, prevEnd: addDays(start, -1),
    buckets, totalNow, totalPrev, ages, active: list.length, oldest: list.slice(0, 6),
  };
}

// ---------- The whole route, the invoiced sales of 12 months and the customers that bought most ----------
// (owner, 2026-11-23: the stage line of the board, "ventas netas y facturas" and "mejores clientes".)

export type BoardStation = { key: string; label: string; n: number; since: Date | null; href: string };
export type BoardExtras = Awaited<ReturnType<typeof buildBoardExtras>>;

export async function buildBoardExtras(user: SessionUser, i: I18n, o: { team?: boolean }) {
  const { t } = i;
  const team = !!o.team && canManageAll(user);
  const dealScope = { ...(team ? {} : { ownerId: user.id }), internal: false };
  const now = today();
  // Twelve calendar months, the current one included.
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const ts = (d: Date) => new Date(d.getTime() + 5 * 3600e3);

  const [open, invoices] = await Promise.all([
    db.deal.findMany({
      where: { ...dealScope, stage: { not: "LOST" }, closedAt: null, resultAchievedAt: null },
      select: {
        createdAt: true, stage: true, desiredResult: true, locatedAt: true, supplierCost: true, sourcingNote: true, quoteSentAt: true, poAcceptedAt: true,
        supplierPos: { select: { confirmedAt: true, receivedAt: true } },
        deliveries: { select: { invoice: { select: { id: true } } } },
        invoices: { select: { amount: true, applications: { select: { amount: true } } } },
      },
    }),
    db.invoice.findMany({ where: { deal: dealScope, issuedAt: { gte: ts(from) } }, select: { amount: true, issuedAt: true, accountId: true, account: { select: { name: true } } } }),
  ]);

  // Where each open case is: the step right after the last one that is done (the same steps as the path of a Need).
  const STEPS: { key: string; label: string; href: string }[] = [
    { key: "need", label: t("Necesidad", "Need"), href: "/deals" },
    { key: "locate", label: t("Localizar", "Locate"), href: "/deals" },
    { key: "source", label: t("Fuente", "Source"), href: "/localizar" },
    { key: "quote", label: t("Cotización", "Quote"), href: "/cotizaciones" },
    { key: "po", label: t("OC del cliente", "Customer PO"), href: "/cotizaciones" },
    { key: "purchase", label: t("Compra", "Purchase"), href: "/compras" },
    { key: "ship", label: t("En tránsito", "In transit"), href: "/logistica" },
    { key: "deliver", label: t("Entrega", "Delivery"), href: "/operaciones/despachos" },
    { key: "invoice", label: t("Factura", "Invoice"), href: "/operaciones/por-facturar" },
    { key: "cash", label: t("Cobro", "Collection"), href: "/administracion/cobrar" },
    { key: "result", label: t("Resultado", "Result"), href: "/deals" },
  ];
  const stations: BoardStation[] = STEPS.map((s) => ({ ...s, n: 0, since: null }));
  for (const d of open) {
    const won = d.stage === "WON";
    const sourced = d.supplierPos.length > 0 || Number(d.supplierCost) > 0 || !!d.sourcingNote;
    const delivered = d.deliveries.length > 0;
    const done = [
      !!d.desiredResult, !!d.locatedAt || sourced, sourced, !!d.quoteSentAt || d.stage === "NEGOTIATION" || won, !!d.poAcceptedAt || won,
      d.supplierPos.length > 0 && d.supplierPos.every((p) => !!p.confirmedAt), (d.supplierPos.length > 0 && d.supplierPos.every((p) => !!p.receivedAt)) || delivered, delivered,
      delivered && d.deliveries.every((x) => !!x.invoice), d.invoices.length > 0 && d.invoices.every((x) => x.applications.reduce((s, a) => s + Number(a.amount), 0) + 0.005 >= Number(x.amount)),
    ];
    const at = Math.min(STEPS.length - 1, done.lastIndexOf(true) + 1);
    const st = stations[at];
    st.n++;
    if (!st.since || d.createdAt < st.since) st.since = d.createdAt;
  }

  const months = Array.from({ length: 12 }, (_, k) => {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + k, 1));
    return { key: d.toISOString().slice(0, 7), label: new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { month: "short", timeZone: "UTC" }).format(d).replace(".", ""), year: d.getUTCFullYear(), total: 0, n: 0 };
  });
  const byAcc = new Map<string, { id: string; name: string; total: number; n: number }>();
  for (const inv of invoices) {
    const key = new Date(inv.issuedAt.getTime() - 5 * 3600e3).toISOString().slice(0, 7);
    const mo = months.find((x) => x.key === key);
    if (!mo) continue;
    const v = Number(inv.amount);
    mo.total += v; mo.n++;
    const a = byAcc.get(inv.accountId) ?? { id: inv.accountId, name: inv.account.name.replace(/ \(ejemplo\)$/, ""), total: 0, n: 0 };
    a.total += v; a.n++;
    byAcc.set(inv.accountId, a);
  }
  const customers = [...byAcc.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  return { team, stations, openCases: open.length, months, salesTotal: months.reduce((s, x) => s + x.total, 0), invoiceCount: months.reduce((s, x) => s + x.n, 0), customers, customerCount: byAcc.size };
}
