import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isGerencia, ROLE_LABEL } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { AREAS, DECISION_KINDS, DECISION_STAGE, VERDICTS, asPairs, decisionStage } from "@/lib/gerencia-rules";
import { canReadDecision, decisionInclude } from "@/lib/gerencia-store";
import { Notes } from "../../ui";
import { decide, reviewDecision, reviseDecision, withdraw } from "../actions";

// Módulo 15 §4 · one Management Decision Record: the question as it was asked, the options, facts apart from
// assumptions, what was decided and under which authority, what was expected, and what happened (AC7, AC16, AC20).

export default async function DecisionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; f?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const d = await db.managementDecision.findUnique({ where: { id }, include: decisionInclude });
  if (!d || !canReadDecision(user, d)) notFound();
  const [versions, people] = await Promise.all([
    db.managementDecision.findMany({ where: { code: d.code }, orderBy: { version: "desc" }, select: { id: true, version: true, decidedAt: true, decidedByName: true, revisionReason: true, supersededAt: true, status: true } }),
    isGerencia(user) ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const T = today();
  const s = decisionStage(d, T);
  const ger = isGerencia(user);
  const alts = asPairs(d.alternatives);
  const miss = new Set((sp.f ?? "").split(","));
  const need = (k: string) => (miss.has(k) ? { style: { borderColor: "var(--risk)" } } : {});
  const canReview = d.status === "DECIDED" && !d.supersededAt && (ger || d.ownerAfterId === user.id);
  const ok = { pedida: t("Decisión pedida. Gerencia la ve en su Inicio.", "Decision requested. Management sees it on its Home."), decidida: t("Decisión registrada. SOLU pedirá revisarla contra lo que pase en la fecha de seguimiento.", "Decision recorded. SOLU will ask to review it against what happens on the follow-up date."), retirada: t("Solicitud retirada. Queda en el registro.", "Request withdrawn. It stays in the record."), revisada: t("Revisión guardada.", "Review saved."), version: t("Versión nueva guardada. La anterior queda a la vista, marcada como reemplazada.", "New version saved. The earlier one stays visible, marked as replaced.") };
  const err = { gerencia: t("Solo Gerencia decide.", "Only Management decides."), permiso: t("No tienes permiso para eso.", "You don't have permission for that."), estado: t("Esa acción ya no aplica: la decisión cambió de estado.", "That action no longer applies: the decision changed state."), motivo: t("Escribe por qué se retira.", "Write why it is withdrawn."), decidir: t("Falta lo marcado en rojo: qué se decide, por qué, qué se espera que pase, cuándo se revisa (de hoy en adelante) y quién queda a cargo. No se guardó nada.", "What is marked in red is missing: what is decided, why, what is expected to happen, when it is reviewed (today or later) and who is left in charge. Nothing was saved."), revision: t("Escribe qué pasó de verdad y elige cómo resultó.", "Write what really happened and choose how it turned out."), proxima: t("Si todavía es pronto, escribe la nueva fecha de revisión (posterior a hoy).", "If it is still too early, give the new review date (after today).") };

  const decideFields = (prefill: boolean) => (
    <>
      <label>{t("Qué se decide", "What is decided")}<textarea name="decision" required rows={3} maxLength={2000} defaultValue={prefill ? d.decision ?? "" : ""} {...need("decision")} /></label>
      <div className="qa-row">
        <label style={{ flex: "1 1 220px" }}>{t("Opción elegida", "Option chosen")}<select name="chosen" defaultValue={prefill ? d.chosen ?? "" : ""}><option value="">{t("Otra, descrita arriba", "Another one, described above")}</option>{alts.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}</select></label>
        <label style={{ flex: "1 1 220px" }}>{t("Con qué autoridad", "Under which authority")}<input name="authority" maxLength={200} defaultValue={prefill && d.authority ? d.authority : ROLE_LABEL[user.role].es} {...need("authority")} /></label>
      </div>
      <label>{t("Por qué esta y no las otras", "Why this one and not the others")}<textarea name="rationale" required rows={3} maxLength={2000} defaultValue={prefill ? d.rationale ?? "" : ""} {...need("rationale")} /></label>
      <label>{t("Qué se espera que pase", "What is expected to happen")}<textarea name="expectedConsequence" required rows={2} maxLength={2000} defaultValue={prefill ? d.expectedConsequence ?? "" : ""} {...need("expectedConsequence")} /></label>
      <div className="qa-row">
        <label style={{ flex: "1 1 180px" }}>{t("Revisar qué pasó el", "Review what happened on")}<input type="date" name="followUpOn" required min={dayInput(T)} {...need("followUpOn")} {...need("followUpPast")} /></label>
        <label style={{ flex: "1 1 220px" }}>{t("Quién queda a cargo", "Who is left in charge")}<select name="ownerAfterId" required defaultValue={prefill ? d.ownerAfterId ?? "" : d.requestedById} {...need("ownerAfter")}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
    </>
  );

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/gerencia/decisiones">{t("Decisiones", "Decisions")}</Link></div>
        <h1><span className="mono">{d.code}</span>{d.version > 1 ? ` · v${d.version}` : ""}</h1>
        <p>{d.question}</p>
        <p className="small"><span className={`sig ${DECISION_STAGE[s.stage].tone}`}>{t(DECISION_STAGE[s.stage].es, DECISION_STAGE[s.stage].en)}</span> <span className="sig wait">{t(AREAS[d.area]?.es ?? d.area, AREAS[d.area]?.en ?? d.area)}</span> <span className="sig wait">{t(DECISION_KINDS[d.kind]?.es ?? d.kind, DECISION_KINDS[d.kind]?.en ?? d.kind)}</span> · {t("pedida por", "asked by")} {d.requestedByName} · {i.date(d.requestedAt)}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />
      {d.supersededAt && <div className="note attn">{t("Esta versión fue reemplazada. Se conserva tal como se decidió.", "This version was replaced. It is kept exactly as it was decided.")} {versions[0] && versions[0].id !== d.id ? <Link href={`/gerencia/decisiones/${versions[0].id}`}>{t("Abrir la versión vigente", "Open the version in force")}</Link> : null}</div>}

      <section className="card" id="pregunta"><b>{t("LO QUE SE PREGUNTÓ", "WHAT WAS ASKED")}</b>
        <dl className="qv-dl">
          <dt>{t("Contexto", "Context")}</dt><dd className="gm-pre">{d.context}</dd>
          {d.whyNow && <><dt>{t("Por qué ahora", "Why now")}</dt><dd className="gm-pre">{d.whyNow}</dd></>}
          <dt>{t("Cuánto pesa", "Impact")}</dt><dd>{d.impact}{d.impactUsd != null ? <span className="mono"> · {i.money2(d.impactUsd)}</span> : null}</dd>
          <dt>{t("Opciones consideradas", "Options considered")}</dt><dd><ul className="plain">{alts.map((a) => <li key={a.name}><b>{a.name}</b>{a.detail ? `: ${a.detail}` : ""}{d.chosen === a.name ? <span className="sig ok" style={{ marginLeft: 6 }}>{t("elegida", "chosen")}</span> : null}</li>)}</ul></dd>
          <dt>{t("Hechos y evidencia", "Facts and evidence")}</dt><dd className="gm-pre">{d.facts}</dd>
          <dt>{t("Supuestos", "Assumptions")}</dt><dd className="gm-pre">{d.assumptions ?? <span className="muted">{t("No se escribieron supuestos", "No assumptions were written")}</span>}</dd>
          <dt>{t("Riesgos y sacrificios", "Risks and trade-offs")}</dt><dd className="gm-pre">{d.risks ?? "—"}</dd>
          {d.recommendation && <><dt>{t("Recomendación de quien pidió", "Requester's recommendation")}</dt><dd className="gm-pre">{d.recommendation}</dd></>}
          <dt>{t("Se necesita antes del", "Needed before")}</dt><dd>{d.deadline ? i.date(d.deadline) : "—"}</dd>
          {d.sourceHref && <><dt>{t("Registro del que trata", "Record it is about")}</dt><dd><Link href={d.sourceHref}>{d.sourceLabel ?? d.sourceHref}</Link></dd></>}
          {d.scenario && <><dt>{t("Escenario", "Scenario")}</dt><dd><Link href={`/gerencia/escenarios#s-${d.scenario.id}`}>{d.scenario.title}</Link></dd></>}
        </dl>
      </section>

      {d.status === "DECIDED" && (
        <section className="card" id="decision"><b>{t("LO QUE SE DECIDIÓ", "WHAT WAS DECIDED")}</b>
          {d.revisionReason && <p className="small"><span className="sig info">{t(`Versión ${d.version}`, `Version ${d.version}`)}</span> {t("Motivo del cambio", "Reason for the change")}: {d.revisionReason}</p>}
          <dl className="qv-dl">
            <dt>{t("Decisión", "Decision")}</dt><dd className="gm-pre"><b>{d.decision}</b></dd>
            <dt>{t("Por qué", "Why")}</dt><dd className="gm-pre">{d.rationale}</dd>
            <dt>{t("Autoridad", "Authority")}</dt><dd>{d.authority} · {d.decidedByName} · {i.date(d.decidedAt)}</dd>
            <dt>{t("Qué se esperaba", "What was expected")}</dt><dd className="gm-pre">{d.expectedConsequence}</dd>
            <dt>{t("Seguimiento", "Follow-up")}</dt><dd>{i.date(d.followUpOn)} · {t("a cargo de", "in the care of")} {d.ownerAfter?.name ?? "—"}</dd>
          </dl>
        </section>
      )}
      {d.status === "WITHDRAWN" && <section className="card"><b>{t("RETIRADA", "WITHDRAWN")}</b><p className="small">{d.withdrawnNote}</p></section>}

      {d.status === "DECIDED" && (
        <section className="card" id="revision"><b>{t("LO QUE PASÓ DE VERDAD", "WHAT REALLY HAPPENED")}</b>
          {d.reviews.length === 0 ? <p className="small muted">{s.stage === "REVIEW_DUE" ? t("Llegó la fecha de revisión y todavía no se ha escrito qué pasó.", "The review date arrived and what happened has not been written yet.") : t(`Se revisa a partir del ${i.date(s.reviewOn)}.`, `To be reviewed from ${i.date(s.reviewOn)}.`)}</p> : (
            <ul className="plain">{d.reviews.map((r) => <li key={r.id} style={{ marginBottom: 8 }}><span className={`sig ${VERDICTS[r.verdict]?.tone ?? "wait"}`}>{t(VERDICTS[r.verdict]?.es ?? r.verdict, VERDICTS[r.verdict]?.en ?? r.verdict)}</span> <span className="gm-pre">{r.actualConsequence}</span><span className="src block">{r.byName} · {i.date(r.createdAt)}{r.nextFollowUpOn ? ` · ${t("volver a revisar el", "review again on")} ${i.date(r.nextFollowUpOn)}` : ""}</span></li>)}</ul>
          )}
          {canReview && (
            <details open={s.stage === "REVIEW_DUE"}><summary className="small">{d.reviews.length ? t("Agregar otra revisión", "Add another review") : t("Escribir qué pasó", "Write what happened")}</summary>
              <form action={reviewDecision.bind(null, d.id)} className="qa-form">
                <label>{t("Qué pasó, comparado con lo que se esperaba", "What happened, compared with what was expected")}<textarea name="actualConsequence" required rows={3} maxLength={2000} /></label>
                <div className="qa-row">
                  <label style={{ flex: "1 1 240px" }}>{t("Cómo resultó", "How it turned out")}<select name="verdict" required defaultValue="">{[<option key="" value="" disabled>{t("Elegir", "Choose")}</option>, ...Object.entries(VERDICTS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)]}</select></label>
                  <label style={{ flex: "1 1 200px" }}>{t("Si es pronto, volver a revisar el", "If too early, review again on")}<input type="date" name="nextFollowUpOn" /></label>
                </div>
                <div><button type="submit" className="secondary">{t("Guardar la revisión", "Save the review")}</button></div>
              </form>
            </details>
          )}
          <p className="src">{t("Una revisión se agrega y no se edita: así la decisión puede compararse con su consecuencia real.", "A review is added and never edited: that way the decision can be compared with its real consequence.")}</p>
        </section>
      )}

      {ger && d.status === "REQUESTED" && !d.supersededAt && (
        <section className="card" id="decidir"><b>{t("DECIDIR", "DECIDE")}</b>
          <form action={decide.bind(null, d.id)} className="qa-form">{decideFields(false)}<div><button type="submit">{t("Registrar la decisión", "Record the decision")}</button></div></form>
        </section>
      )}
      {d.status === "REQUESTED" && !d.supersededAt && (ger || d.requestedById === user.id) && (
        <section className="card" id="retirar"><details><summary className="small">{t("Retirar la solicitud: ya no hace falta decidir", "Withdraw the request: a decision is no longer needed")}</summary>
          <form action={withdraw.bind(null, d.id)} className="qa-row" style={{ alignItems: "center" }}><input name="note" required maxLength={500} placeholder={t("Por qué se retira", "Why it is withdrawn")} aria-label={t("Por qué se retira", "Why it is withdrawn")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Retirar", "Withdraw")}</button></form>
        </details></section>
      )}
      {ger && d.status === "DECIDED" && !d.supersededAt && (
        <section className="card" id="nueva-version"><details open={sp.err === "decidir"}><summary className="small">{t("La decisión cambió: escribir una versión nueva", "The decision changed: write a new version")}</summary>
          <form action={reviseDecision.bind(null, d.id)} className="qa-form">
            <label>{t("Por qué cambia", "Why it changes")}<input name="revisionReason" required maxLength={1000} {...need("revisionReason")} /></label>
            {decideFields(true)}
            <div className="qa-row" style={{ alignItems: "flex-start" }}>
              <label style={{ flex: "1 1 280px" }}>{t("Hechos, si hay nuevos", "Facts, if there are new ones")}<textarea name="facts" rows={3} maxLength={3000} defaultValue={d.facts} /></label>
              <label style={{ flex: "1 1 280px" }}>{t("Supuestos, si cambiaron", "Assumptions, if they changed")}<textarea name="assumptions" rows={3} maxLength={2000} defaultValue={d.assumptions ?? ""} /></label>
            </div>
            <div><button type="submit" className="secondary">{t("Guardar como versión nueva", "Save as a new version")}</button></div>
          </form>
        </details></section>
      )}

      {versions.length > 1 && (
        <section className="card" id="versiones"><b>{t("VERSIONES DE ESTA DECISIÓN", "VERSIONS OF THIS DECISION")}</b>
          <ul className="plain small">{versions.map((v) => <li key={v.id}>{v.id === d.id ? <b>v{v.version}</b> : <Link href={`/gerencia/decisiones/${v.id}`}>v{v.version}</Link>} · {v.decidedAt ? `${i.date(v.decidedAt)} · ${v.decidedByName}` : t("sin decidir", "not decided")}{v.revisionReason ? ` · ${v.revisionReason}` : ""} · {v.supersededAt ? t("reemplazada", "replaced") : t("vigente", "in force")}</li>)}</ul>
        </section>
      )}
    </>
  );
}
