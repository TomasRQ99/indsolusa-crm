import { redirect } from "next/navigation";
import { db } from "./db";
import { today } from "./domain";
import { inForce } from "./gerencia-rules";
import { APPROVAL_DOMAINS, agreementVerdict, readRoleProfile } from "./team-rules";
import { getTeamPolicy, grantedByRole } from "./team-store";

// Módulo 16 §26 AC4 · Decision rights of the role agreement, used by the approval engines.
// A policy says which access role may approve. The role agreement says what THIS role is expected to decide.
// When Gerencia switches the rule on, an approval needs both: the policy grants it and the person's role agreement
// names it. The agreement can only narrow what the policy gives; it never grants anything by itself. Gerencia is
// never narrowed (somebody must always be able to decide), and neither is someone with no agreement yet.

type U = { id: string; role: string };

/** The authority the person's role agreement in force names, or null when they have none. */
async function agreementOf(userId: string) {
  const a = await db.personRoleAssignment.findFirst({ where: { userId, effectiveTo: null, acting: false, roleProfileId: { not: null } }, orderBy: { effectiveFrom: "desc" }, select: { roleProfile: { select: { roleKey: true } } } });
  if (!a?.roleProfile) return null;
  const cur = inForce(await db.roleProfile.findMany({ where: { roleKey: a.roleProfile.roleKey } }), today());
  if (!cur) return null;
  const p = readRoleProfile(cur as unknown as Record<string, unknown>);
  return { roleKey: p.roleKey, title: p.title, version: cur.version, domains: p.authorityDomains };
}

/** May this person use `domain` (an approval the policy already grants their role), as far as their role agreement goes? */
export async function roleAuthority(u: U, domain: string) {
  const [pol, ag] = await Promise.all([getTeamPolicy(), agreementOf(u.id)]);
  return { ...agreementVerdict({ mode: pol.value.roleAuthority, role: u.role, agreementDomains: ag?.domains ?? null, domain }), agreement: ag, mode: pol.value.roleAuthority };
}

/** Called by an approval once the policy said yes. Stops it, with the explanation on Mi rol, when the rule is on and
 *  the person's role agreement does not name that authority. Does nothing otherwise. */
export async function assertRoleAuthority(u: U, domain: string) {
  if (!(domain in APPROVAL_DOMAINS)) return;
  const v = await roleAuthority(u, domain);
  if (v.blocked) redirect(`/equipo/mi-rol?err=acuerdo-autoridad&d=${domain}#autoridad-solu`);
}

/** Who would stop being able to approve if the rule were switched on today (or is stopped, when it is on): people
 *  with a role agreement whose access role holds an approval the agreement does not name. */
export async function narrowedByAgreement() {
  const T = today();
  const [rows, all, granted] = await Promise.all([
    db.personRoleAssignment.findMany({ where: { effectiveTo: null, acting: false, roleProfileId: { not: null }, user: { active: true, role: { notIn: ["GERENCIA", "JUNTA"] } } }, orderBy: { effectiveFrom: "desc" }, select: { userId: true, user: { select: { name: true, role: true } }, roleProfile: { select: { roleKey: true } } } }),
    db.roleProfile.findMany(), grantedByRole(),
  ]);
  const seen = new Set<string>();
  const out: { userId: string; name: string; title: string; roleKey: string; domains: string[] }[] = [];
  for (const r of rows) {
    if (seen.has(r.userId) || !r.roleProfile) continue;
    seen.add(r.userId);
    const cur = inForce(all.filter((x) => x.roleKey === r.roleProfile!.roleKey), T);
    if (!cur) continue;
    const named = readRoleProfile(cur as unknown as Record<string, unknown>).authorityDomains;
    const lost = (granted.granted[r.user.role] ?? []).filter((d) => d in APPROVAL_DOMAINS && !agreementVerdict({ mode: "ENFORCE", role: r.user.role, agreementDomains: named, domain: d }).named);
    if (lost.length) out.push({ userId: r.userId, name: r.user.name, title: cur.title, roleKey: cur.roleKey, domains: lost });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
