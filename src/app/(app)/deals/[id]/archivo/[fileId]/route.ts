import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// A photo or file of a Need, shown to people signed in to SOLU.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  await requireUser();
  const { id, fileId } = await params;
  const f = await db.needFile.findFirst({ where: { id: fileId, dealId: id }, select: { name: true, mime: true, data: true } });
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
