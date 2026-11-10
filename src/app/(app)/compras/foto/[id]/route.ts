import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Serves a goods-receipt photo. Receipt evidence is internal: any signed-in SOLU user may see it (everyone reads all
// records), and it is never exposed without a session.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const p = await db.goodsReceiptPhoto.findUnique({ where: { id }, select: { name: true, mime: true, data: true } });
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.data), {
    headers: {
      "Content-Type": p.mime,
      "Content-Disposition": `inline; filename="${p.name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
