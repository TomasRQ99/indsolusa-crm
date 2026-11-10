"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { AUDIENCE, ROUTE_KIND, readRoutes } from "@/lib/proposal-rules";

// Comercial C5 · Solution Case commands. The Solution Case is commercial reasoning: the Journey owner or management
// edit it. Nothing here sends anything to the customer.

const page = (dealId: string) => `/deals/${dealId}/solucion`;
const go = (dealId: string, qs: string, hash = ""): never => { refreshApp(); redirect(`${page(dealId)}?${qs}${hash ? `#${hash}` : ""}`); };
const txt = (fd: FormData, k: string, max = 600) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null; };

async function guard(dealId: string): Promise<{ user: SessionUser; deal: { id: string; ownerId: string; accountId: string } }> {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { id: true, ownerId: true, accountId: true } });
  if (!canEdit(user, deal.ownerId)) go(dealId, "err=permiso");
  return { user, deal };
}
const log = (userId: string, deal: { id: string; accountId: string }, subject: string) =>
  db.activity.create({ data: { type: "NOTE", subject: subject.slice(0, 200), userId, accountId: deal.accountId, dealId: deal.id, phase: "quote", source: "Caso de solución" } });

async function caseOf(dealId: string, by: string) {
  return (await db.solutionCase.findUnique({ where: { dealId }, select: { id: true, routes: true } })) ?? (await db.solutionCase.create({ data: { dealId, updatedByName: by }, select: { id: true, routes: true } }));
}

export async function saveCase(dealId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const mode = txt(fd, "mode", 10);
  const data = {
    understood: txt(fd, "understood", 1200), operationalImpact: txt(fd, "operationalImpact", 800), risks: txt(fd, "risks", 800),
    recommendation: txt(fd, "recommendation", 800), decisionNeeded: txt(fd, "decisionNeeded", 400), helpToBuy: txt(fd, "helpToBuy", 400),
    committee: fd.get("committee") === "1", mode: mode === "QUICK" || mode === "PROPOSAL" ? mode : null, updatedByName: user.name,
  };
  await db.solutionCase.upsert({ where: { dealId }, create: { dealId, ...data }, update: data });
  await log(user.id, deal, "Caso de solución actualizado");
  go(dealId, "ok=caso", "caso");
}

export async function addRoute(dealId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const kind = txt(fd, "kind", 20);
  const label = txt(fd, "label", 160);
  if (!kind || !ROUTE_KIND[kind] || !label) go(dealId, "err=ruta", "rutas");
  const c = await caseOf(dealId, user.name);
  const routes = [...readRoutes(c.routes), { kind: kind!, label: label!, note: txt(fd, "note", 300) }].slice(0, 8);
  await db.solutionCase.update({ where: { id: c.id }, data: { routes, updatedByName: user.name } });
  await log(user.id, deal, `Ruta de solución: ${label}`);
  go(dealId, "ok=ruta", "rutas");
}

export async function removeRoute(dealId: string, idx: number) {
  const { user } = await guard(dealId);
  const c = await caseOf(dealId, user.name);
  const routes = readRoutes(c.routes).filter((_, k) => k !== idx);
  await db.solutionCase.update({ where: { id: c.id }, data: { routes, updatedByName: user.name } });
  go(dealId, "ok=ruta", "rutas");
}

function readClaim(fd: FormData) {
  const aud = txt(fd, "audience", 20) ?? "ALL";
  const evidence = txt(fd, "evidence", 400);
  return {
    need: txt(fd, "need", 300), impact: txt(fd, "impact", 300), advantage: txt(fd, "advantage", 400), benefit: txt(fd, "benefit", 400),
    evidence, evidenceAt: evidence ? dayOf(fd, "evidenceAt") ?? today() : null, audience: AUDIENCE[aud] ? aud : "ALL", validUntil: dayOf(fd, "validUntil"),
  };
}

export async function addClaim(dealId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const attributeId = txt(fd, "attributeId", 40);
  const v = readClaim(fd);
  if (!attributeId || !v.need || !v.advantage || !v.benefit) go(dealId, "err=valor", "valor");
  const attr = await db.valueAttribute.findUnique({ where: { id: attributeId! }, select: { status: true, nameEs: true } });
  if (!attr || attr.status === "RETIRED") go(dealId, "err=atributo", "valor");
  if (v.evidenceAt && v.evidenceAt > today()) go(dealId, "err=fecha", "valor");
  const c = await caseOf(dealId, user.name);
  await db.valueClaim.create({ data: { caseId: c.id, attributeId: attributeId!, need: v.need!, impact: v.impact, advantage: v.advantage!, benefit: v.benefit!, evidence: v.evidence, evidenceAt: v.evidenceAt, audience: v.audience, validUntil: v.validUntil, createdByName: user.name } });
  await log(user.id, deal, `Valor para el cliente: ${attr!.nameEs}${v.evidence ? " (con evidencia)" : " (hipótesis, sin evidencia)"}`);
  go(dealId, `ok=${v.evidence ? "valor" : "hipotesis"}`, "valor");
}

export async function updateClaim(dealId: string, claimId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const v = readClaim(fd);
  if (!v.need || !v.advantage || !v.benefit) go(dealId, "err=valor", "valor");
  if (v.evidenceAt && v.evidenceAt > today()) go(dealId, "err=fecha", "valor");
  const cur = await db.valueClaim.findFirst({ where: { id: claimId, case: { dealId } }, select: { evidence: true, evidenceAt: true } });
  if (!cur) go(dealId, "err=valor", "valor");
  // Evidence keeps its date unless the evidence text itself changed.
  const evidenceAt = v.evidence && v.evidence === cur!.evidence && !fd.get("evidenceAt") ? cur!.evidenceAt : v.evidenceAt;
  await db.valueClaim.update({ where: { id: claimId }, data: { need: v.need!, impact: v.impact, advantage: v.advantage!, benefit: v.benefit!, evidence: v.evidence, evidenceAt, audience: v.audience, validUntil: v.validUntil } });
  await log(user.id, deal, "Valor para el cliente actualizado");
  go(dealId, "ok=valor-editado", "valor");
}

export async function toggleClaim(dealId: string, claimId: string) {
  const { user, deal } = await guard(dealId);
  const c = await db.valueClaim.findFirst({ where: { id: claimId, case: { dealId } }, select: { hidden: true } });
  if (!c) go(dealId, "err=valor", "valor");
  await db.valueClaim.update({ where: { id: claimId }, data: { hidden: !c!.hidden } });
  await log(user.id, deal, c!.hidden ? "Valor para el cliente: vuelve a la propuesta" : "Valor para el cliente: oculto de la propuesta");
  go(dealId, "ok=valor-editado", "valor");
}

export async function recordPresentation(dealId: string, fd: FormData) {
  const { user, deal } = await guard(dealId);
  const at = dayOf(fd, "at");
  const channel = txt(fd, "channel", 80);
  if (!at || !channel) go(dealId, "err=presentacion", "presentacion");
  if (at! > today()) go(dealId, "err=fecha", "presentacion");
  const quoteId = txt(fd, "quoteId", 40);
  if (quoteId && !(await db.quote.findFirst({ where: { id: quoteId, dealId }, select: { id: true } }))) go(dealId, "err=presentacion", "presentacion");
  const c = await caseOf(dealId, user.name);
  const nextMove = txt(fd, "nextMove", 200);
  const nextMoveDate = dayOf(fd, "nextMoveDate");
  await db.presentationRecord.create({ data: {
    caseId: c.id, quoteId, at: at!, channel: channel!, audience: txt(fd, "audience", 200), changed: txt(fd, "changed", 600), valued: txt(fd, "valued", 600),
    objections: txt(fd, "objections", 600), whoDecides: txt(fd, "whoDecides", 300), window: txt(fd, "window", 200), nextMove, nextMoveDate, recordedByName: user.name,
  } });
  // The agreed next step becomes the Journey's Next Movement (AC25), never left only in the notes.
  if (nextMove) await db.deal.update({ where: { id: dealId }, data: { nextMove, nextMoveDate } });
  await log(user.id, deal, `Presentación registrada (${channel})`);
  go(dealId, "ok=presentacion", "presentacion");
}
