import { getCurrentUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { paymentBehavior } from "@/lib/pay-behavior";

// Mercado §21 · GET /api/companies/:id/payment-behavior — for Pricing/Liquidation (expected payment days).
// Everyone signed in gets the summary; amounts and per-invoice detail only for Administration/Management (§18).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const r = await paymentBehavior(id);
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  const { b, rules } = r;
  const summary = {
    accountId: r.account.id,
    formula: b.formula,
    rulesVersion: rules.version,
    contractualPaymentDays: b.contractualDays,
    expectedPaymentDays: b.expected.expectedDays,
    financingDeltaDays: b.expected.deltaDays,
    basis: { collectedInvoices: b.expected.n, windowMonths: b.expected.months, enough: b.expected.enough },
    onTimePct: b.windows[3].onTimePct,
    averageDelayDays: b.windows[3].avgDelay,
    trend: b.trend.trend,
    promiseReliabilityPct: b.promises.reliabilityPct,
    lastPaidAt: b.lastPaidAt,
    note: "Only reconciled cash counts. Informational: never changes credit limits or terms.",
  };
  if (!canManageAll(user)) return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  return Response.json({ ...summary, windows: b.windows, trendDetail: b.trend, promises: b.promises, bands: b.bands, exposure: b.exposure, invoices: b.facts }, { headers: { "Cache-Control": "no-store" } });
}
