import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// A photo or PDF attached to a forum comment. Projects are open to everyone who signs in to SOLU, so are their
// files; a deleted comment's files are no longer served.
export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { fileId } = await params;
  const f = await db.projectPostFile.findUnique({ where: { id: fileId }, include: { post: { select: { deletedAt: true, project: { select: { kind: true } } } } } });
  if (!f || f.post.deletedAt || f.post.project.kind !== "PROJECT") return new Response("Not found", { status: 404 });
  const name = encodeURIComponent(f.name);
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename*=UTF-8''${name}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300" } });
}
