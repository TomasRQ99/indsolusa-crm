import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Serves one delivery-evidence file. Internal: only with a SOLU session.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const p = await db.deliveryEvidence.findUnique({ where: { id }, select: { name: true, mime: true, data: true } });
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
