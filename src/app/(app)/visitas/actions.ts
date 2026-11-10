"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";
import { money2 } from "@/lib/money";
import { valueKindOf } from "@/lib/goal-rules";
import { OBJECTIVE_CATS, readObjectives } from "@/lib/visits";
import { AiError } from "@/lib/ai";
import { MAX_DRAFT_IMAGES, MAX_VISIT_FILES, MAX_VISIT_FILE_BYTES, VISIT_FILE_MIMES, VISIT_IMAGE_MIMES, draftVisit, type VisitDraft } from "@/lib/visit-draft";

// Comercial C8a · Visits & Commercial Missions (v1.3 §57). The person plans, visits and confirms what came out of
// it; nothing is created behind their back (a new Need or commitment exists only when they write it).

const back = (path: string, qs: string): never => { refreshApp(); redirect(`${path}${path.includes("?") ? "&" : "?"}${qs}`); };
const txt = (fd: FormData, k: string, max = 600) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (fd: FormData, k: string) => { const s = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null; };

async function ownVisit(id: string) {
  const user = await requireUser();
  const v = await db.visitPlan.findUnique({ where: { id }, select: { id: true, ownerId: true, accountId: true, status: true, objectives: true, account: { select: { name: true } } } });
  if (!v) back("/visitas", "err=visita");
  if (!canEdit(user, v!.ownerId)) back(`/visitas/${id}`, "err=permiso");
  return { user, v: v! };
}

export async function createVisit(fd: FormData) {
  const user = await requireUser();
  const accountId = txt(fd, "accountId", 40);
  const account = accountId ? await db.account.findUnique({ where: { id: accountId }, select: { id: true } }) : null;
  if (!account) back("/visitas", "err=cliente");
  const unplanned = fd.get("unplanned") === "1";
  const plannedAt = unplanned ? today() : dayOf(fd, "plannedAt");
  if (!plannedAt) back("/visitas", "err=fecha");
  const objectives = Object.keys(OBJECTIVE_CATS).filter((c) => fd.get(`obj_${c}`) === "1").map((cat) => ({ cat, text: txt(fd, `objtext_${cat}`, 300) ?? "" }));
  if (!objectives.length) back("/visitas", "err=objetivo");
  const missionId = txt(fd, "missionId", 40);
  const mission = missionId ? await db.commercialMission.findFirst({ where: { id: missionId, ownerId: user.id }, select: { id: true } }) : null;
  const v = await db.visitPlan.create({ data: { accountId: account!.id, ownerId: user.id, missionId: mission?.id ?? null, plannedAt, unplanned, objectives: objectives as Prisma.InputJsonValue, meetWith: txt(fd, "meetWith", 300), createdByName: user.name } });
  back(`/visitas/${v.id}`, unplanned ? "ok=sin-plan" : "ok=planeada");
}

/** Post-visit: what we learned, which objectives were met, commitments on both sides, an optional new Need and
 *  the next movement. Logged as a meeting (a useful contact only if the person says what it left). */
export async function recordOutcome(id: string, fd: FormData) {
  const { user, v } = await ownVisit(id);
  if (v.status !== "PLANNED") back(`/visitas/${id}`, "err=cerrada");
  const learned = txt(fd, "learned", 2000) ?? "";
  if (!learned) back(`/visitas/${id}`, "err=aprendido");
  const happenedAt = dayOf(fd, "happenedAt") ?? today();
  const objs = readObjectives(v.objectives);
  const objectivesMet = objs.map((_, k) => fd.get(`met_${k}`) === "1");
  const commitments = Array.from({ length: 4 }, (_, k) => ({ side: fd.get(`side_${k}`) === "CUSTOMER" ? "CUSTOMER" : "US", what: txt(fd, `what_${k}`, 300), dueAt: dayOf(fd, `due_${k}`) })).filter((c) => c.what);
  const needTitle = txt(fd, "needTitle", 200);
  const needResult = txt(fd, "needResult", 600);
  if (needTitle && !needResult) back(`/visitas/${id}`, "err=necesidad");
  const nextMove = txt(fd, "nextMove", 300);
  const nextMoveDate = dayOf(fd, "nextMoveDate");
  await db.$transaction(async (tx) => {
    let dealId: string | null = null;
    if (needTitle) {
      const code = await nextCode("J", "deal", tx);
      dealId = (await tx.deal.create({ data: { code, title: needTitle, accountId: v.accountId, ownerId: user.id, stage: "LEAD", desiredResult: needResult, nextMove, nextMoveDate } })).id;
    }
    await tx.visitPlan.update({ where: { id }, data: { status: "DONE", happenedAt, learned, objectivesMet: objectivesMet as Prisma.InputJsonValue, nextMove, nextMoveDate } });
    if (commitments.length) await tx.visitCommitment.createMany({ data: commitments.map((c) => ({ visitId: id, side: c.side, what: c.what!, dueAt: c.dueAt, dealId })) });
    await tx.activity.create({ data: { type: "MEETING", subject: `Visita a ${v.account.name}: ${learned}`.slice(0, 200), body: learned.length > 150 ? learned : null, userId: user.id, accountId: v.accountId, dealId, occurredAt: happenedAt, source: "Visita", valueKind: valueKindOf(fd.get("valueKind")) } });
  });
  back(`/visitas/${id}`, needTitle ? "ok=hecha-need" : "ok=hecha");
}

export async function cancelVisit(id: string, fd: FormData) {
  const { v } = await ownVisit(id);
  if (v.status !== "PLANNED") back(`/visitas/${id}`, "err=cerrada");
  const reason = txt(fd, "cancelReason", 300);
  if (!reason) back(`/visitas/${id}`, "err=motivo");
  await db.visitPlan.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason } });
  back(`/visitas/${id}`, "ok=cancelada");
}

export async function closeCommitment(commitmentId: string, fd: FormData) {
  const user = await requireUser();
  const c = await db.visitCommitment.findUnique({ where: { id: commitmentId }, select: { id: true, status: true, visit: { select: { id: true, ownerId: true } } } });
  if (!c) back("/visitas", "err=compromiso");
  if (!canEdit(user, c!.visit.ownerId)) back(`/visitas/${c!.visit.id}`, "err=permiso");
  const status = fd.get("status") === "DROPPED" ? "DROPPED" : "KEPT";
  const note = txt(fd, "closedNote", 300);
  if (status === "DROPPED" && !note) back(`/visitas/${c!.visit.id}`, "err=motivo");
  if (c!.status === "OPEN") await db.visitCommitment.update({ where: { id: commitmentId }, data: { status, closedAt: new Date(), closedNote: note } });
  back(`/visitas/${c!.visit.id}`, "ok=compromiso");
}

export async function createMission(fd: FormData) {
  const user = await requireUser();
  const title = txt(fd, "title", 160);
  const destination = txt(fd, "destination", 200);
  const purpose = txt(fd, "purpose", 600);
  const startDate = dayOf(fd, "startDate");
  const endDate = dayOf(fd, "endDate");
  if (!title || !destination || !purpose || !startDate || !endDate) back("/visitas", "err=mision");
  if (endDate! < startDate!) back("/visitas", "err=fechas");
  const wantsBudget = fd.get("requestBudget") === "1";
  const amount = Number(fd.get("budgetAmount") ?? 0);
  await db.commercialMission.create({ data: {
    title: title!, destination: destination!, purpose: purpose!, startDate: startDate!, endDate: endDate!, travelNote: txt(fd, "travelNote", 600), ownerId: user.id, createdByName: user.name,
    budgetStatus: wantsBudget ? "WAITING_MODULE_14" : "NOT_REQUESTED", budgetAmount: wantsBudget && Number.isFinite(amount) && amount > 0 ? money2(amount) : null,
  } });
  back("/visitas", "ok=mision");
}

// ---------- C8d · attachments and the AI draft ----------

/** Photos (already shrunk in the browser) and documents for a visit: at most MAX_VISIT_FILES in total. */
export async function addVisitFiles(id: string, fd: FormData): Promise<{ ok: true; saved: number; skipped: number } | { ok: false; error: "PERMISO" | "CERRADA" | "LLENO" | "NADA" }> {
  const user = await requireUser();
  const v = await db.visitPlan.findUnique({ where: { id }, select: { ownerId: true, status: true, _count: { select: { attachments: true } } } });
  if (!v || !canEdit(user, v.ownerId)) return { ok: false, error: "PERMISO" };
  if (v.status === "CANCELLED") return { ok: false, error: "CERRADA" };
  const room = MAX_VISIT_FILES - v._count.attachments;
  if (room <= 0) return { ok: false, error: "LLENO" };
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const good = files.filter((f) => f.size <= MAX_VISIT_FILE_BYTES && VISIT_FILE_MIMES.includes(f.type));
  if (!good.length) return { ok: false, error: "NADA" };
  const take = good.slice(0, room);
  for (const f of take) await db.visitAttachment.create({ data: { visitId: id, name: f.name.slice(0, 160) || "archivo", mime: f.type, size: f.size, data: Buffer.from(await f.arrayBuffer()), uploadedByName: user.name } });
  refreshApp();
  return { ok: true, saved: take.length, skipped: files.length - take.length };
}

export async function removeVisitFile(fileId: string) {
  const user = await requireUser();
  const a = await db.visitAttachment.findUnique({ where: { id: fileId }, select: { id: true, visit: { select: { id: true, ownerId: true } } } });
  if (!a) back("/visitas", "err=visita");
  if (!canEdit(user, a!.visit.ownerId)) back(`/visitas/${a!.visit.id}`, "err=permiso");
  await db.visitAttachment.delete({ where: { id: fileId } });
  back(`/visitas/${a!.visit.id}`, "ok=archivo#archivos");
}

/** AI draft of the outcome from the person's raw notes and the visit's photos. Fills the form only; the person
 *  reviews and submits. Off (no cost) until an API key exists; pauses at the monthly cap. */
export async function draftVisitOutcome(id: string, notes: string): Promise<{ ok: true; draft: VisitDraft } | { ok: false; error: string }> {
  const user = await requireUser();
  const v = await db.visitPlan.findUnique({ where: { id }, select: { ownerId: true, status: true, objectives: true, account: { select: { name: true } }, attachments: { where: { mime: { in: [...VISIT_IMAGE_MIMES] } }, orderBy: { createdAt: "asc" }, take: MAX_DRAFT_IMAGES, select: { mime: true, data: true } } } });
  if (!v || !canEdit(user, v.ownerId)) return { ok: false, error: "PERMISO" };
  if (v.status !== "PLANNED") return { ok: false, error: "CERRADA" };
  const text = String(notes ?? "").trim();
  if (text.length < 20 && v.attachments.length === 0) return { ok: false, error: "CORTO" };
  try {
    const draft = await draftVisit({
      notes: text, customer: v.account.name, lang: user.lang === "EN" ? "EN" : "ES", userName: user.name,
      objectives: readObjectives(v.objectives).map((o) => `${OBJECTIVE_CATS[o.cat].en}${o.text ? `: ${o.text}` : ""}`),
      images: v.attachments.map((a) => ({ mime: a.mime as (typeof VISIT_IMAGE_MIMES)[number], data: Buffer.from(a.data) })),
    });
    return { ok: true, draft };
  } catch (e) {
    const code = e instanceof AiError ? e.code : "API";
    if (!(e instanceof AiError) || code === "API" || code === "AUTH") console.error("[visitas/draft]", e instanceof Error ? e.message : e);
    return { ok: false, error: code };
  }
}
