import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll, isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { GAP_KINDS } from "@/lib/admin-rules";
import { AUTHORITY, GAP_DIMS, STRUCTURE_TEXT } from "@/lib/team-rules";
import { roleData } from "@/lib/team-store";
import { roleClarityView } from "@/lib/team-views";
import { Notes, tOf } from "../ui";
import { assignRole } from "../role-actions";

// Módulo 16 §25 · Team Role Clarity. Person | Role | Level | Role Profile version | Expectations reviewed | Key gaps |
// Decision-right issues | Next development. And where the structure has a hole: a role nobody holds, a
// responsibility written twice, authority the agreement asks for and SOLU does not give, the same thing as a
// decision right and as a boundary, a critical role with nobody qualified behind it.

export default async function ClarityPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const T = today();
  const v = await roleClarityView(user);
  const mayAssign = isGerencia(user);
  const leaders = mayAssign ? await db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const dimName = (k: string) => { const d = GAP_DIMS.find((x) => x.key === k); return d ? tx(d.label) : k; };
  const levelsOf = (key: string | null) => { const r = key ? v.roles.find((x) => x.roleKey === key) : null; return r ? roleData(r).careerLevels.map((l) => l.name) : []; };
  const allLevels = [...new Set(v.roles.flatMap((r) => roleData(r).careerLevels.map((l) => l.name)))];
  const ok = { asignado: t("Acuerdo de rol asignado. La asignación anterior quedó cerrada ese día y sigue en la historia.", "Role agreement assigned. The earlier assignment was closed that day and stays in the history."), temporal: t("Rol temporal asignado. El rol base no cambió.", "Temporary role assigned. The base role did not change.") };
  const err = {
    "asignar-permiso": t("El acuerdo de rol lo asigna Gerencia. El cargo del contrato, la unidad y el líder formal también se registran en Administración → Personas.", "The role agreement is assigned by Management. The contract title, unit and formal leader are also recorded in Administration → People."),
    asignar: t("Faltan datos: el acuerdo de rol (ya vigente en esa fecha), desde cuándo y el motivo. No se guardó nada.", "Missing data: the role agreement (already in force on that date), from when and the reason. Nothing was saved."),
    "asignar-fecha": t("La nueva asignación debe empezar después de la actual.", "The new assignment must start after the current one."),
    temporal: t("Un rol temporal necesita su fecha de fin, posterior al inicio.", "A temporary role needs its end date, after the start."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Claridad de roles", "Role clarity")}</h1>
        <p>{t("¿Cada persona sabe qué se espera de su rol, lo ha revisado con su líder y tiene la autoridad para cumplirlo?", "Does each person know what is expected of their role, have they reviewed it with their leader, and do they have the authority to fulfil it?")}</p>
        <p className="small">{v.all ? t("Todas las personas activas", "All active people") : t("Las personas que acompañas", "The people you accompany")} · {t("calculado", "as of")} {i.date(v.asOf)}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />

      {v.noProfile.length > 0 && <div className="note attn" id="brecha"><span><b>{t(`Brecha de claridad de rol: ${v.noProfile.length} persona(s) sin acuerdo de rol vigente.`, `Role clarity gap: ${v.noProfile.length} person(s) with no role agreement in force.`)}</b> {v.noProfile.map((p) => p.name).join(", ")}{v.roles.length === 0 ? <> · <Link href="/equipo/roles#publicar">{t("Publicar el primer acuerdo de rol", "Publish the first role agreement")}</Link></> : null}</span></div>}

      {(v.all || canManageAll(user)) && (
        <section className="card" id="estructura"><b>{t("DÓNDE LA ESTRUCTURA DE ROLES TIENE UN HUECO", "WHERE THE ROLE STRUCTURE HAS A HOLE")}</b> · {v.structure.length}
          {v.roles.length === 0 ? <p className="small muted">{t("Se calcula cuando haya acuerdos de rol publicados.", "Computed once role agreements are published.")}</p> : v.structure.length === 0 ? <p className="small"><span className="sig ok">{t("Cada rol tiene quien lo ejerza, la autoridad que pide y, si es crítico, un respaldo calificado", "Every role has a holder, the authority it asks for and, if critical, a qualified backup")}</span></p> : (
            <ul className="plain">{v.structure.map((s, k) => <li key={k}><span className={`sig ${STRUCTURE_TEXT[s.kind].tone}`}>{tx(STRUCTURE_TEXT[s.kind])}</span> <Link href={`/equipo/roles/${s.roleKey}`}><b>{v.titles[s.roleKey] ?? s.roleKey}</b></Link>{s.other ? <> ↔ <Link href={`/equipo/roles/${s.other}`}>{v.titles[s.other] ?? s.other}</Link></> : null}{s.detail ? <span className="src"> · {s.kind === "INSUFFICIENT_AUTHORITY" ? (AUTHORITY[s.detail] ? tx(AUTHORITY[s.detail]) : s.detail) : s.kind === "INCOMPLETE" ? t(`${s.detail} de 18`, `${s.detail} of 18`) : `«${s.detail}»`}</span> : null}{s.kind === "CRITICAL_NO_BACKUP" ? <> <Link className="small" href={`/equipo/continuidad#r-${s.roleKey}`}>{t("nombrar un respaldo", "name a backup")}</Link></> : null}</li>)}</ul>
          )}
          <p className="src">{t("Funciones sin dueño y responsabilidades duplicadas entre funciones", "Functions with no owner and responsibilities duplicated between functions")}: <Link href="/gerencia/funciones#huecos">{t("Funciones y roles", "Functions and roles")}</Link></p>
        </section>
      )}

      <section className="card flush" id="personas">
        {v.rows.length === 0 ? <p className="small muted" style={{ padding: 16 }}>{t("Hoy no acompañas a nadie como líder.", "You accompany nobody as leader today.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Rol", "Role")}</th><th>{t("Nivel", "Level")}</th><th>{t("Versión del acuerdo", "Agreement version")}</th><th>{t("Expectativas revisadas", "Expectations reviewed")}</th><th>{t("Brechas clave", "Key gaps")}</th><th>{t("Autoridad", "Decision rights")}</th><th>{t("Próximo desarrollo", "Next development")}</th></tr></thead>
            <tbody>{v.rows.map((r) => (
              <tr key={r.id} id={`p-${r.id}`}>
                <td><Link href={`/equipo/mi-rol?p=${r.id}`}><b>{r.name}</b></Link><span className="src block">{tx(ROLE_LABEL[r.accessRole])}</span></td>
                <td>{r.roleKey ? <><Link href={`/equipo/roles/${r.roleKey}`}>{r.title}</Link>{!r.clear ? <span className="sig risk" style={{ marginLeft: 4 }}>{t("no claro", "not clear")}</span> : r.incomplete ? <span className="src block">{t(`${r.incomplete} de 18 por completar`, `${r.incomplete} of 18 to complete`)}</span> : null}</> : <span className="sig attn">{t("sin acuerdo de rol", "no role agreement")}</span>}
                  {mayAssign && (
                    <details><summary className="small">{r.roleKey ? t("Cambiar", "Change") : t("Asignar", "Assign")}</summary>
                      {v.roles.length === 0 ? <p className="src">{t("Primero publica un acuerdo de rol.", "Publish a role agreement first.")} <Link href="/equipo/roles#publicar">{t("Acuerdos de rol", "Role agreements")}</Link></p> : (
                        <form action={assignRole.bind(null, r.id)} className="qa-form" style={{ minWidth: 260 }}>
                          <label>{t("Acuerdo de rol", "Role agreement")}<select name="roleKey" defaultValue={r.roleKey ?? v.roles[0].roleKey}>{v.roles.map((x) => <option key={x.roleKey} value={x.roleKey}>{x.title} · v{x.version}</option>)}</select></label>
                          <label>{t("Nivel", "Level")}<input name="level" maxLength={80} defaultValue={r.level ?? ""} list="niveles" /></label>
                          <label>{t("Líder", "Leader")}<select name="leaderId" defaultValue={r.assignment?.leaderId ?? ""}><option value="">—</option>{leaders.filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                          {!r.assignment ? <label>{t("Cargo en el contrato (si es distinto del nombre del rol)", "Contract title (if different from the role name)")}<input name="contractualTitle" maxLength={160} /></label> : null}
                          <label>{t("Desde", "From")}<input type="date" name="effectiveFrom" required defaultValue={dayInput(T)} /></label>
                          <label className="chk"><input type="checkbox" name="acting" value="1" /> {t("Es un rol temporal (el rol base no cambia)", "It is a temporary role (the base role stays)")}</label>
                          <label>{t("Hasta (solo si es temporal)", "Until (only if temporary)")}<input type="date" name="effectiveTo" /></label>
                          <label>{t("Motivo", "Reason")}<input name="reason" required maxLength={300} /></label>
                          <div><button type="submit" className="secondary sm">{t("Guardar", "Save")}</button></div>
                        </form>
                      )}
                    </details>
                  )}
                </td>
                <td className="small">{r.level ?? "—"}{levelsOf(r.roleKey).length && r.level && !levelsOf(r.roleKey).some((l) => l.toLowerCase() === r.level!.toLowerCase()) ? <span className="src block">{t("no está en la ruta del rol", "not in the role's route")}</span> : null}</td>
                <td className="small">{r.version ? <>v{r.version}{r.agreedVersion && r.agreedVersion !== r.version ? <span className="src block">{t(`asignado bajo la v${r.agreedVersion}`, `assigned under v${r.agreedVersion}`)}</span> : null}</> : "—"}</td>
                <td className="small">{!r.roleKey ? "—" : r.reviewed ? <><span className="sig ok">{t("sí", "yes")}</span><span className="src block">{i.day(r.reviewedAt)}</span></> : <span className="sig attn">{r.reviewedVersion ? t(`solo la v${r.reviewedVersion}`, `only v${r.reviewedVersion}`) : t("aún no", "not yet")}</span>}</td>
                <td className="small">{r.keyGaps.length ? r.keyGaps.map((g) => <span key={g} className="block">{dimName(g)}</span>) : <span className="muted">{r.roleKey ? t("ninguna registrada", "none recorded") : "—"}</span>}{r.roleKey ? <Link className="src block" href={`/equipo/mi-rol?p=${r.id}#brechas`}>{t("ver o registrar", "see or record")}</Link> : null}</td>
                <td className="small">{r.authorityGap.length === 0 && !r.roleMismatch && r.support.filter((s) => s.kind === "AUTHORITY").length === 0 ? <span className="muted">{r.roleKey ? t("sin problemas", "no issues") : "—"}</span> : <>
                  {r.authorityGap.map((d) => <span key={d} className="block"><span className="sig risk">{t("falta", "missing")}</span> {AUTHORITY[d] ? tx(AUTHORITY[d]) : d}</span>)}
                  {r.roleMismatch ? <span className="block"><span className="sig attn">{t("acceso distinto al del acuerdo", "access differs from the agreement")}</span></span> : null}
                  {r.support.filter((s) => s.kind === "AUTHORITY").map((s, k) => <span key={k} className="block"><span className="sig attn">{tx(GAP_KINDS.AUTHORITY)}</span> {s.what}</span>)}</>}
                  {r.support.filter((s) => s.kind !== "AUTHORITY").length ? <span className="src block">{t(`${r.support.filter((s) => s.kind !== "AUTHORITY").length} soporte(s) pendiente(s)`, `${r.support.filter((s) => s.kind !== "AUTHORITY").length} support item(s) pending`)}</span> : null}
                  {r.roleKey ? <Link className="src block" href={`/equipo/mi-rol?p=${r.id}#soporte`}>{t("reconocer algo que falta", "acknowledge something missing")}</Link> : null}</td>
                <td className="small">{r.nextObjective ? <>{r.nextObjective.title}<span className="src block">{t("revisión", "review")} {i.day(r.nextObjective.reviewOn)}</span></> : <span className="muted">{t("sin objetivo compartido", "no shared objective")}</span>}{r.nextMeeting ? <span className="src block">{t("conversación", "conversation")} {i.day(r.nextMeeting)}</span> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <datalist id="niveles">{allLevels.map((l) => <option key={l} value={l} />)}</datalist>
      <p className="src">{t("En orden alfabético: no es una clasificación. Una brecha describe algo por desarrollar en el rol; nunca es una etiqueta sobre la persona.", "In alphabetical order: not a ranking. A gap describes something to develop in the role; it is never a label on the person.")}</p>
    </div>
  );
}
