import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, today } from "./domain";
import { promiseStatus } from "./cash-rules";
import { obligationView } from "./admin-rules";
import { getAdminPolicy } from "./admin-store";

// Módulo 14 §10 · the events that depend on the passing of time, not on a change someone made: a payment promise
// whose day has passed (kept or missed, judged only against reconciled cash) and an obligation whose decision is
// coming. Each one is written once: the job looks for its own earlier event before writing.

export async function adminDaily() {
  const T = today();
  const pol = await getAdminPolicy();
  const [promises, obligations, earlier] = await Promise.all([
    db.paymentPromise.findMany({ where: { promisedFor: { lt: T, gte: addDays(T, -60) } }, select: { id: true, promisedFor: true, createdAt: true, amount: true, replacedAt: true, invoiceId: true, invoice: { select: { amount: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } } } } } }),
    db.obligation.findMany({ where: { status: "ACTIVE", endsOn: { not: null } } }),
    db.domainEvent.findMany({ where: { name: { in: ["payment.promise_fulfilled", "payment.promise_missed", "obligation.due_approaching"] }, occurredAt: { gte: addDays(T, -400) } }, select: { name: true, entityId: true, payload: true } }),
  ]);
  const seen = new Set(earlier.map((e) => `${e.name.startsWith("payment") ? "p" : "o"}|${e.entityId}|${(e.payload as { term?: string } | null)?.term ?? ""}`));
  const out: Prisma.DomainEventCreateManyInput[] = [];
  for (const p of promises) {
    if (seen.has(`p|${p.id}|`)) continue;
    const st = promiseStatus({ promisedFor: p.promisedFor, createdAt: p.createdAt, amount: p.amount == null ? null : Number(p.amount), replacedAt: p.replacedAt }, { amount: Number(p.invoice.amount), apps: p.invoice.applications.map((a) => ({ amount: Number(a.amount), reconciled: !!a.payment.reconciledAt, receivedAt: a.payment.receivedAt })) }, T);
    if (st.status === "KEPT") out.push({ name: "payment.promise_fulfilled", entity: "PaymentPromise", entityId: p.id, payload: { invoiceId: p.invoiceId, got: st.got, target: st.target }, actorName: "Sistema" });
    else if (st.status === "MISSED" || st.status === "PARTIALLY_KEPT") out.push({ name: "payment.promise_missed", entity: "PaymentPromise", entityId: p.id, payload: { invoiceId: p.invoiceId, got: st.got, target: st.target }, actorName: "Sistema" });
  }
  for (const o of obligations) {
    const v = obligationView({ ...o, amount: o.amount == null ? null : Number(o.amount) }, T, pol.value);
    // One event per term: the same obligation alerts again only for a new end date.
    const term = o.endsOn!.toISOString().slice(0, 10);
    if (!v.alert || seen.has(`o|${o.id}|${term}`)) continue;
    out.push({ name: "obligation.due_approaching", entity: "Obligation", entityId: o.id, payload: { term, noticeBy: v.noticeBy?.toISOString().slice(0, 10) ?? null, state: v.state }, actorName: "Sistema" });
  }
  if (out.length) await db.domainEvent.createMany({ data: out });
  return `events ${out.length}`;
}
