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
//   MARKETING (Mercadeo)  — same as a Negociador Comercial, plus loading market data.
// Everyone reads all records.

type U = Pick<SessionUser, "id" | "role">;

export const ROLE_LABEL: Record<Role, { es: string; en: string }> = {
  GERENCIA: { es: "Gerencia", en: "Management" },
  DIRECTOR_COMERCIAL: { es: "Director Comercial", en: "Commercial Director" },
  NEGOCIADOR_COMERCIAL: { es: "Negociador Comercial", en: "Commercial Negotiator" },
  NEGOCIADOR_OPERATIVO: { es: "Negociador Operativo", en: "Operations Negotiator" },
  FINANZAS: { es: "Finanzas", en: "Finance" },
  MARKETING: { es: "Mercadeo", en: "Marketing" },
};
export const ROLES = Object.keys(ROLE_LABEL) as Role[];

/** Gerencia only: people & data, commission policy and payouts, unlimited authority. */
export const isGerencia = (u: U) => u.role === "GERENCIA";

/** Gerencia and Director Comercial: edit everything, management views, policies. */
export function canManageAll(u: U) {
  return u.role === "GERENCIA" || u.role === "DIRECTOR_COMERCIAL";
}

export function canEdit(u: U, ownerId: string) {
  return canManageAll(u) || u.id === ownerId;
}

export function assertCanEdit(u: U, ownerId: string) {
  if (!canEdit(u, ownerId)) throw new Error("No tienes permiso para cambiar este registro. / You do not have permission to change this record.");
}

/** Treasury & cash work (verify bank data, record/reconcile payments): management or Finanzas. */
export function canFinance(u: U) {
  return canManageAll(u) || u.role === "FINANZAS";
}

/** Money records of a Journey (invoices, collections, promises, short pays): the owner, management or Finanzas. */
export function canEditMoney(u: U, ownerId: string) {
  return canEdit(u, ownerId) || u.role === "FINANZAS";
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
  return u.role === "GERENCIA" || u.role === "FINANZAS";
}

/** Mercado §18: loading economic datasets is for Management and Marketing. */
export function canImportData(u: U) {
  return canManageAll(u) || u.role === "MARKETING";
}
