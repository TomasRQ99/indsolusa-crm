import { cmpMoney, money2, subMoney, sumMoney, type MoneyIn } from "./money";
import { addDays, daysBetween } from "./domain";

// Módulo 14 · Administración. Pure rules, no database: obligations, three-way match, budgets, internal purchases,
// delegated authority, absences and travel settlement. Every threshold comes from a versioned policy that Gerencia
// edits (§1.7); nothing here decides for a person, it only says where things stand and why.

type Txt = { es: string; en: string };

// ---------- Policy (§2L) ----------

export const ADMIN_POLICY_KEY = "adminPolicy";
export type AdminPolicy = {
  /** an obligation starts asking for a decision this many days before its notice deadline */
  obligationLeadDays: number;
  /** yearly amount (USD) from which an obligation interrupts by itself; below it, only when a person marked it material. 0 = all */
  materialityUsd: number;
  /** three-way match: difference in USD accepted without asking for an exception */
  apToleranceUsd: number;
  /** longest time an authority can be lent in one version */
  delegationMaxDays: number;
};
/** Starting values, to be confirmed by Gerencia (decision A-03). Zero tolerance and zero materiality invent nothing. */
export const DEFAULT_ADMIN_POLICY: AdminPolicy = { obligationLeadDays: 30, materialityUsd: 0, apToleranceUsd: 0, delegationMaxDays: 60 };
export function cleanAdminPolicy(v: unknown): AdminPolicy | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const num = (x: unknown) => { const n = Number(String(x ?? "").trim().replace(",", ".")); return String(x ?? "").trim() !== "" && Number.isFinite(n) ? n : NaN; };
  const lead = Math.round(num(o.obligationLeadDays)), mat = num(o.materialityUsd), tol = num(o.apToleranceUsd), del = Math.round(num(o.delegationMaxDays));
  if (!(lead >= 1 && lead <= 365) || !(mat >= 0 && mat <= 1e9) || !(tol >= 0 && tol <= 1e6) || !(del >= 1 && del <= 365)) return null;
  return { obligationLeadDays: lead, materialityUsd: money2(mat), apToleranceUsd: money2(tol), delegationMaxDays: del };
}
export const readAdminPolicy = (v: unknown): AdminPolicy => ({ ...DEFAULT_ADMIN_POLICY, ...((v && typeof v === "object" ? v : {}) as Partial<AdminPolicy>) });

// ---------- Contracts & obligations (§2I, AC12) ----------

export const OBLIGATION_KINDS: Record<string, Txt> = {
  CONTRACT: { es: "Contrato", en: "Contract" }, LEASE: { es: "Arriendo", en: "Lease" }, INSURANCE: { es: "Seguro", en: "Insurance" },
  PERMIT: { es: "Permiso o licencia", en: "Permit or licence" }, GUARANTEE: { es: "Garantía o póliza", en: "Guarantee or bond" },
  SUBSCRIPTION: { es: "Suscripción", en: "Subscription" }, TAX: { es: "Obligación tributaria", en: "Tax obligation" }, OTHER: { es: "Otro", en: "Other" },
};
export const RENEWALS: Record<string, Txt> = {
  NONE: { es: "Termina y no se renueva sola", en: "Ends, no automatic renewal" },
  AUTO: { es: "Se renueva sola si nadie avisa", en: "Renews by itself unless notice is given" },
  MANUAL: { es: "Hay que renovarla a mano", en: "Must be renewed by hand" },
};
export const FREQUENCIES: Record<string, Txt & { perYear: number; months: number }> = {
  ONCE: { es: "Una vez", en: "Once", perYear: 1, months: 0 }, MONTHLY: { es: "Cada mes", en: "Monthly", perYear: 12, months: 1 },
  QUARTERLY: { es: "Cada trimestre", en: "Quarterly", perYear: 4, months: 3 }, YEARLY: { es: "Cada año", en: "Yearly", perYear: 1, months: 12 },
};
export type ObligationIn = { status: string; endsOn: Date | null; renewal: string; noticeDays: number | null; decision: string | null; material: boolean; amount: MoneyIn; frequency: string | null; moneyDirection: string; nextDueOn: Date | null };
export type ObligationState = "ENDED" | "NO_END" | "QUIET" | "DECIDE" | "NOTICE_PASSED" | "RENEWS" | "DECIDED" | "EXPIRED";
export const OBLIGATION_STATE: Record<ObligationState, Txt & { tone: string }> = {
  ENDED: { es: "Terminada", en: "Ended", tone: "wait" }, NO_END: { es: "Sin fecha de fin", en: "No end date", tone: "wait" },
  QUIET: { es: "Vigente, nada que decidir todavía", en: "In force, nothing to decide yet", tone: "ok" },
  DECIDE: { es: "Hay que decidir: renovar o terminar", en: "Decision needed: renew or end", tone: "attn" },
  NOTICE_PASSED: { es: "Pasó la fecha de aviso y sigue vigente", en: "Notice date passed, still in force", tone: "risk" },
  RENEWS: { es: "Se renueva sola: el plazo de aviso ya pasó", en: "Renews by itself: the notice window is closed", tone: "wait" },
  DECIDED: { es: "Decisión tomada", en: "Decision made", tone: "ok" },
  EXPIRED: { es: "Venció y sigue marcada como vigente", en: "Expired and still marked as in force", tone: "risk" },
};
const monthsAfter = (d: Date, m: number) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1)); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(d.getUTCDate(), last)); return x; };
/** What one year of this obligation is worth, in its own currency. Null when no amount was given. */
export function yearlyAmount(o: Pick<ObligationIn, "amount" | "frequency">) {
  if (o.amount == null) return null;
  return money2(Number(o.amount) * (FREQUENCIES[o.frequency ?? "ONCE"]?.perYear ?? 1));
}
/** Where an obligation stands today. `alert` is true only while a decision can still change what happens (§2I). */
export function obligationView(o: ObligationIn, now: Date, pol: AdminPolicy) {
  const yearly = yearlyAmount(o);
  // With no materiality set (0) everything counts; otherwise a person's mark or a yearly amount at or above it.
  const material = o.material || pol.materialityUsd <= 0 || (yearly != null && cmpMoney(yearly, pol.materialityUsd) >= 0);
  const noticeBy = o.endsOn ? addDays(o.endsOn, -(o.noticeDays ?? 0)) : null;
  const askFrom = noticeBy ? addDays(noticeBy, -pol.obligationLeadDays) : null;
  let state: ObligationState;
  if (o.status !== "ACTIVE") state = "ENDED";
  else if (!o.endsOn || !noticeBy || !askFrom) state = "NO_END";
  else if (o.decision) state = daysBetween(o.endsOn, now) > 0 && o.decision === "END" ? "EXPIRED" : "DECIDED";
  else if (daysBetween(o.endsOn, now) > 0) state = o.renewal === "AUTO" ? "RENEWS" : "EXPIRED";
  else if (daysBetween(noticeBy, now) > 0) state = o.renewal === "AUTO" ? "RENEWS" : "NOTICE_PASSED";
  else if (daysBetween(askFrom, now) >= 0) state = "DECIDE";
  else state = "QUIET";
  const needsAction = state === "DECIDE" || state === "NOTICE_PASSED" || state === "EXPIRED";
  return { state, noticeBy, askFrom, yearly, material, alert: needsAction && material, needsAction, daysToNotice: noticeBy ? daysBetween(now, noticeBy) : null, daysToEnd: o.endsOn ? daysBetween(now, o.endsOn) : null };
}
/** The dates money is due between `from` and `to` (inclusive), following the frequency and never past the end. */
export function dueDates(o: Pick<ObligationIn, "status" | "endsOn" | "frequency" | "nextDueOn" | "moneyDirection" | "amount">, from: Date, to: Date, max = 40): Date[] {
  if (o.status !== "ACTIVE" || o.moneyDirection === "NONE" || o.amount == null || !o.nextDueOn) return [];
  const step = FREQUENCIES[o.frequency ?? "ONCE"]?.months ?? 0;
  const out: Date[] = [];
  for (let k = 0; k < 400 && out.length < max; k++) {
    const d = step ? monthsAfter(o.nextDueOn, k * step) : o.nextDueOn;
    if (d > to || (o.endsOn && d > o.endsOn)) break;
    // A due date already in the past stays visible as overdue: it is only dropped when the person moves nextDueOn.
    if (d >= from || k === 0) out.push(d);
    if (!step) break;
  }
  return out;
}

// ---------- Accounts payable: three-way match (§2D, AC7) ----------

export type MatchKind = "NO_ORDER" | "SERVICE_PENDING" | "SERVICE_OK" | "MATCHED" | "OVER_ORDER" | "NOT_RECEIVED" | "PARTLY_RECEIVED";
export const MATCH_TEXT: Record<MatchKind, Txt & { tone: string }> = {
  NO_ORDER: { es: "Sin orden de compra enlazada", en: "No purchase order linked", tone: "attn" },
  SERVICE_PENDING: { es: "Servicio sin aceptar todavía", en: "Service not accepted yet", tone: "attn" },
  SERVICE_OK: { es: "Servicio aceptado", en: "Service accepted", tone: "ok" },
  MATCHED: { es: "Orden, recibo y factura coinciden", en: "Order, receipt and invoice agree", tone: "ok" },
  OVER_ORDER: { es: "Facturado por encima de la orden", en: "Invoiced above the order", tone: "risk" },
  NOT_RECEIVED: { es: "Facturado y nada recibido todavía", en: "Invoiced, nothing received yet", tone: "attn" },
  PARTLY_RECEIVED: { es: "Facturado más de lo recibido", en: "Invoiced more than received", tone: "attn" },
};
/** Order vs receipt vs invoice, in the invoice's currency. `invoicedTotal` adds every invoice of the same order.
 *  A difference within the tolerance is not a difference. An accepted exception clears the block but stays visible. */
export function threeWay(i: { kind: string; orderAmount: number | null; receivedValue: number | null; invoicedTotal: number; serviceAccepted: boolean; exceptionAccepted: boolean }, toleranceUsd: number) {
  let kind: MatchKind;
  const overOrder = i.orderAmount == null ? 0 : Math.max(0, subMoney(i.invoicedTotal, i.orderAmount));
  const overReceived = i.receivedValue == null ? 0 : Math.max(0, subMoney(i.invoicedTotal, i.receivedValue));
  if (i.orderAmount == null) kind = i.kind === "SERVICE" ? (i.serviceAccepted ? "SERVICE_OK" : "SERVICE_PENDING") : "NO_ORDER";
  else if (overOrder > toleranceUsd + 0.004) kind = "OVER_ORDER";
  else if (i.kind === "SERVICE") kind = i.serviceAccepted ? "SERVICE_OK" : "SERVICE_PENDING";
  else if ((i.receivedValue ?? 0) <= 0.004) kind = "NOT_RECEIVED";
  else if (overReceived > toleranceUsd + 0.004) kind = "PARTLY_RECEIVED";
  else kind = "MATCHED";
  const clean = kind === "MATCHED" || kind === "SERVICE_OK";
  return { kind, overOrder, overReceived, clean, payable: clean || i.exceptionAccepted };
}
/** Value received, from the order's lines and what the receipts counted (never more than ordered on each line). */
export function receivedValue(lines: { position: number; qty: number; unitCost: MoneyIn }[], received: { position: number; qtyReceived: number }[]) {
  return sumMoney(lines.map((l) => {
    const got = received.filter((r) => r.position === l.position).reduce((s, r) => s + r.qtyReceived, 0);
    return money2(Math.min(got, l.qty) * Number(l.unitCost));
  }));
}
/** What paying early saves, while the discount still stands. */
export function discountOf(inv: { amount: MoneyIn; discountPct: MoneyIn; discountUntil: Date | null }, now: Date) {
  const pct = inv.discountPct == null ? 0 : Number(inv.discountPct);
  if (!(pct > 0) || !inv.discountUntil) return null;
  const left = daysBetween(now, inv.discountUntil);
  return { saving: money2((Number(inv.amount) * pct) / 100), until: inv.discountUntil, daysLeft: left, open: left >= 0 };
}

// ---------- Budget & spend (§2F, AC10) ----------

export const SCOPE_KINDS: Record<string, Txt> = { COST_CENTER: { es: "Centro de costo", en: "Cost centre" }, FUNCTION: { es: "Función", en: "Function" }, PROJECT: { es: "Proyecto", en: "Project" } };
export type BudgetLine = { kind: "COMMITTED" | "SPENT" | "ASKED"; amount: number; label: string; href: string | null; on: Date | null };
/** Budget / Committed / Spent / Forecast. A commitment uses up the budget from the day it is approved, paid or not. */
export function budgetView(b: { amount: MoneyIn; forecast: MoneyIn }, lines: BudgetLine[]) {
  const committed = sumMoney(lines.filter((l) => l.kind === "COMMITTED").map((l) => l.amount));
  const spent = sumMoney(lines.filter((l) => l.kind === "SPENT").map((l) => l.amount));
  const asked = sumMoney(lines.filter((l) => l.kind === "ASKED").map((l) => l.amount));
  const amount = money2(b.amount);
  const used = sumMoney([committed, spent]);
  const available = subMoney(amount, used);
  const forecast = b.forecast == null ? null : money2(b.forecast);
  return { amount, committed, spent, asked, used, available, over: available < -0.004, usedPct: amount > 0 ? Math.round((used / amount) * 1000) / 10 : null, forecast, forecastGap: forecast == null ? null : subMoney(amount, forecast) };
}

// ---------- Internal purchases (§2G) ----------

export const PURPOSES: Record<string, Txt> = {
  INTERNAL_USE: { es: "Uso interno", en: "Internal use" }, CAPITAL_ASSET: { es: "Activo de la empresa", en: "Capital asset" }, PROJECT_INVESTMENT: { es: "Inversión de proyecto", en: "Project investment" },
};
export const IP_STATUS: Record<string, Txt & { tone: string }> = {
  REQUESTED: { es: "Esperando decisión", en: "Awaiting decision", tone: "attn" }, RETURNED: { es: "Devuelta con una pregunta", en: "Returned with a question", tone: "risk" },
  APPROVED: { es: "Aprobada: comprometida", en: "Approved: committed", tone: "ok" }, REJECTED: { es: "No aprobada", en: "Not approved", tone: "risk" }, CANCELLED: { es: "Cancelada", en: "Cancelled", tone: "wait" },
};
/** Is the purchase inside its budget? Without a budget, or above what is left, it is an exception: it needs the
 *  higher authority and a written reason (§2F "Exception con autoridad y razón"). */
export function budgetCheck(amountUsd: number, available: number | null) {
  if (available == null) return { exception: true as const, over: null, why: { es: "No tiene presupuesto asignado", en: "It has no budget assigned" } };
  const over = subMoney(amountUsd, Math.max(0, available));
  return over > 0.004 ? { exception: true as const, over, why: { es: "Supera lo que le queda al presupuesto", en: "It exceeds what the budget has left" } } : { exception: false as const, over: null, why: null };
}
/** Total cost of ownership of an asset: purchase + running cost over the years − what it is worth at the end. */
export function tcoOf(purchase: number, t: { years: number; yearlyCost: number; endValue: number } | null) {
  if (!t || !(t.years > 0)) return null;
  const total = money2(purchase + t.yearlyCost * t.years - t.endValue);
  return { total, perYear: money2(total / t.years) };
}

// ---------- Assets & custody (§2H, AC11) ----------

export const ASSET_CATS: Record<string, Txt> = { EQUIPMENT: { es: "Equipo", en: "Equipment" }, VEHICLE: { es: "Vehículo", en: "Vehicle" }, COMPUTER: { es: "Computador o teléfono", en: "Computer or phone" }, FURNITURE: { es: "Mobiliario", en: "Furniture" }, SOFTWARE: { es: "Software o licencia", en: "Software or licence" }, OTHER: { es: "Otro", en: "Other" } };
export const ASSET_STATUS: Record<string, Txt & { tone: string }> = {
  REQUESTED: { es: "Pedido", en: "Requested", tone: "wait" }, ACQUIRED: { es: "Adquirido, sin asignar", en: "Acquired, not assigned", tone: "attn" }, ASSIGNED: { es: "Asignado", en: "Assigned", tone: "ok" },
  IN_MAINTENANCE: { es: "En mantenimiento", en: "In maintenance", tone: "attn" }, DISPOSED: { es: "Dado de baja", en: "Disposed", tone: "wait" },
};
export const ASSET_EVENTS: Record<string, Txt> = {
  ACQUIRED: { es: "Adquirido", en: "Acquired" }, ASSIGNED: { es: "Asignado", en: "Assigned" }, TRANSFERRED: { es: "Trasladado", en: "Transferred" }, RETURNED: { es: "Devuelto a la empresa", en: "Returned to the company" },
  MAINTENANCE: { es: "Mantenimiento", en: "Maintenance" }, ODOMETER: { es: "Kilometraje", en: "Odometer" }, INSURANCE: { es: "Seguro", en: "Insurance" }, DOCUMENT: { es: "Documento", en: "Document" }, DISPOSED: { es: "Dado de baja", en: "Disposed" },
};
/** What an asset needs soon: warranty, insurance or maintenance dates inside the window, or already past. */
export function assetDue(a: { status: string; warrantyUntil: Date | null; insuranceUntil: Date | null; nextMaintenanceOn: Date | null; custodianId: string | null }, now: Date, leadDays: number) {
  if (a.status === "DISPOSED") return [];
  const out: { key: "INSURANCE" | "MAINTENANCE" | "WARRANTY" | "NO_CUSTODIAN"; on: Date | null; late: boolean; text: Txt }[] = [];
  const near = (d: Date | null) => !!d && daysBetween(now, d) <= leadDays;
  if (near(a.insuranceUntil)) out.push({ key: "INSURANCE", on: a.insuranceUntil, late: a.insuranceUntil! < now, text: { es: "Seguro por vencer o vencido", en: "Insurance expiring or expired" } });
  if (near(a.nextMaintenanceOn)) out.push({ key: "MAINTENANCE", on: a.nextMaintenanceOn, late: a.nextMaintenanceOn! < now, text: { es: "Mantenimiento por hacer", en: "Maintenance due" } });
  if (a.warrantyUntil && daysBetween(now, a.warrantyUntil) <= leadDays && a.warrantyUntil >= now) out.push({ key: "WARRANTY", on: a.warrantyUntil, late: false, text: { es: "La garantía está por terminar", en: "Warranty about to end" } });
  if (!a.custodianId && a.status !== "REQUESTED") out.push({ key: "NO_CUSTODIAN", on: null, late: false, text: { es: "Nadie lo tiene a cargo", en: "Nobody is responsible for it" } });
  return out;
}

// ---------- Delegated authority (§16) ----------

export const DOMAINS: Record<string, Txt> = {
  PURCHASE_APPROVAL: { es: "Aprobar compras", en: "Approve purchases" },
  PAYMENT_APPROVAL: { es: "Aprobar pagos a proveedores", en: "Approve supplier payments" },
  CREDIT: { es: "Decidir crédito de clientes", en: "Decide customer credit" },
};
export type Delegation = { id: string; fromUserId: string; fromRole: string; fromName: string; toUserId: string; domain: string; limitUsd: number | null; startsAt: Date; endsAt: Date; revokedAt: Date | null };
/** In force right now. Nothing has to be switched off: when the end passes, this is simply false. */
export const delegationActive = (d: Pick<Delegation, "startsAt" | "endsAt" | "revokedAt">, now: Date) => !d.revokedAt && d.startsAt <= now && now < d.endsAt;
/** Does this role hold the authority by itself? Purchase and payment follow the purchase policy; credit is Gerencia or the money roles. */
export function holdsAuthority(role: string, domain: string, p: { level1Roles: string[]; level2Roles: string[] }) {
  if (domain === "CREDIT") return role === "GERENCIA" || role === "FINANZAS" || role === "ADMINISTRACION";
  if (domain === "PURCHASE_APPROVAL" || domain === "PAYMENT_APPROVAL") return p.level1Roles.includes(role) || p.level2Roles.includes(role);
  return false;
}
export function delegationIssues(d: { fromUserId: string; toUserId: string; fromRole: string; domain: string; startsAt: Date; endsAt: Date; reason: string; approvedById: string }, pol: AdminPolicy, purchase: { level1Roles: string[]; level2Roles: string[] }): Txt[] {
  const out: Txt[] = [];
  if (!DOMAINS[d.domain]) out.push({ es: "Elige qué autoridad se presta.", en: "Choose which authority is lent." });
  if (d.fromUserId === d.toUserId) out.push({ es: "Nadie se presta autoridad a sí mismo.", en: "Nobody lends authority to themselves." });
  if (!(d.endsAt > d.startsAt)) out.push({ es: "La fecha final debe ser posterior a la inicial.", en: "The end date must be after the start." });
  else if (daysBetween(d.startsAt, d.endsAt) > pol.delegationMaxDays) out.push({ es: `Una autoridad prestada dura como máximo ${pol.delegationMaxDays} días. Para más tiempo se crea otra versión al terminar.`, en: `A lent authority lasts at most ${pol.delegationMaxDays} days. For longer, a new version is created when it ends.` });
  if (DOMAINS[d.domain] && !holdsAuthority(d.fromRole, d.domain, purchase)) out.push({ es: "Quien presta la autoridad no la tiene por su rol.", en: "The person lending the authority doesn't hold it by role." });
  if (!d.reason.trim()) out.push({ es: "Escribe el motivo.", en: "Write the reason." });
  // Whoever receives the authority never approves their own delegation.
  if (d.approvedById === d.toUserId) out.push({ es: "Quien recibe la autoridad no puede aprobarla.", en: "The person receiving the authority can't approve it." });
  return out;
}
/** The roles a person may act with in a domain for an amount: their own, plus each lender's role while a delegation
 *  is in force and covers the amount. A delegation from the requester is never used on the requester's own request. */
export function actingAs(u: { id: string; role: string }, domain: string, amountUsd: number | null, delegations: Delegation[], now: Date, requesterId?: string | null) {
  const own = [{ role: u.role, delegationId: null as string | null, fromName: null as string | null }];
  const lent = delegations
    .filter((d) => d.toUserId === u.id && d.domain === domain && delegationActive(d, now) && d.fromUserId !== requesterId && (d.limitUsd == null || amountUsd == null || cmpMoney(amountUsd, d.limitUsd) <= 0))
    .map((d) => ({ role: d.fromRole, delegationId: d.id as string | null, fromName: d.fromName as string | null }));
  return [...own, ...lent];
}

// ---------- Absences (§15) ----------

export const ABSENCE_KINDS: Record<string, Txt> = { VACATION: { es: "Vacaciones", en: "Vacation" }, SICK: { es: "Incapacidad", en: "Sick leave" }, LEAVE: { es: "Licencia o permiso", en: "Leave" }, TRAINING: { es: "Formación", en: "Training" }, OTHER: { es: "Otra", en: "Other" } };
export const ABSENCE_STATUS: Record<string, Txt & { tone: string }> = { REQUESTED: { es: "Pedida", en: "Requested", tone: "attn" }, APPROVED: { es: "Aprobada", en: "Approved", tone: "ok" }, REJECTED: { es: "No aprobada", en: "Not approved", tone: "risk" }, CANCELLED: { es: "Cancelada", en: "Cancelled", tone: "wait" } };
/** Is the person away on that calendar day? Only approved absences change availability. */
export const absentOn = (rows: { status: string; startsOn: Date; endsOn: Date }[], day: Date) => rows.some((r) => r.status === "APPROVED" && r.startsOn <= day && day <= r.endsOn);
/** Approved absence days inside [from, to], counting only the days `isWork` says are working days. */
export function absenceDays(rows: { status: string; startsOn: Date; endsOn: Date }[], from: Date, to: Date, isWork: (d: Date) => boolean) {
  let n = 0;
  for (const r of rows) {
    if (r.status !== "APPROVED") continue;
    for (let d = r.startsOn > from ? r.startsOn : from; d <= r.endsOn && d <= to; d = addDays(d, 1)) if (isWork(d)) n++;
  }
  return n;
}
/** The absence overlaps one that already exists for the person (not rejected or cancelled). */
export const overlaps = (rows: { status: string; startsOn: Date; endsOn: Date }[], s: Date, e: Date) => rows.some((r) => (r.status === "REQUESTED" || r.status === "APPROVED") && r.startsOn <= e && s <= r.endsOn);

// ---------- Support gaps (§25) ----------

export const GAP_KINDS: Record<string, Txt> = { TOOL: { es: "Herramienta", en: "Tool" }, ACCESS: { es: "Acceso", en: "Access" }, ASSET: { es: "Equipo o activo", en: "Equipment or asset" }, TRAINING: { es: "Formación", en: "Training" }, INFORMATION: { es: "Información", en: "Information" }, AUTHORITY: { es: "Autoridad", en: "Authority" } };

// ---------- Travel: advance and settlement (§14, §18) ----------

/** Only expenses a person checked and found valid count. The settlement is what was validly spent minus the
 *  advance: positive = the company pays the traveller; negative = the traveller returns money. */
export function travelSettlement(advance: MoneyIn, expenses: { amount: MoneyIn; outcome: string | null }[]) {
  const valid = sumMoney(expenses.filter((e) => e.outcome === "VALID").map((e) => e.amount));
  const rejected = sumMoney(expenses.filter((e) => e.outcome === "REJECTED").map((e) => e.amount));
  const pending = expenses.filter((e) => !e.outcome).length;
  const adv = advance == null ? 0 : money2(advance);
  const settle = subMoney(valid, adv);
  return { valid, rejected, pending, advance: adv, settle, direction: settle > 0.004 ? ("PAY_TRAVELLER" as const) : settle < -0.004 ? ("TRAVELLER_RETURNS" as const) : ("EVEN" as const), ready: pending === 0 };
}
