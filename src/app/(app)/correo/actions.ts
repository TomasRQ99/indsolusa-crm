"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { mailConfig } from "@/lib/mail";
import { composeFrom } from "@/lib/email-compose";
import { sendTracked, syncReplies } from "@/lib/mail-replies";
import { domainReport, linkIssues, stripTracking } from "@/lib/mail-health";
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
  // E3: tracking parameters are removed from links; shorteners and raw IP links are not sent.
  const body = stripTracking(String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 20000)).text;
  const bad = linkIssues(body).filter((x) => x.kind === "SHORTENER" || x.kind === "IP");
  if (bad.length) redirect(qs(`err=enlace&msg=${encodeURIComponent(bad[0].url.slice(0, 120))}`));
  if (!body) redirect(qs("err=texto"));
  // Unedited text keeps the formatted version (tables); edited text is sent as the person wrote it.
  const html = body === c.mail.text.trim() ? c.mail.html : textToHtml(body);

  // One key per compose screen: a double click or a browser resubmit never sends twice.
  const key = String(fd.get("idem") ?? "").trim();
  const idemKey = /^[A-Za-z0-9-]{16,64}$/.test(key) ? `compose:${key}` : null;
  const r = await sendTracked({ template: tpl, refKind: c.ref.kind, refId: c.ref.id, refCode: c.ref.code, partyKind: c.ref.party, supplierId: c.ref.supplierId, accountId: c.ref.party === "CUSTOMER" ? c.accountId : null, dealId: c.dealId, toAddr: to, toName: c.toName, subject, text: body, html, senderName: user.name, idemKey });
  const done = `${c.back}${c.back.includes("?") ? "&" : "?"}ok=correo`;
  if (r.status === "DUPLICATE") redirect(r.prior === "SENT" ? done : "/correo/respuestas?ok=incierto");
  if (r.status === "FAILED") redirect(qs(`err=envio&msg=${encodeURIComponent((r.error ?? "").slice(0, 200))}`));
  if (c.dealId || c.accountId) {
    const unsure = r.status === "UNCERTAIN";
    await db.activity.create({ data: { type: "EMAIL", subject: `${TEMPLATES[tpl].es}: ${subject}${unsure ? " (envío sin confirmar)" : ""}`.slice(0, 200), body: body.slice(0, 4000), userId: user.id, accountId: c.accountId, dealId: c.dealId, phase: PHASE[tpl], source: "Plantillas de correo", uncertain: unsure } });
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