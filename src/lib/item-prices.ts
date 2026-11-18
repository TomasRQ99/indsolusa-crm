// The price of each product of a Need. The Need's products are created early (often with no price: the new-request
// form only knows what the customer asked for); the price is decided later, on the quote, and committed with the
// customer's PO. Deliveries and invoices read the Need's products, so the price must come back to them, or an
// invoice comes out at USD 0,00 (found by the owner on 2026-11-18). Nobody types the price a second time.

import type { Prisma } from "@prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient | typeof db;
type Line = { code: string | null; description: string; qty: number; unitPrice: unknown };
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Bring the prices of `lines` (a quote's or a customer PO's) to the Need's products.
 *  fill = only where the product has no price yet · set = the lines are the commitment, they win. */
export async function syncItemPrices(tx: Tx, dealId: string, lines: Line[], mode: "fill" | "set") {
  if (!lines.length) return 0;
  const items = await tx.dealItem.findMany({ where: { dealId }, orderBy: { id: "asc" } });
  if (items.length === 0) {
    // A Need that was quoted without products of its own: its products are what was quoted.
    await tx.dealItem.createMany({ data: lines.filter((l) => l.qty > 0).map((l) => ({ dealId, qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) || 0 })) });
    return lines.length;
  }
  const used = new Set<number>();
  const pick = (test: (l: Line) => boolean) => { const k = lines.findIndex((l, n) => !used.has(n) && test(l)); if (k >= 0) used.add(k); return k; };
  let changed = 0;
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    let k = it.code ? pick((l) => !!l.code && norm(l.code) === norm(it.code)) : -1;
    if (k < 0) k = pick((l) => norm(l.description) === norm(it.description));
    if (k < 0 && items.length === lines.length && !used.has(n)) { k = n; used.add(n); }
    if (k < 0) continue;
    const price = Number(lines[k].unitPrice) || 0;
    if (price <= 0 || Number(it.unitPrice) === price) continue;
    if (mode === "fill" && Number(it.unitPrice) > 0) continue;
    await tx.dealItem.update({ where: { id: it.id }, data: { unitPrice: price } });
    changed++;
  }
  return changed;
}

/** For Needs that already went through: products still at price 0 take the price of the accepted PO, or of the
 *  quote that was presented. Called before billing reads them. Does nothing when every product has its price. */
export async function repairItemPrices(dealId: string) {
  const zero = await db.dealItem.count({ where: { dealId, unitPrice: { lte: 0 } } });
  const none = zero === 0 ? await db.dealItem.count({ where: { dealId } }) : 1;
  if (zero === 0 && none > 0) return 0;
  const po = await db.customerPO.findFirst({ where: { dealId, rejectedAt: null, acceptance: { isNot: null } }, orderBy: { receivedAt: "desc" }, select: { lines: { orderBy: { position: "asc" }, select: { code: true, description: true, qty: true, unitPrice: true } } } });
  if (po?.lines.length) return syncItemPrices(db, dealId, po.lines, "fill");
  const q = await db.quote.findFirst({ where: { dealId, status: { in: ["ACCEPTED", "PRESENTED"] } }, orderBy: [{ status: "asc" }, { presentedAt: "desc" }], select: { lines: { orderBy: { position: "asc" }, select: { code: true, description: true, qty: true, unitPrice: true } } } });
  return q?.lines.length ? syncItemPrices(db, dealId, q.lines, "fill") : 0;
}
