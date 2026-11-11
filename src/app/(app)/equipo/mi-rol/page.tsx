import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { GAP_KINDS } from "@/lib/admin-rules";
import { FUNCTIONS, asPairs, asStrings } from "@/lib/gerencia-rules";
import { GOAL_METRICS, METRIC_KEYS } from "@/lib/goal-rules";
import { AUTHORITY, COMMITMENT_KINDS, COMPETENCY_KINDS, DECISION_KINDS, DIMS, DIM_KEYS, GAP_RESULTS, PERFORMANCE_KINDS, READINESS, RHYTHM_KINDS, anyRelation } from "@/lib/team-rules";
import { viewablePeople } from "@/lib/team-store";
import { myRoleView } from "@/lib/team-views";
import { Lines, NoAccess, Notes, PersonSwitch, PrivacyTag, qp, tOf } from "../ui";
import { raiseRoleSupport, reviewExpectations, saveGapReview } from "../role-actions";

// Módulo 16 §17, §23 · MI ROL. Six blocks, in this order: our company, my function, my role, how I am expected to
// do it, how I know I am doing well, how I can grow. And the line that joins the company's purpose with what I do
// today. The agreement shows its version and the date it is in force from; goals and the development plan are read
// from where they live, never copied.

export default async function MyRolePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; p?: string; a?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const personId = sp.p || user.id;
  const [v, people] = await Promise.all([myRoleView(user, personId, sp.a), viewablePeople(user)]);
  if (!v) notFound();
  if (!anyRelation(v.rel)) return <NoAccess i={i} back="/equipo/mi-rol" />;
  const self = v.rel.self, guide = v.rel.leader || v.rel.gerencia;
  const T = today();
  const p = v.profile, a = v.assignment;
  const back = `/equipo/mi-rol${qp(personId, user.id)}`;
  const fn = v.functionKey ? FUNCTIONS[v.functionKey] : null;
  const charter = v.charter;
  const idn = v.identity;
  const principles = idn ? asPairs(idn.principles, "name", "meaning") : [];
  const methods = idn ? asPairs(idn.methodologies, "name", "description") : [];
  const owners = guide || self ? await db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const mayAssign = isGerencia(user);
  const stale = !!v.profileRow && v.reviewedVersion !== v.profileRow.version;
  const kinded = (rows: { kind: string; text: string }[], kinds: Record<string, { es: string; en: string }>) => Object.keys(kinds).map((k) => ({ k, rows: rows.filter((r) => r.kind === k) })).filter((g) => g.rows.length);
  const ok = {
    revisado: t("Quedó registrado que las expectativas de este acuerdo fueron revisadas.", "It is on record that the expectations of this agreement were reviewed."),
    soporte: t("Registrado. Tiene responsable y próximo paso; también aparece en Administración → Personas.", "Recorded. It has an owner and a next step; it also shows in Administration → People."),
    brecha: t("Guardado. El resultado anterior de esa dimensión queda en la historia.", "Saved. The earlier result for that dimension stays in the history."),
    "brecha-sin-evidencia": t("Guardado como «sin evidencia suficiente»: un resultado necesita la evidencia que lo sostiene.", "Saved as “not enough evidence”: a result needs the evidence behind it."),
  };
  const err = {
    permiso: t("No tienes permiso para esto.", "You don't have permission for this."),
    soporte: t("Faltan datos: qué expectativa no se puede cumplir, qué falta, quién lo resuelve y el próximo paso. No se guardó nada.", "Missing data: which expectation can't be met, what is missing, who resolves it and the next step. Nothing was saved."),
    "brecha-permiso": t("El análisis de brechas lo escribe quien acompaña a la persona (su líder) o Gerencia, y la persona siempre lo ve.", "The gap analysis is written by whoever accompanies the person (their leader) or Management, and the person always sees it."),
    brecha: t("Elige la dimensión del acuerdo. No se guardó nada.", "Choose the dimension of the agreement. Nothing was saved."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{self ? t("Mi rol", "My role") : t(`Rol de ${v.person.name}`, `${v.person.name}'s role`)}</h1>
        <p>{t("Qué espera la compañía de este rol, qué puede esperar el rol de la compañía, y cómo se conecta el trabajo de cada día con el propósito.", "What the company expects of this role, what the role can expect of the company, and how each day's work connects with the purpose.")}</p>
      </div><span className="grow" /><PersonSwitch people={people} current={personId} me={user.id} path="/equipo/mi-rol" i={i} /></div>
      <Notes sp={sp} ok={ok} err={err} />

      {!p && (
        <div className="note attn" id="sin-acuerdo">
          <span><b>{t("Brecha de claridad de rol.", "Role clarity gap.")}</b> {self ? t("Todavía no tienes un acuerdo de rol vigente. Mientras tanto puedes leer el propósito de la compañía y de tu función; lo que se espera de tu rol se muestra aquí en cuanto Gerencia lo publique y te lo asigne.", "You don't have a role agreement in force yet. Meanwhile you can read the purpose of the company and of your function; what is expected of your role shows here as soon as Management publishes it and assigns it to you.") : t(`${v.person.name} todavía no tiene un acuerdo de rol vigente.`, `${v.person.name} has no role agreement in force yet.`)} {mayAssign ? <Link href={`/equipo/claridad#p-${personId}`}>{t("Asignar un acuerdo de rol", "Assign a role agreement")}</Link> : null}</span>
        </div>
      )}
      {v.actingRoles.length > 0 && (
        <div className="note" id="temporal">{v.viewingActing
          ? <span>{t("Estás viendo un rol temporal.", "You are viewing a temporary role.")} <Link href={back}>{t("Ver el rol base", "See the base role")}</Link></span>
          : <span>{t("Además del rol base hay un rol temporal:", "Besides the base role there is a temporary role:")} {v.actingRoles.map((r) => <Link key={r.id} href={`/equipo/mi-rol?${new URLSearchParams({ ...(self ? {} : { p: personId }), a: r.id })}`} style={{ marginRight: 10 }}>{r.roleProfile?.title ?? r.contractualTitle} · {t("hasta", "until")} {i.day(r.effectiveTo)}</Link>)}</span>}
        </div>
      )}

      <section aria-label={t("Mi línea de contribución", "My line of contribution")}>
        <h3 style={{ marginTop: 0 }}>{t("Mi línea de contribución", "My line of contribution")}</h3>
        <div className="eq-line" id="linea">
          <div className="eq-step"><div className="k">{t("Propósito de la compañía", "Company purpose")}</div><div className="v">{idn?.purpose ?? "—"}</div></div>
          <div className="eq-step"><div className="k">{t("Función", "Function")}{fn ? ` · ${tx(fn)}` : ""}</div><div className="v">{fn?.purpose ?? t("Sin función asignada", "No function assigned")}</div></div>
          <div className="eq-step"><div className="k">{t("Rol", "Role")}{p ? ` · ${p.title}` : ""}</div><div className="v">{p?.purpose ?? <span className="attn-t">{t("Sin acuerdo de rol", "No role agreement")}</span>}</div></div>
          <div className="eq-step"><div className="k">{t("Resultados esperados", "Expected outcomes")}</div><div className="v">{p?.outcomes.length ? <>{p.outcomes[0]}{p.outcomes.length > 1 ? <a href="#rol" className="src block">{t(`y ${p.outcomes.length - 1} más`, `and ${p.outcomes.length - 1} more`)}</a> : null}</> : "—"}</div></div>
          <div className="eq-step"><div className="k">{t("Acciones del día", "Today's actions")}</div><div className="v">{self ? <Link href="/mi-dia">{v.tasksToday ? t(`${v.tasksToday} pendiente(s) de hoy en Mi Día`, `${v.tasksToday} due today in My Day`) : t("Abrir Mi Día", "Open My Day")}</Link> : <span className="muted">{t("Las ve la persona en Mi Día", "The person sees them in My Day")}</span>}</div></div>
        </div>
      </section>

      <section className="card eq-block" id="compania">
        <div className="eq-h"><span className="n">1</span><b>{t("Nuestra compañía", "Our company")}</b>{idn ? <span className="src">{t("identidad", "identity")} v{idn.version} · {t("rige desde", "in force since")} {i.date(idn.effectiveFrom)}</span> : null}<span className="grow" /><Link className="small" href="/gerencia/identidad">{t("Ver la identidad completa", "See the full identity")}</Link></div>
        {!idn ? <p className="small muted">{t("Aún no hay una identidad publicada.", "No identity has been published yet.")}</p> : (
          <>
            <p style={{ fontSize: 16, margin: "4px 0" }}><b>{idn.purpose}</b> <span className="muted">· {idn.slogan}</span></p>
            <p className="small gm-pre">{idn.valueProposition}</p>
            <div className="eq-cols">
              <div><h3>{t("Atributos", "Attributes")}</h3><div className="gm-chips">{asStrings(idn.attributes).map((x) => <span key={x}>{x}</span>)}</div></div>
              <div><h3>{t("Principios y valores", "Principles and values")}</h3><div className="gm-chips">{principles.map((x) => <span key={x.name} title={x.detail}>{x.name}</span>)}</div><p className="src">{t("Cómo se viven en este rol está en el bloque 4.", "How they are lived in this role is in block 4.")}</p></div>
            </div>
            {a?.identityVersion && a.identityVersion !== idn.version ? <p className="src">{t(`Este rol se asignó cuando regía la identidad v${a.identityVersion}; esa versión sigue en la historia.`, `This role was assigned when identity v${a.identityVersion} was in force; that version stays in the history.`)}</p> : null}
          </>
        )}
      </section>

      <section className="card eq-block" id="funcion">
        <div className="eq-h"><span className="n">2</span><b>{t("Mi función", "My function")}{fn ? `: ${tx(fn)}` : ""}</b>{charter ? <span className="src">{t("carta", "charter")} v{charter.version} · {t("rige desde", "in force since")} {i.date(charter.effectiveFrom)}</span> : null}<span className="grow" /><Link className="small" href={`/gerencia/funciones${v.functionKey ? `#f-${v.functionKey}` : ""}`}>{t("Ver la carta de la función", "See the function charter")}</Link></div>
        {!fn ? <p className="small muted">{t("Sin función asignada.", "No function assigned.")}</p> : (
          <>
            <p style={{ fontSize: 15, margin: "4px 0" }}><b>{fn.purpose}</b></p>
            {charter?.contribution ? <p className="small gm-pre"><b>{t("Cómo contribuye al sistema", "How it contributes to the system")}:</b> {charter.contribution}</p> : <p className="small muted">{t("La carta de la función aún no dice cómo contribuye al propósito de la compañía.", "The function charter does not yet say how it contributes to the company's purpose.")}</p>}
            {charter && (
              <div className="eq-cols">
                <div><h3>{t("Qué entrega", "What it delivers")}</h3>{asStrings(charter.outputs).length ? <Lines items={asStrings(charter.outputs)} i={i} /> : <p className="small muted">{t("Aún sin definir en la carta de la función.", "Not yet defined in the function charter.")}</p>}</div>
                <div><h3>{t("Con quién se conecta", "Who it connects with")}</h3>{asPairs(charter.interfaces, "with", "what").length ? <ul className="plain">{asPairs(charter.interfaces, "with", "what").map((x) => <li key={x.name}><b>{x.name in FUNCTIONS ? tx(FUNCTIONS[x.name as keyof typeof FUNCTIONS]) : x.name}</b>{x.detail ? `: ${x.detail}` : ""}</li>)}</ul> : <p className="small muted">{t("Aún sin definir.", "Not yet defined.")}</p>}</div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card eq-block" id="rol">
        <div className="eq-h"><span className="n">3</span><b>{t("Mi rol", "My role")}{p ? `: ${p.title}` : ""}</b>
          {v.profileRow ? <span className="src" id="version">{t("acuerdo de rol", "role agreement")} v{v.profileRow.version} · {t("rige desde", "in force since")} {i.date(v.profileRow.effectiveFrom)} · {v.profileRow.publishedByName}</span> : null}
          <span className="grow" />{p ? <Link className="small" href={`/equipo/roles/${p.roleKey}`}>{t("Ver versiones", "See versions")}</Link> : null}</div>
        {!p ? <p className="small muted">{t("Sin acuerdo de rol vigente.", "No role agreement in force.")}{a ? <> {t("Cargo registrado", "Recorded title")}: <b>{a.contractualTitle}</b>.</> : null} {t("Rol de acceso en SOLU", "Access role in SOLU")}: {tx(ROLE_LABEL[v.person.role])}.</p> : (
          <>
            <p className="small">{a?.level ? <><b>{t("Nivel", "Level")}:</b> {a.level} · </> : null}{a?.leader ? <><b>{t("Líder", "Leader")}:</b> {a.leader.name} · </> : null}{a ? <>{t("desde", "since")} {i.date(a.effectiveFrom)}{a.effectiveTo ? ` ${t("hasta", "until")} ${i.date(a.effectiveTo)}` : ""}</> : null}
              {v.agreedVersion != null && v.profileRow && v.agreedVersion !== v.profileRow.version ? <span className="src block">{t(`Se asignó bajo la versión ${v.agreedVersion}; hoy rige la ${v.profileRow.version}. Ambas quedan en la historia.`, `Assigned under version ${v.agreedVersion}; version ${v.profileRow.version} is in force today. Both stay in the history.`)}</span> : null}</p>
            <div className="qa-row" style={{ margin: "6px 0" }}>
              {stale ? <span className="sig attn">{v.reviewedVersion ? t(`Expectativas revisadas en la v${v.reviewedVersion}; falta revisar la v${v.profileRow!.version}`, `Expectations reviewed at v${v.reviewedVersion}; v${v.profileRow!.version} still to review`) : t("Expectativas aún sin revisar con el líder", "Expectations not yet reviewed with the leader")}</span> : <span className="sig ok">{t(`Expectativas revisadas el ${i.day(v.reviewedAt)} · ${v.reviewedByName}`, `Expectations reviewed on ${i.day(v.reviewedAt)} · ${v.reviewedByName}`)}</span>}
              {stale && a && (self || v.rel.leader) ? <form action={reviewExpectations.bind(null, a.id)}><input type="hidden" name="back" value={back} /><button type="submit" className="secondary sm">{self ? t("Ya las revisé con mi líder", "I reviewed them with my leader") : t("Las revisamos juntos", "We reviewed them together")}</button></form> : null}
            </div>
            {v.missingFields.length > 0 && <p className="small"><span className="sig attn">{t(`Acuerdo con ${v.missingFields.length} de 18 campos por completar`, `Agreement with ${v.missingFields.length} of 18 fields to complete`)}</span> <span className="muted">{v.missingFields.map((f) => tx(f.label)).join(" · ")}</span></p>}
            <p style={{ fontSize: 15, margin: "6px 0" }}><b>{p.purpose}</b></p>
            <div className="eq-cols">
              <div><h3>{t("Resultados que debe producir", "Outcomes it must produce")}</h3><Lines items={p.outcomes} i={i} /></div>
              <div><h3>{t("Funciones recurrentes", "Recurring functions")}</h3><Lines items={p.functions} i={i} /></div>
              <div><h3>{t("Responde por (aunque otro ejecute una parte)", "Answers for (even if someone else does a part)")}</h3><Lines items={p.responsibilities} i={i} /></div>
              <div id="autoridad"><h3>{t("Autoridad: qué puede decidir", "Authority: what it may decide")}</h3>
                {p.decisionRights.length === 0 ? <Lines items={[]} i={i} /> : kinded(p.decisionRights, DECISION_KINDS).map((g) => <div key={g.k}><span className="small"><b>{tx(DECISION_KINDS[g.k])}</b></span><ul className="plain">{g.rows.map((r, k) => <li key={k}>{r.text}</li>)}</ul></div>)}
              </div>
              <div><h3>{t("Límites: qué no puede decidir ni comprometer", "Boundaries: what it may not decide or commit")}</h3><Lines items={p.boundaries} i={i} /></div>
              <div id="autoridad-solu"><h3>{t("Lo que SOLU le permite hoy a este rol", "What SOLU allows this role today")}</h3>
                {p.authorityDomains.length === 0 && v.granted.length === 0 ? <p className="small muted">{t("El acuerdo no pide autoridad especial en SOLU.", "The agreement asks for no special authority in SOLU.")}</p> : (
                  <ul className="plain">{[...new Set([...p.authorityDomains, ...v.granted])].map((d) => { const need = p.authorityDomains.includes(d), has = v.granted.includes(d); return <li key={d}><span className={`sig ${need && !has ? "risk" : has ? "ok" : "wait"}`}>{need && !has ? t("falta", "missing") : need ? t("sí", "yes") : t("la tiene", "has it")}</span> {AUTHORITY[d] ? tx(AUTHORITY[d]) : d}{need && !has ? <span className="src block">{t("El acuerdo la pide y las políticas vigentes no se la dan a este rol de acceso.", "The agreement asks for it and the policies in force do not grant it to this access role.")}</span> : !need && has ? <span className="src block">{t("Las políticas se la dan, aunque el acuerdo no la nombra.", "Policies grant it, though the agreement does not name it.")}</span> : null}</li>; })}</ul>
                )}
                {v.roleMismatch ? <p className="small"><span className="sig attn">{t(`El acuerdo espera el rol de acceso «${ROLE_LABEL[p.soluRole as keyof typeof ROLE_LABEL]?.es ?? p.soluRole}» y la persona tiene «${ROLE_LABEL[v.person.role].es}»`, `The agreement expects the access role “${ROLE_LABEL[p.soluRole as keyof typeof ROLE_LABEL]?.en ?? p.soluRole}” and the person has “${ROLE_LABEL[v.person.role].en}”`)}</span></p> : null}
                <p className="src">{t("Lo que se puede aprobar en SOLU lo deciden las políticas vigentes; aquí se compara con lo que el acuerdo dice.", "What can be approved in SOLU is decided by the policies in force; here it is compared with what the agreement says.")} <Link href="/gerencia/politicas">{t("Políticas", "Policies")}</Link></p>
              </div>
              <div><h3>{t("Qué recibe", "What it receives")}</h3><Lines items={p.inputs} i={i} /></div>
              <div><h3>{t("Qué debe entregar", "What it must deliver")}</h3><Lines items={p.outputs} i={i} /></div>
            </div>
            <h3>{t("A quién sirve y qué espera cada uno", "Whom it serves and what each expects")}</h3>
            {p.customers.length ? <ul className="plain">{p.customers.map((c, k) => <li key={k}><span className="sig wait">{c.kind === "EXTERNAL" ? t("externo", "external") : t("interno", "internal")}</span> <b>{c.who}</b>{c.expects ? `: ${c.expects}` : ""}</li>)}</ul> : <Lines items={[]} i={i} />}
          </>
        )}
      </section>

      <section className="card eq-block" id="como">
        <div className="eq-h"><span className="n">4</span><b>{t("Cómo se espera que lo haga", "How I am expected to do it")}</b></div>
        {!p ? <p className="small muted">{t("Se muestra cuando haya un acuerdo de rol.", "Shown once there is a role agreement.")}</p> : (
          <>
            <h3>{t("Bien hecho significa", "Well done means")}</h3><Lines items={p.qualityStandards} i={i} />
            <h3>{t("Principios aplicados a este rol", "Principles applied to this role")}</h3>
            {p.behaviors.length ? <ul className="plain">{p.behaviors.map((b, k) => <li key={k}><b>{b.principle}:</b> {b.conduct}</li>)}</ul> : <Lines items={[]} i={i} />}
            <p className="src">{t("Son conductas que se pueden observar. Nadie recibe una calificación automática de carácter.", "They are conduct that can be observed. Nobody gets an automatic character rating.")}</p>
            <h3>{t("Metodologías", "Methodologies")}</h3>
            {p.methodologies.length || methods.length ? <ul className="plain">{p.methodologies.map((m) => <li key={m}>{m}</li>)}{methods.filter((m) => !p.methodologies.some((x) => x.toLowerCase().startsWith(m.name.toLowerCase()))).map((m) => <li key={m.name}><b>{m.name}</b>{m.detail ? `: ${m.detail}` : ""} <span className="src">· {t("de la identidad de la compañía", "from the company identity")}</span></li>)}</ul> : <Lines items={[]} i={i} />}
          </>
        )}
      </section>

      <section className="card eq-block" id="voy-bien">
        <div className="eq-h"><span className="n">5</span><b>{t("Cómo sé si voy bien", "How I know I am doing well")}</b></div>
        {v.goals ? (
          <>
            <h3>{t("Metas de este mes", "This month's goals")}</h3>
            {METRIC_KEYS.filter((k) => v.goals!.tOf(k)).length === 0 ? <p className="small muted">{t("Sin metas fijadas este mes.", "No goals set this month.")} <Link href="/comercial/metas">{t("Mis metas", "My goals")}</Link></p> : (
              <ul className="plain">{METRIC_KEYS.filter((k) => v.goals!.tOf(k)).map((k) => { const target = Number(v.goals!.tOf(k)!.target), actual = v.goals!.values[k], usd = GOAL_METRICS[k].unit === "usd"; return <li key={k}><b>{tx(GOAL_METRICS[k])}</b>: <span className="mono">{usd ? i.money(actual) : i.n(actual)}</span> {t("de", "of")} <span className="mono">{usd ? i.money(target) : i.n(target)}</span></li>; })}</ul>
            )}
            <p className="src">{t("Son las mismas metas de Comercial → Mis metas: aquí solo se leen.", "These are the same goals as Commercial → My goals: here they are only read.")} <Link href={self ? "/comercial/metas" : `/comercial/metas?u=${personId}`}>{t("Abrir", "Open")}</Link></p>
          </>
        ) : null}
        {!p ? <p className="small muted">{t("Indicadores, ritmo y señales se muestran cuando haya un acuerdo de rol.", "Indicators, rhythm and signals show once there is a role agreement.")}</p> : (
          <>
            <h3>{t("Qué se espera del desempeño", "What is expected of performance")}</h3>
            {p.performance.length ? kinded(p.performance, PERFORMANCE_KINDS).map((g) => <div key={g.k}><span className="small"><b>{tx(PERFORMANCE_KINDS[g.k])}</b></span><ul className="plain">{g.rows.map((r, k) => <li key={k}>{r.text}</li>)}</ul></div>) : <Lines items={[]} i={i} />}
            <h3>{t("Ritmo del rol", "Role rhythm")}</h3>
            {p.rhythm.length ? <ul className="plain">{kinded(p.rhythm, RHYTHM_KINDS).flatMap((g) => g.rows.map((r, k) => <li key={`${g.k}${k}`}><span className="sig wait">{tx(RHYTHM_KINDS[g.k])}</span> {r.text}</li>))}</ul> : <Lines items={[]} i={i} />}
            <div className="eq-cols">
              <div><h3>{t("Lo estás haciendo bien cuando…", "You are doing well when…")}</h3><Lines items={p.successSignals} i={i} /></div>
              <div><h3>{t("Necesita atención cuando…", "It needs attention when…")}</h3><Lines items={p.attentionSignals} i={i} /></div>
            </div>
            <h3>{t("Riesgos típicos del rol", "Typical risks of the role")}</h3><Lines items={p.risks} i={i} />
          </>
        )}
      </section>

      <section className="card eq-block" id="crecer">
        <div className="eq-h"><span className="n">6</span><b>{t("Cómo puedo crecer", "How I can grow")}</b><span className="grow" /><Link className="small" href={`/equipo/desarrollo${qp(personId, user.id)}`}>{self ? t("Mi desarrollo", "My development") : t("Su desarrollo", "Their development")}</Link></div>
        <p className="small muted">{t("El desarrollo empieza por el SER, se expresa en el HACER y se refleja en el TENER.", "Development starts with BEING, is expressed in DOING and shows in HAVING.")}</p>
        {p && p.careerLevels.length > 0 && (
          <>
            <h3>{t("Ruta del rol", "Route of the role")}</h3>
            <div className="tscroll"><table><thead><tr><th>{t("Nivel", "Level")}</th>{DIM_KEYS.map((d) => <th key={d}>{tx(DIMS[d])}</th>)}</tr></thead>
              <tbody>{p.careerLevels.map((l) => <tr key={l.name}><td><b>{l.name}</b>{a?.level && a.level.toLowerCase() === l.name.toLowerCase() ? <span className="sig info" style={{ marginLeft: 6 }}>{t("hoy", "today")}</span> : null}</td><td className="small">{l.ser || "—"}</td><td className="small">{l.hacer || "—"}</td><td className="small">{l.tener || "—"}</td></tr>)}</tbody></table></div>
          </>
        )}
        {p && <><h3>{t("Evidencia que muestra que está listo para el siguiente nivel", "Evidence that shows readiness for the next level")}</h3><Lines items={p.careerExpectations} i={i} />
          <h3>{t("Competencias que el rol requiere", "Competencies the role requires")}</h3>{p.competencies.length ? <ul className="plain">{p.competencies.map((c, k) => <li key={k}><span className="sig wait">{tx(COMPETENCY_KINDS[c.kind] ?? COMPETENCY_KINDS.OTHER)}</span> {c.text}</li>)}</ul> : <Lines items={[]} i={i} />}</>}

        {p && (v.rel.self || v.rel.leader || v.rel.mentor || v.rel.gerencia) && (
          <div id="brechas">
            <h3>{t("El acuerdo frente a la evidencia", "The agreement against the evidence")}</h3>
            {!(v.rel.self || v.rel.leader || v.rel.mentor) ? <p className="small muted">{t("El detalle lo ven la persona y quien la acompaña.", "The detail is seen by the person and whoever accompanies them.")}</p> : v.gapRows.length === 0 ? <p className="small muted">{t("El acuerdo aún no tiene contenido que comparar.", "The agreement has no content to compare yet.")}</p> : (
              <ul className="plain">{v.gapRows.map((g) => (
                <li key={g.key} id={`g-${g.key}`}><span className={`sig ${GAP_RESULTS[g.result]?.tone ?? "wait"}`}>{tx(GAP_RESULTS[g.result] ?? GAP_RESULTS.NOT_ENOUGH)}</span> <b>{tx(g.label)}</b>
                  {g.review?.evidence ? <span className="src block">{t("Evidencia", "Evidence")}: {g.review.evidence} · {g.review.reviewedByName} · {i.day(g.review.reviewedOn)}</span> : <span className="src block">{t("Nadie ha dejado evidencia para esta dimensión.", "Nobody has recorded evidence for this dimension.")}</span>}
                  {guide && !self && (
                    <details><summary className="small">{t("Registrar o actualizar", "Record or update")}</summary>
                      <form action={saveGapReview.bind(null, personId)} className="qa-form">
                        <input type="hidden" name="back" value={back} /><input type="hidden" name="roleKey" value={p.roleKey} /><input type="hidden" name="dimension" value={g.key} />
                        <p className="src">{t("Lo que el acuerdo dice", "What the agreement says")}: {g.lines(p).slice(0, 6).join(" · ")}</p>
                        <label>{t("Evidencia real (qué pasó, dónde se ve)", "Real evidence (what happened, where it shows)")}<textarea name="evidence" rows={2} maxLength={1000} defaultValue={g.review?.evidence ?? ""} /></label>
                        <div className="qa-row">
                          <label>{t("Resultado", "Result")}<select name="result" defaultValue={g.result}>{Object.entries(GAP_RESULTS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                          <label className="chk"><input type="checkbox" name="opportunity" value="1" /> {t("Si es una brecha, abrirla como oportunidad de desarrollo", "If it is a gap, open it as a development opportunity")}</label>
                        </div>
                        <div><button type="submit" className="secondary sm">{t("Guardar", "Save")}</button> <span className="src">{t("Sin evidencia, el resultado queda como «sin evidencia suficiente».", "With no evidence, the result stays as “not enough evidence”.")}</span></div>
                      </form>
                    </details>
                  )}
                </li>
              ))}</ul>
            )}
            <p className="src">{t("Una brecha describe algo por desarrollar en el rol; nunca es una etiqueta sobre la persona. No hay puntaje.", "A gap describes something to develop in the role; it is never a label on the person. There is no score.")}</p>
          </div>
        )}

        {v.readiness.length > 0 && <><h3>{t("Preparación para un rol o nivel", "Readiness for a role or level")}</h3><ul className="plain">{v.readiness.map((r) => <li key={r.id}><span className={`sig ${READINESS[r.state]?.tone ?? "wait"}`}>{READINESS[r.state] ? tx(READINESS[r.state]) : r.state}</span> <b>{v.roleTitles[r.roleKey] ?? r.roleKey}</b>{r.level ? ` · ${r.level}` : ""} <span className="src">· {r.assessedByName} · {i.day(r.assessedOn)}</span><span className="src block">{t("Evidencia", "Evidence")}: {r.evidence}{r.gaps ? ` · ${t("Brechas", "Gaps")}: ${r.gaps}` : ""}{r.plan ? ` · ${t("Plan", "Plan")}: ${r.plan}` : ""}</span></li>)}</ul></>}

        <h3>{t("Plan de desarrollo en curso", "Development plan in course")}</h3>
        {!v.plan ? <p className="small muted">{t("Sin ciclo de desarrollo activo.", "No active development cycle.")} <Link href={`/equipo/desarrollo${qp(personId, user.id)}`}>{t("Abrir uno", "Open one")}</Link></p> : v.plan.objectives.length === 0 ? <p className="small muted">{t(`Ciclo ${v.plan.cycle} abierto, aún sin objetivos visibles.`, `Cycle ${v.plan.cycle} open, no visible objectives yet.`)}</p> : (
          <ul className="plain">{v.plan.objectives.map((o) => <li key={o.id}><span className="sig info">{tx(DIMS[o.dimension as keyof typeof DIMS] ?? DIMS.SER)}</span> <Link href={`/equipo/desarrollo${qp(personId, user.id)}#o-${o.id}`}>{o.title}</Link> <PrivacyTag value={o.privacy} i={i} /><span className="src block">{t("Próximo movimiento", "Next movement")}: {o.nextMovement} · {t("revisión", "review")} {i.day(o.reviewOn)}</span></li>)}</ul>
        )}

        <div id="soporte">
          <h3>{t("Qué puede esperar este rol de la compañía", "What this role can expect of the company")}</h3>
          {p ? (p.companyCommitments.length ? <ul className="plain">{p.companyCommitments.map((c, k) => <li key={k}><span className="sig wait">{tx(COMMITMENT_KINDS[c.kind] ?? COMMITMENT_KINDS.OTHER)}</span> {c.text}</li>)}</ul> : <Lines items={[]} i={i} />) : null}
          {v.support.length > 0 && <><p className="small"><b>{t("Lo que hoy falta para cumplir una expectativa", "What is missing today to meet an expectation")}</b></p><ul className="plain">{v.support.map((g) => <li key={g.id}><span className={`sig ${g.status === "ESCALATED" ? "risk" : "attn"}`}>{GAP_KINDS[g.kind] ? tx(GAP_KINDS[g.kind]) : g.kind}</span> {g.what}{g.expectation ? <span className="src block">{t("Expectativa que no se puede cumplir", "Expectation that cannot be met")}: {g.expectation}</span> : null}<span className="src block">{t("Lo resuelve", "Resolved by")} {g.owner.name} · {g.nextMovement}{g.dueOn ? ` · ${i.day(g.dueOn)}` : ""}</span></li>)}</ul></>}
          {(self || guide) && (
            <details open={sp.err === "soporte"}><summary className="small">{self ? t("Decir que una expectativa no se puede cumplir porque algo falta", "Say that an expectation can't be met because something is missing") : t("Reconocer que una expectativa no está siendo soportada", "Acknowledge that an expectation is not being supported")}</summary>
              <form action={raiseRoleSupport.bind(null, personId)} className="qa-form">
                <input type="hidden" name="back" value={back} />
                <label>{t("Qué expectativa del rol no se puede cumplir", "Which expectation of the role cannot be met")}<input name="expectation" required maxLength={400} list="expectativas" /></label>
                {p ? <datalist id="expectativas">{[...p.outcomes, ...p.responsibilities, ...p.qualityStandards].slice(0, 40).map((x, k) => <option key={k} value={x.slice(0, 400)} />)}</datalist> : null}
                <div className="qa-row">
                  <label>{t("Qué falta", "What is missing")}<select name="kind">{Object.entries(GAP_KINDS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                  <label style={{ flex: 2 }}>{t("Descríbelo", "Describe it")}<input name="what" required maxLength={300} /></label>
                </div>
                <label>{t("Qué impide o retrasa", "What it prevents or delays")}<input name="impact" maxLength={300} /></label>
                <div className="qa-row">
                  <label>{t("Quién lo resuelve", "Who resolves it")}<select name="ownerId" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...owners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)]}</select></label>
                  <label style={{ flex: 2 }}>{t("Próximo paso", "Next step")}<input name="nextMovement" required maxLength={300} /></label>
                  <label>{t("Para cuándo", "By when")}<input type="date" name="dueOn" min={dayInput(T)} /></label>
                </div>
                <div><button type="submit" className="secondary">{t("Registrar", "Record")}</button></div>
              </form>
            </details>
          )}
          <p className="src">{t("Es una deuda de la compañía con el rol, con responsable y próximo paso. No es una marca sobre la persona.", "It is a debt of the company to the role, with an owner and a next step. It is not a mark on the person.")}</p>
        </div>
      </section>
      <p className="src">{t("calculado", "as of")} {i.date(v.asOf)}</p>
    </div>
  );
}
