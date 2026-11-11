import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { today } from "./domain";
import { sumMoney } from "./money";
import { ADMIN_POLICY_KEY, DEFAULT_ADMIN_POLICY, actingAs, budgetView, readAdminPolicy, receivedValue, threeWay, type AdminPolicy, type BudgetLine, type Delegation } from "./admin-rules";

// Módulo 14 · reads shared by the Administración screens and by the approvals of other modules.

export async function getAdminPolicy(): Promise<{ value: AdminPolicy; version: number; by: string | null; at: Date | null; reason: string | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: ADMIN_POLICY_KEY }, orderBy: { version: "desc" } });
  return s ? { value: readAdminPolicy(s.value), version: s.version, by: s.updatedByName, at: s.createdAt, reason: s.reason } : { value: DEFAULT_ADMIN_POLICY, version: 0, by: null, at: null, reason: null };
}

// ---------- Delegated authority (§16) ----------

const delegationSelect = { id: true, fromUserId: true, toUserId: true, domain: true, limitUsd: true, startsAt: true, endsAt: true, revokedAt: true, fromUser: { select: { name: true, role: true, active: true } } } satisfies Prisma.DelegatedAuthoritySelect;
/** Delegations lent to this person that are in force now. Read on every use, so an expired one simply isn't there. */
export async function delegationsTo(userId: string, now = new Date()): Promise<Delegation[]> {
  const rows = await db.delegatedAuthority.findMany({ where: { toUserId: userId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, select: delegationSelect });
  // If the lender left or was deactivated, what they lent stops with them.
  return rows.filter((r) => r.fromUser.active).map((r) => ({ id: r.id, fromUserId: r.fromUserId, fromRole: r.fromUser.role, fromName: r.fromUser.name, toUserId: r.toUserId, domain: r.domain, limitUsd: r.limitUsd == null ? null : Number(r.limitUsd), startsAt: r.startsAt, endsAt: r.endsAt, revokedAt: r.revokedAt }));
}
/** May this person act in `domain` for this amount, with their own role or with one lent to them? `test` is the
 *  module's own rule applied to a role. Returns which delegation was used, so the decision can record it. */
export async function actWith(u: { id: string; role: string }, domain: string, amountUsd: number | null, requesterId: string | null, test: (role: string) => boolean) {
  if (test(u.role)) {
    // Módulo 16 §26 AC4: the policy says yes; when Gerencia switched the rule on, the role agreement must name it too.
    // This answers and never redirects, because screens ask the same question to decide whether to show the buttons.
    // An authority someone lent (below) is the lender's, so it is not narrowed by the receiver's agreement.
    const { roleAuthority } = await import("./role-authority");
    if (!(await roleAuthority(u, domain)).blocked) return { ok: true, delegationId: null as string | null, fromName: null as string | null };
  }
  const now = new Date();
  const hit = actingAs(u, domain, amountUsd, await delegationsTo(u.id, now), now, requesterId).find((c) => c.delegationId && test(c.role));
  return hit ? { ok: true, delegationId: hit.delegationId, fromName: hit.fromName } : { ok: false, delegationId: null, fromName: null };
}

// ---------- Budgets (§2F) ----------

const budgetInclude = {
  owner: { select: { id: true, name: true } },
  entries: { orderBy: { on: "desc" } },
  purchases: { where: { status: { in: ["REQUESTED", "RETURNED", "APPROVED"] } }, select: { id: true, code: true, description: true, amountUsd: true, status: true, boughtAt: true, decidedAt: true, createdAt: true } },
  missions: { where: { budgetStatus: { in: ["REQUESTED", "APPROVED"] } }, select: { id: true, title: true, budgetStatus: true, budgetAmount: true, budgetApproved: true, expensesStatus: true, settledAt: true, budgetDecidedAt: true, expenses: { select: { amount: true, outcome: true } } } },
} satisfies Prisma.BudgetInclude;
type BudgetFull = Prisma.BudgetGetPayload<{ include: typeof budgetInclude }>;
/** Every line that uses up a budget, from the records that create it (never typed twice). */
export function budgetLines(b: BudgetFull): BudgetLine[] {
  const out: BudgetLine[] = [];
  for (const p of b.purchases) out.push({ kind: p.status !== "APPROVED" ? "ASKED" : p.boughtAt ? "SPENT" : "COMMITTED", amount: Number(p.amountUsd), label: `${p.code} · ${p.description}`, href: `/administracion/compras-internas/${p.id}`, on: p.boughtAt ?? p.decidedAt ?? p.createdAt });
  for (const m of b.missions) {
    const done = m.expensesStatus === "RECONCILED" || !!m.settledAt;
    if (m.budgetStatus === "REQUESTED") out.push({ kind: "ASKED", amount: Number(m.budgetAmount ?? 0), label: m.title, href: `/visitas/mision/${m.id}`, on: null });
    else if (done) out.push({ kind: "SPENT", amount: sumMoney(m.expenses.filter((e) => e.outcome !== "REJECTED").map((e) => e.amount)), label: m.title, href: `/visitas/mision/${m.id}`, on: m.settledAt });
    else out.push({ kind: "COMMITTED", amount: Number(m.budgetApproved ?? 0), label: m.title, href: `/visitas/mision/${m.id}`, on: m.budgetDecidedAt });
  }
  for (const e of b.entries) if (!(e.kind === "COMMITTED" && e.closedAt)) out.push({ kind: e.kind === "SPENT" ? "SPENT" : "COMMITTED", amount: Number(e.amount), label: e.description, href: null, on: e.on });
  return out;
}
export async function loadBudgets(where: Prisma.BudgetWhereInput = {}) {
  const rows = await db.budget.findMany({ where, include: budgetInclude, orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { periodTo: "desc" }] });
  return rows.map((b) => { const lines = budgetLines(b); return { ...b, lines, view: budgetView(b, lines) }; });
}
export type BudgetRow = Awaited<ReturnType<typeof loadBudgets>>[number];
/** What a budget has left right now, leaving one purchase out (the one being decided). */
export async function budgetAvailable(budgetId: string, exceptPurchaseId?: string) {
  const [b] = await loadBudgets({ id: budgetId });
  if (!b) return null;
  const lines = b.lines.filter((l) => !(exceptPurchaseId && l.href === `/administracion/compras-internas/${exceptPurchaseId}`));
  return budgetView(b, lines).available;
}

// ---------- Accounts payable (§2D) ----------

const apInclude = {
  supplier: { select: { id: true, name: true } },
  supplierPo: { select: { id: true, code: true, amount: true, currency: true, releasedAt: true, dealId: true, lines: { select: { position: true, qty: true, unitCost: true } }, receipts: { select: { code: true, receivedAt: true, lines: { select: { position: true, qtyReceived: true } } } }, supplierInvoices: { select: { id: true, amount: true } }, deal: { select: { code: true, internal: true, account: { select: { name: true } } } } } },
  internalPurchase: { select: { id: true, code: true, description: true, status: true, amount: true, boughtAt: true } },
} satisfies Prisma.SupplierInvoiceInclude;
export async function loadSupplierInvoices(where: Prisma.SupplierInvoiceWhereInput = {}) {
  const [rows, pol] = await Promise.all([db.supplierInvoice.findMany({ where, include: apInclude, orderBy: [{ paidAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }], take: 300 }), getAdminPolicy()]);
  const T = today();
  return rows.map((r) => {
    const po = r.supplierPo;
    const ip = r.internalPurchase;
    const orderAmount = po ? Number(po.amount) : ip && ip.status === "APPROVED" ? Number(ip.amount) : null;
    const received = po ? receivedValue(po.lines, po.receipts.flatMap((x) => x.lines)) : ip?.boughtAt ? Number(ip.amount) : ip ? 0 : null;
    const invoicedTotal = po ? sumMoney(po.supplierInvoices.map((x) => x.amount)) : Number(r.amount);
    const match = threeWay({ kind: r.kind, orderAmount, receivedValue: received, invoicedTotal, serviceAccepted: !!r.serviceAcceptedAt, exceptionAccepted: !!r.exceptionAt }, pol.value.apToleranceUsd);
    return { ...r, orderAmount, received, invoicedTotal, match, late: !r.paidAt && !!r.dueAt && r.dueAt < T };
  });
}
export type ApRow = Awaited<ReturnType<typeof loadSupplierInvoices>>[number];

/** IP-2611-0003: internal purchases, one sequence per month. */
export async function nextInternalCode(prefix: "IP" | "AS", tx: Prisma.TransactionClient = db) {
  const d = new Date();
  const start = `${prefix}-${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}-`;
  const last = prefix === "IP" ? await tx.internalPurchase.findFirst({ where: { code: { startsWith: start } }, orderBy: { code: "desc" }, select: { code: true } }) : await tx.asset.findFirst({ where: { code: { startsWith: start } }, orderBy: { code: "desc" }, select: { code: true } });
  return `${start}${String((last?.code ? Number(last.code.slice(start.length)) : 0) + 1).padStart(4, "0")}`;
}
