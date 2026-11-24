"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { MAX_ATTACH_BYTES, mailConfig, type MailAttachment } from "@/lib/mail";
import { sendTracked } from "@/lib/mail-replies";
import { linkIssues, stripTracking } from "@/lib/mail-health";
import { textToHtml, type MailLang } from "@/lib/email-templates";
import { quotePdf } from "@/lib/quote-pdf";
import { cleanKeys, composeFollowUps, isUrgency } from "@/lib/followups";
import { canEdit } from "@/lib/permissions";
import { today } from "@/lib/domain";

const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/** Marks how urgent a Need is (Alta, Media, Baja, or no mark). One mark for the request and everything that
 *  comes from it: its quote, its order, its delivery and its invoice. Its owner or management may change it. */
export async function setUrgency(dealId: string, value: string) {
  const user = await requireUser();
  const deal = await db.deal.findUnique({ where: { id: String(dealId).slice(0, 40) }, select: { id: true, ownerId: true } });
  if (!deal || !canEdit(user, deal.ownerId)) return { ok: false };
  await db.deal.update({ where: { id: deal.id }, data: { urgency: isUrgency(value) ? value : null } });
  refreshApp();
  return { ok: true };
}

/** Sends the one follow-up email from the company mailbox. The email is rebuilt here from the ticked items (only
 *  what this person may follow up); the recipient, the chosen subject and the edited text come from the form. */
export async function sendFollowUps(fd: FormData) {
  const user = await requireUser();
  const a = String(fd.get("a") ?? "").slice(0, 40);
  const cId = String(fd.get("c") ?? "").slice(0, 40) || null;
  const lang: MailLang = fd.get("lang") === "EN" ? "EN" : "ES";
  const keys = cleanKeys(fd.getAll("k"));
  const list0 = `/cotizaciones/seguimientos?${new URLSearchParams({ a, ...(cId ? { c: cId } : {}) })}`;
  if (!a) redirect("/cotizaciones/seguimientos");
  if (!keys.length) redirect(`${list0}&err=nada`);
  const notes: Record<string, string> = {};
  for (const k of keys) notes[k] = String(fd.get(`n_${k}`) ?? "");
  const cfg = mailConfig();
  const from = cfg.from ?? "sales@indsolusa.com";
  const c = await composeFollowUps({ accountId: a, contactId: cId, keys, notes, lang }, user, from);
  if (!c) redirect(`${list0}&err=cambio`);

  const qs0 = new URLSearchParams({ a, ...(cId ? { c: cId } : {}), lang });
  for (const it of c.items) { qs0.append("k", it.key); if (c.notes[it.key]) qs0.append(`n_${it.key}`, c.notes[it.key]); }
  const qs = (extra: string) => `/cotizaciones/seguimientos/correo?${qs0}&${extra}`;
  if (!cfg.configured && process.env.MAIL_DRY_RUN !== "1") redirect(qs("err=correo"));

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
  const body = stripTracking(String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 20000)).text;
  const bad = linkIssues(body).filter((x) => x.kind === "SHORTENER" || x.kind === "IP");
  if (bad.length) redirect(qs(`err=enlace&msg=${encodeURIComponent(bad[0].url.slice(0, 120))}`));
  if (!body) redirect(qs("err=texto"));
  // Unedited text keeps the formatted version; edited text is sent as the person wrote it.
  const html = body === c.mail.text.trim() ? c.mail.html : textToHtml(body);

  // Quote PDFs: only of quotes that are in this same follow-up.
  const wantPdf = new Set(fd.getAll("pdf").map(String));
  const attachments: MailAttachment[] = [];
  for (const q of c.items.filter((x) => x.kind === "Q" && wantPdf.has(x.id))) {
    const pdf = await quotePdf(q.id, lang);
    if (pdf) attachments.push({ name: pdf.name, mime: "application/pdf", data: pdf.data });
  }
  if (attachments.reduce((s, x) => s + x.data.length, 0) > MAX_ATTACH_BYTES) redirect(qs("err=adjuntos"));

  const key = String(fd.get("idem") ?? "").trim();
  const idemKey = /^[A-Za-z0-9-]{16,64}$/.test(key) ? `followups:${key}` : null;
  const deals = [...new Set(c.items.map((x) => x.dealId).filter((x): x is string => !!x))];
  const oneDeal = deals.length === 1 ? deals[0] : null;
  const r = await sendTracked({ template: "FOLLOWUPS", refKind: "FOLLOWUPS", refId: c.account.id, refCode: null, partyKind: "CUSTOMER", supplierId: null, accountId: c.account.id, dealId: oneDeal, toAddr: to, toName: c.toName, subject, text: body, html, senderName: user.name, idemKey, attachments, alsoTo, cc: ccOnly, bcc: bccOnly });
  const done = `${list0}&ok=correo`;
  if (r.status === "DUPLICATE") redirect(r.prior === "SENT" ? done : "/correo/respuestas?ok=incierto");
  if (r.status === "FAILED") redirect(qs(`err=envio&msg=${encodeURIComponent((r.error ?? "").slice(0, 200))}`));
  const unsure = r.status === "UNCERTAIN";
  const kind = (k: string) => ({ N: "Solicitud", Q: "Cotización", O: "Orden de compra", E: "Entrega", I: "Factura", P: "Proyecto" })[k] ?? k;
  await db.followUp.create({ data: { accountId: c.account.id, contactId: c.contact?.id ?? null, toAddr: to, subject, items: c.items.map((x) => x.key), sentById: user.id, sentByName: user.name, uncertain: unsure } });
  await db.activity.create({
    data: {
      type: "EMAIL", subject: `Seguimiento (${c.items.length}): ${subject}${unsure ? " (envío sin confirmar)" : ""}`.slice(0, 200),
      body: (`Pendientes en este correo: ${c.items.map((x) => `${kind(x.kind)} ${x.title}`).join("; ")}\n\n${body}` + (alsoTo.length || ccOnly.length || bccOnly.length ? `\n\nTambién para: ${[...alsoTo, ...ccOnly.map((x) => `${x} (CC)`), ...bccOnly.map((x) => `${x} (CCO)`)].join(", ")}` : "") + (attachments.length ? `\n\nAdjuntos: ${attachments.map((x) => x.name).join(", ")}` : "")).slice(0, 4000),
      userId: user.id, accountId: c.account.id, contactId: c.contact?.id ?? null, dealId: oneDeal, phase: c.items.some((x) => x.kind === "Q") ? "quote" : c.items.some((x) => x.kind === "N") ? "need" : c.items.some((x) => x.kind === "O" || x.kind === "E") ? "execute" : c.items.some((x) => x.kind === "I") ? "finance" : null, source: "Seguimientos", uncertain: unsure, outcome: "PENDING_REPLY",
    },
  });
  // "Si no responden": a to-do for the sender on the chosen day (never before today, at most a year ahead).
  const on = String(fd.get("remindOn") ?? "");
  let reminded = false;
  if (fd.get("remind") === "1" && /^\d{4}-\d{2}-\d{2}$/.test(on)) {
    const due = new Date(`${on}T00:00:00Z`);
    if (!isNaN(due.getTime()) && due >= today() && due.getTime() - Date.now() < 366 * 864e5) {
      await db.task.create({ data: { title: `Revisar si ${c.toName} respondió el seguimiento de ${c.account.name} (${c.items.length === 1 ? "1 pendiente" : `${c.items.length} pendientes`})`.slice(0, 200), dueDate: due, assigneeId: user.id, accountId: c.account.id, contactId: c.contact?.id ?? null, dealId: oneDeal } });
      reminded = true;
    }
  }
  refreshApp();
  redirect(unsure ? "/correo/respuestas?ok=incierto" : `${done}${reminded ? `&r=${on}` : ""}`);
}
