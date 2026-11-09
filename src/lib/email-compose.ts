// E1: builds a template email from a SOLU record, so nothing is retyped. Used by the compose page
// (to show it) and by the send action (to rebuild it on the server: what is sent is never taken
// from the browser except the text the person edited).
import { db } from "./db";
import { addDays, today } from "./domain";
import { spanishCountry } from "./company";
import { canEdit } from "./permissions";
import { quoteNo } from "./quote";
import type { SessionUser } from "./auth";
import type { RfqItem } from "./rfq";
import { deliveryMail, followUpMail, negotiateMail, offerMail, paymentMail, type Mail, type MailLang, type TemplateKey } from "./email-templates";

export type ComposeCtx = { tpl: TemplateKey; id: string; lang?: MailLang | null };
export type Composed = {
  mail: Mail; lang: MailLang; to: string | null; toName: string; about: string;
  dealId: string | null; accountId: string | null; back: string; warn: string | null; canSend: boolean;
};

const workingDaysAhead = (n: number) => { const d = today(); while (n > 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0) n--; } return d; };
const emailOk = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const pickLang = (forced: MailLang | null | undefined, auto: MailLang): MailLang => forced ?? auto;

export async function composeFrom(ctx: ComposeCtx, user: SessionUser, from: string): Promise<Composed | null> {
  const sender = user.name;
  const ui = user.lang === "EN"; // warnings shown to the person in their own language
  const replyBy = workingDaysAhead(2);

  if (ctx.tpl === "FOLLOWUP") {
    const r = await db.rfqRecipient.findUnique({ where: { id: ctx.id }, include: { supplier: { select: { name: true, email: true, country: true } }, rfq: { select: { id: true, code: true, items: true, lang: true, dealId: true, deal: { select: { accountId: true } } } } } });
    if (!r) return null;
    const lang = pickLang(ctx.lang, r.rfq.lang === "ES" || r.rfq.lang === "EN" ? r.rfq.lang : spanishCountry(r.supplier.country) ? "ES" : "EN");
    const items = (r.rfq.items as RfqItem[]).map((it) => ({ qty: it.qty, code: it.mpn, brand: it.brand, description: (lang === "EN" ? it.nameEn ?? it.name : it.name).slice(0, 160) }));
    return {
      mail: followUpMail({ lang, code: r.rfq.code, items, sentAt: r.sentAt, replyBy, sender, from }), lang,
      to: r.supplier.email ?? r.email, toName: r.supplier.name, about: `${r.rfq.code} · ${r.supplier.name}`,
      dealId: r.rfq.dealId, accountId: r.rfq.deal?.accountId ?? null, back: `/localizar/rfq/${r.rfq.id}`,
      warn: r.status === "ANSWERED" ? (ui ? "This supplier already answered." : "Este proveedor ya respondió.") : null, canSend: true,
    };
  }

  if (ctx.tpl === "NEGOTIATE") {
    const o = await db.supplierOffer.findUnique({ where: { id: ctx.id }, include: { supplier: { select: { name: true, email: true, country: true } }, part: { select: { id: true, name: true, nameEn: true, brand: true } }, doc: { select: { reference: true } } } });
    if (!o) return null;
    const lang = pickLang(ctx.lang, spanishCountry(o.supplier.country) ? "ES" : "EN");
    const items = [{ qty: o.qty ?? 1, code: o.codeAsQuoted, brand: o.part.brand, description: (o.description ?? (lang === "EN" ? o.part.nameEn ?? o.part.name : o.part.name)).slice(0, 160), unitPrice: Number(o.unitPrice) }];
    return {
      mail: negotiateMail({ lang, theirRef: o.doc?.reference ?? null, items, currency: o.currency, asks: { price: true, lead: true, payment: false }, target: null, replyBy, sender, from }), lang,
      to: o.supplier.email, toName: o.supplier.name, about: `${o.codeAsQuoted} · ${o.supplier.name}`,
      dealId: null, accountId: null, back: `/localizar/${o.part.id}`, warn: null, canSend: true,
    };
  }

  if (ctx.tpl === "DELIVERY") {
    const p = await db.supplierPO.findUnique({ where: { id: ctx.id }, include: { supplier: { select: { name: true, email: true, country: true } }, lines: { orderBy: { position: "asc" } }, deal: { select: { id: true, accountId: true } } } });
    if (!p) return null;
    const lang = pickLang(ctx.lang, spanishCountry(p.supplier.country) ? "ES" : "EN");
    const items = p.lines.map((l) => ({ qty: l.qty, code: l.code ?? "", description: l.description.slice(0, 160) }));
    return {
      mail: deliveryMail({ lang, poCode: p.code, proformaRef: p.proformaRef, items: items.length ? items : [{ qty: 1, code: p.code, description: "—" }], promised: p.shipBy ?? p.eta, issue: null, replyBy, sender, from }), lang,
      to: p.supplier.email, toName: p.supplier.name, about: `${p.code} · ${p.supplier.name}`,
      dealId: p.deal.id, accountId: p.deal.accountId, back: `/compras/${p.id}`,
      warn: p.shippedAt ? (ui ? "This order is already marked as shipped." : "Esta orden ya está marcada como despachada.") : null, canSend: true,
    };
  }

  if (ctx.tpl === "OFFER") {
    const q = await db.quote.findUnique({ where: { id: ctx.id }, include: { lines: { orderBy: { position: "asc" } }, deal: { select: { id: true, ownerId: true, accountId: true, contact: { select: { firstName: true, lastName: true, email: true } }, account: { select: { name: true, docLang: true, contacts: { where: { email: { not: null } }, select: { firstName: true, lastName: true, email: true }, take: 1 } } } } } } });
    if (!q) return null;
    const lang = pickLang(ctx.lang, q.lang === "ES" ? "ES" : "EN");
    const c = q.deal.contact?.email ? q.deal.contact : q.deal.account.contacts[0] ?? null;
    const items = q.lines.map((l) => ({ qty: l.qty, code: l.code ?? "", description: l.description.slice(0, 160), unitPrice: Number(l.unitPrice) }));
    const total = items.reduce((a, l) => a + l.qty * (l.unitPrice ?? 0), 0);
    const validUntil = addDays(q.presentedAt ?? q.issuedAt ?? q.createdAt, q.validityDays);
    const lead = q.leadMinDays != null && q.leadMaxDays != null ? (lang === "EN" ? `${q.leadMinDays}–${q.leadMaxDays} days after your P.O.` : `${q.leadMinDays}–${q.leadMaxDays} días después de su orden de compra`) : null;
    const number = quoteNo(q);
    return {
      mail: offerMail({ lang, quoteNumber: number, contactName: c ? c.firstName : null, items: items.length ? items : [{ qty: 1, code: "—", description: "—", unitPrice: 0 }], currency: "USD", total, leadText: lead, validUntil, incoterm: q.incoterm, paymentTerms: q.paymentTerms, condition: q.condition, sender, from }), lang,
      to: c?.email ?? null, toName: c ? `${c.firstName} ${c.lastName}`.trim() : q.deal.account.name, about: `${number} · ${q.deal.account.name}`,
      dealId: q.deal.id, accountId: q.deal.accountId, back: `/cotizaciones/${q.id}`,
      warn: !q.lines.length ? (ui ? "This quote has no product lines yet: add them before sending." : "Esta cotización aún no tiene productos: agrégalos antes de enviarla.") : q.status === "DRAFT" ? (ui ? "This quote is still a draft: present it first so its price is protected." : "Esta cotización aún es borrador: preséntala primero para proteger su precio.") : validUntil < today() ? (ui ? "This quote's validity has expired." : "La validez de esta cotización ya venció.") : null,
      canSend: q.lines.length > 0 && canEdit(user, q.deal.ownerId),
    };
  }

  if (ctx.tpl === "PAYMENT") {
    const inv = await db.invoice.findUnique({ where: { id: ctx.id }, include: { applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } }, promises: { orderBy: { createdAt: "desc" }, take: 1, select: { promisedFor: true } }, deal: { select: { id: true, ownerId: true, customerPo: true, contact: { select: { firstName: true, lastName: true, email: true } } } }, account: { select: { name: true, billingContact: true, contacts: { where: { email: { not: null } }, select: { firstName: true, lastName: true, email: true }, take: 1 } } } } });
    if (!inv) return null;
    const lang = pickLang(ctx.lang, inv.docLang === "ES" ? "ES" : "EN");
    // Only reconciled payments reduce the balance: a receipt alone never means paid.
    const paid = inv.applications.filter((a) => a.payment.reconciledAt).reduce((s, a) => s + Number(a.amount), 0);
    const due = Math.max(0, Number(inv.amount) - paid);
    const billing = emailOk(inv.account.billingContact) ? inv.account.billingContact!.trim() : null;
    const c = inv.deal.contact?.email ? inv.deal.contact : inv.account.contacts[0] ?? null;
    return {
      mail: paymentMail({ lang, invoiceNumber: inv.number, contactName: billing ? null : c?.firstName ?? null, amountDue: due, currency: "USD", dueAt: inv.dueAt, customerPo: inv.deal.customerPo, promisedFor: inv.promises[0] && inv.promises[0].promisedFor < today() ? inv.promises[0].promisedFor : null, sender, from }), lang,
      to: billing ?? c?.email ?? null, toName: billing ? inv.account.name : c ? `${c.firstName} ${c.lastName}`.trim() : inv.account.name, about: `${inv.number} · ${inv.account.name}`,
      dealId: inv.deal.id, accountId: inv.accountId, back: `/administracion/cobrar?f=${inv.id}`,
      warn: due <= 0 ? (ui ? "This invoice has no open balance." : "Esta factura no tiene saldo pendiente.") : null,
      canSend: canEdit(user, inv.deal.ownerId) || user.role === "ADMIN",
    };
  }
  return null;
}
