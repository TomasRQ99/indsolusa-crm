// Mercado M3 · dataset import pipeline (§9.2, §9.3, §23).
// UPLOADED → (PARSED) → MAPPING_REQUIRED → validate → REVIEW_REQUIRED | READY_TO_COMMIT → COMMITTED (or DISCARDED / FAILED).
// The original file is kept; rows are staged; nothing canonical is written until the person commits,
// and the commit is one transaction: a failure leaves no partial snapshots.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { readSheet, type Cell } from "./sheet-read";
import { DEFAULT_THRESHOLDS, FORMULA_VERSION, MONEY_FIELDS, checkRows, econSignals, findHeaderRow, suggestMapping, type Mapping, type MoneyField, type ParsedRow, type Snap, type Thresholds } from "./fin-rules";
import { fold } from "./part-lexicon";

export const MAX_FILE = 25 * 1024 * 1024;
const nameKey = (s: string | null | undefined) => fold(s ?? "").replace(/\b(s\.?a\.?s?|ltda|s\.?a|y cia|e\.?u|bic)\b/g, "").replace(/[^a-z0-9ñ]/g, "");
const nitKeyOf = (v: string | null | undefined) => { const d = (v ?? "").replace(/\D/g, ""); return d.length >= 6 ? d.slice(0, 9) : null; };

type Headers = { row: number; cells: Cell[]; sheetName: string; sheetNames: string[]; notes?: string[] };

export async function getThresholds(): Promise<{ value: Thresholds; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: "econThresholds" }, orderBy: { version: "desc" } });
  return s ? { value: { ...DEFAULT_THRESHOLDS, ...(s.value as Partial<Thresholds>) }, version: s.version, by: s.updatedByName, at: s.createdAt } : { value: DEFAULT_THRESHOLDS, version: 0, by: null, at: null };
}

function parseFile(fileName: string, buf: Buffer, sheet?: string) {
  const s = readSheet(fileName, buf, sheet);
  const hr = findHeaderRow(s.rows);
  const cells = (s.rows[hr] ?? []).map((c) => (c == null ? null : String(c)));
  const data = s.rows.slice(hr + 1).filter((r) => r && r.some((c) => c != null));
  // Text written above the table (title, "Miles de pesos"…): shown next to the scale choice, never applied by itself.
  const notes = [...new Set(s.rows.slice(0, hr).flat().filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim().slice(0, 200)))].slice(0, 6);
  return { headers: { row: hr, cells, sheetName: s.sheetName, sheetNames: s.sheetNames, notes } as Headers, data };
}

/** Upload: keeps the file, detects columns, suggests a mapping (the source's template first). Duplicate files are refused. */
export async function uploadDataset(sourceId: string, file: File, byName: string): Promise<{ id?: string; error?: string; dupOf?: string }> {
  if (!file || !file.size) return { error: "vacio" };
  if (file.size > MAX_FILE) return { error: "grande" };
  const buf = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  const dup = await db.datasetImport.findUnique({ where: { hash }, select: { id: true, status: true } });
  // A file that was discarded or couldn't be read was never trusted: it can be uploaded again.
  if (dup && (dup.status === "DISCARDED" || dup.status === "FAILED")) await db.datasetImport.delete({ where: { id: dup.id } });
  else if (dup) return { error: "duplicado", dupOf: dup.id };
  const source = await db.intelligenceSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "fuente" };
  let parsed: ReturnType<typeof parseFile>;
  try { parsed = parseFile(file.name, buf); } catch (e) {
    const imp = await db.datasetImport.create({ data: { sourceId, fileName: file.name.slice(0, 200), mime: file.type || "application/octet-stream", size: file.size, hash, data: buf, status: "FAILED", failure: (e as Error).message.slice(0, 300), headers: [], preview: [], createdByName: byName } });
    return { id: imp.id };
  }
  const tpl = source.mapping as { headers?: string[]; mapping?: Mapping; scale?: string; decimalStyle?: string; currency?: string } | null;
  const sameHeaders = tpl?.headers && JSON.stringify(tpl.headers) === JSON.stringify(parsed.headers.cells.map((c) => fold(String(c ?? ""))));
  const mapping: Mapping = sameHeaders && tpl?.mapping ? tpl.mapping : Object.fromEntries(Object.entries(suggestMapping(parsed.headers.cells)).map(([k, v]) => [k, v]));
  const imp = await db.datasetImport.create({
    data: {
      sourceId, fileName: file.name.slice(0, 200), mime: file.type || "application/octet-stream", size: file.size, hash, data: buf, status: "MAPPING_REQUIRED",
      headers: parsed.headers as unknown as Prisma.InputJsonValue, preview: parsed.data.slice(0, 8) as unknown as Prisma.InputJsonValue, rowCount: parsed.data.length, mapping: mapping as Prisma.InputJsonValue,
      // A template from the same source with the same columns brings its scale/currency as a suggestion; the person still confirms.
      scale: sameHeaders ? tpl?.scale ?? null : null, decimalStyle: sameHeaders ? tpl?.decimalStyle ?? null : null, currency: sameHeaders ? tpl?.currency ?? null : source.kind === "SUPERSOCIEDADES" ? "COP" : null, createdByName: byName,
    },
  });
  return { id: imp.id };
}

/** Switch sheet: re-reads the kept file and resets the mapping. */
export async function chooseSheet(importId: string, sheet: string) {
  const imp = await db.datasetImport.findUniqueOrThrow({ where: { id: importId } });
  const parsed = parseFile(imp.fileName, Buffer.from(imp.data), sheet);
  await db.datasetRow.deleteMany({ where: { importId } });
  await db.datasetImport.update({ where: { id: importId }, data: { status: "MAPPING_REQUIRED", headers: parsed.headers as unknown as Prisma.InputJsonValue, preview: parsed.data.slice(0, 8) as unknown as Prisma.InputJsonValue, rowCount: parsed.data.length, mapping: Object.fromEntries(Object.entries(suggestMapping(parsed.headers.cells))) as Prisma.InputJsonValue, okCount: 0, errorCount: 0, reviewCount: 0 } });
}

type Opts = { mapping: Mapping; scale: string; currency: string; decimalStyle: string | null; fixedYear: number | null };

/** Validates every row and stages it with its status and messages (Spanish; the page translates the fixed phrases). */
export async function validateImport(importId: string, o: Opts) {
  const imp = await db.datasetImport.findUniqueOrThrow({ where: { id: importId }, include: { source: true } });
  const h = imp.headers as unknown as Headers;
  const { data } = parseFile(imp.fileName, Buffer.from(imp.data), h.sheetName);
  const checked = data.flatMap((r, n) => checkRows(r, o.mapping, { scale: o.scale, decimalStyle: o.decimalStyle, fixedYear: o.fixedYear }).map((c) => ({ rowNo: h.row + 2 + n, ...c })));

  // Cross-row and cross-database checks.
  const keyCount = new Map<string, number>();
  for (const c of checked) if (c.parsed.nit && c.parsed.year) { const k = `${c.parsed.nit}|${c.parsed.year}`; keyCount.set(k, (keyCount.get(k) ?? 0) + 1); }
  const nits = [...new Set(checked.map((c) => c.parsed.nit).filter((x): x is string => !!x))];
  const [companies, accounts] = await Promise.all([
    nits.length ? db.marketCompany.findMany({ where: { nit: { in: nits } }, select: { id: true, nit: true, name: true, otherNames: true } }) : [],
    db.account.findMany({ where: { taxId: { not: null } }, select: { id: true, taxId: true } }),
  ]);
  const compByNit = new Map(companies.map((c) => [c.nit, c]));
  const accCount = new Map<string, number>();
  for (const a of accounts) { const k = nitKeyOf(a.taxId); if (k) accCount.set(k, (accCount.get(k) ?? 0) + 1); }
  const existing = companies.length ? await db.financialSnapshot.findMany({ where: { companyId: { in: companies.map((c) => c.id) }, import: { status: "COMMITTED" } }, orderBy: { createdAt: "desc" } }) : [];
  const snapKey = new Map<string, (typeof existing)[number]>();
  for (const s of existing) { const k = `${s.companyId}|${s.fiscalYear}`; if (!snapKey.has(k)) snapKey.set(k, s); }

  const rows = checked.map((c) => {
    const msgs = c.messages.map((m) => m.es);
    let status: string = c.status;
    const review = (m: string) => { msgs.push(m); if (status === "OK") status = "REVIEW"; };
    const p = c.parsed;
    if (status !== "ERROR" && p.nit && p.year) {
      if ((keyCount.get(`${p.nit}|${p.year}`) ?? 0) > 1) review("NIT repetido en el archivo para el mismo año: incluye solo una fila");
      const comp = compByNit.get(p.nit);
      if (comp && nameKey(comp.name) !== nameKey(p.name) && !comp.otherNames.some((n) => nameKey(n) === nameKey(p.name))) review(`Mismo NIT con otra razón social (antes: ${comp.name})`);
      if ((accCount.get(p.nit) ?? 0) > 1) review("Este NIT coincide con más de un cliente en SOLU");
      const prev = comp ? snapKey.get(`${comp.id}|${p.year}`) : undefined;
      if (prev) {
        const same = MONEY_FIELDS.every((k) => (prev[k] == null ? null : Number(prev[k])) === (p.values[k] ?? null));
        if (same) { status = "SKIPPED"; msgs.push("Ya importado con las mismas cifras"); }
        else review(`Ya existe ${p.year} con otras cifras: si la incluyes se guarda como otra versión (la anterior no se borra)`);
      }
    }
    return { importId, rowNo: c.rowNo, nit: p.nit, year: p.year, name: p.name, parsed: p as unknown as Prisma.InputJsonValue, status, messages: msgs, decision: null as string | null };
  });

  const counts = { ok: rows.filter((r) => r.status === "OK").length, err: rows.filter((r) => r.status === "ERROR").length, rev: rows.filter((r) => r.status === "REVIEW").length };
  await db.datasetRow.deleteMany({ where: { importId } });
  for (let i = 0; i < rows.length; i += 1000) await db.datasetRow.createMany({ data: rows.slice(i, i + 1000) });
  await db.datasetImport.update({ where: { id: importId }, data: { mapping: o.mapping as Prisma.InputJsonValue, scale: o.scale, currency: o.currency, decimalStyle: o.decimalStyle, fixedYear: o.fixedYear, okCount: counts.ok, errorCount: counts.err, reviewCount: counts.rev, status: counts.rev ? "REVIEW_REQUIRED" : "READY_TO_COMMIT" } });
  // Reusable mapping template for this source (§23).
  await db.intelligenceSource.update({ where: { id: imp.sourceId }, data: { mapping: { headers: h.cells.map((c) => fold(String(c ?? ""))), mapping: o.mapping, scale: o.scale, decimalStyle: o.decimalStyle, currency: o.currency } as Prisma.InputJsonValue } });
  return counts;
}

/** The person decides review rows; when none is pending the import is ready. */
export async function decideRows(importId: string, where: Prisma.DatasetRowWhereInput, decision: "INCLUDE" | "EXCLUDE") {
  await db.datasetRow.updateMany({ where: { ...where, importId, status: "REVIEW" }, data: { decision } });
  const pending = await db.datasetRow.count({ where: { importId, status: "REVIEW", decision: null } });
  await db.datasetImport.update({ where: { id: importId }, data: { status: pending ? "REVIEW_REQUIRED" : "READY_TO_COMMIT" } });
  return pending;
}

/** Links dataset companies to customers/prospects with the same NIT (only when exactly one matches). */
export async function linkCompaniesToAccounts(tx: Prisma.TransactionClient | typeof db = db) {
  const accounts = await tx.account.findMany({ where: { taxId: { not: null } }, select: { id: true, taxId: true, marketCompany: { select: { id: true } } } });
  const byKey = new Map<string, string[]>();
  for (const a of accounts) { const k = nitKeyOf(a.taxId); if (k) byKey.set(k, [...(byKey.get(k) ?? []), a.id]); }
  const free = await tx.marketCompany.findMany({ where: { accountId: null, nit: { in: [...byKey.keys()] } }, select: { id: true, nit: true } });
  const taken = new Set(accounts.filter((a) => a.marketCompany).map((a) => a.id));
  let n = 0;
  for (const c of free) { const ids = byKey.get(c.nit) ?? []; if (ids.length === 1 && !taken.has(ids[0])) { await tx.marketCompany.update({ where: { id: c.id }, data: { accountId: ids[0] } }); taken.add(ids[0]); n++; } }
  return n;
}

/** Commit: one transaction. Snapshots are immutable; names that changed are kept as other names. Then economic
 *  signals for companies that are customers/prospects (others show their signals in the Explorer). */
export async function commitImport(importId: string, byName: string): Promise<{ error?: string; snapshots?: number; signals?: number }> {
  const imp = await db.datasetImport.findUniqueOrThrow({ where: { id: importId }, include: { source: true } });
  if (imp.status !== "READY_TO_COMMIT") return { error: imp.status === "COMMITTED" ? "ya" : "pendiente" };
  if (!imp.scale || !imp.currency) return { error: "pendiente" };
  const rows = await db.datasetRow.findMany({ where: { importId, OR: [{ status: "OK" }, { status: "REVIEW", decision: "INCLUDE" }] }, orderBy: { rowNo: "asc" } });
  const seen = new Set<string>();
  for (const r of rows) { const k = `${r.nit}|${r.year}`; if (seen.has(k)) return { error: "repetido" }; seen.add(k); }
  const touched: string[] = [];
  await db.$transaction(async (tx) => {
    const parsed = rows.map((r) => r.parsed as unknown as ParsedRow);
    const nits = [...new Set(parsed.map((p) => p.nit!))];
    const existing = await tx.marketCompany.findMany({ where: { nit: { in: nits } } });
    const byNit = new Map(existing.map((c) => [c.nit, c]));
    const fresh = new Map<string, ParsedRow>();
    for (const p of parsed) if (!byNit.has(p.nit!)) fresh.set(p.nit!, p);
    for (let i = 0, list = [...fresh.values()]; i < list.length; i += 1000) await tx.marketCompany.createMany({ data: list.slice(i, i + 1000).map((p) => ({ nit: p.nit!, name: p.name!, ciiu: p.ciiu, sector: p.sector, department: p.department, city: p.city })), skipDuplicates: true });
    for (const c of existing) {
      const p = parsed.find((x) => x.nit === c.nit)!;
      const renamed = nameKey(c.name) !== nameKey(p.name);
      if (renamed || (!c.sector && p.sector) || (!c.ciiu && p.ciiu)) await tx.marketCompany.update({ where: { id: c.id }, data: { ...(renamed ? { name: p.name!, otherNames: [...new Set([...c.otherNames, c.name])] } : {}), sector: c.sector ?? p.sector, ciiu: c.ciiu ?? p.ciiu, department: c.department ?? p.department, city: c.city ?? p.city } });
    }
    const all = await tx.marketCompany.findMany({ where: { nit: { in: nits } }, select: { id: true, nit: true } });
    const idOf = new Map(all.map((c) => [c.nit, c.id]));
    const snaps = parsed.map((p) => ({
      companyId: idOf.get(p.nit!)!, fiscalYear: p.year!, sourceId: imp.sourceId, importId, currency: imp.currency!, unitsScale: imp.scale!,
      ...Object.fromEntries(MONEY_FIELDS.map((k) => [k, p.values[k] ?? null])), employees: p.employees,
    }));
    for (let i = 0; i < snaps.length; i += 1000) await tx.financialSnapshot.createMany({ data: snaps.slice(i, i + 1000) });
    await linkCompaniesToAccounts(tx);
    await tx.datasetImport.update({ where: { id: importId }, data: { status: "COMMITTED", committedAt: new Date(), committedByName: byName } });
    touched.push(...all.map((c) => c.id));
  }, { timeout: 180000, maxWait: 20000 });

  // Economic signals for linked companies (outside the transaction: they're derived, not canonical).
  const th = (await getThresholds()).value;
  const linked = await db.marketCompany.findMany({ where: { id: { in: touched }, accountId: { not: null } }, include: { snapshots: { where: { import: { status: "COMMITTED" } }, orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }] } } });
  let signals = 0;
  for (const c of linked) {
    const latest = c.snapshots[0];
    const ref = `${imp.source.name} · FY${latest.fiscalYear} · ${FORMULA_VERSION}`;
    for (const s of econSignals(c.snapshots.map(toSnap), th)) {
      const exists = await db.marketSignal.findFirst({ where: { accountId: c.accountId!, what: s.es, sourceRef: ref }, select: { id: true } });
      if (exists) continue;
      await db.marketSignal.create({ data: { kind: "ECONOMIC", what: s.es, whyMatters: `La evidencia disponible (${imp.source.name}, FY${latest.fiscalYear}) muestra este cambio. Es una razón para mirar, no una aprobación ni un rechazo.`, accountId: c.accountId!, status: "NEW", sourceType: "RULE", sourceRef: ref, observedAt: new Date(), confidence: "REPORTED", capturedByName: "SOLU (regla)" } });
      signals++;
    }
  }
  return { snapshots: rows.length, signals };
}

export const toSnap = (s: { fiscalYear: number; currency: string; employees: number | null } & Record<MoneyField, Prisma.Decimal | null>): Snap => ({
  fiscalYear: s.fiscalYear, currency: s.currency, employees: s.employees,
  ...Object.fromEntries(MONEY_FIELDS.map((k) => [k, s[k] == null ? null : Number(s[k])])),
});
