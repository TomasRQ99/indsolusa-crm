import { requireUser } from "@/lib/auth";
import { canExportReports, canManageAll } from "@/lib/permissions";
import { KPIS, KPI_KEYS, MONTHS, PROSPECTS, STATE_TXT, shownState } from "@/lib/sales-budget-rules";
import { budgetYears, budgetsOf, groupVersions, matrixOf, readYear, teamOfPeople, yearRow } from "@/lib/sales-budget";

// Presupuesto comercial · the consolidation as a file: one row per company, negotiator and indicator, twelve months
// in whole dollars. Gerencia, Dirección Comercial and Finanzas (the roles that may take reports out of SOLU).

export async function GET(req: Request) {
  const user = await requireUser();
  if (!canManageAll(user) && !canExportReports(user)) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const now = new Date();
  const year = readYear(url.searchParams.get("y") ?? undefined, now);
  if (!budgetYears(now).years.includes(year)) return new Response("Bad year", { status: 400 });
  const official = url.searchParams.get("ver") === "oficial";
  const es = user.lang !== "EN";
  const [rows, yr, { teams, teamOf }] = await Promise.all([budgetsOf(year), yearRow(year), teamOfPeople()]);
  const published = !!yr?.publishedAt;
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = [es ? "Año" : "Year", es ? "Equipo" : "Team", es ? "Negociador" : "Negotiator", es ? "Empresa" : "Company", es ? "Versión" : "Version", es ? "Estado" : "State", es ? "Indicador" : "Indicator", ...MONTHS.map((m) => (es ? m.es : m.en)), es ? "Anual" : "Annual"];
  const lines: string[] = [];
  for (const g of groupVersions(rows).values()) {
    const b = official ? g.official : g.latest;
    if (!b) continue;
    const m = matrixOf(b);
    const team = teams.find((x) => x.id === teamOf.get(b.userId))?.name ?? "";
    const st = STATE_TXT[shownState(b, published)];
    for (const k of KPI_KEYS) {
      const vals = m[k];
      if (vals.every((v) => v == null)) continue;
      const out = vals.map((v) => (v == null ? "" : Math.round(v)));
      lines.push([year, team, b.user.name, b.slot === PROSPECTS ? (es ? "Reactivaciones y prospectos" : "Reactivations and prospects") : b.account?.name ?? "", b.version, es ? st.es : st.en, es ? KPIS[k].es : KPIS[k].en, ...out, vals.reduce<number>((s, v) => s + (v ?? 0), 0)].map(cell).join(";"));
    }
  }
  const csv = "﻿" + [head.map(cell).join(";"), ...lines].join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="presupuesto-comercial-${year}${official ? "-aprobado" : ""}.csv"`, "Cache-Control": "private, no-store" } });
}
