"use server";

import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { fPick, fText } from "@/lib/fd";
import { SCENARIO_KINDS, readOptions, scenarioIssues } from "@/lib/gerencia-rules";

// Módulo 15 §7 · Scenarios. A scenario compares options before a decision; it is never a forecast. Facts are typed
// apart from assumptions and every option carries a range (AC8). The decision itself is a Management Decision Record.

const go = (qs: string): never => { refreshApp(); redirect(`/gerencia/escenarios?${qs}`); };
const innerHref = (v: string | null) => (v && /^\/[A-Za-z0-9/_\-?=&#.%]*$/.test(v) && !v.startsWith("//") ? v.slice(0, 300) : null);

export async function saveScenario(id: string | null, fd: FormData) {
  const user = await requireUser();
  if (!canManageAll(user)) go("err=permiso");
  const s = {
    title: fText(fd, "title", 160), question: fText(fd, "question", 300), facts: fText(fd, "facts", 3000), measure: fText(fd, "measure", 160),
    options: readOptions((k) => String(fd.get(k) ?? "")),
  };
  const issues = scenarioIssues(s);
  if (issues.length) go(`err=faltan&f=${issues.join(",")}#${id ? `s-${id}` : "nuevo"}`);
  const sourceHref = innerHref(fText(fd, "sourceHref", 300));
  const data = { title: s.title!, question: s.question!, kind: fPick(fd, "kind", SCENARIO_KINDS) ?? "OTHER", facts: s.facts!, measure: s.measure!, options: s.options as unknown as Prisma.InputJsonValue, sourceHref, sourceLabel: sourceHref ? fText(fd, "sourceLabel", 160) ?? sourceHref : null };
  if (id) {
    // Once a decision was taken on it, a scenario is evidence and stays as it was.
    const n = await db.scenario.updateMany({ where: { id, status: "OPEN", ...(isGerencia(user) ? {} : { createdById: user.id }) }, data });
    if (n.count !== 1) go(`err=cerrado#s-${id}`);
    go(`ok=guardado#s-${id}`);
  }
  const created = await db.scenario.create({ data: { ...data, createdById: user.id, createdByName: user.name } });
  go(`ok=creado#s-${created.id}`);
}

export async function archiveScenario(id: string) {
  const user = await requireUser();
  const s = await db.scenario.findUnique({ where: { id }, select: { createdById: true, status: true } });
  if (!s || !(isGerencia(user) || s.createdById === user.id)) go("err=permiso");
  if (s!.status !== "OPEN") go(`err=cerrado#s-${id}`);
  await db.scenario.update({ where: { id }, data: { status: "ARCHIVED" } });
  go("ok=archivado");
}
