import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// The picture of one of MY signatures, to show it in Mi perfil and on the email screen. Never another person's.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const s = /^[a-z0-9]{10,40}$/i.test(id) ? await db.mailSignature.findFirst({ where: { id, userId: user.id }, select: { mime: true, data: true } }) : null;
  if (!s) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(s.data), { headers: { "Content-Type": s.mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
