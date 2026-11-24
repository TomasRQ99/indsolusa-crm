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
export type TemplateKey = "RFQ" | "FOLLOWUP" | "NEGOTIATE" | "DELIVERY" | "OFFER" | "PAYMENT" | "ACK" | "PROGRESS";

export const TEMPLATES: Record<TemplateKey, { es: string; en: string; to: "SUPPLIER" | "CUSTOMER"; help: { es: string; en: string } }> = {
  RFQ: { es: "Solicitud de cotización", en: "Request for quotation", to: "SUPPLIER", help: { es: "Plantilla de la empresa para pedir precio a proveedores.", en: "Company template to ask suppliers for a price." } },
  FOLLOWUP: { es: "Seguimiento a proveedor", en: "Supplier follow-up", to: "SUPPLIER", help: { es: "Recordatorio amable cuando un proveedor no ha respondido.", en: "Friendly reminder when a supplier hasn't answered." } },
  NEGOTIATE: { es: "Negociación", en: "Negotiation", to: "SUPPLIER", help: { es: "Pedir mejor precio, plazo o forma de pago sobre su oferta.", en: "Ask for a better price, lead time or terms on their offer." } },
  DELIVERY: { es: "Problema de entrega", en: "Delivery issue", to: "SUPPLIER", help: { es: "Pedir fecha confirmada de despacho y guía de una orden.", en: "Ask for a confirmed ship date and tracking for an order." } },
  OFFER: { es: "Oferta al cliente", en: "Customer offer", to: "CUSTOMER", help: { es: "Enviar la cotización al cliente con un solo paso siguiente: la orden de compra.", en: "Send the quote to the customer with one next step: the purchase order." } },
  ACK: { es: "Recibimos su solicitud", en: "We received your request", to: "CUSTOMER", help: { es: "El primer correo de una Necesidad: confirma al cliente que recibimos su solicitud, con su número, y cuándo volvemos a escribirle.", en: "The first email of a Need: confirms to the customer that we received their request, with its number, and when we will write again." } },
  PROGRESS: { es: "Avance de su solicitud", en: "Progress on your request", to: "CUSTOMER", help: { es: "Seguimiento al cliente con lo que SOLU ya sabe de su Necesidad: qué pidió, qué busca lograr, la pieza localizada, en qué vamos y cuándo le volvemos a escribir.", en: "Follow-up to the customer from what SOLU already knows about their Need: what they asked for, what they want to achieve, the located piece, where we are and when we write again." } },
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
export function rfqMail(o: { lang: MailLang; code: string; items: ItemRow[]; neededBy: Date | null; notes: string | null; sender: string; from: string; urgent?: boolean; extra?: string[]; skipWeight?: boolean }): Mail {
  const en = o.lang === "EN";
  // C4 (§7): the template's own questions stay verbatim; context questions are added after them, and the weight
  // question is left out only when SOLU already knows it with fresh evidence.
  const ask = (base: string[]) => [...base.filter((_, k) => !(o.skipWeight && k === 3)), ...(o.extra ?? []).map((x) => `${x}:`)];
  const blocks: Block[] = en ? [
    { p: "Dear Sirs," },
    { p: `${COMPANY.legalName} is a company with offices in Miami and New York. We serve all 50 U.S. states and Puerto Rico. Our mission is to help our customers with their urgent requests and to ensure all spare parts are delivered in a timely manner.` },
    { p: o.urgent ? "We have just received an URGENT request from a special customer for the following product(s):" : "We have just received a request from a customer for the following product(s):" },
    { items: o.items },
    { p: "Please send us pictures, a diagram or the technical data sheet of the quoted items, so we can double-check with our customer and avoid any mistakes." },
    { p: "To secure the purchase order from our customer, please confirm your:" },
    { bullets: ask(["Best resale price:", "Availability (lead time after receiving our payment):", "Payment options:", "Approximate weight and box dimensions:"]) },
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
    { bullets: ask(["Mejor precio de reventa:", "Disponibilidad (plazo de entrega después de recibir nuestro pago):", "Formas de pago:", "Peso y dimensiones aproximadas de la caja:"]) },
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
/** First email of a Need: we received your request, its number, and when we come back to you. */
export function ackMail(o: { lang: MailLang; code: string | null; contactName: string | null; customer: string; need: string; items: ItemRow[]; machine: string | null; followUp: Date | null; sender: string; from: string }): Mail {
  const en = o.lang === "EN";
  const ref = o.code ?? "";
  const blocks: Block[] = en ? [
    { p: o.contactName ? `Good day ${o.contactName},` : "Good day," },
    { p: `We have received your request${ref ? ` under number ${ref}` : ""}${o.items.length ? ", for the following products:" : `: ${o.need}.`}` },
    ...(o.items.length ? [{ items: o.items } as Block] : []),
    ...(o.machine ? [{ p: `Equipment: ${o.machine}.` } as Block] : []),
    { p: `From this moment, solving your need is our challenge. ${o.followUp ? `We will contact you again no later than ${longDay(o.followUp, "EN")}.` : "We will contact you within the next 24 to 48 business hours."}`, strong: true },
    { p: "If you have photos of the nameplate, the part number or the equipment's manual, just reply to this email with them: they help us find the exact part faster." },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: o.contactName ? `Buen día ${o.contactName}:` : "Buen día:" },
    { p: `Hemos recibido su solicitud${ref ? ` bajo el número ${ref}` : ""}${o.items.length ? ", por los siguientes productos:" : `: ${o.need}.`}` },
    ...(o.items.length ? [{ items: o.items } as Block] : []),
    ...(o.machine ? [{ p: `Equipo: ${o.machine}.` } as Block] : []),
    { p: `A partir de este momento, es nuestro reto solucionarle su necesidad. ${o.followUp ? `Lo contactaremos de nuevo a más tardar el ${longDay(o.followUp, "ES")}.` : "Lo contactaremos dentro de las próximas 24 a 48 horas hábiles."}`, strong: true },
    { p: "Si tiene fotos de la placa, el número de parte o el manual del equipo, responda este correo con ellos: nos ayudan a encontrar la pieza exacta más rápido." },
    ...signature("ES", o.sender, o.from),
  ];
  const what = o.items.length ? `${first(o.items)}${more(o.items)}` : o.need.slice(0, 70);
  const subjects = en
    ? [`We received your request${ref ? ` ${ref}` : ""} – ${what}`, `Your request${ref ? ` ${ref}` : ""}: we are working on it – ${COMPANY.shortName}`, `${o.customer}: request received${ref ? ` (${ref})` : ""}`]
    : [`Recibimos su solicitud${ref ? ` ${ref}` : ""} – ${what}`, `Su solicitud${ref ? ` ${ref}` : ""}: ya estamos trabajando en ella – ${COMPANY.shortName}`, `${o.customer}: solicitud recibida${ref ? ` (${ref})` : ""}`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

/** Follow-up of a Need: what we understood, the piece, where we are, what we need from them, when we write again. */
export function progressMail(o: { lang: MailLang; code: string | null; contactName: string | null; customer: string; need: string; desiredResult: string | null; items: ItemRow[]; machine: string | null; located: string | null; isLocated: boolean; stage: "LOCATING" | "SOURCING" | "PRICING" | "QUOTED"; ask: { partNumber: boolean; photo: boolean }; followUp: Date | null; sender: string; from: string }): Mail {
  const en = o.lang === "EN";
  const ref = o.code ?? "";
  const stageText = en
    ? { LOCATING: "We are identifying the exact piece so that what we quote is the one that fits.", SOURCING: "We are checking availability, price and lead time with our suppliers.", PRICING: "We already have a source identified and are confirming price and lead time to send you the quotation.", QUOTED: "Your quotation is ready; we are sending it to you in a separate email." }[o.stage]
    : { LOCATING: "Estamos identificando la pieza exacta, para cotizarle justo la que le sirve.", SOURCING: "Estamos consultando disponibilidad, precio y tiempo de entrega con nuestros proveedores.", PRICING: "Ya tenemos la fuente identificada y estamos confirmando precio y tiempo de entrega para enviarle la cotización.", QUOTED: "Su cotización está lista; se la enviamos en un correo aparte." }[o.stage];
  const asks = en
    ? [o.ask.photo && "a photo of the equipment's nameplate or of the piece", o.ask.partNumber && "the part number, if you have it"].filter(Boolean) as string[]
    : [o.ask.photo && "una foto de la placa del equipo o de la pieza", o.ask.partNumber && "el número de parte, si lo tiene"].filter(Boolean) as string[];
  const blocks: Block[] = en ? [
    { p: o.contactName ? `Good day ${o.contactName},` : "Good day," },
    { p: `I am writing with the progress on your request${ref ? ` ${ref}` : ""}: ${o.need}.` },
    ...(o.desiredResult ? [{ p: `We understand that what you are looking for is: ${o.desiredResult}.` } as Block] : []),
    ...(o.items.length ? [{ items: o.items } as Block] : []),
    ...(o.machine ? [{ p: `Equipment: ${o.machine}.` } as Block] : []),
    ...(o.isLocated ? [{ p: o.located ? `We have identified the piece: ${o.located}.` : "We have identified the piece." } as Block] : []),
    { p: stageText },
    ...(asks.length ? [{ p: `To move faster it would help us to have ${asks.join(" and ")}. You can simply reply to this email with them.` } as Block] : []),
    { p: o.followUp ? `We will write to you again no later than ${longDay(o.followUp, "EN")}.` : "We will write to you again within the next 24 to 48 business hours.", strong: true },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: o.contactName ? `Buen día ${o.contactName}:` : "Buen día:" },
    { p: `Le escribo con el avance de su solicitud${ref ? ` ${ref}` : ""}: ${o.need}.` },
    ...(o.desiredResult ? [{ p: `Entendemos que lo que busca es: ${o.desiredResult}.` } as Block] : []),
    ...(o.items.length ? [{ items: o.items } as Block] : []),
    ...(o.machine ? [{ p: `Equipo: ${o.machine}.` } as Block] : []),
    ...(o.isLocated ? [{ p: o.located ? `Ya identificamos la pieza: ${o.located}.` : "Ya identificamos la pieza." } as Block] : []),
    { p: stageText },
    ...(asks.length ? [{ p: `Para avanzar más rápido nos ayudaría tener ${asks.join(" y ")}. Puede responder este mismo correo con ello.` } as Block] : []),
    { p: o.followUp ? `Le volveremos a escribir a más tardar el ${longDay(o.followUp, "ES")}.` : "Le volveremos a escribir dentro de las próximas 24 a 48 horas hábiles.", strong: true },
    ...signature("ES", o.sender, o.from),
  ];
  const what = o.items.length ? `${first(o.items)}${more(o.items)}` : o.need.slice(0, 70);
  const subjects = en
    ? [`Progress on your request${ref ? ` ${ref}` : ""} – ${what}`, `Your request${ref ? ` ${ref}` : ""}: where we are – ${COMPANY.shortName}`, `${o.customer}: update on ${what}`]
    : [`Avance de su solicitud${ref ? ` ${ref}` : ""} – ${what}`, `Su solicitud${ref ? ` ${ref}` : ""}: en qué vamos – ${COMPANY.shortName}`, `${o.customer}: avance de ${what}`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

export function offerMail(o: { lang: MailLang; quoteNumber: string; contactName: string | null; items: ItemRow[]; currency: string; total: number; leadText: string | null; validUntil: Date | null; incoterm: string | null; paymentTerms: string | null; condition: string | null; sender: string; from: string; desiredResult?: string | null; located?: string | null; promise?: string | null; pdfAttached?: boolean }): Mail {
  const en = o.lang === "EN";
  const personal: Block[] = [
    ...(o.desiredResult ? [{ p: en ? `We prepared it with your goal in mind: ${o.desiredResult}.` : `La preparamos pensando en lo que usted busca: ${o.desiredResult}.` } as Block] : []),
    ...(o.located ? [{ p: en ? `The piece we quoted: ${o.located}.` : `La pieza que cotizamos: ${o.located}.` } as Block] : []),
  ];
  const attached: Block[] = o.pdfAttached ? [{ p: en ? "The formal quotation is attached as a PDF." : "Adjunto encontrará la cotización formal en PDF." } as Block] : [];
  const promise: Block[] = o.promise ? [{ p: en ? `Our commitment: ${o.promise}.` : `Nuestro compromiso: ${o.promise}.` } as Block] : [];
  const terms = en
    ? [`Total: ${o.currency} ${money(o.total, "EN")}`, o.leadText && `Lead time: ${o.leadText}`, o.incoterm && `Shipping terms: ${o.incoterm}`, o.paymentTerms && `Payment: ${o.paymentTerms}`, o.condition && `Condition: ${o.condition}`, o.validUntil && `Valid until: ${longDay(o.validUntil, "EN")}`].filter(Boolean) as string[]
    : [`Total: ${o.currency} ${money(o.total, "ES")}`, o.leadText && `Plazo de entrega: ${o.leadText}`, o.incoterm && `Términos de envío: ${o.incoterm}`, o.paymentTerms && `Pago: ${o.paymentTerms}`, o.condition && `Condición: ${o.condition}`, o.validUntil && `Válida hasta: ${longDay(o.validUntil, "ES")}`].filter(Boolean) as string[];
  const blocks: Block[] = en ? [
    { p: o.contactName ? `Dear ${o.contactName},` : "Dear Sirs," },
    { p: `Thank you for your request. Here is our quotation ${o.quoteNumber}:` },
    ...personal,
    { items: o.items, prices: o.currency },
    { bullets: terms },
    ...promise, ...attached,
    { p: `To reserve this price and start the order, please send us your purchase order${o.validUntil ? ` before ${longDay(o.validUntil, "EN")}` : ""}.`, strong: true },
    { p: "If anything needs to change (quantity, model or date), just reply to this email and we will adjust it the same day." },
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: o.contactName ? `Estimado(a) ${o.contactName}:` : "Estimados señores:" },
    { p: `Gracias por su solicitud. Esta es nuestra cotización ${o.quoteNumber}:` },
    ...personal,
    { items: o.items, prices: o.currency },
    { bullets: terms },
    ...promise, ...attached,
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

// ---------- 7. Several follow-ups in one email (Comercial → Seguimientos) ----------
/** One email to one person about several pending things of their company: quotes without a decision, invoices with
 *  a balance and open projects (owner, 2026-11-24). Each line may carry what the person wrote for it ("note"). */
export type FollowUpLine =
  | { kind: "QUOTE"; number: string; what: string; sentAt: Date | null; validUntil: Date | null; note?: string | null }
  | { kind: "INVOICE"; number: string; customerPo: string | null; balance: number; currency: string; dueAt: Date; note?: string | null }
  | { kind: "PROJECT"; title: string; note?: string | null }
  | { kind: "NEED"; code: string | null; what: string; note?: string | null }
  | { kind: "PO"; number: string; what: string; note?: string | null }
  | { kind: "DELIVERY"; po: string | null; what: string; scheduledFor: Date | null; note?: string | null };
export function followUpsMail(o: { lang: MailLang; contactName: string | null; customer: string; lines: FollowUpLine[]; sender: string; from: string }): Mail {
  const en = o.lang === "EN";
  const now = Date.now();
  const note = (n?: string | null) => { const x = (n ?? "").trim().replace(/\s+/g, " "); return x ? ` ${/[.!?…]$/.test(x) ? x : `${x}.`}` : ""; };
  const quotes = o.lines.filter((l) => l.kind === "QUOTE");
  const invoices = o.lines.filter((l) => l.kind === "INVOICE");
  const projects = o.lines.filter((l) => l.kind === "PROJECT");
  const qLine = (l: Extract<FollowUpLine, { kind: "QUOTE" }>) => {
    const expired = !!l.validUntil && l.validUntil.getTime() < now - 864e5;
    return en
      ? `Quotation ${l.number} – ${l.what}${l.sentAt ? `, sent on ${longDay(l.sentAt, "EN")}` : ""}.${l.validUntil ? (expired ? ` Its validity ended on ${longDay(l.validUntil, "EN")}; if you still need it, we will update it for you.` : ` It is valid until ${longDay(l.validUntil, "EN")}.`) : ""}${note(l.note)}`
      : `Cotización ${l.number} – ${l.what}${l.sentAt ? `, enviada el ${longDay(l.sentAt, "ES")}` : ""}.${l.validUntil ? (expired ? ` Su validez terminó el ${longDay(l.validUntil, "ES")}; si aún la necesita, se la actualizamos.` : ` Es válida hasta el ${longDay(l.validUntil, "ES")}.`) : ""}${note(l.note)}`;
  };
  const iLine = (l: Extract<FollowUpLine, { kind: "INVOICE" }>) => {
    const overdue = l.dueAt.getTime() < now - 864e5;
    return en
      ? `Invoice ${l.number}${l.customerPo ? ` (your P.O. ${l.customerPo})` : ""}: open balance ${l.currency} ${money(l.balance, "EN")}, ${overdue ? "was due on" : "due on"} ${longDay(l.dueAt, "EN")}.${note(l.note)}`
      : `Factura ${l.number}${l.customerPo ? ` (su orden de compra ${l.customerPo})` : ""}: saldo pendiente ${l.currency} ${money(l.balance, "ES")}, ${overdue ? "venció el" : "vence el"} ${longDay(l.dueAt, "ES")}.${note(l.note)}`;
  };
  const pLine = (l: Extract<FollowUpLine, { kind: "PROJECT" }>) => `${l.title}${l.note?.trim() ? `:${note(l.note)}` : "."}`;
  // Requests, purchase orders and deliveries: only what the record says. A date is given only when it is still ahead
  // (a delivery that is late has its own email, the delay notice).
  const needs = o.lines.filter((l) => l.kind === "NEED") as Extract<FollowUpLine, { kind: "NEED" }>[];
  const pos = o.lines.filter((l) => l.kind === "PO") as Extract<FollowUpLine, { kind: "PO" }>[];
  const dels = o.lines.filter((l) => l.kind === "DELIVERY") as Extract<FollowUpLine, { kind: "DELIVERY" }>[];
  const nLine = (l: (typeof needs)[number]) => `${en ? "Request" : "Solicitud"}${l.code ? ` ${l.code}` : ""} – ${l.what}.${note(l.note)}`;
  const oLine = (l: (typeof pos)[number]) => `${en ? "Your purchase order" : "Su orden de compra"} ${l.number} – ${l.what}.${note(l.note)}`;
  const dLine = (l: (typeof dels)[number]) => {
    const ahead = !!l.scheduledFor && l.scheduledFor.getTime() >= now - 864e5;
    return en
      ? `Delivery${l.po ? ` of your purchase order ${l.po}` : ""} – ${l.what}${ahead ? `, scheduled for ${longDay(l.scheduledFor!, "EN")}` : ""}.${note(l.note)}`
      : `Entrega${l.po ? ` de su orden de compra ${l.po}` : ""} – ${l.what}${ahead ? `, programada para el ${longDay(l.scheduledFor!, "ES")}` : ""}.${note(l.note)}`;
  };
  const one = o.lines.length === 1;
  const sections: Block[] = [
    ...(needs.length ? [{ p: en ? "Requests in progress" : "Solicitudes en curso", strong: true } as Block, { bullets: needs.map(nLine) } as Block] : []),
    ...(quotes.length ? [{ p: en ? "Quotations awaiting your decision" : "Cotizaciones pendientes de su decisión", strong: true } as Block, { bullets: quotes.map((l) => qLine(l as Extract<FollowUpLine, { kind: "QUOTE" }>)) } as Block] : []),
    ...(pos.length ? [{ p: en ? "Purchase orders in process" : "Órdenes de compra en proceso", strong: true } as Block, { bullets: pos.map(oLine) } as Block] : []),
    ...(dels.length ? [{ p: en ? "Deliveries" : "Entregas", strong: true } as Block, { bullets: dels.map(dLine) } as Block] : []),
    ...(invoices.length ? [{ p: en ? "Invoices with an open balance" : "Facturas con saldo pendiente", strong: true } as Block, { bullets: invoices.map((l) => iLine(l as Extract<FollowUpLine, { kind: "INVOICE" }>)) } as Block] : []),
    ...(projects.length ? [{ p: en ? "Projects in progress" : "Proyectos en curso", strong: true } as Block, { bullets: projects.map((l) => pLine(l as Extract<FollowUpLine, { kind: "PROJECT" }>)) } as Block] : []),
  ];
  const blocks: Block[] = en ? [
    { p: o.contactName ? `Good day ${o.contactName},` : "Good day," },
    { p: one ? `I am writing to follow up on a matter we have pending with ${o.customer}:` : `I am writing to follow up, in a single email, on the ${o.lines.length} matters we have pending with ${o.customer}:` },
    ...sections,
    { p: one ? "Could you let us know how it is going? You can simply reply to this email." : "Could you let us know how each one is going? You can simply reply to this email, point by point.", strong: true },
    ...(quotes.length ? [{ p: "If anything in a quotation needs to change (quantity, model or date), tell us and we will adjust it the same day." } as Block] : []),
    ...(invoices.length ? [{ p: `If an invoice is already paid, please send us the payment receipt so we can apply it. Pay only with the instructions printed on the invoice: ${COMPANY.shortName} never changes its bank details by email.` } as Block] : []),
    ...signature("EN", o.sender, o.from),
  ] : [
    { p: o.contactName ? `Buen día ${o.contactName}:` : "Buen día:" },
    { p: one ? `Le escribo para hacer seguimiento a un tema que tenemos pendiente con ${o.customer}:` : `Le escribo para hacer seguimiento, en un solo correo, a los ${o.lines.length} temas que tenemos pendientes con ${o.customer}:` },
    ...sections,
    { p: one ? "¿Nos puede contar cómo va? Puede responder este mismo correo." : "¿Nos puede contar cómo va cada uno? Puede responder este mismo correo, punto por punto.", strong: true },
    ...(quotes.length ? [{ p: "Si algo de una cotización debe cambiar (cantidad, modelo o fecha), díganos y la ajustamos el mismo día." } as Block] : []),
    ...(invoices.length ? [{ p: `Si alguna factura ya fue pagada, por favor envíenos el comprobante para aplicarlo. Pague únicamente con las instrucciones impresas en la factura: ${COMPANY.shortName} nunca cambia sus datos bancarios por correo.` } as Block] : []),
    ...signature("ES", o.sender, o.from),
  ];
  const label = (l: FollowUpLine) => l.kind === "QUOTE" ? (en ? `quotation ${l.number}` : `cotización ${l.number}`) : l.kind === "INVOICE" ? (en ? `invoice ${l.number}` : `factura ${l.number}`)
    : l.kind === "NEED" ? (en ? `request ${l.code ?? l.what.slice(0, 40)}` : `solicitud ${l.code ?? l.what.slice(0, 40)}`) : l.kind === "PO" ? (en ? `P.O. ${l.number}` : `orden de compra ${l.number}`)
    : l.kind === "DELIVERY" ? (en ? `delivery${l.po ? ` of P.O. ${l.po}` : ""}` : `entrega${l.po ? ` de la OC ${l.po}` : ""}`) : l.title.slice(0, 50);
  const firsts = [needs[0], quotes[0], pos[0], dels[0], invoices[0], projects[0]].filter(Boolean).slice(0, 3).map((l) => label(l!));
  const list = firsts.length > 1 ? `${firsts.slice(0, -1).join(", ")} ${en ? "and" : "y"} ${firsts[firsts.length - 1]}` : firsts[0] ?? "";
  const rest = o.lines.length - firsts.length;
  const subjects = en
    ? [one ? `Follow-up: ${list} – ${o.customer}` : `Follow-up with ${o.customer}: ${o.lines.length} pending matters`, `${o.customer}: ${list}${rest > 0 ? ` (+${rest})` : ""}`, `Pending matters with ${COMPANY.shortName} – ${o.customer}`]
    : [one ? `Seguimiento: ${list} – ${o.customer}` : `Seguimiento ${o.customer}: ${o.lines.length} temas pendientes`, `${o.customer}: ${list}${rest > 0 ? ` (+${rest})` : ""}`, `Temas pendientes con ${COMPANY.shortName} – ${o.customer}`];
  return { subjects, ...sigFix(render(blocks, o.lang)) };
}

/** Plain text edited by the person → simple HTML (paragraphs and line breaks), for sending. */
export function textToHtml(text: string) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.45;color:#1f2933">${text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}
