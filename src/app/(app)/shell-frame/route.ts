import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { loadReceivables } from "@/lib/queries";
import { trmFor, TRM_SOURCE } from "@/lib/fx";
import { PROJECT_TAGS, priorityOf } from "@/lib/projects";

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
  // Proyectos y notas: open projects whose tags name a section of SOLU, listed under that section's address.
  const projects: Record<string, { id: string; title: string; priority: string; tag: string }[]> = {};
  try {
    const sectionTags = Object.entries(PROJECT_TAGS).filter(([, v]) => v.href).map(([k]) => k);
    const rows = await db.project.findMany({ where: { kind: "PROJECT", closedAt: null, tags: { hasSome: sectionTags } }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, title: true, priority: true, tags: true } });
    for (const p of rows.sort((a, b) => priorityOf(a.priority).rank - priorityOf(b.priority).rank)) for (const k of p.tags) {
      const href = PROJECT_TAGS[k]?.href;
      if (!href) continue;
      const list = (projects[href] ??= []);
      if (!list.some((x) => x.id === p.id) && list.length < 6) list.push({ id: p.id, title: p.title, priority: p.priority, tag: k });
    }
  } catch { /* the strip is simply not shown */ }
  return NextResponse.json({ counts, projects, trm: trm ? { rate: trm.rate, validFrom: trm.validFrom, source: TRM_SOURCE } : null }, { headers: { "Cache-Control": "no-store" } });
}
