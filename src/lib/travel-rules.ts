import { cmpMoney, sharePct, subMoney, sumMoney, type MoneyIn } from "./money";

// Comercial C8e · travel budget and expenses of a Commercial Mission (module 10 v1.3 §57 / AC "Mission can request
// travel budget and later reconcile expenses"). INTERIM rules (decision C-17, 2026-11-10) until the official
// Module 14 (Administración) document arrives:
//   - Gerencia approves or rejects the budget, never the person who asked.
//   - If the traveller is Gerencia, Finanzas decides (so nobody approves their own trip).
//   - After the trip the traveller lists expenses with receipts; Finanzas or Gerencia (not the traveller) checks them.

export const TRAVEL_RULES = "travel-v1";
type Txt = { es: string; en: string };
export const EXPENSE_CATS: Record<string, Txt> = {
  TRANSPORT: { es: "Tiquetes / transporte", en: "Tickets / transport" },
  LODGING: { es: "Hotel", en: "Lodging" },
  MEALS: { es: "Alimentación", en: "Meals" },
  LOCAL: { es: "Taxis / transporte local", en: "Taxis / local transport" },
  OTHER: { es: "Otro", en: "Other" },
};
export const BUDGET_STATUS: Record<string, Txt & { tone: string }> = {
  NOT_REQUESTED: { es: "Sin presupuesto pedido", en: "No budget requested", tone: "wait" },
  REQUESTED: { es: "Presupuesto esperando decisión", en: "Budget awaiting decision", tone: "attn" },
  APPROVED: { es: "Presupuesto aprobado", en: "Budget approved", tone: "ok" },
  REJECTED: { es: "Presupuesto rechazado", en: "Budget rejected", tone: "risk" },
};
export const EXPENSES_STATUS: Record<string, Txt & { tone: string }> = {
  OPEN: { es: "Gastos sin enviar", en: "Expenses not sent", tone: "wait" },
  SUBMITTED: { es: "Gastos en revisión", en: "Expenses under review", tone: "attn" },
  RETURNED: { es: "Gastos devueltos con pregunta", en: "Expenses returned with a question", tone: "risk" },
  RECONCILED: { es: "Gastos legalizados", en: "Expenses reconciled", tone: "ok" },
};
export const RECEIPT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const MAX_EXPENSES = 60;

type U = { id: string; role: string };
type M = { ownerId: string; ownerRole: string };
/** Who decides the budget: Gerencia, never the traveller; Finanzas when the traveller is Gerencia. */
export const canDecideBudget = (u: U, m: M) => u.id !== m.ownerId && (u.role === "GERENCIA" || ((u.role === "FINANZAS" || u.role === "ADMINISTRACION") && m.ownerRole === "GERENCIA"));
/** Who checks the expenses: Finanzas or Gerencia, never the traveller. */
export const canReconcile = (u: U, m: M) => u.id !== m.ownerId && (u.role === "GERENCIA" || u.role === "FINANZAS" || u.role === "ADMINISTRACION");
export const canRequestBudget = (s: string) => s === "NOT_REQUESTED" || s === "REJECTED";
/** Expenses are listed only against an approved budget, and not while under review or once reconciled. */
export const canEditExpenses = (m: { budgetStatus: string; expensesStatus: string }) => m.budgetStatus === "APPROVED" && (m.expensesStatus === "OPEN" || m.expensesStatus === "RETURNED");

export function travelSummary(approved: MoneyIn, expenses: { amount: MoneyIn; category: string; hasReceipt: boolean }[]) {
  const spent = sumMoney(expenses.map((e) => e.amount));
  const budget = approved == null ? null : sumMoney([approved]);
  const diff = budget == null ? null : subMoney(budget, spent); // + left over, − over budget
  const byCat = Object.keys(EXPENSE_CATS).map((c) => ({ cat: c, amount: sumMoney(expenses.filter((e) => e.category === c).map((e) => e.amount)) })).filter((x) => x.amount > 0);
  return {
    spent, budget, diff,
    over: budget != null && cmpMoney(spent, budget) > 0,
    usedPct: budget != null && budget > 0 ? sharePct(spent, budget) : null,
    withoutReceipt: expenses.filter((e) => !e.hasReceipt).length,
    withoutReceiptAmount: sumMoney(expenses.filter((e) => !e.hasReceipt).map((e) => e.amount)),
    byCat,
  };
}
