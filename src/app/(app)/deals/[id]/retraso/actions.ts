"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { assertCanEdit, canEdit } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { mailConfig } from "@/lib/mail";
import { sendTracked } from "@/lib/mail-replies";
import { linkIssues, stripTracking } from "@/lib/mail-health";
import { textToHtml } from "@/lib/email-templates";
import { AiError } from "@/lib/ai";
import { aiDelayProposal, delayCase, getDelayTags } from "@/lib/delay";
import { delayMail, tagText } from "@/lib/delay-rules";

// AVISO DE RETRASO: the person says what caused the delay and the new date; SOLU keeps the new promise as a
// revision with its cause (the same record "Promesa al cliente" writes) and, if asked, sends the email from the
// company mailbox. Nothing is sent without the person pressing the button on a text they could read and change.

const emailOk = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const fmtDay = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d) : "—");

export async function sendDelayNotice(dealId: string, fd: FormData) {
  const user = await requireUser();
  const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, select: { id: true, code: true, ownerId: true, accountId: true, promisedDate: true, originalPromisedDate: true, account: { select: { name: true } } } });
  assertCanEdit(user, deal.ownerId);
  const back = (qs: string): never => { refreshApp(); redirect(`/deals/${dealId}/retraso?${qs}`); };

  const send = fd.get("mode") !== "save";
  const tags = (await getDelayTags()).value;
  const tag = tags.find((x) => x.key === String(fd.get("tag") ?? "") && x.active);
  if (!tag) back("err=causa");
  const raw = String(fd.get("newDate") ?? "");
  const newDate = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null;
  if (!newDate || isNaN(newDate.getTime()) || newDate < today()) back("err=fecha");
  const detail = String(fd.get("detail") ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

  let mailNote = "";
  let uncertain = false;
  if (send) {
    const cfg = mailConfig();
    if (!cfg.configured && process.env.MAIL_DRY_RUN !== "1") back("err=correo");
    const list = (k: string) => [...new Set(String(fd.get(k) ?? "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
    const tos = list("to"), cc = list("cc").filter((x) => !list("to").includes(x));
    if (!tos.length || ![...tos, ...cc].every(emailOk)) back("err=destino");
    const subject = String(fd.get("subject") ?? "").replace(/\s+/g, " ").trim().slice(0, 250);
    if (!subject) back("err=asunto");
    const body = stripTracking(String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 20000)).text;
    if (!body) back("err=texto");
    const bad = linkIssues(body).filter((x) => x.kind === "SHORTENER" || x.kind === "IP");
    if (bad.length) back("err=enlace");
    const key = String(fd.get("idem") ?? "").trim();
    const r = await sendTracked({
      template: "DELAY", refKind: "NEED", refId: deal.id, refCode: deal.code, partyKind: "CUSTOMER", accountId: deal.accountId, dealId: deal.id,
      toAddr: tos[0], toName: String(fd.get("toName") ?? "").trim().slice(0, 120) || null, subject, text: body, html: textToHtml(body), senderName: user.name,
      idemKey: /^[A-Za-z0-9-]{16,64}$/.test(key) ? `delay:${key}` : null, alsoTo: tos.slice(1), cc,
    });
    if (r.status === "FAILED") back(`err=envio&msg=${encodeURIComponent((r.error ?? "").slice(0, 200))}`);
    // The same screen sent twice (double click, browser resubmit): the first one already did everything.
    if (r.status === "DUPLICATE") back("ok=enviado");
    uncertain = r.status === "UNCERTAIN";
    await db.activity.create({ data: { type: "EMAIL", subject: `Aviso de retraso al cliente: ${subject}${uncertain ? " (envío sin confirmar)" : ""}`.slice(0, 200), body: (body + (tos.length > 1 || cc.length ? `\n\nTambién para: ${[...tos.slice(1), ...cc.map((x) => `${x} (CC)`)].join(", ")}` : "")).slice(0, 4000), userId: user.id, accountId: deal.accountId, dealId: deal.id, phase: "execute", source: "Aviso de retraso", uncertain, outcome: "PENDING_REPLY" } });
    mailNote = uncertain ? " · correo al cliente sin confirmar" : ` · correo enviado a ${tos[0]}`;
  }

  const changed = !deal.promisedDate || deal.promisedDate.getTime() !== newDate!.getTime();
  await db.deal.update({
    where: { id: dealId },
    data: {
      promisedDate: newDate,
      ...(!deal.originalPromisedDate && deal.promisedDate ? { originalPromisedDate: deal.promisedDate } : {}),
      ...(changed && deal.promisedDate ? { promiseRevisions: { increment: 1 }, promiseRevisedAt: today(), promiseChangeCause: tag!.cause } : {}),
    },
  });
  await db.activity.create({ data: { type: "NOTE", subject: `Promesa al cliente: ${fmtDay(deal.promisedDate)} → ${fmtDay(newDate)} · causa del retraso: ${tag!.label}${send ? mailNote : " · el cliente fue avisado por otro medio"}`.slice(0, 200), body: detail || null, userId: user.id, accountId: deal.accountId, dealId, phase: "promise", source: "Aviso de retraso" } });
  back(send ? (uncertain ? "ok=incierto" : "ok=enviado") : "ok=guardado");
}

/** "Proponer con IA": returns a proposed solution and email text for the screen to show. Sends nothing. */
export async function proposeDelay(dealId: string, input: { tag: string; detail: string; newDate: string; lang: "ES" | "EN"; include: string[] }): Promise<{ ok: true; solution: string; body: string } | { ok: false; reason: "off" | "cap" | "fail" | "perm" }> {
  const user = await requireUser();
  const c = await delayCase(dealId, makeI18n(user.lang));
  if (!c || !canEdit(user, c.ownerId)) return { ok: false, reason: "perm" };
  const tag = (await getDelayTags()).value.find((x) => x.key === input.tag);
  if (!tag) return { ok: false, reason: "fail" };
  const lang = input.lang === "EN" ? "EN" : "ES";
  const newDate = /^\d{4}-\d{2}-\d{2}$/.test(input.newDate) ? input.newDate : null;
  const tt = tagText(tag, lang);
  const baseline = delayMail({ lang, contactName: c.contact?.name ?? null, code: c.code, customerPo: c.customerPo, what: c.title, promised: c.promised, newDate, explain: tt.explain, solution: tt.solution, others: c.others[lang].filter((o) => input.include.includes(o.id)), sender: user.name, from: mailConfig().from ?? "sales@indsolusa.com" });
  try {
    // Supplier order codes stay out of what the model reads: only dates and states.
    const facts = c.facts.map((f) => f.text.replace(/\bSPO-[\w-]+/g, "").replace(/\s+/g, " "));
    const r = await aiDelayProposal({ lang, sender: user.name, baseline: baseline.text, tagLabel: tag.label, internalDetail: String(input.detail ?? "").slice(0, 500), facts, newDate });
    return { ok: true, solution: r.solution, body: r.body };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, reason: e.code === "OFF" ? "off" : e.code === "CAP" ? "cap" : "fail" };
    console.error("delay proposal failed", e);
    return { ok: false, reason: "fail" };
  }
}
