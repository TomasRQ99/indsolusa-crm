import type { Prisma } from "@prisma/client";
import { loadSupplierPayments } from "./queries";

export type ForeignFilters = { month?: string; currency?: string; state?: string; country?: string };

export async function loadForeignPayments(f: ForeignFilters) {
  const where: Prisma.SupplierPaymentWhereInput = {};
  if (f.currency) where.currency = f.currency;
  if (f.country) where.supplierPo = { supplier: { country: f.country } };
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const start = new Date(`${f.month}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    where.createdAt = { gte: start, lt: end };
  }
  if (f.state === "paid") where.executedAt = { not: null };
  if (f.state === "pending") where.executedAt = null;
  const rows = await loadSupplierPayments(where);
  const byCurrency = new Map<string, number>();
  let usd = 0;
  let usdMissing = 0;
  for (const r of rows) {
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + Number(r.amount));
    const u = r.currency === "USD" ? Number(r.amount) : r.amountUsd == null ? null : Number(r.amountUsd);
    if (u == null) usdMissing++;
    else usd += u;
  }
  return { rows, byCurrency, usd, usdMissing };
}
