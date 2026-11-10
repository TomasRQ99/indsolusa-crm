import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { canDecideBudget, canReconcile } from "@/lib/travel-rules";

// Serves the receipt of a travel expense to the traveller and to whoever approves or checks the trip's money.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const e = await db.missionExpense.findUnique({ where: { id }, select: { receiptName: true, receiptMime: true, receiptData: true, mission: { select: { ownerId: true, owner: { select: { role: true } } } } } });
  if (!e || !e.receiptData || !e.receiptMime) return new Response("Not found", { status: 404 });
  const who = { ownerId: e.mission.ownerId, ownerRole: e.mission.owner.role };
  if (!canEdit(user, who.ownerId) && !canDecideBudget(user, who) && !canReconcile(user, who)) return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(e.receiptData), {
    headers: {
      "Content-Type": e.receiptMime,
      "Content-Disposition": `inline; filename="${(e.receiptName ?? "soporte").replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
