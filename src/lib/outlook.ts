import { cache } from "react";
import { forgetGraphToken, graphAccessToken } from "./mail";
import { addDays, today } from "./domain";

// Outlook calendar through Microsoft Graph (app registration with Calendars.ReadWrite).
// Security rule: a person can only connect THEIR OWN mailbox, the email they sign in with.
// Bogotá has no daylight saving: local = UTC − 5 h all year.

const BOGOTA_OFFSET_MIN = -5 * 60;
const DAY_START_MIN = 8 * 60; // 08:00 local

export type OutlookEvent = {
  id: string;
  subject: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  showAs: string;
  location: string;
  attendees: string[]; // lower-case emails
  webLink: string;
  fromSolu: boolean;
};

export class OutlookError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "DENIED" | "NO_MAILBOX" | "OTHER", message: string) {
    super(message);
  }
}

/** UTC instant for a local Bogotá time on a calendar day (stored as UTC midnight). */
export function bogotaTime(day: Date, minutes: number) {
  return new Date(day.getTime() + (minutes - BOGOTA_OFFSET_MIN) * 60000);
}

async function graph(path: string, init: RequestInit = {}) {
  const token = await graphAccessToken();
  if (!token) throw new OutlookError("NOT_CONFIGURED", "Microsoft Graph is not configured on this server.");
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'outlook.timezone="UTC"', ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 204) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { code?: string; message?: string } };
  if (res.ok) return data;
  if (res.status === 401) forgetGraphToken();
  const code = data.error?.code ?? "";
  if (res.status === 403 || code === "ErrorAccessDenied" || code === "Authorization_RequestDenied") {
    throw new OutlookError("DENIED", "Microsoft denied access to the calendar. The app needs the Calendars.ReadWrite application permission with admin consent.");
  }
  if (res.status === 404 || code === "ErrorInvalidUser" || code === "MailboxNotEnabledForRESTAPI" || code === "ResourceNotFound") {
    throw new OutlookError("NO_MAILBOX", "Microsoft could not find an Outlook mailbox for this email.");
  }
  throw new OutlookError("OTHER", `Microsoft Graph error ${res.status}${code ? ` (${code})` : ""}: ${data.error?.message ?? "unknown"}`);
}

type RawEvent = {
  id: string;
  subject?: string;
  isAllDay?: boolean;
  showAs?: string;
  webLink?: string;
  categories?: string[];
  start: { dateTime: string };
  end: { dateTime: string };
  location?: { displayName?: string };
  attendees?: { emailAddress?: { address?: string } }[];
};

const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);

export async function listEvents(mailbox: string, from: Date, to: Date): Promise<OutlookEvent[]> {
  const q = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $select: "subject,start,end,isAllDay,showAs,location,attendees,webLink,categories",
    $orderby: "start/dateTime",
    $top: "100",
  });
  const data = (await graph(`/users/${encodeURIComponent(mailbox)}/calendarView?${q}`)) as { value?: RawEvent[] } | null;
  return (data?.value ?? []).map((e) => ({
    id: e.id,
    subject: e.subject || "(sin asunto)",
    start: utc(e.start.dateTime),
    end: utc(e.end.dateTime),
    isAllDay: !!e.isAllDay,
    showAs: e.showAs ?? "busy",
    location: e.location?.displayName ?? "",
    attendees: (e.attendees ?? []).map((a) => a.emailAddress?.address?.toLowerCase() ?? "").filter(Boolean),
    webLink: e.webLink ?? "",
    fromSolu: (e.categories ?? []).includes("SOLU"),
  }));
}

/** Today's and the next days' events for a connected person; never throws (Mi Día must always load). */
export const agendaFor = cache(async (user: { email: string; outlookConnectedAt: Date | null }, days = 3) => {
  if (!user.outlookConnectedAt) return { connected: false as const, events: [] as OutlookEvent[], error: null as string | null };
  const day = today();
  try {
    const events = await listEvents(user.email, bogotaTime(day, 0), bogotaTime(addDays(day, days), 0));
    return { connected: true as const, events, error: null };
  } catch (e) {
    return { connected: true as const, events: [] as OutlookEvent[], error: e instanceof OutlookError ? e.code : "OTHER" };
  }
});

export async function createEvent(mailbox: string, ev: { subject: string; start: Date; minutes: number; body: string; link?: string; transactionId: string }) {
  const end = new Date(ev.start.getTime() + ev.minutes * 60000);
  const html = `<p>${escapeHtml(ev.body)}</p>${ev.link ? `<p><a href="${ev.link}">Abrir en SOLU</a></p>` : ""}`;
  const data = (await graph(`/users/${encodeURIComponent(mailbox)}/events`, {
    method: "POST",
    body: JSON.stringify({
      subject: ev.subject,
      body: { contentType: "HTML", content: html },
      start: { dateTime: ev.start.toISOString().slice(0, 19), timeZone: "UTC" },
      end: { dateTime: end.toISOString().slice(0, 19), timeZone: "UTC" },
      categories: ["SOLU"],
      showAs: "busy",
      isReminderOn: true,
      reminderMinutesBeforeStart: 5,
      transactionId: ev.transactionId, // Outlook ignores a repeated create with the same id
    }),
  })) as { id: string; webLink?: string };
  return { id: data.id, start: ev.start, end };
}

export async function deleteEvent(mailbox: string, id: string) {
  try {
    await graph(`/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof OutlookError && e.code === "NO_MAILBOX")) throw e;
  }
}

/**
 * First free gap of `minutes` on `day` inside the working day (from 08:00 local, or from now
 * if the day is today), skipping busy/tentative/OOF events. Null if nothing fits.
 */
export function findFreeSlot(events: OutlookEvent[], day: Date, minutes: number, workdayMinutes: number, reserved: { start: Date; end: Date }[] = []) {
  const dayStart = bogotaTime(day, DAY_START_MIN);
  const dayEnd = bogotaTime(day, DAY_START_MIN + workdayMinutes);
  const q = 15 * 60000;
  let cursor = new Date(Math.max(dayStart.getTime(), Math.ceil(Date.now() / q) * q));
  const busy = [
    ...events.filter((e) => !e.isAllDay && e.showAs !== "free" && e.end > dayStart && e.start < dayEnd).map((e) => ({ start: e.start, end: e.end })),
    ...reserved,
  ].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const b of busy) {
    if (b.start.getTime() - cursor.getTime() >= minutes * 60000) break;
    if (b.end > cursor) cursor = new Date(Math.ceil(b.end.getTime() / q) * q);
  }
  return cursor.getTime() + minutes * 60000 <= dayEnd.getTime() ? cursor : null;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function hhmm(d: Date, locale = "es-CO") {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);
}
