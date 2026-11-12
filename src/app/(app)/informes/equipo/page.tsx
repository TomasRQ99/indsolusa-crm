import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { GOAL_METRICS, METRIC_KEYS, periodOf, type PaceStatus } from "@/lib/goal-rules";
import { personReport, reportScope } from "@/lib/reports";
import { addMember, removeMember, saveTeam, setTeamActive } from "./actions";

// Módulo 13 §4.3 · team review for a leader: who needs help and where, each dimension in words. People are listed
// alphabetically: there is no ranking and no single score. Commissions of team members are not shown here.

export default async function TeamReviewPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; equipo?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const now = new Date();
  const period = periodOf(now);
  const scope = await reportScope(user);
  const admin = isGerencia(user);
  const teams = await db.team.findMany({ where: scope.all ? {} : { leaderId: user.id, active: true }, orderBy: { name: "asc" }, include: { leader: { select: { name: true } }, members: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, active: true } } } } } });
  const visible = teams.filter((x) => x.active);
  const team = visible.find((x) => x.id === sp.equipo) ?? visible[0] ?? null;
  const members = team ? team.members.filter((m) => m.user.active).sort((a, b) => a.user.name.localeCompare(b.user.name)) : [];
  const reports = await Promise.all(members.map(async (m) => ({ m, r: await personReport(m.user.id, period, now) })));
  const people = admin ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const PACE: Record<PaceStatus, { es: string; en: string; tone: string }> = {
    NO_TARGET: { es: "Sin meta", en: "No goal", tone: "wait" }, DONE: { es: "Cumplida", en: "Met", tone: "ok" }, AHEAD: { es: "Adelante", en: "Ahead", tone: "ok" }, ON_PACE: { es: "En ritmo", en: "On pace", tone: "ok" },
    CLOSE: { es: "Cerca", en: "Close", tone: "attn" }, BEHIND: { es: "Por debajo", en: "Behind", tone: "risk" }, EARLY: { es: "Empieza", en: "Starting", tone: "wait" },
  };
  const okMsg: Record<string, string> = { equipo: t("Equipo guardado.", "Team saved."), miembro: t("Equipo actualizado.", "Team updated.") };
  const errMsg: Record<string, string> = { permiso: t("Solo Gerencia arma los equipos.", "Only Management sets up teams."), equipo: t("Indica el nombre del equipo y su líder.", "Give the team a name and a leader."), miembro: t("Elige una persona activa que no sea el líder.", "Choose an active person who is not the leader.") };

  return (
    <>
      <div className="ph"><div><h1>{t("Equipo", "Team")}</h1><p>{t("Para quien lidera un equipo: quién necesita ayuda y en qué. Las personas van en orden alfabético y cada tema se dice en palabras; no hay puntaje ni ranking.", "For whoever leads a team: who needs help and with what. People are in alphabetical order and each topic is stated in words; there is no score and no ranking.")}</p>
        <p className="small"><span className="mono">{period}</span> · <span className="sig wait">{t("Provisional: el mes sigue abierto", "Provisional: the month is still open")}</span> · {t("calculado", "as of")} {i.day(now)}</p></div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {visible.length > 1 && <p className="small">{visible.map((x) => <Link key={x.id} href={`/informes/equipo?equipo=${x.id}`} className={x.id === team?.id ? "val" : ""} style={{ marginRight: 12 }}>{x.name}</Link>)}</p>}
      {!team ? <section className="card"><p className="small muted">{scope.all ? <>{t("Aún no hay equipos.", "No teams yet.")} <a href="#equipos">{t("Armar el primer equipo", "Set up the first team")} →</a></> : t("No lideras ningún equipo. Tu propio informe está en Mi desempeño.", "You don't lead a team. Your own report is in My performance.")}{scope.all ? null : <> <Link href="/informes">{t("Abrir Mi desempeño", "Open My performance")} →</Link></>}</p></section> : (
        <section className="card" id="revision">
          <b>{team.name.toUpperCase()}</b> <span className="small muted">{t("lidera", "led by")} {team.leader.name} · {t(`${members.length} personas`, `${members.length} people`)}</span>
          {reports.length === 0 ? <p className="small muted">{t("Este equipo aún no tiene personas.", "This team has no people yet.")}</p> : (
            <div className="tscroll"><table>
              <thead><tr><th>{t("Persona", "Person")}</th>{METRIC_KEYS.map((k) => <th key={k}>{t(GOAL_METRICS[k].es, GOAL_METRICS[k].en)}</th>)}<th className="n">{t("Por cobrar vencido", "Overdue")}</th><th>{t("Necesita atención", "Needs attention")}</th></tr></thead>
              <tbody>{reports.map(({ m, r }) => (
                <tr key={m.id}>
                  <td><Link href={`/informes?u=${m.user.id}`}><b>{m.user.name}</b></Link></td>
                  {METRIC_KEYS.map((k) => { const p = r.board.paces[k]; const P = PACE[p.status]; return <td key={k} className="small"><span className={`sig ${P.tone}`}>{t(P.es, P.en)}</span><span className="src block mono">{GOAL_METRICS[k].unit === "usd" ? i.n2(p.actual) : Math.round(p.actual)}{p.target != null ? ` / ${GOAL_METRICS[k].unit === "usd" ? i.n2(p.target) : Math.round(p.target)}` : ""}</span></td>; })}
                  <td className={`n mono ${r.money.overdueUsd > 0 ? "risk-t" : ""}`}>{i.n2(r.money.overdueUsd)}</td>
                  <td className="small">{[r.risks.attention.length ? t(`${r.risks.attention.length} negocio(s) grande(s) quieto(s)`, `${r.risks.attention.length} large deal(s) quiet`) : null, r.risks.noNextMove.length ? t(`${r.risks.noNextMove.length} sin próximo paso`, `${r.risks.noNextMove.length} with no next step`) : null, r.risks.decisionOverdue.length ? t(`${r.risks.decisionOverdue.length} decisión(es) vencida(s)`, `${r.risks.decisionOverdue.length} decision(s) overdue`) : null].filter(Boolean).join(" · ") || <span className="muted">{t("Nada marcado", "Nothing flagged")}</span>}{r.board.hints[0] && <span className="src block">{t(r.board.hints[0].es, r.board.hints[0].en)}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="src">{t("Cada casilla muestra lo logrado y la meta del mes. Haz clic en una persona para ver su informe completo y preparar la conversación con evidencia. Las comisiones de cada persona no se muestran aquí.", "Each cell shows what was achieved and the month's goal. Click a person to see their full report and prepare the conversation with evidence. Each person's commissions are not shown here.")}</p>
        </section>
      )}

      {admin && (
        <section className="card" id="equipos">
          <b>{t("ARMAR EQUIPOS", "SET UP TEAMS")}</b>
          <p className="small">{t("Un equipo solo sirve para que su líder vea los informes de esas personas. No da permiso para editar ni aprobar nada.", "A team only lets its leader see those people's reports. It gives no permission to edit or approve anything.")}</p>
          {teams.map((x) => (
            <div key={x.id} className="exc-item">
              <header className="exc-head"><b>{x.name}</b> <span className="small muted">{t("lidera", "led by")} {x.leader.name}</span><span className="grow" />{x.active ? <span className="sig ok">{t("Activo", "Active")}</span> : <span className="sig wait">{t("Inactivo", "Inactive")}</span>}
                <form action={setTeamActive.bind(null, x.id)} className="inline-f"><input type="hidden" name="active" value={x.active ? "0" : "1"} /><button type="submit" className="linkb">{x.active ? t("desactivar", "deactivate") : t("activar", "activate")}</button></form></header>
              <div className="small">{x.members.length === 0 ? <span className="muted">{t("Sin personas", "No people")}</span> : x.members.map((m) => <span key={m.id} style={{ marginRight: 12 }}>{m.user.name}<form action={removeMember.bind(null, m.id)} className="inline-f"><button type="submit" className="linkb">{t("quitar", "remove")}</button></form></span>)}</div>
              <form action={addMember.bind(null, x.id)} className="qa-row" style={{ maxWidth: 420, marginTop: 6 }}><select name="userId" defaultValue="" required aria-label={t("Persona", "Person")}><option value="" disabled>{t("Agregar persona…", "Add person…")}</option>{people.filter((p) => p.id !== x.leaderId && !x.members.some((m) => m.user.id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Agregar", "Add")}</button></form>
            </div>
          ))}
          <form action={saveTeam} className="qa-row" style={{ alignItems: "flex-end", marginTop: 10, flexWrap: "wrap" }}>
            <label>{t("Nombre del equipo", "Team name")}<input name="name" required maxLength={80} /></label>
            <label>{t("Líder", "Leader")}<select name="leaderId" required defaultValue=""><option value="" disabled>{t("Elegir…", "Choose…")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Crear equipo", "Create team")}</button>
          </form>
        </section>
      )}
    </>
  );
}
