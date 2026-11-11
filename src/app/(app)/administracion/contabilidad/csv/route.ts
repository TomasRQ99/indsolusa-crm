import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canExportReports } from "@/lib/permissions";
import { db } from "@/lib/db";
import { EXPORT_KINDS, accountingRows } from "@/lib/accounting-export";
import { csvBody, csvResponse } from "@/lib/report-csv";

// Módulo 14 §2J · a file of facts for the accounting system. Gerencia and Finanzas (same rule as report exports).
// It only reads; the one thing it writes is the log line saying who took which file out.
const day = (s: string | null) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? ""); if (!m) return null; const x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return Number.isNaN(+x) ? null : x; };

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canExportReports(user)) return new Response("Forbidden", { status: 403 });
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") ?? "", from = day(q.get("from")), to = day(q.get("to"));
  if (!EXPORT_KINDS[kind] || !from || !to || to < from || (+to - +from) / 864e5 > 366) return new Response("Bad request: kind, from and to (at most one year) are required", { status: 400 });
  const out = await accountingRows(kind, from, to);
  if (!out) return new Response("Bad request", { status: 400 });
  await db.accountingExport.create({ data: { kind, periodFrom: from, periodTo: to, rows: out.rows.length, byName: user.name } });
  const body = csvBody(
    [["Archivo", `SOLU · ${EXPORT_KINDS[kind].es}`], ["Desde", from.toISOString().slice(0, 10)], ["Hasta", to.toISOString().slice(0, 10)], ["Qué contiene", EXPORT_KINDS[kind].noteEs], ["Filas", String(out.rows.length)], ["Descargado por", user.name], ["Descargado", new Date().toISOString()], ["Aviso", "Hechos operativos de SOLU. No reemplaza la contabilidad ni es una declaración tributaria."]],
    out.header, out.rows,
  );
  return csvResponse(body, `solu-${kind.toLowerCase().replace(/_/g, "-")}-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv`);
}
