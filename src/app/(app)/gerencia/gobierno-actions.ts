"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia, WORK_ROLES as ROLES } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fDay, fPick, fText } from "@/lib/fd";
import { FUNCTIONS, GERENCIA_POLICY_KEY, canPublish, changedFields, charterIssues, cleanGerenciaPolicy, identityIssues, parseInterfaces, parseLines, parsePairs } from "@/lib/gerencia-rules";
import { charterVersions, getGerenciaPolicy, identityVersions } from "@/lib/gerencia-store";

// Módulo 15 §8, §22–23, §26 · Governance. Only the authority named in the Gerencia policy publishes the company
// identity or a function charter. Publishing never edits: it writes a new version with its date, reason and approver,
// and every earlier version stays readable, so what a role was built on is never rewritten later.

const go = (path: string): never => { refreshApp(); redirect(path); };

async function publisher(back: string) {
  const user = await requireUser();
  const pol = await getGerenciaPolicy();
  if (!canPublish(user.role, pol.value)) go(`${back}?err=autoridad`);
  return user;
}

const IDENTITY_FIELDS = ["purpose", "slogan", "valueProposition", "attributes", "principles", "methodologies"] as const;
export async function publishIdentity(fd: FormData) {
  const back = "/gerencia/identidad";
  const user = await publisher(back);
  const input = {
    purpose: fText(fd, "purpose", 300), slogan: fText(fd, "slogan", 300), valueProposition: fText(fd, "valueProposition", 2000), attributes: parseLines(fText(fd, "attributes", 3000), 20),
    principles: parsePairs(fText(fd, "principles", 4000), 12), methodologies: parsePairs(fText(fd, "methodologies", 4000), 12), effectiveFrom: fDay(fd, "effectiveFrom"), reason: fText(fd, "reason", 1000),
  };
  const issues = identityIssues(input);
  if (issues.length) go(`${back}?err=faltan&f=${issues.join(",")}#publicar`);
  const all = await identityVersions();
  const next = {
    purpose: input.purpose!, slogan: input.slogan!, valueProposition: input.valueProposition!, attributes: input.attributes,
    principles: input.principles.map((p) => ({ name: p.name, meaning: p.detail })), methodologies: input.methodologies.map((m) => ({ name: m.name, description: m.detail })),
  };
  if (all[0] && changedFields(all[0] as unknown as Record<string, unknown>, next, IDENTITY_FIELDS).length === 0) go(`${back}?ok=igual`);
  await db.companyIdentity.create({ data: { ...next, attributes: next.attributes as Prisma.InputJsonValue, principles: next.principles as Prisma.InputJsonValue, methodologies: next.methodologies as Prisma.InputJsonValue, version: (all[0]?.version ?? 0) + 1, effectiveFrom: input.effectiveFrom!, reason: input.reason!, approvedById: user.id, approvedByName: user.name } });
  go(`${back}?ok=publicada`);
}

const CHARTER_FIELDS = ["contribution", "outputs", "responsibilities", "decisionRights", "interfaces", "resources", "ownerId"] as const;
export async function publishCharter(fd: FormData) {
  const back = "/gerencia/funciones";
  const user = await publisher(back);
  const key = fPick(fd, "functionKey", FUNCTIONS);
  const interfaces = parseInterfaces(fText(fd, "interfaces", 3000));
  // The purpose of each function is frozen by the official documents: it is copied, never typed.
  const input = { functionKey: key, purpose: key ? FUNCTIONS[key].purpose : null, effectiveFrom: fDay(fd, "effectiveFrom"), reason: fText(fd, "reason", 1000), interfaces };
  const issues = charterIssues(input);
  if (issues.length) go(`${back}?err=faltan&f=${issues.join(",")}&fn=${key ?? ""}#f-${key ?? ""}`);
  const owner = await db.user.findFirst({ where: { id: String(fd.get("ownerId") ?? ""), active: true }, select: { id: true } });
  const next = {
    contribution: fText(fd, "contribution", 1000), outputs: parseLines(fText(fd, "outputs", 3000), 20), responsibilities: parseLines(fText(fd, "responsibilities", 4000), 30), decisionRights: parseLines(fText(fd, "decisionRights", 4000), 30),
    interfaces: interfaces.map((x) => ({ with: x.name, what: x.detail })), resources: fText(fd, "resources", 1500), ownerId: owner?.id ?? null,
  };
  const last = (await charterVersions()).find((c) => c.functionKey === key);
  if (last && changedFields(last as unknown as Record<string, unknown>, next, CHARTER_FIELDS).length === 0) go(`${back}?ok=igual#f-${key}`);
  await db.functionCharter.create({ data: { ...next, outputs: next.outputs as Prisma.InputJsonValue, responsibilities: next.responsibilities as Prisma.InputJsonValue, decisionRights: next.decisionRights as Prisma.InputJsonValue, interfaces: next.interfaces as Prisma.InputJsonValue, functionKey: key!, version: (last?.version ?? 0) + 1, purpose: input.purpose!, effectiveFrom: input.effectiveFrom!, reason: input.reason!, publishedById: user.id, publishedByName: user.name } });
  go(`${back}?ok=publicada#f-${key}`);
}

/** The Gerencia policy itself: Gerencia only, a new version with its reason, in force from the moment it is saved. */
export async function saveGerenciaPolicy(fd: FormData) {
  const back = "/gerencia/politicas";
  const user = await requireUser();
  if (!isGerencia(user)) go(`${back}?err=gerencia#gerencia`);
  const value = cleanGerenciaPolicy({ ...Object.fromEntries(fd.entries()), publishRoles: fd.getAll("publishRoles").map(String) }, ROLES);
  const reason = fText(fd, "reason", 300);
  if (!value) go(`${back}?err=valores#gerencia`);
  if (!reason) go(`${back}?err=motivo#gerencia`);
  const cur = await getGerenciaPolicy();
  if (cur.version > 0 && JSON.stringify(cur.value) === JSON.stringify(value)) go(`${back}?ok=igual#gerencia`);
  await db.marketSetting.create({ data: { key: GERENCIA_POLICY_KEY, version: cur.version + 1, value: value as unknown as Prisma.InputJsonValue, updatedByName: user.name, reason } });
  go(`${back}?ok=guardada#gerencia`);
}
