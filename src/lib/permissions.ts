import type { SessionUser } from "./auth";

// Policy: everyone can read all records. Reps edit only what they own;
// managers and admins edit everything. Only admins manage users.
export function canManageAll(user: SessionUser) {
  return user.role === "ADMIN" || user.role === "MANAGER";
}

export function canEdit(user: SessionUser, ownerId: string) {
  return canManageAll(user) || user.id === ownerId;
}

export function assertCanEdit(user: SessionUser, ownerId: string) {
  if (!canEdit(user, ownerId)) {
    throw new Error("You do not have permission to change this record.");
  }
}

/** Mercado §18: loading economic datasets is for Administration, Management and Marketing. */
export function canImportData(user: SessionUser) {
  return canManageAll(user) || user.role === "MARKETING";
}