import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { EVIDENCE_SOURCES, INSTRUMENTS, PROFILE_BLOCKS, READINESS, anyRelation, mayGuide } from "@/lib/team-rules";
import { getTeamPolicy, roleVersions, rolesInForce, viewablePeople } from "@/lib/team-store";
import { profile360 } from "@/lib/team-views";
import { NoAccess, Notes, PersonSwitch, PrivacySelect, PrivacyTag, qp, tOf } from "../ui";
import { addAssessment, addCharacterEvidence, addEntry, archiveEntry, removeAssessment, setEntryPrivacy, withdrawCharacterEvidence } from "../actions";
import { saveReadiness } from "../role-actions";

// Módulo 16 §2–3, §12 · Team Member 360. The person writes who they are, their talents, what they do and what they
// hold, and chooses who sees each line. Character is only what was shown in a decision, with its situation and its
// day. A leader or mentor reads what the person shared; Gerencia, what is organisational. Labour data lives in
// Administración and is not shown here.

export default async function Profile360Page({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; p?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const personId = sp.p || user.id;
  const [v, people, pol] = await Promise.all([profile360(user, personId), viewablePeople(user), getTeamPolicy()]);
  if (!v) notFound();
  if (!anyRelation(v.rel)) return <NoAccess i={i} back="/equipo/perfil" />;
  const self = v.rel.self, guide = mayGuide(v.rel), leaderish = !self && (v.rel.leader || v.rel.gerencia);
  const T = today();
  const back = `/equipo/perfil${qp(personId, user.id)}`;
  const roles = leaderish ? rolesInForce(await roleVersions(), T) : [];
  const blocks = Object.entries(PROFILE_BLOCKS).filter(([k]) => self || (k !== "REFLECTION"));
  const leaderBlocks = ["SER", "TALENT", "HACER", "TENER"];
  const ok = {
    linea: t("Guardado.", "Saved."), privacidad: t("Listo: cambió quién lo ve.", "Done: who sees it has changed."), quitada: t("Quitado.", "Removed."),
    assessment: t("Guardado. Es tuyo: tú decides si lo compartes.", "Saved. It is yours: you decide whether to share it."),
    caracter: t("Evidencia registrada. La persona siempre la ve.", "Evidence recorded. The person always sees it."), readiness: t("Guardado. La evaluación anterior queda en la historia.", "Saved. The earlier assessment stays in the history."),
  };
  const err = {
    permiso: t("No tienes permiso para esto.", "You don't have permission for this."), linea: t("Falta el tipo o el texto. No se guardó nada.", "The kind or the text is missing. Nothing was saved."),
    "privado-lider": t("Esa línea la escribió tu líder: puedes abrirla a la organización, pero no ocultársela a quien la escribió.", "Your leader wrote that line: you can open it to the organisation, but not hide it from whoever wrote it."),
    assessment: t("Faltan datos: instrumento, resultado, de dónde viene y la fecha (no futura). No se guardó nada.", "Missing data: instrument, result, where it comes from and the date (not in the future). Nothing was saved."),
    caracter: t("Faltan datos: dimensión, qué hizo la persona, en qué situación, el día (no futuro) y cómo se sabe. No se guardó nada.", "Missing data: dimension, what the person did, in which situation, the day (not in the future) and how it is known. Nothing was saved."),
    test: t("El carácter se demuestra en decisiones. Describe lo que la persona hizo y en qué situación, sin apoyarte en un test de personalidad (DISC, Eneagrama, zodiaco u otro). No se guardó nada.", "Character is shown in decisions. Describe what the person did and in which situation, without leaning on a personality test (DISC, Enneagram, zodiac or other). Nothing was saved."),
    nota: t("Escribe por qué se retira.", "Write why it is withdrawn."),
    "readiness-permiso": t("La preparación para un rol la registra quien acompaña a la persona (su líder) o Gerencia.", "Readiness for a role is recorded by whoever accompanies the person (their leader) or Management."),
    readiness: t("Faltan datos: el rol, el estado y la evidencia; si aún no está lista, también las brechas y el plan. No se guardó nada.", "Missing data: the role, the state and the evidence; if not ready yet, also the gaps and the plan. Nothing was saved."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{self ? t("Mi perfil 360", "My 360 profile") : v.person.name}</h1>
        <p>{self ? t("Quién eres, tus talentos, lo que haces y lo que tienes. Tú decides quién ve cada línea.", "Who you are, your talents, what you do and what you hold. You decide who sees each line.") : t("Lo que la persona decidió compartir contigo. Sirve para acompañarla, no para clasificarla.", "What the person chose to share with you. It serves to accompany them, not to classify them.")}</p>
        <p className="small">{v.base?.roleProfile?.title ?? v.base?.contractualTitle ?? t("Sin cargo registrado", "No title recorded")}{v.base?.level ? ` · ${v.base.level}` : ""}{v.base?.leader ? ` · ${t("líder", "leader")}: ${v.base.leader.name}` : ""} · {t("rol en SOLU", "role in SOLU")}: {tx(ROLE_LABEL[v.person.role])}{!v.person.active ? <span className="sig wait" style={{ marginLeft: 6 }}>{t("cuenta inactiva: la historia se conserva", "account inactive: the history is kept")}</span> : null}</p>
      </div><span className="grow" /><PersonSwitch people={people} current={personId} me={user.id} path="/equipo/perfil" i={i} /></div>
      <Notes sp={sp} ok={ok} err={err} />
      {!self && <p className="src">{v.rel.leader || v.rel.mentor ? t("Ves lo que la persona marcó como compartido u organizacional. Sus reflexiones privadas no se muestran aquí.", "You see what the person marked as shared or organisational. Their private reflections are not shown here.") : t("Como Gerencia ves solo lo que la persona marcó como organizacional.", "As Management you see only what the person marked as organisational.")}</p>}

      <section className="card" id="historia-roles"><b>{t("IDENTIDAD ORGANIZACIONAL E HISTORIA DE ROLES", "ORGANISATIONAL IDENTITY AND ROLE HISTORY")}</b> <Link className="small" href={`/equipo/mi-rol${qp(personId, user.id)}`}>{t("Ver el rol", "See the role")}</Link>
        {v.history.length === 0 ? <p className="small muted">{t("Sin asignaciones registradas.", "No assignments recorded.")} <Link href={`/administracion/personas/${personId}`}>{t("Ver la ficha administrativa, donde se registran", "See the administrative record, where they are recorded")} →</Link></p> : (
          <ul className="plain">{v.history.map((h) => <li key={h.id}><span className="small mono">{i.day(h.effectiveFrom)} → {h.effectiveTo ? i.day(h.effectiveTo) : t("hoy", "today")}</span> · <b>{h.roleProfile?.title ?? h.contractualTitle}</b>{h.roleProfile ? <span className="src"> · {t("acuerdo", "agreement")} v{h.roleProfile.version}</span> : null}{h.level ? ` · ${h.level}` : ""}{h.acting ? <span className="sig wait" style={{ marginLeft: 6 }}>{t("temporal", "temporary")}</span> : null}{h.leader ? <span className="muted"> · {t("líder", "leader")}: {h.leader.name}</span> : null}</li>)}</ul>
        )}
      </section>

      {blocks.map(([key, b]) => {
        const rows = v.entries.filter((e) => e.block === key);
        const mayAdd = self || (v.rel.leader && leaderBlocks.includes(key));
        return (
          <section className="card" key={key} id={`b-${key}`}><b>{tx(b).toUpperCase()}</b> <span className="small muted">{tx(b.hint)}</span>
            {rows.length === 0 ? <p className="small muted">{self ? t("Aún no has escrito nada aquí.", "You haven't written anything here yet.") : t("Nada compartido.", "Nothing shared.")}</p> : (
              <ul className="plain">{rows.map((e) => (
                <li key={e.id}><span className="sig wait">{b.kinds[e.kind] ? tx(b.kinds[e.kind]) : e.kind}</span> {e.text}{e.detail ? <span className="muted"> · {e.detail}</span> : null} {self ? <PrivacyTag value={e.privacy} i={i} /> : null}{e.source === "LEADER" ? <span className="src"> · {t("lo anotó", "noted by")} {e.addedByName}</span> : null}
                  {(self || e.addedById === user.id) && (
                    <details className="eq-edit" style={{ display: "inline-block", marginLeft: 8, verticalAlign: "top" }}><summary className="small">{self ? t("cambiar quién lo ve o quitar", "change who sees it or remove") : t("quitar", "remove")}</summary>
                      <span className="qa-row" style={{ marginTop: 4 }}>
                        {self && <form action={setEntryPrivacy.bind(null, e.id)} className="qa-row"><input type="hidden" name="back" value={back} /><PrivacySelect i={i} value={e.privacy} /><button type="submit" className="secondary sm">{t("Guardar", "Save")}</button></form>}
                        <form action={archiveEntry.bind(null, e.id)}><input type="hidden" name="back" value={back} /><button type="submit" className="secondary sm" data-confirm={t("¿Quitar esta línea?", "Remove this line?")}>{t("Quitar", "Remove")}</button></form>
                      </span>
                    </details>
                  )}
                </li>
              ))}</ul>
            )}
            {mayAdd && (
              <details><summary className="small">{self ? t("Agregar", "Add") : t("Anotar algo que observas (la persona lo verá)", "Note something you observe (the person will see it)")}</summary>
                <form action={addEntry.bind(null, personId)} className="qa-form">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="block" value={key} />
                  <div className="qa-row">
                    <label>{t("Tipo", "Kind")}<select name="kind">{Object.entries(b.kinds).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                    <label style={{ flex: 3 }}>{t("Qué", "What")}<input name="text" required maxLength={400} /></label>
                  </div>
                  <label>{t("Detalle (opcional)", "Detail (optional)")}<input name="detail" maxLength={600} /></label>
                  {self ? <label>{t("Quién lo ve", "Who sees it")}<PrivacySelect i={i} value={b.defaultPrivacy} /></label> : <p className="src">{t("Lo que anotas sobre otra persona siempre es visible para ella.", "What you note about someone else is always visible to them.")}</p>}
                  <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button></div>
                </form>
              </details>
            )}
          </section>
        );
      })}

      {(self || v.rel.leader || v.rel.mentor) && (
        <section className="card" id="assessments"><b>{t("ASSESSMENTS (OPCIONALES)", "ASSESSMENTS (OPTIONAL)")}</b> <span className="small muted">{t("Un test puede explicar tendencias; nunca define el carácter ni evalúa a nadie.", "A test may explain tendencies; it never defines character or evaluates anyone.")}</span>
          {v.assessments.length === 0 ? <p className="small muted">{self ? t("Ninguno. Es voluntario.", "None. It is voluntary.") : t("Nada compartido.", "Nothing shared.")}</p> : (
            <ul className="plain">{v.assessments.map((a) => (
              <li key={a.id}><span className={`sig ${INSTRUMENTS[a.instrument]?.playful ? "dash" : "wait"}`}>{INSTRUMENTS[a.instrument] ? tx(INSTRUMENTS[a.instrument]) : a.instrument}</span> {a.label ? <b>{a.label}: </b> : null}{a.result} <span className="src">· {t("fuente", "source")}: {a.source} · {i.date(a.takenOn)}</span> {self ? <PrivacyTag value={a.privacy} i={i} /> : null}
                {self && <form action={removeAssessment.bind(null, a.id)} style={{ display: "inline", marginLeft: 8 }}><button type="submit" className="secondary sm" data-confirm={t("¿Quitar este assessment?", "Remove this assessment?")}>{t("Quitar", "Remove")}</button></form>}
              </li>
            ))}</ul>
          )}
          {self && (
            <details open={sp.err === "assessment"}><summary className="small">{t("Agregar un assessment", "Add an assessment")}</summary>
              <form action={addAssessment} className="qa-form">
                <div className="qa-row">
                  <label>{t("Instrumento", "Instrument")}<select name="instrument">{Object.entries(INSTRUMENTS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                  <label>{t("Nombre (si es otro)", "Name (if other)")}<input name="label" maxLength={80} /></label>
                  <label>{t("Fecha", "Date")}<input type="date" name="takenOn" required max={dayInput(T)} /></label>
                </div>
                <label>{t("Resultado", "Result")}<input name="result" required maxLength={600} /></label>
                <div className="qa-row">
                  <label style={{ flex: 2 }}>{t("De dónde viene (quién lo aplicó, informe)", "Where it comes from (who ran it, report)")}<input name="source" required maxLength={200} /></label>
                  <label>{t("Quién lo ve", "Who sees it")}<PrivacySelect i={i} value="PRIVATE" levels={["PRIVATE", "SHARED"]} /></label>
                </div>
                <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button></div>
              </form>
            </details>
          )}
        </section>
      )}

      <section className="card" id="caracter"><b>{t("CARÁCTER: EVIDENCIA", "CHARACTER: EVIDENCE")}</b> <span className="small muted">{t("El carácter se demuestra en decisiones: conductas que alguien vio, con su situación y su día.", "Character is shown in decisions: conduct someone saw, with its situation and its day.")}</span>
        {v.character.length === 0 ? <p className="small muted">{t("Sin evidencia registrada.", "No evidence recorded.")}{guide ? <> {t("Usa «Registrar una conducta observada», aquí abajo.", "Use “Registrar una conducta observada”, just below.")}</> : <> {t("La registra quien acompaña a la persona, aquí mismo.", "Whoever guides the person records it, right here.")}</>}</p> : (
          <ul className="plain">{v.character.map((c) => (
            <li key={c.id}><span className="sig info">{c.dimension}</span> {c.behavior} {self ? <PrivacyTag value={c.privacy} i={i} /> : null}
              <span className="src block">{t("Situación", "Situation")}: {c.context} · {i.date(c.observedOn)} · {EVIDENCE_SOURCES[c.sourceKind] ? tx(EVIDENCE_SOURCES[c.sourceKind]) : c.sourceKind}{c.sourceRef ? ` (${c.sourceRef})` : ""} · {c.recordedByName}</span>
              {c.recordedById === user.id && <form action={withdrawCharacterEvidence.bind(null, c.id)} className="qa-row" style={{ marginTop: 4 }}><input type="hidden" name="back" value={back} /><input name="note" required maxLength={300} placeholder={t("Por qué se retira", "Why it is withdrawn")} aria-label={t("Por qué se retira", "Why it is withdrawn")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Retirar", "Withdraw")}</button></form>}
            </li>
          ))}</ul>
        )}
        {guide && (
          <details open={sp.err === "caracter" || sp.err === "test"}><summary className="small">{t("Registrar una conducta observada", "Record an observed conduct")}</summary>
            <form action={addCharacterEvidence.bind(null, personId)} className="qa-form">
              <input type="hidden" name="back" value={back} />
              <div className="qa-row">
                <label>{t("Dimensión", "Dimension")}<select name="dimension">{pol.value.dimensions.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
                <label>{t("Día", "Day")}<input type="date" name="observedOn" required max={dayInput(T)} defaultValue={dayInput(T)} /></label>
                {!self && <label>{t("Cómo se sabe", "How it is known")}<select name="sourceKind">{Object.entries(EVIDENCE_SOURCES).filter(([k]) => k !== "SELF").map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>}
              </div>
              <label>{t("Qué hizo la persona (la conducta, no una opinión)", "What the person did (the conduct, not an opinion)")}<textarea name="behavior" rows={2} required maxLength={800} /></label>
              <label>{t("En qué situación", "In which situation")}<textarea name="context" rows={2} required maxLength={600} /></label>
              <div className="qa-row">
                <label style={{ flex: 2 }}>{t("Dónde quedó (opcional: Necesidad, correo, reunión)", "Where it is (optional: Necessity, email, meeting)")}<input name="sourceRef" maxLength={200} /></label>
                <label>{t("Quién lo ve", "Who sees it")}<PrivacySelect i={i} value="SHARED" levels={self ? ["PRIVATE", "SHARED", "ORG"] : ["SHARED", "ORG"]} /></label>
              </div>
              <div><button type="submit" className="secondary">{t("Registrar", "Record")}</button></div>
            </form>
          </details>
        )}
        <p className="src">{t("SOLU nunca crea evidencia de carácter a partir de un test, y no existe una calificación de carácter.", "SOLU never creates character evidence from a test, and there is no character rating.")}</p>
      </section>

      {(guide || v.rel.gerencia) && (
        <section className="card" id="readiness"><b>{t("PREPARACIÓN PARA UN ROL O NIVEL", "READINESS FOR A ROLE OR LEVEL")}</b>
          {v.readiness.length === 0 ? <p className="small muted">{t("Sin evaluaciones registradas.", "No assessments recorded.")} {t("Las registra el líder, aquí mismo, contra un acuerdo de rol.", "The leader records them, right here, against a role agreement.")}</p> : (
            <ul className="plain">{v.readiness.map((r) => <li key={r.id} style={r.supersededAt ? { opacity: 0.6 } : undefined}><span className={`sig ${READINESS[r.state]?.tone ?? "wait"}`}>{READINESS[r.state] ? tx(READINESS[r.state]) : r.state}</span> <b>{r.roleKey}</b>{r.level ? ` · ${r.level}` : ""} <span className="src">· {r.assessedByName} · {i.day(r.assessedOn)}{r.supersededAt ? ` · ${t("reemplazada", "superseded")}` : ""}</span><span className="src block">{t("Evidencia", "Evidence")}: {r.evidence}{r.gaps ? ` · ${t("Brechas", "Gaps")}: ${r.gaps}` : ""}{r.plan ? ` · ${t("Plan", "Plan")}: ${r.plan}` : ""}</span></li>)}</ul>
          )}
          {leaderish && (roles.length === 0 ? <p className="small muted">{t("Aún no hay acuerdos de rol publicados contra los que evaluar.", "No role agreements published yet to assess against.")} <Link href="/equipo/roles">{t("Abrir Acuerdos de rol", "Open Role agreements")} →</Link></p> : (
            <details open={sp.err === "readiness"}><summary className="small">{t("Registrar una evaluación", "Record an assessment")}</summary>
              <form action={saveReadiness.bind(null, personId)} className="qa-form">
                <input type="hidden" name="back" value={back} />
                <div className="qa-row">
                  <label>{t("Rol", "Role")}<select name="roleKey">{roles.map((r) => <option key={r.roleKey} value={r.roleKey}>{r.title}</option>)}</select></label>
                  <label>{t("Nivel (opcional)", "Level (optional)")}<input name="level" maxLength={80} /></label>
                  <label>{t("Estado", "State")}<select name="state">{Object.entries(READINESS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
                  <label>{t("Fecha", "Date")}<input type="date" name="assessedOn" max={dayInput(T)} defaultValue={dayInput(T)} /></label>
                </div>
                <label>{t("Evidencia (obligatoria)", "Evidence (required)")}<textarea name="evidence" rows={2} required maxLength={1000} /></label>
                <div className="qa-row" style={{ alignItems: "flex-start" }}>
                  <label style={{ flex: "1 1 260px" }}>{t("Brechas (si aún no está lista)", "Gaps (if not ready yet)")}<textarea name="gaps" rows={2} maxLength={1000} /></label>
                  <label style={{ flex: "1 1 260px" }}>{t("Plan para cerrarlas", "Plan to close them")}<textarea name="plan" rows={2} maxLength={1000} /></label>
                </div>
                <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button></div>
              </form>
            </details>
          ))}
          <p className="src">{t("Es una lectura con evidencia en un momento dado, no un puntaje. La persona la ve.", "It is a reading with evidence at a point in time, not a score. The person sees it.")}</p>
        </section>
      )}
      {self && <p className="src">{t("Tus datos laborales (contrato, ausencias, remuneración) están en Administración → Personas y no se mezclan con este perfil.", "Your labour data (contract, absences, pay) is in Administration → People and is not mixed with this profile.")} <Link href={`/administracion/personas/${user.id}`}>{t("Abrir", "Open")}</Link></p>}
    </div>
  );
}
