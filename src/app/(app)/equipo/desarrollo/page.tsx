import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { ACTION_KINDS, DEV_FLAG, DIMS, DIM_KEYS, FEEDBACK_PARTS, MEETING_KINDS, MENTOR_KINDS, anyRelation, checkpointsOf, mayGuide, planBalance, type Dim } from "@/lib/team-rules";
import { viewablePeople } from "@/lib/team-store";
import { devSuggestions, devView, workRecords } from "@/lib/team-views";
import { NoAccess, Notes, PersonSwitch, PrivacySelect, PrivacyTag, qp, tOf } from "../ui";
import { addCommitment, addEvidence, addObjective, addOpportunity, closeCommitment, closeObjective, closePlan, dismissOpportunity, moveObjective, openPlan, setObjectivePrivacy, updatePlan } from "../actions";

// Módulo 16 §4–6, §13–14 · My Development: current focus, commitments, evidence and the next conversation.
// A cycle of 90 days with a few priorities in SER, HACER and TENER. Every objective says what will show it, its next
// movement and when it is reviewed; it closes only with evidence or with its reason written.

export default async function DevelopmentPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; p?: string; f?: string; d?: string; opp?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const personId = sp.p || user.id;
  const [v, people] = await Promise.all([devView(user, personId), viewablePeople(user)]);
  if (!v) notFound();
  if (!anyRelation(v.rel)) return <NoAccess i={i} back="/equipo/desarrollo" />;
  const self = v.rel.self, guide = mayGuide(v.rel);
  const T = today();
  const P = v.policy.value;
  const back = `/equipo/desarrollo${qp(personId, user.id)}`;
  const plan = v.plan;
  const [suggestions, records, everyone] = await Promise.all([
    self ? devSuggestions(personId) : [], self && plan ? workRecords(personId) : [],
    guide ? db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const others = everyone.filter((x) => x.id !== personId);
  const committers = [v.person, ...(plan?.leader ? [plan.leader] : []), ...(plan?.mentor ? [plan.mentor] : []), ...(!self ? [{ id: user.id, name: user.name }] : [])].filter((x, k, a) => a.findIndex((y) => y.id === x.id) === k);
  const balance = plan ? planBalance(plan.objectives, P) : [];
  const cps = plan ? checkpointsOf(plan.startsOn, P) : [];
  const miss = new Set((sp.f ?? "").split(","));
  const need = (k: string) => (sp.err === "objetivo" && miss.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const opp = sp.opp ? v.opportunities.find((o) => o.id === sp.opp) ?? null : null;
  const openObjectives = plan?.objectives.filter((o) => o.status === "OPEN") ?? [];
  const SRC: Record<string, { es: string; en: string }> = { FEEDBACK: { es: "de un feedback", en: "from feedback" }, ROLE_GAP: { es: "de una brecha del rol", en: "from a role gap" }, IMPROVEMENT: { es: "de un patrón en el trabajo", en: "from a pattern in the work" }, SELF: { es: "propia", en: "own" }, LEADER: { es: "del líder o mentor", en: "from leader or mentor" } };
  const ok = {
    ciclo: t("Ciclo abierto. Lo siguiente es escribir las prioridades.", "Cycle opened. Next, write the priorities."), "ciclo-guardado": t("Guardado.", "Saved."), "ciclo-cerrado": t("Ciclo cerrado. Queda en la historia; puedes abrir el siguiente.", "Cycle closed. It stays in the history; you can open the next one."),
    objetivo: t("Objetivo agregado.", "Objective added."), movido: t("Próximo movimiento y fecha de revisión actualizados.", "Next movement and review date updated."), privacidad: t("Listo: cambió quién lo ve.", "Done: who sees it has changed."),
    evidencia: t("Evidencia agregada.", "Evidence added."), "objetivo-cerrado": t("Objetivo cerrado.", "Objective closed."), compromiso: t("Compromiso registrado.", "Commitment recorded."), "compromiso-cerrado": t("Compromiso cerrado.", "Commitment closed."),
    oportunidad: t("Oportunidad de desarrollo registrada.", "Development opportunity recorded."), "oportunidad-existe": t("Esa oportunidad ya estaba registrada.", "That opportunity was already recorded."), "oportunidad-descartada": t("Oportunidad descartada, con su motivo.", "Opportunity set aside, with its reason."),
  };
  const err = {
    permiso: t("No tienes permiso para esto.", "You don't have permission for this."), "ciclo-abierto": t("Ya hay un ciclo abierto: se cierra antes de abrir otro.", "A cycle is already open: close it before opening another."),
    inicio: t("El ciclo empieza hoy o en una fecha cercana (a un mes como máximo).", "The cycle starts today or on a nearby date (within a month)."),
    abiertos: t("Aún hay objetivos abiertos. Cada uno se cierra con su evidencia o con su motivo antes de cerrar el ciclo.", "There are still open objectives. Each is closed with its evidence or its reason before closing the cycle."),
    "nota-cierre": t("Escribe qué deja este ciclo. No se cerró.", "Write what this cycle leaves. It was not closed."),
    max: t(`Este ciclo ya tiene el máximo de prioridades de ${sp.d && sp.d in DIMS ? DIMS[sp.d as Dim].es : "esa dimensión"}. Pocas prioridades, bien acompañadas.`, `This cycle already has the maximum number of ${sp.d && sp.d in DIMS ? DIMS[sp.d as Dim].en : "that dimension"} priorities. Few priorities, well accompanied.`),
    objetivo: t("Falta lo marcado en rojo: todo objetivo lleva la evidencia esperada, su próximo movimiento y una fecha de revisión dentro del ciclo. No se guardó nada.", "What is marked in red is missing: every objective carries its expected evidence, its next movement and a review date inside the cycle. Nothing was saved."),
    mover: t("Escribe el próximo movimiento y una fecha de revisión dentro del ciclo.", "Write the next movement and a review date inside the cycle."),
    evidencia: t("Describe la evidencia; su fecha no puede ser futura.", "Describe the evidence; its date can't be in the future."),
    "sin-evidencia": t("Un objetivo se da por logrado cuando hay evidencia registrada. Agrega la evidencia, o ciérralo de otra forma escribiendo el motivo.", "An objective counts as achieved when evidence is on record. Add the evidence, or close it another way by writing the reason."),
    "sin-motivo": t("Para cerrarlo sin darlo por logrado, escribe el motivo.", "To close it without counting it as achieved, write the reason."),
    compromiso: t("Faltan datos: qué se hará, qué lo mostrará, para cuándo y quién se compromete (la persona, su líder o su mentor).", "Missing data: what will be done, what will show it, by when and who commits (the person, their leader or their mentor)."),
    "compromiso-evidencia": t("Escribe qué muestra que se cumplió.", "Write what shows it was kept."), "compromiso-motivo": t("Escribe por qué se retira.", "Write why it is dropped."),
    oportunidad: t("Escribe la oportunidad.", "Write the opportunity."), nota: t("Escribe el motivo.", "Write the reason."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{self ? t("Mi desarrollo", "My development") : t(`Desarrollo de ${v.person.name}`, `${v.person.name}'s development`)}</h1>
        <p>{t("Foco actual, compromisos, evidencia y la próxima conversación.", "Current focus, commitments, evidence and the next conversation.")}</p>
      </div><span className="grow" /><PersonSwitch people={people} current={personId} me={user.id} path="/equipo/desarrollo" i={i} /></div>
      <Notes sp={sp} ok={ok} err={err} />
      {!guide && <p className="src">{t("Como Gerencia ves que el ciclo existe y lo que la persona marcó como organizacional.", "As Management you see that the cycle exists and what the person marked as organisational.")}</p>}

      {v.flags.length > 0 && guide && (
        <section className="card" id="atencion"><b>{t("QUÉ PIDE ATENCIÓN", "WHAT ASKS FOR ATTENTION")}</b>
          <ul className="plain">{v.flags.map((f, k) => <li key={k}><span className="sig attn">{tx(DEV_FLAG[f.key])}</span> {f.key === "UNDER_MIN" && f.dim ? t(`${tx(DIMS[f.dim])}: falta(n) ${f.n}`, `${tx(DIMS[f.dim])}: ${f.n} missing`) : f.key === "CHECKPOINT_DUE" ? t(`día ${f.day} del ciclo`, `day ${f.day} of the cycle`) : f.n ? f.n : ""}{f.key === "NO_NEXT_MEETING" || f.key === "CHECKPOINT_DUE" ? <> <Link className="small" href={`/equipo/reuniones${qp(personId, user.id)}#nueva`}>{t("programar", "schedule")}</Link></> : null}</li>)}</ul>
        </section>
      )}

      <section className="card" id="ciclo">
        {plan ? (
          <>
            <b>{t(`CICLO ${plan.cycle}`, `CYCLE ${plan.cycle}`)}</b> <span className="small muted">{i.date(plan.startsOn)} → {i.date(plan.endsOn)} · {t(`${P.cycleDays} días`, `${P.cycleDays} days`)}</span>
            <dl className="qv-dl" style={{ marginTop: 6 }}>
              <dt>{t("Para qué quiero desarrollarme", "What I want to develop for")}</dt><dd className="gm-pre">{plan.purpose ?? <span className="muted">{t("Sin escribir", "Not written")}</span>}</dd>
              <dt>{t("Me acompaña", "Accompanied by")}</dt><dd>{plan.leader?.name ?? <span className="muted">{t("Sin líder asignado", "No leader assigned")}</span>}{plan.mentor ? <> · {t("mentor", "mentor")}: {plan.mentor.name}{plan.mentorKind && MENTOR_KINDS[plan.mentorKind] ? ` (${tx(MENTOR_KINDS[plan.mentorKind])})` : ""}</> : null}</dd>
              <dt>{t("Puntos de control", "Checkpoints")}</dt><dd>{cps.map((c) => { const met = v.meetings.some((m) => m.planId === plan.id && m.checkpointDay === c.day && m.status !== "CANCELLED"); return <span key={c.day} className={`sig ${met ? "ok" : c.on < T ? "attn" : "wait"}`} style={{ marginRight: 4 }}>{t(`día ${c.day}`, `day ${c.day}`)} · {i.day(c.on)}</span>; })}</dd>
              <dt>{t("Próxima conversación", "Next conversation")}</dt><dd>{v.next ? <Link href={`/equipo/reuniones/${v.next.id}`}>{i.date(v.next.scheduledOn)} · {tx(MEETING_KINDS[v.next.kind] ?? MEETING_KINDS.ONE_ON_ONE)} · {v.next.with.name}</Link> : guide ? <><span className="sig attn">{t("sin programar", "not scheduled")}</span> <Link className="small" href={`/equipo/reuniones${qp(personId, user.id)}#nueva`}>{t("programar", "schedule")}</Link></> : "—"}</dd>
            </dl>
            {guide && (
              <details><summary className="small">{t("Cambiar el para qué, el líder o el mentor", "Change the purpose, leader or mentor")}</summary>
                <form action={updatePlan.bind(null, plan.id)} className="qa-form">
                  <label>{t("Para qué quiero desarrollarme", "What I want to develop for")}<textarea name="purpose" rows={2} maxLength={800} defaultValue={plan.purpose ?? ""} /></label>
                  <div className="qa-row">
                    <label>{t("Líder que acompaña", "Accompanying leader")}<select name="leaderId" defaultValue={plan.leaderId ?? ""}><option value="">—</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                    <label>{t("Mentor (no tiene que ser el jefe)", "Mentor (need not be the boss)")}<select name="mentorId" defaultValue={plan.mentorId ?? ""}><option value="">—</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                    <label>{t("Tipo de mentoría", "Kind of mentoring")}<select name="mentorKind" defaultValue={plan.mentorKind ?? "CAREER"}>{Object.entries(MENTOR_KINDS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                  </div>
                  <div><button type="submit" className="secondary sm">{t("Guardar", "Save")}</button> <span className="src">{t("Quien acompaña (líder o mentor) ve los objetivos compartidos de este ciclo.", "Whoever accompanies (leader or mentor) sees the shared objectives of this cycle.")}</span></div>
                </form>
              </details>
            )}
          </>
        ) : (
          <>
            <b>{t("CICLO DE DESARROLLO", "DEVELOPMENT CYCLE")}</b>
            <p className="small">{v.hasPlan ? t("Hay un ciclo activo cuyo detalle no es visible para ti.", "There is an active cycle whose detail is not visible to you.") : t(`Sin ciclo activo. Un ciclo dura ${P.cycleDays} días, con ${P.limits.SER.min}–${P.limits.SER.max} prioridades de SER, ${P.limits.HACER.min}–${P.limits.HACER.max} de HACER y ${P.limits.TENER.min}–${P.limits.TENER.max} de TENER, y puntos de control los días ${P.checkpoints.join(", ")}.`, `No active cycle. A cycle lasts ${P.cycleDays} days, with ${P.limits.SER.min}–${P.limits.SER.max} BE priorities, ${P.limits.HACER.min}–${P.limits.HACER.max} DO and ${P.limits.TENER.min}–${P.limits.TENER.max} HAVE, and checkpoints on days ${P.checkpoints.join(", ")}.`)}</p>
            {guide && !v.hasPlan && (
              <form action={openPlan.bind(null, personId)} className="qa-form">
                <label>{t("Para qué quiero desarrollarme", "What I want to develop for")}<textarea name="purpose" rows={2} maxLength={800} /></label>
                <div className="qa-row">
                  <label>{t("Empieza", "Starts")}<input type="date" name="startsOn" defaultValue={dayInput(T)} /></label>
                  <label>{t("Líder que acompaña", "Accompanying leader")}<select name="leaderId" defaultValue={!self && v.rel.leader ? user.id : ""}><option value="">{t("Mi líder formal", "My formal leader")}</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                  <label>{t("Mentor (opcional)", "Mentor (optional)")}<select name="mentorId" defaultValue=""><option value="">—</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                  <label>{t("Tipo de mentoría", "Kind of mentoring")}<select name="mentorKind" defaultValue="CAREER">{Object.entries(MENTOR_KINDS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                </div>
                <div><button type="submit">{t("Abrir el ciclo", "Open the cycle")}</button></div>
              </form>
            )}
          </>
        )}
      </section>

      {plan && (
        <section id="objetivos">
          <div className="eq-cols3" style={{ marginBottom: 12 }}>{DIM_KEYS.map((d) => { const b = balance.find((x) => x.dim === d)!; return (
            <div className="eq-dim" key={d}><b>{tx(DIMS[d])}</b> <span className={`sig ${b.under ? "attn" : "ok"}`}>{b.n} {t("de", "of")} {b.min}–{b.max}</span><p className="q">{tx(DIMS[d].question)}</p></div>
          ); })}</div>
          {plan.objectives.length === 0 && <p className="small muted">{t("Aún no hay objetivos en este ciclo.", "No objectives in this cycle yet.")}</p>}
          {plan.objectives.map((o) => { const open = o.status === "OPEN", late = open && o.reviewOn < T; const mine = guide && (self || o.privacy !== "PRIVATE"); return (
            <article key={o.id} id={`o-${o.id}`} className={`eq-obj${!open ? " done" : late ? " late" : ""}`}>
              <div className="eq-obj-h"><span className="sig info">{tx(DIMS[o.dimension as Dim] ?? DIMS.SER)}</span><span className="t">{o.title}</span>
                {!open ? <span className={`sig ${o.status === "ACHIEVED" ? "ok" : "wait"}`}>{o.status === "ACHIEVED" ? t("Logrado", "Achieved") : t("Cerrado", "Closed")}</span> : late ? <span className="sig attn">{t("pasó su revisión", "past its review")}</span> : null}
                {self ? <PrivacyTag value={o.privacy} i={i} /> : null}</div>
              {o.why ? <p className="small muted" style={{ margin: "2px 0" }}>{o.why}</p> : null}
              <dl className="qv-dl" style={{ marginTop: 6 }}>
                <dt>{t("Evidencia esperada", "Expected evidence")}</dt><dd>{o.expectedEvidence}</dd>
                {open ? <><dt>{t("Próximo movimiento", "Next movement")}</dt><dd>{o.nextMovement}</dd><dt>{t("Se revisa", "Reviewed on")}</dt><dd>{i.date(o.reviewOn)}</dd></> : <><dt>{t("Cierre", "Close")}</dt><dd>{o.closeReason ?? t("Con la evidencia registrada", "With the evidence on record")} <span className="src">· {o.closedByName} · {i.day(o.closedAt)}</span></dd></>}
                <dt>{t("Evidencia registrada", "Evidence on record")} · {o.evidence.length}</dt><dd>{o.evidence.length === 0 ? <span className="muted">{t("Ninguna todavía", "None yet")}</span> : <ul className="plain">{o.evidence.map((e) => <li key={e.id}>{e.what}{e.ref ? <> · {e.ref.startsWith("/") ? <Link href={e.ref}>{t("ver registro", "see record")}</Link> : <span className="muted">{e.ref}</span>}</> : null} <span className="src">· {i.day(e.observedOn)} · {e.addedByName}{e.kind === "WORK" ? ` · ${t("registro de trabajo elegido por la persona", "work record chosen by the person")}` : ""}</span></li>)}</ul>}</dd>
              </dl>
              {open && mine && (
                <div className="eq-acts">
                  <details><summary className="small">{t("Agregar evidencia", "Add evidence")}</summary>
                    <form action={addEvidence.bind(null, o.id)} className="qa-form">
                      <label>{t("Qué pasó que lo muestra", "What happened that shows it")}<textarea name="what" rows={2} required maxLength={600} /></label>
                      <div className="qa-row">
                        <label>{t("Día", "Day")}<input type="date" name="observedOn" max={dayInput(T)} defaultValue={dayInput(T)} /></label>
                        {self && records.length > 0 ? <label style={{ flex: 2 }}>{t("Adjuntar un registro de mi trabajo (opcional, tú eliges)", "Attach a record of my work (optional, your choice)")}<select name="ref" defaultValue=""><option value="">—</option>{records.map((r) => <option key={r.href} value={r.href}>{i.day(r.on)} · {t(r.es, r.en)}</option>)}</select></label> : <label style={{ flex: 2 }}>{t("Dónde se ve (opcional)", "Where it shows (optional)")}<input name="ref" maxLength={300} /></label>}
                      </div>
                      <div><button type="submit" className="secondary sm">{t("Agregar", "Add")}</button></div>
                    </form>
                  </details>
                  <details><summary className="small">{t("Cambiar el próximo movimiento", "Change the next movement")}</summary>
                    <form action={moveObjective.bind(null, o.id)} className="qa-form">
                      <label>{t("Próximo movimiento", "Next movement")}<input name="nextMovement" required maxLength={300} defaultValue={o.nextMovement} /></label>
                      <label>{t("Se revisa", "Reviewed on")}<input type="date" name="reviewOn" required min={dayInput(plan.startsOn)} max={dayInput(plan.endsOn)} defaultValue={dayInput(o.reviewOn)} /></label>
                      <div><button type="submit" className="secondary sm">{t("Guardar", "Save")}</button></div>
                    </form>
                  </details>
                  <details open={(sp.err === "sin-evidencia" || sp.err === "sin-motivo")}><summary className="small">{t("Cerrar el objetivo", "Close the objective")}</summary>
                    <form action={closeObjective.bind(null, o.id)} className="qa-form">
                      <label>{t("Motivo (obligatorio si no se da por logrado)", "Reason (required unless achieved)")}<input name="reason" maxLength={500} /></label>
                      <div className="qa-row"><button type="submit" name="outcome" value="ACHIEVED" className="sm">{t("Logrado, con la evidencia registrada", "Achieved, with the evidence on record")}</button><button type="submit" name="outcome" value="CLOSED" className="secondary sm">{t("Cerrar con este motivo", "Close with this reason")}</button></div>
                    </form>
                  </details>
                  {self && <details><summary className="small">{t("Cambiar quién lo ve", "Change who sees it")}</summary><form action={setObjectivePrivacy.bind(null, o.id)} className="qa-row"><PrivacySelect i={i} value={o.privacy} /><button type="submit" className="secondary sm">{t("Guardar", "Save")}</button></form></details>}
                </div>
              )}
            </article>
          ); })}

          {guide && (
            <details className="card" id="nuevo-objetivo" open={sp.err === "objetivo" || !!opp}><summary><b>{t("Agregar un objetivo", "Add an objective")}</b></summary>
              <form action={addObjective.bind(null, plan.id)} className="qa-form">
                {opp ? <><input type="hidden" name="opportunityId" value={opp.id} /><p className="src">{t("Nace de la oportunidad", "Born from the opportunity")}: {opp.what}</p></> : null}
                <div className="qa-row">
                  <label>{t("Dimensión", "Dimension")}<select name="dimension" defaultValue={opp?.dimension ?? "SER"} {...need("dimension")}>{DIM_KEYS.map((d) => <option key={d} value={d}>{tx(DIMS[d])} · {tx(DIMS[d].question)}</option>)}</select></label>
                  <label style={{ flex: 2 }}>{t("Objetivo", "Objective")}<input name="title" required maxLength={200} defaultValue={opp?.what.slice(0, 200) ?? ""} {...need("title")} /></label>
                </div>
                <label>{t("Por qué importa (opcional)", "Why it matters (optional)")}<input name="why" maxLength={500} /></label>
                <label>{t("Qué evidencia mostrará que se logró", "What evidence will show it was achieved")}<input name="expectedEvidence" required maxLength={500} {...need("expectedEvidence")} /></label>
                <div className="qa-row">
                  <label style={{ flex: 2 }}>{t("Próximo movimiento", "Next movement")}<input name="nextMovement" required maxLength={300} {...need("nextMovement")} /></label>
                  <label>{t("Se revisa", "Reviewed on")}<input type="date" name="reviewOn" required min={dayInput(plan.startsOn)} max={dayInput(plan.endsOn)} {...need("reviewOn")} /></label>
                  <label>{t("Quién lo ve", "Who sees it")}<PrivacySelect i={i} value="SHARED" levels={self ? ["PRIVATE", "SHARED", "ORG"] : ["SHARED", "ORG"]} /></label>
                </div>
                <div><button type="submit" className="secondary">{t("Agregar", "Add")}</button></div>
              </form>
            </details>
          )}
        </section>
      )}

      {guide && (
        <section className="card" id="compromisos"><b>{t("COMPROMISOS", "COMMITMENTS")}</b> <span className="small muted">{t("quién hace qué, qué lo mostrará y para cuándo", "who does what, what will show it and by when")}</span>
          {v.commitments.length === 0 ? <p className="small muted">{t("Ninguno.", "None.")}</p> : (
            <ul className="plain">{v.commitments.map((c) => { const open = c.status === "OPEN"; return (
              <li key={c.id}><span className={`sig ${!open ? (c.status === "DONE" ? "ok" : "wait") : c.dueOn < T ? "attn" : "info"}`}>{!open ? (c.status === "DONE" ? t("cumplido", "kept") : t("retirado", "dropped")) : c.dueOn < T ? t("vencido", "overdue") : i.day(c.dueOn)}</span> <span className="sig wait">{tx(ACTION_KINDS[c.kind] ?? ACTION_KINDS.PRACTICE)}</span> <b>{c.owner.name}</b>: {c.what}{c.sharedWithId ? <span className="src"> · {t("compartido con", "shared with")} {everyone.find((x) => x.id === c.sharedWithId)?.name ?? "—"}</span> : null}
                <span className="src block">{t("Lo mostrará", "It will be shown by")}: {c.expectedEvidence}{!open && c.closeNote ? ` · ${c.closeNote}` : ""}</span>
                {open && <form action={closeCommitment.bind(null, c.id)} className="qa-row" style={{ marginTop: 4 }}><input type="hidden" name="back" value={back} /><input name="note" required maxLength={500} placeholder={t("Qué muestra que se cumplió, o por qué se retira", "What shows it was kept, or why it is dropped")} aria-label={t("Nota", "Note")} /><button type="submit" name="action" value="DONE" className="sm" style={{ flex: "0 0 auto" }}>{t("Cumplido", "Kept")}</button><button type="submit" name="action" value="DROP" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Retirar", "Drop")}</button></form>}
              </li>
            ); })}</ul>
          )}
          <details open={sp.err === "compromiso"}><summary className="small">{t("Agregar un compromiso", "Add a commitment")}</summary>
            <form action={addCommitment.bind(null, personId)} className="qa-form">
              <input type="hidden" name="back" value={back} />
              <div className="qa-row">
                <label>{t("Quién se compromete", "Who commits")}<select name="ownerId" defaultValue={self ? personId : user.id}>{committers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{t("Compartido con (opcional)", "Shared with (optional)")}<select name="sharedWithId" defaultValue=""><option value="">—</option>{committers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{t("Tipo de acción", "Kind of action")}<select name="kind">{Object.entries(ACTION_KINDS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                <label>{t("Para cuándo", "By when")}<input type="date" name="dueOn" required min={dayInput(T)} /></label>
              </div>
              <label>{t("Qué se hará", "What will be done")}<input name="what" required maxLength={400} /></label>
              <label>{t("Qué mostrará que se hizo", "What will show it was done")}<input name="expectedEvidence" required maxLength={400} /></label>
              {openObjectives.length > 0 && <label>{t("Sirve al objetivo (opcional)", "Serves the objective (optional)")}<select name="objectiveId" defaultValue=""><option value="">—</option>{openObjectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>}
              <div><button type="submit" className="secondary">{t("Agregar", "Add")}</button></div>
            </form>
          </details>
        </section>
      )}

      {guide && (
        <section className="card" id="oportunidades"><b>{t("OPORTUNIDADES DE DESARROLLO", "DEVELOPMENT OPPORTUNITIES")}</b> <span className="small muted">{t("algo que vale la pena desarrollar; se vuelve objetivo solo cuando se decide tomarlo", "something worth developing; it becomes an objective only when it is taken up")}</span>
          {v.opportunities.length === 0 ? <p className="small muted">{t("Ninguna abierta.", "None open.")}</p> : (
            <ul className="plain">{v.opportunities.map((o) => (
              <li key={o.id}>{o.dimension && o.dimension in DIMS ? <span className="sig info">{tx(DIMS[o.dimension as Dim])}</span> : null} {o.what} <span className="src">· {t(SRC[o.source]?.es ?? o.source, SRC[o.source]?.en ?? o.source)} · {o.raisedByName} · {i.day(o.createdAt)}</span>
                <span className="qa-row" style={{ marginTop: 4 }}>{plan ? <Link className="btn secondary sm" href={`${back}${back.includes("?") ? "&" : "?"}opp=${o.id}#nuevo-objetivo`}>{t("Convertir en objetivo", "Turn into an objective")}</Link> : <span className="src">{t("Abre un ciclo para convertirla en objetivo.", "Open a cycle to turn it into an objective.")}</span>}
                  <form action={dismissOpportunity.bind(null, o.id)} className="qa-row"><input name="note" required maxLength={300} placeholder={t("Motivo para dejarla", "Reason to set it aside")} aria-label={t("Motivo", "Reason")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Dejarla", "Set aside")}</button></form></span>
              </li>
            ))}</ul>
          )}
          <details open={sp.err === "oportunidad"}><summary className="small">{t("Agregar una oportunidad", "Add an opportunity")}</summary>
            <form action={addOpportunity.bind(null, personId)} className="qa-form">
              <div className="qa-row"><label>{t("Dimensión", "Dimension")}<select name="dimension" defaultValue="HACER">{DIM_KEYS.map((d) => <option key={d} value={d}>{tx(DIMS[d])}</option>)}</select></label><label style={{ flex: 3 }}>{t("Qué vale la pena desarrollar", "What is worth developing")}<input name="what" required maxLength={400} /></label></div>
              <div><button type="submit" className="secondary sm">{t("Agregar", "Add")}</button></div>
            </form>
          </details>
        </section>
      )}

      {self && suggestions.length > 0 && (
        <section className="card" id="sugerencias"><b>{t("PATRONES EN TU TRABAJO QUE PODRÍAN SER UNA OPORTUNIDAD", "PATTERNS IN YOUR WORK THAT COULD BE AN OPPORTUNITY")}</b> <span className="small muted">{t("solo tú los ves", "only you see them")}</span>
          <ul className="plain">{suggestions.map((s) => (
            <li key={s.key}><b>{tx(s.step)}</b>: {tx(s.text)}
              <form action={addOpportunity.bind(null, personId)} style={{ display: "inline", marginLeft: 8 }}><input type="hidden" name="source" value="IMPROVEMENT" /><input type="hidden" name="sourceRef" value={s.key} /><input type="hidden" name="dimension" value="HACER" /><input type="hidden" name="what" value={`${s.step.es}: ${s.text.es}`.slice(0, 400)} /><button type="submit" className="secondary sm">{t("Tomarla como oportunidad", "Take it as an opportunity")}</button></form>
            </li>
          ))}</ul>
          <p className="src">{t("Compara tus últimos 90 días con tus 270 anteriores (Comercial → Mi mejora). Es una sugerencia, no una vigilancia: nadie más la ve y nada se registra si no la tomas. El contexto lo interpreta la conversación con tu líder.", "It compares your last 90 days with your previous 270 (Commercial → My improvement). It is a suggestion, not surveillance: nobody else sees it and nothing is recorded unless you take it. The context is interpreted in the conversation with your leader.")} <Link href="/comercial/mejora">{t("Ver el detalle", "See the detail")}</Link></p>
        </section>
      )}

      {v.feedback.length > 0 && (
        <section className="card" id="feedback"><b>{t("FEEDBACK RECIBIDO", "FEEDBACK RECEIVED")}</b> <Link className="small" href="/equipo/feedback">{t("Feedback 360", "Feedback 360")}</Link>
          <ul className="plain">{v.feedback.slice(0, 5).map((f) => <li key={f.id}><b>{f.from.name}</b> <span className="src">· {i.day(f.givenAt)}</span>{FEEDBACK_PARTS.filter((p) => f[p.key]).map((p) => <span key={p.key} className="src block"><b>{tx(p)}:</b> {f[p.key]}</span>)}</li>)}</ul>
        </section>
      )}

      {plan && guide && (
        <section className="card" id="cerrar"><b>{t("CERRAR EL CICLO", "CLOSE THE CYCLE")}</b>
          <p className="small muted">{openObjectives.length ? t(`Quedan ${openObjectives.length} objetivo(s) abierto(s): cada uno se cierra con su evidencia o con su motivo.`, `${openObjectives.length} objective(s) still open: each is closed with its evidence or its reason.`) : t("Todos los objetivos están cerrados.", "All objectives are closed.")}</p>
          <form action={closePlan.bind(null, plan.id)} className="qa-form">
            <label>{t("Qué deja este ciclo y qué sigue", "What this cycle leaves and what comes next")}<textarea name="note" rows={2} maxLength={1000} /></label>
            <div><button type="submit" className="secondary" disabled={openObjectives.length > 0}>{t("Cerrar el ciclo", "Close the cycle")}</button></div>
          </form>
        </section>
      )}

      {v.closed.length > 0 && (
        <section className="card" id="historia"><b>{t("CICLOS ANTERIORES", "EARLIER CYCLES")}</b>
          <ul className="plain">{v.closed.map((c) => <li key={c.id}><b>{t(`Ciclo ${c.cycle}`, `Cycle ${c.cycle}`)}</b> · {i.day(c.startsOn)} → {i.date(c.endsOn)} · {t(`${c.objectives.filter((o) => o.status === "ACHIEVED").length} de ${c.objectives.length} objetivos logrados`, `${c.objectives.filter((o) => o.status === "ACHIEVED").length} of ${c.objectives.length} objectives achieved`)}{c.closeNote ? <span className="src block">{c.closeNote}</span> : null}</li>)}</ul>
        </section>
      )}
      <p className="src">{t("La empresa busca mejores resultados ayudando a las personas a crecer. El desarrollo que no se revisa termina convirtiéndose en intención.", "The company seeks better results by helping people grow. Development that is not reviewed ends up as intention.")}</p>
    </div>
  );
}
