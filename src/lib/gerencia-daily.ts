import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, today } from "./domain";
import { materialChanges, type Watched } from "./gerencia-rules";
import { gerenciaHome, WATCHED_TEXT } from "./gerencia-home";
import { strategicAccounts } from "./gerencia-views";

// Módulo 15 §14 · the events of Gerencia that depend on the passing of time, not on something a person saved:
// a watched figure that moved materially since the last daily picture (risk or future), and a strategic account
// that asks for attention. One picture per day; each event is written once.

export async function gerenciaDaily() {
  const T = today(), day = T.toISOString().slice(0, 10);
  // The figures are the ones Gerencia sees, read with the widest view: an active Gerencia person.
  const viewer = await db.user.findFirst({ where: { role: "GERENCIA", active: true }, orderBy: { createdAt: "asc" }, select: { id: true, role: true } });
  if (!viewer) return "no active Gerencia user: nothing saved";
  const [home, accounts, prev, earlier] = await Promise.all([
    gerenciaHome(viewer), strategicAccounts(T),
    db.managementSnapshot.findFirst({ where: { day: { lt: day } }, orderBy: { day: "desc" } }),
    db.domainEvent.findMany({ where: { name: { in: ["risk.material_changed", "future_pulse.material_change", "strategic_account.attention"] }, occurredAt: { gte: addDays(T, -90) } }, select: { name: true, entityId: true, payload: true } }),
  ]);
  const data = { watched: home.watched, waiting: home.needed.all.length } satisfies { watched: Watched; waiting: number };
  await db.managementSnapshot.upsert({ where: { day }, create: { day, data }, update: { data } });

  const seen = new Set(earlier.map((e) => `${e.name}|${e.entityId}|${(e.payload as { term?: string } | null)?.term ?? ""}`));
  const out: Prisma.DomainEventCreateManyInput[] = [];
  const changes = materialChanges((prev?.data as { watched?: Watched } | null)?.watched ?? null, home.watched, home.policy.value.changePct);
  for (const c of changes) {
    const name = WATCHED_TEXT[c.key]?.group === "future" ? "future_pulse.material_change" : "risk.material_changed";
    if (seen.has(`${name}|${day}|${c.key}`)) continue;
    out.push({ name, entity: "ManagementSnapshot", entityId: day, payload: { term: c.key, figure: c.key, from: c.from, to: c.to, pct: c.pct, since: prev?.day ?? null }, actorName: "Sistema" });
  }
  for (const a of accounts.filter((x) => x.attention)) {
    // One event per situation: the same account alerts again only when its next movement or its risks change.
    const term = `${a.nextMoveOn?.toISOString().slice(0, 10) ?? "sin-fecha"}|${a.risks.length}`;
    if (seen.has(`strategic_account.attention|${a.id}|${term}`)) continue;
    out.push({ name: "strategic_account.attention", entity: "StrategicAccount", entityId: a.id, payload: { term, accountId: a.accountId, moveLate: a.moveLate, noMove: !a.nextMove, risks: a.risks.length }, actorName: "Sistema" });
  }
  if (out.length) await db.domainEvent.createMany({ data: out });
  return `picture ${day}, events ${out.length}`;
}
