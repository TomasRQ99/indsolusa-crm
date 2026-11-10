import { db } from "./db";
import { sumMoney, sharePct } from "./money";
import { METRIC_KEYS, VALUE_KINDS, bottlenecks, paceOf, periodBounds, type Extras, type MetricKey, type Pace } from "./goal-rules";

// Comercial C7 · actual results per person and month, computed from what already happened in the system
// (no self-reported numbers). Attribution: Journey owner; useful contacts by who logged them.

export async function goalActuals(userId: string, period: string) {
  const { start, end } = periodBounds(period);
  const inMonth = { gte: start, lt: end };
  const [accepted, declined, contacts, needs, presentations, sentNoPresent] = await Promise.all([
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: inMonth, deal: { ownerId: userId } }, select: { id: true, protSale: true, protEsagra: true, esagaraExceptions: { where: { status: "APPROVED" }, select: { id: true } } } }),
    db.quote.count({ where: { status: "DECLINED", decidedAt: inMonth, deal: { ownerId: userId } } }),
    db.activity.groupBy({ by: ["valueKind"], where: { userId, occurredAt: inMonth, valueKind: { in: Object.keys(VALUE_KINDS) } }, _count: { _all: true } }),
    db.deal.count({ where: { ownerId: userId, createdAt: inMonth, desiredResult: { not: null }, NOT: { desiredResult: "" } } }),
    db.presentationRecord.count({ where: { at: inMonth, case: { deal: { ownerId: userId } } } }),
    db.quote.count({ where: { presentedAt: inMonth, status: { not: "DRAFT" }, deal: { ownerId: userId }, presentations: { none: {} } } }),
  ]);
  const esagara = sumMoney(accepted.map((q) => q.protEsagra));
  const sale = sumMoney(accepted.map((q) => q.protSale));
  const byKind = Object.fromEntries(contacts.map((c) => [c.valueKind!, c._count._all])) as Record<string, number>;
  const values: Record<MetricKey, number> = {
    ESAGARA_AMOUNT: esagara,
    VALUE_CONTACTS: Object.values(byKind).reduce((s, n) => s + n, 0),
    NEEDS_CREATED: needs,
    SOLUTIONS_PRESENTED: presentations,
    DECISIONS_MOVED: accepted.length + declined,
  };
  const extras: Extras = { sentWithoutPresenting: sentNoPresent, accepted: accepted.length, declined, esagaraPct: sale > 0 ? sharePct(esagara, sale) : null, lowEsagaraApproved: accepted.filter((q) => q.esagaraExceptions.length > 0).length };
  return { values, extras, sale, byKind };
}

export async function currentTargets(userId: string, period: string) {
  return db.goalTarget.findMany({ where: { userId, period, supersededAt: null } });
}

/** Everything the goals page shows for one person and month. */
export async function goalBoard(userId: string, period: string, now = new Date()) {
  const [a, targets, history] = await Promise.all([
    goalActuals(userId, period),
    currentTargets(userId, period),
    db.goalTarget.findMany({ where: { userId, period, supersededAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const tOf = (k: MetricKey) => targets.find((t) => t.metric === k) ?? null;
  const paces = Object.fromEntries(METRIC_KEYS.map((k) => { const t = tOf(k); return [k, paceOf(t ? Number(t.target) : null, a.values[k], period, now)]; })) as Record<MetricKey, Pace>;
  return { ...a, targets, tOf, history, paces, hints: bottlenecks(paces, a.extras) };
}
