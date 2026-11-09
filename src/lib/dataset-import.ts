// Mercado M3 · dataset import pipeline (§9.2, §9.3, §23).
// UPLOADED → (PARSED) → MAPPING_REQUIRED → validate → REVIEW_REQUIRED | READY_TO_COMMIT → COMMITTED (or DISCARDED / FAILED).
// The original file is kept; rows are staged; nothing canonical is written until the person commits,
// and the commit is one transaction: a failure leaves no partial snapshots.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { readSheet, type Cell } from "./sheet-read";
import { DEFAULT_THRESHOLDS, FORMULA_VERSION, MONEY_FIELDS, checkRows, econSignals, findHeaderRow, sameCompanyName, suggestMapping, type Mapping, type MoneyField, type ParsedRow, type Snap, type Thresholds } from "./fin-rules";
import { fold } from "./part-lexicon";

export const MAX_FILE = 25 * 1024 * 1024;
const nitKeyOf = (v: string | null | undefined) => { const d = (v ?? "").replace(/\D/g, ""); return d.length >= 6 ? d.slice(0, 9) : null; };

/** The figures SOLU shows for a year: the newest publication first (an older file never replaces a newer report), then the latest saved. */
export const SNAP_ORDER: Prisma.FinancialSnapshotOrderByWithRelationInput[] = [{ fiscalYear: "desc" }, { import: { reportYear: { sort: "desc", nulls: "last" } } }, { createdAt: "desc" }];
/** Same order in raw SQL (s = "FinancialSnapshot", i = its "DatasetImport"). */
export const SNAP_ORDER_SQL = Prisma.sql`i."reportYear" DESC NULLS LAST, s."createdAt" DESC`;

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
  await db.datasetImport.update({ where: { id: importId }, select: { id: true }, data: { status: "MAPPING_REQUIRED", headers: parsed.headers as unknown as Prisma.InputJsonValue, preview: parsed.data.slice(0, 8) as unknown as Prisma.InputJsonValue, rowCount: parsed.data.length, mapping: Object.fromEntries(Object.entries(suggestMapping(parsed.headers.cells))) as Prisma.InputJsonValue, okCount: 0, errorCount: 0, reviewCount: 0 } });
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
  // The publication this file is: the most recent year it reports.
  const reportYear = checked.reduce<number | null>((m, c) => (c.parsed.year && (!m || c.parsed.year > m) ? c.parsed.year : m), null);
  const existing = companies.length ? await db.financialSnapshot.findMany({ where: { companyId: { in: companies.map((c) => c.id) }, import: { status: "COMMITTED" } }, orderBy: SNAP_ORDER, include: { import: { select: { reportYear: true } } } }) : [];
  // Every committed version per company and year (shown version first), and the newest publication per company.
  const snapKey = new Map<string, (typeof existing)[number][]>();
  const newestReport = new Map<string, number>();
  for (const s of existing) {
    const k = `${s.companyId}|${s.fiscalYear}`; snapKey.set(k, [...(snapKey.get(k) ?? []), s]);
    const ry = s.import.reportYear ?? s.fiscalYear; if (ry > (newestReport.get(s.companyId) ?? 0)) newestReport.set(s.companyId, ry);
  }
  // Same figures = every amount both files report is equal (an older file may simply not have a column).
  const sameFigures = (s: (typeof existing)[number], v: ParsedRow["values"]) => {
    const both = MONEY_FIELDS.filter((k) => s[k] != null && v[k] != null);
    return both.length > 0 && both.every((k) => Number(s[k]) === v[k]);
  };

  const rows = checked.map((c) => {
    const msgs = c.messages.map((m) => m.es);
    let status: string = c.status;
    const review = (m: string) => { msgs.push(m); if (status === "OK") status = "REVIEW"; };
    const p = c.parsed;
    if (status !== "ERROR" && p.nit && p.year) {
      if ((keyCount.get(`${p.nit}|${p.year}`) ?? 0) > 1) review("NIT repetido en el archivo para el mismo año: incluye solo una fila");
      const comp = compByNit.get(p.nit);
      const olderFile = !!comp && !!reportYear && reportYear < (newestReport.get(comp.id) ?? 0);
      if (comp && !sameCompanyName(comp.name, p.name) && !comp.otherNames.some((n) => sameCompanyName(n, p.name))) review(olderFile ? `Mismo NIT con otra razón social (nombre actual: ${comp.name})` : `Mismo NIT con otra razón social (antes: ${comp.name})`);
      if ((accCount.get(p.nit) ?? 0) > 1) review("Este NIT coincide con más de un cliente en SOLU");
      const versions = comp ? snapKey.get(`${comp.id}|${p.year}`) ?? [] : [];
      if (versions.length) {
        if (versions.some((s) => sameFigures(s, p.values))) { status = "SKIPPED"; msgs.push("Ya importado con las mismas cifras"); }
        else {
          const shownReport = versions[0].import.reportYear ?? p.year;
          review(reportYear && reportYear < shownReport
            ? `Ya existe ${p.year} con otras cifras: la publicación de ${shownReport} (más reciente) sigue siendo la que se muestra; si la incluyes, esta queda como versión anterior`
            : `Ya existe ${p.year} con otras cifras: si la incluyes se guarda como la versión vigente (la anterior no se borra)`);
        }
      }
    }
    return { importId, rowNo: c.rowNo, nit: p.nit, year: p.year, name: p.name, parsed: p as unknown as Prisma.InputJsonValue, status, messages: msgs, decision: null as string | null };
  });

  const counts = { ok: rows.filter((r) => r.status === "OK").length, err: rows.filter((r) => r.status === "ERROR").length, rev: rows.filter((r) => r.status === "REVIEW").length };
  await db.datasetRow.deleteMany({ where: { importId } });
  for (let i = 0; i < rows.length; i += 1000) await db.datasetRow.createMany({ data: rows.slice(i, i + 1000) });
  await db.datasetImport.update({ where: { id: importId }, select: { id: true }, data: { mapping: o.mapping as Prisma.InputJsonValue, scale: o.scale, currency: o.currency, decimalStyle: o.decimalStyle, fixedYear: o.fixedYear, reportYear, okCount: counts.ok, errorCount: counts.err, reviewCount: counts.rev, status: counts.rev ? "REVIEW_REQUIRED" : "READY_TO_COMMIT" } });
  // Reusable mapping template for this source (§23).
  await db.intelligenceSource.update({ where: { id: imp.sourceId }, data: { mapping: { headers: h.cells.map((c) => fold(String(c ?? ""))), mapping: o.mapping, scale: o.scale, decimalStyle: o.decimalStyle, currency: o.currency } as Prisma.InputJsonValue } });
  return counts;
}

/** The person decides review rows; when none is pending the import is ready. */
export async function decideRows(importId: string, where: Prisma.DatasetRowWhereInput, decision: "INCLUDE" | "EXCLUDE") {
  await db.datasetRow.updateMany({ where: { ...where, importId, status: "REVIEW" }, data: { decision } });
  return refreshPending(importId);
}

/** The group label of a review message: the text before " (" and before ":". The page groups the same way. */
export const groupOf = (m: string) => m.split(" (")[0].split(":")[0];

/** Every review row with that kind of exception, decided in one statement inside the database
 *  (no list of thousands of ids travels to the database). */
export async function decideGroup(importId: string, group: string, decision: "INCLUDE" | "EXCLUDE") {
  await db.$executeRaw`UPDATE "DatasetRow" SET decision = ${decision}
    WHERE "importId" = ${importId} AND status = 'REVIEW'
      AND EXISTS (SELECT 1 FROM unnest(messages) m WHERE split_part(split_part(m, ' (', 1), ':', 1) = ${group})`;
  return refreshPending(importId);
}

async function refreshPending(importId: string) {
  const pending = await db.datasetRow.count({ where: { importId, status: "REVIEW", decision: null } });
  // select: never send the stored file back (it can be several MB).
  await db.datasetImport.update({ where: { id: importId }, data: { status: pending ? "REVIEW_REQUIRED" : "READY_TO_COMMIT" }, select: { id: true } });
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
  // select: the stored file isn't needed here (it can be several MB).
  const imp = await db.datasetImport.findUniqueOrThrow({ where: { id: importId }, select: { status: true, scale: true, currency: true, sourceId: true, reportYear: true, source: { select: { name: true } } } });
  if (imp.status !== "READY_TO_COMMIT") return { error: imp.status === "COMMITTED" ? "ya" : "pendiente" };
  if (!imp.scale || !imp.currency) return { error: "pendiente" };
  const rows = await db.datasetRow.findMany({ where: { importId, OR: [{ status: "OK" }, { status: "REVIEW", decision: "INCLUDE" }] }, orderBy: { rowNo: "asc" }, select: { nit: true, year: true, parsed: true } });
  const seen = new Set<string>();
  for (const r of rows) { const k = `${r.nit}|${r.year}`; if (seen.has(k)) return { error: "repetido" }; seen.add(k); }
  const reportYear = imp.reportYear ?? rows.reduce((m, r) => Math.max(m, r.year ?? 0), 0);
  const touched: string[] = [];
  await db.$transaction(async (tx) => {
    const parsed = rows.map((r) => r.parsed as unknown as ParsedRow);
    const nits = [...new Set(parsed.map((p) => p.nit!))];
    const existing = await tx.marketCompany.findMany({ where: { nit: { in: nits } } });
    const byNit = new Map(existing.map((c) => [c.nit, c]));
    // Newest row of this file per NIT (its name is the one the file uses most recently).
    const rowOf = new Map<string, ParsedRow>();
    for (const p of parsed) { const o = rowOf.get(p.nit!); if (!o || (p.year ?? 0) > (o.year ?? 0)) rowOf.set(p.nit!, p); }
    const fresh = [...rowOf.values()].filter((p) => !byNit.has(p.nit!));
    for (let i = 0; i < fresh.length; i += 1000) await tx.marketCompany.createMany({ data: fresh.slice(i, i + 1000).map((p) => ({ nit: p.nit!, name: p.name!, ciiu: p.ciiu, sector: p.sector, department: p.department, city: p.city })), skipDuplicates: true });
    // Most recent publication already saved per company: an older file never renames a company, it adds a former name.
    const newest = existing.length ? await tx.$queryRaw<{ companyId: string; ry: number }[]>`SELECT s."companyId", max(COALESCE(i."reportYear", s."fiscalYear"))::int AS ry FROM "FinancialSnapshot" s JOIN "DatasetImport" i ON i.id = s."importId" AND i.status = 'COMMITTED' WHERE s."companyId" = ANY(${existing.map((c) => c.id)}) GROUP BY s."companyId"` : [];
    const newestOf = new Map(newest.map((r) => [r.companyId, r.ry]));
    for (const c of existing) {
      const p = rowOf.get(c.nit)!;
      const renamed = !!p.name && !sameCompanyName(c.name, p.name) && !c.otherNames.some((n) => sameCompanyName(n, p.name));
      const newer = reportYear >= (newestOf.get(c.id) ?? 0);
      const names = renamed ? (newer ? { name: p.name!, otherNames: [...new Set([...c.otherNames, c.name])] } : { otherNames: [...new Set([...c.otherNames, p.name!])] }) : {};
      if (renamed || (!c.sector && p.sector) || (!c.ciiu && p.ciiu) || (!c.department && p.department) || (!c.city && p.city)) await tx.marketCompany.update({ where: { id: c.id }, select: { id: true }, data: { ...names, sector: c.sector ?? p.sector, ciiu: c.ciiu ?? p.ciiu, department: c.department ?? p.department, city: c.city ?? p.city } });
    }
    const all = await tx.marketCompany.findMany({ where: { nit: { in: nits } }, select: { id: true, nit: true } });
    const idOf = new Map(all.map((c) => [c.nit, c.id]));
    const snaps = parsed.map((p) => ({
      companyId: idOf.get(p.nit!)!, fiscalYear: p.year!, sourceId: imp.sourceId, importId, currency: imp.currency!, unitsScale: imp.scale!,
      ...Object.fromEntries(MONEY_FIELDS.map((k) => [k, p.values[k] ?? null])), employees: p.employees,
    }));
    for (let i = 0; i < snaps.length; i += 1000) await tx.financialSnapshot.createMany({ data: snaps.slice(i, i + 1000) });
    await linkCompaniesToAccounts(tx);
    await tx.datasetImport.update({ where: { id: importId }, select: { id: true }, data: { status: "COMMITTED", committedAt: new Date(), committedByName: byName, reportYear } });
    touched.push(...all.map((c) => c.id));
  }, { timeout: 180000, maxWait: 20000 });

  // Economic signals for linked companies (outside the transaction: they're derived, not canonical).
  const th = (await getThresholds()).value;
  const linked = await db.marketCompany.findMany({ where: { id: { in: touched }, accountId: { not: null } }, include: { snapshots: { where: { import: { status: "COMMITTED" } }, orderBy: SNAP_ORDER } } });
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
