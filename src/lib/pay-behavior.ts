import { db } from "./db";
import { today } from "./domain";
import { DEFAULT_PAY_RULES, PAY_FORMULA, payBehavior, payTrendSignal, toPayInvoice, type PayRules, type Trend } from "./pay-rules";

// Mercado M4 · read model over Finance/AR: invoices, contractual due dates, promises, cash and reconciliation.
// It never changes a credit limit or terms; it only shows what happened.

export async function getPayRules(): Promise<{ value: PayRules; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: "payRules" }, orderBy: { version: "desc" } });
  return s ? { value: { ...DEFAULT_PAY_RULES, ...(s.value as Partial<PayRules>) }, version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_PAY_RULES, version: 0, by: null, at: null };
}

export const payInvoiceSelect = {
  id: true, number: true, amount: true, issuedAt: true, dueAt: true,
  applications: { select: { amount: true, payment: { select: { reconciledAt: true, receivedAt: true } } } },
  promises: { select: { promisedFor: true, createdAt: true, replacedAt: true } },
} as const;

/** Full behavior of one customer, with the rules in force. */
export async function paymentBehavior(accountId: string) {
  const [a, rules, last] = await Promise.all([
    db.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, paymentTermsDays: true, invoices: { select: payInvoiceSelect } } }),
    getPayRules(),
    db.paymentBehaviorSnapshot.findFirst({ where: { accountId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  if (!a) return null;
  const b = payBehavior(a.invoices.map(toPayInvoice), a.paymentTermsDays, today(), rules.value);
  return { account: { id: a.id, name: a.name }, b, rules, lastSnapshotAt: last?.createdAt ?? null };
}

/** Behavior of several customers in one query (lists such as Credit limits). */
export async function paymentBehaviors(accountIds: string[]) {
  const [accounts, rules] = await Promise.all([
    accountIds.length ? db.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, paymentTermsDays: true, invoices: { select: payInvoiceSelect } } }) : [],
    getPayRules(),
  ]);
  const now = today();
  return { rules, byId: new Map(accounts.map((a) => [a.id, payBehavior(a.invoices.map(toPayInvoice), a.paymentTermsDays, now, rules.value)])) };
}

/** Expected payment days for Comercial / Liquidation (§10.4): contractual vs what history says. */
export async function expectedPaymentDays(accountId: string) {
  const r = await paymentBehavior(accountId);
  return r ? { ...r.b.expected, formula: PAY_FORMULA, rulesVersion: r.rules.version } : null;
}

/** Recompute after cash is reconciled. Writes a snapshot only when the figures changed,
 *  and raises one PAYMENT market signal when the trend newly turns worse. */
export async function refreshPaymentBehavior(accountId: string, reason: string) {
  const r = await paymentBehavior(accountId);
  if (!r) return;
  const { b, rules } = r;
  const all = b.windows[3];
  const key = { expectedDays: b.expected.expectedDays, avgDelay: all.avgDelay, onTimePct: all.onTimePct, trend: b.trend.trend, collected: all.n, openTotal: b.exposure.openTotal };
  const prev = await db.paymentBehaviorSnapshot.findFirst({ where: { accountId }, orderBy: { createdAt: "desc" } });
  const same = prev && prev.expectedDays === key.expectedDays && prev.avgDelay === key.avgDelay && prev.onTimePct === key.onTimePct && prev.trend === key.trend && prev.collected === key.collected && Number(prev.openTotal) === key.openTotal && prev.rulesVersion === rules.version;
  if (same) return;
  const metrics = JSON.parse(JSON.stringify({ windows: b.windows, trend: b.trend, promises: b.promises, bands: b.bands, expected: b.expected, exposure: b.exposure }));
  await db.paymentBehaviorSnapshot.create({ data: { accountId, formula: PAY_FORMULA, rulesVersion: rules.version, reason: reason.slice(0, 200), ...key, metrics } });
  const sig = payTrendSignal((prev?.trend as Trend | undefined) ?? null, b.trend);
  if (sig) {
    const ref = `Comportamiento de pago · ${PAY_FORMULA} · reglas v${rules.version}`;
    const exists = await db.marketSignal.findFirst({ where: { accountId, kind: "PAYMENT", what: sig.es, status: { not: "DISMISSED" } }, select: { id: true } });
    if (!exists) await db.marketSignal.create({ data: { kind: "PAYMENT", what: sig.es, whyMatters: `Facturas cobradas y conciliadas: últimos 6 meses (${b.trend.nRecent}) frente a los 12 anteriores (${b.trend.nPrior}). Es una razón para conversar y entender, no una etiqueta ni un cambio de cupo.`, accountId, status: "NEW", sourceType: "RULE", sourceRef: ref, observedAt: new Date(), confidence: "VERIFIED", capturedByName: "SOLU (regla)" } });
  }
}

/** Never let a derived read model break the money action that triggered it. */
export async function refreshPaymentBehaviorSafe(accountId: string, reason: string) {
  try { await refreshPaymentBehavior(accountId, reason); } catch (e) {
    console.error("payment behavior refresh failed", e);
    // The durable worker retries it (with backoff) instead of losing it.
    try { const { enqueue } = await import("./jobs"); await enqueue("PAY_BEHAVIOR", { accountId, reason: reason.slice(0, 200) }, { dedupeKey: `PAY_BEHAVIOR:${accountId}` }); } catch { /* best effort */ }
  }
}
