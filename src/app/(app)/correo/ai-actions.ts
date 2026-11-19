"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { mailConfig } from "@/lib/mail";
import { composeFrom } from "@/lib/email-compose";
import { AiError } from "@/lib/ai";
import { draftCustomerMail } from "@/lib/mail-ai";
import type { MailLang } from "@/lib/email-templates";

/** "Redactar con IA": writes a draft of the customer email from the Need's own data and opens the compose screen
 *  with it. It never sends anything; the person reads it, changes what they want and presses "Enviar correo". */
export async function draftWithAi(fd: FormData) {
  const user = await requireUser();
  const tpl = String(fd.get("tpl") ?? "");
  const id = String(fd.get("id") ?? "").slice(0, 40);
  const lang: MailLang = fd.get("lang") === "EN" ? "EN" : "ES";
  if ((tpl !== "PROGRESS" && tpl !== "OFFER") || !id) redirect("/");
  const base = `/correo/nuevo?${new URLSearchParams({ tpl, id, lang })}`;
  const c = await composeFrom({ tpl, id, lang }, user, mailConfig().from ?? "sales@indsolusa.com");
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
