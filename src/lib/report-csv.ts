// Módulo 13 §15, AC54 · a report taken out of SOLU keeps its period, as-of, filters and metric versions on top.
// UTF-8 BOM and semicolons so Excel (Spanish locale) opens it correctly.

const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : /^[=+\-@]/.test(s) && isNaN(Number(s)) ? `'${s}` : s; };
export const csvNum = (n: number) => n.toFixed(2);
export function csvBody(meta: [string, string][], header: string[], rows: (string | number | null)[][]) {
  return "﻿" + [...meta.map((m) => m.map(esc).join(";")), "", header.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))].join("\r\n");
}
export const csvResponse = (body: string, filename: string) => new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
