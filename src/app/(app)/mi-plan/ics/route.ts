import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { calendarEvent, calendarTaskInclude, eventText } from "@/lib/calendar-event";

// Calendar file with the reserved blocks, so they can be added to Outlook.
// Blocks with a chosen time keep it; the rest are laid out one after another from 08:00 Bogotá (13:00 UTC).
// Titles and descriptions follow the C1 standard: [Tipo] – [Cliente/Proveedor] – [Parte/Orden].
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const tasks = await db.task.findMany({
    where: { assigneeId: user.id, status: "OPEN", plannedFor: { gte: today() } },
    include: calendarTaskInclude,
    orderBy: [{ plannedFor: "asc" }, { dueDate: "asc" }],
  });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const base = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  const { t } = makeI18n(user.lang);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
  // RFC 5545: lines longer than 75 octets are folded (continuation lines start with a space).
  const fold = (line: string) => {
    const bytes = Buffer.from(line, "utf8");
    if (bytes.length <= 75) return line;
    const out: string[] = []; let cur = "";
    for (const ch of line) { if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) { out.push(cur); cur = ""; } cur += ch; }
    out.push(cur);
    return out.join("\r\n ");
  };
  const cursor = new Map<string, number>();
  const events = tasks.map((tk) => {
    const day = tk.plannedFor!.toISOString().slice(0, 10);
    const minutes = tk.estimateMinutes ?? 30;
    let start: Date;
    if (tk.scheduledAt) start = tk.scheduledAt;
    else {
      const offset = cursor.get(day) ?? 0;
      cursor.set(day, offset + minutes);
      start = new Date(`${day}T13:00:00Z`);
      start.setUTCMinutes(start.getUTCMinutes() + offset);
    }
    const end = new Date(start.getTime() + minutes * 60000);
    const ev = calendarEvent(tk, t, base);
    return [
      "BEGIN:VEVENT",
      `UID:${tk.id}@solu`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(ev.title)}`,
      `DESCRIPTION:${esc(eventText(ev, t))}`,
      `URL:${ev.link}`,
      "CATEGORIES:SOLU",
      "END:VEVENT",
    ].map(fold).join("\r\n");
  });
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SOLU//Mi Plan//ES", ...events, "END:VCALENDAR"].join("\r\n");
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="mi-plan.ics"' },
  });
}
