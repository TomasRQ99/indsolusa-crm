import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { money2, subMoney, sumMoney } from "./money";

// ---------- Calendar days ----------
// Dates that are "days" (due dates, promises, deliveries) are stored as UTC midnight.
// "Today" is the calendar day in Bogotá, where most customers and the team are.

export function today(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${parts}T00:00:00.000Z`);
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 864e5);
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 864e5);
}

export function dayInput(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : "";
}

// ---------- Codes and numbers ----------

function yymm(d = new Date()) {
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type CodeTable = "deal" | "supplierPO" | "delivery" | "shipment" | "rfq";

/** J-2611-0147, SPO-2611-0321, REM-2611-0007. Sequence restarts each month. */
export async function nextCode(prefix: "J" | "SPO" | "REM" | "SHP" | "RFQ", table: CodeTable, tx: Prisma.TransactionClient = db) {
  const start = `${prefix}-${yymm()}-`;
  const where = { code: { startsWith: start } };
  const last =
    table === "deal"
      ? await tx.deal.findFirst({ where, orderBy: { code: "desc" }, select: { code: true } })
      : table === "supplierPO"
        ? await tx.supplierPO.findFirst({ where, orderBy: { code: "desc" }, select: { code: true } })
        : table === "shipment"
          ? await tx.shipment.findFirst({ where, orderBy: { code: "desc" }, select: { code: true } })
          : table === "rfq"
            ? await tx.rfq.findFirst({ where, orderBy: { code: "desc" }, select: { code: true } })
          : await tx.delivery.findFirst({ where, orderBy: { code: "desc" }, select: { code: true } });
  const seq = last?.code ? Number(last.code.slice(start.length)) + 1 : 1;
  return `${start}${String(seq).padStart(4, "0")}`;
}

/** Quotes and invoices share one 9-digit sequence (e.g. 000111980). */
export async function nextDocNumber(tx: Prisma.TransactionClient = db) {
  const row = await tx.docSequence.upsert({
    where: { id: "doc" },
    create: { id: "doc", next: 111981 },
    update: { next: { increment: 1 } },
  });
  return String(row.next - 1).padStart(9, "0");
}

// ---------- Esagra (profit margin on the sale) ----------

type Costed = {
  amount: Prisma.Decimal | number;
  supplierCost: Prisma.Decimal | number;
  freightCost: Prisma.Decimal | number;
  otherCosts: Prisma.Decimal | number;
};

export function esagra(d: Costed) {
  const sale = money2(d.amount);
  const value = subMoney(sale, d.supplierCost, d.freightCost, d.otherCosts);
  const pct = sale > 0 ? (value / sale) * 100 : null;
  return { value, pct };
}

// ---------- Invoices and cash ----------

type InvoiceWithCash = {
  amount: Prisma.Decimal | number;
  applications: { amount: Prisma.Decimal | number; payment: { reconciledAt: Date | null } }[];
};

/** Paid only counts reconciled cash. Received-but-unreconciled is shown apart. */
export function invoiceCash(inv: InvoiceWithCash) {
  const reconciled = sumMoney(inv.applications.filter((a) => a.payment.reconciledAt).map((a) => a.amount));
  const pending = sumMoney(inv.applications.filter((a) => !a.payment.reconciledAt).map((a) => a.amount));
  const amount = money2(inv.amount);
  return { amount, reconciled, pendingReconcile: pending, balance: Math.max(0, subMoney(amount, reconciled)) };
}

export const invoiceCashInclude = {
  applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } },
} satisfies Prisma.InvoiceInclude;

// ---------- Supplier payments ----------

export type BankFields = {
  beneficiary: string | null;
  bankName: string | null;
  account: string | null;
  swift: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\s-]/g, "").toUpperCase();

/** Fields where the document differs from the verified profile. A missing profile is a discrepancy on every field. */
export function bankDiscrepancies(
  profile: { bankBeneficiary: string | null; bankName: string | null; bankAccount: string | null; bankSwift: string | null; bankVerifiedAt: Date | null },
  doc: { docBeneficiary: string | null; docBankName: string | null; docAccount: string | null; docSwift: string | null },
) {
  const pairs: [keyof BankFields, string | null, string | null][] = [
    ["beneficiary", profile.bankBeneficiary, doc.docBeneficiary],
    ["bankName", profile.bankName, doc.docBankName],
    ["account", profile.bankAccount, doc.docAccount],
    ["swift", profile.bankSwift, doc.docSwift],
  ];
  return pairs
    .filter(([, p, d]) => !profile.bankVerifiedAt || (norm(d) !== "" && norm(p) !== norm(d)))
    .map(([field, p, d]) => ({ field, profile: p, doc: d }));
}

// Requested → (verified if the bank data differs) → approved → sent to the bank → paid.
// "Approved" and "sent" are never "paid": DONE only exists when an execution is CONFIRMED
// (executedAt is written only at that moment).
export type PaymentState = "VERIFY" | "APPROVE" | "EXECUTE" | "SENT" | "UNCERTAIN" | "DONE";

export function paymentState(p: {
  verifiedAt: Date | null;
  approvedAt: Date | null;
  executedAt: Date | null;
  discrepancies: number;
  executions?: { state: "SENT" | "UNCERTAIN" | "CONFIRMED" | "FAILED" }[];
}): PaymentState {
  if (p.executedAt) return "DONE";
  if (p.discrepancies > 0 && !p.verifiedAt) return "VERIFY";
  if (!p.approvedAt) return "APPROVE";
  const open = (p.executions ?? []).filter((e) => e.state === "SENT" || e.state === "UNCERTAIN");
  if (open.some((e) => e.state === "UNCERTAIN")) return "UNCERTAIN";
  if (open.length) return "SENT";
  return "EXECUTE";
}

// ---------- Deliveries ----------

/** What still blocks invoicing a delivery. Empty list = ready to invoice. */
export function invoiceBlockers(
  delivery: { podReceived: boolean; receptionCode: string | null },
  deal: { customerPo: string | null },
  account: { taxDataComplete: boolean; requiresReceptionCode: boolean; requiresPortal: boolean; portalValidUntil: Date | null },
  now = today(),
) {
  const out: ("RECEPTION_CODE" | "PO" | "PORTAL" | "POD" | "TAX")[] = [];
  if (account.requiresReceptionCode && !delivery.receptionCode) out.push("RECEPTION_CODE");
  if (!deal.customerPo) out.push("PO");
  if (account.requiresPortal && (!account.portalValidUntil || account.portalValidUntil < now)) out.push("PORTAL");
  if (!delivery.podReceived) out.push("POD");
  if (!account.taxDataComplete) out.push("TAX");
  return out;
}
