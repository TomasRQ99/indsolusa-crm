import { requireUser } from "@/lib/auth";
import { quotePdf } from "@/lib/quote-pdf";

// Printable Quote (PDF), opened inline in a new tab to preview, print or download.
// ?lang=EN|ES overrides the quote's language for this document only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const p = new URL(req.url).searchParams.get("lang");
  const pdf = await quotePdf(id, p === "ES" || p === "EN" ? p : null);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
