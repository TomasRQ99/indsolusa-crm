import { rfqMail } from "@/lib/email-templates";

// Request for quotation emails, sent from sales@ to each supplier separately (suppliers never see each other).
// Built from the company's own RFQ template (E1). Never includes the customer's name or our target price.

export type RfqItem = { partId: string; mpn: string; name: string; nameEn: string | null; brand: string | null; qty: number };

export const isUsCountry = (c: string | null | undefined) => !!c && /^(us|usa|u\.s\.a?\.?|united states|estados unidos|ee\.?\s?uu\.?)$/i.test(c.trim());

export function rfqEmail(o: { code: string; lang: "EN" | "ES"; supplierName: string; items: RfqItem[]; neededBy: Date | null; notes: string | null; senderName: string; from: string; urgent?: boolean }) {
  const en = o.lang === "EN";
  const mail = rfqMail({
    lang: o.lang, code: o.code, urgent: !!o.urgent, neededBy: o.neededBy, notes: o.notes, sender: o.senderName, from: o.from,
    items: o.items.map((it) => ({ qty: it.qty, code: it.mpn, brand: it.brand, description: (en ? it.nameEn ?? it.name : it.name).slice(0, 160) })),
  });
  return { subject: mail.subjects[0].slice(0, 250), text: mail.text, html: mail.html, subjects: mail.subjects };
}
