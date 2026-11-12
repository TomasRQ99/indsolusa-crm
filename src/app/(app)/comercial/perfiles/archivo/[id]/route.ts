import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Serves a photo or PDF kept in a customer's profile. Like the rest of a customer's record, anyone who works in
// SOLU can open it (the board never reaches this address). Shown inside a sandbox so a file can't run anything.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const it = await db.profileItem.findUnique({ where: { id }, select: { fileName: true, mime: true, data: true, account: { select: { internal: true } } } });
  if (!it || !it.data || !it.mime || it.account.internal) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(it.data), {
    headers: {
      "Content-Type": it.mime,
      "Content-Disposition": `inline; filename="${(it.fileName ?? "archivo").replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
