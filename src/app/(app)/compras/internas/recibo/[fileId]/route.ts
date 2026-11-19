import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { ipAuthority } from "@/lib/internal-purchase";

// A receipt of an internal purchase: for whoever asked, whoever decides it, Finance, Administration and Management.
export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await requireUser();
  const { fileId } = await params;
  const f = await db.internalPurchaseFile.findUnique({ where: { id: fileId }, select: { name: true, mime: true, data: true, purchase: true } });
  if (!f) return new Response("Not found", { status: 404 });
  if (!(f.purchase.requesterId === user.id || canFinance(user) || (await ipAuthority(user, f.purchase)).ok)) return new Response("Forbidden", { status: 403 });
  return new Response(Buffer.from(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"`, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
