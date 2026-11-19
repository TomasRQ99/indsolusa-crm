// The printable Quote as a PDF file: the same document the "Ver PDF" button opens, also attached to the email that
// sends the quote to the customer (owner, 2026-11-19: "agregar PDF de la cotización al correo").
import { db } from "./db";
import { today } from "./domain";
import { renderDoc, type DocLang } from "./pdf-docs";
import { quoteDocView } from "./sellers";

export async function quotePdf(id: string, langOverride?: DocLang | null): Promise<{ name: string; data: Buffer; draft: boolean } | null> {
  const q = await db.quote.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } }, deal: { select: { sellerKey: true, owner: { select: { name: true } } } } } });
  if (!q) return null;
  const lang: DocLang = langOverride === "ES" || langOverride === "EN" ? langOverride : q.lang;
  const view = await quoteDocView(q, q.deal.sellerKey);
  const pdf = await renderDoc({
    kind: "quote", lang, number: q.number, rev: q.rev, date: q.issuedAt ?? today(), salesRep: q.deal.owner.name,
    billTo: q.billTo ?? "", shipTo: q.shipTo ?? "",
    lines: q.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) })),
    draft: q.status === "DRAFT", leadMinDays: q.leadMinDays, leadMaxDays: q.leadMaxDays, incoterm: q.incoterm, paymentTerms: q.paymentTerms,
    validityDays: q.validityDays, condition: q.condition, issuer: view.issuer.name ? view.issuer : undefined, money: view.money,
  });
  return { name: quotePdfName(q), data: Buffer.from(pdf), draft: q.status === "DRAFT" };
}

export const quotePdfName = (q: { number: string | number; rev: number; status: string }) => `Quote-${q.number}${q.rev ? `-Rev${q.rev}` : ""}${q.status === "DRAFT" ? "-DRAFT" : ""}.pdf`;
