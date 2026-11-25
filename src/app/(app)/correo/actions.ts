"use server";


import { redirect } from "next/navigation";
import { imapAllowed, imapBox } from "@/lib/mailbox-imap";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { MAX_ATTACH_BYTES, mailConfig, type MailAttachment } from "@/lib/mail";
import { composeFrom } from "@/lib/email-compose";
import { sendTracked, syncReplies } from "@/lib/mail-replies";
import { domainReport, linkIssues, stripTracking } from "@/lib/mail-health";
import { TEMPLATES, textToHtml, type MailLang, type TemplateKey } from "@/lib/email-templates";
import { quotePdf } from "@/lib/quote-pdf";

const PHASE: Record<TemplateKey, string> = { RFQ: "source", FOLLOWUP: "source", NEGOTIATE: "source", DELIVERY: "execute", OFFER: "quote", PAYMENT: "finance", ACK: "need", PROGRESS: "source" };
const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/** Sends a template email from the company mailbox (sales@). The template is rebuilt here from the record;
 *  only the recipient, the chosen subject and the text the person edited come from the form. */
export async function sendComposed(fd: FormData) {
  const user = await requireUser();
  const tpl = String(fd.get("tpl") ?? "") as TemplateKey;
  const id = String(fd.get("id") ?? "").slice(0, 40);
  const lang: MailLang = fd.get("lang") === "ES" ? "ES" : "EN";
  if (!(tpl in TEMPLATES) || tpl === "RFQ" || !id) redirect("/");
  const qs = (extra: string) => `/correo/nuevo?${new URLSearchParams({ tpl, id, lang })}&${extra}`;
  const cfg = mailConfig();
  if (!cfg.configured && process.env.MAIL_DRY_RUN !== "1") redirect(qs("err=correo"));
  const from = cfg.from ?? "sales@indsolusa.com";
  const c = await composeFrom({ tpl, id, lang }, user, from);
  if (!c) redirect("/");
  if (!c.canSend) redirect(qs("err=permiso"));

  // Several addresses are allowed in each box, separated by commas: the first "Para" is the main recipient
  // (the one SOLU matches replies with); the rest go as more recipients, copy (CC) or hidden copy (CCO).
  const list = (k: string) => [...new Set(String(fd.get(k) ?? "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  const tos = list("to"), cc = list("cc"), bcc = list("bcc");
  if (!tos.length || ![...tos, ...cc, ...bcc].every(emailOk)) redirect(qs("err=destino"));
  const to = tos[0];
  const alsoTo = tos.slice(1);
  const ccOnly = cc.filter((x) => !tos.includes(x));
  const bccOnly = bcc.filter((x) => !tos.includes(x) && !cc.includes(x));
  const pick = String(fd.get("subject") ?? "");
  const custom = String(fd.get("customSubject") ?? "").trim().slice(0, 250);
  const subject = (pick === "custom" ? custom : c.mail.subjects[Number(pick)] ?? c.mail.subjects[0]).slice(0, 250);
  if (!subject) redirect(qs("err=asunto"));
  // E3: tracking parameters are removed from links; shorteners and raw IP links are not sent.
  const body = stripTracking(String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 20000)).text;
  const bad = linkIssues(body).filter((x) => x.kind === "SHORTENER" || x.kind === "IP");
  if (bad.length) redirect(qs(`err=enlace&msg=${encodeURIComponent(bad[0].url.slice(0, 120))}`));
  if (!body) redirect(qs("err=texto"));
  // Unedited text keeps the formatted version (tables); edited text is sent as the person wrote it.
  const html = body === c.mail.text.trim() ? c.mail.html : textToHtml(body);

  // Files of the Need the person ticked go attached (photos, PDF): only files of that same Need, within the size the mailbox accepts.
  let attachments: MailAttachment[] = [];
  const want = fd.getAll("attach").map(String).filter((x) => /^[a-z0-9]{10,40}$/i.test(x)).slice(0, 10);
  if (want.length && c.dealId) {
    const rows = await db.needFile.findMany({ where: { dealId: c.dealId, id: { in: want } }, select: { name: true, mime: true, size: true, data: true } });
    if (rows.reduce((s, r) => s + r.size, 0) > MAX_ATTACH_BYTES) redirect(qs("err=adjuntos"));
    attachments = rows.map((r) => ({ name: r.name, mime: r.mime, data: r.data }));
  }
  // The email that sends a quote carries the quote itself as a PDF (ticked by default on the screen).
  if (tpl === "OFFER" && fd.get("attachQuote") === "1") {
    const pdf = await quotePdf(id, lang);
    if (pdf) attachments = [{ name: pdf.name, mime: "application/pdf", data: pdf.data }, ...attachments];
    if (attachments.reduce((s2, x) => s2 + x.data.length, 0) > MAX_ATTACH_BYTES) redirect(qs("err=adjuntos"));
  }

  // "Enviar desde": the owner of the connected mailbox may send from it instead of the company address.
  const viaOwnBox = fd.get("fromBox") === "externo" && imapAllowed(user) && imapBox().ready;
  // One key per compose screen: a double click or a browser resubmit never sends twice.
  const key = String(fd.get("idem") ?? "").trim();
  const idemKey = /^[A-Za-z0-9-]{16,64}$/.test(key) ? `compose:${key}` : null;
  const r = await sendTracked({ template: tpl, refKind: c.ref.kind, refId: c.ref.id, refCode: c.ref.code, partyKind: c.ref.party, supplierId: c.ref.supplierId, accountId: c.ref.party === "CUSTOMER" ? c.accountId : null, dealId: c.dealId, toAddr: to, toName: c.toName, subject, text: body, html, senderName: user.name, idemKey, attachments, alsoTo, cc: ccOnly, bcc: bccOnly, viaOwnBox });
  const done = `${c.back}${c.back.includes("?") ? "&" : "?"}ok=correo`;
  if (r.status === "DUPLICATE") redirect(r.prior === "SENT" ? done : "/correo/respuestas?ok=incierto");
  if (r.status === "FAILED") redirect(qs(`err=envio&msg=${encodeURIComponent((r.error ?? "").slice(0, 200))}`));
  if (c.dealId || c.accountId) {
    const unsure = r.status === "UNCERTAIN";
    await db.activity.create({ data: { type: "EMAIL", subject: `${TEMPLATES[tpl].es}: ${subject}${unsure ? " (envío sin confirmar)" : ""}`.slice(0, 200), body: (body + (alsoTo.length || ccOnly.length || bccOnly.length ? `\n\nTambién para: ${[...alsoTo, ...ccOnly.map((x) => `${x} (CC)`), ...bccOnly.map((x) => `${x} (CCO)`)].join(", ")}` : "") + (attachments.length ? `\n\nAdjuntos: ${attachments.map((a) => a.name).join(", ")}` : "")).slice(0, 4000), userId: user.id, accountId: c.accountId, dealId: c.dealId, phase: PHASE[tpl], source: "Plantillas de correo", uncertain: unsure } });
  }
  refreshApp();
  // Uncertain: say so plainly and don't invite a resend; SOLU checks Sent Items in the next minutes.
  redirect(r.status === "UNCERTAIN" ? "/correo/respuestas?ok=incierto" : done);
}

/** "Check the mailbox now" on the replies page. Errors are shown by the page from the last check. */
export async function checkReplies() {
  await requireUser();
  let n = 0;
  try { n = (await syncReplies({ force: true })).found; } catch { redirect("/correo/respuestas?err=1"); }
  refreshApp();
  redirect(`/correo/respuestas?ok=revisado&n=${n}`);
}
/** E3: re-run the read-only DNS check now (optionally for another domain). */
export async function recheckDomain(fd: FormData) {
  await requireUser();
  const d = String(fd.get("domain") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const ok = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
  await domainReport({ force: true, domain: ok ? d : undefined });
  redirect(`/correo/entrega${ok ? `?d=${encodeURIComponent(d)}` : ""}`);
}
/** "Guardar solo interno, sin enviar": the text on screen is kept on the Need as an internal note, and nothing goes
 *  to the customer. For the emails that belong to a Need's own steps (received, progress). */
export async function saveInternal(fd: FormData) {
  const user = await requireUser();
  const tpl = String(fd.get("tpl") ?? "") as TemplateKey;
  const id = String(fd.get("id") ?? "").slice(0, 40);
  const lang: MailLang = fd.get("lang") === "ES" ? "ES" : "EN";
  if ((tpl !== "ACK" && tpl !== "PROGRESS") || !id) redirect("/");
  const qs = (extra: string) => `/correo/nuevo?${new URLSearchParams({ tpl, id, lang })}&${extra}`;
  const c = await composeFrom({ tpl, id, lang }, user, mailConfig().from ?? "sales@indsolusa.com");
  if (!c || !c.dealId) redirect("/");
  if (!c!.canSend) redirect(qs("err=permiso"));
  const pick = String(fd.get("subject") ?? "");
  const custom = String(fd.get("customSubject") ?? "").trim().slice(0, 250);
  const subject = ((pick === "custom" ? custom : c!.mail.subjects[Number(pick)]) || c!.mail.subjects[0]).slice(0, 250);
  const body = String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 20000) || c!.mail.text;
  await db.activity.create({ data: { type: "NOTE", subject: `${TEMPLATES[tpl].es} (interno, no enviado al cliente): ${subject}`.slice(0, 200), body: `No se envió al cliente. Texto guardado para uso interno:\n\n${body}`.slice(0, 4000), userId: user.id, accountId: c!.accountId, dealId: c!.dealId, phase: PHASE[tpl], source: "Plantillas de correo" } });
  refreshApp();
  redirect(`${c!.back}${c!.back.includes("?") ? "&" : "?"}ok=correo-interno`);
}
