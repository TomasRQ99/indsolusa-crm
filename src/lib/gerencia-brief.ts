import type { Role } from "@prisma/client";
import { db } from "./db";
import { addDays } from "./domain";
import { sendMail } from "./mail";
import { interventionQueue } from "./future-pulse";
import { decisionsNeeded, getGerenciaPolicy } from "./gerencia-store";
import { briefDue, briefText, briefWorthSending } from "./gerencia-rules";

// Módulo 15 §10, §19 · Email to Gerencia that the executive close is ready. Weekly on Mondays, or every working
// day when something waits, as the Gerencia policy says. It carries counts and a link, never amounts or names
// (same rule as the monthly report reminder, decision I-06). The worker plans it once per working day (one slot per
// local date, a single attempt), so nobody gets it twice.

export async function gerenciaBrief(now = new Date()) {
  const pol = await getGerenciaPolicy();
  const due = briefDue(pol.value.closeEmail, now);
  if (!due) return "nothing due now";
  const people = await db.user.findMany({ where: { role: "GERENCIA", active: true }, select: { id: true, role: true, email: true, name: true, lang: true } });
  const url = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").trim().replace(/\/+$/, "") || null;
  // The weekly close is the week that just ended: any day of it opens it.
  const ref = due.kind === "WEEKLY" ? addDays(new Date(`${due.day}T00:00:00Z`), -3).toISOString().slice(0, 10) : due.day;
  let sent = 0;
  for (const p of people) {
    if (!p.email) continue;
    const [needed, queue] = await Promise.all([decisionsNeeded({ id: p.id, role: p.role as Role }), interventionQueue(p.id, 9)]);
    const counts = { waiting: needed.shown.length + needed.later.length, review: needed.reviewDue.length, exceptions: queue.length };
    if (!briefWorthSending(due.kind, counts)) continue;
    const m = briefText(due.kind, p.lang, url, counts, ref);
    await sendMail({ to: { address: p.email, name: p.name }, subject: m.subject, text: m.text, senderName: "SOLU" });
    sent++;
  }
  return `${due.kind} ${due.day}: sent ${sent}`;
}
