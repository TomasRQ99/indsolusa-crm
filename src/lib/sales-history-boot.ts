import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "./db";
import { norm, normCompany } from "./sales-history-rules";

// The owner's own sales of 2025 and 2026 (their invoice lists, in dollars, given on 2026-11-26), loaded into the
// commercial budget's history without anyone uploading a file. It runs at deploy and once a day until it is done;
// once the two loads exist it does nothing. The loads are ordinary ones: each can be removed on
// Presupuesto comercial → Historial with «Quitar carga», and a removed load is not brought back.
//
// The lists are invoices, not purchase orders. Two loads are made from them, separately removable:
//   1. Invoicing: the invoiced value per company and month.
//   2. Purchase orders, AS AN APPROXIMATION: the same invoices read as the orders behind them (value and number),
//      so the purchase-order plan also has a history to lean on. An order usually comes before its invoice, so the
//      month can be off; the load's name says it is an approximation.

export const BOOT_LABELS = { fact: "Facturación 2025–2026 (archivos Negocios Industry)", oc: "OC 2025–2026: aproximación con las facturas (archivos Negocios Industry)" } as const;
const MARK = "boot:industry-sales-2025-2026";
type Row = { client: string; seller: string; month: string; usd: number; invoices: number };

export async function bootIndustryHistory(): Promise<string> {
  // Off since 2026-11-26: the owner asked to remove this load and to upload the Excel files themselves (Historial
  // reads the invoice sheet as it is exported). Migration 20270202130000 removed what this had loaded.
  if (process.env.SALES_HISTORY_BOOT !== "1") return "off: the owner uploads the Excel files";
  // The mark stays even when a person removes a load, so a removed load never comes back by itself.
  const setting = await db.salesBudgetSetting.findUnique({ where: { id: "main" }, select: { historyBootAt: true } });
  if (setting?.historyBootAt || (await db.salesHistoryBatch.findFirst({ where: { raw: { startsWith: MARK } }, select: { id: true } }))) return "already loaded";
  const file = path.join(process.cwd(), "prisma", "data", "industry-sales-2025-2026.json");
  const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] }).rows;
  const admin = await db.user.findFirst({ where: { active: true, role: "GERENCIA" }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
  if (!admin) return "no Gerencia user yet";

  const [accounts, users] = await Promise.all([db.account.findMany({ where: { internal: false }, select: { id: true, name: true } }), db.user.findMany({ select: { id: true, name: true } })]);
  const byName = new Map<string, string>();
  for (const a of accounts) if (!byName.has(normCompany(a.name))) byName.set(normCompany(a.name), a.id);
  const userBy = new Map<string, string[]>();
  for (const u of users) userBy.set(norm(u.name), [...(userBy.get(norm(u.name)) ?? []), u.id]);
  let created = 0;
  for (const client of new Set(rows.map((r) => r.client))) {
    if (byName.has(normCompany(client))) continue;
    const a = await db.account.create({ data: { name: client, ownerId: admin.id } });
    byName.set(normCompany(client), a.id); created++;
  }
  const mk = (kind: keyof typeof BOOT_LABELS) => db.salesHistoryBatch.create({ data: { source: "ANTERIOR", label: BOOT_LABELS[kind], currency: "USD", unit: 1, raw: `${MARK}:${kind}`, state: "APPLIED", appliedAt: new Date(), createdById: admin.id, createdByName: "SOLU" } });
  const [bFact, bOc] = [await mk("fact"), await mk("oc")];
  const data: { batchId: string; accountId: string; userId: string | null; month: string; kpi: string; value: number; orig: number; currency: string; rate: number | null; source: string }[] = [];
  for (const r of rows) {
    const accountId = byName.get(normCompany(r.client))!;
    const hit = userBy.get(norm(r.seller)) ?? [];
    const userId = hit.length === 1 ? hit[0] : null; // a seller who is not a SOLU user: the figure goes to the company's owner
    // The owner's files are in dollars, the currency the budget works in: saved as they are.
    data.push({ batchId: bFact.id, accountId, userId, month: r.month, kpi: "FACT_COP", value: r.usd, orig: r.usd, currency: "USD", rate: null, source: "ANTERIOR" });
    data.push({ batchId: bOc.id, accountId, userId, month: r.month, kpi: "OC_COP", value: r.usd, orig: r.usd, currency: "USD", rate: null, source: "ANTERIOR" });
    data.push({ batchId: bOc.id, accountId, userId, month: r.month, kpi: "OC_N", value: r.invoices, orig: r.invoices, currency: "", rate: null, source: "ANTERIOR" });
  }
  await db.salesHistoryMonth.createMany({ data });
  await db.salesBudgetSetting.upsert({ where: { id: "main" }, create: { id: "main", historyBootAt: new Date() }, update: { historyBootAt: new Date() } });
  return `loaded ${rows.length} company-months, ${created} companies created`;
}
