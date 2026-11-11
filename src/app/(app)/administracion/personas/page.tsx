import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canAdminPeople, canManageAll, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/domain";
import { ABSENCE_KINDS, GAP_KINDS, absentOn } from "@/lib/admin-rules";

// Módulo 14 §2K, §15, §23–25 · Personas (administrative layer). Administración and Gerencia see everyone's
// administrative facts; anyone else goes straight to their own record. Pay is never shown on this list.

export default async function PeopleAdminPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const admin = canAdminPeople(user);
  // Finanzas reaches each person's pay from this list (decision 2026-11-11); labour facts stay hidden for them.
  if (!admin && !canManageAll(user) && user.role !== "FINANZAS") redirect(`/administracion/personas/${user.id}`);
  const T = today();
  const soon = addDays(T, 30);
  const [people, absences, gaps, coverage] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, personAdmin: { select: { bond: true, contractEnd: true, location: true } }, roleAssignments: { where: { effectiveTo: null }, take: 1, orderBy: { effectiveFrom: "desc" }, select: { contractualTitle: true, unit: true, leader: { select: { name: true } } } }, _count: { select: { assetsHeld: true } } } }),
    db.absenceRecord.findMany({ where: { status: { in: ["REQUESTED", "APPROVED"] }, endsOn: { gte: T }, startsOn: { lte: addDays(T, 60) } }, orderBy: { startsOn: "asc" }, include: { user: { select: { id: true, name: true } } } }),
    db.supportGap.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: [{ status: "asc" }, { createdAt: "asc" }], include: { user: { select: { id: true, name: true } }, owner: { select: { name: true } } } }),
    db.coverageAssignment.findMany({ where: { revokedAt: null, endsAt: { gt: T } }, select: { originalUserId: true, startsAt: true, endsAt: true } }),
  ]);
  const byUser = new Map<string, typeof absences>();
  for (const a of absences) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);
  const toDecide = absences.filter((a) => a.status === "REQUESTED");
  // An approved absence with nobody covering the person's Journeys during it.
  const uncovered = absences.filter((a) => a.status === "APPROVED" && a.startsOn <= soon && !coverage.some((c) => c.originalUserId === a.userId && c.startsAt <= a.endsOn && a.startsOn < c.endsAt));
  const kind = (k: string) => (admin ? (ABSENCE_KINDS[k] ? t(ABSENCE_KINDS[k].es, ABSENCE_KINDS[k].en) : k) : t("Ausencia", "Absence"));

  return (
    <>
      <div className="ph"><div><h1>{t("Personas: datos administrativos", "People: administrative facts")}</h1><p>{t("Vínculo, cargo formal, ausencias, activos a cargo y el soporte que la empresa le debe a cada rol. Aquí no hay evaluaciones ni notas de desarrollo: eso pertenece a Equipo.", "Bond, formal position, absences, assets in their care and the support the company owes each role. No evaluations or development notes here: those belong to Team.")}</p></div></div>

      {admin && toDecide.length > 0 && <section className="card" id="decidir"><b>{t("AUSENCIAS POR DECIDIR", "ABSENCES TO DECIDE")} · {toDecide.length}</b>
        <ul className="plain small">{toDecide.map((a) => <li key={a.id}><Link href={`/administracion/personas/${a.userId}#ausencias`}><b>{a.user.name}</b></Link> · {kind(a.kind)} · {i.day(a.startsOn)} – {i.day(a.endsOn)}{a.userId === user.id ? <span className="muted"> · {t("es tuya: la decide otra persona", "it is yours: someone else decides it")}</span> : null}</li>)}</ul>
      </section>}

      <section className="card" id="cobertura"><b>{t("AUSENCIAS APROBADAS SIN COBERTURA", "APPROVED ABSENCES WITHOUT COVERAGE")} · {uncovered.length}</b>
        {uncovered.length === 0 ? <p className="small"><span className="sig ok">{t("Ninguna en los próximos 30 días", "None in the next 30 days")}</span></p> : <ul className="plain small">{uncovered.map((a) => <li key={a.id}><b>{a.user.name}</b> · {i.day(a.startsOn)} – {i.day(a.endsOn)} · <Link href="/comercial/cobertura">{t("Asignar quién cubre", "Assign who covers")}</Link></li>)}</ul>}
        <p className="src">{t("Administración guarda la ausencia; quién cubre el trabajo se define en Cobertura.", "Administration keeps the absence; who covers the work is set in Coverage.")}</p>
      </section>

      <section className="card" id="soporte"><b>{t("SOPORTE QUE LA EMPRESA DEBE", "SUPPORT THE COMPANY OWES")} · {gaps.length}</b>
        {gaps.length === 0 ? <p className="small muted">{t("Nada pendiente.", "Nothing pending.")}</p> : <ul className="plain small">{gaps.map((g) => <li key={g.id}><span className={`sig ${g.status === "ESCALATED" ? "risk" : g.dueOn && g.dueOn < T ? "attn" : "wait"}`}>{g.status === "ESCALATED" ? t("Escalado", "Escalated") : GAP_KINDS[g.kind] ? t(GAP_KINDS[g.kind].es, GAP_KINDS[g.kind].en) : g.kind}</span> <Link href={`/administracion/personas/${g.userId}#soporte`}><b>{g.user.name}</b>: {g.what}</Link> · {t("responde", "owner")} {g.owner.name} · {g.nextMovement}{g.dueOn ? ` · ${i.day(g.dueOn)}` : ""}</li>)}</ul>}
        <p className="src">{t("Que falte una herramienta o un acceso no es bajo desempeño de la persona.", "A missing tool or access is not the person's low performance.")}</p>
      </section>

      <section className="card"><b>{t("PERSONAS", "PEOPLE")} · {people.length}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Cargo en el contrato", "Contract title")}</th><th>{t("Rol en SOLU", "Role in SOLU")}</th><th>{t("Unidad · líder formal", "Unit · formal leader")}</th><th>{t("Vínculo", "Bond")}</th><th>{t("Hoy", "Today")}</th></tr></thead>
          <tbody>{people.map((p) => {
            const ra = p.roleAssignments[0];
            const mine = byUser.get(p.id) ?? [];
            const away = absentOn(mine, T);
            const next = mine.find((a) => a.status === "APPROVED" && a.startsOn > T);
            return (
              <tr key={p.id}><td><Link href={`/administracion/personas/${p.id}`}><b>{p.name}</b></Link>{p._count.assetsHeld ? <span className="src block">{t(`${p._count.assetsHeld} activo(s) a cargo`, `${p._count.assetsHeld} asset(s) in care`)}</span> : null}</td>
                <td>{ra?.contractualTitle ?? <span className="muted">{t("sin registrar", "not recorded")}</span>}</td>
                <td className="small">{ROLE_LABEL[p.role]?.[i.es ? "es" : "en"] ?? p.role}</td>
                <td className="small">{ra ? `${ra.unit ?? "—"} · ${ra.leader?.name ?? "—"}` : "—"}</td>
                <td className="small">{!admin ? <span className="muted">—</span> : p.personAdmin?.bond ? (p.personAdmin.bond === "EMPLOYEE" ? t("Empleado", "Employee") : p.personAdmin.bond === "CONTRACTOR" ? t("Contratista", "Contractor") : p.personAdmin.bond === "PARTNER" ? t("Socio", "Partner") : t("Otro", "Other")) : "—"}{admin && p.personAdmin?.contractEnd && p.personAdmin.contractEnd <= addDays(T, 60) ? <span className="sig attn"> {t("contrato hasta", "contract until")} {i.day(p.personAdmin.contractEnd)}</span> : null}</td>
                <td className="small">{away ? <span className="sig attn">{t("Ausente", "Away")}</span> : next ? <span className="muted">{t(`ausente desde el ${i.day(next.startsOn)}`, `away from ${i.day(next.startsOn)}`)}</span> : ""}</td></tr>
            );
          })}</tbody>
        </table></div>
        <p className="src">{t("El cargo del contrato y el rol en SOLU pueden ser distintos: se guardan los dos. Los permisos en SOLU dependen del rol, de las políticas y de la autoridad prestada, nunca del título.", "The contract title and the role in SOLU can differ: both are kept. Permissions in SOLU depend on the role, the policies and delegated authority, never on the title.")} <Link href="/administracion/autoridad">{t("Autoridad prestada", "Delegated authority")}</Link></p>
      </section>
    </>
  );
}
