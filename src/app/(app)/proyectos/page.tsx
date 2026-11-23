import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { today } from "@/lib/domain";
import { DATE_KINDS, HOW, NUDGE_ANSWERS, PRIORITIES, PROJECT_TAGS, STAGES, TEXT_MAX, healthText, initials, isSeated, myProjectWork, projectHealth, projectList, priorityOf, stageIndex, tagLabel } from "@/lib/projects";
import { answerNudge, createProject, declineInvite, deleteTemplate, joinProject } from "./actions";

// PROYECTOS Y NOTAS → Proyectos. Every project of the company, open to everyone: what it is for, who started it and
// who sits at its round table. Below, the form to start one.

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; ver?: string; tag?: string; plantilla?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  const now = today();
  const [all, people, teams, work, templates, accounts] = await Promise.all([
    projectList(user.id),
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    ger ? db.projectTeam.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, members: { select: { user: { select: { name: true } } } } } }) : Promise.resolve([]),
    myProjectWork(user.id, now),
    db.projectTemplate.findMany({ orderBy: { name: "asc" }, take: 60 }),
    db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, take: 600, select: { id: true, name: true } }),
  ]);
  const tpl = templates.find((x) => x.id === sp.plantilla) ?? null;
  const tplItems = Array.isArray(tpl?.items) ? tpl!.items.length : 0;
  const hasWork = work.dates.length + work.items.length + work.asks.length + work.mentions.length + work.ledTrouble.length > 0;
  const when = (d: Date) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);
  const invites = all.filter((p) => p.my?.how === "INVITED" && !p.closedAt);
  const open = all.filter((p) => !p.closedAt), closed = all.filter((p) => p.closedAt);
  const mine = open.filter((p) => isSeated(p.my));
  const view = sp.ver === "mios" ? "mios" : sp.ver === "cerrados" ? "cerrados" : "todos";
  const inView = view === "mios" ? mine : view === "cerrados" ? closed : open;
  // Tags in use in this view, most used first; choosing one narrows the list.
  const tagCount = new Map<string, number>();
  for (const p of inView) for (const k of p.tags) tagCount.set(k, (tagCount.get(k) ?? 0) + 1);
  const tagsUsed = [...tagCount.entries()].sort((a, b) => b[1] - a[1] || tagLabel(a[0], i.es).localeCompare(tagLabel(b[0], i.es)));
  const tag = sp.tag && tagCount.has(sp.tag) ? sp.tag : null;
  const rows = tag ? inView.filter((p) => p.tags.includes(tag)) : inView;
  const viewQs = view === "todos" ? "" : `ver=${view}`;
  const tagHref = (k: string | null) => `/proyectos${[viewQs, k ? `tag=${encodeURIComponent(k)}` : ""].filter(Boolean).length ? "?" + [viewQs, k ? `tag=${encodeURIComponent(k)}` : ""].filter(Boolean).join("&") : ""}`;
  const stageName = (k: string) => { const s = STAGES[stageIndex(k)]; return t(s.es, s.en); };
  const role = (r: string) => { const l = ROLE_LABEL[r as keyof typeof ROLE_LABEL]; return l ? t(l.es, l.en) : r; };
  const okMsg: Record<string, string> = {
    "plantilla-borrada": t("Plantilla eliminada. Los proyectos que nacieron de ella no cambian.", "Template deleted. Projects that started from it do not change."),
    "ahora-no": t("Listo: no entraste a ese proyecto. Sigue visible en la lista y puedes unirte cuando quieras.", "Done: you did not join that project. It stays in the list and you can join whenever you want."),
  };
  const errMsg: Record<string, string> = {
    datos: t("Faltan datos: el nombre, la descripción corta y el objetivo. No se guardó nada.", "Missing data: the name, the short description and the objective. Nothing was saved."),
    fechas: t("Las fechas de la línea de tiempo no están en orden: cada etapa debe terminar después de la anterior. No se guardó nada.", "The timeline dates are not in order: each stage must end after the one before. Nothing was saved."),
    necesidad: t("No existe una Necesidad con ese código. Revísalo (por ejemplo J-2611-0147) o deja la casilla vacía. No se guardó nada.", "No Need has that code. Check it (for example J-2611-0147) or leave the box empty. Nothing was saved."),
    permiso: t("Eso lo hace Gerencia.", "That is done by Management."),
    persona: t("La persona elegida como responsable ya no está activa. No se guardó nada.", "The person chosen as lead is no longer active. Nothing was saved."),
  };

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Proyectos y notas", "Projects and notes")}</h1>
          <p>{t("Lo que el equipo quiere sacar adelante, a la vista de todos: para qué es, quién lo inició y quién está en la mesa redonda. Cualquiera puede unirse y participar, sin pedir permiso.", "What the team wants to get done, in everyone's view: what it is for, who started it and who sits at the round table. Anyone can join and take part, without asking permission.")}</p>
        </div>
        <div className="grow" />
        <a className="btn" href="#nuevo">{t("+ Nuevo proyecto", "+ New project")}</a>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {hasWork && (
        <section className="card" id="mi-trabajo" data-zone="act">
          <h2>{t("Mi trabajo en los proyectos", "My work in projects")}</h2>
          <div className="pj-work">
            {work.asks.length > 0 && (
              <div>
                <h3 className="ie-h">{t("Te piden el avance", "You are asked for progress")} <span className="sig attn">{work.asks.length}</span></h3>
                <ul className="pj-dl">{work.asks.map((n) => (
                  <li key={n.id}>
                    <div className="pj-dh"><b>{n.item?.title ?? n.date?.title}</b></div>
                    <span className="src">{n.fromName} · <Link href={`/proyectos/${n.project.id}`}>{n.project.title}</Link></span>
                    <form action={answerNudge.bind(null, n.id)} className="pj-ans"><span className="row">{Object.entries(NUDGE_ANSWERS).map(([k, v]) => <button key={k} type="submit" name="answer" value={k} className={k === "ON_TRACK" ? "sm" : "secondary sm"}>{t(v.es, v.en)}</button>)}</span></form>
                  </li>))}
                </ul>
              </div>
            )}
            {work.mentions.length > 0 && (
              <div>
                <h3 className="ie-h">{t("Te mencionaron", "You were mentioned")} <span className="sig attn">{work.mentions.length}</span></h3>
                <ul className="pj-dl">{work.mentions.map((m) => <li key={m.id}><Link href={`/proyectos/${m.projectId}#c-${m.postId}`}>{m.post.body.slice(0, 110)}{m.post.body.length > 110 ? "…" : ""}</Link><span className="src">{m.byName} · {m.post.project.title}</span></li>)}</ul>
              </div>
            )}
            {work.dates.length > 0 && (
              <div>
                <h3 className="ie-h">{t("Mis próximas fechas (14 días)", "My next dates (14 days)")}</h3>
                <ul className="pj-dl">{work.dates.slice(0, 8).map((d) => <li key={d.id}><div className="pj-dh"><span className={`sig ${d.day < now ? "attn" : "info"}`}>{d.day < now ? t("Ya pasó", "Past") : t(DATE_KINDS[d.kind]?.es ?? d.kind, DATE_KINDS[d.kind]?.en ?? d.kind)}</span><Link href={`/proyectos/${d.project.id}#fechas`}><b>{d.title}</b></Link></div><span className="src">{i.day(d.day)}{d.time ? ` · ${d.time}` : ""} · {d.project.title}</span></li>)}</ul>
              </div>
            )}
            {work.items.length > 0 && (
              <div>
                <h3 className="ie-h">{t("Mis tareas abiertas", "My open tasks")}</h3>
                <ul className="pj-dl">{work.items.slice(0, 8).map((x) => <li key={x.id}><div className="pj-dh">{x.dueOn && x.dueOn < now && <span className="sig attn">{t("Atrasada", "Overdue")}</span>}<Link href={`/proyectos/${x.project.id}#tareas`}><b>{x.title}</b></Link></div><span className="src">{x.dueOn ? `${t("para el", "by")} ${i.day(x.dueOn)} · ` : ""}{x.project.title}</span></li>)}</ul>
              </div>
            )}
            {work.ledTrouble.length > 0 && (
              <div>
                <h3 className="ie-h">{t("Proyectos que llevo y piden atención", "Projects I lead that need attention")}</h3>
                <ul className="pj-dl">{work.ledTrouble.map(({ p, h }) => <li key={p.id}><div className="pj-dh"><span className={`sig ${h.tone}`}>{healthText(h, t)}</span><Link href={`/proyectos/${p.id}#reloj`}><b>{p.title}</b></Link></div></li>)}</ul>
              </div>
            )}
          </div>
          <p className="src">{t("Las alarmas que tú pusiste están en MI DÍA → Pendientes. ", "The alarms you set are in MY DAY → To-dos. ")}<Link href="/profile#avisos-proyectos">{t("Elegir mis avisos de proyectos", "Choose my project notices")}</Link></p>
        </section>
      )}

      {invites.length > 0 && (
        <section className="card" id="invitaciones">
          <h2>{t("Te invitaron", "You were invited")} <span className="sig attn">{invites.length}</span></h2>
          <ol className="pd-list">
            {invites.map((p, n) => (
              <li key={p.id} className="pd-row">
                <span className="pd-n" aria-hidden>{n + 1}</span>
                <span className="pd-t"><b><Link href={`/proyectos/${p.id}`}>{p.title}</Link></b><span className="pd-d">{p.summary}</span><span className="src">{t("Te invitó", "Invited by")} {p.createdBy.name} · {p.code}</span></span>
                <span className="row" style={{ gap: 6 }}>
                  <form action={joinProject.bind(null, p.id)}><button type="submit">{t("Unirme", "Join")}</button></form>
                  <form action={declineInvite.bind(null, p.id)}><button type="submit" className="secondary">{t("Ahora no", "Not now")}</button></form>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="tab-groups pj-filter">
        <Link href="/proyectos" className={view === "todos" ? "on" : undefined}>{t("Todos los abiertos", "All open")} · {open.length}</Link>
        <Link href="/proyectos?ver=mios" className={view === "mios" ? "on" : undefined}>{t("En los que estoy", "The ones I am in")} · {mine.length}</Link>
        <Link href="/proyectos?ver=cerrados" className={view === "cerrados" ? "on" : undefined}>{t("Cerrados", "Closed")} · {closed.length}</Link>
      </div>

      {tagsUsed.length > 0 && (
        <div className="pj-tags filter" aria-label={t("Filtrar por etiqueta", "Filter by tag")}>
          <span className="src">{t("Etiquetas", "Tags")}:</span>
          <Link href={tagHref(null)} className={tag ? undefined : "on"}>{t("Todas", "All")}</Link>
          {tagsUsed.map(([k, n]) => <Link key={k} href={tagHref(k)} className={tag === k ? "on" : undefined}>{tagLabel(k, i.es)} · {n}</Link>)}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card empty">
          <b>{view === "mios" ? t("Aún no estás en ningún proyecto", "You are not in any project yet") : view === "cerrados" ? t("Ningún proyecto se ha cerrado todavía", "No project has been closed yet") : t("Todavía no hay proyectos", "No projects yet")}</b>
          <p>{view === "mios" ? <>{t("Abre uno de ", "Open one from ")}<Link href="/proyectos">{t("Todos los abiertos", "All open")}</Link>{t(" y haz clic en «Unirme», o ", " and click “Join”, or ")}<a href="#nuevo">{t("crea el tuyo", "create your own")}</a>.</> : view === "cerrados" ? <Link href="/proyectos">{t("Ver los abiertos", "See the open ones")} →</Link> : <a href="#nuevo">{t("Crea el primero con el formulario de abajo", "Create the first one with the form below")} →</a>}</p>
        </div>
      ) : (
        <ul className="pj-list">
          {rows.map((p) => {
            const seated = p.members.filter(isSeated), invited = p.members.length - seated.length;
            const next = p.dates[0];
            return (
              <li key={p.id} className="pj-item" data-st={p.closedAt ? "closed" : isSeated(p.my) ? "mine" : "open"}>
                <div className="pj-top">
                  <Link href={`/proyectos/${p.id}`} className="pj-title">{p.title}</Link>
                  {!p.closedAt && <span className={`sig ${priorityOf(p.priority).tone}`}>{t(priorityOf(p.priority).es, priorityOf(p.priority).en)}</span>}
                  <span className={`sig ${p.closedAt ? "ok" : "info"}`}>{p.closedAt ? t("Cerrado", "Closed") : `${stageIndex(p.stage) + 1}/4 · ${stageName(p.stage)}`}</span>
                  {!p.closedAt && (() => { const h = projectHealth(p, now); return <span className={`sig ${h.tone}`}>{healthText(h, t)}</span>; })()}
                  {p.extensions.length > 0 && <span className="sig attn">{t("Extensión esperando a Gerencia", "Extension waiting for Management")}</span>}
                  {p.fresh > 0 && <span className="sig attn">{p.fresh === 1 ? t("1 comentario nuevo", "1 new comment") : t(`${p.fresh} comentarios nuevos`, `${p.fresh} new comments`)}</span>}
                </div>
                <p className="pj-sum">{p.summary}</p>
                {p.tags.length > 0 && <div className="pj-tags">{p.tags.map((k) => <Link key={k} href={tagHref(k)}>{tagLabel(k, i.es)}</Link>)}</div>}
                <p className="src">{t("Lo inició", "Started by")} <b>{p.createdBy.name}</b>{p.lead.id !== p.createdBy.id && <> · {t("responsable", "lead")} <b>{p.lead.name}</b></>} · {i.day(p.createdAt)} · {p.code}{p.account && <> · {t("Cliente", "Customer")}: <Link href={`/accounts/${p.account.id}`}>{p.account.name}</Link></>}{p.deal?.code && <> · {t("Necesidad", "Need")}: <Link href={`/deals/${p.deal.id}`}>{p.deal.code}</Link></>}</p>
                <div className="pj-foot">
                  <span className="pj-table" title={t("Mesa redonda", "Round table")}>
                    <span className="src">{t("Mesa redonda", "Round table")}:</span>
                    {seated.map((m) => <span key={m.userId} className="pj-seat" title={`${m.user.name} · ${t(HOW[m.how]?.es ?? m.how, HOW[m.how]?.en ?? m.how)}`}><i aria-hidden>{initials(m.user.name)}</i>{m.user.name.split(" ")[0]}</span>)}
                    {p.teams.map((x) => <span key={x.team.id} className="pj-team" title={t("Equipo guardado", "Saved team")}>{x.team.name}</span>)}
                    {invited > 0 && <span className="src">+ {invited === 1 ? t("1 invitado", "1 invited") : t(`${invited} invitados`, `${invited} invited`)}</span>}
                  </span>
                  <span className="grow" />
                  <span className="src">{p._count.posts === 1 ? t("1 comentario", "1 comment") : t(`${p._count.posts} comentarios`, `${p._count.posts} comments`)}{p.items.length > 0 && <> · {p.items.length === 1 ? t("1 tarea abierta", "1 open task") : t(`${p.items.length} tareas abiertas`, `${p.items.length} open tasks`)}</>}{next && <> · {t("próxima fecha", "next date")}: {i.day(next.day)}{next.time ? ` ${next.time}` : ""}</>}</span>
                  {isSeated(p.my)
                    ? <Link className="btn secondary sm" href={`/proyectos/${p.id}`}>{t("Abrir", "Open")} →</Link>
                    : <form action={joinProject.bind(null, p.id)}><button type="submit" className="sm">{t("Unirme", "Join")}</button></form>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="card" id="nuevo">
        <h2>{t("Crear un proyecto", "Create a project")}</h2>
        <p className="src">{t("Si es solo algo que quieres recordar, no hace falta un proyecto: ", "If it is just something you want to remember, you do not need a project: ")}<Link href="/proyectos/notas#nueva">{t("escribe una nota", "write a note")} →</Link></p>
        {templates.length > 0 && (
          <div className="pj-tpl" id="plantillas">
            <span className="src">{t("Empezar desde una plantilla:", "Start from a template:")}</span>
            <div className="pj-tags filter">
              <Link href="/proyectos#nuevo" className={tpl ? undefined : "on"}>{t("En blanco", "Blank")}</Link>
              {templates.map((x) => <Link key={x.id} href={`/proyectos?plantilla=${x.id}#nuevo`} className={tpl?.id === x.id ? "on" : undefined}>{x.name}</Link>)}
            </div>
            {tpl && <p className="note okn">{t(`Plantilla «${tpl.name}»: ya llenó la descripción, el objetivo, las etiquetas y la prioridad${tplItems ? `, y creará ${tplItems} tarea(s) por etapa` : ""}. Escribe el nombre y ajusta lo que quieras.`, `Template “${tpl.name}”: it filled in the description, objective, tags and priority${tplItems ? `, and will create ${tplItems} task(s) by stage` : ""}. Type the name and adjust anything.`)}{ger && <> <form action={deleteTemplate.bind(null, tpl.id)} data-confirm={t("¿Eliminar esta plantilla?", "Delete this template?")} style={{ display: "inline" }}><button type="submit" className="link small">{t("Eliminar plantilla", "Delete template")}</button></form></>}</p>}
          </div>
        )}
        <form action={createProject} className="pj-form" key={tpl?.id ?? "blank"}>
          {tpl && <input type="hidden" name="templateId" value={tpl.id} />}
          <label><span className="fname">1 · {t("Nombre del proyecto", "Project name")}</span>
            <input name="title" required maxLength={TEXT_MAX.title} placeholder={t("Ej.: Catálogo de repuestos para el sector lácteo", "E.g. Spare parts catalogue for the dairy sector")} />
          </label>
          <label><span className="fname">2 · {t("Descripción corta", "Short description")}</span>
            <input name="summary" required maxLength={TEXT_MAX.summary} defaultValue={tpl?.summary ?? ""} placeholder={t("Una o dos frases: es lo que todos leen en la lista", "One or two sentences: it is what everyone reads in the list")} />
          </label>
          <label><span className="fname">3 · {t("Objetivo", "Objective")}</span>
            <textarea name="objective" required rows={3} maxLength={TEXT_MAX.objective} defaultValue={tpl?.objective ?? ""} placeholder={t("Qué quieres lograr y cómo se sabrá que se logró", "What you want to achieve and how we will know it was achieved")} />
          </label>

          <label><span className="fname">4 · {t("Prioridad", "Priority")}</span>
            <select name="priority" defaultValue={tpl?.priority ?? "MEDIA"}>{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select>
            <span className="src">{t("La lista se ordena por prioridad: primero lo que hay que escoger y ejecutar antes.", "The list is ordered by priority: what must be chosen and done first comes first.")}</span>
          </label>

          <fieldset className="pj-set">
            <legend>5 · {t("Etiquetas (opcional)", "Tags (optional)")}</legend>
            <p className="src">{t("De qué trata el proyecto. Se ven en la lista y sirven para filtrarla.", "What the project is about. They show in the list and filter it.")}</p>
            <div className="pj-tags pick">
              {Object.keys(PROJECT_TAGS).map((k) => <label key={k}><input type="checkbox" name="tags" value={k} defaultChecked={!!tpl?.tags.includes(k)} /> {tagLabel(k, i.es)}</label>)}
            </div>
            <label>{t("Otra etiqueta (opcional, separa con comas)", "Another tag (optional, separate with commas)")}<input name="ownTags" maxLength={80} defaultValue={(tpl?.tags ?? []).filter((k) => !(k in PROJECT_TAGS)).join(", ")} /></label>
          </fieldset>

          <fieldset className="pj-set">
            <legend>{t("¿Es sobre un cliente o una Necesidad? (opcional)", "Is it about a customer or a Need? (optional)")}</legend>
            <div className="pj-dates two">
              <label>{t("Cliente", "Customer")}<select name="accountId" defaultValue=""><option value="">{t("Ninguno", "None")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>{t("Código de la Necesidad", "Need code")}<input name="dealCode" maxLength={40} placeholder="J-2611-0147" /></label>
            </div>
            <span className="src">{t("El proyecto queda enlazado a su ficha. SOLU nunca le escribe al cliente desde un proyecto: contactarlo es decisión tuya, y lo que diga lo anotas en el foro.", "The project is linked to their record. SOLU never writes to the customer from a project: contacting them is your decision, and you note what they say in the forum.")}</span>
          </fieldset>

          <fieldset className="pj-set">
            <legend>6 · {t("Línea de tiempo deseada (opcional)", "Desired timeline (optional)")}</legend>
            <p className="src">{t("¿Para cuándo quieres terminar cada etapa? Si apenas está empezando, deja las fechas vacías: el proyecto queda abierto y las pones después.", "By when do you want each stage finished? If it is just starting, leave the dates empty: the project stays open and you set them later.")}</p>
            <div className="pj-dates">
              <label>{t("Empieza", "Starts")}<input type="date" name="startOn" /></label>
              {STAGES.map((s) => <label key={s.key}>{t(s.es, s.en)}<input type="date" name={s.field} /></label>)}
            </div>
          </fieldset>

          {ger && (
            <label><span className="fname">7 · {t("¿Para quién es el proyecto?", "Who is the project for?")}</span>
              <select name="leadId" defaultValue={user.id}>{people.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === user.id ? t(" (yo)", " (me)") : ""} · {role(u.role)}</option>)}</select>
              <span className="src">{t("Esa persona queda como responsable. Solo Gerencia ve esta casilla.", "That person becomes the lead. Only Management sees this box.")}</span>
            </label>
          )}

          {ger && (
            <fieldset className="pj-set">
              <legend>8 · {t("Equipos guardados (opcional)", "Saved teams (optional)")}</legend>
              <p className="src">{t("Al marcar un equipo, todas sus personas quedan asignadas a la mesa redonda. ", "Ticking a team assigns all its people to the round table. ")}<Link href="/proyectos/equipos">{t("Crear o cambiar equipos", "Create or change teams")} →</Link></p>
              {teams.length === 0 ? <span className="src">{t("Aún no hay equipos guardados.", "No saved teams yet.")}</span> : (
                <div className="pj-people">
                  {teams.map((tm) => <label key={tm.id} className="check"><input type="checkbox" name="teams" value={tm.id} /> <span>{tm.name}<span className="src block">{tm.members.map((m) => m.user.name.split(" ")[0]).join(", ")}</span></span></label>)}
                </div>
              )}
            </fieldset>
          )}

          <fieldset className="pj-set">
            <legend>{ger ? 9 : 7} · {ger ? t("Personas asignadas a la mesa redonda (opcional)", "People assigned to the round table (optional)") : t("Personas con las que quieres trabajar (opcional)", "People you want to work with (optional)")}</legend>
            <p className="src">{ger ? t("Quedan en la mesa redonda de una vez y SOLU les avisa en la campana.", "They sit at the round table right away and SOLU tells them through the bell.") : t("SOLU las invita: cada una decide si entra. Además, cualquiera puede unirse después sin pedir permiso.", "SOLU invites them: each one decides whether to join. Besides, anyone can join later without asking.")}</p>
            <div className="pj-people">
              {people.filter((u) => ger || u.id !== user.id).map((u) => <label key={u.id} className="check"><input type="checkbox" name="people" value={u.id} /> <span>{u.name}{u.id === user.id ? t(" (yo)", " (me)") : ""}<span className="src block">{role(u.role)}</span></span></label>)}
            </div>
          </fieldset>
          <button type="submit">{t("Crear proyecto", "Create project")}</button>
        </form>
      </section>
    </>
  );
}
