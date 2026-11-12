"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { valueKindOf } from "@/lib/goal-rules";
import { CONTACT_LINE_SOURCE, getContactLinePolicy } from "@/lib/contact-line";
import { CONTACT_LINE_KEY, outcomeOf, parseCuts } from "@/lib/contact-line-rules";

// Comercial · Línea de comunicaciones. Registering a call, an email or a note from the slide, and the cut points.

const BASE = "/comercial/comunicaciones";
/** Keeps the person where they were: same view (`u`) and same band (`rango`) open. */
function back(fd: FormData, extra: Record<string, string>): never {
  const p = new URLSearchParams();
  const u = String(fd.get("u") ?? "");
  const rango = String(fd.get("rango") ?? "");
  if (/^[a-z0-9]{1,40}$/i.test(u)) p.set("u", u);
  if (/^\d{1,2}$/.test(rango)) p.set("rango", rango);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  refreshApp();
  redirect(`${BASE}?${p}`);
}

const KINDS = { CALL: "llamada", VIDEO: "video", MEETING: "visita", EMAIL: "correo", NOTE: "nota" } as const;

/** Anyone can register a contact with any customer (same rule as the customer page); it is signed with their name. */
export async function registerContact(fd: FormData) {
  const user = await requireUser();
  const accountId = String(fd.get("accountId") ?? "");
  const type = String(fd.get("type") ?? "") as keyof typeof KINDS;
  const account = accountId ? await db.account.findFirst({ where: { id: accountId, internal: false }, select: { id: true } }) : null;
  if (!account || !(type in KINDS)) back(fd, { err: "cliente" });
  const notes = String(fd.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
  const firstLine = notes.split("\n")[0].trim();

  // A note is only its text: it never counts as a contact, so the person stays on the company.
  if (type === "NOTE") {
    if (!notes) back(fd, { cliente: accountId, err: "texto", a: KINDS.NOTE });
    const subject = firstLine.slice(0, 200);
    await db.activity.create({ data: { type: "NOTE", subject, body: notes === subject ? null : notes, userId: user.id, accountId, source: CONTACT_LINE_SOURCE } });
    back(fd, { cliente: accountId, ok: "nota" });
  }

  // Call, video call, email, visit: how it ended is required (one of the check boxes); the notes are optional.
  const outcome = outcomeOf(type, fd.get("outcome"));
  if (!outcome) back(fd, { cliente: accountId, err: "estado", a: KINDS[type] });

  // The day it happened: today keeps the real time; an earlier day is stored as that calendar day. Never the future.
  const T = today();
  const raw = String(fd.get("occurredAt") ?? "");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : T;
  if (Number.isNaN(day.getTime()) || day > T) back(fd, { cliente: accountId, err: "fecha", a: KINDS[type] });
  const occurredAt = day.getTime() === T.getTime() ? new Date() : day;

  const contactId = String(fd.get("contactId") ?? "");
  const contact = contactId ? await db.contact.findFirst({ where: { id: contactId, accountId }, select: { id: true } }) : null;

  await db.activity.create({
    data: {
      type: type === "VIDEO" ? "CALL" : (type as "CALL" | "MEETING" | "EMAIL"), outcome: outcome.key, occurredAt, userId: user.id, accountId, contactId: contact?.id ?? null, source: CONTACT_LINE_SOURCE,
      // The history line says how it ended, then the first line of the notes; the full notes stay below it.
      subject: (firstLine ? `${outcome.record.es}: ${firstLine}` : outcome.record.es).slice(0, 200),
      body: notes && notes !== firstLine ? notes : null,
      // "What did it leave?" only applies when the contact really happened.
      valueKind: outcome.counts && outcome.key !== "PENDING_REPLY" ? valueKindOf(fd.get("valueKind")) : null,
    },
  });
  // Something that counts moves the company, so the person goes back to the list; otherwise they stay on the company.
  back(fd, { ok: "reg", k: type, o: outcome.key, hecho: accountId, ...(outcome.counts ? {} : { cliente: accountId }) });
}

export async function saveContactLinePolicy(fd: FormData) {
  const user = await requireUser();
  function go(qs: string): never { refreshApp(); redirect(`${BASE}?${qs}#rangos`); }
  if (!canManageAll(user)) go("err=permiso");
  const cuts = parseCuts(String(fd.get("cuts") ?? ""));
  if (!cuts) go("err=rangos");
  const cur = await getContactLinePolicy();
  if (JSON.stringify(cur.value.cutsMonths) === JSON.stringify(cuts)) go("ok=igual");
  await db.marketSetting.create({ data: { key: CONTACT_LINE_KEY, version: cur.version + 1, value: { cutsMonths: cuts }, updatedByName: user.name } });
  go("ok=rangos");
}
