import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canExportReports } from "@/lib/permissions";
import { db } from "@/lib/db";
import { periodOf, shiftPeriod, validPeriod } from "@/lib/goal-rules";
import { METRICS } from "@/lib/metric-dictionary";
import { computePulse, pulseGroups, type PulseData } from "@/lib/pulse";
import { csvBody, csvNum, csvResponse } from "@/lib/report-csv";

// Módulo 13 §5, §15 · export of the Business Pulse of a month. Gerencia and Finanzas only (decision 2026-11-11).
// An issued month exports the figures saved at its close; otherwise the live calculation, marked as not issued.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canExportReports(user)) return new Response("Forbidden", { status: 403 });
  const now = new Date();
  const cur = periodOf(now);
  const mes = req.nextUrl.searchParams.get("mes") ?? "";
  const period = validPeriod(mes) && mes <= cur ? mes : shiftPeriod(cur, -1);
  const closed = await db.pulseSnapshot.findFirst({ where: { period, reopenedAt: null }, orderBy: { version: "desc" } });
  const data = closed ? (closed.data as unknown as PulseData) : await computePulse(period, now);
  const { groups, prevOf } = pulseGroups(data);
  const val = (unit: string, v: number) => (unit === "n" ? String(Math.round(v)) : csvNum(v));
  const rows = groups.flatMap((g) => g.metrics.map((m) => {
    const pv = m.kind === "PERIOD" ? prevOf(m.key) : null;
    return [g.title.es, m.label.es, m.unit === "usd" ? "USD" : m.unit === "pct" ? "%" : "cantidad", val(m.unit, m.value), pv != null ? val(m.unit, pv) : "", m.kind === "PERIOD" ? "En el mes" : closed ? "Foto al cierre" : "Foto de hoy", m.metric && METRICS[m.metric] ? `v${METRICS[m.metric].version}` : ""];
  }));
  const body = csvBody(
    [
      ["Informe", "SOLU · Pulso del negocio"], ["Periodo", period],
      ["Estado", closed ? `Emitido por ${closed.closedByName} el ${closed.closedAt.toISOString().slice(0, 10)} (cierre ${closed.version})` : period < cur ? "Sin emitir: cálculo en vivo" : "Provisional: el mes sigue abierto"],
      ["Calculado", data.asOf], ["Descargado por", user.name],
    ],
    ["Función", "Qué", "Unidad", "Valor", "Mes anterior", "Tipo", "Versión de la métrica"],
    rows,
  );
  return csvResponse(body, `solu-pulso-${period}.csv`);
}
