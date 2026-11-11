import { budgetCheck } from "./admin-rules";
import { actWith, budgetAvailable } from "./admin-store";
import { getPurchasePolicy } from "./pr-auth";
import { canApprovePurchase } from "./purchase-auth";

// Módulo 14 §2G · who may decide an internal purchase. Same purchase policy as every other purchase (level by
// amount, never the requester). A purchase without a budget, or above what its budget has left, is an exception:
// it goes to the higher level and needs a written reason. Used by the action and by the screens, so both agree.

export async function ipAuthority(user: { id: string; role: string }, p: { id: string; requesterId: string; amountUsd: unknown; level: number; budgetId: string | null }) {
  const pol = await getPurchasePolicy();
  const amount = Number(p.amountUsd);
  const available = p.budgetId ? await budgetAvailable(p.budgetId, p.id) : null;
  const check = budgetCheck(amount, available);
  const level = check.exception ? 2 : p.level;
  const test = (role: string) => canApprovePurchase({ id: user.id, role }, { requestedById: p.requesterId, level }, pol.value);
  const a = await actWith(user, "PURCHASE_APPROVAL", amount, p.requesterId, test);
  return { ...a, check, level, available, policyVersion: pol.version, roles: level === 2 ? pol.value.level2Roles : [...pol.value.level1Roles, ...pol.value.level2Roles], limit: pol.value.level1LimitUsd };
}
