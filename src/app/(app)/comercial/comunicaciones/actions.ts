"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { today } from "@/lib/domain";
import { valueKindOf } from "@/lib/goal-rules";
import { CONTACT_LINE_SOURCE, getContactLinePolicy } from "@/lib/contact-line";
import { CONTACT_LINE_KEY, parseCuts } from "@/lib/contact-line-rules";

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

const KINDS = { CALL: "llamada", EMAIL: "correo", NOTE: "nota" } as const;

/** Anyone can register a contact with any customer (same rule as the customer page); it is signed with their name. */
export async function registerContact(fd: FormData) {
  const user = await requireUser();
  const accountId = String(fd.get("accountId") ?? "");
  const type = String(fd.get("type") ?? "") as keyof typeof KINDS;
  const account = accountId ? await db.account.findFirst({ where: { id: accountId, internal: false }, select: { id: true } }) : null;
  if (!account || !(type in KINDS)) back(fd, { err: "cliente" });
  const subject = String(fd.get("subject") ?? "").trim().slice(0, 200);
  if (!subject) back(fd, { cliente: accountId, err: "texto", a: KINDS[type] });
  const body = String(fd.get("body") ?? "").trim().slice(0, 2000) || null;

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
      type, subject, body, occurredAt, userId: user.id, accountId, contactId: contact?.id ?? null, source: CONTACT_LINE_SOURCE,
      valueKind: type === "NOTE" ? null : valueKindOf(fd.get("valueKind")),
    },
  });
  // A note leaves the company where it was, so the person stays on it; a call or an email moves it to "al día".
  if (type === "NOTE") back(fd, { cliente: accountId, ok: "nota" });
  back(fd, { ok: KINDS[type], hecho: accountId });
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
