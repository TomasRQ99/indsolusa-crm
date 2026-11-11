"use server";

// Comercial C2 · Eságara Protection Gate commands: request, decide (approve / return / reject), answer, policy.
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { costOf, saleOf } from "@/lib/quote";
import { approverContext, canApprove, COM_POLICY_KEY, getComPolicy, APPROVER_ROLES } from "@/lib/esagara-gate";
import { DEFAULT_COM_POLICY, gateOf, requestProblems } from "@/lib/esagara-rules";

const txt = (fd: FormData, k: string, max = 1000) => { const v = String(fd.get(k) ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); return v || null; };
const backOf = (fd: FormData, fallback: string) => { const b = txt(fd, "back", 300) ?? fallback; return b.startsWith("/") && !b.startsWith("//") ? b : fallback; };
const go = (path: string, qs: string): never => { refreshApp(); const [p, h] = path.split("#"); redirect(`${p}${p.includes("?") ? "&" : "?"}${qs}#${h ?? "esagara"}`); };
type H = { at: string; by: string; action: string; text: string | null };
const push = (h: unknown, e: H) => [...(Array.isArray(h) ? (h as H[]) : []), e] as unknown as Prisma.InputJsonValue;

async function currentGate(quoteId: string) {
  const q = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { lines: true, deal: { select: { id: true, ownerId: true, accountId: true } } } });
  const pol = await getComPolicy();
  return { q, pol, g: gateOf(saleOf(q.lines), costOf(q), pol.value) };
}

/** LOW_ESAGARA_EXCEPTION_REQUESTED: reason + narrative + expected benefit + frozen economics (§45). */
export async function requestException(quoteId: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, `/cotizaciones/${quoteId}`);
  const { q, pol, g } = await currentGate(quoteId);
  if (!canEdit(user, q.deal.ownerId)) go(back, "err=exc-permiso");
  if (q.status !== "DRAFT") go(back, "err=exc-estado");
  if (!g.triggered) go(back, "err=exc-no-aplica");
  if (await db.esagaraException.count({ where: { quoteId, status: "REQUESTED" } })) go(back, "err=exc-pendiente");
  const r = { reasonCode: txt(fd, "reasonCode", 40) ?? "", narrative: txt(fd, "narrative", 1200) ?? "", expectedBenefit: txt(fd, "expectedBenefit", 600) ?? "", scope: txt(fd, "scope", 20) ?? "" };
  const problems = requestProblems(r);
  if (problems.length) go(back, `err=exc-${problems[0]}`);
  const snapshot = await approverContext(quoteId);
  await db.esagaraException.create({
    data: {
      quoteId, dealId: q.deal.id, accountId: q.deal.accountId, saleAmount: g.sale, esagaraAmount: g.esagara, esagaraPct: g.pct ?? 0, thresholdPct: g.threshold, policyVersion: pol.version,
      ...r, alternatives: txt(fd, "alternatives", 600), snapshot: { ...snapshot, gate: g } as unknown as Prisma.InputJsonValue,
      requestedById: user.id, requestedByName: user.name,
      history: [{ at: new Date().toISOString(), by: user.name, action: "REQUESTED", text: r.narrative }],
    },
  });
  go(back, "ok=exc-pedida");
}

/** LOW_ESAGARA_EXCEPTION_APPROVED / REJECTED / RETURNED. Only MANAGER/ADMIN, never the requester; on the exact version requested. */
export async function decideException(id: string, fd: FormData) {
  const user = await requireUser();
  const back = backOf(fd, "/comercial/esagara");
  const e = await db.esagaraException.findUniqueOrThrow({ where: { id } });
  if (!canApprove(user, e)) go(back, "err=exc-autoridad");
  await (await import("@/lib/role-authority")).assertRoleAuthority(user, "ESAGARA");
  if (e.status !== "REQUESTED") go(back, "err=exc-decidida");
  const action = txt(fd, "action", 10);
  const comments = txt(fd, "comments", 800);
  if (action !== "APPROVE" && action !== "RETURN" && action !== "REJECT") go(back, "err=exc-accion");
  if (action !== "APPROVE" && !comments) go(back, "err=exc-comentario");
  const { q, g } = await currentGate(e.quoteId);
  if (q.status !== "DRAFT") {
    await db.esagaraException.update({ where: { id }, data: { status: "EXPIRED", history: push(e.history, { at: new Date().toISOString(), by: "SOLU", action: "EXPIRED", text: "La cotización ya no es un borrador" }) } });
    go(back, "err=exc-vencida");
  }
  // §49: the approver approves the exact economics that will reach the customer. If they moved, the requester must refresh.
  if (action === "APPROVE" && (Math.abs(g.sale - Number(e.saleAmount)) > 0.005 || Math.abs((g.pct ?? 0) - Number(e.esagaraPct)) > 0.005)) go(back, "err=exc-cambio");
  const status = action === "APPROVE" ? "APPROVED" : action === "RETURN" ? "RETURNED" : "REJECTED";
  await db.esagaraException.update({ where: { id }, data: { status, decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), comments, history: push(e.history, { at: new Date().toISOString(), by: user.name, action: status, text: comments }) } });
  await db.activity.create({ data: { type: "NOTE", subject: `Excepción de Eságara ${status === "APPROVED" ? "aprobada" : status === "RETURNED" ? "devuelta con pregunta" : "rechazada"} · ${Number(e.esagaraPct).toFixed(2)} %`, body: comments, userId: user.id, accountId: e.accountId, dealId: e.dealId, phase: "quote", source: "Eságara" } });
  go(back, `ok=exc-${status.toLowerCase()}`);
}

/** The requester answers a returned request; it goes back to the approver with the current economics. */
export async function answerException(id: string, fd: FormData) {
  const user = await requireUser();
  const e = await db.esagaraException.findUniqueOrThrow({ where: { id } });
  const back = backOf(fd, `/cotizaciones/${e.quoteId}`);
  if (e.requestedById !== user.id) go(back, "err=exc-permiso");
  if (e.status !== "RETURNED") go(back, "err=exc-decidida");
  const answer = txt(fd, "answer", 1200);
  if (!answer) go(back, "err=exc-respuesta");
  const { q, g } = await currentGate(e.quoteId);
  if (q.status !== "DRAFT") go(back, "err=exc-estado");
  if (!g.triggered) go(back, "err=exc-no-aplica");
  const snapshot = await approverContext(e.quoteId);
  await db.esagaraException.update({
    where: { id },
    data: { status: "REQUESTED", saleAmount: g.sale, esagaraAmount: g.esagara, esagaraPct: g.pct ?? 0, snapshot: { ...snapshot, gate: g } as unknown as Prisma.InputJsonValue, decidedById: null, decidedByName: null, decidedAt: null, history: push(e.history, { at: new Date().toISOString(), by: user.name, action: "ANSWERED", text: answer }) },
  });
  go(back, "ok=exc-respondida");
}

/** COMMERCIAL_AUTHORITY_POLICY_CHANGED: a new version; past decisions keep the version they used. */
export async function saveComPolicy(fd: FormData) {
  const user = await requireUser();
  if (!APPROVER_ROLES.includes(user.role)) go("/comercial/esagara#politica", "err=exc-autoridad");
  const n = (k: string, min: number, max: number) => { const v = Number(String(fd.get(k) ?? "").replace(",", ".")); return Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : null; };
  const value = { minEsagaraPct: n("minEsagaraPct", 0, 90), reapproveDropPts: n("reapproveDropPts", 0, 20), reapproveAmountPct: n("reapproveAmountPct", 0, 50) };
  if (Object.values(value).some((v) => v == null)) go("/comercial/esagara#politica", "err=pol-valor");
  const cur = await getComPolicy();
  const same = (Object.keys(DEFAULT_COM_POLICY) as (keyof typeof value)[]).every((k) => cur.value[k] === value[k]);
  if (same) go("/comercial/esagara#politica", "ok=pol-igual");
  await db.marketSetting.create({ data: { key: COM_POLICY_KEY, version: cur.version + 1, value, updatedByName: user.name } });
  go("/comercial/esagara#politica", "ok=pol-guardada");
}
