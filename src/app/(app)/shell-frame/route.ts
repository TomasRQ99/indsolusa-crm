import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { loadReceivables } from "@/lib/queries";
import { trmFor, TRM_SOURCE } from "@/lib/fx";

// What the frame shows on every screen besides alerts: how much work waits at each station of the order route,
// and today's TRM. Fetched by the shell after the page is on screen, so it never slows a page down.
// Each count uses the same rule as the list it links to; a count that fails is left out, never shown as 0.
export async function GET() {
  const user = await requireUser();
  const mine = canManageAll(user) ? {} : { ownerId: user.id };
  const safe = async (fn: () => Promise<number>) => { try { return await fn(); } catch { return null; } };
  const [needs, quotes, shipments, dispatches, toInvoice, collect, trm] = await Promise.all([
    safe(() => db.deal.count({ where: { ...mine, internal: false, closedAt: null, stage: { notIn: ["WON", "LOST"] } } })),
    safe(() => db.quote.count({ where: { status: { in: ["DRAFT", "PRESENTED"] }, ...(canManageAll(user) ? {} : { deal: { ownerId: user.id } }) } })),
    safe(() => db.shipment.count({ where: { receipt: { not: "CONFIRMED" } } })),
    safe(() => db.dispatchOrder.count({ where: { cancelledAt: null, deliveredAt: null } })),
    safe(() => db.delivery.count({ where: { invoice: null } })),
    safe(async () => (await loadReceivables()).filter((r) => (r as { state?: string }).state !== "PAID").length),
    trmFor(new Date().toISOString().slice(0, 10)).catch(() => null),
  ]);
  const counts: Record<string, number> = {};
  const put = (href: string, n: number | null) => { if (n != null) counts[href] = n; };
  put("/deals", needs); put("/cotizaciones", quotes); put("/logistica", shipments); put("/operaciones/despachos", dispatches); put("/operaciones/por-facturar", toInvoice); put("/administracion/cobrar", collect);
  return NextResponse.json({ counts, trm: trm ? { rate: trm.rate, validFrom: trm.validFrom, source: TRM_SOURCE } : null }, { headers: { "Cache-Control": "no-store" } });
}
