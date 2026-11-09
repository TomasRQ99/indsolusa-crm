"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { describeMailError, mailConfig, sendMail } from "@/lib/mail";
import { composeFrom } from "@/lib/email-compose";
import { recordOutbound, syncReplies } from "@/lib/mail-replies";
import { TEMPLATES, textToHtml, type MailLang, type TemplateKey } from "@/lib/email-templates";

const PHASE: Record<TemplateKey, string> = { RFQ: "source", FOLLOWUP: "source", NEGOTIATE: "source", DELIVERY: "execute", OFFER: "quote", PAYMENT: "finance" };
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

  const to = String(fd.get("to") ?? "").trim().slice(0, 200);
  if (!emailOk(to)) redirect(qs("err=destino"));
  const pick = String(fd.get("subject") ?? "");
  const custom = String(fd.get("customSubject") ?? "").trim().slice(0, 250);
  const subject = (pick === "custom" ? custom : c.mail.subjects[Number(pick)] ?? c.mail.subjects[0]).slice(0, 250);
  if (!subject) redirect(qs("err=asunto"));
  const body = String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 20000);
  if (!body) redirect(qs("err=texto"));
  // Unedited text keeps the formatted version (tables); edited text is sent as the person wrote it.
  const html = body === c.mail.text.trim() ? c.mail.html : textToHtml(body);

  try {
    await sendMail({ to: { address: to, name: c.toName }, subject, text: body, html, senderName: user.name });
  } catch (e) {
    redirect(qs(`err=envio&msg=${encodeURIComponent(describeMailError(e).slice(0, 200))}`));
  }
  await recordOutbound({ template: tpl, refKind: c.ref.kind, refId: c.ref.id, refCode: c.ref.code, partyKind: c.ref.party, supplierId: c.ref.supplierId, accountId: c.ref.party === "CUSTOMER" ? c.accountId : null, dealId: c.dealId, toAddr: to, subject });
  if (c.dealId || c.accountId) {
    await db.activity.create({ data: { type: "EMAIL", subject: `${TEMPLATES[tpl].es}: ${subject}`.slice(0, 200), body: body.slice(0, 4000), userId: user.id, accountId: c.accountId, dealId: c.dealId, phase: PHASE[tpl], source: "Plantillas de correo" } });
  }
  refreshApp();
  redirect(`${c.back}${c.back.includes("?") ? "&" : "?"}ok=correo`);
}

/** "Check the mailbox now" on the replies page. Errors are shown by the page from the last check. */
export async function checkReplies() {
  await requireUser();
  let n = 0;
  try { n = (await syncReplies({ force: true })).found; } catch { redirect("/correo/respuestas?err=1"); }
  refreshApp();
  redirect(`/correo/respuestas?ok=revisado&n=${n}`);
}