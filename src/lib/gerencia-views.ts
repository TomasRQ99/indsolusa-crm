import type { Role } from "@prisma/client";
import { db } from "./db";
import { addDays, daysBetween, invoiceCash, today } from "./domain";
import { sumMoney, sharePct } from "./money";
import { periodBounds, shiftPeriod } from "./goal-rules";
import { compareDays } from "./focus-rules";
import { computePulse, pulseGroups } from "./pulse";
import { insightsFor } from "./report-insights";
import { focusItems, getFocusPolicy } from "./focus";
import { loadCredit } from "./queries";
import { paymentBehaviors } from "./pay-behavior";
import { REASON_TEXT, type Reason } from "./purchase-auth";
import { POLICY_REGISTER } from "./policy-register";
import { peopleCapacity } from "./gerencia-people";
import { getGerenciaPolicy, neededItems, type NeededItem } from "./gerencia-store";
import { recurring, trendOf, type ExceptionRow, type Trend } from "./gerencia-rules";

// Módulo 15 §5–8, §20 · the reading views of Gerencia: strategic accounts, functional reviews, policy and authority
// oversight, and how the system itself is improving. All of them are derived on open from the records of the module
// that owns each fact.

type Txt = { es: string; en: string };
const tx = (es: string, en: string): Txt => ({ es, en });
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- §6 Strategic accounts (AC11) ----------

export async function strategicAccounts(now = today()) {
  const rows = await db.strategicAccount.findMany({
    where: { active: true }, orderBy: { account: { name: "asc" } },
    include: {
      executive: { select: { id: true, name: true } },
      account: { select: {
        id: true, name: true, industry: true, ownerId: true, owner: { select: { name: true, active: true } }, backup: { select: { backupUser: { select: { name: true, active: true } } } },
        _count: { select: { contacts: true } },
        whiteSpaces: { where: { status: { in: ["OPEN", "EXPLORING"] } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, what: true, kind: true } },
        futures: { where: { status: "OPEN" }, orderBy: { expectedAt: "asc" }, take: 4, select: { id: true, description: true, expectedAt: true } },
      } },
    },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.accountId);
  const fpol = await getFocusPolicy();
  const [items, year, credit, behaviors, claims, exceptions, lastAct] = await Promise.all([
    focusItems(null, fpol.value),
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: { gte: addDays(now, -365) }, deal: { accountId: { in: ids }, internal: false } }, select: { protSale: true, protEsagra: true, deal: { select: { accountId: true } } } }),
    loadCredit({ id: { in: ids } }),
    paymentBehaviors(ids),
    db.customerClaim.findMany({ where: { status: "OPEN", deal: { accountId: { in: ids } } }, select: { id: true, code: true, deal: { select: { id: true, accountId: true } } } }),
    db.operationalException.findMany({ where: { status: "OPEN", deal: { accountId: { in: ids } } }, select: { id: true, deal: { select: { accountId: true } } } }),
    db.activity.groupBy({ by: ["accountId"], where: { accountId: { in: ids } }, _max: { occurredAt: true } }),
  ]);
  const lastBy = new Map(lastAct.map((a) => [a.accountId, a._max.occurredAt]));
  return rows.map((r) => {
    const a = r.account;
    const mine = items.filter((x) => x.accountId === a.id);
    const y = year.filter((q) => q.deal.accountId === a.id);
    const sale = sumMoney(y.map((q) => q.protSale)), esagara = sumMoney(y.map((q) => q.protEsagra));
    const cr = credit.find((c) => c.id === a.id);
    const beh = behaviors.byId.get(a.id);
    const risks: Txt[] = [];
    if (cr && cr.limit != null && cr.used > cr.limit + 0.005) risks.push(tx(`Usa USD ${Math.round(cr.used - cr.limit).toLocaleString("en-US")} más que su cupo`, `Uses USD ${Math.round(cr.used - cr.limit).toLocaleString("en-US")} more than its limit`));
    if (cr && cr.overdueCount > 0) risks.push(tx(`${cr.overdueCount} factura(s) vencida(s)`, `${cr.overdueCount} overdue invoice(s)`));
    if (beh?.trend.trend === "WORSE") risks.push(tx("Viene pagando más lento", "Has been paying more slowly"));
    const cl = claims.filter((c) => c.deal.accountId === a.id), ex = exceptions.filter((e) => e.deal.accountId === a.id);
    if (cl.length) risks.push(tx(`${cl.length} reclamo(s) abierto(s)`, `${cl.length} open claim(s)`));
    if (ex.length) risks.push(tx(`${ex.length} excepción(es) operativa(s) abierta(s)`, `${ex.length} open operational exception(s)`));
    for (const x of mine.filter((m) => m.quoteStatus === "ACCEPTED" && m.risks.length)) risks.push(tx(`${x.code ?? x.solution}: ${x.risks[0].es}`, `${x.code ?? x.solution}: ${x.risks[0].en}`));
    if (!a.owner.active) risks.push(tx("Su responsable comercial ya no está activo", "Its commercial owner is no longer active"));
    const last = lastBy.get(a.id) ?? null;
    const moveLate = !!r.nextMoveOn && r.nextMoveOn < now;
    return {
      id: r.id, accountId: a.id, name: a.name, industry: a.industry, reason: r.reason, growthNote: r.growthNote, since: r.createdAt, setBy: r.setByName,
      coverage: { owner: a.owner.name, backup: a.backup?.backupUser.active ? a.backup.backupUser.name : null, executive: r.executive?.name ?? null, executiveId: r.executive?.id ?? null, contacts: a._count.contacts, lastContact: last, quietDays: last ? Math.max(0, daysBetween(last, now)) : null },
      work: { needs: mine.filter((x) => !x.quoteStatus).length, drafts: mine.filter((x) => x.quoteStatus === "DRAFT").length, presented: mine.filter((x) => x.quoteStatus === "PRESENTED").length, accepted: mine.filter((x) => x.quoteStatus === "ACCEPTED").length, openEsagara: sumMoney(mine.filter((x) => x.quoteStatus && x.quoteStatus !== "DRAFT").map((x) => x.esagara ?? 0)) },
      year: { sale, esagara, pct: sale > 0 ? sharePct(esagara, sale) : null, n: y.length },
      cash: { owes: cr ? r2(cr.openInvoices) : 0, limit: cr?.limit ?? null, used: cr ? r2(cr.used) : 0, trend: beh?.trend.trend ?? "UNKNOWN", expectedDays: beh?.expected ?? null },
      risks, growth: { whiteSpaces: a.whiteSpaces, futures: a.futures },
      nextMove: r.nextMove, nextMoveOn: r.nextMoveOn, moveLate, attention: moveLate || !r.nextMove || risks.length > 0,
    };
  });
}
export type StrategicRow = Awaited<ReturnType<typeof strategicAccounts>>[number];

// ---------- §5 Functional reviews (AC10): what changed, why, what needs a decision ----------

export const REVIEW_AREAS = ["MERCADEO", "COMERCIAL", "OPERACIONES", "ADMINISTRACION", "EQUIPO"] as const;
export type ReviewArea = (typeof REVIEW_AREAS)[number];
export const REVIEW_TOPICS: Record<ReviewArea, Txt> = {
  MERCADEO: tx("Dónde estamos aprendiendo, necesidades creadas, espacios en blanco, relaciones estratégicas", "Where we are learning, Needs created, white spaces, strategic relationships"),
  COMERCIAL: tx("Eságara, creación de futuro, decisiones, excepciones de Eságara baja, cartera y cupo", "Eságara, future creation, decisions, low-Eságara exceptions, receivables and credit"),
  OPERACIONES: tx("Promesa al cliente, compras, excepciones de suministro y logística, ahorros, protección de la Eságara", "Customer promise, purchases, supply and logistics exceptions, savings, Eságara protection"),
  ADMINISTRACION: tx("Caja, crédito, exposición, cobros, pagos, obligaciones, compensación variable", "Cash, credit, exposure, collections, payments, obligations, variable compensation"),
  EQUIPO: tx("Capacidad, liderazgo, continuidad y soporte", "Capacity, leadership, continuity and support"),
};
export type Changed = { key: string; label: Txt; value: number; prev: number | null; unit: "usd" | "n" | "pct"; href: string | null; state: boolean; note: Txt | null };
export type Why = { key: string; kind: "FACT" | "INFERENCE"; headline: Txt; detail: Txt | null; href: string | null };
const WHY_AREA: Record<string, ReviewArea> = { "gap-low": "COMERCIAL", gap: "COMERCIAL", needs: "MERCADEO", present: "COMERCIAL", notinv: "OPERACIONES", overdue: "ADMINISTRACION" };
const GROUP: Record<string, string> = { MERCADEO: "mercado", COMERCIAL: "comercial", OPERACIONES: "operaciones", ADMINISTRACION: "administracion" };

export async function functionalReview(area: ReviewArea, period: string, u: { id: string; role: Role }) {
  const { start, end } = periodBounds(period), prevB = periodBounds(shiftPeriod(period, -1));
  const inP = { gte: start, lt: end }, inPrev = { gte: prevB.start, lt: prevB.end };
  const [needed, pending] = await Promise.all([
    neededItems(u),
    db.managementDecision.findMany({ where: { status: "DECIDED", supersededAt: null, area, decidedAt: inP }, orderBy: { decidedAt: "desc" }, select: { id: true, code: true, question: true, decision: true, decidedAt: true } }),
  ]);
  const decide: NeededItem[] = needed.filter((n) => n.area === area);
  const changed: Changed[] = [], why: Why[] = [];

  if (area === "EQUIPO") {
    const count = async (range: { gte: Date; lt: Date }) => {
      const [absDays, cov, gapsOpen, gapsDone, roles, joined] = await Promise.all([
        db.absenceRecord.findMany({ where: { status: "APPROVED", startsOn: { lt: range.lt }, endsOn: { gte: range.gte } }, select: { startsOn: true, endsOn: true } }),
        db.coverageAssignment.count({ where: { startsAt: range } }), db.supportGap.count({ where: { createdAt: range } }), db.supportGap.count({ where: { resolvedAt: range } }),
        db.personRoleAssignment.count({ where: { effectiveFrom: range } }), db.user.count({ where: { createdAt: range } }),
      ]);
      // Days away inside the period, whatever the kind of absence.
      const days = absDays.reduce((s, a) => s + Math.max(0, daysBetween(a.startsOn < range.gte ? range.gte : a.startsOn, a.endsOn >= range.lt ? addDays(range.lt, -1) : a.endsOn) + 1), 0);
      return { days, cov, gapsOpen, gapsDone, roles, joined };
    };
    const [c, p, people] = await Promise.all([count(inP), count(inPrev), peopleCapacity()]);
    const row = (key: string, es: string, en: string, v: number, pv: number, href: string): Changed => ({ key, label: tx(es, en), value: v, prev: pv, unit: "n", href, state: false, note: null });
    changed.push(row("days", "Días de ausencia aprobada", "Days of approved absence", c.days, p.days, "/administracion/personas"), row("cov", "Coberturas iniciadas", "Coverages started", c.cov, p.cov, "/comercial/cobertura"),
      row("gapsOpen", "Faltas de soporte registradas", "Support gaps raised", c.gapsOpen, p.gapsOpen, "/gerencia/personas#soporte"), row("gapsDone", "Faltas de soporte resueltas", "Support gaps resolved", c.gapsDone, p.gapsDone, "/gerencia/personas#soporte"),
      row("roles", "Cambios de cargo o rol", "Changes of position or role", c.roles, p.roles, "/administracion/personas"), row("joined", "Personas nuevas en SOLU", "New people in SOLU", c.joined, p.joined, "/admin/users"));
    if (people.uncovered.length) why.push({ key: "uncovered", kind: "FACT", headline: tx(`${people.uncovered.length} ausencia(s) aprobada(s) en los próximos 30 días no tienen quien cubra.`, `${people.uncovered.length} approved absence(s) in the next 30 days have nobody covering.`), detail: tx(people.uncovered.map((a) => a.name).join(", "), people.uncovered.map((a) => a.name).join(", ")), href: "/gerencia/personas#ausencias" });
    if (people.overload.length) why.push({ key: "overload", kind: "FACT", headline: tx(`${people.overload.length} persona(s) cubren a dos o más compañeros, o cubren estando ausentes.`, `${people.overload.length} person(s) cover two or more colleagues, or cover while away.`), detail: null, href: "/gerencia/personas#cobertura" });
    if (people.noBackup.length) why.push({ key: "nobackup", kind: "FACT", headline: tx(`${people.noBackup.length} relación(es) clave no tienen un respaldo válido.`, `${people.noBackup.length} key relationship(s) have no valid backup.`), detail: null, href: "/gerencia/personas#respaldo" });
    if (people.singleRoles.length) why.push({ key: "single", kind: "FACT", headline: tx(`${people.singleRoles.length} rol(es) tienen un solo titular o ninguno.`, `${people.singleRoles.length} role(s) have one holder or none.`), detail: null, href: "/gerencia/personas#roles" });
    return { area, period, changed, why, decide, decided: pending, asOf: new Date() };
  }

  const pulse = await computePulse(period);
  const { groups, prevOf } = pulseGroups(pulse);
  const g = groups.find((x) => x.key === GROUP[area])!;
  for (const m of g.metrics) changed.push({ key: m.key, label: m.label, value: m.value, prev: m.kind === "PERIOD" ? prevOf(m.key) : null, unit: m.unit, href: m.href ?? null, state: m.kind === "STATE", note: m.note ?? null });
  for (const i of await insightsFor(period)) if (WHY_AREA[i.key] === area) why.push({ key: i.key, kind: i.kind, headline: i.headline, detail: i.detail, href: i.href });

  if (area === "MERCADEO") {
    const [ws, sig, strat] = await Promise.all([
      db.whiteSpace.count({ where: { status: { in: ["OPEN", "EXPLORING"] } } }),
      db.marketSignal.groupBy({ by: ["kind"], where: { createdAt: inP }, _count: { _all: true } }),
      db.strategicAccount.count({ where: { active: true } }),
    ]);
    changed.push({ key: "ws", label: tx("Espacios en blanco abiertos hoy", "White spaces open today"), value: ws, prev: null, unit: "n", href: "/mercado", state: true, note: null }, { key: "strat", label: tx("Cuentas estratégicas elegidas", "Strategic accounts chosen"), value: strat, prev: null, unit: "n", href: "/gerencia/cuentas", state: true, note: null });
    const top = [...sig].sort((a, b) => b._count._all - a._count._all)[0];
    if (top) why.push({ key: "sig", kind: "FACT", headline: tx(`La señal más registrada del mes fue «${top.kind}»: ${top._count._all} vez(ces).`, `The most recorded signal this month was "${top.kind}": ${top._count._all} time(s).`), detail: null, href: "/mercado" });
  }
  if (area === "COMERCIAL") {
    const [exc, declined] = await Promise.all([
      db.esagaraException.groupBy({ by: ["status"], where: { requestedAt: inP }, _count: { _all: true } }),
      db.quote.count({ where: { status: "DECLINED", decidedAt: inP } }),
    ]);
    const n = exc.reduce((s, x) => s + x._count._all, 0), ok = exc.find((x) => x.status === "APPROVED")?._count._all ?? 0;
    changed.push({ key: "exc", label: tx("Excepciones de Eságara baja pedidas", "Low-Eságara exceptions requested"), value: n, prev: await db.esagaraException.count({ where: { requestedAt: inPrev } }), unit: "n", href: "/comercial/esagara", state: false, note: n ? tx(`${ok} aprobada(s)`, `${ok} approved`) : null });
    if (declined && pulse.cur.decisions) why.push({ key: "declined", kind: "FACT", headline: tx(`${declined} de ${pulse.cur.decisions} decisiones de clientes en el mes fueron «no».`, `${declined} of ${pulse.cur.decisions} customer decisions this month were "no".`), detail: tx("Las objeciones quedan en las presentaciones registradas.", "The objections are kept in the recorded presentations."), href: "/cotizaciones" });
  }
  if (area === "OPERACIONES") {
    const [kinds, savings] = await Promise.all([
      db.operationalException.groupBy({ by: ["kind"], where: { createdAt: inP }, _count: { _all: true } }),
      db.savingsEntry.aggregate({ where: { at: inP, currency: "USD" }, _sum: { savingsAmount: true } }),
    ]);
    const top = [...kinds].sort((a, b) => b._count._all - a._count._all)[0];
    if (top) why.push({ key: "kinds", kind: "FACT", headline: tx(`La excepción más repetida del mes fue «${top.kind}»: ${top._count._all} de ${pulse.cur.exceptionsOpened}.`, `The most repeated exception this month was "${top.kind}": ${top._count._all} of ${pulse.cur.exceptionsOpened}.`), detail: null, href: "/operaciones" });
    if (pulse.cur.withPromise > 0 && pulse.cur.onTime < pulse.cur.withPromise) why.push({ key: "late", kind: "FACT", headline: tx(`${pulse.cur.withPromise - pulse.cur.onTime} de ${pulse.cur.withPromise} entregas con fecha prometida llegaron después de la promesa.`, `${pulse.cur.withPromise - pulse.cur.onTime} of ${pulse.cur.withPromise} deliveries with a promised date arrived after the promise.`), detail: null, href: "/operaciones/metricas" });
    const sv = Number(savings._sum.savingsAmount ?? 0);
    if (sv) changed.push({ key: "savings", label: tx("Ahorros de compra registrados", "Purchase savings recorded"), value: sv, prev: null, unit: "usd", href: "/compras", state: false, note: null });
  }
  if (area === "ADMINISTRACION") {
    const T = today();
    const od = await db.invoice.findMany({ where: { dueAt: { lt: T } }, select: { accountId: true, account: { select: { name: true } }, amount: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } });
    const by = new Map<string, { name: string; usd: number }>();
    for (const i of od) { const c = invoiceCash(i); const b = c.balance - c.pendingReconcile; if (b > 0.005) { const x = by.get(i.accountId) ?? { name: i.account.name, usd: 0 }; x.usd = r2(x.usd + b); by.set(i.accountId, x); } }
    const top = [...by.values()].sort((a, b) => b.usd - a.usd).slice(0, 3), total = sumMoney([...by.values()].map((x) => x.usd));
    if (top.length && total > 0) why.push({ key: "odtop", kind: "FACT", headline: tx(`${top.length} cliente(s) concentran USD ${sumMoney(top.map((x) => x.usd)).toLocaleString("en-US")} de los USD ${total.toLocaleString("en-US")} vencidos.`, `${top.length} customer(s) hold USD ${sumMoney(top.map((x) => x.usd)).toLocaleString("en-US")} of the USD ${total.toLocaleString("en-US")} overdue.`), detail: tx(top.map((x) => `${x.name}: USD ${x.usd.toLocaleString("en-US")}`).join(" · "), top.map((x) => `${x.name}: USD ${x.usd.toLocaleString("en-US")}`).join(" · ")), href: "/administracion/cobrar" });
  }
  return { area, period, changed, why, decide, decided: pending, asOf: new Date() };
}

// ---------- §8 Policy & authority oversight (AC12) ----------

export async function policyOversight(now = today()) {
  const gpol = await getGerenciaPolicy();
  const from = addDays(now, -gpol.value.patternDays), recent = addDays(now, -90);
  const [settings, esagara, purchases, internal, credit, creditDeals, apExc, delegations, dealAuth, policyChange] = await Promise.all([
    db.marketSetting.findMany({ where: { key: { in: POLICY_REGISTER.map((r) => r.key) } }, orderBy: [{ key: "asc" }, { version: "desc" }], select: { key: true, version: true, updatedByName: true, reason: true, createdAt: true } }),
    db.esagaraException.findMany({ where: { requestedAt: { gte: from } }, orderBy: { requestedAt: "desc" }, select: { id: true, status: true, accountId: true, reasonCode: true, esagaraAmount: true, saleAmount: true, esagaraPct: true, requestedAt: true, requestedByName: true, decidedAt: true, decidedByName: true, quote: { select: { deal: { select: { code: true, account: { select: { name: true } } } } } } } }),
    db.purchaseApproval.findMany({ where: { requestedAt: { gte: from } }, orderBy: { requestedAt: "desc" }, select: { id: true, prId: true, status: true, level: true, reasons: true, amount: true, requestedAt: true, requestedByName: true, decidedAt: true, decidedByName: true, pr: { select: { code: true } } } }),
    db.internalPurchase.findMany({ where: { createdAt: { gte: from } }, orderBy: { createdAt: "desc" }, select: { id: true, code: true, description: true, status: true, level: true, amountUsd: true, overBudget: true, budgetId: true, budget: { select: { name: true } }, createdAt: true, decidedAt: true, decidedByName: true, requester: { select: { name: true } } } }),
    db.creditReviewRequest.findMany({ where: { createdAt: { gte: from } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, accountId: true, requestedLimit: true, approvedLimit: true, createdAt: true, decidedAt: true, account: { select: { name: true } }, decidedBy: { select: { name: true } }, requestedBy: { select: { name: true } } } }),
    db.deal.findMany({ where: { creditExceptionAt: { gte: from } }, select: { id: true, code: true, amount: true, accountId: true, creditExceptionAt: true, account: { select: { name: true } }, creditExceptionBy: { select: { name: true } } } }),
    db.supplierInvoice.findMany({ where: { exceptionAt: { gte: from } }, select: { id: true, number: true, amountUsd: true, supplierId: true, exceptionAt: true, exceptionByName: true, supplier: { select: { name: true } } } }),
    db.delegatedAuthority.findMany({ where: { createdAt: { gte: recent } }, orderBy: { createdAt: "desc" }, select: { id: true, domain: true, limitUsd: true, createdAt: true, approvedByName: true, endsAt: true, revokedAt: true, fromUser: { select: { name: true } }, toUser: { select: { name: true } } } }),
    db.dealAuthorization.findMany({ where: { createdAt: { gte: recent }, step: { in: ["GERENCIA", "MMS_MENTOR"] } }, orderBy: { createdAt: "desc" }, select: { id: true, dealId: true, amountUsd: true, step: true, authorizedBy: true, createdAt: true, deal: { select: { code: true, account: { select: { name: true } } } } } }),
    db.policyChangeRequest.findMany({ where: { status: "PENDING" }, select: { id: true, requestedByName: true, reason: true, requestedAt: true } }),
  ]);

  const versions = POLICY_REGISTER.map((r) => { const vs = settings.filter((s) => s.key === r.key); return { ...r, version: vs[0]?.version ?? 0, since: vs[0]?.createdAt ?? null, by: vs[0]?.updatedByName ?? null, reason: vs[0]?.reason ?? null, changesInWindow: vs.filter((v) => v.createdAt >= from).length }; });

  type Pending = { key: string; policy: Txt; what: string; usd: number | null; since: Date; who: string; href: string };
  const pending: Pending[] = [
    ...esagara.filter((e) => e.status === "REQUESTED" || e.status === "RETURNED").map((e) => ({ key: `e${e.id}`, policy: tx("Eságara baja", "Low Eságara"), what: `${e.quote.deal.code ?? ""} · ${e.quote.deal.account.name} · ${Number(e.esagaraPct).toFixed(2)} %`, usd: Number(e.saleAmount), since: e.requestedAt, who: e.requestedByName, href: `/comercial/esagara#e-${e.id}` })),
    ...purchases.filter((p) => p.status === "REQUESTED").map((p) => ({ key: `p${p.id}`, policy: tx("Autoridad de compras", "Purchase authority"), what: `${p.pr.code} · ${tx(`nivel ${p.level}`, `level ${p.level}`).es}`, usd: Number(p.amount), since: p.requestedAt, who: p.requestedByName, href: `/compras/requerimientos/${p.prId}` })),
    ...internal.filter((p) => p.status === "REQUESTED").map((p) => ({ key: `i${p.id}`, policy: tx("Compras internas y presupuesto", "Internal purchases and budget"), what: `${p.code} · ${p.description.slice(0, 80)}`, usd: Number(p.amountUsd), since: p.createdAt, who: p.requester.name, href: `/administracion/compras-internas/${p.id}` })),
    ...credit.filter((c) => c.status === "OPEN").map((c) => ({ key: `c${c.id}`, policy: tx("Crédito", "Credit"), what: c.account.name, usd: c.requestedLimit == null ? null : Number(c.requestedLimit), since: c.createdAt, who: c.requestedBy.name, href: "/administracion/cupos#solicitudes" })),
    ...policyChange.map((p) => ({ key: `pc${p.id}`, policy: tx("Números de Rentabilidad", "Profitability numbers"), what: p.reason.slice(0, 100), usd: null, since: p.requestedAt, who: p.requestedByName, href: "/profile/rentabilidad#pendiente" })),
  ].sort((a, b) => +a.since - +b.since);

  // Approvals that only the highest level could give, in the last 90 days.
  type Approval = { key: string; at: Date; what: Txt; usd: number | null; by: string; href: string };
  const approvals: Approval[] = [
    ...purchases.filter((p) => p.status === "APPROVED" && p.level >= 2 && p.decidedAt && p.decidedAt >= recent).map((p) => ({ key: `p${p.id}`, at: p.decidedAt!, what: tx(`Compra ${p.pr.code} de segundo nivel`, `Second-level purchase ${p.pr.code}`), usd: Number(p.amount), by: p.decidedByName ?? "", href: `/compras/requerimientos/${p.prId}` })),
    ...internal.filter((p) => p.status === "APPROVED" && (p.level >= 2 || p.overBudget != null) && p.decidedAt && p.decidedAt >= recent).map((p) => ({ key: `i${p.id}`, at: p.decidedAt!, what: p.overBudget != null ? tx(`Compra interna ${p.code} por encima del presupuesto`, `Internal purchase ${p.code} above budget`) : tx(`Compra interna ${p.code} de segundo nivel`, `Second-level internal purchase ${p.code}`), usd: Number(p.amountUsd), by: p.decidedByName ?? "", href: `/administracion/compras-internas/${p.id}` })),
    ...esagara.filter((e) => e.status === "APPROVED" && e.decidedAt && e.decidedAt >= recent).map((e) => ({ key: `e${e.id}`, at: e.decidedAt!, what: tx(`Eságara de ${Number(e.esagaraPct).toFixed(2)} % para ${e.quote.deal.account.name}`, `Eságara of ${Number(e.esagaraPct).toFixed(2)} % for ${e.quote.deal.account.name}`), usd: Number(e.saleAmount), by: e.decidedByName ?? "", href: `/comercial/esagara#e-${e.id}` })),
    ...credit.filter((c) => c.status === "APPROVED" && c.decidedAt && c.decidedAt >= recent).map((c) => ({ key: `c${c.id}`, at: c.decidedAt!, what: tx(`Crédito de ${c.account.name}`, `Credit of ${c.account.name}`), usd: c.approvedLimit == null ? null : Number(c.approvedLimit), by: c.decidedBy?.name ?? "", href: `/accounts/${c.accountId}` })),
    ...creditDeals.filter((d) => d.creditExceptionAt! >= recent).map((d) => ({ key: `x${d.id}`, at: d.creditExceptionAt!, what: tx(`Excepción de cupo para ${d.code ?? ""} · ${d.account.name}`, `Credit exception for ${d.code ?? ""} · ${d.account.name}`), usd: Number(d.amount), by: d.creditExceptionBy?.name ?? "", href: `/deals/${d.id}` })),
    ...delegations.map((d) => ({ key: `d${d.id}`, at: d.createdAt, what: tx(`Autoridad prestada de ${d.fromUser.name} a ${d.toUser.name} (${d.domain})`, `Authority lent by ${d.fromUser.name} to ${d.toUser.name} (${d.domain})`), usd: d.limitUsd == null ? null : Number(d.limitUsd), by: d.approvedByName, href: "/administracion/autoridad" })),
    ...dealAuth.map((a) => ({ key: `a${a.id}`, at: a.createdAt, what: tx(`Autorización de negocio ${a.deal.code ?? ""} · ${a.deal.account.name}`, `Deal authorisation ${a.deal.code ?? ""} · ${a.deal.account.name}`), usd: Number(a.amountUsd), by: a.authorizedBy, href: `/deals/${a.dealId}` })),
  ].sort((a, b) => +b.at - +a.at).slice(0, 25);

  // The same exception again and again: a question about the policy (AC12).
  const rows: ExceptionRow[] = [
    ...esagara.map((e) => ({ policy: "comPolicy", group: `acc:${e.accountId}`, label: `Eságara baja · ${e.quote.deal.account.name}`, at: e.requestedAt, href: `/comercial/esagara#e-${e.id}`, usd: Number(e.saleAmount) })),
    ...esagara.map((e) => ({ policy: "comPolicy", group: `reason:${e.reasonCode}`, label: `Eságara baja · motivo ${e.reasonCode}`, at: e.requestedAt, href: `/comercial/esagara#e-${e.id}`, usd: Number(e.saleAmount) })),
    ...purchases.flatMap((p) => (Array.isArray(p.reasons) ? p.reasons : []).map((r) => ({ policy: "purchasePolicy", group: `reason:${String(r)}`, label: `Compras · ${REASON_TEXT[r as Reason]?.es ?? String(r)}`, at: p.requestedAt, href: `/compras/requerimientos/${p.prId}`, usd: Number(p.amount) }))),
    ...credit.map((c) => ({ policy: "payRules", group: `acc:${c.accountId}`, label: `Crédito · ${c.account.name}`, at: c.createdAt, href: `/accounts/${c.accountId}`, usd: c.requestedLimit == null ? null : Number(c.requestedLimit) })),
    ...creditDeals.map((d) => ({ policy: "payRules", group: `acc:${d.accountId}`, label: `Crédito · ${d.account.name}`, at: d.creditExceptionAt!, href: `/deals/${d.id}`, usd: Number(d.amount) })),
    ...internal.filter((p) => p.overBudget != null).map((p) => ({ policy: "adminPolicy", group: `budget:${p.budgetId ?? "none"}`, label: `Presupuesto superado · ${p.budget?.name ?? "sin presupuesto"}`, at: p.createdAt, href: `/administracion/compras-internas/${p.id}`, usd: Number(p.overBudget) })),
    ...apExc.map((x) => ({ policy: "adminPolicy", group: `sup:${x.supplierId}`, label: `Factura de proveedor con diferencia aceptada · ${x.supplier.name}`, at: x.exceptionAt!, href: "/administracion/pagar#facturas", usd: x.amountUsd == null ? null : Number(x.amountUsd) })),
  ];
  const patterns = recurring(rows, gpol.value, now).map((p) => ({ ...p, policyName: POLICY_REGISTER.find((r) => r.key === p.policy) ?? null }));
  return { asOf: new Date(), policy: gpol, versions, pending, approvals, patterns, counted: rows.length };
}

// ---------- §20 System performance: the capacity of the system, apart from the result ----------

export type PerfRow = { key: string; dimension: Txt; title: Txt; how: Txt; unit: "pct" | "n" | "days"; cur: number | null; base: number | null; trend: Trend; sample: Txt; href: string };
const WINDOW = 90, BASE_WINDOWS = 3, MIN = 5;

async function perfWindow(from: Date, to: Date) {
  const r = { gte: from, lt: to };
  const [needs, futures, presented, presentedRec, decided, deliveries, invoices, absences, coverages] = await Promise.all([
    db.deal.count({ where: { internal: false, createdAt: r, desiredResult: { not: null }, NOT: { desiredResult: "" } } }),
    db.futureOpportunity.count({ where: { createdAt: r } }),
    db.quote.count({ where: { presentedAt: r, status: { not: "DRAFT" }, deal: { internal: false } } }),
    db.quote.count({ where: { presentedAt: r, status: { not: "DRAFT" }, deal: { internal: false }, presentations: { some: {} } } }),
    db.quote.findMany({ where: { decidedAt: r, status: { in: ["ACCEPTED", "DECLINED"] }, deal: { internal: false } }, select: { status: true, protSale: true, protEsagra: true } }),
    db.delivery.findMany({ where: { deliveredAt: r, deal: { internal: false, promisedDate: { not: null } } }, select: { deliveredAt: true, deal: { select: { promisedDate: true } } } }),
    db.invoice.findMany({ where: { applications: { some: { payment: { receivedAt: r } } } }, select: { amount: true, issuedAt: true, applications: { select: { amount: true, payment: { select: { receivedAt: true } } } } } }),
    db.absenceRecord.findMany({ where: { status: "APPROVED", startsOn: { lt: to }, endsOn: { gte: from } }, select: { startsOn: true, endsOn: true } }),
    db.coverageAssignment.count({ where: { startsAt: r } }),
  ]);
  const acc = decided.filter((q) => q.status === "ACCEPTED");
  const payDays = invoices.filter((i) => sumMoney(i.applications.map((a) => a.amount)) >= Number(i.amount) - 0.005).map((i) => { const last = i.applications.map((a) => a.payment.receivedAt).sort((a, b) => +b - +a)[0]; return last >= from && last < to ? Math.max(0, daysBetween(i.issuedAt, last)) : null; }).filter((x): x is number => x != null);
  const absDays = absences.reduce((s, a) => s + Math.max(0, daysBetween(a.startsOn < from ? from : a.startsOn, a.endsOn >= to ? addDays(to, -1) : a.endsOn) + 1), 0);
  return { needs, futures, presented, presentedRec, decided: decided.length, accepted: acc.length, sale: sumMoney(acc.map((q) => q.protSale)), esagara: sumMoney(acc.map((q) => q.protEsagra)), delivered: deliveries.length, onTime: deliveries.filter((d) => +d.deliveredAt <= +d.deal.promisedDate! + 864e5 - 1).length, payDays, absDays, coverages };
}

/** The last 90 days against the 270 before them. A learning baseline: it says whether the system got better at each
 *  step, with the cases behind it, and says "too little data" instead of guessing. No person is compared or graded. */
export async function systemPerformance(now = today()) {
  const end = addDays(now, 1), mid = addDays(end, -WINDOW), start = addDays(mid, -WINDOW * BASE_WINDOWS);
  const [c, b] = await Promise.all([perfWindow(mid, end), perfWindow(start, mid)]);
  const per = (n: number) => Math.round((n / BASE_WINDOWS) * 10) / 10;
  const countTrend = (cur: number, base: number): Trend => (cur + base < MIN ? "THIN" : base === 0 ? "UP" : Math.abs(cur - base) / base < 0.2 ? "SAME" : cur > base ? "UP" : "DOWN");
  const rate = (key: string, dimension: Txt, title: Txt, how: Txt, cn: number, cd: number, bn: number, bd: number, href: string, samples = { c: cd, b: bd }): PerfRow => {
    const t = trendOf({ num: cn, den: cd }, { num: bn, den: bd }, MIN);
    const thin = samples.c < MIN || samples.b < MIN;
    return { key, dimension, title, how, unit: "pct", cur: t.cur, base: t.base, trend: thin ? "THIN" : t.trend, sample: tx(`${samples.c} caso(s) ahora, ${samples.b} antes`, `${samples.c} case(s) now, ${samples.b} before`), href };
  };
  const count = (key: string, dimension: Txt, title: Txt, how: Txt, cur: number, base: number, href: string): PerfRow => ({ key, dimension, title, how, unit: "n", cur, base: per(base), trend: countTrend(cur, per(base)), sample: tx(`${cur} en 90 días; antes ${base} en 270 (${per(base)} por cada 90)`, `${cur} in 90 days; before ${base} in 270 (${per(base)} per 90)`), href });
  const pay = compareDays(c.payDays, b.payDays);
  const D = { gen: tx("Generación", "Generation"), conv: tx("Conversión", "Conversion"), val: tx("Valor", "Value"), ful: tx("Cumplimiento", "Fulfilment"), col: tx("Cobro", "Collection"), ppl: tx("Capacidad de personas", "People capacity") };
  const rows: PerfRow[] = [
    count("needs", D.gen, tx("Necesidades escritas", "Needs written"), tx("Journeys creados con el resultado que busca el cliente.", "Journeys created with the result the customer wants."), c.needs, b.needs, "/deals"),
    count("futures", D.gen, tx("Oportunidades futuras identificadas", "Future opportunities identified"), tx("Registradas en Mercado.", "Recorded in Market."), c.futures, b.futures, "/mercado"),
    rate("present", D.conv, tx("Cotizaciones presentadas, no solo enviadas", "Quotes presented, not only sent"), tx("Presentadas con presentación registrada ÷ presentadas.", "Presented with a recorded presentation ÷ presented."), c.presentedRec, c.presented, b.presentedRec, b.presented, "/cotizaciones"),
    rate("win", D.conv, tx("Decisiones que fueron «sí»", "Decisions that were \"yes\""), tx("Aceptadas ÷ decididas por el cliente.", "Accepted ÷ decided by the customer."), c.accepted, c.decided, b.accepted, b.decided, "/cotizaciones"),
    rate("esagara", D.val, tx("Eságara % en lo aceptado", "Eságara % on accepted business"), tx("Eságara protegida ÷ venta de las cotizaciones aceptadas.", "Protected Eságara ÷ sale of accepted quotes."), c.esagara, c.sale, b.esagara, b.sale, "/gerencia/rentabilidad", { c: c.accepted, b: b.accepted }),
    rate("ontime", D.ful, tx("Entregas dentro de la promesa", "Deliveries within the promise"), tx("Entregadas a tiempo ÷ entregadas con fecha prometida.", "Delivered on time ÷ delivered with a promised date."), c.onTime, c.delivered, b.onTime, b.delivered, "/operaciones/metricas"),
    { key: "paydays", dimension: D.col, title: tx("Días de factura a cobro (mediana)", "Days from invoice to payment (median)"), how: tx("Facturas pagadas por completo en la ventana. Menos días es mejor.", "Invoices paid in full within the window. Fewer days is better."), unit: "days", cur: pay.cur, base: pay.base, trend: pay.verdict === "THIN" ? "THIN" : pay.verdict === "SAME" ? "SAME" : pay.verdict === "BETTER" ? "DOWN" : "UP", sample: tx(`${pay.n} factura(s) ahora, ${pay.nBase} antes`, `${pay.n} invoice(s) now, ${pay.nBase} before`), href: "/administracion/cobrar" },
    count("absence", D.ppl, tx("Días de ausencia aprobada", "Days of approved absence"), tx("Días de calendario dentro de la ventana, de cualquier tipo.", "Calendar days inside the window, of any kind."), c.absDays, b.absDays, "/gerencia/personas"),
    count("coverage", D.ppl, tx("Coberturas iniciadas", "Coverages started"), tx("Veces que alguien tomó el trabajo de un compañero ausente.", "Times someone took over an absent colleague's work."), c.coverages, b.coverages, "/comercial/cobertura"),
  ];
  return { asOf: new Date(), from: mid, to: now, baseFrom: start, rows, lowerIsBetter: new Set(["paydays", "absence"]), neutral: new Set(["coverage", "absence"]) };
}

// ---------- §13 By selling company (AC19) ----------

/** The same four figures for each company that sells: what was accepted this month, what is contracted and not
 *  invoiced, what is owed to it, and how many Journeys are open. A Journey belongs to the company that sells it. */
export async function entityBreakdown(period: string) {
  const { start, end } = periodBounds(period);
  const [sellers, accepted, contracted, invoices, open] = await Promise.all([
    db.sellingEntity.findMany({ select: { key: true, legalName: true, active: true } }),
    db.quote.findMany({ where: { status: "ACCEPTED", decidedAt: { gte: start, lt: end }, deal: { internal: false } }, select: { protSale: true, protEsagra: true, deal: { select: { sellerKey: true } } } }),
    db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, stage: { not: "LOST" } }, select: { sellerKey: true, quotes: { where: { status: "ACCEPTED" }, orderBy: { decidedAt: "desc" }, take: 1, select: { protSale: true } }, invoices: { select: { amount: true } } } }),
    db.invoice.findMany({ where: { deal: { internal: false } }, select: { amount: true, deal: { select: { sellerKey: true } }, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
    db.deal.groupBy({ by: ["sellerKey"], where: { internal: false, stage: { notIn: ["WON", "LOST"] } }, _count: { _all: true } }),
  ]);
  const keys = [...new Set([...sellers.filter((s) => s.active).map((s) => s.key), ...accepted.map((q) => q.deal.sellerKey), ...contracted.map((d) => d.sellerKey), ...open.map((g) => g.sellerKey)])].sort((a, b) => (a === "USA" ? -1 : b === "USA" ? 1 : a.localeCompare(b)));
  return keys.map((key) => {
    const acc = accepted.filter((q) => q.deal.sellerKey === key);
    const toInvoice = contracted.filter((d) => d.sellerKey === key).reduce((s, d) => s + Math.max(0, Number(d.quotes[0]?.protSale ?? 0) - sumMoney(d.invoices.map((i) => i.amount))), 0);
    const owed = invoices.filter((i) => i.deal.sellerKey === key).reduce((s, i) => { const c = invoiceCash(i); return s + Math.max(0, c.balance - c.pendingReconcile); }, 0);
    const sale = sumMoney(acc.map((q) => q.protSale)), esagara = sumMoney(acc.map((q) => q.protEsagra));
    return { key, name: sellers.find((s) => s.key === key)?.legalName || key, active: sellers.find((s) => s.key === key)?.active ?? false, sale, esagara, pct: sale > 0 ? sharePct(esagara, sale) : null, toInvoice: r2(toInvoice), outstanding: r2(owed), open: open.find((g) => g.sellerKey === key)?._count._all ?? 0 };
  });
}
export type EntityRow = Awaited<ReturnType<typeof entityBreakdown>>[number];
