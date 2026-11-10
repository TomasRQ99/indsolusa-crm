// #4 Audit trail. Records material changes automatically, from every screen and action, so nobody has
// to remember to log them. Used only by db.ts. What counts as material follows the constitution:
// money, bank data, authority (roles), commercial commitments, states and document versions.
import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";

/** Tracked fields per model; "all" = every scalar field the write touches. */
export const AUDITED: Record<string, readonly string[] | "all"> = {
  User: ["role", "active", "email", "name"],
  Account: ["creditLimit", "paymentTermsDays", "allowsPartialBilling", "taxId", "requiresReceptionCode", "requiresPortal", "ownerId"],
  Deal: ["sellerKey", "amount", "supplierCost", "freightCost", "otherCosts", "stage", "ownerId", "promisedDate", "poAcceptedAt", "creditExceptionById", "creditExceptionAt", "creditExceptionNote", "closedAt", "explorationId", "plantId", "originRef"],
  DealItem: ["qty", "unitPrice", "code", "description"],
  Supplier: ["bankBeneficiary", "bankName", "bankAccount", "bankSwift", "bankVerifiedAt", "bankVerifiedById", "paymentTerms", "advancePct", "currency", "taxId"],
  Quote: ["currency", "docFxRate", "docFxSource", "ivaExempt", "ivaExemptReason", "ivaPct", "status", "rev", "supplierCost", "freightCost", "otherCosts", "fxRate", "protSale", "protCost", "protEsagra", "presentedAt", "decidedAt", "validityDays", "paymentTerms", "incoterm"],
  QuoteLine: ["qty", "unitPrice", "code", "description"],
  CustomerPO: "all",
  PoAcceptance: "all",
  PoResolution: "all",
  SupplierPO: ["amount", "currency", "releasedAt", "releasedByName", "version", "shipBy", "terms", "costNote"],
  SupplierPOLine: ["qty", "unitCost", "code", "description"],
  PaymentRequirement: ["amount", "percent", "dueBy", "label"],
  SupplierPayment: "all",
  PaymentExecution: "all",
  Invoice: "all",
  CustomerPayment: "all",
  PaymentApplication: "all",
  CommissionPolicy: "all",
  CommissionEntry: "all",
  // Mercado (Módulo 09): material changes to explorations and to what we hold as true about the market.
  Exploration: ["name", "purpose", "hypothesis", "scope", "ownerId", "lifecycle", "resultSummary", "closedAt"],
  MarketSignal: ["kind", "what", "accountId", "status", "dismissedNote", "confidence", "sourceType", "observedAt"],
  KnowledgeGap: ["question", "status", "answer", "answerSource"],
  WhiteSpace: ["kind", "what", "status", "note"],
  Plant: ["name", "accountId", "city", "country", "operationType", "confidence", "sourceType"],
  FutureOpportunity: ["kind", "description", "accountId", "expectedAt", "status", "closedNote", "dealId", "confidence", "valueBasis"],
  AccountAlias: ["name", "kind", "accountId"],
  AccountInsight: ["block", "topic", "area", "step", "condition", "statement", "evidence", "confidence", "supersededAt", "supersededNote"],
  InstalledAsset: ["name", "manufacturer", "model", "serial", "critical", "redundancy", "confidence"],
  ImpactProfile: ["scope", "stopsLine", "level", "currency", "costPerHourMin", "costPerHourMax", "unitsPerHour", "contributionUnit", "scrapPerHour", "idleLaborPerHour", "restartCost", "confidence"],
  Employment: ["contactId", "accountId", "plantId", "area", "role", "startedOn", "endedOn"],
  // M5: what we remember about a person, commitments, and every message a person reviewed and sent.
  PersonNote: ["kind", "statement", "evidence", "confidence", "supersededAt"],
  OpenLoop: ["side", "what", "dueAt", "status", "closedNote", "closedByName"],
  PreparedMessage: "all",
  // M6: a suggested Need someone set aside.
  NeedDismissal: "all",
  EsagaraException: "all",
  ScopeLine: "all",
  TechnicalFact: "all",
  ScopeConfirmation: "all",
  ProductRelationship: "all",
  // Economic data: the import is the audited unit (who loaded which file, with which scale/currency, who committed).
  // Snapshots are immutable and come only from a committed import, so they aren't logged one by one.
  IntelligenceSource: ["name", "kind"],
  DatasetImport: ["fileName", "status", "scale", "currency", "decimalStyle", "fixedYear", "committedAt", "committedByName"],
  MarketSetting: "all",
  // C3 · Commercial cash journey: blockers, invoice confirmation, the customer's payment map, promises and credit reviews.
  CashBlocker: "all",
  InvoiceStep: "all",
  PaymentMap: "all",
  PaymentMapPerson: "all",
  PaymentPromise: "all",
  CreditReviewRequest: "all",
  // Comercial C4 · Sourcing & Supply
  SupplyOption: ["price", "currency", "qty", "stockQty", "leadDaysMin", "leadDaysMax", "validUntil", "covers", "status", "discardReason", "importFeasibility", "availability", "supplierId"],
  SupplierPaymentOption: "all",
  SupplyBasis: "all",
  LogisticsObservation: "all",
  ImportExperience: "all",
  SourcingSearch: "all",
  // Comercial C5 · Solution Case & Proposal
  ValueAttribute: "all",
  SolutionCase: "all",
  ValueClaim: "all",
  PresentationRecord: "all",
  // Comercial C6 · PO, Acceptance & Dispatch
  PoAllocation: "all",
  DispatchInstruction: "all",
  GoalTarget: "all",
  VisitPlan: "all",
  VisitCommitment: "all",
  CommercialMission: "all",
  OperationalException: "all",
  SellingEntity: "all",
  MissionExpense: ["spentOn", "category", "description", "amount", "originalNote", "currency", "originalAmount", "fxRate", "fxSource", "receiptName", "noReceiptReason"],
  VisitAttachment: ["name", "mime", "size", "uploadedByName"],
  CoverageAssignment: "all",
  RelationshipBackup: "all",
};
const MASK = new Set(["bankAccount", "docAccount"]);
const SKIP = new Set(["id", "createdAt", "updatedAt"]);
const WRITES = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

type Val = string | number | boolean | null;
export type AuditRow = { actorId: string | null; actorName: string; model: string; entityId: string; action: "CREATE" | "UPDATE" | "DELETE"; changes: Record<string, [Val, Val]> };

const norm = (k: string, v: unknown): Val => {
  if (v === undefined || v === null) return null;
  let out: Val;
  if (v instanceof Date) out = v.toISOString();
  else if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("set" in o) return norm(k, o.set);
    if ("increment" in o) return `+${String(o.increment)}`;
    if ("decrement" in o) return `-${String(o.decrement)}`;
    if ("multiply" in o) return `×${String(o.multiply)}`;
    if ("divide" in o) return `÷${String(o.divide)}`;
    out = typeof (o as { toFixed?: unknown }).toFixed === "function" ? String(v) : JSON.stringify(v).slice(0, 500); // Decimal or JSON
  } else out = typeof v === "string" ? v.slice(0, 500) : (v as number | boolean);
  if (MASK.has(k) && typeof out === "string" && out) out = `•••• ${out.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`;
  return out;
};
const fieldsOf = (model: string, data: Record<string, unknown>) => {
  const t = AUDITED[model];
  return Object.keys(data).filter((k) => !SKIP.has(k) && (t === "all" ? !isRelationWrite(data[k]) : t.includes(k)));
};
// Nested relation writes ({ create: … }, { connect: … }) are audited by their own model, not here.
const isRelationWrite = (v: unknown) => !!v && typeof v === "object" && !(v instanceof Date) && !("set" in (v as object)) && !("increment" in (v as object)) && !("decrement" in (v as object)) && typeof (v as { toFixed?: unknown }).toFixed !== "function" && !Array.isArray(v) && ["create", "connect", "connectOrCreate", "update", "upsert", "delete", "disconnect", "createMany", "deleteMany", "updateMany", "set"].some((x) => x in (v as object));

/** Pending rows of the transaction in progress: written only if it commits. */
export const txStore = new AsyncLocalStorage<{ rows: AuditRow[] }>();

async function actor(): Promise<{ id: string | null; name: string }> {
  try {
    const { getCurrentUser } = await import("./auth");
    const u = await getCurrentUser();
    if (u) return { id: u.id, name: u.name };
  } catch { /* outside a request (seed, scripts, background sync) */ }
  return { id: null, name: "Sistema" };
}

export function makeAuditHook(base: PrismaClient) {
  const write = async (rows: AuditRow[]) => {
    if (!rows.length) return;
    try { await base.auditEvent.createMany({ data: rows }); } catch (e) { console.error("audit write failed", e); }
  };
  const emit = async (rows: AuditRow[]) => {
    const st = txStore.getStore();
    if (st) st.rows.push(...rows);
    else await write(rows);
  };
  // Model delegates of the plain client, for the "before" reads.
  const del = (model: string) => (base as unknown as Record<string, { findMany: (a: object) => Promise<Record<string, unknown>[]>; findUnique: (a: object) => Promise<Record<string, unknown> | null> }>)[model.charAt(0).toLowerCase() + model.slice(1)];

  async function hook({ model, operation, args, query }: { model?: string; operation: string; args: unknown; query: (a: unknown) => Promise<unknown> }) {
    if (!model || !(model in AUDITED) || !WRITES.has(operation)) return query(args);
    const a = (args ?? {}) as { where?: object; data?: Record<string, unknown> | Record<string, unknown>[]; create?: Record<string, unknown>; update?: Record<string, unknown> };
    let before: Record<string, unknown>[] = [];
    // Read only what the audit compares (a stored file or a long text never needs to travel for it).
    const t = AUDITED[model];
    const sel = t === "all" ? {} : { select: Object.fromEntries(["id", ...t].map((k) => [k, true])) };
    try {
      if (operation === "update" || operation === "upsert" || operation === "delete") { const r = a.where ? await del(model).findUnique({ where: a.where, ...sel }) : null; before = r ? [r] : []; }
      else if (operation === "updateMany" || operation === "updateManyAndReturn" || operation === "deleteMany") before = await del(model).findMany({ where: a.where ?? {}, take: 500, ...sel });
    } catch { before = []; }

    const result = await query(args);

    try {
      const who = await actor();
      const rows: AuditRow[] = [];
      const push = (entityId: string, action: AuditRow["action"], changes: AuditRow["changes"]) => {
        if (Object.keys(changes).length) rows.push({ actorId: who.id, actorName: who.name, model, entityId: String(entityId).slice(0, 60), action, changes });
      };
      // Nested creates (e.g. a payment with its applications) don't pass through this hook: keep a summary.
      const nested = (data: Record<string, unknown>, ch: AuditRow["changes"]) => {
        for (const [k, v] of Object.entries(data)) if (isRelationWrite(v)) { const o = v as Record<string, unknown>; const c = o.create ?? (o.createMany as { data?: unknown } | undefined)?.data; if (c) ch[k] = [null, JSON.stringify(c).slice(0, 500)]; }
      };
      const created = (data: Record<string, unknown>, id: unknown) => {
        const ch: AuditRow["changes"] = {};
        for (const k of fieldsOf(model, data)) { const v = norm(k, data[k]); if (v !== null) ch[k] = [null, v]; }
        nested(data, ch);
        push(String(id ?? "?"), "CREATE", Object.keys(ch).length ? ch : { id: [null, String(id ?? "?")] });
      };
      const updated = (row: Record<string, unknown>, data: Record<string, unknown>) => {
        const ch: AuditRow["changes"] = {};
        for (const k of fieldsOf(model, data)) { const b = norm(k, row[k]), n = norm(k, data[k]); if (b !== n) ch[k] = [b, n]; }
        nested(data, ch);
        push(String(row.id), "UPDATE", ch);
      };
      const removed = (row: Record<string, unknown>) => {
        const ch: AuditRow["changes"] = {};
        for (const k of fieldsOf(model, row)) { const v = norm(k, row[k]); if (v !== null) ch[k] = [v, null]; }
        push(String(row.id), "DELETE", ch);
      };
      const res = result as Record<string, unknown> | Record<string, unknown>[] | { count: number } | null;

      if (operation === "create") created((a.data ?? {}) as Record<string, unknown>, (res as Record<string, unknown>)?.id);
      else if (operation === "createMany" || operation === "createManyAndReturn") {
        const list = (Array.isArray(a.data) ? a.data : [a.data ?? {}]) as Record<string, unknown>[];
        const ids = Array.isArray(res) ? res.map((r) => r.id) : [];
        list.forEach((d, n) => created(d, d.id ?? ids[n] ?? "(lote)"));
      } else if (operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") {
        for (const r of before) updated(r, (a.data ?? {}) as Record<string, unknown>);
      } else if (operation === "upsert") {
        if (before[0]) updated(before[0], a.update ?? {});
        else created(a.create ?? {}, (res as Record<string, unknown>)?.id);
      } else if (operation === "delete" || operation === "deleteMany") before.forEach(removed);
      await emit(rows);
    } catch (e) { console.error("audit failed", e); }
    return result;
  }

  /** Runs a transaction; its audit rows are written only after it commits. */
  async function inTx<T>(run: () => Promise<T>): Promise<T> {
    const outer = txStore.getStore();
    if (outer) return run(); // nested: the outer transaction owns the rows
    const st = { rows: [] as AuditRow[] };
    const r = await txStore.run(st, run);
    await write(st.rows);
    return r;
  }
  return { hook, inTx };
}
