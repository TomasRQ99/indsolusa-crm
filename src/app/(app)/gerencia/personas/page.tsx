import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { peopleCapacity } from "@/lib/gerencia-people";

// Módulo 15 §9, §21 · People & capacity, as Gerencia needs it: continuity first. Who is away and who covers, who is
// covering too much, which key relationships and roles depend on one person, what support the company owes.
// Facts of work only: no private reflection, no personal test, no development note, not even the kind of an absence.

export default async function PeoplePage() {
  const user = await requireRole("GERENCIA");
  const i = makeI18n(user.lang);
  const { t } = i;
  const p = await peopleCapacity();
  const role = (r: string) => t(ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.es ?? r, ROLE_LABEL[r as keyof typeof ROLE_LABEL]?.en ?? r);
  const BK = { NONE: t("no tiene respaldo", "has no backup"), INACTIVE: t("su respaldo ya no está activo", "its backup is no longer active"), SAME: t("el respaldo es el mismo responsable", "the backup is the owner themselves") };
  const risks = p.uncovered.length + p.overload.length + p.noBackup.length + p.singleRoles.length;

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Personas y capacidad", "People and capacity")}</h1>
        <p>{risks === 0 ? t("Hoy no hay un riesgo de continuidad registrado.", "No continuity risk is recorded today.") : t("Dónde la empresa depende de una sola persona, y dónde alguien falta sin que otro cubra.", "Where the company depends on a single person, and where someone is away with nobody covering.")}</p>
        <p className="small">{t(`${p.headcount} persona(s) activas en SOLU`, `${p.headcount} active person(s) in SOLU`)} · {t("calculado", "as of")} {i.date(p.asOf)}</p>
      </div></div>

      <section className="card" id="ausencias"><b>{t("AUSENCIAS EN LOS PRÓXIMOS 30 DÍAS", "ABSENCES IN THE NEXT 30 DAYS")}</b> <span className="small muted">{t("aprobadas; el motivo no se muestra aquí", "approved; the reason is not shown here")}</span>
        {p.away.length === 0 ? <p className="small"><span className="sig ok">{t("Ninguna ausencia aprobada", "No approved absence")}</span></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Quién", "Who")}</th><th>{t("Desde", "From")}</th><th>{t("Hasta", "Until")}</th><th>{t("Quién cubre", "Covered by")}</th></tr></thead>
            <tbody>{p.away.map((a) => <tr key={a.id}><td><Link href={`/administracion/personas/${a.userId}`}>{a.name}</Link>{a.now ? <span className="sig wait" style={{ marginLeft: 6 }}>{t("ausente hoy", "away today")}</span> : null}</td><td>{i.date(a.startsOn)}</td><td>{i.date(a.endsOn)}</td><td>{a.coveredBy ?? <><span className="sig attn">{t("nadie", "nobody")}</span> <Link href="/comercial/cobertura" className="small">{t("asignar cobertura", "assign coverage")}</Link></>}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="cobertura"><b>{t("SOBRECARGA DE COBERTURA", "COVERAGE OVERLOAD")}</b>
        {p.overload.length === 0 ? <p className="small"><span className="sig ok">{t("Nadie cubre a dos o más compañeros a la vez", "Nobody covers two or more colleagues at once")}</span></p> : <ul className="plain">{p.overload.map((o) => <li key={o.id}><span className="sig attn">{t("atención", "attention")}</span> <b>{o.name}</b> {t("cubre a", "covers")} {o.covering.join(", ")}{o.alsoAway ? <b className="risk-t"> · {t("y está ausente hoy", "and is away today")}</b> : null}</li>)}</ul>}
      </section>

      <section className="card" id="respaldo"><b>{t("RELACIONES CLAVE SIN RESPALDO", "KEY RELATIONSHIPS WITH NO BACKUP")}</b> <span className="small muted">{t(`cuentas estratégicas y clientes con Eságara en juego de ${i.money(p.materialEsagaraUsd)} o más`, `strategic accounts and customers with Eságara in play of ${i.money(p.materialEsagaraUsd)} or more`)}</span>
        {p.noBackup.length === 0 ? <p className="small"><span className="sig ok">{t("Todas tienen un respaldo válido", "All have a valid backup")}</span></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cliente", "Customer")}</th><th>{t("Responsable", "Owner")}</th><th className="n">{t("Eságara en juego", "Eságara in play")}</th><th>{t("Qué falta", "What is missing")}</th></tr></thead>
            <tbody>{p.noBackup.map((a) => <tr key={a.id}><td><Link href={`/accounts/${a.id}`}>{a.name}</Link>{a.strategic ? <span className="sig info" style={{ marginLeft: 6 }}>{t("estratégica", "strategic")}</span> : null}</td><td>{a.owner}</td><td className="n mono">{a.esagara ? i.money(a.esagara) : "—"}</td><td><span className="sig attn">{BK[a.state]}</span> <Link href="/comercial/cobertura#respaldos" className="small">{t("definir respaldo", "set a backup")}</Link></td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="roles"><b>{t("ROLES CON UN SOLO TITULAR", "ROLES WITH A SINGLE HOLDER")}</b> <span className="small muted">{t("si esa persona falta, el rol se detiene", "if that person is away, the role stops")}</span>
        {p.singleRoles.length === 0 ? <p className="small"><span className="sig ok">{t("Cada rol tiene al menos dos personas", "Every role has at least two people")}</span></p> : <ul className="plain">{p.singleRoles.map((r) => <li key={r.role}><b>{role(r.role)}</b>: {r.holder ?? <span className="sig risk">{t("nadie lo tiene", "nobody holds it")}</span>}{r.away ? <b className="attn-t"> · {t(`ausente del ${i.day(r.away.startsOn)} al ${i.day(r.away.endsOn)}`, `away ${i.day(r.away.startsOn)} to ${i.day(r.away.endsOn)}`)}{r.away.coveredBy ? ` (${t("cubre", "covered by")} ${r.away.coveredBy})` : ""}</b> : null}</li>)}</ul>}
        <p className="src">{t("Es el rol de acceso en SOLU. Sucesores, preparación para el rol y brechas de desarrollo llegan con el módulo de Equipo.", "This is the access role in SOLU. Successors, role readiness and development gaps arrive with the Team module.")} <Link href="/gerencia/funciones#roles">{t("Funciones y roles", "Functions and roles")}</Link></p>
      </section>

      <section className="card" id="liderazgo"><b>{t("CAPACIDAD DE LIDERAZGO", "LEADERSHIP CAPACITY")}</b>
        {p.teams.length === 0 ? <p className="small muted">{t("No hay equipos definidos.", "No teams defined.")} <Link href="/informes/equipo">{t("Definirlos", "Define them")}</Link></p> : <ul className="plain">{p.teams.map((tm) => <li key={tm.id}><b>{tm.name}</b> · {t("lidera", "led by")} {tm.leader}{!tm.leaderActive ? <span className="sig risk" style={{ marginLeft: 6 }}>{t("líder inactivo", "leader inactive")}</span> : tm.leaderAway ? <span className="sig attn" style={{ marginLeft: 6 }}>{t("líder ausente hoy", "leader away today")}</span> : null} · {t(`${tm.members} persona(s)`, `${tm.members} person(s)`)}</li>)}</ul>}
        {p.noTeam.length > 0 && <p className="small">{t("Sin equipo ni líder asignado", "With no team or leader assigned")}: {p.noTeam.map((x) => x.name).join(", ")} · <Link href="/informes/equipo">{t("Equipos", "Teams")}</Link></p>}
      </section>

      <section className="card" id="soporte"><b>{t("SOPORTE QUE LA EMPRESA DEBE", "SUPPORT THE COMPANY OWES")}</b> <span className="small muted">{t("herramientas, accesos, equipos o información que alguien necesita para hacer su rol", "tools, access, equipment or information someone needs to do their role")}</span>
        {p.gaps.length === 0 ? <p className="small"><span className="sig ok">{t("Nada pendiente", "Nothing pending")}</span></p> : <ul className="plain">{p.gaps.map((g) => <li key={g.id}><span className={`sig ${g.escalated ? "risk" : g.late ? "attn" : "wait"}`}>{g.escalated ? t("escalado", "escalated") : g.late ? t("pasó su fecha", "past its date") : t("en curso", "in progress")}</span> <Link href={`/administracion/personas/${g.userId}#soporte`}>{g.who}</Link>: {g.what}{g.impact ? <span className="src block">{t("Impacto", "Impact")}: {g.impact}</span> : null}<span className="src block">{t("Lo resuelve", "Resolved by")} {g.owner} · {g.next}</span></li>)}</ul>}
      </section>

      <section className="card" id="carga"><b>{t("SEÑALES DE CARGA", "LOAD SIGNALS")}</b> <span className="small muted">{t("en orden alfabético; no es una clasificación", "in alphabetical order; not a ranking")}</span>
        {p.load.length === 0 ? <p className="small muted">{t("Nadie tiene Journeys abiertos.", "Nobody has open Journeys.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Rol", "Role")}</th><th className="n">{t("Journeys abiertos", "Open Journeys")}</th><th className="n">{t("Con próximo paso vencido", "With next step overdue")}</th><th className="n">{t("Cubre a", "Covering")}</th></tr></thead>
            <tbody>{p.load.map((x) => <tr key={x.id}><td>{x.name}{x.away ? <span className="sig wait" style={{ marginLeft: 6 }}>{t("ausente hoy", "away today")}</span> : null}</td><td className="small">{role(x.role)}</td><td className="n mono">{x.open}</td><td className="n mono">{x.overdue || "—"}</td><td className="n mono">{x.covering || "—"}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="src">{t("Cuenta trabajo abierto, no actividad: sirve para ver si a alguien se le está pidiendo más de lo que puede mover.", "It counts open work, not activity: it shows whether someone is being asked for more than they can move.")}</p>
      </section>
    </>
  );
}
