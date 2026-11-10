import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";

// Serves a visit photo or document to whoever made the visit, the customer's owner, someone covering, or management.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const a = await db.visitAttachment.findUnique({ where: { id }, include: { visit: { select: { ownerId: true, account: { select: { ownerId: true } } } } } });
  if (!a) return new Response("Not found", { status: 404 });
  if (!canEdit(user, a.visit.ownerId) && !canEdit(user, a.visit.account.ownerId)) return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `inline; filename="${a.name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
