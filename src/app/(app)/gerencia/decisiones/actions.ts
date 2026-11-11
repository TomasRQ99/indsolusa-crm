"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fDay, fMoney, fPick, fText } from "@/lib/fd";
import { today } from "@/lib/domain";
import { AREAS, DECISION_KINDS, VERDICTS, asPairs, decideIssues, decisionCode, decisionStage, parsePairs, requestIssues } from "@/lib/gerencia-rules";

// Módulo 15 §4 · Management Decision Record. Anyone may ask Gerencia for a decision; only Gerencia decides. A decided
// record is never edited: revising it writes a new version and the earlier one stays, marked as replaced (AC16).
// What really happened is added later as a review, so each decision can be held against its consequence (AC20).

const go = (path: string): never => { refreshApp(); redirect(`/gerencia/decisiones${path}`); };
/** Only addresses inside SOLU may be linked as the record a decision is about. */
const innerHref = (v: string | null) => (v && /^\/[A-Za-z0-9/_\-?=&#.%]*$/.test(v) && !v.startsWith("//") ? v.slice(0, 300) : null);

function readRequest(fd: FormData) {
  return {
    area: fPick(fd, "area", AREAS), kind: fPick(fd, "kind", DECISION_KINDS) ?? "GENERAL", question: fText(fd, "question", 300), context: fText(fd, "context", 2000), whyNow: fText(fd, "whyNow", 500),
    impact: fText(fd, "impact", 500), impactUsd: fMoney(fd, "impactUsd"), alternatives: parsePairs(fText(fd, "alternatives", 4000)), facts: fText(fd, "facts", 3000), assumptions: fText(fd, "assumptions", 2000),
    risks: fText(fd, "risks", 2000), recommendation: fText(fd, "recommendation", 1000), deadline: fDay(fd, "deadline"), sourceHref: innerHref(fText(fd, "sourceHref", 300)), sourceLabel: fText(fd, "sourceLabel", 160),
  };
}

export async function requestDecision(fd: FormData) {
  const user = await requireUser();
  const r = readRequest(fd);
  const issues = requestIssues(r);
  if (issues.length) go(`?err=faltan&f=${issues.join(",")}#pedir`);
  const scenarioId = fText(fd, "scenarioId", 40);
  const scenario = scenarioId ? await db.scenario.findFirst({ where: { id: scenarioId, status: "OPEN" }, select: { id: true } }) : null;
  const now = new Date();
  // The code is taken inside the transaction; a clash on the unique (code, version) retries once with the next number.
  let id = "";
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    try {
      id = await db.$transaction(async (tx) => {
        const last = await tx.managementDecision.findFirst({ where: { code: { startsWith: decisionCode(now, null).slice(0, 8) } }, orderBy: { code: "desc" }, select: { code: true } });
        const d = await tx.managementDecision.create({ data: {
          code: decisionCode(now, last?.code ?? null), area: r.area!, kind: r.kind, question: r.question!, context: r.context!, whyNow: r.whyNow, impact: r.impact!, impactUsd: r.impactUsd,
          alternatives: r.alternatives as unknown as Prisma.InputJsonValue, facts: r.facts!, assumptions: r.assumptions, risks: r.risks, recommendation: r.recommendation, deadline: r.deadline,
          sourceHref: r.sourceHref, sourceLabel: r.sourceHref ? r.sourceLabel ?? r.sourceHref : null, scenarioId: scenario?.id ?? null, requestedById: user.id, requestedByName: user.name,
        } });
        return d.id;
      });
    } catch (e) { if (attempt === 2) throw e; }
  }
  go(`/${id}?ok=pedida`);
}

async function load(id: string) {
  const user = await requireUser();
  const d = await db.managementDecision.findUnique({ where: { id }, include: { reviews: true } });
  if (!d) go("?err=no-existe");
  return { user, d: d! };
}

export async function decide(id: string, fd: FormData) {
  const { user, d } = await load(id);
  if (!isGerencia(user)) go(`/${id}?err=gerencia`);
  if (d.status !== "REQUESTED" || d.supersededAt) go(`/${id}?err=estado`);
  const alts = asPairs(d.alternatives);
  const chosen = String(fd.get("chosen") ?? "");
  const out = {
    decision: fText(fd, "decision", 2000), rationale: fText(fd, "rationale", 2000), authority: fText(fd, "authority", 200) ?? ROLE_LABEL[user.role].es,
    expectedConsequence: fText(fd, "expectedConsequence", 2000), followUpOn: fDay(fd, "followUpOn"), decidedOn: today(),
  };
  const issues = decideIssues(out);
  if (issues.length) go(`/${id}?err=decidir&f=${issues.join(",")}#decidir`);
  const ownerAfter = await db.user.findFirst({ where: { id: String(fd.get("ownerAfterId") ?? ""), active: true }, select: { id: true } });
  if (!ownerAfter) go(`/${id}?err=decidir&f=ownerAfter#decidir`);
  await db.$transaction(async (tx) => {
    // The status is part of the condition: two people deciding at once cannot both win.
    const n = await tx.managementDecision.updateMany({ where: { id, status: "REQUESTED", supersededAt: null }, data: {
      status: "DECIDED", decision: out.decision, chosen: alts.some((a) => a.name === chosen) ? chosen : null, rationale: out.rationale, authority: out.authority,
      decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), expectedConsequence: out.expectedConsequence, followUpOn: out.followUpOn, ownerAfterId: ownerAfter!.id,
    } });
    if (n.count !== 1) throw new Error("La decisión ya no estaba pendiente. / The decision was no longer pending.");
    if (d.scenarioId) await tx.scenario.updateMany({ where: { id: d.scenarioId, status: "OPEN" }, data: { status: "DECIDED" } });
    if (d.kind === "RESOURCE_ALLOCATION") await tx.domainEvent.create({ data: { name: "resource_allocation.decided", entity: "ManagementDecision", entityId: id, payload: { code: d.code, impactUsd: d.impactUsd == null ? null : Number(d.impactUsd) }, actorName: user.name } });
  });
  go(`/${id}?ok=decidida`);
}

export async function withdraw(id: string, fd: FormData) {
  const { user, d } = await load(id);
  if (!(isGerencia(user) || d.requestedById === user.id)) go(`/${id}?err=permiso`);
  if (d.status !== "REQUESTED" || d.supersededAt) go(`/${id}?err=estado`);
  const note = fText(fd, "note", 500);
  if (!note) go(`/${id}?err=motivo#retirar`);
  await db.managementDecision.updateMany({ where: { id, status: "REQUESTED" }, data: { status: "WITHDRAWN", withdrawnNote: `${user.name}: ${note}` } });
  go(`/${id}?ok=retirada`);
}

/** What actually happened. Added by Gerencia or by whoever was left in charge; earlier reviews stay as written. */
export async function reviewDecision(id: string, fd: FormData) {
  const { user, d } = await load(id);
  if (!(isGerencia(user) || d.ownerAfterId === user.id)) go(`/${id}?err=permiso`);
  const stage = decisionStage(d, today()).stage;
  if (d.status !== "DECIDED" || stage === "REPLACED") go(`/${id}?err=estado`);
  const actual = fText(fd, "actualConsequence", 2000), verdict = fPick(fd, "verdict", VERDICTS), next = fDay(fd, "nextFollowUpOn");
  if (!actual || !verdict) go(`/${id}?err=revision#revision`);
  if (verdict === "TOO_EARLY" && (!next || next <= today())) go(`/${id}?err=proxima#revision`);
  await db.managementDecisionReview.create({ data: { decisionId: id, actualConsequence: actual!, verdict: verdict!, nextFollowUpOn: verdict === "TOO_EARLY" ? next : null, byName: user.name } });
  go(`/${id}?ok=revisada#revision`);
}

/** Gerencia changes its mind, or learned something: a new version with its reason. The earlier version is kept. */
export async function reviseDecision(id: string, fd: FormData) {
  const { user, d } = await load(id);
  if (!isGerencia(user)) go(`/${id}?err=gerencia`);
  if (d.status !== "DECIDED" || d.supersededAt) go(`/${id}?err=estado`);
  const reason = fText(fd, "revisionReason", 1000);
  const out = { decision: fText(fd, "decision", 2000), rationale: fText(fd, "rationale", 2000), authority: fText(fd, "authority", 200) ?? ROLE_LABEL[user.role].es, expectedConsequence: fText(fd, "expectedConsequence", 2000), followUpOn: fDay(fd, "followUpOn"), decidedOn: today() };
  const issues = decideIssues(out);
  if (!reason) issues.push("revisionReason");
  if (issues.length) go(`/${id}?err=decidir&f=${issues.join(",")}#nueva-version`);
  const alts = asPairs(d.alternatives), chosen = String(fd.get("chosen") ?? "");
  const ownerAfter = await db.user.findFirst({ where: { id: String(fd.get("ownerAfterId") ?? ""), active: true }, select: { id: true } });
  const newId = await db.$transaction(async (tx) => {
    const n = await tx.managementDecision.updateMany({ where: { id, supersededAt: null }, data: { supersededAt: new Date() } });
    if (n.count !== 1) throw new Error("Esa versión ya había sido reemplazada. / That version had already been replaced.");
    const v = await tx.managementDecision.create({ data: {
      code: d.code, version: d.version + 1, revisionReason: reason, kind: d.kind, area: d.area, question: d.question, context: d.context, whyNow: d.whyNow, impact: d.impact, impactUsd: d.impactUsd,
      alternatives: d.alternatives as Prisma.InputJsonValue, facts: fText(fd, "facts", 3000) ?? d.facts, assumptions: fText(fd, "assumptions", 2000) ?? d.assumptions, risks: d.risks, recommendation: d.recommendation, deadline: d.deadline,
      sourceHref: d.sourceHref, sourceLabel: d.sourceLabel, scenarioId: d.scenarioId, status: "DECIDED", requestedById: d.requestedById, requestedByName: d.requestedByName, requestedAt: d.requestedAt,
      decision: out.decision, chosen: alts.some((a) => a.name === chosen) ? chosen : null, rationale: out.rationale, authority: out.authority, decidedById: user.id, decidedByName: user.name, decidedAt: new Date(),
      expectedConsequence: out.expectedConsequence, followUpOn: out.followUpOn, ownerAfterId: ownerAfter?.id ?? d.ownerAfterId,
    } });
    return v.id;
  });
  go(`/${newId}?ok=version`);
}
