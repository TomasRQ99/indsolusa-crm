import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { invoiceCash } from "@/lib/domain";
import { renderDoc, type DocLang, type DocLine } from "@/lib/pdf-docs";
import { linesTotal, money2, sameMoney } from "@/lib/money";

// Printable Commercial Invoice (PDF). Born from the accepted quote + the customer's PO.
// Lines: what was delivered (delivery note) or, if none, the accepted quote's lines.
// Payment instructions only from the verified company bank profile; none is printed until it exists.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } },
      account: { select: { name: true, address: true, docLang: true } },
      delivery: { include: { lines: { include: { dealItem: true } } } },
      quote: { include: { lines: { orderBy: { position: "asc" } } } },
      deal: { select: { customerPo: true, owner: { select: { name: true } }, items: true } },
    },
  });
  if (!inv) return new Response("Not found", { status: 404 });
  if (!inv.deal.customerPo) return new Response("This invoice has no customer P.O. on its Journey. / Esta factura no tiene OC del cliente en su Journey.", { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const p = new URL(req.url).searchParams.get("lang");
  const lang: DocLang = p === "ES" || p === "EN" ? p : inv.docLang;
  let lines: DocLine[] = inv.delivery?.lines.length
    ? inv.delivery.lines.map((l) => ({ qty: l.qty, code: l.dealItem.code, description: l.dealItem.description, unitPrice: Number(l.dealItem.unitPrice) }))
    : inv.quote
      ? inv.quote.lines.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) }))
      : inv.deal.items.map((l) => ({ qty: l.qty, code: l.code, description: l.description, unitPrice: Number(l.unitPrice) }));
  // A partial invoice without line detail: one line for the invoiced amount, never an invented breakdown.
  const fromLines = linesTotal(lines, (l) => l.qty, (l) => l.unitPrice);
  if (!sameMoney(fromLines, inv.amount)) lines = [{ qty: 1, code: null, description: lang === "EN" ? "Partial invoice per customer P.O." : "Factura parcial según orden de compra", unitPrice: money2(inv.amount) }];

  const addr = [inv.account.name, inv.account.address].filter(Boolean).join("\n");
  const cash = invoiceCash(inv);
  const pdf = await renderDoc({
    kind: "invoice",
    lang,
    number: inv.number,
    date: inv.issuedAt,
    dueAt: inv.dueAt,
    salesRep: inv.deal.owner.name,
    billTo: inv.quote?.billTo ?? addr,
    shipTo: inv.quote?.shipTo ?? addr,
    lines,
    sourceQuote: inv.quote ? `${inv.quote.number}${inv.quote.rev ? ` Rev. ${inv.quote.rev}` : ""}` : null,
    po: inv.deal.customerPo,
    total: cash.amount,
    balance: cash.balance,
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice-${inv.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
