import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canExportReports } from "@/lib/permissions";
import { db } from "@/lib/db";
import { periodOf } from "@/lib/goal-rules";
import { METRICS } from "@/lib/metric-dictionary";
import { DIM_TEXT, builderFacts, buildRows, cleanConfig } from "@/lib/report-builder";
import { csvBody, csvNum, csvResponse } from "@/lib/report-csv";

// Módulo 13 §15 · export of a builder report. Gerencia and Finanzas only (decision 2026-11-11); both see everything.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canExportReports(user)) return new Response("Forbidden", { status: 403 });
  const now = new Date();
  const c = cleanConfig(Object.fromEntries(req.nextUrl.searchParams), periodOf(now));
  const [facts, owner, account] = await Promise.all([
    builderFacts(c, null),
    c.ownerId ? db.user.findUnique({ where: { id: c.ownerId }, select: { name: true } }) : null,
    c.accountId ? db.account.findUnique({ where: { id: c.accountId }, select: { name: true } }) : null,
  ]);
  const { rows, total } = buildRows(facts, c);
  const line = (label: string, r: (typeof rows)[number]) => [label, r.n, csvNum(r.sale), csvNum(r.esagara), r.esagaraPct != null ? csvNum(r.esagaraPct) : ""];
  const body = csvBody(
    [
      ["Informe", "SOLU · Constructor de informes"], ["Periodo", `${c.from} a ${c.to}`], ["Agrupado por", DIM_TEXT[c.dim].es],
      ["Negociador", owner?.name ?? "Todos"], ["Cliente", account?.name ?? "Todos"],
      ["Calculado", now.toISOString()], ["Descargado por", user.name],
      ["Métricas", ["SALES", "ESAGARA_AMOUNT", "ESAGARA_PCT"].map((k) => `${METRICS[k].name.es} v${METRICS[k].version}`).join(", ")],
    ],
    [DIM_TEXT[c.dim].es, "Ventas aceptadas", "Venta USD", "Eságara USD", "Eságara %"],
    [...rows.map((r) => line(r.label, r)), line("Total", total)],
  );
  return csvResponse(body, `solu-informe-${c.from}-a-${c.to}.csv`);
}
