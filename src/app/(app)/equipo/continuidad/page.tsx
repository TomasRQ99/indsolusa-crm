import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { FUNCTIONS, type FunctionKey } from "@/lib/gerencia-rules";
import { BACKUP_KINDS } from "@/lib/team-rules";
import { reportIdsOf, workPeople } from "@/lib/team-store";
import { continuityView } from "@/lib/team-views";
import { Notes, tOf } from "../ui";
import { endRoleBackup, setRoleBackup } from "../role-actions";

// Módulo 16 §7–8 · Continuity and succession. Each role with who holds it and who stands behind it. A replacement is
// fit when four things hold: capability, authority, access and availability, each shown with its reason. A role
// with nobody qualified behind it says so, as a continuity risk. No absence should leave a responsibility absent.

export default async function ContinuityPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const manage = canManageAll(user);
  const [v, people, reports] = await Promise.all([continuityView(), workPeople(), reportIdsOf(user.id)]);
  // A leader sees and arranges the roles their people hold; Gerencia and Dirección, all of them.
  const roles = manage ? v.roles : v.roles.filter((r) => r.holders.some((h) => reports.includes(h.id) || h.id === user.id));
  const absences = manage ? v.absences : v.absences.filter((a) => reports.includes(a.userId) || a.userId === user.id);
  const mayEdit = (r: (typeof roles)[number]) => manage || r.holders.some((h) => reports.includes(h.id));
  const PARTS = [["capability", t("Capacidad", "Capability")], ["authority", t("Autoridad", "Authority")], ["access", t("Acceso", "Access")], ["availability", t("Disponibilidad", "Availability")]] as const;
  const ok = { respaldo: t("Guardado.", "Saved."), "respaldo-fin": t("Listo: ya no figura como respaldo.", "Done: no longer listed as backup.") };
  const err = {
    permiso: t("La sucesión de un rol la organizan Gerencia, Dirección o el líder de quien lo tiene.", "Succession for a role is arranged by Management, Direction or the leader of whoever holds it."),
    respaldo: t("Elige a la persona y si es respaldo o sucesor.", "Choose the person and whether they are a backup or a successor."),
    mismo: t("El respaldo debe ser otra persona, no quien ya ocupa ese puesto.", "The backup must be someone else, not whoever already holds that seat."),
    repetido: t("Esa persona ya figura así para ese rol.", "That person is already listed that way for that role."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Continuidad y sucesión", "Continuity and succession")}</h1>
        <p>{t("Quién tiene cada rol, quién puede entrar si falta y a quién se está preparando. Ninguna ausencia debería producir una ausencia de responsabilidad.", "Who holds each role, who can step in if they are away and who is being prepared. No absence should leave a responsibility absent.")}</p>
        <p className="small">{t("calculado", "as of")} {i.date(v.asOf)}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />

      <section className="card" id="ausencias"><b>{t("AUSENCIAS EN LOS PRÓXIMOS 30 DÍAS", "ABSENCES IN THE NEXT 30 DAYS")}</b> <span className="small muted">{t("aprobadas; el motivo no se muestra aquí", "approved; the reason is not shown here")}</span>
        {absences.length === 0 ? <p className="small"><span className="sig ok">{t("Ninguna ausencia aprobada", "No approved absence")}</span></p> : (
          <ul className="plain">{absences.map((a) => (
            <li key={a.id}><b>{a.name}</b> · {i.day(a.startsOn)} – {i.date(a.endsOn)}{a.now ? <span className="sig wait" style={{ marginLeft: 6 }}>{t("ausente hoy", "away today")}</span> : null}{a.unplanned ? <span className="sig attn" style={{ marginLeft: 6 }}>{t("sin aviso previo", "unplanned")}</span> : null}
              {a.coveredBy ? <> · {t("cubre", "covered by")} <Link href={`/comercial/cobertura/${a.coverId}`}>{a.coveredBy}</Link></> : <> · <span className="sig risk">{t("nadie cubre", "nobody covers")}</span> {a.unplanned ? <Link className="small" href={`/comercial/cobertura?scan=${a.userId}#escaneo`}>{t("ver qué no puede esperar y asignar cobertura de emergencia", "see what can't wait and assign emergency coverage")}</Link> : <Link className="small" href="/comercial/cobertura">{t("preparar la entrega de responsabilidades", "prepare the responsibility handover")}</Link>}</>}</li>
          ))}</ul>
        )}
        <p className="src">{t("La cobertura (quién actúa, por cuánto tiempo, la entrega de turno y el regreso) se maneja en Comercial → Cobertura. La autoridad prestada, en Administración → Autoridad prestada. Ambas vencen solas.", "Coverage (who acts, for how long, the handover and the return) is handled in Commercial → Coverage. Lent authority, in Administration → Delegated authority. Both expire by themselves.")} <Link href="/comercial/cobertura">{t("Cobertura", "Coverage")}</Link> · <Link href="/administracion/autoridad">{t("Autoridad prestada", "Delegated authority")}</Link></p>
      </section>

      {v.noRoles ? <div className="note attn">{t("Aún no hay acuerdos de rol publicados: la sucesión se organiza sobre ellos.", "No role agreements published yet: succession is arranged on them.")} <Link href="/equipo/roles">{t("Acuerdos de rol", "Role agreements")}</Link></div> : roles.length === 0 ? <div className="note">{t("Aquí ves los roles de las personas que acompañas.", "Here you see the roles of the people you accompany.")}</div> : null}

      {roles.filter((r) => r.risk).length > 0 && <div className="note risk" id="riesgos"><span><b>{t("Riesgo de continuidad:", "Continuity risk:")}</b> {t("roles críticos o con una sola persona, sin un respaldo calificado", "critical or single-holder roles with no qualified backup")}: {roles.filter((r) => r.risk).map((r) => <a key={r.roleKey} href={`#r-${r.roleKey}`} style={{ marginRight: 10 }}>{r.title}</a>)}</span></div>}

      {roles.map((r) => (
        <section className="card" key={r.roleKey} id={`r-${r.roleKey}`}>
          <div><b style={{ fontSize: 15 }}><Link href={`/equipo/roles/${r.roleKey}`}>{r.title}</Link></b> <span className="small muted">· {r.functionKey in FUNCTIONS ? tx(FUNCTIONS[r.functionKey as FunctionKey]) : r.functionKey}</span>{r.critical ? <span className="sig info" style={{ marginLeft: 6 }}>{t("crítico", "critical")}</span> : null}
            {r.risk ? <span className="sig risk" style={{ marginLeft: 6 }}>{t("sin respaldo calificado", "no qualified backup")}</span> : r.qualified ? <span className="sig ok" style={{ marginLeft: 6 }}>{t(`${r.qualified} respaldo(s) calificado(s)`, `${r.qualified} qualified backup(s)`)}</span> : null}</div>
          <p className="small"><b>{t("Lo tiene", "Held by")}:</b> {r.holders.length ? r.holders.map((h) => `${h.name}${h.level ? ` (${h.level})` : ""}`).join(", ") : <span className="sig attn">{t("nadie", "nobody")}</span>}{r.holders.length === 1 ? <span className="src"> · {t("una sola persona: si falta, el rol se detiene", "a single person: if away, the role stops")}</span> : null}</p>
          {r.backups.length === 0 ? <p className="small muted">{t("Nadie nombrado como respaldo ni como sucesor.", "Nobody named as backup or successor.")}</p> : r.backups.map((b) => (
            <div key={b.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <div className="qa-row"><b>{b.backupUser.name}</b><span className="sig wait">{b.kind === "SUCCESSOR" ? t("sucesor", "successor") : t("respaldo", "backup")}</span>{b.holderId ? <span className="src">{t("de", "for")} {people.find((p) => p.id === b.holderId)?.name ?? "—"}</span> : null}
                <span className={`sig ${b.suit.qualified ? "ok" : "attn"}`}>{b.suit.qualified ? t("calificado hoy", "qualified today") : t("aún no calificado", "not qualified yet")}</span><span className="grow" />
                {mayEdit(r) && <form action={endRoleBackup.bind(null, b.id)}><button type="submit" className="secondary sm" data-confirm={t("¿Quitarlo de este rol?", "Remove from this role?")}>{t("Quitar", "Remove")}</button></form>}</div>
              <div className="eq-suit">{PARTS.map(([k, label]) => <div key={k} className={b.suit[k].ok ? "" : "no"}><b>{b.suit[k].ok ? "✓" : "✕"} {label}</b><br />{tx(b.suit[k].why)}</div>)}</div>
              {b.capabilityNote ? <p className="src">{t("Capacidad", "Capability")}: {b.capabilityNote} · {b.setByName}</p> : null}{b.note ? <p className="src">{b.note}</p> : null}
            </div>
          ))}
          {mayEdit(r) && (
            <details open={false}><summary className="small">{t("Nombrar un respaldo o un sucesor", "Name a backup or a successor")}</summary>
              <form action={setRoleBackup} className="qa-form">
                <input type="hidden" name="roleKey" value={r.roleKey} />
                <div className="qa-row">
                  <label>{t("Persona", "Person")}<select name="backupUserId" required defaultValue=""><option value="" disabled>—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label>{t("Como", "As")}<select name="kind">{Object.entries(BACKUP_KINDS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                  {r.holders.length > 1 && <label>{t("De quién (opcional)", "For whom (optional)")}<select name="holderId" defaultValue=""><option value="">{t("Del rol en general", "The role as a whole")}</option>{r.holders.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>}
                  {r.holders.length === 1 && <input type="hidden" name="holderId" value={r.holders[0].id} />}
                </div>
                <label>{t("Qué muestra que puede hacer el rol (deja vacío si aún no lo sabes)", "What shows they can do the role (leave empty if not known yet)")}<input name="capabilityNote" maxLength={500} /></label>
                <label>{t("Nota (opcional)", "Note (optional)")}<input name="note" maxLength={300} /></label>
                <div><button type="submit" className="secondary sm">{t("Guardar", "Save")}</button></div>
              </form>
            </details>
          )}
        </section>
      ))}
      <p className="src">{t("«Calificado» se calcula con los hechos de hoy: capacidad (mismo rol, evaluación de «listo ahora» o confirmación de quien lo nombra), autoridad (la que el acuerdo pide frente a las políticas y a la autoridad prestada vigente), acceso (cuenta activa y rol de acceso) y disponibilidad (sin ausencia aprobada hoy y sin cubrir ya a dos personas). Son cuatro respuestas, no un puntaje.", "“Qualified” is computed from today's facts: capability (same role, a “ready now” assessment or confirmation by whoever names them), authority (what the agreement asks against policies and lent authority in force), access (active account and access role) and availability (no approved absence today and not already covering two people). Four answers, not a score.")}</p>
    </div>
  );
}
