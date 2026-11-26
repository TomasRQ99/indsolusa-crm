"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { refreshApp } from "@/lib/revalidate";
import { canLoadHistory, checkBatch } from "@/lib/sales-history";
import { UNITS } from "@/lib/sales-history-rules";
import { readXlsx } from "@/lib/sheet-read";
import { SiigoFail, pullSiigo, siigoAsRows } from "@/lib/siigo";

// Presupuesto comercial · Historial: loading the figures from before SOLU. Two steps on purpose: "Revisar" keeps the
// pasted text and shows what SOLU understood (nothing counts yet); "Guardar historial" writes the rows that could be
// read. A load can be removed whole. Gerencia, Dirección Comercial, Finanzas and Administración.

const BASE = "/comercial/presupuesto/historial";
const MAX_CHARS = 5_000_000;

function decode(buf: ArrayBuffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  // A CSV saved by Excel without "UTF-8" comes in the Windows code page: read it that way so accents survive.
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

export async function checkHistory(fd: FormData) {
  const user = await requireUser();
  if (!canLoadHistory(user)) redirect(`${BASE}?err=permiso`);
  const source = fd.get("source") === "SIIGO" ? "SIIGO" : "ANTERIOR";
  const currency = fd.get("currency") === "USD" ? "USD" : "COP";
  const unit = UNITS.find((u) => String(u) === String(fd.get("unit"))) ?? 1;
  const label = String(fd.get("label") ?? "").trim().slice(0, 120);
  const file = fd.get("file");
  let raw = String(fd.get("rows") ?? "");
  if (!raw.trim() && file instanceof File && file.size > 0) {
    if (/\.xls$/i.test(file.name)) redirect(`${BASE}?err=excel#cargar`);
    if (file.size > MAX_CHARS) redirect(`${BASE}?err=grande#cargar`);
    if (/\.(xlsx|xlsm)$/i.test(file.name)) {
      // The first sheet, as the cells show: a number keeps two decimals at most, so no thousands mark can be misread.
      let rows: (string | number | null)[][] = [];
      try { rows = readXlsx(Buffer.from(await file.arrayBuffer())).rows; } catch { redirect(`${BASE}?err=excel#cargar`); }
      const cell = (v: string | number | null) => (v == null ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v).replace(/[\t\r\n]+/g, " ").trim());
      raw = rows.map((r) => r.map(cell).join("\t")).join("\n");
    } else raw = decode(await file.arrayBuffer());
  }
  if (!raw.trim()) redirect(`${BASE}?err=vacio#cargar`);
  if (raw.length > MAX_CHARS) redirect(`${BASE}?err=grande#cargar`);
  if (!label) redirect(`${BASE}?err=nombre#cargar`);
  // A review that was never saved nor discarded is dropped after a day.
  await db.salesHistoryBatch.deleteMany({ where: { state: "CHECKED", createdAt: { lt: new Date(Date.now() - 864e5) } } });
  const b = await db.salesHistoryBatch.create({ data: { source, currency, unit, label, raw, createdById: user.id, createdByName: user.name } });
  redirect(`${BASE}?b=${b.id}#revision`);
}

/** Reads Siigo's invoicing of a span of months and opens the same review a pasted file gets. Nothing is saved. */
export async function pullFromSiigo(fd: FormData) {
  const user = await requireUser();
  if (!canLoadHistory(user)) redirect(`${BASE}?err=permiso`);
  const from = String(fd.get("from") ?? ""), to = String(fd.get("to") ?? "");
  const ok = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
  if (!ok(from) || !ok(to) || from > to) redirect(`${BASE}?err=siigo-meses#leer-siigo`);
  const span = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
  if (span > 12) redirect(`${BASE}?err=siigo-rango#leer-siigo`);
  let raw = "", note = "";
  try {
    const p = await pullSiigo(from, to);
    if (!p.rows.length) redirect(`${BASE}?err=siigo-vacio#leer-siigo`);
    raw = siigoAsRows(p);
    note = `${p.invoices} facturas, ${p.creditNotes} notas crédito${p.annulled ? `, ${p.annulled} anuladas sin contar` : ""}`;
  } catch (e) {
    if (e instanceof SiigoFail) redirect(`${BASE}?err=siigo-${e.code.toLowerCase()}#leer-siigo`);
    throw e;
  }
  const b = await db.salesHistoryBatch.create({ data: { source: "SIIGO", currency: "COP", unit: 1, label: `Siigo ${from} a ${to} (leído de Siigo: ${note})`.slice(0, 120), raw, createdById: user.id, createdByName: user.name } });
  redirect(`${BASE}?b=${b.id}#revision`);
}

export async function applyHistory(id: string) {
  const user = await requireUser();
  if (!canLoadHistory(user)) redirect(`${BASE}?err=permiso`);
  const b = await db.salesHistoryBatch.findUnique({ where: { id } });
  if (!b || b.state !== "CHECKED") redirect(`${BASE}?err=estado`);
  const c = await checkBatch(b!);
  if (!c.figures.length) redirect(`${BASE}?b=${id}&err=nada#revision`);
  // A newer load replaces what an earlier one of the same origin said for the same company, month and indicator.
  const months = new Map<string, Set<string>>();
  for (const f of c.figures) months.set(f.accountId, (months.get(f.accountId) ?? new Set()).add(f.month));
  const keys = new Set(c.figures.map((f) => `${f.accountId}|${f.month}|${f.kpi}`));
  const old = await db.salesHistoryMonth.findMany({ where: { source: b!.source, batchId: { not: id }, OR: [...months].map(([accountId, ms]) => ({ accountId, month: { in: [...ms] } })) }, select: { id: true, accountId: true, month: true, kpi: true } });
  const drop = old.filter((o) => keys.has(`${o.accountId}|${o.month}|${o.kpi}`)).map((o) => o.id);
  await db.$transaction([
    db.salesHistoryMonth.deleteMany({ where: { id: { in: drop } } }),
    db.salesHistoryMonth.createMany({ data: c.figures.map((f) => ({ batchId: id, accountId: f.accountId, userId: f.userId, month: f.month, kpi: f.kpi, value: f.value, orig: f.orig, currency: f.currency, rate: f.rate, source: b!.source })) }),
    db.salesHistoryBatch.update({ where: { id }, data: { state: "APPLIED", appliedAt: new Date() } }),
  ]);
  refreshApp();
  redirect(`${BASE}?ok=guardado#cargas`);
}

/** Drops a review that was not saved, or removes a saved load with every figure it brought. */
export async function removeHistory(id: string) {
  const user = await requireUser();
  if (!canLoadHistory(user)) redirect(`${BASE}?err=permiso`);
  const b = await db.salesHistoryBatch.findUnique({ where: { id }, select: { state: true } });
  if (!b) redirect(`${BASE}?err=estado`);
  await db.salesHistoryBatch.delete({ where: { id } });
  refreshApp();
  redirect(`${BASE}?ok=${b!.state === "APPLIED" ? "quitado" : "descartado"}#cargas`);
}
