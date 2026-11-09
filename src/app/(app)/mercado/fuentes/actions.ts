"use server";

// Mercado M3 · Intelligence sources: upload, map, review and commit economic datasets; thresholds for signals.
// Import is for Administration, Management and Marketing (§18); thresholds are a management decision (§32).

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canImportData, canManageAll } from "@/lib/permissions";
import { refreshApp } from "@/lib/revalidate";
import { chooseSheet, commitImport, decideRows, getThresholds, uploadDataset, validateImport } from "@/lib/dataset-import";
import { DEFAULT_THRESHOLDS, FIELDS, SCALES, SOURCE_KINDS, isTarget, type FieldKey, type Mapping } from "@/lib/fin-rules";

const BASE = "/mercado/fuentes";
const go = (path: string): never => { refreshApp(); redirect(path); };
async function importer() { const u = await requireUser(); if (!canImportData(u)) redirect("/mercado/economia"); return u; }

export async function createSource(fd: FormData) {
  const user = await importer();
  const name = String(fd.get("name") ?? "").trim().slice(0, 120);
  if (!name) go(`${BASE}?err=fuente`);
  const kind = String(fd.get("kind") ?? "OTHER");
  await db.intelligenceSource.upsert({ where: { name }, update: {}, create: { name, kind: kind in SOURCE_KINDS ? kind : "OTHER", description: String(fd.get("description") ?? "").trim().slice(0, 300) || null, createdByName: user.name } });
  go(`${BASE}?ok=fuente`);
}

export async function uploadFile(fd: FormData) {
  const user = await importer();
  const sourceId = String(fd.get("sourceId") ?? "");
  const file = fd.get("file");
  if (!(file instanceof File)) go(`${BASE}?err=vacio`);
  const r = await uploadDataset(sourceId, file as File, user.name);
  if (r.error) go(`${BASE}?err=${r.error}${r.dupOf ? `&dup=${r.dupOf}` : ""}`);
  go(`${BASE}/${r.id}`);
}

export async function setSheet(importId: string, fd: FormData) {
  await importer();
  await chooseSheet(importId, String(fd.get("sheet") ?? ""));
  go(`${BASE}/${importId}`);
}

/** Saves the mapping and validates every row. Scale and currency must be chosen explicitly (No Debt Zone). */
export async function saveMapping(importId: string, fd: FormData) {
  await importer();
  const imp = await db.datasetImport.findUnique({ where: { id: importId }, select: { status: true, headers: true } });
  if (!imp || imp.status === "COMMITTED") go(`${BASE}/${importId}`);
  const cells = ((imp!.headers as { cells?: unknown[] }).cells ?? []);
  const mapping: Mapping = {};
  cells.forEach((_, i) => { const v = String(fd.get(`col_${i}`) ?? ""); if (v && isTarget(v)) mapping[String(i)] = v; });
  const scale = String(fd.get("scale") ?? ""), currency = String(fd.get("currency") ?? "");
  const decimalStyle = ["COMMA", "DOT"].includes(String(fd.get("decimalStyle"))) ? String(fd.get("decimalStyle")) : null;
  const y = Number(fd.get("fixedYear") || 0);
  const fixedYear = Number.isInteger(y) && y >= 1990 && y <= new Date().getUTCFullYear() ? y : null;
  // Keep what the person chose even if something is missing, so they don't retype it.
  await db.datasetImport.update({ where: { id: importId }, data: { mapping, scale: scale in SCALES ? scale : null, currency: ["COP", "USD"].includes(currency) ? currency : null, decimalStyle, fixedYear } });
  if (!(scale in SCALES)) go(`${BASE}/${importId}?err=escala`);
  if (!["COP", "USD"].includes(currency)) go(`${BASE}/${importId}?err=moneda`);
  const { mappingProblems } = await import("@/lib/fin-rules");
  if (mappingProblems(mapping, fixedYear).length) go(`${BASE}/${importId}?err=mapeo`);
  await validateImport(importId, { mapping, scale, currency, decimalStyle, fixedYear });
  go(`${BASE}/${importId}?ok=validado`);
}

/** Review decisions: one row, or every row with the same kind of exception. */
export async function decide(importId: string, fd: FormData) {
  await importer();
  const decision = fd.get("decision") === "INCLUDE" ? "INCLUDE" : "EXCLUDE";
  const rowId = String(fd.get("rowId") ?? "");
  const group = String(fd.get("group") ?? "");
  if (rowId) await decideRows(importId, { id: rowId }, decision);
  else if (group) {
    const rows = await db.datasetRow.findMany({ where: { importId, status: "REVIEW" }, select: { id: true, messages: true } });
    const ids = rows.filter((r) => r.messages.some((m) => m.split(" (")[0].split(":")[0] === group)).map((r) => r.id);
    await decideRows(importId, { id: { in: ids } }, decision);
  }
  go(`${BASE}/${importId}#revisar`);
}

export async function commit(importId: string) {
  const user = await importer();
  const r = await commitImport(importId, user.name);
  if (r.error) go(`${BASE}/${importId}?err=${r.error}`);
  go(`${BASE}/${importId}?ok=guardado&n=${r.snapshots}&s=${r.signals}`);
}

export async function discard(importId: string) {
  await importer();
  const imp = await db.datasetImport.findUnique({ where: { id: importId }, select: { status: true } });
  if (imp && imp.status !== "COMMITTED") {
    await db.datasetRow.deleteMany({ where: { importId } });
    await db.datasetImport.update({ where: { id: importId }, data: { status: "DISCARDED" } });
  }
  go(`${BASE}?ok=descartado`);
}

/** New version of the signal thresholds (never edits a previous version). Managers only. */
export async function saveThresholds(fd: FormData) {
  const user = await requireUser();
  if (!canManageAll(user)) go(`${BASE}?err=permiso`);
  const cur = await getThresholds();
  const value = Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).map((k) => { const v = Number(String(fd.get(k) ?? "").replace(",", ".")); return [k, Number.isFinite(v) && v >= 0 && v <= 1000 ? v : (cur.value as Record<string, number>)[k]]; }));
  await db.marketSetting.create({ data: { key: "econThresholds", version: cur.version + 1, value, updatedByName: user.name } });
  go(`${BASE}?ok=umbrales#umbrales`);
}
