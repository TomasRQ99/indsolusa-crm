import { db } from "./db";
import { AUTH_POLICY_KEY, DEFAULT_AUTH_POLICY, LEVEL_KEYS, type AuthPolicy } from "./auth-levels";

// The authorisation ranges in force (latest version). Version 0 = the 2025 table, not yet confirmed by Gerencia.
export async function getAuthPolicy(): Promise<{ value: AuthPolicy; version: number; by: string | null; at: Date | null }> {
  const s = await db.marketSetting.findFirst({ where: { key: AUTH_POLICY_KEY }, orderBy: { version: "desc" } });
  if (!s) return { value: DEFAULT_AUTH_POLICY, version: 0, by: null, at: null };
  const v = s.value as Partial<AuthPolicy>;
  const ladder = Object.fromEntries(LEVEL_KEYS.map((k) => [k, { ...DEFAULT_AUTH_POLICY.ladder[k], ...(v.ladder?.[k] ?? {}) }])) as AuthPolicy["ladder"];
  return { value: { smlvCop: Number(v.smlvCop ?? DEFAULT_AUTH_POLICY.smlvCop), ladder }, version: s.version, by: s.updatedByName, at: s.createdAt };
}
