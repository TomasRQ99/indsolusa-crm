import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// Serves a supplier's quote / proforma file (evidence behind an offer) to the team.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const doc = await db.supplierDoc.findUnique({ where: { id }, select: { data: true, mime: true, fileName: true } });
  if (!doc) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(doc.data), {
    headers: {
      "Content-Type": doc.mime,
      "Content-Disposition": `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
