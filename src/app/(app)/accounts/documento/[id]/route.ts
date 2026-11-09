import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";

// Serves a customer document (RUT, Cámara de Comercio…) to the customer's owner and to managers.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const doc = await db.accountDocument.findUnique({ where: { id }, include: { account: { select: { ownerId: true } } } });
  if (!doc) return new Response("Not found", { status: 404 });
  const manager = canManageAll(user);
  if (!manager && doc.account.ownerId !== user.id) return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename="${doc.name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
