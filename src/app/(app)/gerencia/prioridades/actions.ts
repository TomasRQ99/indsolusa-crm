"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fDay, fPick, fText } from "@/lib/fd";
import { METRICS } from "@/lib/metric-dictionary";
import { LINK_KINDS, parseLines, priorityIssues } from "@/lib/gerencia-rules";

// Módulo 15 §3 · Strategic priorities. Gerencia sets them; the owner keeps the narrative alive. A priority is not a
// list of tasks: it points at the real customers, Journeys, explorations and decisions that carry it (AC9).

const go = (qs: string): never => { refreshApp(); redirect(`/gerencia/prioridades?${qs}`); };

async function gerencia() {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=gerencia");
  return user;
}
function indicatorsOf(fd: FormData) {
  const metrics = fd.getAll("metric").map(String).filter((m) => m in METRICS);
  return [...metrics.map((m) => ({ text: METRICS[m].name.es, metric: m })), ...parseLines(fText(fd, "indicators", 2000), 12).map((text) => ({ text, metric: null }))];
}

export async function savePriority(id: string | null, fd: FormData) {
  const user = await gerencia();
  const owner = await db.user.findFirst({ where: { id: String(fd.get("ownerId") ?? ""), active: true }, select: { id: true } });
  const p = { title: fText(fd, "title", 160), rationale: fText(fd, "rationale", 2000), desiredOutcome: fText(fd, "desiredOutcome", 2000), horizon: fText(fd, "horizon", 80), ownerOk: !!owner, indicators: indicatorsOf(fd) };
  const issues = priorityIssues(p);
  if (issues.length) go(`err=faltan&f=${issues.join(",")}#${id ? `p-${id}` : "nueva"}`);
  const data = { title: p.title!, rationale: p.rationale!, desiredOutcome: p.desiredOutcome!, horizon: p.horizon!, horizonTo: fDay(fd, "horizonTo"), indicators: p.indicators as unknown as Prisma.InputJsonValue, ownerId: owner!.id, nextReviewOn: fDay(fd, "nextReviewOn") };
  if (id) {
    const n = await db.strategicPriority.updateMany({ where: { id, status: "ACTIVE" }, data });
    if (n.count !== 1) go("err=cerrada");
    go(`ok=guardada#p-${id}`);
  }
  const created = await db.strategicPriority.create({ data: { ...data, createdByName: user.name } });
  go(`ok=creada#p-${created.id}`);
}

/** The narrative of today: how the priority is really going. Written by Gerencia or by its owner; each one is kept. */
export async function reviewPriority(id: string, fd: FormData) {
  const user = await requireUser();
  const p = await db.strategicPriority.findUnique({ where: { id }, select: { ownerId: true, status: true } });
  if (!p) go("err=no-existe");
  if (!(isGerencia(user) || p!.ownerId === user.id)) go("err=permiso");
  if (p!.status !== "ACTIVE") go("err=cerrada");
  const narrative = fText(fd, "narrative", 3000), next = fDay(fd, "nextReviewOn");
  if (!narrative || !next) go(`err=revision#p-${id}`);
  await db.$transaction([
    db.strategicPriorityReview.create({ data: { priorityId: id, narrative: narrative!, nextReviewOn: next, byName: user.name } }),
    db.strategicPriority.update({ where: { id }, data: { narrative, narrativeAt: new Date(), narrativeByName: user.name, nextReviewOn: next } }),
  ]);
  go(`ok=revisada#p-${id}`);
}

export async function linkPriority(id: string, fd: FormData) {
  const user = await gerencia();
  const [kind, refId] = String(fd.get("ref") ?? "").split(":");
  if (!(kind in LINK_KINDS) || !refId) go(`err=vinculo#p-${id}`);
  // The record must exist: a priority never points at nothing.
  const exists = kind === "ACCOUNT" ? await db.account.count({ where: { id: refId, internal: false } }) : kind === "JOURNEY" ? await db.deal.count({ where: { id: refId, internal: false } }) : kind === "EXPLORATION" ? await db.exploration.count({ where: { id: refId } }) : kind === "DECISION" ? await db.managementDecision.count({ where: { id: refId } }) : await db.scenario.count({ where: { id: refId } });
  if (!exists) go(`err=vinculo#p-${id}`);
  await db.strategicPriorityLink.createMany({ data: [{ priorityId: id, kind, refId, note: fText(fd, "note", 300), addedByName: user.name }], skipDuplicates: true });
  go(`ok=vinculada#p-${id}`);
}
export async function unlinkPriority(linkId: string) {
  await gerencia();
  const l = await db.strategicPriorityLink.findUnique({ where: { id: linkId }, select: { priorityId: true } });
  if (l) await db.strategicPriorityLink.delete({ where: { id: linkId } });
  go(`ok=desvinculada#p-${l?.priorityId ?? ""}`);
}

export async function closePriority(id: string, fd: FormData) {
  await gerencia();
  const status = fPick(fd, "status", { ACHIEVED: 1, DROPPED: 1 }), note = fText(fd, "note", 1000);
  if (!status || !note) go(`err=cierre#p-${id}`);
  const n = await db.strategicPriority.updateMany({ where: { id, status: "ACTIVE" }, data: { status: status!, closedAt: new Date(), closedNote: note } });
  if (n.count !== 1) go("err=cerrada");
  go("ok=cerrada");
}
