// Comercial → Seguimientos (owner, 2026-11-24): "escoger más de una cotización bajo una misma empresa y hacer
// seguimientos de cobro de cartera, cotizaciones y proyectos… en un solo correo". Everything that is still open
// with a customer, by company and by the person it is with; several are ticked and one email follows up all of them.
// Same day: "que pueda escoger un criterio de filtro o de orden… por urgencia, las más vencidas, por valor de
// Eságara, por mora; escoger un cliente o coger todos… igual las órdenes de compra y entregas".
//
// What is pending:
//   N = a request (Need) still open and not yet quoted to the customer
//   Q = a quote presented and not decided
//   O = a customer purchase order with nothing delivered yet
//   E = a delivery to the customer in preparation or on its way
//   I = an invoice with an open balance (only reconciled payments reduce it)
//   P = an open project linked to the customer
// Whose it is: the contact of the Need behind it. A project without a Need has no person: it shows for everyone.
// Urgency: what the person marked on the Need (Deal.urgency) — one mark for the request, its quote, its order,
// its delivery and its invoice. A project uses its own priority.
import { db } from "./db";
import { addDays, daysBetween, esagra, invoiceCash, today } from "./domain";
import { canEdit, canEditMoney, canEditOps } from "./permissions";
import { costOf, quoteNo, saleOf } from "./quote";
import { QUIET_DAYS } from "./projects";
import { followUpsMail, type FollowUpLine, type Mail, type MailLang } from "./email-templates";
import type { SessionUser } from "./auth";

export type FuKind = "N" | "Q" | "O" | "E" | "I" | "P";
export const FU_KINDS: FuKind[] = ["N", "Q", "O", "E", "I", "P"];
export type Urgency = "ALTA" | "MEDIA" | "BAJA";
export const URGENCIES: Urgency[] = ["ALTA", "MEDIA", "BAJA"];
export const URGENCY_LABEL: Record<Urgency, { es: string; en: string; tone: string }> = {
  ALTA: { es: "Alta", en: "High", tone: "risk" }, MEDIA: { es: "Media", en: "Medium", tone: "attn" }, BAJA: { es: "Baja", en: "Low", tone: "wait" },
};
export const isUrgency = (x: unknown): x is Urgency => URGENCIES.includes(x as Urgency);

export type FuItem = {
  key: string; kind: FuKind; id: string;
  accountId: string; accountName: string;
  contactId: string | null; contactName: string | null;
  dealId: string | null;
  /** may this person change the urgency mark (it lives on the Need) */
  canMark: boolean;
  urgency: Urgency | null;
  /** what the list shows */
  title: string; sub: string; href: string;
  /** the date that matters (see `mora`) */
  at: Date | null; late: boolean;
  /** days past that date (positive = overdue, negative = days still left); null = it has no date */
  mora: number | null;
  /** Eságara in USD of the quote, or of the Need behind an order, delivery or invoice; null = not known yet */
  esagara: number | null;
  balance: number | null;
  /** last time this was followed up by email (this screen, or its own reminder / offer email) */
  lastAt: Date | null;
  line: FollowUpLine;
};
export const FU_MAX = 12;
export const NOTE_MAX = 240;
const KEY = /^[NQOEIP]:[a-z0-9]{10,40}$/i;
export const cleanKeys = (xs: unknown[]) => [...new Set(xs.map(String).filter((x) => KEY.test(x)))].slice(0, FU_MAX);
const person = (c: { firstName: string; lastName: string } | null | undefined) => (c ? `${c.firstName} ${c.lastName}`.trim() : null);
const emailOk = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const urg = (x: string | null | undefined): Urgency | null => (isUrgency(x) ? x : null);

// ---------- criteria: what to show and in which order ----------
export type FuSort = "mora" | "urg" | "esmax" | "esmin";
export const FU_SORTS: FuSort[] = ["mora", "urg", "esmax", "esmin"];
export type FuCriteria = { kind: FuKind | null; urgency: Urgency | "NONE" | null; sort: FuSort };
export function readCriteria(sp: { t?: string; u?: string; o?: string }): FuCriteria {
  return {
    kind: FU_KINDS.includes(sp.t as FuKind) ? (sp.t as FuKind) : null,
    urgency: isUrgency(sp.u) ? sp.u : sp.u === "NONE" ? "NONE" : null,
    sort: FU_SORTS.includes(sp.o as FuSort) ? (sp.o as FuSort) : "mora",
  };
}
export const criteriaParams = (c: FuCriteria) => ({ ...(c.kind ? { t: c.kind } : {}), ...(c.urgency ? { u: c.urgency } : {}), ...(c.sort !== "mora" ? { o: c.sort } : {}) });
const RANK: Record<string, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
/** Filters by kind and urgency, then orders. Whatever lacks the value being ordered by goes last. */
export function applyCriteria(items: FuItem[], c: FuCriteria): FuItem[] {
  const list = items.filter((x) => (!c.kind || x.kind === c.kind) && (!c.urgency || (c.urgency === "NONE" ? x.urgency === null : x.urgency === c.urgency)));
  const mora = (a: FuItem, b: FuItem) => (b.mora ?? -1e9) - (a.mora ?? -1e9);
  const by: Record<FuSort, (a: FuItem, b: FuItem) => number> = {
    mora,
    urg: (a, b) => (RANK[a.urgency ?? ""] ?? 3) - (RANK[b.urgency ?? ""] ?? 3) || mora(a, b),
    esmax: (a, b) => (b.esagara ?? -1e15) - (a.esagara ?? -1e15) || mora(a, b),
    esmin: (a, b) => (a.esagara ?? 1e15) - (b.esagara ?? 1e15) || mora(a, b),
  };
  return [...list].sort(by[c.sort]);
}

/** Every pending thing this person may follow up, of one company or of all of them. */
export async function loadFollowUps(user: SessionUser, accountId?: string | null): Promise<FuItem[]> {
  const now = today();
  const acc = accountId ? { id: accountId, internal: false } : { internal: false };
  const costs = { amount: true, supplierCost: true, freightCost: true, otherCosts: true } as const;
  const dealSel = { id: true, code: true, title: true, ownerId: true, customerPo: true, urgency: true, promisedDate: true, contactId: true, contact: { select: { firstName: true, lastName: true } }, ...costs } as const;
  const accSel = { select: { id: true, name: true } } as const;
  const [needs, quotes, pos, dispatches, invoices, projects] = await Promise.all([
    db.deal.findMany({
      where: { internal: false, closedAt: null, stage: { notIn: ["WON", "LOST"] }, account: acc, quotes: { none: { status: { in: ["PRESENTED", "ACCEPTED"] } } }, customerPos: { none: {} } },
      select: { ...dealSel, createdAt: true, neededBy: true, nextMoveDate: true, account: accSel },
      orderBy: { createdAt: "asc" },
    }),
    db.quote.findMany({
      where: { status: "PRESENTED", deal: { account: acc } },
      select: { id: true, number: true, rev: true, presentedAt: true, issuedAt: true, createdAt: true, validityDays: true, protEsagra: true, supplierCost: true, freightCost: true, otherCosts: true, fxRate: true, lines: { select: { qty: true, unitPrice: true } }, deal: { select: { ...dealSel, account: accSel } } },
      orderBy: { presentedAt: "asc" },
    }),
    db.customerPO.findMany({
      where: { rejectedAt: null, deal: { account: acc, internal: false, closedAt: null, deliveries: { none: {} } } },
      select: { id: true, number: true, receivedAt: true, requiredBy: true, deal: { select: { ...dealSel, account: accSel } } },
      orderBy: { receivedAt: "asc" },
    }),
    db.dispatchOrder.findMany({
      where: { cancelledAt: null, deliveredAt: null, deal: { account: acc, internal: false } },
      select: { id: true, code: true, scheduledFor: true, dispatchedAt: true, deal: { select: { ...dealSel, account: accSel } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invoice.findMany({
      where: { account: acc },
      select: { id: true, number: true, amount: true, dueAt: true, esagraAtIssue: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } }, account: accSel, deal: { select: dealSel } },
      orderBy: { dueAt: "asc" },
    }),
    db.project.findMany({
      where: { kind: "PROJECT", closedAt: null, account: acc },
      select: { id: true, code: true, title: true, priority: true, updatedAt: true, account: accSel, lead: { select: { name: true } }, deal: { select: { id: true, contactId: true, contact: { select: { firstName: true, lastName: true } } } } },
      orderBy: { updatedAt: "asc" },
    }),
  ]);

  type D = (typeof quotes)[number]["deal"];
  const base = (d: D) => ({ accountId: d.account.id, accountName: d.account.name, contactId: d.contactId, contactName: person(d.contact), dealId: d.id, urgency: urg(d.urgency), canMark: canEdit(user, d.ownerId), balance: null as number | null, lastAt: null as Date | null });
  const dealEs = (d: { amount: unknown; supplierCost: unknown; freightCost: unknown; otherCosts: unknown }) => (Number(d.amount) > 0 ? esagra(d as Parameters<typeof esagra>[0]).value : null);
  const moraOf = (d: Date | null) => (d ? daysBetween(d, now) : null);

  const items: FuItem[] = [];
  for (const d of needs) {
    if (!canEdit(user, d.ownerId)) continue;
    // What makes a request overdue: the day we agreed to move, or the day the customer needs it.
    const at = d.nextMoveDate ?? d.neededBy ?? null;
    items.push({
      ...base(d), key: `N:${d.id}`, kind: "N", id: d.id, title: d.code ?? d.title, sub: d.code ? d.title : "", href: `/deals/${d.id}`,
      at, late: !!at && at < now, mora: moraOf(at), esagara: dealEs(d),
      line: { kind: "NEED", code: d.code, what: d.title },
    });
  }
  for (const q of quotes) {
    if (!canEdit(user, q.deal.ownerId)) continue;
    const sentAt = q.presentedAt ?? q.issuedAt ?? q.createdAt;
    const validUntil = addDays(sentAt, q.validityDays);
    const no = quoteNo(q);
    const sale = saleOf(q.lines);
    items.push({
      ...base(q.deal), key: `Q:${q.id}`, kind: "Q", id: q.id, title: `Nº ${no}`, sub: q.deal.title, href: `/cotizaciones/${q.id}`,
      at: validUntil, late: validUntil < now, mora: moraOf(validUntil), esagara: q.protEsagra != null ? Number(q.protEsagra) : sale > 0 ? Math.round((sale - costOf(q)) * 100) / 100 : null,
      line: { kind: "QUOTE", number: no, what: q.deal.title, sentAt, validUntil },
    });
  }
  const dispatching = new Set(dispatches.map((x) => x.deal.id));
  for (const p of pos) {
    if (!canEditOps(user, p.deal.ownerId) || dispatching.has(p.deal.id)) continue;
    const at = p.requiredBy ?? p.deal.promisedDate ?? null;
    items.push({
      ...base(p.deal), key: `O:${p.id}`, kind: "O", id: p.id, title: `OC ${p.number}`, sub: `${p.deal.code ?? ""} · ${p.deal.title}`.replace(/^ · /, ""), href: `/po/${p.id}`,
      at, late: !!at && at < now, mora: moraOf(at), esagara: dealEs(p.deal),
      line: { kind: "PO", number: p.number, what: p.deal.title },
    });
  }
  for (const e of dispatches) {
    if (!canEditOps(user, e.deal.ownerId)) continue;
    const at = e.scheduledFor ?? e.deal.promisedDate ?? null;
    items.push({
      ...base(e.deal), key: `E:${e.id}`, kind: "E", id: e.id, title: e.code, sub: `${e.deal.code ?? ""} · ${e.deal.title}${e.deal.customerPo ? ` · OC ${e.deal.customerPo}` : ""}`.replace(/^ · /, ""), href: "/operaciones/despachos",
      at, late: !!at && at < now, mora: moraOf(at), esagara: dealEs(e.deal),
      line: { kind: "DELIVERY", po: e.deal.customerPo, what: e.deal.title, scheduledFor: e.scheduledFor },
    });
  }
  for (const inv of invoices) {
    if (!canEditMoney(user, inv.deal.ownerId)) continue;
    const cash = invoiceCash(inv);
    if (cash.balance <= 0.005) continue;
    items.push({
      ...base({ ...inv.deal, account: inv.account }), key: `I:${inv.id}`, kind: "I", id: inv.id,
      title: inv.number, sub: `${inv.deal.code ?? ""}${inv.deal.customerPo ? ` · OC ${inv.deal.customerPo}` : ""}`.replace(/^ · /, ""), href: `/administracion/cobrar?f=${inv.id}`,
      at: inv.dueAt, late: inv.dueAt < now, mora: moraOf(inv.dueAt), esagara: Number(inv.esagraAtIssue), balance: cash.balance,
      line: { kind: "INVOICE", number: inv.number, customerPo: inv.deal.customerPo, balance: cash.balance, currency: "USD", dueAt: inv.dueAt },
    });
  }
  for (const p of projects) {
    if (!p.account) continue;
    // A project may go 14 days without movement: past that, it is overdue by the days beyond it.
    const quiet = daysBetween(p.updatedAt, new Date()) - QUIET_DAYS;
    items.push({
      key: `P:${p.id}`, kind: "P", id: p.id, accountId: p.account.id, accountName: p.account.name,
      contactId: p.deal?.contactId ?? null, contactName: person(p.deal?.contact), dealId: p.deal?.id ?? null, canMark: false, urgency: urg(p.priority),
      title: p.title, sub: `${p.code} · ${p.lead.name}`, href: `/proyectos/${p.id}`, at: p.updatedAt, late: quiet > 0, mora: quiet, esagara: null, balance: null, lastAt: null,
      line: { kind: "PROJECT", title: p.title },
    });
  }
  if (!items.length) return items;

  // When each one was last followed up: an email from this screen, or its own offer / payment-reminder email.
  const last = new Map<string, Date>();
  const put = (k: string, d: Date) => { const x = last.get(k); if (!x || d > x) last.set(k, d); };
  const accountIds = [...new Set(items.map((x) => x.accountId))];
  const [sent, single] = await Promise.all([
    db.followUp.findMany({ where: { accountId: { in: accountIds } }, select: { items: true, sentAt: true } }),
    db.outboundMail.findMany({ where: { status: { in: ["SENT", "UNCERTAIN"] }, OR: [{ refKind: "QUOTE", refId: { in: items.filter((x) => x.kind === "Q").map((x) => x.id) } }, { refKind: "INVOICE", refId: { in: items.filter((x) => x.kind === "I").map((x) => x.id) } }] }, select: { refKind: true, refId: true, sentAt: true } }),
  ]);
  for (const f of sent) for (const k of f.items) put(k, f.sentAt);
  for (const m of single) put(`${m.refKind === "QUOTE" ? "Q" : "I"}:${m.refId}`, m.sentAt);
  for (const it of items) it.lastAt = last.get(it.key) ?? null;
  return items;
}

/** The items that show when a person is chosen: theirs, plus those of the company that have no person. */
export const forPerson = (items: FuItem[], contactId: string | null) => (contactId ? items.filter((x) => x.contactId === contactId || x.contactId === null) : items);

export type FuCompose = {
  mail: Mail; lang: MailLang; account: { id: string; name: string };
  contact: { id: string; name: string; email: string | null } | null;
  to: string | null; toName: string;
  items: FuItem[]; notes: Record<string, string>;
};

/** Builds the one email from the ticked items. Rebuilt on the server when sending: only ids and the person's own
 *  notes come from the browser, and items the person may not follow up are left out. */
export async function composeFollowUps(o: { accountId: string; contactId: string | null; keys: string[]; notes: Record<string, string>; lang?: MailLang | null }, user: SessionUser, from: string): Promise<FuCompose | null> {
  const account = await db.account.findFirst({ where: { id: o.accountId, internal: false }, select: { id: true, name: true, contacts: { orderBy: { createdAt: "asc" }, select: { id: true, firstName: true, lastName: true, email: true } } } });
  if (!account) return null;
  const all = await loadFollowUps(user, account.id);
  const items = cleanKeys(o.keys).map((k) => all.find((x) => x.key === k)).filter((x): x is FuItem => !!x).sort((a, b) => FU_KINDS.indexOf(a.kind) - FU_KINDS.indexOf(b.kind));
  if (!items.length) return null;
  const notes: Record<string, string> = {};
  for (const it of items) { const n = (o.notes[it.key] ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX); if (n) notes[it.key] = n; }
  // Who it goes to: the chosen person; with "the whole company", the person most of the ticked items are with.
  const chosen = o.contactId ? account.contacts.find((c) => c.id === o.contactId) ?? null : null;
  const count = new Map<string, number>();
  for (const it of items) if (it.contactId) count.set(it.contactId, (count.get(it.contactId) ?? 0) + 1);
  const most = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const c = chosen ?? account.contacts.find((x) => x.id === most) ?? account.contacts.find((x) => emailOk(x.email)) ?? null;
  const lang: MailLang = o.lang ?? (user.lang === "EN" ? "EN" : "ES");
  const mail = followUpsMail({ lang, contactName: c?.firstName ?? null, customer: account.name, lines: items.map((it) => ({ ...it.line, note: notes[it.key] ?? null })), sender: user.name, from });
  return {
    mail, lang, account: { id: account.id, name: account.name },
    contact: c ? { id: c.id, name: person(c)!, email: emailOk(c.email) ? c.email!.trim() : null } : null,
    to: c && emailOk(c.email) ? c.email!.trim() : null, toName: c ? person(c)! : account.name,
    items, notes,
  };
}
