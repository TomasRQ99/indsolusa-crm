"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { addDays } from "@/lib/domain";
import { fDay, fMoney, fText } from "@/lib/fd";
import { delegationIssues } from "@/lib/admin-rules";
import { getAdminPolicy } from "@/lib/admin-store";
import { getPurchasePolicy } from "@/lib/pr-auth";

// Módulo 14 §16 · Temporary delegated authority. Gerencia approves it (never the person who receives it). It names
// the domain, the limit, the dates and the reason. It ends by itself: nothing has to be switched off. More time is
// a new version that points to the earlier one; a version is never edited (AC "a delegation cannot survive beyond
// its end date without an explicit new version").

const go = (qs: string): never => { refreshApp(); redirect(`/administracion/autoridad?${qs}`); };

export async function grantAuthority(fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=gerencia");
  const s = fDay(fd, "startsOn"), e = fDay(fd, "endsOn");
  const [from, to, pol, purchase] = await Promise.all([
    db.user.findFirst({ where: { id: String(fd.get("fromUserId") ?? ""), active: true }, select: { id: true, role: true } }),
    db.user.findFirst({ where: { id: String(fd.get("toUserId") ?? ""), active: true }, select: { id: true } }),
    getAdminPolicy(), getPurchasePolicy(),
  ]);
  if (!from || !to || !s || !e) go("err=datos#nueva");
  const d = { fromUserId: from!.id, toUserId: to!.id, fromRole: from!.role, domain: String(fd.get("domain") ?? ""), startsAt: s!, endsAt: addDays(e!, 1), reason: fText(fd, "reason", 400) ?? "", approvedById: user.id };
  const issues = delegationIssues(d, pol.value, purchase.value);
  if (issues.length) go(`err=regla&m=${encodeURIComponent(issues.map((x) => (user.lang === "ES" ? x.es : x.en)).join(" "))}#nueva`);
  await db.delegatedAuthority.create({ data: { fromUserId: d.fromUserId, toUserId: d.toUserId, domain: d.domain, limitUsd: fMoney(fd, "limitUsd"), scopeNote: fText(fd, "scopeNote", 300), startsAt: d.startsAt, endsAt: d.endsAt, reason: d.reason, approvedById: user.id, approvedByName: user.name } });
  go("ok=prestada");
}

/** More time: a new version that starts where the earlier one ends. */
export async function extendAuthority(id: string, fd: FormData) {
  const user = await requireUser();
  if (!isGerencia(user)) go("err=gerencia");
  const old = await db.delegatedAuthority.findUnique({ where: { id }, include: { fromUser: { select: { role: true, active: true } } } });
  const e = fDay(fd, "endsOn"), reason = fText(fd, "reason", 400);
  if (!old || old.revokedAt || !e || !reason || !old.fromUser.active) go("err=datos");
  const now = new Date();
  const startsAt = old!.endsAt > now ? old!.endsAt : now;
  const d = { fromUserId: old!.fromUserId, toUserId: old!.toUserId, fromRole: old!.fromUser.role, domain: old!.domain, startsAt, endsAt: addDays(e!, 1), reason: reason!, approvedById: user.id };
  const [pol, purchase] = await Promise.all([getAdminPolicy(), getPurchasePolicy()]);
  const issues = delegationIssues(d, pol.value, purchase.value);
  if (issues.length) go(`err=regla&m=${encodeURIComponent(issues.map((x) => (user.lang === "ES" ? x.es : x.en)).join(" "))}`);
  if (await db.delegatedAuthority.count({ where: { previousId: id } })) go("err=ya-extendida");
  await db.delegatedAuthority.create({ data: { fromUserId: d.fromUserId, toUserId: d.toUserId, domain: d.domain, limitUsd: old!.limitUsd, scopeNote: old!.scopeNote, startsAt, endsAt: d.endsAt, reason: d.reason, approvedById: user.id, approvedByName: user.name, version: old!.version + 1, previousId: id } });
  go("ok=extendida");
}

/** Take it back before its end. Gerencia, or the person who lent it. */
export async function revokeAuthority(id: string, fd: FormData) {
  const user = await requireUser();
  const d = await db.delegatedAuthority.findUnique({ where: { id }, select: { fromUserId: true, revokedAt: true } });
  const reason = fText(fd, "reason", 300);
  if (!d || !(isGerencia(user) || d.fromUserId === user.id)) go("err=gerencia");
  if (d!.revokedAt || !reason) go("err=retirar");
  await db.delegatedAuthority.update({ where: { id }, data: { revokedAt: new Date(), revokedByName: user.name, revokeReason: reason } });
  go("ok=retirada");
}
