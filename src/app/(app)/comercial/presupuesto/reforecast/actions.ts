"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { PROSPECTS, forecastMonths, parseMillions, sum, yearProgress } from "@/lib/sales-budget-rules";
import { budgetScope, canWriteBudget } from "@/lib/sales-budget";
import { trackYear } from "@/lib/sales-budget-track";
import { buildInsight } from "@/lib/sales-insight";

// Presupuesto comercial · Reforecast and the day's priorities (writes).
// A reforecast never touches the official budget: each save is a new cut with who, when and on what assumptions.

const BASE = "/comercial/presupuesto";

export async function saveForecast(year: number, slot: string, userId: string, fd: FormData) {
  const user = await requireUser();
  const page = `${BASE}/reforecast/${slot === PROSPECTS ? "prospectos" : slot}?y=${year}&u=${userId}`;
  const back = (qs: string, hash = ""): never => { refreshApp(); redirect(`${page}&${qs}${hash}`); };
  if (!canWriteBudget(user, userId)) back("err=permiso");
  const now = new Date();
  const prog = yearProgress(year, now);
  if (!prog.share.some((s) => s > 0) || prog.share.every((s) => s >= 1)) back("err=anio");
  const tr = await trackYear(year, now, { all: false, ids: new Set([userId]), only: userId, viewerId: user.id }, String);
  const line = tr.lines.find((l) => l.b.slot === slot);
  if (!line) back("err=presupuesto");
  const es = user.lang === "ES";
  const read = (prefix: string) => Array.from({ length: 12 }, (_, m) => (prog.share[m] < 1 ? parseMillions(fd.get(`${prefix}_${m + 1}`), es) : null));
  const ocProb = read("oc"), factProg = read("fact");
  if ([...ocProb, ...factProg].some((v) => v != null && (Number.isNaN(v) || v < 0 || v > 1e13))) back("err=valor", "#reforecast");
  const note = String(fd.get("note") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
  if (!note) back("err=supuestos", "#supuestos");
  const estOc = sum(forecastMonths(line!.realOc, ocProb, prog).map((x) => x.estimate));
  const estFact = sum(forecastMonths(line!.realFact, factProg, prog).map((x) => x.estimate));
  const lines = [
    ...ocProb.flatMap((v, m) => (v != null && v > 0 ? [{ month: m + 1, kpi: "OC_PROB", value: v }] : [])),
    ...factProg.flatMap((v, m) => (v != null && v > 0 ? [{ month: m + 1, kpi: "FACT_PROG", value: v }] : [])),
  ];
  await db.salesForecast.create({ data: { year, slot, accountId: slot === PROSPECTS ? null : slot, userId, note, estOc, estFact, createdById: user.id, createdByName: user.name, lines: { create: lines } } });
  back("ok=guardado", "#cortes");
}

/** Prepares (or prepares again) today's priorities of a person in the caller's view. */
export async function prepareInsight(year: number, personId: string) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`${BASE}/cumplimiento?y=${year}${personId !== user.id ? `&u=${personId}` : ""}&${qs}#prioridades`); };
  const scope = await budgetScope(user);
  if (personId !== user.id && !scope.all && !scope.ids.has(personId)) back("err=permiso");
  const person = await db.user.findUnique({ where: { id: personId }, select: { id: true, name: true, lang: true, active: true } });
  if (!person?.active) back("err=permiso");
  // The words are for whoever reads them on screen now; the evening email rebuilds them in the person's own language.
  const { payload } = await buildInsight({ id: person!.id, name: person!.name, lang: user.lang }, new Date());
  back(payload.aiNote === "AI_FAILED" ? "ok=prioridades-sin-ia" : "ok=prioridades");
}

export async function setEveningMail(year: number, on: boolean) {
  const user = await requireUser();
  const back = (qs: string): never => { refreshApp(); redirect(`${BASE}/cumplimiento?y=${year}&${qs}#correo-tarde`); };
  if (!canManageAll(user)) back("err=permiso");
  await db.salesBudgetSetting.upsert({ where: { id: "main" }, create: { id: "main", eveningMail: on, updatedByName: user.name }, update: { eveningMail: on, updatedByName: user.name } });
  back(on ? "ok=correo-on" : "ok=correo-off");
}
