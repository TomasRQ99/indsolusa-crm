import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import { db } from "./db";
import { today } from "./domain";
import { canAdminPeople } from "./permissions";
import { obligationView } from "./admin-rules";
import { getAdminPolicy } from "./admin-store";
import { getPurchasePolicy } from "./pr-auth";

// Módulo 14 · what Administración adds to the bell: only things that wait for THIS person. An obligation
// interrupts its owner only when it is material and a decision can still change the outcome (§2I).

export async function adminAttention(user: SessionUser, i: I18n) {
  const { t } = i;
  const T = today();
  const [pol, purchase, mineOb, requested, returned, absences, gaps] = await Promise.all([
    getAdminPolicy(), getPurchasePolicy(),
    db.obligation.findMany({ where: { status: "ACTIVE", ownerId: user.id, endsOn: { not: null }, decision: null }, select: { id: true, party: true, status: true, endsOn: true, renewal: true, noticeDays: true, decision: true, material: true, amount: true, frequency: true, moneyDirection: true, nextDueOn: true } }),
    db.internalPurchase.findMany({ where: { status: "REQUESTED", requesterId: { not: user.id } }, select: { id: true, code: true, level: true, description: true } }),
    db.internalPurchase.findMany({ where: { status: "RETURNED", requesterId: user.id }, select: { id: true, code: true } }),
    canAdminPeople(user) ? db.absenceRecord.findMany({ where: { status: "REQUESTED", userId: { not: user.id } }, select: { id: true, userId: true, user: { select: { name: true } } } }) : Promise.resolve([]),
    db.supportGap.findMany({ where: { ownerId: user.id, status: { not: "RESOLVED" }, dueOn: { lt: T } }, select: { id: true, userId: true, what: true } }),
  ]);
  const l2 = purchase.value.level2Roles.includes(user.role), l1 = purchase.value.level1Roles.includes(user.role);
  const toDecide = requested.filter((p) => l2 || (l1 && p.level === 1));
  const ob = mineOb.map((o) => ({ o, v: obligationView({ ...o, amount: o.amount == null ? null : Number(o.amount) }, T, pol.value) })).filter((x) => x.v.alert);
  const alerts = [
    ...ob.map(({ o, v }) => ({ key: `ob${o.id}`, tone: (v.state === "DECIDE" ? "attn" : "risk") as "attn" | "risk", href: `/administracion/obligaciones#o-${o.id}`, text: t(`Decidir si se renueva o termina: ${o.party}`, `Decide whether to renew or end: ${o.party}`) })),
    ...toDecide.map((p) => ({ key: `ip${p.id}`, tone: "attn" as const, href: `/administracion/compras-internas/${p.id}`, text: t(`Decidir compra interna ${p.code}: ${p.description}`, `Decide internal purchase ${p.code}: ${p.description}`) })),
    ...returned.map((p) => ({ key: `ir${p.id}`, tone: "attn" as const, href: `/administracion/compras-internas/${p.id}`, text: t(`Te devolvieron la compra ${p.code} con una pregunta`, `Purchase ${p.code} came back to you with a question`) })),
    ...absences.map((a) => ({ key: `ab${a.id}`, tone: "attn" as const, href: `/administracion/personas/${a.userId}#ausencias`, text: t(`Decidir la ausencia que pidió ${a.user.name}`, `Decide the absence ${a.user.name} requested`) })),
    ...gaps.map((g) => ({ key: `sg${g.id}`, tone: "attn" as const, href: `/administracion/personas/${g.userId}#soporte`, text: t(`Soporte que debías resolver y ya pasó su fecha: ${g.what}`, `Support you were to resolve is past its date: ${g.what}`) })),
  ];
  return { alerts, risk: alerts.some((a) => a.tone === "risk") };
}
