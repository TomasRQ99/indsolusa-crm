// E1: email templates. The request for quotation is the company's own template (shared 2026-11-06),
// English lightly proofread with the user's OK (2026-11-09) and translated faithfully to Spanish; the other five follow its voice.
// Rules: specs and quantities come from SOLU records (never retyped); one clear request with a date;
// short paragraphs; 2–3 subject suggestions with the part/order number; Spanish for LatAm, simple
// English otherwise. Never: bank details (only from the verified profile), customer name or our
// margin in supplier emails.
import { COMPANY } from "./company";

export type MailLang = "EN" | "ES";
export type ItemRow = { qty: number; code: string; brand?: string | null; description: string; unitPrice?: number | null };
export type Mail = { subjects: string[]; text: string; html: string };
export type TemplateKey = "RFQ" | "FOLLOWUP" | "NEGOTIATE" | "DELIVERY" | "OFFER" | "PAYMENT";

export const TEMPLATES: Record<TemplateKey, { es: string; en: string; to: "SUPPLIER" | "CUSTOMER"; help: { es: string; en: string } }> = {
  RFQ: { es: "Solicitud de cotización", en: "Request for quotation", to: "SUPPLIER", help: { es: "Plantilla de la empresa para pedir precio a proveedores.", en: "Company template to ask suppliers for a price." } },
  FOLLOWUP: { es: "Seguimiento a proveedor", en: "Supplier follow-up", to: "SUPPLIER", help: { es: "Recordatorio amable cuando un proveedor no ha respondido.", en: "Friendly reminder when a supplier hasn't answered." } },
  NEGOTIATE: { es: "Negociación", en: "Negotiation", to: "SUPPLIER", help: { es: "Pedir mejor precio, plazo o forma de pago sobre su oferta.", en: "Ask for a better price, lead time or terms on their offer." } },
  DELIVERY: { es: "Problema de entrega", en: "Delivery issue", to: "SUPPLIER", help: { es: "Pedir fecha confirmada de despacho y guía de una orden.", en: "Ask for a confirmed ship date and tracking for an order." } },
  OFFER: { es: "Oferta al cliente", en: "Customer offer", to: "CUSTOMER", help: { es: "Enviar la cotización al cliente con un solo paso siguiente: la orden de compra.", en: "Send the quote to the customer with one next step: the purchase order." } },
  PAYMENT: { es: "Recordatorio de pago", en: "Payment reminder", to: "CUSTOMER", help: { es: "Recordar con respeto una factura por vencer o vencida.", en: "Respectfully remind about an invoice coming due or overdue." } },
};

// ---------- building blocks ----------
type Block =
  | { p: string; strong?: boolean }
  | { items: ItemRow[]; prices?: string | null }
  | { bullets: string[] }
  | { addresses: true; lang: MailLang }
  | { gap: true };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number, lang: MailLang) => new Intl.NumberFormat(lang === "EN" ? "en-US" : "es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const longDay = (d: Date, lang: MailLang) => new Intl.DateTimeFormat(lang === "EN" ? "en-US" : "es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);

function render(blocks: Block[], lang: MailLang): { text: string; html: string } {
  const T: string[] = []; const H: string[] = [];
  const cell = "border:1px solid #cfd6de;padding:6px 10px;vertical-align:top";
  for (const b of blocks) {
    if ("gap" in b) { T.push(""); continue; }
    if ("p" in b) { T.push(b.p, ""); H.push(`<p style="margin:0 0 12px">${b.strong ? `<b>${esc(b.p)}</b>` : esc(b.p)}</p>`); continue; }
    if ("bullets" in b) {
      T.push(...b.bullets.map((x) => `·  ${x}`), "");
      H.push(`<ul style="margin:0 0 12px;padding-left:22px">${b.bullets.map((x) => `<li style="margin:2px 0">${esc(x)}</li>`).join("")}</ul>`);
      continue;
    }
    if ("items" in b) {
      const en = lang === "EN";
      const hasBrand = b.items.some((i) => i.brand);
      const hasPrice = !!b.prices && b.items.some((i) => i.unitPrice != null);
      T.push(...b.items.map((i) => `·  ${i.qty} × ${i.code}${i.brand ? ` – ${i.brand}` : ""} – ${i.description}${hasPrice && i.unitPrice != null ? ` – ${b.prices} ${money(i.unitPrice, lang)} ${en ? "each" : "c/u"}` : ""}`), "");
      const head = [en ? "QTY" : "CANT.", "P/N", ...(hasBrand ? [en ? "BRAND" : "MARCA"] : []), en ? "DESCRIPTION" : "DESCRIPCIÓN", ...(hasPrice ? [en ? `UNIT PRICE (${b.prices})` : `PRECIO UNIT. (${b.prices})`, `TOTAL (${b.prices})`] : [])];
      H.push(`<table style="border-collapse:collapse;margin:0 0 14px;font-size:14px"><tr>${head.map((h) => `<th style="${cell};background:#eef2f6;text-align:left">${esc(h)}</th>`).join("")}</tr>${b.items.map((i) => `<tr><td style="${cell};text-align:right">${i.qty}</td><td style="${cell};font-family:Consolas,monospace">${esc(i.code)}</td>${hasBrand ? `<td style="${cell}">${esc(i.brand ?? "")}</td>` : ""}<td style="${cell}">${esc(i.description)}</td>${hasPrice ? `<td style="${cell};text-align:right">${i.unitPrice != null ? money(i.unitPrice, lang) : ""}</td><td style="${cell};text-align:right">${i.unitPrice != null ? money(i.unitPrice * i.qty, lang) : ""}</td>` : ""}</tr>`).join("")}</table>`);
      continue;
    }
    if ("addresses" in b) {
      const en = b.lang === "EN";
      const bill = [COMPANY.billTo.name, ...COMPANY.billTo.lines, `${en ? "Phone" : "Teléfono"}: ${COMPANY.billTo.phone}`, COMPANY.billTo.email];
      const ship = [COMPANY.shipTo.name, ...COMPANY.shipTo.lines, `${en ? "Phone" : "Teléfono"}: ${COMPANY.shipTo.phone}`];
      const bt = en ? "BILL TO:" : "FACTURAR A:"; const st = en ? "SHIP TO (WAREHOUSE):" : "ENVIAR A (BODEGA):";
      T.push(bt, ...bill, "", st, ...ship, "");
      H.push(`<table style="border-collapse:collapse;margin:0 0 14px;font-size:14px"><tr><td style="padding:0 28px 0 0;vertical-align:top"><b>${bt}</b><br>${bill.map(esc).join("<br>")}</td><td style="vertical-align:top"><b>${st}</b><br>${ship.map(esc).join("<br>")}</td></tr></table>`);
    }
  }
  while (T.length && T[T.length - 1] === "") T.pop();
  return { text: T.join("\n"), html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#1f2933">${H.join("")}</div>` };
}

function signature(lang: MailLang, sender: string, from: string): Block[] {
  return [{ p: lang === "EN" ? "Best regards," : "Saludos cordiales," }, { p: `${sender}\n${COMPANY.legalName}\n${from} · ${COMPANY.phone}` }];
}
const sigFix = (r: { text: string; html: string }) => ({ text: r.text, html: r.html.replace(/\n/g, "<br>") });
const more = (items: ItemRow[]) => (items.length > 1 ? ` +${items.length - 1}` : "");
const c0 = (items: ItemRow[]) => items[0].code || items[0].description.slice(0, 40);
const first = (items: ItemRow[]) => (items[0].code ? `${items[0].code}${items[0].brand ? ` (${items[0].brand})` : ""}` : items[0].description.slice(0, 50));

// ---------- 1. Request for quotation (company template) ----------
export function rfqMail(o: { lang: MailLang; code: string; items: ItemRow[]; neededBy: Date | null; notes: string | null; sender: string; from: string; urgent?: boolean }): Mail {
  const en = o.lang === "EN";
  const blocks: Block[] = en ? [
    { p: "Dear Sirs," },
    { p: `${COMPANY.legalName} is a company with offices in Miami and New York. We serve all 50 U.S. states and Puerto Rico. Our mission is to help our customers with their urgent requests and to ensure all spare parts are delivered in a timely manner.` },
    { p: o.urgent ? "We have just received an URGENT request from a special customer for the following product(s):" : "We have just received a request from a customer for the following product(s):" },
    { items: o.items },
    { p: "Please send us pictures, a diagram or the technical data sheet of the quoted items, so we can double-check with our customer and avoid any mistakes." },
    { p: "To secure the purchase order from our customer, please confirm your:" },
    { bullets: ["Best resale price:", "Availability (lead time after receiving our payment):", "Payment options:", "Approximate weight and box dimensions:"] },
    ...(o.neededBy ? [{ p: `We would appreciate your answer by ${longDay(o.neededBy, "EN")}.`, strong: true }] : []),
    ...(o.notes ? [{ p: o.notes }] : []),
    { p: "For quoting and invoicing purposes, please find our complete information below:" },
    { addresses: true, lang: "EN" },
    { p: `We will do our best to close the sale. If we receive the order from our customer, please note that our company's payment policy is to ${COMPANY.supplierPayment.EN}.` },
    { p: "We look forward to hearing from you and building a strong relationship with you." },
    { p: `Our reference: ${o.code}` },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: "Estimados señores:" },
    { p: `${COMPANY.legalName} es una empresa con oficinas en Miami y Nueva York. Atendemos los 50 estados de EE. UU. y Puerto Rico. Nuestra misión es ayudar a nuestros clientes con sus solicitudes urgentes y asegurar que todos los repuestos se entreguen a tiempo.` },
    { p: o.urgent ? "En este momento recibimos una solicitud URGENTE de un cliente especial para el/los siguiente(s) producto(s):" : "En este momento recibimos una solicitud de un cliente para el/los siguiente(s) producto(s):" },
    { items: o.items },
    { p: "Por favor envíennos fotos, un diagrama o la ficha técnica de los ítems cotizados, para confirmarlos con nuestro cliente y evitar errores." },
    { p: "Para obtener la orden de compra de nuestro cliente, por favor confirmen:" },
    { bullets: ["Mejor precio de reventa:", "Disponibilidad (plazo de entrega después de recibir nuestro pago):", "Formas de pago:", "Peso y dimensiones aproximadas de la caja:"] },
    ...(o.neededBy ? [{ p: `Agradecemos su respuesta a más tardar el ${longDay(o.neededBy, "ES")}.`, strong: true }] : []),
    ...(o.notes ? [{ p: o.notes }] : []),
    { p: "Para efectos de cotización y facturación, estos son nuestros datos completos:" },
    { addresses: true, lang: "ES" },
    { p: `Haremos todo lo posible por cerrar la venta. Si recibimos la orden de nuestro cliente, tengan en cuenta que la política de pago de nuestra empresa es ${COMPANY.supplierPayment.ES}.` },
    { p: "Quedamos atentos a su respuesta y esperamos construir una relación sólida con ustedes." },
    { p: `Nuestra referencia: ${o.code}` },
    ...signature("ES", o.sender, o.from),
  ];
  const q = o.items[0].qty;
  const subjects = en
    ? [`${o.urgent ? "URGENT RFQ" : "Quote request"} ${o.code} – ${q} x ${first(o.items)}${more(o.items)}`, `Request for quotation – ${first(o.items)}${more(o.items)} – ${o.code}`, `Price and availability: ${c0(o.items)}${more(o.items)} – ${COMPANY.shortName}`]
    : [`${o.urgent ? "URGENTE: s" : "S"}olicitud de cotización ${o.code} – ${q} x ${first(o.items)}${more(o.items)}`, `Solicitud de cotización – ${first(o.items)}${more(o.items)} – ${o.code}`, `Precio y disponibilidad: ${c0(o.items)}${more(o.items)} – ${COMPANY.shortName}`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

// ---------- 2. Supplier follow-up ----------
export function followUpMail(o: { lang: MailLang; code: string; items: ItemRow[]; sentAt: Date | null; replyBy: Date; sender: string; from: string; urgent?: boolean }): Mail {
  const en = o.lang === "EN";
  const blocks: Block[] = en ? [
    { p: "Dear Sirs," },
    { p: `We are following up on our request ${o.code}${o.sentAt ? ` of ${longDay(o.sentAt, "EN")}` : ""}. ${o.urgent ? "Our customer's request is still URGENT and we would like to include your offer:" : "We would still like to include your offer for our customer:"}` },
    { items: o.items },
    { p: "Please confirm your best resale price, availability (lead time after payment), payment options and approximate weight and box dimensions." },
    { p: `Could you send your quote or proforma invoice by ${longDay(o.replyBy, "EN")}? If you cannot supply these items, a short reply also helps us.`, strong: true },
    { p: `Our reference: ${o.code}` },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: "Estimados señores:" },
    { p: `Hacemos seguimiento a nuestra solicitud ${o.code}${o.sentAt ? ` del ${longDay(o.sentAt, "ES")}` : ""}. ${o.urgent ? "La solicitud de nuestro cliente sigue siendo URGENTE y queremos incluir su oferta:" : "Aún queremos incluir su oferta para nuestro cliente:"}` },
    { items: o.items },
    { p: "Por favor confirmen su mejor precio de reventa, disponibilidad (plazo después del pago), formas de pago y peso y dimensiones aproximadas de la caja." },
    { p: `¿Podrían enviarnos su cotización o factura proforma a más tardar el ${longDay(o.replyBy, "ES")}? Si no pueden suministrar estos ítems, una respuesta corta también nos ayuda.`, strong: true },
    { p: `Nuestra referencia: ${o.code}` },
    ...signature("ES", o.sender, o.from),
  ];
  const subjects = en
    ? [`Follow-up: ${o.code} – ${first(o.items)}${more(o.items)}`, `Re: ${o.urgent ? "URGENT RFQ" : "quote request"} ${o.code} – still waiting for your quote`, `${c0(o.items)}: can you quote by ${longDay(o.replyBy, "EN")}?`]
    : [`Seguimiento: ${o.code} – ${first(o.items)}${more(o.items)}`, `Re: solicitud${o.urgent ? " URGENTE" : ""} ${o.code} – esperamos su cotización`, `${c0(o.items)}: ¿pueden cotizar antes del ${longDay(o.replyBy, "ES")}?`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

// ---------- 3. Negotiation ----------
export function negotiateMail(o: { lang: MailLang; theirRef: string | null; items: ItemRow[]; currency: string; asks: { price: boolean; lead: boolean; payment: boolean }; target: string | null; replyBy: Date; sender: string; from: string }): Mail {
  const en = o.lang === "EN";
  const ref = o.theirRef ? (en ? `your quotation ${o.theirRef}` : `su cotización ${o.theirRef}`) : (en ? "your offer" : "su oferta");
  const asks = en
    ? [o.asks.price && (o.target ? `Price: our customer's budget is close to ${o.target}. Can you get nearer to that?` : "Price: is this your best resale price for this quantity?"), o.asks.lead && "Lead time: can you shorten it, or ship partially from stock?", o.asks.payment && `Payment: our policy is ${COMPANY.supplierPayment.EN}; any discount for advance payment is welcome.`].filter(Boolean) as string[]
    : [o.asks.price && (o.target ? `Precio: el presupuesto de nuestro cliente está cerca de ${o.target}. ¿Pueden acercarse?` : "Precio: ¿es su mejor precio de reventa para esta cantidad?"), o.asks.lead && "Plazo: ¿pueden reducirlo o despachar parcialmente desde inventario?", o.asks.payment && `Pago: nuestra política es ${COMPANY.supplierPayment.ES}; cualquier descuento por pago anticipado es bienvenido.`].filter(Boolean) as string[];
  const blocks: Block[] = en ? [
    { p: "Dear Sirs," },
    { p: `Thank you for ${ref}. We are working to close this order with our customer and would like to review a few points:` },
    { items: o.items, prices: o.currency },
    { bullets: asks.length ? asks : ["Is this your best offer for this quantity?"] },
    { p: `If you can confirm by ${longDay(o.replyBy, "EN")}, we will present your offer to our customer right away.`, strong: true },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: "Estimados señores:" },
    { p: `Gracias por ${ref}. Estamos trabajando para cerrar esta orden con nuestro cliente y quisiéramos revisar algunos puntos:` },
    { items: o.items, prices: o.currency },
    { bullets: asks.length ? asks : ["¿Es esta su mejor oferta para esta cantidad?"] },
    { p: `Si pueden confirmarnos a más tardar el ${longDay(o.replyBy, "ES")}, presentaremos su oferta a nuestro cliente de inmediato.`, strong: true },
    ...signature("ES", o.sender, o.from),
  ];
  const r = o.theirRef ? ` ${o.theirRef}` : "";
  const subjects = en
    ? [`Re: your quote${r} – ${first(o.items)}${more(o.items)}`, `${c0(o.items)}: can we review price and lead time?`, `Closing the order – ${first(o.items)} – your best offer`]
    : [`Re: su cotización${r} – ${first(o.items)}${more(o.items)}`, `${c0(o.items)}: ¿podemos revisar precio y plazo?`, `Cerrando la orden – ${first(o.items)} – su mejor oferta`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

// ---------- 4. Delivery issue (supplier order) ----------
export function deliveryMail(o: { lang: MailLang; poCode: string; proformaRef: string | null; items: ItemRow[]; promised: Date | null; issue: string | null; replyBy: Date; sender: string; from: string; urgent?: boolean }): Mail {
  const en = o.lang === "EN";
  const late = o.promised && o.promised < new Date();
  const blocks: Block[] = en ? [
    { p: "Dear Sirs," },
    { p: `We are writing about our purchase order ${o.poCode}${o.proformaRef ? ` (your proforma ${o.proformaRef})` : ""}.${o.promised ? ` The confirmed ship date was ${longDay(o.promised, "EN")}${late ? " and we have not received shipping confirmation yet" : ""}.` : ""}` },
    { items: o.items },
    ...(o.issue ? [{ p: o.issue }] : []),
    { p: "Our customer is waiting for these parts. Please confirm:" },
    { bullets: ["Confirmed ship date:", "Carrier and tracking number:", "Number of boxes, weight and dimensions:"] },
    { p: `We would appreciate your answer by ${longDay(o.replyBy, "EN")}.`, strong: true },
    { addresses: true, lang: "EN" },
    { p: `Our reference: ${o.poCode}` },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: "Estimados señores:" },
    { p: `Les escribimos por nuestra orden de compra ${o.poCode}${o.proformaRef ? ` (su proforma ${o.proformaRef})` : ""}.${o.promised ? ` La fecha de despacho confirmada era el ${longDay(o.promised, "ES")}${late ? " y aún no recibimos la confirmación de despacho" : ""}.` : ""}` },
    { items: o.items },
    ...(o.issue ? [{ p: o.issue }] : []),
    { p: "Nuestro cliente está esperando estos repuestos. Por favor confirmen:" },
    { bullets: ["Fecha de despacho confirmada:", "Transportadora y número de guía:", "Número de cajas, peso y dimensiones:"] },
    { p: `Agradecemos su respuesta a más tardar el ${longDay(o.replyBy, "ES")}.`, strong: true },
    { addresses: true, lang: "ES" },
    { p: `Nuestra referencia: ${o.poCode}` },
    ...signature("ES", o.sender, o.from),
  ];
  const subjects = en
    ? [`${o.poCode} – shipping status and tracking, please`, `${o.urgent ? "URGENT: " : ""}${o.poCode} – confirm ship date – ${first(o.items)}`, `PO ${o.poCode}: when will it ship?`]
    : [`${o.poCode} – estado del despacho y guía, por favor`, `${o.urgent ? "URGENTE: " : ""}${o.poCode} – confirmar fecha de despacho – ${first(o.items)}`, `OC ${o.poCode}: ¿cuándo se despacha?`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

// ---------- 5. Customer offer ----------
export function offerMail(o: { lang: MailLang; quoteNumber: string; contactName: string | null; items: ItemRow[]; currency: string; total: number; leadText: string | null; validUntil: Date | null; incoterm: string | null; paymentTerms: string | null; condition: string | null; sender: string; from: string }): Mail {
  const en = o.lang === "EN";
  const terms = en
    ? [`Total: ${o.currency} ${money(o.total, "EN")}`, o.leadText && `Lead time: ${o.leadText}`, o.incoterm && `Shipping terms: ${o.incoterm}`, o.paymentTerms && `Payment: ${o.paymentTerms}`, o.condition && `Condition: ${o.condition}`, o.validUntil && `Valid until: ${longDay(o.validUntil, "EN")}`].filter(Boolean) as string[]
    : [`Total: ${o.currency} ${money(o.total, "ES")}`, o.leadText && `Plazo de entrega: ${o.leadText}`, o.incoterm && `Términos de envío: ${o.incoterm}`, o.paymentTerms && `Pago: ${o.paymentTerms}`, o.condition && `Condición: ${o.condition}`, o.validUntil && `Válida hasta: ${longDay(o.validUntil, "ES")}`].filter(Boolean) as string[];
  const blocks: Block[] = en ? [
    { p: o.contactName ? `Dear ${o.contactName},` : "Dear Sirs," },
    { p: `Thank you for your request. Here is our quotation ${o.quoteNumber}:` },
    { items: o.items, prices: o.currency },
    { bullets: terms },
    { p: `To reserve this price and start the order, please send us your purchase order${o.validUntil ? ` before ${longDay(o.validUntil, "EN")}` : ""}.`, strong: true },
    { p: "If anything needs to change (quantity, model or date), just reply to this email and we will adjust it the same day." },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: o.contactName ? `Estimado(a) ${o.contactName}:` : "Estimados señores:" },
    { p: `Gracias por su solicitud. Esta es nuestra cotización ${o.quoteNumber}:` },
    { items: o.items, prices: o.currency },
    { bullets: terms },
    { p: `Para reservar este precio e iniciar el pedido, por favor envíenos su orden de compra${o.validUntil ? ` antes del ${longDay(o.validUntil, "ES")}` : ""}.`, strong: true },
    { p: "Si algo debe cambiar (cantidad, modelo o fecha), responda este correo y lo ajustamos el mismo día." },
    ...signature("ES", o.sender, o.from),
  ];
  const subjects = en
    ? [`Quotation ${o.quoteNumber} – ${first(o.items)}${more(o.items)}`, `Your quote ${o.quoteNumber} – ${o.leadText ? `lead time ${o.leadText}` : "ready to order"}`, `${c0(o.items)}: price and lead time – ${COMPANY.shortName}`]
    : [`Cotización ${o.quoteNumber} – ${first(o.items)}${more(o.items)}`, `Su cotización ${o.quoteNumber} – ${o.leadText ? `plazo ${o.leadText}` : "lista para ordenar"}`, `${c0(o.items)}: precio y plazo – ${COMPANY.shortName}`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

// ---------- 6. Payment reminder (customer invoice) ----------
export function paymentMail(o: { lang: MailLang; invoiceNumber: string; contactName: string | null; amountDue: number; currency: string; dueAt: Date; customerPo: string | null; promisedFor?: Date | null; sender: string; from: string }): Mail {
  const en = o.lang === "EN";
  const overdue = Math.floor((Date.now() - o.dueAt.getTime()) / 86_400_000);
  const blocks: Block[] = en ? [
    { p: o.contactName ? `Dear ${o.contactName},` : "Dear Sirs," },
    { p: overdue > 0
      ? `This is a friendly reminder that invoice ${o.invoiceNumber}${o.customerPo ? ` (your P.O. ${o.customerPo})` : ""} was due on ${longDay(o.dueAt, "EN")}.`
      : `This is a friendly reminder that invoice ${o.invoiceNumber}${o.customerPo ? ` (your P.O. ${o.customerPo})` : ""} is due on ${longDay(o.dueAt, "EN")}.` },
    ...(o.promisedFor ? [{ p: `We had noted that the payment would arrive on ${longDay(o.promisedFor, "EN")}, and we don't see it in our bank yet; it may be on its way.` }] : []),
    { p: "Could you confirm the expected payment date? If it is already paid, please send us the payment receipt so we can apply it.", strong: true },
    { p: `Please pay only with the instructions printed on the invoice. ${COMPANY.shortName} never changes its bank details by email; if in doubt, call us at ${COMPANY.phone}.` },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: o.contactName ? `Estimado(a) ${o.contactName}:` : "Estimados señores:" },
    { p: overdue > 0
      ? `Le recordamos amablemente que la factura ${o.invoiceNumber}${o.customerPo ? ` (su orden de compra ${o.customerPo})` : ""} venció el ${longDay(o.dueAt, "ES")}.`
      : `Le recordamos amablemente que la factura ${o.invoiceNumber}${o.customerPo ? ` (su orden de compra ${o.customerPo})` : ""} vence el ${longDay(o.dueAt, "ES")}.` },
    ...(o.promisedFor ? [{ p: `Teníamos registrado que el pago llegaría el ${longDay(o.promisedFor, "ES")} y aún no lo vemos en el banco; puede que esté en camino.` }] : []),
    { p: "¿Nos confirma la fecha estimada de pago? Si ya fue pagada, por favor envíenos el comprobante para aplicarlo.", strong: true },
    { p: `Pague únicamente con las instrucciones impresas en la factura. ${COMPANY.shortName} nunca cambia sus datos bancarios por correo; si tiene dudas, llámenos al ${COMPANY.phone}.` },
    ...signature("ES", o.sender, o.from),
  ];
  const subjects = en
    ? [`Invoice ${o.invoiceNumber} – ${overdue > 0 ? "payment reminder" : `due ${longDay(o.dueAt, "EN")}`}`, `Invoice ${o.invoiceNumber}${o.customerPo ? ` / P.O. ${o.customerPo}` : ""} – expected payment date?`, `Friendly reminder: invoice ${o.invoiceNumber}`]
    : [`Factura ${o.invoiceNumber} – ${overdue > 0 ? "recordatorio de pago" : `vence el ${longDay(o.dueAt, "ES")}`}`, `Factura ${o.invoiceNumber}${o.customerPo ? ` / OC ${o.customerPo}` : ""} – ¿fecha estimada de pago?`, `Recordatorio amable: factura ${o.invoiceNumber}`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

/** Plain text edited by the person → simple HTML (paragraphs and line breaks), for sending. */
export function textToHtml(text: string) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#1f2933">${text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}
