import fs from "node:fs";
import type { DocMoney } from "./quote-doc";
import path from "node:path";
import PDFDocument from "pdfkit";
import { addDays, daysBetween } from "./domain";
import { lineAmount, sumMoney } from "./money";

// Customer documents (Quote, Commercial Invoice) in the Industry Solutions USA format.
// Brand documents: Helvetica (metric twin of Arial), not SOLU's UI fonts or colours.
// Amounts and dates: US format in English ($18,900.00 · 11/04/2026), Spanish format in Español (USD 18.900,00 · 04/11/2026).

export type DocLang = "EN" | "ES";

export const ISSUER = {
  name: "Industry Solutions USA LLC",
  lines: ["11402 NW 41 ST STREET STE 211-619", "Doral, FL 33178", "(305) 307 0050"],
};

const L = {
  EN: {
    quote: "QUOTE", invoice: "COMMERCIAL INVOICE", date: "Date", quoteNo: "Quote Nº", invoiceNo: "Invoice Nº", exp: "Expiration Date", srcQuote: "Quote Nº",
    rep: "Sales Rep.", po: "P.O. #", billTo: "Bill to", shipTo: "Ship to", qty: "Qty.", code: "Code", desc: "Description", unit: "Unit Price", total: "Total",
    totalUsd: "Total USD", balance: "Balance to pay USD", lead: "Lead Time", ship: "Shipping Terms", pay: "Payment Due", instr: "Payment instructions",
    validity: "Validity", condition: "Condition for all", thanks: "Thank you.", draft: "DRAFT - NOT VALID AS AN OFFER", rev: "Rev.",
    validityText: (days: number, until: string) => `${days} days from date of this quote (until ${until})`,
    payText: (days: number, by: string) => `Net ${days} days from invoice date (by ${by})`,
    instrPending: "Please confirm payment instructions by phone at (305) 307 0050 before paying. Industry Solutions USA never changes bank details by email.",
    ref: (n: string) => `Reference: Invoice Nº ${n}`,
    subtotal: "Subtotal", iva: (p: number) => `IVA ${p} %`, ivaExempt: "IVA: exempt", noIva: "IVA not applicable",
    page: (a: number, b: number) => `Page ${a} of ${b}`,
  },
  ES: {
    quote: "COTIZACIÓN", invoice: "FACTURA COMERCIAL", date: "Fecha", quoteNo: "Cotización Nº", invoiceNo: "Factura Nº", exp: "Fecha de vencimiento", srcQuote: "Cotización Nº",
    rep: "Asesor comercial", po: "Orden de compra Nº", billTo: "Facturar a", shipTo: "Enviar a", qty: "Cant.", code: "Código", desc: "Descripción", unit: "Precio unitario", total: "Total",
    totalUsd: "Total USD", balance: "Saldo por pagar USD", lead: "Tiempo de entrega", ship: "Términos de entrega", pay: "Condiciones de pago", instr: "Instrucciones de pago",
    validity: "Validez", condition: "Condición", thanks: "Gracias.", draft: "BORRADOR - NO VÁLIDO COMO OFERTA", rev: "Rev.",
    validityText: (days: number, until: string) => `${days} días desde la fecha de esta cotización (hasta ${until})`,
    payText: (days: number, by: string) => `${days} días desde la fecha de factura (a más tardar ${by})`,
    instrPending: "Confirme las instrucciones de pago por teléfono al (305) 307 0050 antes de pagar. Industry Solutions USA nunca cambia sus datos bancarios por correo.",
    ref: (n: string) => `Referencia: Factura Nº ${n}`,
    subtotal: "Subtotal", iva: (p: number) => `IVA ${p} %`, ivaExempt: "IVA: exento", noIva: "No aplica IVA",
    page: (a: number, b: number) => `Página ${a} de ${b}`,
  },
};

export const docDate = (d: Date, lang: DocLang) => {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return lang === "EN" ? `${mm}/${dd}/${d.getUTCFullYear()}` : `${dd}/${mm}/${d.getUTCFullYear()}`;
};
/** Amounts as printed. COP has no decimals: "COP 180,000" (EN) / "COP 180.000" (ES). */
export const docMoney = (v: number, lang: DocLang, currency: "USD" | "COP" = "USD") =>
  currency === "COP" ? `COP ${new Intl.NumberFormat(lang === "EN" ? "en-US" : "de-DE", { maximumFractionDigits: 0 }).format(v)}` :
  lang === "EN"
    ? `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`
    : `USD ${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;

/** "Net 30" → 30 */
export const termDays = (s: string | null | undefined, fallback = 30) => {
  const m = /(\d{1,3})/.exec(s ?? "");
  return m ? Number(m[1]) : fallback;
};

/** "12 - 15 days (17 - 20 November)" from days after PO. */
export function leadText(min: number | null, max: number | null, from: Date, lang: DocLang) {
  if (min == null || max == null) return "—";
  const a = addDays(from, min);
  const b = addDays(from, max);
  const loc = lang === "EN" ? "en-US" : "es-ES";
  const mon = (d: Date) => new Intl.DateTimeFormat(loc, { month: "long", timeZone: "UTC" }).format(d);
  const range = a.getUTCMonth() === b.getUTCMonth()
    ? lang === "EN" ? `${a.getUTCDate()} - ${b.getUTCDate()} ${mon(b)}` : `${a.getUTCDate()} - ${b.getUTCDate()} de ${mon(b)}`
    : lang === "EN" ? `${a.getUTCDate()} ${mon(a)} - ${b.getUTCDate()} ${mon(b)}` : `${a.getUTCDate()} de ${mon(a)} - ${b.getUTCDate()} de ${mon(b)}`;
  return `${min} - ${max} ${lang === "EN" ? "days" : "días"} (${range})`;
}

export type DocLine = { qty: number; code: string | null; description: string; unitPrice: number };

type Common = {
  lang: DocLang;
  number: string;
  rev?: number;
  date: Date;
  salesRep: string;
  billTo: string;
  shipTo: string;
  lines: DocLine[];
};
export type QuoteDoc = Common & {
  kind: "quote";
  draft: boolean;
  leadMinDays: number | null;
  leadMaxDays: number | null;
  incoterm: string | null;
  paymentTerms: string | null;
  validityDays: number;
  condition: string;
  /** Selling company printed in the header (default: the USA company). */
  issuer?: { name: string; lines: string[] };
  /** Document currency, IVA and totals (quote-doc.ts). Absent = USD, no IVA, as before. */
  money?: DocMoney;
};
export type InvoiceDoc = Common & {
  kind: "invoice";
  dueAt: Date;
  sourceQuote: string | null;
  po: string | null;
  balance: number;
  total: number;
};

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#bbbbbb";
const BRAND = "#0f4c75";
const FILL = "#eeeeee";

export async function renderDoc(doc: QuoteDoc | InvoiceDoc): Promise<Buffer> {
  const T = L[doc.lang];
  const pdf = new PDFDocument({ size: "LETTER", margins: { top: 48, bottom: 64, left: 48, right: 48 }, bufferPages: true, info: { Title: `${doc.kind === "quote" ? T.quote : T.invoice} ${doc.number}`, Author: ISSUER.name } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => pdf.on("end", () => res(Buffer.concat(chunks))));

  const W = pdf.page.width;
  const left = 48;
  const right = W - 48;
  const width = right - left;
  const font = (b = false) => pdf.font(b ? "Helvetica-Bold" : "Helvetica");

  // ---- Issuer: company logo top-left (falls back to the wordmark if the file is missing) ----
  const logo = path.join(process.cwd(), "public", "brand", "industry-solutions.png");
  if (fs.existsSync(logo)) pdf.image(logo, left, 36, { fit: [150, 46] });
  else {
    font(true).fontSize(17).fillColor(BRAND).text("INDUSTRY SOLUTIONS", left, 48, { lineBreak: false });
    font(false).fontSize(8.5).fillColor(MUTED).text("USA LLC", left, 68);
  }
  const issuer = (doc.kind === "quote" && doc.issuer) || ISSUER;
  font(true).fontSize(9).fillColor(INK).text(issuer.name, left, 86);
  font(false).fontSize(9).fillColor(INK);
  issuer.lines.slice(0, 4).forEach((l, n) => pdf.text(l, left, 98 + n * 11.5));

  // ---- Title + key box (top-right) ----
  const title = doc.kind === "quote" ? T.quote : T.invoice;
  font(true).fontSize(18).fillColor(INK).text(title, left, 46, { width, align: "right" });
  const no = `${doc.number}${doc.rev ? ` ${T.rev} ${doc.rev}` : ""}`;
  const keys: [string, string][] = doc.kind === "quote"
    ? [[T.date, docDate(doc.date, doc.lang)], [T.quoteNo, no], [T.rep, doc.salesRep]]
    : [
        [T.date, docDate(doc.date, doc.lang)],
        [T.invoiceNo, no],
        [T.exp, docDate(doc.dueAt, doc.lang)],
        ...(doc.sourceQuote ? [[T.srcQuote, doc.sourceQuote] as [string, string]] : []),
        [T.po, doc.po ?? "—"],
        [T.rep, doc.salesRep],
      ];
  const boxW = 230;
  const boxX = right - boxW;
  let ky = 76;
  keys.forEach(([k, v]) => {
    font(false).fontSize(8.5).fillColor(MUTED).text(k, boxX, ky, { width: 100 });
    font(true).fontSize(9).fillColor(INK).text(v, boxX + 100, ky, { width: boxW - 100, align: "right" });
    ky += 13;
  });

  // ---- Bill to / Ship to ----
  let y = Math.max(150, ky + 14);
  pdf.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(RULE).stroke();
  y += 10;
  const colW = (width - 24) / 2;
  font(true).fontSize(8.5).fillColor(MUTED).text(T.billTo.toUpperCase(), left, y);
  pdf.text(T.shipTo.toUpperCase(), left + colW + 24, y);
  font(false).fontSize(9.5).fillColor(INK);
  const hb = pdf.heightOfString(doc.billTo || "—", { width: colW });
  const hs = pdf.heightOfString(doc.shipTo || "—", { width: colW });
  pdf.text(doc.billTo || "—", left, y + 13, { width: colW });
  pdf.text(doc.shipTo || "—", left + colW + 24, y + 13, { width: colW });
  y += 13 + Math.max(hb, hs) + 16;

  // ---- Lines table ----
  const cols = [
    { k: T.qty, w: 40, align: "left" as const },
    { k: T.code, w: 110, align: "left" as const },
    { k: T.desc, w: width - 40 - 110 - 85 - 90, align: "left" as const },
    { k: T.unit, w: 85, align: "right" as const },
    { k: T.total, w: 90, align: "right" as const },
  ];
  const header = () => {
    pdf.rect(left, y, width, 18).fill(FILL);
    let x = left;
    font(true).fontSize(8.5).fillColor(INK);
    cols.forEach((c) => { pdf.text(c.k, x + 5, y + 5, { width: c.w - 10, align: c.align }); x += c.w; });
    y += 18;
  };
  header();
  const bottom = pdf.page.height - 64;
  let sum = 0;
  const dm = doc.kind === "quote" ? doc.money : undefined;
  const cur = dm?.currency ?? "USD";
  for (const [n, l] of doc.lines.entries()) {
    const unit = dm ? dm.lines[n].unit : l.unitPrice;
    const total = dm ? dm.lines[n].total : lineAmount(l.qty, l.unitPrice);
    sum = sumMoney([sum, total]);
    font(false).fontSize(9);
    const cells = [String(l.qty), l.code ?? "", l.description, docMoney(unit, doc.lang, cur), docMoney(total, doc.lang, cur)];
    const h = Math.max(...cells.map((c, n) => pdf.heightOfString(c || " ", { width: cols[n].w - 10 }))) + 10;
    if (y + h > bottom - 120) { pdf.addPage(); y = 48; header(); font(false).fontSize(9); }
    let x = left;
    cells.forEach((c, n) => { pdf.fillColor(INK).text(c, x + 5, y + 5, { width: cols[n].w - 10, align: cols[n].align }); x += cols[n].w; });
    y += h;
    pdf.moveTo(left, y).lineTo(right, y).lineWidth(0.4).strokeColor(RULE).stroke();
  }

  // ---- Totals ----
  y += 8;
  const totW = 260;
  const totX = right - totW;
  const totalRow = (k: string, v: string, strong = false) => {
    font(strong).fontSize(strong ? 11 : 9.5).fillColor(INK).text(k, totX, y, { width: 140 });
    font(true).fontSize(strong ? 11 : 9.5).text(v, totX + 140, y, { width: totW - 140, align: "right" });
    y += strong ? 18 : 15;
  };
  const docTotal = doc.kind === "invoice" ? doc.total : sum;
  if (dm && (dm.ivaPct > 0 || dm.ivaExempt)) {
    totalRow(T.subtotal, docMoney(dm.subtotal, doc.lang, cur));
    totalRow(dm.ivaExempt ? T.ivaExempt : T.iva(dm.ivaPct), dm.ivaExempt ? "—" : docMoney(dm.iva, doc.lang, cur));
  }
  totalRow(dm ? `Total ${cur}` : T.totalUsd, docMoney(dm ? dm.total : docTotal, doc.lang, cur), true);
  if (doc.kind === "invoice") totalRow(T.balance, docMoney(doc.balance, doc.lang), true);
  y += 10;

  // ---- Terms ----
  const term = (k: string, v: string) => {
    font(false).fontSize(9);
    const h = pdf.heightOfString(v, { width: width - 130 });
    if (y + h > bottom - 30) { pdf.addPage(); y = 48; }
    font(true).fontSize(9).fillColor(INK).text(`${k}:`, left, y, { width: 125 });
    font(false).fontSize(9).fillColor(INK).text(v, left + 130, y, { width: width - 130 });
    y += Math.max(h, 11) + 5;
  };
  pdf.moveTo(left, y).lineTo(right, y).lineWidth(0.6).strokeColor(RULE).stroke();
  y += 10;
  if (doc.kind === "quote") {
    term(T.lead, leadText(doc.leadMinDays, doc.leadMaxDays, doc.date, doc.lang));
    term(T.ship, doc.incoterm ?? "—");
    term(T.pay, doc.paymentTerms ?? "—");
    term(T.validity, T.validityText(doc.validityDays, docDate(addDays(doc.date, doc.validityDays), doc.lang)));
    term(T.condition, doc.lang === "ES" && /^new\s*&\s*original$/i.test(doc.condition) ? "Nuevo y original" : doc.condition);
  } else {
    term(T.pay, T.payText(Math.max(0, daysBetween(doc.date, doc.dueAt)), docDate(doc.dueAt, doc.lang)));
    // Bank details come only from the verified company bank profile. None is configured yet, so none are printed.
    term(T.instr, `${T.instrPending}\n${T.ref(doc.number)}`);
  }

  // ---- Draft watermark + footer on every page ----
  const range = pdf.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    pdf.switchToPage(p);
    pdf.page.margins.bottom = 0; // writing in the footer zone must not open a new page
    if (doc.kind === "quote" && doc.draft) {
      pdf.save();
      pdf.rotate(-30, { origin: [W / 2, pdf.page.height / 2] });
      font(true).fontSize(40).fillColor("#d33").opacity(0.12).text(T.draft, 0, pdf.page.height / 2 - 20, { width: W, align: "center", lineBreak: false });
      pdf.restore();
      pdf.opacity(1);
    }
    const fy = pdf.page.height - 46;
    pdf.moveTo(left, fy - 6).lineTo(right, fy - 6).lineWidth(0.6).strokeColor(RULE).stroke();
    font(true).fontSize(9).fillColor(INK).text(`${T.thanks} DON'T STOP`, left, fy, { lineBreak: false });
    font(false).fontSize(8.5).fillColor(MUTED).text("Quickly for end users", left, fy + 12, { lineBreak: false });
    font(false).fontSize(8).fillColor(MUTED).text(T.page(p - range.start + 1, range.count), left, fy + 6, { width, align: "right", lineBreak: false });
  }

  pdf.end();
  return done;
}
