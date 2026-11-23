import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { initials } from "@/lib/projects";
import { createTeam, setTeamActive, updateTeam } from "./actions";

// PROYECTOS Y NOTAS → Equipos guardados. Named folders of people that Gerencia creates once and adds to any project.
// An addition to roles, not a replacement: a saved team gives no authority.

export default async function SavedTeamsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  const [teams, people] = await Promise.all([
    db.projectTeam.findMany({
      where: ger ? {} : { active: true }, orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { members: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, role: true, active: true } } } }, projects: { where: { project: { kind: "PROJECT" } }, orderBy: { createdAt: "desc" }, select: { project: { select: { id: true, title: true, closedAt: true } } } } },
    }),
    ger ? db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }) : Promise.resolve([]),
  ]);
  const role = (r: string) => { const l = ROLE_LABEL[r as keyof typeof ROLE_LABEL]; return l ? t(l.es, l.en) : r; };
  const okMsg: Record<string, string> = {
    creado: t("Equipo guardado. Ya se puede agregar a cualquier proyecto.", "Team saved. It can now be added to any project."),
    guardado: t("Cambios guardados. Los proyectos que ya tenían este equipo conservan a sus personas.", "Changes saved. Projects that already had this team keep their people."),
    archivado: t("Equipo archivado: ya no se ofrece para proyectos nuevos.", "Team archived: it is no longer offered for new projects."),
    activado: t("Equipo activo otra vez.", "Team active again."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Solo Gerencia crea y cambia los equipos guardados.", "Only Management creates and changes saved teams."),
    datos: t("Faltan datos: el nombre del equipo y al menos una persona. No se guardó nada.", "Missing data: the team's name and at least one person. Nothing was saved."),
    nombre: t("Ya existe un equipo con ese nombre. Elige otro nombre.", "A team with that name already exists. Choose another name."),
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/proyectos">{t("Proyectos y notas", "Projects and notes")}</Link></div>
          <h1>{t("Equipos guardados", "Saved teams")}</h1>
          <p>{t("Un equipo guardado es un grupo de personas con nombre, listo para agregarlo a cualquier proyecto sin marcar una por una. Se suma a los roles, no los reemplaza: no da permisos ni cambia el rol de nadie.", "A saved team is a named group of people, ready to add to any project without ticking them one by one. It adds to roles, it does not replace them: it gives no permissions and changes nobody's role.")}</p>
        </div>
        <div className="grow" />
        {ger && <a className="btn" href="#nuevo">{t("+ Nuevo equipo", "+ New team")}</a>}
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {teams.length === 0 ? (
        <div className="card empty">
          <b>{t("Todavía no hay equipos guardados", "No saved teams yet")}</b>
          <p>{ger ? <a href="#nuevo">{t("Crea el primero con el formulario de abajo", "Create the first one with the form below")} →</a> : t("Gerencia los crea. Mientras tanto, en cada proyecto se invita a las personas una por una.", "Management creates them. Meanwhile, people are invited one by one in each project.")}</p>
        </div>
      ) : (
        <ul className="pj-list">
          {teams.map((tm) => (
            <li key={tm.id} id={`e-${tm.id}`} className="pj-item" data-st={tm.active ? "mine" : "open"}>
              <div className="pj-top"><span className="pj-title">{tm.name}</span><span className="sig info">{tm.members.length === 1 ? t("1 persona", "1 person") : t(`${tm.members.length} personas`, `${tm.members.length} people`)}</span>{!tm.active && <span className="sig wait">{t("Archivado", "Archived")}</span>}</div>
              {tm.description && <p className="pj-sum">{tm.description}</p>}
              <div className="pj-table">{tm.members.map((m) => <span key={m.id} className="pj-seat" title={role(m.user.role)}><i aria-hidden>{initials(m.user.name)}</i>{m.user.name}{!m.user.active ? t(" (inactiva)", " (inactive)") : ""}</span>)}</div>
              <p className="src">{t("Lo creó", "Created by")} {tm.createdByName} · {i.day(tm.createdAt)}{tm.projects.length > 0 && <> · {t("En proyectos", "In projects")}: {tm.projects.slice(0, 6).map((x, n) => <span key={x.project.id}>{n > 0 ? ", " : ""}<Link href={`/proyectos/${x.project.id}`}>{x.project.title}</Link></span>)}{tm.projects.length > 6 ? ` +${tm.projects.length - 6}` : ""}</>}</p>
              {ger && (
                <div className="pj-foot">
                  <details className="pj-edit" style={{ flex: 1, marginTop: 0 }}>
                    <summary>{t("Cambiar nombre o personas", "Change name or people")}</summary>
                    <form action={updateTeam.bind(null, tm.id)} className="pj-form">
                      <label><span className="fname">{t("Nombre del equipo", "Team name")}</span><input name="name" required maxLength={60} defaultValue={tm.name} /></label>
                      <label><span className="fname">{t("Para qué es (opcional)", "What it is for (optional)")}</span><input name="description" maxLength={200} defaultValue={tm.description ?? ""} /></label>
                      <div className="pj-people">
                        {people.map((u) => <label key={u.id} className="check"><input type="checkbox" name="people" value={u.id} defaultChecked={tm.members.some((m) => m.userId === u.id)} /> <span>{u.name}<span className="src block">{role(u.role)}</span></span></label>)}
                      </div>
                      <button type="submit">{t("Guardar el equipo", "Save the team")}</button>
                    </form>
                  </details>
                  <form action={setTeamActive.bind(null, tm.id, !tm.active)}><button type="submit" className="link small">{tm.active ? t("Archivar", "Archive") : t("Volver a activar", "Activate again")}</button></form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {ger ? (
        <section className="card" id="nuevo">
          <h2>{t("Crear un equipo", "Create a team")}</h2>
          <form action={createTeam} className="pj-form">
            <label><span className="fname">1 · {t("Nombre del equipo", "Team name")}</span><input name="name" required maxLength={60} placeholder={t("Ej.: Comité de Navidad", "E.g. Christmas committee")} /></label>
            <label><span className="fname">2 · {t("Para qué es (opcional)", "What it is for (optional)")}</span><input name="description" maxLength={200} /></label>
            <fieldset className="pj-set">
              <legend>3 · {t("Personas del equipo", "People in the team")}</legend>
              <div className="pj-people">
                {people.map((u) => <label key={u.id} className="check"><input type="checkbox" name="people" value={u.id} /> <span>{u.name}{u.id === user.id ? t(" (yo)", " (me)") : ""}<span className="src block">{role(u.role)}</span></span></label>)}
              </div>
            </fieldset>
            <button type="submit">{t("Guardar el equipo", "Save the team")}</button>
          </form>
        </section>
      ) : <p className="src">{t("Solo Gerencia crea y cambia los equipos guardados, y los agrega a los proyectos.", "Only Management creates and changes saved teams, and adds them to projects.")}</p>}
    </>
  );
}
