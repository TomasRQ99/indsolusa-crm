import type { Role } from "@prisma/client";
import type { SessionUser } from "./auth";

// Business roles (user decision 2026-11-09):
//   GERENCIA              — everything (was Admin): people & data, unlimited payment approval, commissions, policies.
//   DIRECTOR_COMERCIAL    — edits every record, approves payments ≤ USD 25k and Eságara exceptions (was Manager).
//   NEGOCIADOR_COMERCIAL  — edits the Journeys they own (was Rep).
//   NEGOCIADOR_OPERATIVO  — own Journeys + purchasing, shipments, delivery notes and supplier RFQs on ANY Journey
//                           (the operations side), never the customer quote.
//   FINANZAS              — money side on any Journey: invoices, collections, cash, bank verification, payment
//                           execution and reconciliation, commissions paid; approves supplier payments ≤ USD 25k.
//   ADMINISTRACION        — same as Finanzas for now (decision 2026-11-10); approves purchases with Finanzas.
//   MARKETING (Mercadeo)  — same as a Negociador Comercial, plus loading market data.
// Everyone reads all records.

type U = Pick<SessionUser, "id" | "role"> & { covering?: string[] };

export const ROLE_LABEL: Record<Role, { es: string; en: string }> = {
  GERENCIA: { es: "Gerencia", en: "Management" },
  DIRECTOR_COMERCIAL: { es: "Director Comercial", en: "Commercial Director" },
  NEGOCIADOR_COMERCIAL: { es: "Negociador Comercial", en: "Commercial Negotiator" },
  NEGOCIADOR_OPERATIVO: { es: "Negociador Operativo", en: "Operations Negotiator" },
  FINANZAS: { es: "Finanzas", en: "Finance" },
  ADMINISTRACION: { es: "Administración", en: "Administration" },
  MARKETING: { es: "Mercadeo", en: "Marketing" },
  JUNTA: { es: "Junta o asamblea (solo lectura)", en: "Board or assembly (read-only)" },
};
export const ROLES = Object.keys(ROLE_LABEL) as Role[];

/** Gerencia only: people & data, commission policy and payouts, unlimited authority. */
export const isGerencia = (u: U) => u.role === "GERENCIA";
/** Módulo 13 §15 · taking a report out of SOLU as a file: Gerencia and Finanzas (decision 2026-11-11). */
export const canExportReports = (u: U) => u.role === "GERENCIA" || u.role === "FINANZAS";

/** Finanzas and Administración share the money side for now (decision 2026-11-10); Module 14 may split them. */
export const isMoneyRole = (role: string) => role === "FINANZAS" || role === "ADMINISTRACION";

/** Gerencia and Director Comercial: edit everything, management views, policies. */
export function canManageAll(u: U) {
  return u.role === "GERENCIA" || u.role === "DIRECTOR_COMERCIAL";
}

/** Owner, management, or (Comercial C8b) someone covering the owner's absence right now. */
export function canEdit(u: U, ownerId: string) {
  return canManageAll(u) || u.id === ownerId || (u.covering?.includes(ownerId) ?? false);
}

export function assertCanEdit(u: U, ownerId: string) {
  if (!canEdit(u, ownerId)) throw new Error("No tienes permiso para cambiar este registro. / You do not have permission to change this record.");
}

/** Treasury & cash work (verify bank data, record/reconcile payments): management or Finanzas. */
export function canFinance(u: U) {
  return canManageAll(u) || isMoneyRole(u.role);
}

/** Money records of a Journey (invoices, collections, promises, short pays): the owner, management or Finanzas. */
export function canEditMoney(u: U, ownerId: string) {
  return canEdit(u, ownerId) || isMoneyRole(u.role);
}
export function assertCanEditMoney(u: U, ownerId: string) {
  if (!canEditMoney(u, ownerId)) throw new Error("No tienes permiso para cambiar este registro. / You do not have permission to change this record.");
}

/** Operations side of a Journey (supplier POs, shipments, delivery notes, supplier RFQs): owner, management or Negociador Operativo. */
export function canEditOps(u: U, ownerId: string) {
  return canEdit(u, ownerId) || u.role === "NEGOCIADOR_OPERATIVO";
}
export function assertCanEditOps(u: U, ownerId: string) {
  if (!canEditOps(u, ownerId)) throw new Error("No tienes permiso para cambiar este registro. / You do not have permission to change this record.");
}

/** Credit authority (user decision 2026-11-10): credit limits, terms and credit exceptions are decided by
 *  Finanzas or Gerencia, never by the person who asks. Director Comercial sees and supports requests. */
export function canDecideCredit(u: U) {
  return u.role === "GERENCIA" || isMoneyRole(u.role);
}

/** Módulo 14 §2K, §9 · labour facts of people (contract, dates, absences, assets): Gerencia and Administración.
 *  Never pay: see canSeePay. (Decision A-01, confirmed by the user 2026-11-11.) */
export const canAdminPeople = (u: U) => u.role === "GERENCIA" || u.role === "ADMINISTRACION";
/** Pay is seen by Gerencia, Finanzas and the person themselves (user decision 2026-11-11), and set by Gerencia only (AC18). */
export const canSeePay = (u: U, personId: string) => u.role === "GERENCIA" || u.role === "FINANZAS" || u.id === personId;
/** Budgets are assigned, changed and closed by Gerencia or Finanzas (user decision 2026-11-11). */
export const canAssignBudgets = (u: U) => u.role === "GERENCIA" || u.role === "FINANZAS";
export const canSetPay = (u: U) => u.role === "GERENCIA";

/** Mercado §18: loading economic datasets is for Management and Marketing. */
export function canImportData(u: U) {
  return canManageAll(u) || u.role === "MARKETING";
}

// ---------- Junta o asamblea (Módulo 15 §13) ----------
// A read-only role with a curated view. It opens only the addresses below, can change nothing except its own
// profile (password, language), and never sees people data, commissions or the records of a customer.
export const isBoard = (u: { role: string }) => u.role === "JUNTA";
export const BOARD_HOME = "/gerencia/junta";
const BOARD_PATHS = [BOARD_HOME, "/gerencia/identidad", "/gerencia/funciones", "/profile", "/shell-attention"];
export const boardMayOpen = (path: string) => BOARD_PATHS.some((p) => path === p || path.startsWith(p + "/"));
/** The only place a board member may save something: their own profile. */
export const boardMayAct = (path: string) => path === "/profile" || path.startsWith("/profile/");
/** Roles that work in SOLU every day (everything except the board). */
export const WORK_ROLES = ROLES.filter((r) => r !== "JUNTA");
