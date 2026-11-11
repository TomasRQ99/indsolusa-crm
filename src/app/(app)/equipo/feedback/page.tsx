import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/domain";
import { DIMS, DIM_KEYS, FEEDBACK_PARTS, FEEDBACK_RELATIONS } from "@/lib/team-rules";
import { reportIdsOf } from "@/lib/team-store";
import { Notes, tOf } from "../ui";
import { addOpportunity, declineFeedback, giveFeedback, requestFeedback } from "../actions";

// Módulo 16 §10 · Feedback 360: self, leader, peers, mentor and other functions, always as Continue / Start /
// Improve / Reduce. Feedback carries the name of whoever gives it. The person it is about and their leader read it;
// either may turn it into a development opportunity.

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const T = today();
  const reports = await reportIdsOf(user.id);
  const [asked, received, given, team, people, opps] = await Promise.all([
    db.feedback.findMany({ where: { fromId: user.id, status: "REQUESTED" }, orderBy: { createdAt: "asc" }, include: { about: { select: { id: true, name: true } } } }),
    db.feedback.findMany({ where: { aboutId: user.id, createdAt: { gte: addDays(T, -365) } }, orderBy: { createdAt: "desc" }, take: 60, include: { from: { select: { name: true } } } }),
    db.feedback.findMany({ where: { fromId: user.id, status: "GIVEN", aboutId: { not: user.id }, givenAt: { gte: addDays(T, -180) } }, orderBy: { givenAt: "desc" }, take: 30, include: { about: { select: { name: true } } } }),
    reports.length ? db.feedback.findMany({ where: { aboutId: { in: reports }, status: "GIVEN", givenAt: { gte: addDays(T, -180) } }, orderBy: { givenAt: "desc" }, take: 60, include: { about: { select: { id: true, name: true } }, from: { select: { name: true } } } }) : [],
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.developmentOpportunity.findMany({ where: { source: "FEEDBACK", status: { not: "DISMISSED" }, userId: { in: [user.id, ...reports] } }, select: { sourceRef: true } }),
  ]);
  const others = people.filter((p) => p.id !== user.id);
  const taken = new Set(opps.map((o) => o.sourceRef));
  const mineGiven = received.filter((f) => f.status === "GIVEN"), waiting = received.filter((f) => f.status === "REQUESTED");
  const ok = { pedido: t("Feedback pedido. La persona lo verá en su campana.", "Feedback requested. The person will see it on their bell."), dado: t("Feedback entregado. Gracias por tomarte el tiempo.", "Feedback given. Thank you for taking the time."), declinado: t("Listo: la solicitud quedó declinada.", "Done: the request was declined."), oportunidad: t("Quedó como oportunidad de desarrollo.", "It is now a development opportunity.") };
  const err = {
    permiso: t("No tienes permiso para esto.", "You don't have permission for this."), pedir: t("Elige a quién pedírselo y la relación. «Yo mismo» solo aplica cuando te lo das a ti.", "Choose whom to ask and the relation. “Self” only applies when you give it to yourself."),
    "ya-pedido": t("Ya hay una solicitud abierta a esa persona.", "There is already an open request to that person."), dar: t("Elige sobre quién y la relación.", "Choose about whom and the relation."),
    vacio: t("Escribe al menos una de las cuatro partes: continuar, empezar, mejorar o reducir. No se guardó nada.", "Write at least one of the four parts: continue, start, improve or reduce. Nothing was saved."),
  };
  const Parts = ({ f }: { f: Record<string, unknown> }) => <>{FEEDBACK_PARTS.filter((p) => f[p.key]).map((p) => <span key={p.key} className="src block"><b>{tx(p)}:</b> {String(f[p.key])}</span>)}</>;
  const Fields = () => <div className="eq-form-grid">{FEEDBACK_PARTS.map((p) => <label key={p.key}>{tx(p)} <span className="src">{tx(p.hint)}</span><textarea name={p.key} rows={2} maxLength={1500} /></label>)}</div>;
  const ToOpp = ({ f, personId }: { f: { id: string; improveText: string | null; startText: string | null; reduceText: string | null; continueText: string | null }; personId: string }) => taken.has(f.id) ? <span className="src">{t("Ya es una oportunidad de desarrollo.", "Already a development opportunity.")} <Link href={`/equipo/desarrollo${personId === user.id ? "" : `?p=${personId}`}#oportunidades`}>{t("Ver", "See")}</Link></span> : (
    <details><summary className="small">{t("Convertir en oportunidad de desarrollo", "Turn into a development opportunity")}</summary>
      <form action={addOpportunity.bind(null, personId)} className="qa-form">
        <input type="hidden" name="back" value="/equipo/feedback" /><input type="hidden" name="source" value="FEEDBACK" /><input type="hidden" name="sourceRef" value={f.id} />
        <div className="qa-row"><label>{t("Dimensión", "Dimension")}<select name="dimension" defaultValue="HACER">{DIM_KEYS.map((d) => <option key={d} value={d}>{tx(DIMS[d])}</option>)}</select></label>
          <label style={{ flex: 3 }}>{t("Qué vale la pena desarrollar", "What is worth developing")}<input name="what" required maxLength={400} defaultValue={(f.improveText ?? f.startText ?? f.reduceText ?? f.continueText ?? "").slice(0, 400)} /></label></div>
        <div><button type="submit" className="secondary sm">{t("Crear oportunidad", "Create opportunity")}</button></div>
      </form>
    </details>
  );

  return (
    <div className="eq">
      <div className="ph"><div><h1>{t("Feedback 360", "Feedback 360")}</h1><p>{t("Continuar, empezar, mejorar, reducir. Se habla de lo que se hace, no de lo que alguien «es».", "Continue, start, improve, reduce. It speaks of what is done, not of what someone “is”.")}</p></div></div>
      <Notes sp={sp} ok={ok} err={err} />

      {asked.length > 0 && (
        <section className="card" id="pendientes"><b>{t("TE PIDIERON FEEDBACK", "FEEDBACK ASKED OF YOU")}</b> · {asked.length}
          {asked.map((f) => (
            <article key={f.id} id={`f-${f.id}`} className="eq-obj">
              <div className="eq-obj-h"><span className="t">{f.aboutId === user.id ? t("Sobre ti (autofeedback)", "About yourself (self-feedback)") : t(`Sobre ${f.about.name}`, `About ${f.about.name}`)}</span><span className="sig wait">{tx(FEEDBACK_RELATIONS[f.relation] ?? FEEDBACK_RELATIONS.PEER)}</span><span className="src">{t("lo pidió", "asked by")} {f.requestedByName} · {i.day(f.createdAt)}</span></div>
              {f.topic ? <p className="small">{t("Tema", "Topic")}: {f.topic}</p> : null}
              <form action={giveFeedback} className="qa-form"><input type="hidden" name="id" value={f.id} /><Fields />
                <div className="qa-row"><button type="submit" className="sm">{t("Entregar", "Give")}</button><button type="submit" formAction={declineFeedback.bind(null, f.id)} formNoValidate className="secondary sm">{t("Ahora no puedo darlo", "I can't give it now")}</button></div>
              </form>
            </article>
          ))}
        </section>
      )}

      <section className="card" id="recibido"><b>{t("FEEDBACK SOBRE MÍ", "FEEDBACK ABOUT ME")}</b>
        {waiting.length > 0 && <p className="small muted">{t("Pedido y aún sin responder", "Asked and not yet answered")}: {waiting.map((f) => f.from.name).join(", ")}</p>}
        {mineGiven.length === 0 ? <p className="small muted">{t("Aún no has recibido feedback.", "You haven't received feedback yet.")}</p> : (
          <ul className="plain">{mineGiven.map((f) => <li key={f.id}><span className="sig wait">{tx(FEEDBACK_RELATIONS[f.relation] ?? FEEDBACK_RELATIONS.PEER)}</span> <b>{f.from.name}</b> <span className="src">· {i.day(f.givenAt)}{f.topic ? ` · ${f.topic}` : ""}</span><Parts f={f} /><ToOpp f={f} personId={user.id} /></li>)}</ul>
        )}
      </section>

      <div className="eq-cols" style={{ gap: 14 }}>
        <section className="card" id="pedir"><b>{t("PEDIR FEEDBACK", "ASK FOR FEEDBACK")}</b>
          <form action={requestFeedback} className="qa-form">
            {reports.length > 0 && <label>{t("Sobre quién", "About whom")}<select name="aboutId" defaultValue={user.id}><option value={user.id}>{t("Sobre mí", "About me")}</option>{people.filter((p) => reports.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            <div className="qa-row">
              <label>{t("A quién se lo pides", "Whom you ask")}<select name="fromId" required defaultValue=""><option value="" disabled>—</option><option value={user.id}>{t("A mí mismo (autofeedback)", "Myself (self-feedback)")}</option>{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>{t("Qué es esa persona para quien lo recibe", "What that person is to the receiver")}<select name="relation" defaultValue="PEER">{Object.entries(FEEDBACK_RELATIONS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
            </div>
            <label>{t("Sobre qué (opcional)", "About what (optional)")}<input name="topic" maxLength={300} /></label>
            <div><button type="submit" className="secondary">{t("Pedir", "Ask")}</button></div>
          </form>
        </section>
        <section className="card" id="dar"><b>{t("DAR FEEDBACK SIN QUE LO PIDAN", "GIVE FEEDBACK UNASKED")}</b>
          <form action={giveFeedback} className="qa-form">
            <div className="qa-row">
              <label>{t("Sobre quién", "About whom")}<select name="aboutId" required defaultValue=""><option value="" disabled>—</option>{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>{t("Qué eres tú para esa persona", "What you are to that person")}<select name="relation" defaultValue="PEER">{Object.entries(FEEDBACK_RELATIONS).filter(([k]) => k !== "SELF").map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
            </div>
            <label>{t("Sobre qué (opcional)", "About what (optional)")}<input name="topic" maxLength={300} /></label>
            <Fields />
            <div><button type="submit" className="secondary">{t("Entregar", "Give")}</button> <span className="src">{t("Lleva tu nombre. Lo leen la persona y su líder.", "It carries your name. The person and their leader read it.")}</span></div>
          </form>
        </section>
      </div>

      {team.length > 0 && (
        <section className="card" id="equipo"><b>{t("FEEDBACK SOBRE LAS PERSONAS QUE ACOMPAÑO", "FEEDBACK ABOUT THE PEOPLE I ACCOMPANY")}</b> <span className="small muted">{t("últimos 180 días", "last 180 days")}</span>
          <ul className="plain">{team.map((f) => <li key={f.id}><b>{f.about.name}</b> ← {f.from.name} <span className="sig wait">{tx(FEEDBACK_RELATIONS[f.relation] ?? FEEDBACK_RELATIONS.PEER)}</span> <span className="src">· {i.day(f.givenAt)}</span><Parts f={f} /><ToOpp f={f} personId={f.about.id} /></li>)}</ul>
        </section>
      )}

      {given.length > 0 && (
        <section className="card" id="dado"><b>{t("FEEDBACK QUE HE DADO", "FEEDBACK I HAVE GIVEN")}</b>
          <ul className="plain">{given.map((f) => <li key={f.id}><b>{f.about.name}</b> <span className="src">· {i.day(f.givenAt)}</span><Parts f={f} /></li>)}</ul>
        </section>
      )}
    </div>
  );
}
