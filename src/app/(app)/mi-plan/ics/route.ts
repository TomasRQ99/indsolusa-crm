import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { today } from "@/lib/domain";

// Calendar file with the reserved blocks, so they can be added to Outlook.
// Blocks are laid out one after another from 08:00 Bogotá time (13:00 UTC).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const tasks = await db.task.findMany({
    where: { assigneeId: user.id, status: "OPEN", plannedFor: { gte: today() } },
    include: { deal: { select: { code: true } } },
    orderBy: [{ plannedFor: "asc" }, { dueDate: "asc" }],
  });
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const cursor = new Map<string, number>();
  const events = tasks.map((tk) => {
    const day = tk.plannedFor!.toISOString().slice(0, 10);
    const offset = cursor.get(day) ?? 0;
    const minutes = tk.estimateMinutes ?? 30;
    cursor.set(day, offset + minutes);
    const start = new Date(`${day}T13:00:00Z`);
    start.setUTCMinutes(start.getUTCMinutes() + offset);
    const end = new Date(start.getTime() + minutes * 60000);
    return [
      "BEGIN:VEVENT",
      `UID:${tk.id}@solu`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${esc((tk.deal?.code ? `${tk.deal.code} · ` : "") + tk.title)}`,
      "END:VEVENT",
    ].join("\r\n");
  });
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SOLU//Mi Plan//ES", ...events, "END:VCALENDAR"].join("\r\n");
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="mi-plan.ics"' },
  });
}
