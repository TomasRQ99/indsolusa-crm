"use server";

import { redirect } from "next/navigation";
import type { Prisma, ResultState } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { assertCanEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { CAUSE_KEYS } from "@/lib/causes";
import { closureChecks, EVIDENCE_KINDS, optionsOf, resultInclude, STANCES, stanceFor, type RecoveryOption } from "@/lib/result";

const dayOf = (s: FormDataEntryValue | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${String(s)}T00:00:00Z`) : null);
const txt = (fd: FormData, k: string, max = 500) => {
  const v = String(fd.get(k) ?? "").trim().slice(0, max);
  return v || null;
};
const back = (dealId: string, qs: string, hash = ""): never => {
  refreshApp();
  redirect(`/deals/${dealId}/resultado?${qs}${hash}`);
};
const STATES: ResultState[] = ["PARTIAL", "ACHIEVED", "NOT_ACHIEVED", "NO_LONGER_RELEVANT"];

async function loadDeal(dealId: string) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: resultInclude });
  assertCanEdit(user, deal.ownerId);
  return { user, deal, i: makeI18n(user.lang) };
}
const fact = (userId: string, deal: { id: string; accountId: string }, subject: string, source: string | null = null) =>
  db.activity.create({ data: { type: "NOTE", subject: subject.slice(0, 200), userId, accountId: deal.accountId, dealId: deal.id, phase: "result", source } });

/** Confirm the customer's result. Always with evidence; delivery alone never makes it "achieved". */
export async function confirmResult(dealId: string, fd: FormData) {
  const { user, deal, i } = await loadDeal(dealId);
  if (deal.closedAt) back(dealId, "err=cerrado");
  const state = String(fd.get("state")) as ResultState;
  if (!STATES.includes(state)) back(dealId, "err=estado");
  const evText = txt(fd, "evText");
  const evWho = txt(fd, "evWho", 120);
  const evKind = (EVIDENCE_KINDS as readonly string[]).includes(String(fd.get("evKind"))) ? String(fd.get("evKind")) : "CUSTOMER";
  if (!evText || (state !== "NO_LONGER_RELEVANT" && !evWho)) back(dealId, "err=evidencia");
  const open = deal.recoveries.filter((r) => !r.resolvedAt);
  if (state === "ACHIEVED" && open.length) back(dealId, "err=recovery-abierta");
  const actualResult = txt(fd, "actualResult") ?? (state === "NO_LONGER_RELEVANT" ? evText : null);
  if (!actualResult) back(dealId, "err=real");
  const now = new Date();
  await db.$transaction([
    db.resultEvidence.create({ data: { dealId, kind: evKind, stance: stanceFor(state), text: evText!, who: evWho, source: txt(fd, "evSource", 200), at: dayOf(fd.get("evDate")) ?? today(), recordedByName: user.name } }),
    db.deal.update({
      where: { id: dealId },
      data: {
        resultState: state,
        actualResult,
        resultNote: actualResult,
        reliefNote: txt(fd, "relief"),
        resultPendingNote: state === "PARTIAL" ? txt(fd, "pending") : null,
        resultConfirmedAt: now,
        resultConfirmedByName: user.name,
        resultAchievedAt: state === "ACHIEVED" ? deal.resultAchievedAt ?? now : null,
      },
    }),
  ]);
  await fact(user.id, deal, i.t(`Resultado del cliente: ${state}`, `Customer result: ${state}`), evWho);
  // Arrived but didn't solve (or only partly): Recovery comes next, with impact and options.
  if ((state === "NOT_ACHIEVED" || state === "PARTIAL") && !open.length) back(dealId, "ok=abrir-recovery&recovery=1", "#recovery");
  back(dealId, `ok=resultado-${state.toLowerCase()}`);
}

export async function addEvidence(dealId: string, fd: FormData) {
  const { user, deal } = await loadDeal(dealId);
  const text = txt(fd, "text");
  if (!text) back(dealId, "err=evidencia");
  const kind = (EVIDENCE_KINDS as readonly string[]).includes(String(fd.get("kind"))) ? String(fd.get("kind")) : "CUSTOMER";
  const stance = (STANCES as readonly string[]).includes(String(fd.get("stance"))) ? String(fd.get("stance")) : "NEUTRAL";
  await db.resultEvidence.create({ data: { dealId, kind, stance, text: text!, who: txt(fd, "who", 120), source: txt(fd, "source", 200), at: dayOf(fd.get("date")) ?? today(), recordedByName: user.name } });
  back(dealId, stance === "CONTRADICTS" && deal.resultState === "ACHIEVED" ? "ok=contradice" : "ok=evidencia");
}

/** Open a Recovery: what changed, the impact for the customer and concrete options. */
export async function openRecovery(dealId: string, fd: FormData) {
  const { user, deal, i } = await loadDeal(dealId);
  if (deal.recoveries.some((r) => !r.resolvedAt)) back(dealId, "err=ya-abierta");
  const whatChanged = txt(fd, "whatChanged");
  const impact = txt(fd, "impact");
  const options: RecoveryOption[] = [];
  for (const n of [1, 2, 3]) {
    const title = txt(fd, `opt${n}_title`, 160);
    if (title) options.push({ key: `o${n}`, title, detail: txt(fd, `opt${n}_detail`, 400) ?? "", eta: String(fd.get(`opt${n}_eta`) ?? "") || null });
  }
  if (!whatChanged || !impact || !options.length) back(dealId, "err=recovery&recovery=1", "#recovery");
  const cause = String(fd.get("cause") ?? "");
  await db.recovery.create({ data: { dealId, openedByName: user.name, whatChanged: whatChanged!, impact: impact!, cause: CAUSE_KEYS.includes(cause) ? cause : null, options: options as unknown as Prisma.InputJsonValue } });
  // A result that was marked achieved is no longer achieved while a Recovery is open.
  if (deal.resultState === "ACHIEVED") await db.deal.update({ where: { id: dealId }, data: { resultState: "PARTIAL", resultAchievedAt: null } });
  await fact(user.id, deal, i.t(`Recovery abierta: ${whatChanged}`, `Recovery opened: ${whatChanged}`));
  back(dealId, "ok=recovery", "#recovery");
}

export async function chooseRecoveryOption(recoveryId: string, key: string, fd: FormData) {
  const user = await requireUser();
  const r = await db.recovery.findUniqueOrThrow({ where: { id: recoveryId }, include: { deal: { select: { id: true, ownerId: true, accountId: true } } } });
  assertCanEdit(user, r.deal.ownerId);
  const opt = optionsOf(r).find((o) => o.key === key);
  if (!opt || r.resolvedAt) back(r.dealId, "err=opcion", "#recovery");
  const expectedBy = dayOf(fd.get("expectedBy")) ?? dayOf(opt!.eta);
  await db.recovery.update({ where: { id: recoveryId }, data: { selectedKey: key, selectedAt: new Date(), selectedByName: user.name, selectedNote: txt(fd, "note", 300), expectedBy } });
  await db.deal.update({ where: { id: r.dealId }, data: { nextMove: `Recovery: ${opt!.title}`.slice(0, 200), nextMoveDate: expectedBy, waitingFor: null, waitingUntil: null } });
  await fact(user.id, r.deal, `Recovery: ${opt!.title}`);
  back(r.dealId, "ok=opcion", "#recovery");
}

/** Close the Recovery. RECOVERED needs fresh customer evidence; it then makes the result achieved. */
export async function resolveRecovery(recoveryId: string, fd: FormData) {
  const user = await requireUser();
  const r = await db.recovery.findUniqueOrThrow({ where: { id: recoveryId }, include: { deal: { select: { id: true, ownerId: true, accountId: true, resultAchievedAt: true } } } });
  assertCanEdit(user, r.deal.ownerId);
  if (r.resolvedAt) back(r.dealId, "ok=recovery-resuelta");
  const outcome = String(fd.get("outcome"));
  const note = txt(fd, "note");
  const now = new Date();
  if (outcome === "RECOVERED") {
    const evText = txt(fd, "evText");
    const evWho = txt(fd, "evWho", 120);
    if (!evText || !evWho) back(r.dealId, "err=evidencia", "#recovery");
    await db.$transaction([
      db.recovery.update({ where: { id: recoveryId }, data: { resolvedAt: now, outcome, outcomeNote: note } }),
      db.resultEvidence.create({ data: { dealId: r.dealId, kind: "CUSTOMER", stance: "SUPPORTS", text: evText!, who: evWho, source: txt(fd, "evSource", 200), at: today(), recordedByName: user.name } }),
      db.deal.update({ where: { id: r.dealId }, data: { resultState: "ACHIEVED", actualResult: txt(fd, "actualResult") ?? evText, resultNote: txt(fd, "actualResult") ?? evText, resultConfirmedAt: now, resultConfirmedByName: user.name, resultAchievedAt: r.deal.resultAchievedAt ?? now, resultPendingNote: null, nextMove: null, nextMoveDate: null } }),
    ]);
  } else if (outcome === "NOT_RECOVERED" || outcome === "NO_LONGER_RELEVANT") {
    if (!note) back(r.dealId, "err=nota", "#recovery");
    await db.$transaction([
      db.recovery.update({ where: { id: recoveryId }, data: { resolvedAt: now, outcome, outcomeNote: note } }),
      db.deal.update({ where: { id: r.dealId }, data: { resultState: outcome === "NOT_RECOVERED" ? "NOT_ACHIEVED" : "NO_LONGER_RELEVANT", resultAchievedAt: null, resultConfirmedAt: now, resultConfirmedByName: user.name, nextMove: null, nextMoveDate: null } }),
    ]);
  } else back(r.dealId, "err=estado", "#recovery");
  await fact(user.id, r.deal, `Recovery → ${outcome}`, note);
  back(r.dealId, `ok=recovery-${outcome.toLowerCase()}`);
}

/** A continuity signal/trigger needs a real reason. It is not an opportunity and creates no Journey. */
export async function createContinuity(dealId: string, fd: FormData) {
  const { user, deal, i } = await loadDeal(dealId);
  const kind = fd.get("kind") === "TRIGGER" ? "TRIGGER" : "SIGNAL";
  const what = txt(fd, "what", 200);
  const basis = txt(fd, "basis", 400);
  const triggerOn = dayOf(fd.get("triggerOn"));
  const triggerEvent = txt(fd, "triggerEvent", 200);
  if (!what || !basis) back(dealId, "err=senal");
  if (kind === "TRIGGER" && !triggerOn && !triggerEvent) back(dealId, "err=disparador");
  await db.continuitySignal.create({ data: { dealId, kind, what: what!, basis: basis!, triggerOn, triggerEvent, createdByName: user.name } });
  // A dated trigger becomes one reminder for the owner on that date — never a 30/60/90 series.
  if (kind === "TRIGGER" && triggerOn) await db.task.create({ data: { title: i.t(`Continuidad: ${what}`, `Continuity: ${what}`).slice(0, 200), dueDate: triggerOn, assigneeId: deal.ownerId, accountId: deal.accountId, dealId } });
  back(dealId, "ok=senal");
}

/** Close the Journey: what happened, what we learned (one line) and the future signal decision. */
export async function closeJourney(dealId: string, fd: FormData) {
  const { user, deal, i } = await loadDeal(dealId);
  if (deal.closedAt) back(dealId, "ok=ya-cerrado");
  const blocking = closureChecks(deal, i).filter((c) => c.key !== "learning" && !c.ok);
  if (blocking.length) back(dealId, "err=no-listo");
  const summary = txt(fd, "summary", 2000);
  const learning = txt(fd, "learning", 300);
  const noSignal = txt(fd, "noSignalReason", 300);
  if (!summary || !learning) back(dealId, "err=cierre", "#cierre");
  if (!deal.continuity.length && !noSignal) back(dealId, "err=sin-senal", "#cierre");
  await db.deal.update({
    where: { id: dealId },
    data: { closedAt: new Date(), closedByName: user.name, closureSummary: summary, closureLearning: learning, closureNoSignalReason: deal.continuity.length ? null : noSignal, nextMove: null, nextMoveDate: null, waitingFor: null, waitingUntil: null },
  });
  await fact(user.id, deal, i.t("Necesidad cerrada", "Necessity closed"), learning);
  back(dealId, "ok=cerrado");
}

export async function reopenJourney(dealId: string) {
  const { user, deal, i } = await loadDeal(dealId);
  await db.deal.update({ where: { id: dealId }, data: { closedAt: null, closedByName: null } });
  await fact(user.id, deal, i.t("Necesidad reabierta", "Necessity reopened"));
  back(dealId, "ok=reabierto");
}
