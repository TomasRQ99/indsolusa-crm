import type { AuditRow } from "./audit-core";

// Módulo 14 §10 · Domain events. Pure: no database.
// The audit trail already sees every material change from every screen. An event is that same change, named in
// business words, so an integration or a report can subscribe to "credit.limit_changed" without knowing tables.
// Because events are derived from the audit rows, no screen or action can forget to emit one.

export type EventOut = { name: string; entity: string; entityId: string; payload: Record<string, string | number | boolean | null>; actorName: string };
type Ch = AuditRow["changes"];
const now = (ch: Ch, k: string) => (k in ch ? ch[k][1] : undefined);
const was = (ch: Ch, k: string) => (k in ch ? ch[k][0] : undefined);
const became = (ch: Ch, k: string, v: string) => now(ch, k) === v && was(ch, k) !== v;
const gotSet = (ch: Ch, k: string) => now(ch, k) != null && was(ch, k) == null;
const pick = (ch: Ch, keys: string[]) => Object.fromEntries(keys.filter((k) => k in ch).map((k) => [k, ch[k][1]]));

/** The business events one audited change stands for (usually none or one). */
export function eventsOf(r: AuditRow): EventOut[] {
  const ch = r.changes, out: EventOut[] = [];
  const emit = (name: string, payload: EventOut["payload"] = {}) => out.push({ name, entity: r.model, entityId: r.entityId, payload, actorName: r.actorName });
  const C = r.action === "CREATE", U = r.action === "UPDATE";
  switch (r.model) {
    case "Account":
      if (U && "creditLimit" in ch) emit("credit.limit_changed", { from: was(ch, "creditLimit") ?? null, to: now(ch, "creditLimit") ?? null });
      break;
    case "CreditReviewRequest":
      if (C) emit("credit.exception_requested", pick(ch, ["accountId", "kind", "requestedLimit"]));
      else if (U && became(ch, "status", "APPROVED")) emit("credit.exception_approved", pick(ch, ["approvedLimit", "approvedTerms"]));
      else if (U && became(ch, "status", "REJECTED")) emit("credit.exception_rejected");
      break;
    case "Deal":
      if (U && gotSet(ch, "creditExceptionAt")) emit("credit.exception_approved", { journey: true });
      break;
    case "Invoice":
      if (C) emit("invoice.issued", pick(ch, ["number", "amount", "accountId", "dueAt"]));
      break;
    case "InvoiceStep":
      if (C) { const k = now(ch, "kind"); const n = k === "SUBMITTED" ? "invoice.submitted" : k === "ACCEPTED" || k === "APPROVED_FOR_PAYMENT" ? "invoice.accepted" : k === "REJECTED" ? "invoice.rejected" : null; if (n) emit(n, pick(ch, ["invoiceId", "kind", "at"])); }
      break;
    case "PaymentPromise":
      if (C) emit("payment.promise_created", pick(ch, ["invoiceId", "promisedFor", "amount"]));
      else if (U && gotSet(ch, "replacedAt")) emit("payment.promise_revised");
      break;
    case "CustomerPayment":
      if (C) { emit("cash.received", pick(ch, ["accountId", "amount", "receivedAt", "kind"])); if ("applications" in ch) emit("cash.allocated", { applications: now(ch, "applications") ?? null }); }
      break;
    case "PaymentApplication":
      if (C) emit("cash.allocated", pick(ch, ["paymentId", "invoiceId", "amount"]));
      break;
    case "SupplierInvoice":
      if (C) emit("supplier_invoice.received", pick(ch, ["supplierId", "number", "amount", "currency", "dueAt"]));
      else if (U && gotSet(ch, "payApprovedAt")) emit("payment.approved", { supplierInvoice: true });
      else if (U && gotSet(ch, "paidAt")) emit("payment.executed", { supplierInvoice: true, ref: now(ch, "paidRef") ?? null });
      break;
    case "SupplierPayment":
      if (C) emit("payment.requirement_ready", pick(ch, ["supplierPoId", "amount", "currency", "dueBy"]));
      else if (U && gotSet(ch, "approvedAt")) emit("payment.approved");
      else if (U && gotSet(ch, "executedAt")) emit("payment.executed", { ref: now(ch, "executedRef") ?? null });
      break;
    case "BankStatement":
      if (C) emit("bank_transaction.ingested", pick(ch, ["bankAccountId", "fileName", "rowsRead"]));
      break;
    case "BankMatch":
      if (C) emit("bank_transaction.reconciled", pick(ch, ["transactionId", "amount", "customerPaymentId", "paymentExecutionId"]));
      break;
    case "BankTransaction":
      if (U && gotSet(ch, "classifiedAs")) emit("bank_transaction.reconciled", { classifiedAs: now(ch, "classifiedAs") ?? null });
      break;
    case "InternalPurchase":
      if (U && became(ch, "status", "APPROVED")) { emit("budget.committed", pick(ch, ["decidedByName"])); if (now(ch, "overBudget") != null) emit("budget.exceeded", { over: now(ch, "overBudget") ?? null }); }
      break;
    case "BudgetEntry":
      if (C && now(ch, "kind") === "COMMITTED") emit("budget.committed", pick(ch, ["budgetId", "amount"]));
      break;
    case "AssetEvent":
      if (C) { const k = now(ch, "kind"); const n = k === "ASSIGNED" ? "asset.assigned" : k === "TRANSFERRED" || k === "RETURNED" ? "asset.transferred" : k === "DISPOSED" ? "asset.disposed" : null; if (n) emit(n, pick(ch, ["assetId", "toName", "location", "at"])); }
      break;
    case "CommissionSettlementRun":
      if (C) emit("commission_settlement.approved", pick(ch, ["period", "version", "total"]));
      else if (U && became(ch, "status", "PAID")) emit("commission_settlement.paid", pick(ch, ["payrollRef"]));
      break;
    case "DelegatedAuthority":
      if (C) emit("authority.delegated", pick(ch, ["fromUserId", "toUserId", "domain", "limitUsd", "endsAt"]));
      else if (U && gotSet(ch, "revokedAt")) emit("authority.revoked");
      break;
    // Módulo 15 §14
    case "ManagementDecision":
      if (C && now(ch, "status") === "DECIDED") { emit("management.decision_decided", pick(ch, ["code", "version", "area", "kind"])); if (now(ch, "kind") === "RESOURCE_ALLOCATION") emit("resource_allocation.decided", pick(ch, ["code", "impactUsd"])); }
      else if (C) emit("management.decision_requested", pick(ch, ["code", "area", "kind", "deadline"]));
      else if (U && became(ch, "status", "DECIDED")) emit("management.decision_decided", pick(ch, ["chosen", "followUpOn"]));
      break;
    case "ManagementDecisionReview":
      if (C) emit("management.decision_reviewed", pick(ch, ["decisionId", "verdict"]));
      break;
    case "StrategicPriority":
      if (C) emit("strategic_priority.created", pick(ch, ["title", "ownerId", "horizon"]));
      // A review writes the narrative and has its own event; anything else that changes is a change of the priority.
      else if (U && Object.keys(ch).some((k) => !k.startsWith("narrative") && k !== "nextReviewOn")) emit("strategic_priority.changed", Object.fromEntries(Object.keys(ch).slice(0, 8).map((k) => [k, true])));
      break;
    case "StrategicPriorityReview":
      if (C) emit("strategic_priority.reviewed", pick(ch, ["priorityId", "nextReviewOn"]));
      break;
    case "PurchaseApproval":
      if ((C && Number(now(ch, "level")) >= 2) || (U && gotSet(ch, "escalatedByName"))) emit("policy.exception_escalated", { policy: "purchasePolicy", ...pick(ch, ["prId", "amount", "level"]) });
      break;
    case "AbsenceRecord":
      if (U && became(ch, "status", "APPROVED")) emit("absence.approved");
      break;
  }
  return out;
}

/** The catalogue, for the screen and for whoever integrates. Two events of §10 depend on the passing of time, not on
 *  a change, and are produced by the daily job instead: payment.promise_fulfilled / missed and obligation.due_approaching. */
export const EVENT_NAMES: Record<string, { es: string; en: string }> = {
  "credit.limit_changed": { es: "Cambió un cupo de crédito", en: "A credit limit changed" },
  "credit.exception_requested": { es: "Se pidió una revisión de crédito", en: "A credit review was requested" },
  "credit.exception_approved": { es: "Se aprobó una revisión o excepción de crédito", en: "A credit review or exception was approved" },
  "credit.exception_rejected": { es: "Se rechazó una revisión de crédito", en: "A credit review was rejected" },
  "invoice.issued": { es: "Factura emitida", en: "Invoice issued" },
  "invoice.submitted": { es: "Factura radicada", en: "Invoice submitted" },
  "invoice.accepted": { es: "Factura aceptada por el cliente", en: "Invoice accepted by the customer" },
  "invoice.rejected": { es: "Factura rechazada por el cliente", en: "Invoice rejected by the customer" },
  "payment.promise_created": { es: "Promesa de pago registrada", en: "Payment promise recorded" },
  "payment.promise_revised": { es: "Promesa de pago reemplazada", en: "Payment promise replaced" },
  "payment.promise_fulfilled": { es: "Promesa de pago cumplida", en: "Payment promise kept" },
  "payment.promise_missed": { es: "Promesa de pago incumplida", en: "Payment promise missed" },
  "cash.received": { es: "Dinero recibido de un cliente", en: "Cash received from a customer" },
  "cash.allocated": { es: "Pago aplicado a facturas", en: "Payment applied to invoices" },
  "supplier_invoice.received": { es: "Factura de proveedor recibida", en: "Supplier invoice received" },
  "payment.requirement_ready": { es: "Pago a proveedor solicitado", en: "Supplier payment requested" },
  "payment.approved": { es: "Pago aprobado", en: "Payment approved" },
  "payment.executed": { es: "Pago confirmado como hecho", en: "Payment confirmed as made" },
  "bank_transaction.ingested": { es: "Extracto bancario cargado", en: "Bank statement loaded" },
  "bank_transaction.reconciled": { es: "Movimiento bancario explicado", en: "Bank movement explained" },
  "budget.committed": { es: "Presupuesto comprometido", en: "Budget committed" },
  "budget.exceeded": { es: "Presupuesto superado con excepción", en: "Budget exceeded with an exception" },
  "asset.assigned": { es: "Activo asignado", en: "Asset assigned" },
  "asset.transferred": { es: "Activo trasladado o devuelto", en: "Asset transferred or returned" },
  "asset.disposed": { es: "Activo dado de baja", en: "Asset disposed" },
  "obligation.due_approaching": { es: "Obligación con decisión cercana", en: "Obligation with a decision coming" },
  "commission_settlement.approved": { es: "Liquidación de comisiones aprobada", en: "Commission settlement approved" },
  "commission_settlement.paid": { es: "Liquidación de comisiones pagada", en: "Commission settlement paid" },
  "authority.delegated": { es: "Autoridad prestada", en: "Authority delegated" },
  "authority.revoked": { es: "Autoridad prestada retirada", en: "Delegated authority revoked" },
  "absence.approved": { es: "Ausencia aprobada", en: "Absence approved" },
  // Módulo 15 §14. The last three depend on the passing of time and are written by the daily job of Gerencia.
  "management.decision_requested": { es: "Se pidió una decisión a Gerencia", en: "A decision was requested from Management" },
  "management.decision_decided": { es: "Gerencia decidió", en: "Management decided" },
  "management.decision_reviewed": { es: "Decisión revisada contra lo que pasó", en: "Decision reviewed against what happened" },
  "resource_allocation.decided": { es: "Asignación de recursos decidida", en: "Resource allocation decided" },
  "strategic_priority.created": { es: "Prioridad estratégica creada", en: "Strategic priority created" },
  "strategic_priority.changed": { es: "Prioridad estratégica cambiada", en: "Strategic priority changed" },
  "strategic_priority.reviewed": { es: "Prioridad estratégica revisada", en: "Strategic priority reviewed" },
  "policy.exception_escalated": { es: "Excepción a una política escalada al nivel más alto", en: "Policy exception escalated to the highest level" },
  "risk.material_changed": { es: "Un riesgo cambió de forma material", en: "A risk changed materially" },
  "future_pulse.material_change": { es: "El futuro visible cambió de forma material", en: "The visible future changed materially" },
  "strategic_account.attention": { es: "Una cuenta estratégica pide atención", en: "A strategic account asks for attention" },
};
