"use server";

// Mercado (Módulo 09) commands. Each one is a deliberate action (contract §20: no "status" dropdowns).
// Material changes are audited automatically (audit-core.ts). AI is not connected: everything here is
// typed or chosen by a person, or comes from SOLU's own records, and keeps its source and certainty.

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { asConfidence, asFutureKind, asScope, asSignalKind, asSource, asWhiteKind, movementOf, structureSentence } from "@/lib/market-rules";

const txt = (fd: FormData, k: string, max = 500) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const dayOf = (v: FormDataEntryValue | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${String(v)}T00:00:00Z`) : null);
const idOf = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return /^[a-z0-9]{10,40}$/i.test(v) ? v : null; };
const go = (path: string): never => { refreshApp(); redirect(path); };
const ws = (id: string, qs = "") => `/mercado/exploraciones/${id}${qs ? `?${qs}` : ""}`;

async function loadEditable(id: string, user: SessionUser) {
  const e = await db.exploration.findUnique({ where: { id }, select: { id: true, ownerId: true, lifecycle: true } });
  if (!e) redirect("/mercado");
  if (!canEdit(user, e!.ownerId)) redirect(ws(id, "err=permiso"));
  return e!;
}

/** CreateExploration: one natural sentence is enough; SOLU structures what it can and lists what it couldn't tell. */
export async function createExploration(fd: FormData) {
  const user = await requireUser();
  const sentence = txt(fd, "sentence", 400);
  if (!sentence || sentence.length < 6) go("/mercado?err=frase");
  const list = await db.account.findMany({ select: { id: true, name: true, aliases: { select: { name: true } } } });
  // Other names the company goes by also count ("Alpina" for its legal name). Links keep the canonical name.
  const accounts = list.flatMap((a) => [{ id: a.id, name: a.name }, ...a.aliases.map((x) => ({ id: a.id, name: x.name }))]);
  const s = structureSentence(sentence!, { accounts });
  const canon = new Map(list.map((a) => [a.id, a.name]));
  s.accounts = [...new Map(s.accounts.map((a) => [a.id, { id: a.id, name: canon.get(a.id) ?? a.name }])).values()];
  const e = await db.exploration.create({
    data: {
      name: s.name, purpose: s.purpose, scope: s.scope, scopeText: s.scopeText || null, ownerId: user.id, movement: "CLARITY_NEEDED",
      links: { create: [
        ...s.accounts.map((a) => ({ kind: "ACCOUNT", refId: a.id, label: a.name, why: "Nombrada en el propósito" })),
        ...s.brands.map((b) => ({ kind: "BRAND", refId: b.toLowerCase().replace(/[^a-z0-9]+/g, "-"), label: b, why: "Tecnología nombrada en el propósito" })),
      ] },
      gaps: { create: [
        ...(s.unknown.includes("industry") ? [{ question: "¿En qué sector o tipo de operación nos enfocamos?", why: "El propósito no lo dice; sin él SOLU no puede relacionar empresas.", createdByName: user.name }] : []),
        ...(s.unknown.includes("place") ? [{ question: "¿En qué territorio (país, región o ciudad)?", why: "Sirve para saber qué plantas y relaciones cuentan.", createdByName: user.name }] : []),
      ] },
    },
  });
  go(ws(e.id, "nuevo=1"));
}

/** Explore a signal: creates the exploration with the signal's company and keeps the lineage. Never creates a Journey. */
export async function exploreSignal(signalId: string) {
  const user = await requireUser();
  const sg = await db.marketSignal.findUnique({ where: { id: signalId }, include: { account: { select: { id: true, name: true } } } });
  if (!sg) go("/mercado");
  if (sg!.explorationId) go(ws(sg!.explorationId));
  const name = `${sg!.account ? sg!.account.name.replace(/\s*\(ejemplo\)$/, "") + ": " : ""}${sg!.what}`.slice(0, 90);
  const e = await db.exploration.create({
    data: {
      name, purpose: `Entender qué significa este cambio y si podemos ser útiles: ${sg!.what}`.slice(0, 500), scope: sg!.account ? "COMPANY" : "INDUSTRY",
      scopeText: sg!.account?.name ?? null, ownerId: user.id, createdFromSignalId: sg!.id, movement: "CLARITY_NEEDED",
      links: sg!.account ? { create: [{ kind: "ACCOUNT", refId: sg!.account.id, label: sg!.account.name, why: "Empresa de la señal" }] } : undefined,
    },
  });
  await db.marketSignal.update({ where: { id: sg!.id }, data: { status: "EXPLORING", explorationId: e.id } });
  go(ws(e.id, "nuevo=1"));
}

/** UpdateExplorationScope: purpose, hypothesis (always shown as a hypothesis) and scope. */
export async function updateExploration(id: string, fd: FormData) {
  const user = await requireUser();
  await loadEditable(id, user);
  const name = txt(fd, "name", 90);
  const purpose = txt(fd, "purpose", 500);
  if (!name || !purpose) go(ws(id, "err=dato"));
  await db.exploration.update({ where: { id }, data: { name: name!, purpose: purpose!, hypothesis: txt(fd, "hypothesis", 500), scope: asScope(txt(fd, "scope", 20)), scopeText: txt(fd, "scopeText", 200) } });
  go(ws(id, "ok=guardado"));
}

/** SetNextMovement / Wait / Future Trigger: exactly one at a time. A next movement also becomes a to-do in Mi Día. */
export async function setMovement(id: string, fd: FormData) {
  const user = await requireUser();
  const e = await loadEditable(id, user);
  if (e.lifecycle === "CLOSED") go(ws(id, "err=cerrada"));
  const mode = String(fd.get("mode") ?? "");
  const clear = { nextMove: null, nextMoveAt: null, waitingFor: null, waitingUntil: null, triggerOn: null, triggerEvent: null };
  let data: typeof clear | (Omit<typeof clear, "nextMove" | "nextMoveAt"> & { nextMove: string; nextMoveAt: Date | null }) = clear;
  if (mode === "MOVE") {
    const what = txt(fd, "nextMove", 200);
    if (!what) go(ws(id, "err=movimiento"));
    data = { ...clear, nextMove: what!, nextMoveAt: dayOf(fd.get("nextMoveAt")) };
  } else if (mode === "WAIT") {
    const forWhat = txt(fd, "waitingFor", 200), until = dayOf(fd.get("waitingUntil"));
    if (!forWhat || !until) go(ws(id, "err=espera"));
    data = { ...clear, waitingFor: forWhat, waitingUntil: until } as typeof clear;
  } else if (mode === "TRIGGER") {
    const on = dayOf(fd.get("triggerOn")), ev = txt(fd, "triggerEvent", 200);
    if (!on && !ev) go(ws(id, "err=disparador"));
    data = { ...clear, triggerOn: on, triggerEvent: ev } as typeof clear;
  } else go(ws(id, "err=dato"));
  const movement = movementOf(data);
  await db.$transaction(async (tx) => {
    // The previous next movement's to-do is replaced, not left behind.
    await tx.task.updateMany({ where: { explorationId: id, status: "OPEN" }, data: { status: "DONE", completedAt: new Date() } });
    await tx.exploration.update({ where: { id }, data: { ...data, movement, lifecycle: movement === "TRIGGER" ? "DORMANT" : "ACTIVE", nextReviewAt: data.nextMoveAt ?? data.waitingUntil ?? data.triggerOn ?? null } });
    if (mode === "MOVE") await tx.task.create({ data: { title: `Mercado: ${data.nextMove}`.slice(0, 200), dueDate: data.nextMoveAt, assigneeId: user.id, explorationId: id } });
  });
  go(ws(id, "ok=movimiento"));
}

/** The next movement was done: the to-do closes and SOLU asks for the next one (the exploration needs clarity until then). */
export async function completeMovement(id: string, fd: FormData) {
  const user = await requireUser();
  await loadEditable(id, user);
  const learned = txt(fd, "learned", 500);
  await db.$transaction(async (tx) => {
    await tx.task.updateMany({ where: { explorationId: id, status: "OPEN" }, data: { status: "DONE", completedAt: new Date() } });
    await tx.exploration.update({ where: { id }, data: { nextMove: null, nextMoveAt: null, movement: "CLARITY_NEEDED", nextReviewAt: null } });
    if (learned) await tx.knowledgeGap.create({ data: { explorationId: id, question: "Aprendizaje del último movimiento", status: "RESOLVED", answer: learned, answerSource: "Conversación / visita", resolvedAt: new Date(), resolvedByName: user.name, createdByName: user.name } });
  });
  go(ws(id, "ok=hecho"));
}

/** CloseExploration: allowed without a Need. What we learned is the result and stays. */
export async function closeExploration(id: string, fd: FormData) {
  const user = await requireUser();
  await loadEditable(id, user);
  const summary = txt(fd, "resultSummary", 1000);
  if (!summary) go(ws(id, "err=resultado"));
  await db.$transaction([
    db.task.updateMany({ where: { explorationId: id, status: "OPEN" }, data: { status: "DONE", completedAt: new Date() } }),
    db.exploration.update({ where: { id }, data: { lifecycle: "CLOSED", closedAt: new Date(), resultSummary: summary, movement: "CLARITY_NEEDED", nextMove: null, nextMoveAt: null, waitingFor: null, waitingUntil: null, triggerOn: null, triggerEvent: null } }),
  ]);
  go(ws(id, "ok=cerrada"));
}

export async function reopenExploration(id: string) {
  const user = await requireUser();
  await loadEditable(id, user);
  await db.exploration.update({ where: { id }, data: { lifecycle: "ACTIVE", closedAt: null } });
  go(ws(id, "ok=reabierta"));
}

/** Link a company (customer or prospect) to the exploration. */
export async function linkAccount(id: string, fd: FormData) {
  await requireUser();
  const accountId = idOf(fd, "accountId");
  if (!accountId) go(ws(id, "err=dato"));
  const a = await db.account.findUnique({ where: { id: accountId! }, select: { id: true, name: true } });
  if (!a) go(ws(id, "err=dato"));
  await db.explorationLink.upsert({ where: { explorationId_kind_refId: { explorationId: id, kind: "ACCOUNT", refId: a!.id } }, update: {}, create: { explorationId: id, kind: "ACCOUNT", refId: a!.id, label: a!.name, why: txt(fd, "why", 200) } });
  go(ws(id, "ok=empresa"));
}
export async function unlink(id: string, linkId: string) {
  const user = await requireUser();
  await loadEditable(id, user);
  await db.explorationLink.deleteMany({ where: { id: linkId, explorationId: id } });
  go(ws(id));
}

/** CaptureSignal: what changed, with its source, date seen and certainty. */
export async function captureSignal(fd: FormData) {
  const user = await requireUser();
  const what = txt(fd, "what", 300);
  const back = txt(fd, "back", 200) ?? "/mercado";
  const safeBack = back.startsWith("/mercado") ? back : "/mercado";
  if (!what) go(`${safeBack}${safeBack.includes("?") ? "&" : "?"}err=senal`);
  const explorationId = idOf(fd, "explorationId");
  await db.marketSignal.create({
    data: {
      kind: asSignalKind(txt(fd, "kind", 30)), what: what!, whyMatters: txt(fd, "whyMatters", 500), accountId: idOf(fd, "accountId"), explorationId,
      status: explorationId ? "EXPLORING" : "NEW", sourceType: asSource(txt(fd, "sourceType", 30)), sourceRef: txt(fd, "sourceRef", 300),
      observedAt: dayOf(fd.get("observedAt")) ?? new Date(), confidence: asConfidence(txt(fd, "confidence", 20)), capturedById: user.id, capturedByName: user.name,
    },
  });
  go(`${safeBack}${safeBack.includes("?") ? "&" : "?"}ok=senal`);
}

/** Not worth exploring now: says why, so the next person doesn't redo the thinking. */
export async function dismissSignal(signalId: string, fd: FormData) {
  await requireUser();
  const note = txt(fd, "note", 300);
  if (!note) go("/mercado?err=descarte");
  await db.marketSignal.update({ where: { id: signalId }, data: { status: "DISMISSED", dismissedNote: note } });
  go("/mercado?ok=descartada");
}

export async function addGap(id: string, fd: FormData) {
  const user = await requireUser();
  const q = txt(fd, "question", 300);
  if (!q) go(ws(id, "err=pregunta"));
  await db.knowledgeGap.create({ data: { explorationId: id, accountId: idOf(fd, "accountId"), question: q!, why: txt(fd, "why", 300), createdByName: user.name } });
  go(ws(id, "ok=gap"));
}
export async function resolveGap(id: string, gapId: string, fd: FormData) {
  const user = await requireUser();
  const answer = txt(fd, "answer", 1000);
  if (!answer) go(ws(id, "err=respuesta"));
  await db.knowledgeGap.updateMany({ where: { id: gapId, explorationId: id, status: "OPEN" }, data: { status: "RESOLVED", answer, answerSource: txt(fd, "answerSource", 200), resolvedAt: new Date(), resolvedByName: user.name } });
  go(ws(id, "ok=aprendido"));
}
/** A knowledge gap becomes the next movement ("find out …"). */
export async function gapToMovement(id: string, gapId: string) {
  const user = await requireUser();
  const e = await loadEditable(id, user);
  if (e.lifecycle === "CLOSED") go(ws(id, "err=cerrada"));
  const g = await db.knowledgeGap.findFirst({ where: { id: gapId, explorationId: id } });
  if (!g) go(ws(id));
  const fd = new FormData();
  fd.set("mode", "MOVE"); fd.set("nextMove", `Averiguar: ${g!.question}`.slice(0, 200));
  return setMovement(id, fd);
}

export async function addWhiteSpace(id: string, fd: FormData) {
  const user = await requireUser();
  const what = txt(fd, "what", 300);
  if (!what) go(ws(id, "err=white"));
  await db.whiteSpace.create({ data: { explorationId: id, accountId: idOf(fd, "accountId"), kind: asWhiteKind(txt(fd, "kind", 20)), what: what!, why: txt(fd, "why", 300), createdByName: user.name } });
  go(ws(id, "ok=white"));
}
export async function setWhiteSpace(wsId: string, fd: FormData) {
  await requireUser();
  const status = String(fd.get("status") ?? "");
  if (!["EXPLORING", "RESOLVED", "NOT_RELEVANT", "OPEN"].includes(status)) go("/mercado");
  const w = await db.whiteSpace.update({ where: { id: wsId }, data: { status, note: txt(fd, "note", 300), resolvedAt: status === "RESOLVED" || status === "NOT_RELEVANT" ? new Date() : null } });
  go(w.explorationId ? ws(w.explorationId, "ok=white") : "/mercado?ok=white");
}

/** A plant is an operating site with its own processes and people, not an address. */
export async function addPlant(id: string, fd: FormData) {
  const user = await requireUser();
  const accountId = idOf(fd, "accountId"), name = txt(fd, "name", 120);
  if (!accountId || !name) go(ws(id, "err=planta"));
  await db.plant.create({ data: { accountId: accountId!, name: name!, city: txt(fd, "city", 80), country: txt(fd, "country", 60), operationType: txt(fd, "operationType", 200), sourceType: asSource(txt(fd, "sourceType", 30)), sourceRef: txt(fd, "sourceRef", 300), observedAt: dayOf(fd.get("observedAt")) ?? new Date(), confidence: asConfidence(txt(fd, "confidence", 20)), capturedByName: user.name } });
  go(ws(id, "ok=planta"));
}

/** Future Opportunity (v2.2 §41): a future event that is not a Need or a quote yet. No price required, no probability. */
export async function addFuture(fd: FormData) {
  const user = await requireUser();
  const description = txt(fd, "description", 400);
  const explorationId = idOf(fd, "explorationId");
  const back = explorationId ? ws(explorationId) : "/mercado";
  if (!description) go(`${back}${back.includes("?") ? "&" : "?"}err=futuro`);
  await db.futureOpportunity.create({
    data: {
      kind: asFutureKind(txt(fd, "kind", 20)), description: description!, accountId: idOf(fd, "accountId"), plantId: idOf(fd, "plantId"), explorationId,
      process: txt(fd, "process", 120), expectedAt: dayOf(fd.get("expectedAt")), triggerEvent: txt(fd, "triggerEvent", 200), impact: txt(fd, "impact", 300),
      valueBasis: txt(fd, "valueBasis", 200), nextMove: txt(fd, "nextMove", 200), ownerId: user.id,
      sourceType: asSource(txt(fd, "sourceType", 30)), sourceRef: txt(fd, "sourceRef", 300), observedAt: dayOf(fd.get("observedAt")) ?? new Date(), confidence: asConfidence(txt(fd, "confidence", 20)), capturedByName: user.name,
    },
  });
  go(`${back}${back.includes("?") ? "&" : "?"}ok=futuro`);
}
/** Closed or no longer expected: it stops being future and stays as learning. */
export async function closeFuture(futureId: string, fd: FormData) {
  await requireUser();
  const note = txt(fd, "note", 300);
  const f = await db.futureOpportunity.findUnique({ where: { id: futureId }, select: { explorationId: true } });
  if (!f) go("/mercado");
  const back = f!.explorationId ? ws(f!.explorationId) : "/mercado";
  if (!note) go(`${back}${back.includes("?") ? "&" : "?"}err=cierre`);
  await db.futureOpportunity.update({ where: { id: futureId }, data: { status: "CLOSED", closedNote: note } });
  go(`${back}${back.includes("?") ? "&" : "?"}ok=futuro-cerrado`);
}
