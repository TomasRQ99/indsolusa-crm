import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canImportData } from "@/lib/permissions";

// The original uploaded file, kept as evidence (§9.2).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !canImportData(user)) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const f = await db.datasetImport.findUnique({ where: { id }, select: { fileName: true, mime: true, data: true } });
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`, "X-Content-Type-Options": "nosniff" } });
}
