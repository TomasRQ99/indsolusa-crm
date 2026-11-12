import { db } from "./db";
import { today } from "./domain";
import { OUTCOMES_NOT_CONTACT } from "./contact-line-rules";

// Comercial · Perfiles. Reads for the list of customers and for one customer's profile. The diary is what people
// wrote; the meetings offered for a new entry are the ones SOLU already has (never typed twice).

/** Mail to suppliers lives in the same table; it is never a customer conversation. */
const NOT_CUSTOMER = ["Localizar repuestos", "Plantillas de correo"];

export type ProfileRow = {
  id: string; name: string; industry: string | null; owner: string; entries: number; people: number;
  lastOn: Date | null; pain: string | null; painOn: Date | null; ecsa: string | null;
  next: { what: string; on: Date | null; late: boolean } | null;
};

/** Every customer with what its diary holds: how many entries, the latest pain on record and the next follow-up. */
export async function profileList(ownerId: string | null, q: string): Promise<ProfileRow[]> {
  const T = today();
  const where = { internal: false, ...(ownerId ? { ownerId } : {}), ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) };
  const [accounts, planned] = await Promise.all([
    db.account.findMany({
      where, orderBy: { name: "asc" }, take: 400,
      select: {
        id: true, name: true, industry: true, owner: { select: { name: true } },
        _count: { select: { profileEntries: true, contacts: true } },
        profileEntries: { orderBy: [{ happenedOn: "desc" }, { createdAt: "desc" }], take: 12, select: { happenedOn: true, pain: true, ecsa: true } },
      },
    }),
    db.profileDiaryEntry.findMany({ where: { account: where, taskId: { not: null } }, select: { accountId: true, taskId: true, followUp: true, followUpOn: true } }),
  ]);
  const open = new Set((await db.task.findMany({ where: { id: { in: planned.map((p) => p.taskId!) }, status: "OPEN" }, select: { id: true } })).map((t) => t.id));
  const next = new Map<string, { what: string; on: Date | null; late: boolean }>();
  for (const p of planned.filter((x) => open.has(x.taskId!)).sort((a, b) => +(a.followUpOn ?? 0) - +(b.followUpOn ?? 0))) {
    if (!next.has(p.accountId)) next.set(p.accountId, { what: p.followUp ?? "", on: p.followUpOn, late: !!p.followUpOn && p.followUpOn < T });
  }
  return accounts.map((a) => {
    const withPain = a.profileEntries.find((e) => e.pain);
    return {
      id: a.id, name: a.name, industry: a.industry, owner: a.owner.name, entries: a._count.profileEntries, people: a._count.contacts,
      lastOn: a.profileEntries[0]?.happenedOn ?? null, pain: withPain?.pain ?? null, painOn: withPain?.happenedOn ?? null,
      ecsa: a.profileEntries.find((e) => e.ecsa)?.ecsa ?? null, next: next.get(a.id) ?? null,
    };
  });
}

/** One customer's profile. `readings` (how each person lives their work) is loaded only for whoever may see it. */
export async function customerProfile(accountId: string, withReadings: boolean) {
  const now = new Date(Date.now() + 10 * 60 * 1000);
  const a = await db.account.findFirst({
    where: { id: accountId, internal: false },
    select: {
      id: true, name: true, industry: true, phone: true, website: true, ownerId: true, owner: { select: { name: true } },
      contacts: { orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, title: true, phone: true, email: true } },
    },
  });
  if (!a) return null;
  const [entries, meetings, items, files, assets, readings] = await Promise.all([
    db.profileDiaryEntry.findMany({ where: { accountId }, orderBy: [{ happenedOn: "desc" }, { createdAt: "desc" }], take: 200, include: { contact: { select: { id: true, firstName: true, lastName: true } } } }),
    // Conversations that really happened: calls, video calls, visits and meetings (a visit closed in Visitas is here too).
    db.activity.findMany({
      where: { accountId, type: { in: ["CALL", "MEETING"] }, uncertain: false, occurredAt: { lte: now }, AND: [{ OR: [{ source: null }, { source: { notIn: NOT_CUSTOMER } }] }, { OR: [{ outcome: null }, { outcome: { notIn: OUTCOMES_NOT_CONTACT } }] }] },
      orderBy: { occurredAt: "desc" }, take: 40,
      select: { id: true, type: true, outcome: true, subject: true, occurredAt: true, contactId: true, user: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
    }),
    db.profileItem.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, title: true, note: true, url: true, fileName: true, mime: true, size: true, uploadedByName: true, createdAt: true } }),
    db.profileItem.count({ where: { accountId, size: { gt: 0 } } }),
    // Brands SOLU already knows from the equipment recorded in Mercado: shown, never asked again.
    db.installedAsset.findMany({ where: { plant: { accountId }, manufacturer: { not: null } }, select: { manufacturer: true }, distinct: ["manufacturer"], take: 30 }),
    withReadings ? db.personReading.findMany({ where: { contact: { accountId } }, orderBy: [{ supersededAt: { sort: "asc", nulls: "first" } }, { observedOn: "desc" }] }) : Promise.resolve([]),
  ]);
  const taskIds = entries.map((e) => e.taskId).filter((x): x is string => !!x);
  const tasks = taskIds.length ? await db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true, dueDate: true } }) : [];
  const taskOf = new Map(tasks.map((t) => [t.id, t]));
  const usedMeetings = new Set(entries.map((e) => e.activityId).filter((x): x is string => !!x));
  const meetingOfEntry = new Map(meetings.map((m) => [m.id, m]));
  // A meeting older than the 40 offered can still be the origin of an entry: fetch those too, for the label.
  const missing = [...usedMeetings].filter((id) => !meetingOfEntry.has(id));
  if (missing.length) for (const m of await db.activity.findMany({ where: { id: { in: missing } }, select: { id: true, type: true, outcome: true, subject: true, occurredAt: true, contactId: true, user: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } } })) meetingOfEntry.set(m.id, m);
  return { a, entries, meetings, usedMeetings, meetingOfEntry, taskOf, items, files, knownBrands: assets.map((x) => x.manufacturer!).filter(Boolean).sort(), readings, today: today() };
}
export type CustomerProfile = NonNullable<Awaited<ReturnType<typeof customerProfile>>>;
