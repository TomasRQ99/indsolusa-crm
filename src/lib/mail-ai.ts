// Customer emails drafted with AI from what SOLU already knows about a Need (owner, 2026-11-19: "idealmente se usará
// AI para generar correos con la información compartida, necesidades, objetivos, planes"; "usar la información
// compartida en fuente para generar un correo detallado y personalizado").
//
// The draft is only a starting text: a person always reads it on the compose screen and presses "Enviar". Nothing
// here sends an email. What is given to the model is split in two: what the customer may be told, and internal
// context that may shape the wording but must never be repeated (supplier names, costs, margin, internal notes are
// not even included).

import { db } from "./db";
import { AI_MODEL, aiJson } from "./ai";
import { quoteNo } from "./quote";
import type { MailLang } from "./email-templates";

export type DraftKind = "PROGRESS" | "OFFER";
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Everything about the Need (and its quote, when the email is the offer) that an email to the customer may use. */
export async function customerFacts(dealId: string, quoteId: string | null) {
  const d = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      code: true, title: true, desiredResult: true, needSpecs: true, neededBy: true, successMeasure: true, impactIfNot: true, machine: true,
      locatedAt: true, locatedNote: true, sourcingNote: true, transitDays: true, nextMove: true, nextMoveDate: true, promiseText: true, promisedDate: true,
      items: { select: { qty: true, code: true, description: true } }, _count: { select: { files: true } },
      contact: { select: { firstName: true, lastName: true, title: true } }, account: { select: { name: true, industry: true } },
    },
  });
  if (!d) return null;
  const q = quoteId ? await db.quote.findFirst({ where: { id: quoteId, dealId }, include: { lines: { orderBy: { position: "asc" } } } }) : null;
  return {
    tellCustomer: {
      requestNumber: d.code, customer: d.account.name, contact: d.contact ? { firstName: d.contact.firstName, role: d.contact.title } : null,
      whatTheyAskedFor: d.title, resultTheyWant: d.desiredResult, requestDetail: d.needSpecs, neededBy: day(d.neededBy), howTheyMeasureSuccess: d.successMeasure, costOfNotSolving: d.impactIfNot,
      equipment: d.machine, pieces: d.items.map((x) => ({ qty: x.qty, partNumber: x.code, description: x.description })),
      pieceIdentified: d.locatedAt ? d.locatedNote ?? true : false, photosOnFile: d._count.files,
      ourNextContactDate: d.nextMoveDate && d.nextMoveDate >= new Date(Date.now() - 864e5) ? day(d.nextMoveDate) : null,
      deliveryPromise: d.promiseText, promisedDate: day(d.promisedDate),
      quote: q ? {
        number: quoteNo(q), pdfAttached: true, currency: "USD",
        lines: q.lines.map((l) => ({ qty: l.qty, partNumber: l.code, description: l.description, unitPrice: Number(l.unitPrice) })),
        total: Math.round(q.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0) * 100) / 100,
        leadTimeDaysAfterPO: q.leadMinDays != null && q.leadMaxDays != null ? [q.leadMinDays, q.leadMaxDays] : null,
        solution: q.solution, promise: q.promiseText, promiseCondition: q.promiseCondition, incoterm: q.incoterm, paymentTerms: q.paymentTerms, condition: q.condition, validityDays: q.validityDays,
      } : null,
    },
    // Shapes the wording (availability, origin, brand, transit time). Never quoted, never names a supplier or a cost.
    internalContextDoNotRepeat: { sourcingNotes: d.sourcingNote, transitDays: d.transitDays, internalNextStep: d.nextMove },
  };
}

const SYSTEM = (lang: MailLang, kind: DraftKind, sender: string) => `You write business emails for Industry Solutions, a company that supplies industrial spare parts and equipment to manufacturing plants. The email goes from a salesperson to a customer contact and will be read and edited by that salesperson before it is sent.

Write the email in ${lang === "ES" ? "Spanish (Latin American, formal «usted»)" : "English"}. Purpose: ${kind === "OFFER" ? "send the customer their quotation, which is attached as a PDF, and make it easy for them to say yes" : "tell the customer how their request is going and when they will hear from us next"}.

How to write it:
- Start from what the customer wants to achieve, in their own terms, so they can see we understood. Then say concretely what we have done and what comes next.
- Use only facts found under "tellCustomer". If something is not there, leave it out; never invent a price, a date, a brand, a lead time or a promise.
- "internalContextDoNotRepeat" is background for you. It may help you describe availability, origin or timing in general words. Never name a supplier, never mention any cost, margin or internal step, and never quote that text.
- Be warm and respectful, specific and brief: short paragraphs, no filler, no exclamation marks, no bullet symbols other than "-", no markdown.
- ${kind === "OFFER" ? "Say that the PDF quotation is attached. Give the total, the lead time and the validity if they are known, and say what you need from them to proceed (their purchase order)." : "If the part number or photos are missing, ask for them kindly and say why they help. State our next contact date if one is given."}
- End with a sign-off and the name ${sender}. Do not add a company signature block, phone numbers or addresses: SOLU adds them.

Return the subject line and the plain-text body.`;

export async function draftCustomerMail(o: { kind: DraftKind; lang: MailLang; dealId: string; quoteId: string | null; sender: string; baseline: string }) {
  const facts = await customerFacts(o.dealId, o.quoteId);
  if (!facts) return null;
  const out = await aiJson<{ subject: string; body: string }>({
    feature: o.kind === "OFFER" ? "mail-offer" : "mail-progress", userName: o.sender,
    system: SYSTEM(o.lang, o.kind, o.sender),
    content: [{ type: "text", text: `Facts about this request, as JSON:\n${JSON.stringify(facts, null, 1)}\n\nThe company's standard text for this email, for tone and for what it normally covers (you may reuse its phrases):\n${o.baseline.slice(0, 4000)}` }],
    schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false },
    maxTokens: 4000,
  });
  return { subject: out.subject.replace(/\s+/g, " ").trim().slice(0, 250), body: out.body.replace(/\r\n/g, "\n").trim().slice(0, 12000), model: AI_MODEL };
}
