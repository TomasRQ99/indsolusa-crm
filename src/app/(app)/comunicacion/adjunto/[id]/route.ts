import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Serves a photo attached to a customer message, only to people who may see that conversation.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const att = await db.commAttachment.findUnique({
    where: { id },
    include: { message: { select: { thread: { select: { account: { select: { ownerId: true } } } } } } },
  });
  if (!att) return new Response("Not found", { status: 404 });
  const owner = att.message.thread.account?.ownerId;
  const manager = user.role === "ADMIN" || user.role === "MANAGER";
  if (owner && !manager && owner !== user.id) return new Response("Forbidden", { status: 403 });
  return new Response(new Uint8Array(att.data), {
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": `inline; filename="${att.name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
