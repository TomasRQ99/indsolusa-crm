"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { nextCode, today } from "@/lib/domain";
import { refreshUnderstanding } from "@/lib/comm-store";
import { syncCustomerEmails, CommMailError } from "@/lib/comm-mail";
import { syncReplies } from "@/lib/mail-replies";
import { sendMail, isMailUncertain } from "@/lib/mail";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

const go = (threadId: string | null, qs: string): never => {
  refreshApp();
  redirect(`/comunicacion?${threadId ? `t=${threadId}&` : ""}${qs}`);
};

async function ownThread(user: SessionUser, threadId: string) {
  const th = await db.commThread.findUniqueOrThrow({ where: { id: threadId }, include: { account: { select: { ownerId: true } }, contact: true, deal: true } });
  const manager = user.role === "ADMIN" || user.role === "MANAGER";
  if (th.account && !manager && th.account.ownerId !== user.id) throw new Error("No tienes acceso a esta conversación / No access to this conversation");
  return th;
}

/** Register a message that arrived outside SOLU (WhatsApp, call, note), optionally with photos. */
export async function registerMessage(fd: FormData) {
  const user = await requireUser();
  const f = z
    .object({
      channel: z.enum(["WHATSAPP", "CALL", "EMAIL", "NOTE"]),
      contactId: z.string().optional(),
      threadId: z.string().optional(),
      partyName: z.string().trim().max(120).optional(),
      body: z.string().trim().max(4000).optional(),
      direction: z.enum(["IN", "OUT"]).default("IN"),
    })
    .parse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  const files = fd.getAll("photo").filter((x): x is File => x instanceof File && x.size > 0);
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type)) go(f.threadId ?? null, "err=tipo");
    if (file.size > MAX_BYTES) go(f.threadId ?? null, "err=grande");
  }
  if (!f.body && files.length === 0) go(f.threadId ?? null, "err=vacio");

  let threadId = f.threadId ?? null;
  let authorName = user.name;
  if (threadId) {
    const th = await ownThread(user, threadId);
    if (f.direction === "IN") authorName = th.partyName ?? "Cliente";
  } else {
    const contact = f.contactId ? await db.contact.findUnique({ where: { id: f.contactId }, include: { account: { select: { ownerId: true } } } }) : null;
    const partyName = contact ? `${contact.firstName} ${contact.lastName}` : f.partyName || "Sin nombre";
    authorName = partyName;
    const th = await db.commThread.create({
      data: {
        channel: f.channel,
        partyName,
        partyAddr: f.channel === "EMAIL" ? contact?.email ?? null : contact?.phone ?? null,
        accountId: contact?.accountId ?? null,
        contactId: contact?.id ?? null,
        lastAt: new Date(),
      },
    });
    threadId = th.id;
  }
  const now = new Date();
  await db.commMessage.create({
    data: {
      threadId,
      direction: f.direction,
      authorName: f.direction === "OUT" ? user.name : authorName,
      body: f.body ?? "",
      sentAt: now,
      createdById: user.id,
      attachments: {
        create: await Promise.all(files.map(async (file) => ({ name: file.name.slice(0, 120) || "foto", mime: file.type, size: file.size, data: Buffer.from(await file.arrayBuffer()) }))),
      },
    },
  });
  await db.commThread.update({ where: { id: threadId }, data: { lastAt: now, ...(f.direction === "IN" ? { lastInAt: now } : { lastOutAt: now }), closedAt: null } });
  if (f.direction === "IN") await refreshUnderstanding(threadId);
  go(threadId, "ok=registrado");
}

/** Confirm, correct or discard one thing SOLU understood. */
export async function decideItem(itemId: string, decision: "CONFIRMED" | "REJECTED" | "CORRECTED", fd: FormData) {
  const user = await requireUser();
  const item = await db.commItem.findUniqueOrThrow({ where: { id: itemId } });
  await ownThread(user, item.threadId);
  const value = String(fd.get("value") ?? "").trim().slice(0, 300);
  if (decision === "CORRECTED" && !value) go(item.threadId, "err=vacio");
  await db.commItem.update({
    where: { id: itemId },
    data: { status: decision, decidedById: user.id, decidedAt: new Date(), ...(decision === "CORRECTED" ? { value } : {}) },
  });
  go(item.threadId, `ok=${decision.toLowerCase()}`);
}

/** The one action where a human confirmation adds value: turn what SOLU understood into a Journey (new or existing). */
export async function applyToJourney(threadId: string, fd: FormData) {
  const user = await requireUser();
  const th = await ownThread(user, threadId);
  if (!th.accountId) go(threadId, "err=sin-cliente");
  const items = await db.commItem.findMany({ where: { threadId, status: { not: "REJECTED" } } });
  const get = (f: string) => items.find((x) => x.field === f)?.value ?? null;
  const product = get("product");
  const qty = Number(get("qty")) || 1;
  const reference = get("reference");
  const result = get("result");
  const date = get("date");
  const neededBy = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  const refKnown = reference && !/^Por leer/.test(reference);
  const description = refKnown ? reference! : product ?? "Por definir";
  const channel = th.channel === "WHATSAPP" ? "WhatsApp" : th.channel === "EMAIL" ? "Correo" : th.channel === "CALL" ? "Llamada" : "Nota";
  const source = `${channel} de ${th.partyName ?? "cliente"}`;
  const target = String(fd.get("dealId") ?? "");

  let dealId: string;
  if (target && target !== "new") {
    const deal = await db.deal.findUniqueOrThrow({ where: { id: target } });
    if (deal.accountId !== th.accountId) throw new Error("Journey de otro cliente / Journey of another customer");
    await db.deal.update({
      where: { id: deal.id },
      data: {
        desiredResult: deal.desiredResult ?? result,
        neededBy: deal.neededBy ?? neededBy,
        needSpecs: [deal.needSpecs, `${qty} × ${description}`].filter(Boolean).join("\n"),
      },
    });
    dealId = deal.id;
  } else {
    const created = await db.$transaction(async (tx) => {
      const code = await nextCode("J", "deal", tx);
      return tx.deal.create({
        data: {
          code,
          title: `${qty} × ${product ?? "requerimiento"}`.slice(0, 120),
          accountId: th.accountId!,
          contactId: th.contactId,
          ownerId: user.id,
          stage: "QUALIFIED",
          desiredResult: result,
          neededBy,
          needSpecs: `${qty} × ${description}`,
          nextMove: refKnown ? "Cotizar y responder al cliente" : "Confirmar la referencia con el cliente y cotizar",
          nextMoveDate: today(),
        },
      });
    });
    dealId = created.id;
  }
  if (product && !(await db.dealItem.findFirst({ where: { dealId, description } }))) {
    await db.dealItem.create({ data: { dealId, qty, code: null, description, unitPrice: 0 } });
  }
  await db.commItem.updateMany({ where: { threadId, status: "PROPOSED" }, data: { status: "CONFIRMED", decidedById: user.id, decidedAt: new Date() } });
  const dateText = neededBy ? new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(neededBy) : date;
  const summary = [product && `${qty} × ${product}`, refKnown && `ref. ${reference}`, dateText && `para ${dateText}`].filter(Boolean).join(" · ");
  await db.activity.create({
    data: { type: th.channel === "CALL" ? "CALL" : th.channel === "EMAIL" ? "EMAIL" : "NOTE", subject: `Confirmado desde ${channel.toLowerCase()}: ${summary || "necesidad del cliente"}`.slice(0, 200), userId: user.id, accountId: th.accountId, contactId: th.contactId, dealId, phase: "need", source },
  });
  await db.commThread.update({ where: { id: threadId }, data: { dealId } });
  go(threadId, "ok=journey");
}

/** Reply: by email from sales@ (email threads), or log that it was sent on WhatsApp/phone. */
export async function sendReply(threadId: string, fd: FormData) {
  const user = await requireUser();
  const th = await ownThread(user, threadId);
  const body = z.string().trim().min(1).max(4000).parse(fd.get("body"));
  const how = String(fd.get("how") ?? "log");
  let ok = "respuesta";
  if (how === "email") {
    const to = th.partyAddr ?? th.contact?.email;
    if (!to || !to.includes("@")) go(threadId, "err=sin-correo");
    try {
      await sendMail({ to: to!, subject: th.subject ? (th.subject.startsWith("Re:") ? th.subject : `Re: ${th.subject}`) : "Industry Solutions", text: body });
      ok = "enviado";
    } catch (e) {
      // Uncertain: it may have gone out — keep the message (marked) and say so; never invite a blind resend.
      if (!isMailUncertain(e)) go(threadId, "err=correo");
      ok = "incierto";
    }
  }
  const now = new Date();
  await db.commMessage.create({ data: { threadId, direction: "OUT", authorName: user.name, body, sentAt: now, createdById: user.id } });
  await db.commThread.update({ where: { id: threadId }, data: { lastAt: now, lastOutAt: now } });
  if (th.dealId) {
    await db.activity.create({ data: { type: th.channel === "EMAIL" ? "EMAIL" : "NOTE", subject: `Respuesta al cliente: ${body.split("\n")[0].slice(0, 150)}${ok === "incierto" ? " (envío sin confirmar)" : ""}`, userId: user.id, accountId: th.accountId, contactId: th.contactId, dealId: th.dealId, uncertain: ok === "incierto" } });
  }
  go(threadId, `ok=${ok}`);
}

/** Link the conversation to a customer contact (when it arrived without one). */
export async function linkContact(threadId: string, fd: FormData) {
  const user = await requireUser();
  await ownThread(user, threadId);
  const contactId = z.string().min(1).parse(fd.get("contactId"));
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  await db.commThread.update({ where: { id: threadId }, data: { contactId, accountId: contact.accountId, partyName: `${contact.firstName} ${contact.lastName}` } });
  await refreshUnderstanding(threadId);
  go(threadId, "ok=vinculado");
}

/** Nothing more to do here: the thread leaves "needs you". */
export async function closeThread(threadId: string) {
  const user = await requireUser();
  await ownThread(user, threadId);
  await db.commThread.update({ where: { id: threadId }, data: { closedAt: new Date() } });
  go(threadId, "ok=cerrado");
}

export async function syncEmails(fd: FormData) {
  await requireUser();
  const t = String(fd.get("t") ?? "") || null;
  try {
    const r = await syncCustomerEmails({ force: true });
    await syncReplies({ force: true }).catch(() => null); // E2: replies to our emails (errors shown on /correo/respuestas)
    go(t, `ok=sync&n=${r.imported}`);
  } catch (e) {
    if (e instanceof CommMailError) go(t, `mail=${e.code}`);
    throw e;
  }
}
