import { COMPANY_NAME } from "@/lib/brand";

// Request for quotation emails, sent from sales@ to each supplier separately (suppliers never see each other).
// Never includes the customer's name or our target price. One clear request: send the official quote or proforma.

export type RfqItem = { partId: string; mpn: string; name: string; nameEn: string | null; brand: string | null; qty: number };

export const isUsCountry = (c: string | null | undefined) => !!c && /^(us|usa|u\.s\.a?\.?|united states|estados unidos|ee\.?\s?uu\.?)$/i.test(c.trim());

export function rfqEmail(o: { code: string; lang: "EN" | "ES"; supplierName: string; items: RfqItem[]; neededBy: Date | null; notes: string | null; senderName: string; from: string }) {
  const en = o.lang === "EN";
  const first = o.items[0];
  const subject = en
    ? `RFQ ${o.code} – ${first.mpn}${first.brand ? ` (${first.brand})` : ""}${o.items.length > 1 ? ` +${o.items.length - 1}` : ""} – ${COMPANY_NAME}`
    : `Solicitud de cotización ${o.code} – ${first.mpn}${first.brand ? ` (${first.brand})` : ""}${o.items.length > 1 ? ` +${o.items.length - 1}` : ""} – ${COMPANY_NAME}`;
  const day = (d: Date) => new Intl.DateTimeFormat(en ? "en-US" : "es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const lines = o.items.map((it) => `• ${it.qty} × ${it.mpn} – ${(en ? it.nameEn ?? it.name : it.name).slice(0, 120)}${it.brand ? ` (${it.brand})` : ""}`);
  const text = en
    ? [
        `Dear ${o.supplierName} team,`,
        ``,
        `Please send us your official quotation or proforma invoice for:`,
        ``,
        ...lines,
        ``,
        `For each item, please include: unit price and currency, lead time, validity of the offer, Incoterm and shipping point, condition (new / original) and payment terms.`,
        ...(o.neededBy ? [``, `We would appreciate your quote by ${day(o.neededBy)}.`] : []),
        ...(o.notes ? [``, o.notes] : []),
        ``,
        `Just reply to this email with the quote or proforma attached. Our reference: ${o.code}.`,
        ``,
        `Thank you,`,
        o.senderName,
        `${COMPANY_NAME} · ${o.from}`,
      ]
    : [
        `Estimado equipo de ${o.supplierName}:`,
        ``,
        `Por favor envíennos su cotización oficial o factura proforma para:`,
        ``,
        ...lines,
        ``,
        `Para cada ítem, por favor incluyan: precio unitario y moneda, plazo de entrega, validez de la oferta, Incoterm y punto de despacho, condición (nuevo / original) y forma de pago.`,
        ...(o.neededBy ? [``, `Agradecemos su cotización a más tardar el ${day(o.neededBy)}.`] : []),
        ...(o.notes ? [``, o.notes] : []),
        ``,
        `Basta con responder este correo adjuntando la cotización o proforma. Nuestra referencia: ${o.code}.`,
        ``,
        `Gracias,`,
        o.senderName,
        `${COMPANY_NAME} · ${o.from}`,
      ];
  return { subject: subject.slice(0, 250), text: text.join("\n") };
}
