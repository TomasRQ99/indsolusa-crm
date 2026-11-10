import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { today } from "@/lib/domain";
import { renderDoc, type DocLang } from "@/lib/pdf-docs";
import { quoteDocView } from "@/lib/sellers";

// Printable Quote (PDF), opened inline in a new tab to preview, print or download.
// ?lang=EN|ES overrides the quote's language for this document only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const q = await db.quote.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } }, deal: { select: { sellerKey: true, owner: { select: { name: true } } } } },
  });
  if (!q) return new Response("Not found", { status: 404 });
  const p = new URL(req.url).searchParams.get("lang");
  const lang: DocLang = p === "ES" || p === "EN" ? p : q.lang;
  const date = q.issuedAt ?? today();
  const view = await quoteDocView(q, q.deal.sellerKey);
  const pdf = await renderDoc({
    kind: "quote",
    lang,
    number: q.number,
    rev: q.rev,
    date,
    salesRep: q.deal.owner.name,
    billTo: q.billTo ?? "",
    shipTo: q.shipTo ?? "",
    lines: q.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) })),
    draft: q.status === "DRAFT",
    leadMinDays: q.leadMinDays,
    leadMaxDays: q.leadMaxDays,
    incoterm: q.incoterm,
    paymentTerms: q.paymentTerms,
    validityDays: q.validityDays,
    condition: q.condition,
    issuer: view.issuer.name ? view.issuer : undefined,
    money: view.money,
  });
  const name = `Quote-${q.number}${q.rev ? `-Rev${q.rev}` : ""}${q.status === "DRAFT" ? "-DRAFT" : ""}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
