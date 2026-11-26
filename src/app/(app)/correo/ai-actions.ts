"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { mailConfig } from "@/lib/mail";
import { composeFrom } from "@/lib/email-compose";
import { AiError } from "@/lib/ai";
import { draftCustomerMail, REWRITE_PRESETS, rewriteMail } from "@/lib/mail-ai";
import { TEMPLATES, type TemplateKey } from "@/lib/email-templates";
import type { MailLang } from "@/lib/email-templates";
import { companyKey } from "@/lib/company";

/** "Redactar con IA": writes a draft of the customer email from the Need's own data and opens the compose screen
 *  with it. It never sends anything; the person reads it, changes what they want and presses "Enviar correo". */
export async function draftWithAi(fd: FormData) {
  const user = await requireUser();
  const tpl = String(fd.get("tpl") ?? "");
  const id = String(fd.get("id") ?? "").slice(0, 40);
  const lang: MailLang = fd.get("lang") === "EN" ? "EN" : "ES";
  const co = companyKey(fd.get("co"));
  if ((tpl !== "PROGRESS" && tpl !== "OFFER") || !id) redirect("/");
  const base = `/correo/nuevo?${new URLSearchParams({ tpl, id, lang, co })}`;
  const c = await composeFrom({ tpl, id, lang, co }, user, mailConfig().from ?? "sales@indsolusa.com");
  if (!c || !c.dealId) redirect("/");
  if (!c.canSend) redirect(`${base}&err=permiso`);
  let draftId: string;
  try {
    const d = await draftCustomerMail({ kind: tpl, lang, dealId: c.dealId!, quoteId: tpl === "OFFER" ? id : null, sender: user.name, baseline: c.mail.text });
    if (!d) redirect("/");
    draftId = (await db.aiDraft.create({ data: { dealId: c.dealId!, kind: tpl, lang, subject: d!.subject, body: d!.body, model: d!.model, createdById: user.id, createdByName: user.name }, select: { id: true } })).id;
  } catch (e) {
    if (e instanceof AiError) redirect(`${base}&err=${e.code === "OFF" ? "ia-off" : e.code === "CAP" ? "ia-tope" : "ia-fallo"}`);
    throw e;
  }
  redirect(`${base}&borrador=${draftId}`);
}

/** "Reescribir con IA": takes the text now in the message box and the person's instruction (typed, or one of the
 *  ready-made buttons), and opens the same screen with the rewritten text. It never sends anything. */
export async function rewriteWithAi(presetKey: string, fd: FormData) {
  const user = await requireUser();
  const tpl = String(fd.get("tpl") ?? "") as TemplateKey;
  const id = String(fd.get("id") ?? "").slice(0, 40);
  const lang: MailLang = fd.get("lang") === "ES" ? "ES" : "EN";
  const co = companyKey(fd.get("co"));
  if (!(tpl in TEMPLATES) || tpl === "RFQ" || !id) redirect("/");
  // What the person had typed in Para / CC / CCO comes back with the new text.
  const keep = new URLSearchParams({ tpl, id, lang, co });
  for (const k of ["to", "cc", "bcc"]) { const v = String(fd.get(k) ?? "").trim().slice(0, 400); if (v) keep.set(k, v); }
  const base = `/correo/nuevo?${keep}`;
  const c = await composeFrom({ tpl, id, lang, co }, user, mailConfig().from ?? "sales@indsolusa.com");
  if (!c || !c.dealId) redirect("/");
  if (!c!.canSend) redirect(`${base}&err=permiso`);
  // The button pressed says which ready-made instruction to use ("" = the typed prompt). It travels bound to the
  // action: a button that submits to a server action cannot also carry its own name and value.
  const preset = REWRITE_PRESETS[presetKey];
  const instruction = (preset?.instruction ?? String(fd.get("aiPrompt") ?? "")).trim();
  if (instruction.length < 3) redirect(`${base}&err=ia-prompt`);
  const body = String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim() || c!.mail.text;
  const pick = String(fd.get("subject") ?? "");
  const custom = String(fd.get("customSubject") ?? "").trim().slice(0, 250);
  const subject = ((pick === "custom" ? custom : c!.mail.subjects[Number(pick)]) || c!.mail.subjects[0]).slice(0, 250);
  let draftId: string;
  try {
    const d = await rewriteMail({ lang, sender: user.name, toCustomer: c!.ref.party === "CUSTOMER", subject, body, instruction, dealId: c!.dealId, quoteId: tpl === "OFFER" ? id : null });
    draftId = (await db.aiDraft.create({ data: { dealId: c!.dealId!, kind: tpl, lang, subject: d.subject, body: d.body, model: d.model, createdById: user.id, createdByName: user.name }, select: { id: true } })).id;
  } catch (e) {
    if (e instanceof AiError) redirect(`${base}&err=${e.code === "OFF" ? "ia-off" : e.code === "CAP" ? "ia-tope" : "ia-fallo"}`);
    throw e;
  }
  redirect(`${base}&borrador=${draftId}&ok=reescrito#mensaje`);
}
