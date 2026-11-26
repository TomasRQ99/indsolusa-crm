"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addWorkingDays } from "@/lib/holidays";
import {
  PROSPECTS, budgetLines, defaultAssumptions, departs, isEditable, parseMillions, parsePct, readAssumptions, suggest, sum,
  ASSUMPTION_KEYS, type Assumptions,
} from "@/lib/sales-budget-rules";
import { approverIdsOf, basisFor, basisPick, budgetScope, budgetYears, canWriteBudget, loadFacts, matrixOf } from "@/lib/sales-budget";

// Presupuesto comercial · writes. Flow (spec §6): Sin iniciar → Borrador → Enviado → Devuelto / Aprobado → Vigente.
// The negotiator (or Gerencia / Dirección Comercial for them) writes; only the assigned leader approves; an approved
// version never changes: a correction is a new version with its reason. Every step leaves an event with who and when.

const BASE = "/comercial/presupuesto";
const pageOf = (slot: string, year: number, userId: string, qs = "", hash = "") => `${BASE}/${slot === PROSPECTS ? "prospectos" : slot}?y=${year}&u=${userId}${qs ? `&${qs}` : ""}${hash}`;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max) || null;
const annual = (b: { lines: { month: number; kpi: string; value: unknown }[] } | null) => { const m = matrixOf(b as never); return { OC_COP: sum(m.OC_COP), FACT_COP: sum(m.FACT_COP), ESA_COP: sum(m.ESA_COP) }; };

/** Saves the proposal as a draft; with `send`, also sends it to approval when it is complete. The draft is always
 *  saved first, so a proposal that cannot be sent yet never loses what was typed. */
export async function saveBudget(year: number, slot: string, userId: string, send: boolean, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string, hash = ""): never => { refreshApp(); redirect(pageOf(slot, year, userId, qs, hash)); };
  if (!canWriteBudget(user, userId)) back("err=permiso");
  if (!budgetYears(new Date()).years.includes(year)) back("err=anio");
  const [person, account, versions] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { active: true } }),
    slot === PROSPECTS ? null : db.account.findUnique({ where: { id: slot }, select: { id: true, ownerId: true, internal: true } }),
    db.salesBudget.findMany({ where: { year, slot, userId }, orderBy: { version: "desc" }, include: { lines: true } }),
  ]);
  if (!person?.active) back("err=persona");
  if (slot !== PROSPECTS && (!account || account.internal)) back("err=empresa");
  const current = versions[0] ?? null;
  if (current && !isEditable(current.state)) back(current.state === "SUBMITTED" ? "err=enviado" : "err=aprobado");

  const es = user.lang === "ES";
  const oc: number[] = [], fact: number[] = [], ocN: (number | null)[] = [];
  for (let m = 1; m <= 12; m++) {
    const a = parseMillions(fd.get(`oc_${m}`), es), f = parseMillions(fd.get(`fact_${m}`), es);
    const rawN = String(fd.get(`ocn_${m}`) ?? "").trim();
    const n = rawN === "" ? null : Number(rawN);
    if (Number.isNaN(a) || Number.isNaN(f) || (a ?? 0) < 0 || (f ?? 0) < 0 || (a ?? 0) > 1e13 || (f ?? 0) > 1e13) back("err=valor", "#propuesta");
    if (n != null && (!Number.isInteger(n) || n < 0 || n > 100000)) back("err=numero", "#propuesta");
    oc.push(a ?? 0); fact.push(f ?? 0); ocN.push(n);
  }

  // What SOLU itself would suggest today for this company and person: the reference every month is compared with.
  const others = slot === PROSPECTS ? [] : (await db.salesBudget.findMany({ where: { year, slot }, distinct: ["userId"], orderBy: { createdAt: "asc" }, select: { userId: true } })).map((b) => b.userId);
  const set = await loadFacts(slot === PROSPECTS ? { ownerIds: [userId] } : { accountIds: [slot], ownerIds: [userId] });
  const now = new Date();
  const basis = slot === PROSPECTS ? basisFor(set, year, now, () => false, (f) => f.ownerId === userId) : basisFor(set, year, now, basisPick(slot, userId, account!.ownerId, others), (f) => f.ownerId === userId);
  const start = defaultAssumptions(basis);
  const pureOc = suggest(basis.ocClose, 0, basis.seasonOc, start.season), pureFact = suggest(basis.factClose, 0, basis.seasonFact, basis.seasonFact ? "PROPIA" : "PAREJA");

  const typed: Record<string, unknown> = { season: fd.get("season") };
  for (const k of ASSUMPTION_KEYS) {
    const raw = fd.get(k);
    const v = k === "ticket" ? parseMillions(raw, es) : parsePct(raw);
    if (Number.isNaN(v)) back("err=supuesto", "#supuestos");
    typed[k] = v;
  }
  const a: Assumptions = readAssumptions(typed, { ...start, ticket: null, convSC: null, bateoN: null, bateoV: null, marginPct: null });
  a.manual = ASSUMPTION_KEYS.filter((k) => a[k] !== start[k]);

  const lines = budgetLines(oc, fact, ocN, a, pureOc, pureFact);
  const data = { assumptions: a, potential: ["ALTO", "MEDIO", "BAJO"].includes(String(fd.get("potential"))) ? String(fd.get("potential")) : null, strategy: clean(fd.get("strategy"), 2000), justification: clean(fd.get("justification"), 2000) };
  const before = annual(current);
  const after = { OC_COP: sum(oc), FACT_COP: sum(fact), ESA_COP: sum(lines.filter((l) => l.kpi === "ESA_COP").map((l) => l.value)) };
  const changed = !current || before.OC_COP !== after.OC_COP || before.FACT_COP !== after.FACT_COP || before.ESA_COP !== after.ESA_COP;

  const id = await db.$transaction(async (tx) => {
    const b = current
      ? await tx.salesBudget.update({ where: { id: current.id }, data })
      : await tx.salesBudget.create({ data: { year, slot, accountId: slot === PROSPECTS ? null : slot, userId, version: 1, state: "DRAFT", createdByName: user.name, ...data } });
    await tx.salesBudgetLine.deleteMany({ where: { budgetId: b.id } });
    await tx.salesBudgetLine.createMany({ data: lines.map((l) => ({ budgetId: b.id, ...l })) });
    if (!current) await tx.salesBudgetEvent.create({ data: { budgetId: b.id, kind: "CREATED", byId: user.id, byName: user.name, detail: { after } } });
    else if (changed) await tx.salesBudgetEvent.create({ data: { budgetId: b.id, kind: "SAVED", byId: user.id, byName: user.name, detail: { before, after } } });
    return b.id;
  });
  if (!send) back("ok=guardado", "#propuesta");

  // Completeness before sending: a goal above zero, and the reason when the figures are not SOLU's own suggestion.
  if (after.OC_COP + after.FACT_COP <= 0) back("err=vacio", "#propuesta");
  if (departs(oc, fact, pureOc, pureFact) && !data.justification) back("err=justificacion", "#justificacion");
  const approvers = await approverIdsOf(userId);
  if (!approvers.ids.length) back("err=sin-aprobador", "#aprobacion");
  await db.$transaction([
    db.salesBudget.update({ where: { id }, data: { state: "SUBMITTED", submittedAt: new Date(), submittedByName: user.name, decidedAt: null, decidedById: null, decidedByName: null, decisionNote: null, reconcileNote: null, reconcileByName: null, reconcileAt: null } }),
    db.salesBudgetEvent.create({ data: { budgetId: id, kind: "SUBMITTED", byId: user.id, byName: user.name, detail: { after } } }),
  ]);
  back("ok=enviado", "#aprobacion");
}

async function loadForDecision(id: string) {
  const user = await requireUser();
  const b = await db.salesBudget.findUnique({ where: { id }, include: { lines: true } });
  if (!b) redirect(BASE);
  const back = (qs: string, hash = "#aprobacion"): never => { refreshApp(); redirect(pageOf(b!.slot, b!.year, b!.userId, qs, hash)); };
  return { user, b: b!, back };
}

/** The assigned leader approves or returns a proposal that was sent. Returning needs the reason. */
export async function decideBudget(id: string, approve: boolean, fd: FormData) {
  const { user, b, back } = await loadForDecision(id);
  const approvers = await approverIdsOf(b.userId);
  if (!approvers.ids.includes(user.id)) back("err=no-aprueba");
  if (b.state !== "SUBMITTED") back("err=estado");
  const note = clean(fd.get("note"), 1000);
  if (!approve && !note) back("err=motivo-devolver");
  const now = new Date();
  const figures = annual(b);
  await db.$transaction(async (tx) => {
    if (approve) {
      // The version in force until now stays in the history, marked as replaced.
      await tx.salesBudget.updateMany({ where: { year: b.year, slot: b.slot, userId: b.userId, state: "APPROVED", supersededAt: null, id: { not: b.id } }, data: { supersededAt: now } });
    }
    await tx.salesBudget.update({ where: { id: b.id }, data: { state: approve ? "APPROVED" : "RETURNED", decidedAt: now, decidedById: user.id, decidedByName: user.name, decisionNote: note } });
    await tx.salesBudgetEvent.create({ data: { budgetId: b.id, kind: approve ? "APPROVED" : "RETURNED", byId: user.id, byName: user.name, note, detail: { after: figures } } });
  });
  back(approve ? "ok=aprobado" : "ok=devuelto");
}

/** The negotiator takes back a proposal that nobody has decided yet, to keep working on it. */
export async function withdrawBudget(id: string) {
  const { user, b, back } = await loadForDecision(id);
  if (!canWriteBudget(user, b.userId)) back("err=permiso");
  if (b.state !== "SUBMITTED") back("err=estado");
  await db.$transaction([
    db.salesBudget.update({ where: { id: b.id }, data: { state: "DRAFT", submittedAt: null, submittedByName: null } }),
    db.salesBudgetEvent.create({ data: { budgetId: b.id, kind: "WITHDRAWN", byId: user.id, byName: user.name } }),
  ]);
  back("ok=retirado", "#propuesta");
}

/** Correcting an approved budget: a new version, with the reason, that starts as a copy. The approved one stays
 *  official and unchanged until the new one is approved (AT-10). */
export async function newVersion(id: string, fd: FormData) {
  const { user, b, back } = await loadForDecision(id);
  if (!canWriteBudget(user, b.userId)) back("err=permiso");
  if (b.state !== "APPROVED" || b.supersededAt) back("err=estado");
  const reason = clean(fd.get("reason"), 1000);
  if (!reason) back("err=motivo-version", "#version");
  const later = await db.salesBudget.findFirst({ where: { year: b.year, slot: b.slot, userId: b.userId, version: { gt: b.version } }, select: { id: true } });
  if (later) back("err=ya-hay-version");
  await db.$transaction(async (tx) => {
    const n = await tx.salesBudget.create({ data: { year: b.year, slot: b.slot, accountId: b.accountId, userId: b.userId, version: b.version + 1, state: "DRAFT", assumptions: b.assumptions ?? {}, potential: b.potential, strategy: b.strategy, justification: b.justification, versionReason: reason, createdByName: user.name } });
    await tx.salesBudgetLine.createMany({ data: b.lines.map((l) => ({ budgetId: n.id, month: l.month, kpi: l.kpi, value: l.value, suggested: l.suggested, origin: l.origin })) });
    await tx.salesBudgetEvent.create({ data: { budgetId: n.id, kind: "NEW_VERSION", byId: user.id, byName: user.name, note: reason, detail: { before: annual(b) } } });
  });
  back("ok=version", "#propuesta");
}

/** Drops a draft that was never sent (for example a new version started by mistake). */
export async function discardDraft(id: string) {
  const { user, b } = await loadForDecision(id);
  const to = (qs: string): never => { refreshApp(); redirect(pageOf(b.slot, b.year, b.userId, qs)); };
  if (!canWriteBudget(user, b.userId)) to("err=permiso");
  const sent = await db.salesBudgetEvent.count({ where: { budgetId: b.id, kind: "SUBMITTED" } });
  if (b.state !== "DRAFT" || sent > 0) to("err=estado");
  await db.salesBudget.delete({ where: { id: b.id } });
  to("ok=descartado");
}

/** Dirección Comercial or Gerencia ask to reconcile a budget with the company objective. Nothing is changed for
 *  the negotiator: the request stays visible until a new proposal is sent. */
export async function askReconcile(id: string, fd: FormData) {
  const { user, b, back } = await loadForDecision(id);
  if (!canManageAll(user)) back("err=permiso");
  const note = clean(fd.get("note"), 1000);
  if (!note) back("err=motivo-conciliar", "#conciliar");
  await db.$transaction([
    db.salesBudget.update({ where: { id: b.id }, data: { reconcileNote: note, reconcileByName: user.name, reconcileAt: new Date() } }),
    db.salesBudgetEvent.create({ data: { budgetId: b.id, kind: "RECONCILE", byId: user.id, byName: user.name, note } }),
  ]);
  back("ok=conciliar");
}

/** The company objective of the year (annual, pesos). It only shows the gap: it never changes anyone's goals. */
export async function saveCorporate(year: number, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`${BASE}/consolidacion?y=${year}&${qs}#objetivo`); };
  if (!canManageAll(user)) back("err=permiso");
  if (!budgetYears(new Date()).years.includes(year)) back("err=anio");
  const es = user.lang === "ES";
  const corporate: Record<string, number> = {};
  for (const k of ["OC_COP", "FACT_COP", "ESA_COP"]) {
    const v = parseMillions(fd.get(k), es);
    if (Number.isNaN(v) || (v ?? 0) < 0 || (v ?? 0) > 1e15) back("err=valor");
    if (v) corporate[k] = v;
  }
  await db.salesBudgetYear.upsert({ where: { year }, create: { year, corporate, corporateByName: user.name, corporateAt: new Date() }, update: { corporate, corporateByName: user.name, corporateAt: new Date() } });
  back("ok=objetivo");
}

/** Publishes the year: from here the approved budgets are the official ones in force ("Vigente"). */
export async function publishYear(year: number) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`${BASE}/consolidacion?y=${year}&${qs}#publicar`); };
  if (!canManageAll(user)) back("err=permiso");
  const approved = await db.salesBudget.count({ where: { year, state: "APPROVED", supersededAt: null } });
  if (!approved) back("err=nada-aprobado");
  await db.salesBudgetYear.upsert({ where: { year }, create: { year, publishedAt: new Date(), publishedByName: user.name }, update: { publishedAt: new Date(), publishedByName: user.name } });
  back("ok=publicado");
}

/** Radar → a to-do for the negotiator, with a date, on the company (spec §8: owner, date and follow-up in SOLU). */
export async function radarTask(year: number, fd: FormData) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`${BASE}/cumplimiento?y=${year}&${qs}#radar`); };
  const assigneeId = String(fd.get("assigneeId") ?? ""), accountId = String(fd.get("accountId") ?? "") || null;
  const title = clean(fd.get("title"), 200);
  const scope = await budgetScope(user);
  if (!scope.all && !scope.ids.has(assigneeId)) back("err=permiso");
  const [person, account] = await Promise.all([db.user.findUnique({ where: { id: assigneeId }, select: { active: true } }), accountId ? db.account.findUnique({ where: { id: accountId }, select: { id: true } }) : null]);
  if (!person?.active || !title || (accountId && !account)) back("err=tarea");
  const rawDue = String(fd.get("due") ?? "");
  const due = /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? new Date(`${rawDue}T00:00:00Z`) : addWorkingDays(new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"), 2);
  await db.task.create({ data: { title: title!, dueDate: due, assigneeId, accountId } });
  back("ok=tarea");
}
