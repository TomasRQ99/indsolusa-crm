import { requireUser } from "@/lib/auth";
import { canLoadHistory } from "@/lib/sales-history";
import { templateRows } from "@/lib/sales-history-rules";

// Presupuesto comercial · Historial: the template to fill in Excel (headings and two example rows).

export async function GET(req: Request) {
  const user = await requireUser();
  if (!canLoadHistory(user)) return new Response("Forbidden", { status: 403 });
  const siigo = new URL(req.url).searchParams.get("s") === "SIIGO";
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = "﻿" + templateRows(user.lang !== "EN", siigo ? "SIIGO" : "ANTERIOR").map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="plantilla-historial-${siigo ? "siigo" : "sistema-anterior"}.csv"`, "Cache-Control": "private, no-store" } });
}
