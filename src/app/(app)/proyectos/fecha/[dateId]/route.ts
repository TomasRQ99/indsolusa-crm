import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { addDays, dayInput } from "@/lib/domain";
import { bogotaInput } from "@/lib/outlook";
import { DATE_KINDS } from "@/lib/projects";

// "Agregar a Outlook": one date of a project's timeline as a calendar file. Opening it adds the meeting, appointment
// or task to the person's Outlook (or any calendar), with a link back to the project. No hour = an all-day entry.
export async function GET(_req: Request, { params }: { params: Promise<{ dateId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { dateId } = await params;
  const d = await db.projectDate.findUnique({ where: { id: dateId }, include: { project: { select: { id: true, kind: true, code: true, title: true, summary: true } } } });
  if (!d || d.project.kind !== "PROJECT") return new Response("Not found", { status: 404 });
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const link = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}/proyectos/${d.project.id}`;
  const en = user.lang === "EN";
  const k = DATE_KINDS[d.kind] ?? DATE_KINDS.DELIVERABLE;
  const fmt = (x: Date) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");
  // RFC 5545: lines longer than 75 octets are folded (continuation lines start with a space).
  const fold = (line: string) => {
    if (Buffer.byteLength(line, "utf8") <= 75) return line;
    const out: string[] = []; let cur = "";
    for (const ch of line) { if (Buffer.byteLength(cur + ch, "utf8") > (out.length ? 74 : 75)) { out.push(cur); cur = ""; } cur += ch; }
    out.push(cur);
    return out.join("\r\n ");
  };
  const start = d.time ? bogotaInput(dayInput(d.day), d.time) : null;
  const span = start
    ? [`DTSTART:${fmt(start)}`, `DTEND:${fmt(new Date(start.getTime() + d.minutes * 60000))}`]
    : [`DTSTART;VALUE=DATE:${dayInput(d.day).replace(/-/g, "")}`, `DTEND;VALUE=DATE:${dayInput(addDays(d.day, 1)).replace(/-/g, "")}`];
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SOLU//Proyectos//ES", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:project-date-${d.id}@solu`,
    `DTSTAMP:${fmt(new Date())}`,
    ...span,
    `SUMMARY:${esc(`${en ? k.en : k.es}: ${d.title} · ${d.project.title}`)}`,
    `DESCRIPTION:${esc(`${en ? "Project" : "Proyecto"} ${d.project.code} · ${d.project.title}\n${d.project.summary}\n${en ? "Open in SOLU" : "Abrir en SOLU"}: ${link}`)}`,
    `URL:${link}`,
    "CATEGORIES:SOLU",
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(d.title)}`, "TRIGGER:-PT15M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].map(fold).join("\r\n");
  return new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="proyecto-${d.project.code}.ics"` } });
}
