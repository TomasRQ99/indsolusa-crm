import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { FUNCTIONS } from "@/lib/gerencia-rules";
import { DIMS, DIM_KEYS, READINESS } from "@/lib/team-rules";
import { orgDevView } from "@/lib/team-views";
import { AUTHORITY } from "@/lib/team-rules";
import { narrowedByAgreement } from "@/lib/role-authority";
import { Notes, tOf } from "../ui";
import { saveTeamPolicy } from "../role-actions";

// Módulo 16 §13 · Organizational Development: capacity, succession, roles with no backup and development by
// function. Counts and organisational facts only; what a person kept private or shared only with their leader is
// not read here. Also the numbers of the development programme, which Gerencia may change.

export default async function OrgDevPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireRole("GERENCIA");
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const [v, narrowed] = await Promise.all([orgDevView(), narrowedByAgreement()]);
  const P = v.policy.value;
  const tot = (k: "people" | "withPlan" | "withProfile") => v.byFunction.reduce((s, f) => s + f[k], 0);
  const ready = v.readiness.filter((r) => r.state === "READY_NOW");
  const ok = { guardada: t("Guardada como una versión nueva. Los ciclos ya abiertos conservan sus fechas.", "Saved as a new version. Cycles already open keep their dates."), igual: t("No hubo cambios.", "No changes.") };
  const err = { gerencia: t("Solo Gerencia cambia esta política.", "Only Management changes this policy."), valores: t("Revisa los valores (y elige una de las dos opciones de aprobaciones): el ciclo entre 30 y 365 días, los puntos de control dentro del ciclo, mínimos no mayores que máximos y al menos una dimensión de carácter. No se guardó nada.", "Check the values: cycle between 30 and 365 days, checkpoints inside the cycle, minimums not above maximums and at least one character dimension. Nothing was saved."), motivo: t("Escribe por qué se cambia. No se guardó nada.", "Write why it is changed. Nothing was saved.") };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Desarrollo organizacional", "Organizational development")}</h1>
        <p>{t("¿La compañía está acompañando el crecimiento de sus personas, y tiene quién continúe cada rol?", "Is the company accompanying the growth of its people, and does it have someone to continue each role?")}</p>
        <p className="small">{t(`${v.headcount} persona(s) activas`, `${v.headcount} active person(s)`)} · {t("calculado", "as of")} {i.date(v.asOf)}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />

      <section className="card" id="funciones"><b>{t("DESARROLLO POR FUNCIÓN", "DEVELOPMENT BY FUNCTION")}</b>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Función", "Function")}</th><th className="n">{t("Personas", "People")}</th><th className="n">{t("Con acuerdo de rol", "With role agreement")}</th><th className="n">{t("Con ciclo activo", "With active cycle")}</th><th className="n">{t("Punto de control sin conversación", "Checkpoint with no conversation")}</th><th className="n">{t("Compromisos vencidos", "Commitments overdue")}</th><th className="n">{t("Sin próxima conversación", "No next conversation")}</th><th className="n">{t("Ciclo por cerrar", "Cycle to close")}</th></tr></thead>
          <tbody>{v.byFunction.map((f) => <tr key={f.key}><td>{tx(FUNCTIONS[f.key])}</td><td className="n mono">{f.people}</td><td className="n mono">{f.people ? <span className={f.withProfile < f.people ? "attn-t" : ""}>{f.withProfile}</span> : "—"}</td><td className="n mono">{f.people ? <span className={f.withPlan < f.people ? "attn-t" : ""}>{f.withPlan}</span> : "—"}</td><td className="n mono">{f.checkpointDue || "—"}</td><td className="n mono">{f.overdue || "—"}</td><td className="n mono">{f.noNext || "—"}</td><td className="n mono">{f.ended || "—"}</td></tr>)}</tbody>
          <tfoot><tr><td><b>{t("Total", "Total")}</b></td><td className="n mono">{tot("people")}</td><td className="n mono">{tot("withProfile")}</td><td className="n mono">{tot("withPlan")}</td><td colSpan={4} /></tr></tfoot>
        </table></div>
        <p className="src">{t("Son conteos de personas, no nombres ni contenido. Quién necesita qué lo ve cada líder en Desarrollo de mi equipo.", "These are counts of people, not names or content. Who needs what is seen by each leader in My team's development.")} <Link href="/equipo/claridad">{t("Claridad de roles", "Role clarity")}</Link></p>
      </section>

      <section className="card" id="sucesion"><b>{t("SUCESIÓN Y ROLES SIN RESPALDO", "SUCCESSION AND ROLES WITH NO BACKUP")}</b> <Link className="small" href="/equipo/continuidad">{t("Continuidad y sucesión", "Continuity and succession")}</Link>
        {v.continuity.noRoles ? <p className="small muted">{t("Aún no hay acuerdos de rol publicados.", "No role agreements published yet.")}</p> : v.continuity.risks.length === 0 ? <p className="small"><span className="sig ok">{t("Ningún rol crítico o de una sola persona está sin respaldo calificado", "No critical or single-holder role is without a qualified backup")}</span></p> : (
          <ul className="plain">{v.continuity.risks.map((r) => <li key={r.roleKey}><span className="sig risk">{t("sin respaldo calificado", "no qualified backup")}</span> <Link href={`/equipo/continuidad#r-${r.roleKey}`}><b>{r.title}</b></Link>{r.critical ? <span className="sig info" style={{ marginLeft: 6 }}>{t("crítico", "critical")}</span> : null} · {r.holders.length ? r.holders.map((h) => h.name).join(", ") : t("nadie lo tiene", "nobody holds it")}{r.backups.length ? <span className="src"> · {t(`${r.backups.length} nombrado(s), ninguno calificado hoy`, `${r.backups.length} named, none qualified today`)}</span> : null}</li>)}</ul>
        )}
        <h3>{t("Personas listas ahora para un rol", "People ready now for a role")}</h3>
        {ready.length === 0 ? <p className="small muted">{t("Ninguna evaluación de «listo ahora» registrada.", "No “ready now” assessment recorded.")}</p> : <ul className="plain">{ready.map((r, k) => <li key={k}><span className="sig ok">{tx(READINESS.READY_NOW)}</span> {r.user.name} → <Link href={`/equipo/roles/${r.roleKey}`}>{v.continuity.roles.find((x) => x.roleKey === r.roleKey)?.title ?? r.roleKey}</Link>{r.level ? ` · ${r.level}` : ""}</li>)}</ul>}
        <p className="small muted">{t(`En desarrollo: ${v.readiness.filter((r) => r.state === "DEVELOPING").length} · aún no: ${v.readiness.filter((r) => r.state === "NOT_YET").length}`, `Developing: ${v.readiness.filter((r) => r.state === "DEVELOPING").length} · not yet: ${v.readiness.filter((r) => r.state === "NOT_YET").length}`)}</p>
      </section>

      <section className="card" id="capacidad"><b>{t("CAPACIDAD", "CAPACITY")}</b>
        <p className="small">{t("Ausencias, sobrecarga de cobertura, relaciones clave sin respaldo y señales de carga", "Absences, coverage overload, key relationships with no backup and load signals")}: <Link href="/gerencia/personas">{t("Gerencia → Personas y capacidad", "Management → People and capacity")}</Link> · {t("Capacidades del equipo", "Team capabilities")}: <Link href="/equipo/talentos">{t("Mapa de talentos", "Talent map")}</Link></p>
      </section>

      <section className="card" id="politica"><b>{t("POLÍTICA DEL PROGRAMA DE DESARROLLO", "DEVELOPMENT PROGRAMME POLICY")}</b> <span className="small muted">{v.policy.version ? t(`versión ${v.policy.version} · ${v.policy.by} · ${i.day(v.policy.at)}`, `version ${v.policy.version} · ${v.policy.by} · ${i.day(v.policy.at)}`) : t("valores del documento oficial del módulo", "values of the module's official document")}</span>
        <form action={saveTeamPolicy} className="qa-form">
          <div className="qa-row">
            <label>{t("Días de un ciclo", "Days in a cycle")}<input name="cycleDays" inputMode="numeric" required defaultValue={P.cycleDays} style={{ width: 90 }} /></label>
            <label style={{ flex: 2 }}>{t("Puntos de control (días del ciclo, separados por coma)", "Checkpoints (days of the cycle, comma-separated)")}<input name="checkpoints" required defaultValue={P.checkpoints.join(", ")} /></label>
          </div>
          <div className="eq-cols3">{DIM_KEYS.map((d) => (
            <div key={d} className="qa-row"><span className="small"><b>{tx(DIMS[d])}</b></span><label>{t("mínimo", "minimum")}<input name={`${d}_min`} inputMode="numeric" required defaultValue={P.limits[d].min} style={{ width: 70 }} /></label><label>{t("máximo", "maximum")}<input name={`${d}_max`} inputMode="numeric" required defaultValue={P.limits[d].max} style={{ width: 70 }} /></label></div>
          ))}</div>
          <label>{t("Dimensiones de carácter (una por línea)", "Character dimensions (one per line)")}<textarea name="dimensions" rows={7} required defaultValue={P.dimensions.join("\n")} /></label>
          <label id="autoridad">{t("Aprobaciones y acuerdo de rol", "Approvals and the role agreement")}
            <select name="roleAuthority" defaultValue={P.roleAuthority}>
              <option value="INFORM">{t("Solo informar: aprueba quien la política autoriza, y SOLU muestra dónde el acuerdo de rol dice otra cosa", "Inform only: whoever the policy authorises approves, and SOLU shows where the role agreement differs")}</option>
              <option value="ENFORCE">{t("Exigir las dos: para aprobar, la política debe autorizarlo y el acuerdo de rol de la persona debe nombrar esa autoridad", "Require both: to approve, the policy must authorise it and the person's role agreement must name that authority")}</option>
            </select></label>
          <div className="small" id="afectados">
            {narrowed.length === 0 ? <span className="sig ok">{P.roleAuthority === "ENFORCE" ? t("Nadie queda sin una aprobación que la política le da", "Nobody is left without an approval the policy gives them") : t("Si se exigen las dos hoy, nadie pierde una aprobación", "If both were required today, nobody would lose an approval")}</span> : (
              <><span className={`sig ${P.roleAuthority === "ENFORCE" ? "risk" : "attn"}`}>{P.roleAuthority === "ENFORCE" ? t(`${narrowed.length} persona(s) no pueden usar una aprobación que la política les da`, `${narrowed.length} person(s) cannot use an approval the policy gives them`) : t(`Si se exigen las dos hoy, ${narrowed.length} persona(s) dejarían de poder aprobar algo`, `If both were required today, ${narrowed.length} person(s) would stop being able to approve something`)}</span>
                <ul className="plain">{narrowed.map((n) => <li key={n.userId}><b>{n.name}</b> · <Link href={`/equipo/roles/${n.roleKey}`}>{n.title}</Link>: {n.domains.map((d) => AUTHORITY[d] ? tx(AUTHORITY[d]) : d).join("; ")}</li>)}</ul>
                <span className="src">{t("Para que puedan, publica una versión del acuerdo de rol que nombre esa autoridad. Para que no puedan, cambia la política que se la da.", "To let them, publish a version of the role agreement that names that authority. To stop them, change the policy that grants it.")}</span></>
            )}
            <span className="src block">{t("El acuerdo de rol nunca concede una aprobación: solo puede limitar lo que la política da. Gerencia nunca queda limitada, ni quien aún no tiene acuerdo de rol. La autoridad prestada sigue siendo de quien la prestó.", "The role agreement never grants an approval: it can only narrow what the policy gives. Management is never narrowed, nor is anyone with no role agreement yet. Lent authority remains the lender's.")}</span>
          </div>
          <label>{t("Por qué se cambia", "Why it is changed")}<input name="reason" required maxLength={300} /></label>
          <div><button type="submit" className="secondary">{t("Guardar como versión nueva", "Save as a new version")}</button></div>
        </form>
        <p className="src">{t("Las prioridades por dimensión son un rango: por debajo del mínimo SOLU lo señala; por encima del máximo no deja agregar más.", "Priorities per dimension are a range: below the minimum SOLU flags it; above the maximum it won't let you add more.")}</p>
      </section>
    </div>
  );
}
