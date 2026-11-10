import { cmpMoney, subMoney, sumMoney } from "./money";
import { daysBetween } from "./domain";

// Comercial C3 · Commercial Cash Journey (v1.2 §54–75). Pure rules, no database.
// A sale ends economically when the solution becomes reconciled cash. Every stopped peso has a cause,
// a responsible person and a next movement (or a wait with control). The root cause is not the owner:
// time the customer, a carrier or customs held the money is never put on the negotiator.

export const CASH_FORMULA = "cash-v1";

/** User decision 2026-11-10 (C-10). Stored versioned as MarketSetting "cashPolicy"; Gerencia/Finanzas edit it. */
export const DEFAULT_CASH_POLICY = {
  readyAlertDays: 3, // goods ready and not delivered for MORE than this many calendar days → alert
  deliveredAlertWorkingDays: 2, // delivered and not invoiced for MORE than this many working days (Mon–Fri) → alert
  acceptAlertWorkingDays: 5, // submitted / received by the customer and not accepted for MORE than this many working days
  aging: [30, 60, 90], // contractual aging buckets: current, 1–30, 31–60, 61–90, >90
};
export type CashPolicy = typeof DEFAULT_CASH_POLICY;

export function cleanCashPolicy(v: unknown): CashPolicy {
  const o = (v && typeof v === "object" ? v : {}) as Partial<CashPolicy>;
  const int = (x: unknown, d: number, lo: number, hi: number) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  let aging = Array.isArray(o.aging) ? o.aging.map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x > 0 && x <= 720) : [];
  aging = [...new Set(aging)].sort((a, b) => a - b).slice(0, 6);
  return {
    readyAlertDays: int(o.readyAlertDays, DEFAULT_CASH_POLICY.readyAlertDays, 0, 60),
    deliveredAlertWorkingDays: int(o.deliveredAlertWorkingDays, DEFAULT_CASH_POLICY.deliveredAlertWorkingDays, 0, 60),
    acceptAlertWorkingDays: int(o.acceptAlertWorkingDays, DEFAULT_CASH_POLICY.acceptAlertWorkingDays, 0, 60),
    aging: aging.length ? aging : DEFAULT_CASH_POLICY.aging,
  };
}

// ---------- Root cause contract (§70) ----------

export const ROOT_CAUSES = ["COMMERCIAL", "OPERATIONS", "ADMINISTRATION", "CUSTOMER", "CARRIER", "CUSTOMS", "SUPPLIER", "EXTERNAL"] as const;
export type RootCause = (typeof ROOT_CAUSES)[number];
export const isRootCause = (x: unknown): x is RootCause => ROOT_CAUSES.includes(x as RootCause);

/** Who controls the time: the company (one of our areas), the customer, or someone outside both. */
export type CauseClass = "COMPANY" | "CUSTOMER" | "EXTERNAL";
export const causeClass = (c: string | null | undefined): CauseClass | null =>
  c === "COMMERCIAL" || c === "OPERATIONS" || c === "ADMINISTRATION" ? "COMPANY" : c === "CUSTOMER" ? "CUSTOMER" : c && isRootCause(c) ? "EXTERNAL" : null;

export const ROOT_CAUSE_LABEL: Record<RootCause, [string, string]> = {
  COMMERCIAL: ["Comercial", "Commercial"],
  OPERATIONS: ["Operaciones", "Operations"],
  ADMINISTRATION: ["Administración", "Administration"],
  CUSTOMER: ["Cliente", "Customer"],
  CARRIER: ["Transportador", "Carrier"],
  CUSTOMS: ["Aduana", "Customs"],
  SUPPLIER: ["Proveedor", "Supplier"],
  EXTERNAL: ["Externo / otro", "External / other"],
};
export const CLASS_LABEL: Record<CauseClass, [string, string]> = {
  COMPANY: ["Nuestro (empresa)", "Ours (company)"],
  CUSTOMER: ["Del cliente", "The customer's"],
  EXTERNAL: ["Externo", "External"],
};

// ---------- Reason codes (§57, §58), with the usual root cause as a suggestion only ----------

export type CashStage = "DELIVER" | "INVOICE" | "COLLECT";
export const CASH_STAGES: CashStage[] = ["DELIVER", "INVOICE", "COLLECT"];

type Reason = { code: string; es: string; en: string; cause: RootCause };
export const REASONS: Record<CashStage, Reason[]> = {
  DELIVER: [
    { code: "missing_customer_entry_number", es: "Falta número de entrada del cliente", en: "Missing customer entry number", cause: "CUSTOMER" },
    { code: "receiving_appointment", es: "Esperando cita de recepción", en: "Waiting for a receiving appointment", cause: "CUSTOMER" },
    { code: "missing_document", es: "Falta un documento", en: "Missing document", cause: "OPERATIONS" },
    { code: "site_access", es: "Acceso al sitio", en: "Site access", cause: "CUSTOMER" },
    { code: "incomplete_po", es: "OC incompleta", en: "Incomplete PO", cause: "CUSTOMER" },
    { code: "contractual_condition", es: "Condición contractual pendiente", en: "Contractual condition pending", cause: "COMMERCIAL" },
    { code: "customer_request_hold", es: "El cliente pidió esperar", en: "Customer asked to hold", cause: "CUSTOMER" },
    { code: "discrepancy", es: "Diferencia en lo recibido", en: "Discrepancy", cause: "OPERATIONS" },
    { code: "other", es: "Otro", en: "Other", cause: "EXTERNAL" },
  ],
  INVOICE: [
    { code: "missing_entry_number", es: "Falta número de entrada", en: "Missing entry number", cause: "CUSTOMER" },
    { code: "missing_acceptance", es: "Falta acta o aceptación", en: "Missing acceptance record", cause: "CUSTOMER" },
    { code: "missing_signed_pod", es: "Falta remisión firmada", en: "Missing signed delivery note", cause: "OPERATIONS" },
    { code: "missing_support_doc", es: "Falta documento soporte", en: "Missing support document", cause: "OPERATIONS" },
    { code: "missing_milestone", es: "Falta hito contractual", en: "Missing contractual milestone", cause: "COMMERCIAL" },
    { code: "portal_not_enabled", es: "Portal no habilitado", en: "Portal not enabled", cause: "ADMINISTRATION" },
    { code: "po_inconsistent", es: "OC, valor o condición inconsistente", en: "PO, value or condition inconsistent", cause: "COMMERCIAL" },
    { code: "other", es: "Otro", en: "Other", cause: "EXTERNAL" },
  ],
  COLLECT: [
    { code: "invoice_rejected", es: "Factura rechazada", en: "Invoice rejected", cause: "ADMINISTRATION" },
    { code: "dispute", es: "Disputa o reclamo", en: "Dispute or claim", cause: "CUSTOMER" },
    { code: "approval_pending", es: "Aprobación interna del cliente", en: "Customer internal approval", cause: "CUSTOMER" },
    { code: "payment_run", es: "Esperando corrida de pagos", en: "Waiting for the payment run", cause: "CUSTOMER" },
    { code: "other", es: "Otro", en: "Other", cause: "EXTERNAL" },
  ],
};
export const reasonOf = (stage: CashStage, code: string) => REASONS[stage].find((r) => r.code === code) ?? null;

// ---------- Days ----------

/** Working days (Mon–Fri, holidays not counted) after `a` up to and including `b`. */
export function workingDaysBetween(a: Date, b: Date) {
  const n = daysBetween(a, b);
  if (n <= 0) return 0;
  let w = 0;
  for (let k = 1; k <= n; k++) { const d = new Date(a.getTime() + k * 864e5).getUTCDay(); if (d !== 0 && d !== 6) w++; }
  return w;
}

export type AgingKey = "CURRENT" | `B${number}`;
/** Contractual aging by days past due: CURRENT, then one bucket per policy edge, then the last "> edge". */
export function agingBucket(dueAt: Date, now: Date, edges: number[]) {
  const late = daysBetween(dueAt, now);
  if (late <= 0) return { key: "CURRENT" as AgingKey, idx: 0, late: 0 };
  const k = edges.findIndex((e) => late <= e);
  return { key: `B${k === -1 ? edges.length : k}` as AgingKey, idx: (k === -1 ? edges.length : k) + 1, late };
}
export function agingLabels(edges: number[]): [string, string][] {
  const out: [string, string][] = [["Al día", "Current"]];
  edges.forEach((e, k) => { const lo = k ? edges[k - 1] + 1 : 1; out.push([`${lo}–${e} días`, `${lo}–${e} days`]); });
  out.push([`> ${edges[edges.length - 1]} días`, `> ${edges[edges.length - 1]} days`]);
  return out;
}

/** Split the days of an interval by who held them, from the blockers recorded with their root cause.
 *  Days no blocker explains stay "unexplained": never assumed to be anyone's. */
export function delayAttribution(start: Date, end: Date, blockers: { blockedSince: Date; resolvedAt: Date | null; rootCause: string }[]) {
  const total = Math.max(0, daysBetween(start, end));
  const by: Record<CauseClass, number> = { COMPANY: 0, CUSTOMER: 0, EXTERNAL: 0 };
  const byCause: Partial<Record<RootCause, number>> = {};
  let used = 0;
  for (const b of [...blockers].sort((x, y) => +x.blockedSince - +y.blockedSince)) {
    const s = b.blockedSince > start ? b.blockedSince : start;
    const e = b.resolvedAt && b.resolvedAt < end ? b.resolvedAt : end;
    const d = Math.min(Math.max(0, daysBetween(s, e)), total - used);
    const cls = causeClass(b.rootCause);
    if (!cls || d <= 0) continue;
    by[cls] += d; used += d;
    byCause[b.rootCause as RootCause] = (byCause[b.rootCause as RootCause] ?? 0) + d;
  }
  return { total, ...by, unexplained: total - used, byCause };
}

// ---------- Invoice confirmation (§59) ----------

export const STEP_KINDS = ["SUBMITTED", "RECEIVED", "ACCEPTED", "REJECTED", "APPROVED_FOR_PAYMENT"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export type ConfStage = "ISSUED" | StepKind;
export const STEP_LABEL: Record<ConfStage, [string, string]> = {
  ISSUED: ["Emitida · radicación sin registrar", "Issued · no submission recorded"],
  SUBMITTED: ["Radicada", "Submitted"],
  RECEIVED: ["Recibida por el cliente", "Received by the customer"],
  ACCEPTED: ["Aceptada", "Accepted"],
  REJECTED: ["Rechazada", "Rejected"],
  APPROVED_FOR_PAYMENT: ["Aprobada para pago", "Approved for payment"],
};
const RANK: Record<ConfStage, number> = { ISSUED: 0, SUBMITTED: 1, RECEIVED: 2, REJECTED: 2, ACCEPTED: 3, APPROVED_FOR_PAYMENT: 4 };

/** Where the invoice is in the customer's process, from the steps on record. A rejection stands until it is
 *  submitted again; otherwise the furthest step wins (a later "received" never undoes an acceptance). */
export function confirmationOf(steps: { kind: string; at: Date; createdAt: Date; reason?: string | null }[]) {
  const xs = [...steps].sort((a, b) => +a.at - +b.at || +a.createdAt - +b.createdAt);
  let stage: ConfStage = "ISSUED", at: Date | null = null, reason: string | null = null, acceptedAt: Date | null = null, submittedAt: Date | null = null;
  for (const s of xs) {
    const k = s.kind as StepKind;
    if (!STEP_KINDS.includes(k)) continue;
    if (k === "SUBMITTED" && !submittedAt) submittedAt = s.at;
    if ((k === "ACCEPTED" || k === "APPROVED_FOR_PAYMENT") && !acceptedAt) acceptedAt = s.at;
    if (k === "REJECTED") { stage = "REJECTED"; at = s.at; reason = s.reason ?? null; acceptedAt = null; continue; }
    if (stage === "REJECTED" && k !== "SUBMITTED") continue;
    if (stage === "REJECTED" || RANK[k] >= RANK[stage]) { stage = k; at = s.at; reason = null; }
  }
  return { stage, at, reason, acceptedAt, submittedAt, confirmed: stage === "ACCEPTED" || stage === "APPROVED_FOR_PAYMENT" };
}

// ---------- Payment promise (§61) ----------

export type PromiseStatus = "OPEN" | "KEPT" | "PARTIALLY_KEPT" | "MISSED" | "REPLACED";
export const PROMISE_LABEL: Record<PromiseStatus, [string, string]> = {
  OPEN: ["Abierta", "Open"],
  KEPT: ["Cumplida", "Kept"],
  PARTIALLY_KEPT: ["Cumplida en parte", "Partly kept"],
  MISSED: ["Incumplida", "Missed"],
  REPLACED: ["Reemplazada", "Replaced"],
};

/** Judged only against reconciled cash received from the day the promise was made up to the promised day.
 *  Without an amount the promise covers what was open when it was made. */
export function promiseStatus(
  p: { promisedFor: Date; createdAt: Date; amount: number | null; replacedAt: Date | null },
  inv: { amount: number; apps: { amount: number; reconciled: boolean; receivedAt: Date }[] },
  now: Date,
) {
  const day0 = new Date(Date.UTC(p.createdAt.getUTCFullYear(), p.createdAt.getUTCMonth(), p.createdAt.getUTCDate()));
  const before = sumMoney(inv.apps.filter((a) => a.reconciled && a.receivedAt < day0).map((a) => a.amount));
  const target = p.amount != null && p.amount > 0 ? p.amount : Math.max(0, subMoney(inv.amount, before));
  const inWin = (a: { receivedAt: Date }) => a.receivedAt >= day0 && daysBetween(a.receivedAt, p.promisedFor) >= 0;
  const got = sumMoney(inv.apps.filter((a) => a.reconciled && inWin(a)).map((a) => a.amount));
  const unrec = sumMoney(inv.apps.filter((a) => !a.reconciled && inWin(a)).map((a) => a.amount));
  let status: PromiseStatus;
  if (p.replacedAt && daysBetween(p.replacedAt, p.promisedFor) >= 0) status = "REPLACED";
  else if (target > 0 && cmpMoney(got, target) >= 0) status = "KEPT";
  else if (daysBetween(p.promisedFor, now) <= 0 || cmpMoney(got + unrec, target) >= 0) status = "OPEN";
  else if (got > 0.005) status = "PARTIALLY_KEPT";
  else status = p.replacedAt ? "REPLACED" : "MISSED";
  return { status, target, got, unreconciled: unrec };
}

// ---------- Small stats ----------

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
