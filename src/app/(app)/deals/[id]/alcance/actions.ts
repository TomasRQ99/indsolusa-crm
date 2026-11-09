"use server";

// Comercial C1 · Technical & Scope commands: ADD_SCOPE_LINE, CONFIRM_TECHNICAL_FACT, CONFIRM_FUNCTIONAL_SCOPE, relationships.
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { CONDITION, FAMILIES, IDENTITY, REL_KINDS, STATUS, familyOf, inQuote, keyOf } from "@/lib/scope-rules";

const txt = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const page = (dealId: string) => `/deals/${dealId}/alcance`;
const go = (dealId: string, qs: string, hash = ""): never => { refreshApp(); redirect(`${page(dealId)}?${qs}${hash ? `#${hash}` : ""}`); };
const pick = <T extends Record<string, unknown>>(v: string | null, map: T, def: keyof T & string) => (v && v in map ? v : def);

async function guard(dealId: string): Promise<SessionUser> {
  const user = await requireUser();
  const d = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { ownerId: true } });
  if (!canEditOps(user, d.ownerId)) go(dealId, "err=permiso");
  return user;
}

function lineData(fd: FormData) {
  const component = txt(fd, "component", 160);
  const code = txt(fd, "code", 60);
  const fam = txt(fd, "family", 30);
  const qty = Math.max(1, Math.min(100000, Math.round(Number(fd.get("qty") ?? 1) || 1)));
  return {
    component, code, qty, manufacturer: txt(fd, "manufacturer", 80),
    family: fam && fam in FAMILIES ? fam : fam === "-" ? null : familyOf(`${component ?? ""} ${code ?? ""}`),
    requested: fd.get("requested") === "1", requiredForFunction: fd.get("requiredForFunction") === "1",
    status: pick(txt(fd, "status", 20), STATUS, "TO_CONFIRM"), identity: pick(txt(fd, "identity", 20), IDENTITY, "UNKNOWN"),
    condition: txt(fd, "condition", 20) && (txt(fd, "condition", 20)! in CONDITION) ? txt(fd, "condition", 20) : null,
    alternativesAllowed: fd.get("alternativesAllowed") === "1", note: txt(fd, "note", 500), source: txt(fd, "source", 200),
  };
}

export async function addScopeLine(dealId: string, fd: FormData) {
  const user = await guard(dealId);
  const data = lineData(fd);
  if (!data.component) go(dealId, "err=componente", "matriz");
  const position = await db.scopeLine.count({ where: { dealId } });
  await db.scopeLine.create({ data: { ...data, component: data.component!, dealId, position, createdByName: user.name } });
  go(dealId, "ok=linea", "matriz");
}

export async function updateScopeLine(lineId: string, fd: FormData) {
  const l = await db.scopeLine.findUniqueOrThrow({ where: { id: lineId } });
  await guard(l.dealId);
  const data = lineData(fd);
  if (!data.component) go(l.dealId, "err=componente", `l-${lineId}`);
  // A change of status on a customer-confirmed line drops that confirmation: the customer confirmed the old state.
  const keepConf = data.status === l.status;
  await db.scopeLine.update({ where: { id: lineId }, data: { ...data, component: data.component!, confirmationId: keepConf ? l.confirmationId : null } });
  go(l.dealId, "ok=linea", `l-${lineId}`);
}

export async function removeScopeLine(lineId: string) {
  const l = await db.scopeLine.findUniqueOrThrow({ where: { id: lineId } });
  await guard(l.dealId);
  await db.scopeLine.delete({ where: { id: lineId } });
  go(l.dealId, "ok=quitada", "matriz");
}

/** Start the matrix from what is already quoted: requested + included, identity kept honest. */
export async function importQuoteLines(dealId: string) {
  const user = await guard(dealId);
  const qs = await db.quote.findMany({ where: { dealId }, orderBy: { createdAt: "desc" }, include: { lines: { orderBy: { position: "asc" } } } });
  const q = qs.find((x) => x.status === "DRAFT") ?? qs.find((x) => x.status !== "SUPERSEDED") ?? qs[0];
  if (!q) go(dealId, "err=sin-cotizacion", "matriz");
  const existing = await db.scopeLine.findMany({ where: { dealId } });
  let position = existing.length;
  let n = 0;
  for (const ql of q!.lines) {
    if (existing.some((e) => inQuote(e, [{ code: ql.code, description: ql.description }]) || (ql.code && e.code && keyOf(e.code) === keyOf(ql.code)))) continue;
    await db.scopeLine.create({ data: { dealId, position: position++, component: ql.description.slice(0, 160), code: ql.code, qty: ql.qty, family: familyOf(`${ql.description} ${ql.code ?? ""}`), requested: true, requiredForFunction: true, status: "INCLUDED", identity: ql.code ? "PROBABLE" : "UNKNOWN", source: `Cotización ${q!.number}${q!.rev ? ` Rev. ${q!.rev}` : ""}`, createdByName: user.name } });
    n++;
  }
  go(dealId, `ok=importadas&n=${n}`, "matriz");
}

/** CONFIRM_TECHNICAL_FACT: a new value supersedes the previous one for the same field; history stays. */
export async function addFact(lineId: string, fd: FormData) {
  const l = await db.scopeLine.findUniqueOrThrow({ where: { id: lineId } });
  const user = await guard(l.dealId);
  const key = txt(fd, "key", 40);
  const value = txt(fd, "value", 200);
  const source = txt(fd, "source", 120);
  if (!key || !value || !source) go(l.dealId, "err=dato", `l-${lineId}`);
  const state = pick(txt(fd, "state", 20), { CONFIRMED: 1, REPORTED: 1, HYPOTHESIS: 1 }, "REPORTED");
  await db.$transaction([
    db.technicalFact.updateMany({ where: { scopeLineId: lineId, key: key!, supersededAt: null }, data: { supersededAt: new Date() } }),
    db.technicalFact.create({ data: { dealId: l.dealId, scopeLineId: lineId, key: key!, value: value!, state, source: source!, evidence: txt(fd, "evidence", 400), recordedByName: user.name } }),
  ]);
  go(l.dealId, "ok=dato", `l-${lineId}`);
}

/** CONFIRM_FUNCTIONAL_SCOPE: what the customer confirmed, in their words; resolves terms and covers lines. */
export async function recordConfirmation(dealId: string, fd: FormData) {
  const user = await guard(dealId);
  const text = txt(fd, "text", 1200);
  const confirmedBy = txt(fd, "confirmedBy", 120);
  const channel = txt(fd, "channel", 40) ?? "EMAIL";
  const on = txt(fd, "confirmedAt", 10);
  const confirmedAt = on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? new Date(`${on}T12:00:00Z`) : new Date();
  if (!text || !confirmedBy) go(dealId, "err=confirmacion", "confirmar");
  if (confirmedAt > new Date(Date.now() + 86400000)) go(dealId, "err=fecha", "confirmar");
  const terms = fd.getAll("terms").map(String).filter((s) => /^[a-z:0-9_-]{2,60}$/i.test(s)).slice(0, 30);
  const lineIds = fd.getAll("lineIds").map(String).slice(0, 100);
  if (!terms.length && !lineIds.length) go(dealId, "err=nada", "confirmar");
  const d = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { accountId: true } });
  const c = await db.scopeConfirmation.create({ data: { dealId, text: text!, confirmedBy: confirmedBy!, channel, confirmedAt, terms, recordedByName: user.name } });
  if (lineIds.length) await db.scopeLine.updateMany({ where: { id: { in: lineIds }, dealId }, data: { confirmationId: c.id } });
  await db.activity.create({ data: { type: "NOTE", subject: `Alcance confirmado con ${confirmedBy}`, body: text, userId: user.id, accountId: d.accountId, dealId, phase: "need", source: "Alcance" } });
  go(dealId, "ok=confirmado", "confirmar");
}

export async function addRelationship(dealId: string, fd: FormData) {
  const user = await guard(dealId);
  const fromLabel = txt(fd, "fromLabel", 120);
  const toLabel = txt(fd, "toLabel", 120);
  const kind = txt(fd, "kind", 30);
  const evidence = txt(fd, "evidence", 400);
  if (!fromLabel || !toLabel || !kind || !(kind in REL_KINDS)) go(dealId, "err=relacion", "relaciones");
  if (!evidence) go(dealId, "err=evidencia", "relaciones");
  const fromKey = keyOf(fromLabel!), toKey = keyOf(toLabel!);
  await db.$transaction([
    db.productRelationship.updateMany({ where: { fromKey, toKey, kind: kind!, supersededAt: null }, data: { supersededAt: new Date() } }),
    db.productRelationship.create({ data: { fromKey, fromLabel: fromLabel!, kind: kind!, toKey, toLabel: toLabel!, evidence: evidence!, recordedByName: user.name } }),
  ]);
  go(dealId, "ok=relacion", "relaciones");
}

/** Add a component suggested by an evidenced relationship — as TO_CONFIRM, never as a decision. */
export async function addSuggested(dealId: string, fd: FormData) {
  const user = await guard(dealId);
  const label = txt(fd, "label", 160);
  const why = txt(fd, "why", 300);
  if (!label) go(dealId, "err=componente", "matriz");
  const position = await db.scopeLine.count({ where: { dealId } });
  const isCode = /\d/.test(label!) && !/\s{2,}/.test(label!) && label!.length <= 40;
  await db.scopeLine.create({ data: { dealId, position, component: label!, code: isCode ? label : null, family: familyOf(label), requested: false, requiredForFunction: true, status: "TO_CONFIRM", identity: isCode ? "PROBABLE" : "UNKNOWN", source: why, createdByName: user.name } });
  go(dealId, "ok=linea", "matriz");
}
