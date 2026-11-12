import { db } from "./db";
import { today } from "./domain";
import { CONTACT_LINE_KEY, DEFAULT_CONTACT_LINE, OUTCOMES_NOT_CONTACT, isVideo, bandOf, bandsOf, cutsOf, type Band, type Channel, type ContactLinePolicy } from "./contact-line-rules";

// Comercial · Línea de comunicaciones. One truth, derived: nothing is stored about "last contact" — it is read from
// what SOLU already has (interactions, visits, conversations, tracked mail), so it can never drift from the record.

export const CONTACT_LINE_SOURCE = "Línea de comunicaciones";
/** Activities that are mail to suppliers or are counted from the tracked-mail table instead. */
const NOT_CUSTOMER_CONTACT = ["Localizar repuestos", "Plantillas de correo"];

export async function getContactLinePolicy(): Promise<{ value: ContactLinePolicy; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: CONTACT_LINE_KEY }, orderBy: { version: "desc" } });
  return s ? { value: { cutsMonths: cutsOf(s.value as Partial<ContactLinePolicy>) }, version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_CONTACT_LINE, version: 0, by: null, at: null };
}

export type LineRow = { id: string; name: string; owner: string; ownerId: string; last: Date | null; channel: Channel | null; band: number };

/**
 * Every customer company with the last time we were in contact. A contact is a call, a visit or meeting, an email
 * or a WhatsApp conversation — in either direction. A note is not a contact: it never moves a company to "al día".
 */
export async function contactLine(ownerId: string | null, cuts: number[]): Promise<{ rows: LineRow[]; bands: (Band & { rows: LineRow[] })[]; today: Date }> {
  // Ten minutes of tolerance: records stamped by the database clock can be a moment ahead of this server's clock.
  const now = new Date(Date.now() + 10 * 60 * 1000);
  const T = today();
  const scope = { internal: false, ...(ownerId ? { ownerId } : {}) };
  const [accounts, acts, threads, mails] = await Promise.all([
    db.account.findMany({ where: scope, orderBy: { name: "asc" }, select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } } }),
    db.activity.groupBy({
      by: ["accountId", "type", "outcome"],
      where: { account: scope, type: { in: ["CALL", "MEETING", "EMAIL"] }, uncertain: false, occurredAt: { lte: now }, AND: [{ OR: [{ source: null }, { source: { notIn: NOT_CUSTOMER_CONTACT } }] }, { OR: [{ outcome: null }, { outcome: { notIn: OUTCOMES_NOT_CONTACT } }] }] },
      _max: { occurredAt: true },
    }),
    db.commThread.groupBy({ by: ["accountId", "channel"], where: { account: scope, channel: { not: "NOTE" }, lastAt: { lte: now } }, _max: { lastAt: true } }),
    db.outboundMail.groupBy({ by: ["accountId"], where: { account: scope, partyKind: "CUSTOMER", status: "SENT", sentAt: { lte: now } }, _max: { sentAt: true } }),
  ]);
  const best = new Map<string, { at: Date; channel: Channel }>();
  const see = (id: string | null, at: Date | null | undefined, channel: Channel) => {
    if (!id || !at) return;
    const cur = best.get(id);
    if (!cur || at > cur.at) best.set(id, { at, channel });
  };
  for (const a of acts) see(a.accountId, a._max.occurredAt, isVideo(a.outcome) ? "VIDEO" : (a.type as Channel));
  for (const t of threads) see(t.accountId, t._max.lastAt, t.channel as Channel);
  for (const m of mails) see(m.accountId, m._max.sentAt, "EMAIL");

  const rows: LineRow[] = accounts.map((a) => {
    const b = best.get(a.id) ?? null;
    return { id: a.id, name: a.name, owner: a.owner.name, ownerId: a.ownerId, last: b?.at ?? null, channel: b?.channel ?? null, band: bandOf(b?.at ?? null, T, cuts) };
  });
  // Inside a band: the longest wait first; companies with no contact stay by name.
  const bands = bandsOf(cuts).map((b) => ({ ...b, rows: rows.filter((r) => r.band === b.index).sort((x, y) => (x.last?.getTime() ?? 0) - (y.last?.getTime() ?? 0) || x.name.localeCompare(y.name)) }));
  return { rows, bands, today: T };
}

/** What the slide shows for one company: its people and the latest things on record. */
export async function contactLineCompany(accountId: string) {
  return db.account.findFirst({
    where: { id: accountId, internal: false },
    select: {
      id: true, name: true, phone: true, owner: { select: { name: true } },
      contacts: { orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, title: true, phone: true, email: true } },
      activities: {
        where: { OR: [{ type: { in: ["CALL", "MEETING", "EMAIL"] } }, { type: "NOTE", phase: null }] },
        orderBy: { occurredAt: "desc" }, take: 6,
        select: { id: true, type: true, subject: true, body: true, outcome: true, occurredAt: true, user: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
      },
    },
  });
}
