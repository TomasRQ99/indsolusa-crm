import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { explorationWorkspace } from "@/lib/market";
import { CONFIDENCE, FUTURE_KINDS, MOVEMENT, SCOPES, SIGNAL_KINDS, SOURCES, WHITE_KINDS, horizonOf, HORIZONS, movementOf } from "@/lib/market-rules";
import {
  addFuture, addGap, addPlant, addWhiteSpace, captureSignal, closeExploration, closeFuture, completeMovement, gapToMovement,
  linkAccount, reopenExploration, resolveGap, setMovement, setWhiteSpace, unlink, updateExploration,
} from "../../actions";

// Exploration workspace (Módulo 09 §8). One place to see purpose, what we know (facts), what we infer,
// what we don't know, and the single next movement. Closing without a Need is a valid result.

const OK: Record<string, [string, string]> = {
  nuevo: ["Exploración creada. Revisa lo que SOLU entendió y define el primer movimiento.", "Exploration created. Check what SOLU understood and set the first movement."],
  guardado: ["Cambios guardados.", "Changes saved."], movimiento: ["Siguiente movimiento definido. También quedó en tus pendientes de Mi Día.", "Next movement set. It's also in your My Day to-dos."],
  hecho: ["Buen paso. ¿Cuál es el siguiente movimiento?", "Good step. What's the next movement?"], cerrada: ["Exploración cerrada. Lo aprendido queda aquí para el equipo.", "Exploration closed. What we learned stays here for the team."],
  reabierta: ["Exploración reabierta.", "Exploration reopened."], empresa: ["Empresa vinculada.", "Company linked."], senal: ["Señal guardada.", "Signal saved."],
  gap: ["Pregunta anotada. Saber qué no sabemos ya es avanzar.", "Question noted. Knowing what we don't know is progress."], aprendido: ["Respuesta guardada con su fuente.", "Answer saved with its source."],
  white: ["Espacio actualizado.", "White space updated."], planta: ["Planta registrada.", "Plant recorded."], futuro: ["Oportunidad futura guardada.", "Future opportunity saved."], "futuro-cerrado": ["Oportunidad futura cerrada.", "Future opportunity closed."],
};
const ERR: Record<string, [string, string]> = {
  permiso: ["Solo el responsable o un gerente puede cambiar el rumbo de esta exploración. Puedes aportar señales, preguntas y hechos.", "Only the owner or a manager can change this exploration's direction. You can still add signals, questions and facts."],
  movimiento: ["Escribe cuál es el siguiente movimiento.", "Write what the next movement is."], espera: ["Para esperar con control, di qué esperamos y hasta cuándo.", "To wait with control, say what we're waiting for and until when."],
  disparador: ["Indica una fecha o un evento que reactive la exploración.", "Give a date or an event that reactivates the exploration."], resultado: ["Cuéntanos en una frase qué aprendimos antes de cerrar.", "Tell us in one sentence what we learned before closing."],
  cerrada: ["La exploración está cerrada. Reábrela para seguir.", "The exploration is closed. Reopen it to continue."], dato: ["Falta un dato obligatorio.", "A required field is missing."],
  pregunta: ["Escribe la pregunta.", "Write the question."], respuesta: ["Escribe la respuesta.", "Write the answer."], white: ["Describe el espacio.", "Describe the white space."],
  planta: ["Elige la empresa y el nombre de la planta.", "Pick the company and the plant name."], futuro: ["Describe el evento futuro.", "Describe the future event."], cierre: ["Di por qué se cierra.", "Say why it's closed."], senal: ["Escribe qué cambió.", "Write what changed."],
};

export default async function ExplorationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; nuevo?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const data = await explorationWorkspace(id);
  if (!data) notFound();
  const { e, companies, accounts, origin } = data;
  const i = makeI18n(user.lang);
  const { t } = i;
  const L = (x: { es: string; en: string } | undefined) => (x ? t(x.es, x.en) : "");
  const mine = canEdit(user, e.ownerId);
  const closed = e.lifecycle === "CLOSED";
  const m = movementOf(e);
  const ok = sp.ok ?? (sp.nuevo ? "nuevo" : undefined);
  const openGaps = e.gaps.filter((g) => g.status === "OPEN");
  const learned = e.gaps.filter((g) => g.status === "RESOLVED");
  const back = `/mercado/exploraciones/${e.id}`;
  const accountOpts = companies.length ? companies : accounts;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado">{t("Mercado · Explorar", "Market · Explore")}</Link></div>
          <h1>{e.name}</h1>
          <p>{e.purpose}</p>
          <span className="src block">{L(SCOPES[e.scope])}{e.scopeText ? ` · ${e.scopeText}` : ""} · {t("Responsable", "Owner")}: {e.owner.name} · {t("desde", "since")} {i.day(e.startedAt)}{origin && <> · {t("nació de la señal", "born from the signal")} «{origin.what}»</>}</span>
        </div>
      </div>
      {ok && OK[ok] && <div className="note okn">{t(...OK[ok])}</div>}
      {sp.err && ERR[sp.err] && <div className="note attn">{t(...ERR[sp.err])}</div>}

      {closed ? (
        <div className="card mk-move">
          <span className="sig wait">{t("Cerrada", "Closed")}</span> {e.closedAt && i.day(e.closedAt)}
          <p><b>{t("Lo que aprendimos", "What we learned")}:</b> {e.resultSummary}</p>
          {mine && <form action={reopenExploration.bind(null, e.id)}><button type="submit" className="secondary">{t("Reabrir", "Reopen")}</button></form>}
        </div>
      ) : (
        <div className="card mk-move">
          <div className="mk-head"><b>{t("Siguiente movimiento", "Next movement")}</b><span className={`sig ${MOVEMENT[m].cls}`}>{L(MOVEMENT[m])}</span></div>
          {m === "MOVE" && <p>{e.nextMove}{e.nextMoveAt && <span className="muted"> · {i.day(e.nextMoveAt)}</span>}</p>}
          {m === "WAIT" && <p>{t("Esperamos", "Waiting for")}: {e.waitingFor} · {t("revisamos el", "we check back on")} {i.day(e.waitingUntil!)}</p>}
          {m === "TRIGGER" && <p>{t("Se reactiva con", "Reactivates on")}: {e.triggerEvent ?? ""}{e.triggerOn && ` · ${i.day(e.triggerOn)}`}</p>}
          {m === "CLARITY_NEEDED" && <p className="muted">{t("Toda exploración activa necesita un siguiente paso claro: un movimiento, una espera con fecha o un disparador futuro.", "Every active exploration needs a clear next step: a movement, a dated wait or a future trigger.")}</p>}
          {mine && (
            <div className="stack">
              {m === "MOVE" && (
                <form action={completeMovement.bind(null, e.id)} className="row">
                  <input name="learned" maxLength={500} placeholder={t("¿Qué aprendimos? (opcional)", "What did we learn? (optional)")} style={{ flex: 1 }} />
                  <button type="submit">{t("Hecho", "Done")}</button>
                </form>
              )}
              <details open={m === "CLARITY_NEEDED"}>
                <summary className="small">{m === "CLARITY_NEEDED" ? t("Definir el siguiente paso", "Set the next step") : t("Cambiar el siguiente paso", "Change the next step")}</summary>
                <div className="grid cols-3">
                  <form action={setMovement.bind(null, e.id)} className="stack">
                    <input type="hidden" name="mode" value="MOVE" />
                    <b className="small">{t("Un movimiento", "A movement")}</b>
                    <input name="nextMove" required maxLength={200} placeholder={t("Ej.: Llamar al jefe de mantenimiento", "E.g.: Call the maintenance lead")} />
                    <input name="nextMoveAt" type="date" />
                    <button type="submit">{t("Definir", "Set")}</button>
                  </form>
                  <form action={setMovement.bind(null, e.id)} className="stack">
                    <input type="hidden" name="mode" value="WAIT" />
                    <b className="small">{t("Esperar con control", "Wait with control")}</b>
                    <input name="waitingFor" required maxLength={200} placeholder={t("Ej.: Que publiquen el presupuesto 2027", "E.g.: The 2027 budget to be published")} />
                    <input name="waitingUntil" type="date" required />
                    <button type="submit" className="secondary">{t("Esperar", "Wait")}</button>
                  </form>
                  <form action={setMovement.bind(null, e.id)} className="stack">
                    <input type="hidden" name="mode" value="TRIGGER" />
                    <b className="small">{t("Disparador futuro", "Future trigger")}</b>
                    <input name="triggerEvent" maxLength={200} placeholder={t("Ej.: Cuando anuncien la parada de 2027", "E.g.: When they announce the 2027 shutdown")} />
                    <input name="triggerOn" type="date" />
                    <button type="submit" className="secondary">{t("Dejar en pausa", "Pause until then")}</button>
                  </form>
                </div>
              </details>
            </div>
          )}
          {e.tasks.length > 0 && <span className="src block">{t("En Mi Día", "In My Day")}: {e.tasks.map((x) => x.title).join(" · ")}</span>}
        </div>
      )}

      <div className="grid cols-2">
        <section className="mk-sec">
          <h2>{t("Lo que no sabemos", "What we don't know")}</h2>
          <div className="card">
            {openGaps.length === 0 && <p className="muted small">{t("Sin preguntas abiertas. Si algo no está claro, anótalo: es mejor que suponer.", "No open questions. If something isn't clear, note it: better than assuming.")}</p>}
            <ul className="mk-ul">
              {openGaps.map((g) => (
                <li key={g.id}><span className="sig dash">{t("Desconocido", "Unknown")}</span> <b>{g.question}</b>{g.why && <span className="src block">{g.why}</span>}
                  <details>
                    <summary className="small">{t("Ya lo sabemos", "We know now")}</summary>
                    <form action={resolveGap.bind(null, e.id, g.id)} className="stack">
                      <input name="answer" required maxLength={1000} placeholder={t("Respuesta", "Answer")} />
                      <input name="answerSource" maxLength={200} placeholder={t("¿Quién o qué lo confirmó?", "Who or what confirmed it?")} />
                      <button type="submit" className="secondary">{t("Guardar respuesta", "Save answer")}</button>
                    </form>
                  </details>
                  {mine && !closed && <form action={gapToMovement.bind(null, e.id, g.id)}><button type="submit" className="link small">{t("Convertir en siguiente movimiento", "Make it the next movement")}</button></form>}
                </li>
              ))}
            </ul>
            <form action={addGap.bind(null, e.id)} className="row">
              <input name="question" required maxLength={300} placeholder={t("Nueva pregunta abierta", "New open question")} style={{ flex: 1 }} />
              <button type="submit" className="secondary">{t("Anotar", "Add")}</button>
            </form>
          </div>
        </section>

        <section className="mk-sec">
          <h2>{t("Lo que aprendimos", "What we learned")}</h2>
          <div className="card">
            {learned.length === 0 ? <p className="muted small">{t("Aún nada confirmado.", "Nothing confirmed yet.")}</p> : (
              <ul className="mk-ul">{learned.map((g) => <li key={g.id}><span className="sig ok">{t("Hecho", "Fact")}</span> {g.answer}<span className="src block">{g.question !== "Aprendizaje del último movimiento" ? `${g.question} · ` : ""}{g.answerSource ?? ""}{g.resolvedAt ? ` · ${i.day(g.resolvedAt)}` : ""}{g.resolvedByName ? ` · ${g.resolvedByName}` : ""}</span></li>)}</ul>
            )}
            {e.hypothesis && <p className="small"><span className="sig attn">{t("Hipótesis", "Hypothesis")}</span> {e.hypothesis}</p>}
          </div>
        </section>
      </div>

      <section className="mk-sec">
        <h2>{t("Empresas en esta exploración", "Companies in this exploration")}</h2>
        <div className="grid cols-2">
          {companies.map((c) => {
            const link = e.links.find((l) => l.kind === "ACCOUNT" && l.refId === c.id);
            return (
              <div key={c.id} className="card">
                <div className="mk-head"><Link href={`/mercado/empresas/${c.id}`}><b>{c.name}</b></Link>{c.alsoSupplier && <Link href={`/suppliers/${c.alsoSupplier.id}`} className="sig info">{t("También proveedor", "Also a supplier")}</Link>}</div>
                {link?.why && <span className="src block">{link.why}</span>}
                <p className="small"><span className="sig ok">{t("Hecho", "Fact")}</span> {c.history.deals ? t(`${c.history.deals} Journey(s) con nosotros, ${c.history.won} ganado(s).`, `${c.history.deals} Journey(s) with us, ${c.history.won} won.`) : t("Aún no hemos trabajado juntos.", "We haven't worked together yet.")}
                  {c.history.contacts.length > 0 && ` ${t("Conocemos a", "We know")}: ${c.history.contacts.slice(0, 4).map((x) => `${x.name}${x.title ? ` (${x.title})` : ""}`).join(", ")}.`}</p>
                <b className="small">{t("Plantas", "Plants")}</b>
                {c.plants.length === 0 ? <p className="muted small">{t("No conocemos sus plantas todavía.", "We don't know their plants yet.")}</p> : (
                  <ul className="mk-ul">{c.plants.map((p) => <li key={p.id}><Link href={`/mercado/plantas/${p.id}`}>{p.name}</Link>{p.city ? `, ${p.city}` : ""}{p.operationType ? ` · ${p.operationType}` : ""} <span className={`sig ${CONFIDENCE[p.confidence]?.cls ?? "info"}`}>{L(CONFIDENCE[p.confidence])}</span><span className="src block">{L(SOURCES[p.sourceType])}{p.sourceRef ? ` · ${p.sourceRef}` : ""} · {i.day(p.observedAt)}</span></li>)}</ul>
                )}
                {mine && link && <form action={unlink.bind(null, e.id, link.id)}><button type="submit" className="link small">{t("Quitar de la exploración", "Remove from exploration")}</button></form>}
              </div>
            );
          })}
        </div>
        <details className="card">
          <summary>{t("Vincular una empresa", "Link a company")}</summary>
          <form action={linkAccount.bind(null, e.id)} className="row">
            <select name="accountId" required defaultValue=""><option value="" disabled>{t("Elige", "Pick")}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <input name="why" maxLength={200} placeholder={t("¿Por qué entra? (opcional)", "Why is it in? (optional)")} style={{ flex: 1 }} />
            <button type="submit" className="secondary">{t("Vincular", "Link")}</button>
          </form>
        </details>
        {accountOpts.length > 0 && (
          <details className="card">
            <summary>{t("Registrar una planta", "Record a plant")}</summary>
            <form action={addPlant.bind(null, e.id)} className="stack" style={{ maxWidth: 720 }}>
              <div className="row">
                <label>{t("Empresa", "Company")}<select name="accountId" required>{accountOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                <label style={{ flex: 1 }}>{t("Nombre de la planta", "Plant name")}<input name="name" required maxLength={120} /></label>
                <label>{t("Ciudad", "City")}<input name="city" maxLength={80} /></label>
                <label>{t("País", "Country")}<select name="country" defaultValue="Colombia"><option>Colombia</option><option>Estados Unidos</option></select></label>
              </div>
              <label>{t("Qué opera (procesos, líneas)", "What it operates (processes, lines)")}<input name="operationType" maxLength={200} /></label>
              <div className="row">
                <label>{t("Fuente", "Source")}<select name="sourceType">{Object.entries(SOURCES).filter(([k]) => k !== "RULE").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
                <label style={{ flex: 1 }}>{t("Referencia", "Reference")}<input name="sourceRef" maxLength={300} /></label>
                <label>{t("Certeza", "Certainty")}<select name="confidence" defaultValue="REPORTED">{Object.entries(CONFIDENCE).filter(([k]) => k !== "UNKNOWN").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
              </div>
              <button type="submit" className="secondary">{t("Guardar planta", "Save plant")}</button>
            </form>
          </details>
        )}
      </section>

      <div className="grid cols-2">
        <section className="mk-sec">
          <h2>{t("Señales", "Signals")}</h2>
          <div className="card">
            {e.signals.length === 0 && <p className="muted small">{t("Sin señales todavía.", "No signals yet.")}</p>}
            <ul className="mk-ul">
              {e.signals.map((s) => <li key={s.id}><span className="sig info">{L(SIGNAL_KINDS[s.kind])}</span> {s.what}{s.account && <span className="muted"> · {s.account.name}</span>}
                {s.whyMatters && <span className="src block"><span className="sig attn">{t("Inferido", "Inferred")}</span> {s.whyMatters}</span>}
                <span className="src block">{L(SOURCES[s.sourceType])}{s.sourceRef ? ` · ${s.sourceRef}` : ""} · {i.day(s.observedAt)} · <span className={`sig ${CONFIDENCE[s.confidence]?.cls ?? "info"}`}>{L(CONFIDENCE[s.confidence])}</span></span></li>)}
            </ul>
            <details>
              <summary className="small">{t("Registrar una señal aquí", "Record a signal here")}</summary>
              <form action={captureSignal} className="stack">
                <input type="hidden" name="explorationId" value={e.id} /><input type="hidden" name="back" value={back} />
                <div className="row">
                  <select name="kind" defaultValue="EXPANSION">{Object.entries(SIGNAL_KINDS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select>
                  <select name="accountId" defaultValue=""><option value="">{t("Empresa (opcional)", "Company (optional)")}</option>{accountOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                </div>
                <input name="what" required maxLength={300} placeholder={t("Qué cambió", "What changed")} />
                <input name="whyMatters" maxLength={500} placeholder={t("Por qué podría importar (inferencia)", "Why it might matter (inference)")} />
                <div className="row">
                  <select name="sourceType">{Object.entries(SOURCES).filter(([k]) => k !== "RULE").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select>
                  <input name="sourceRef" maxLength={300} placeholder={t("Referencia", "Reference")} style={{ flex: 1 }} />
                  <select name="confidence" defaultValue="REPORTED">{Object.entries(CONFIDENCE).filter(([k]) => k !== "UNKNOWN").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select>
                </div>
                <button type="submit" className="secondary">{t("Guardar señal", "Save signal")}</button>
              </form>
            </details>
          </div>
        </section>

        <section className="mk-sec">
          <h2>{t("Espacios sin explorar", "White space")}</h2>
          <div className="card">
            {e.whiteSpaces.length === 0 && <p className="muted small">{t("¿Hay una planta, un área o una tecnología del cliente donde aún no estamos?", "Is there a plant, area or technology at the customer where we aren't yet?")}</p>}
            <ul className="mk-ul">
              {e.whiteSpaces.map((w) => (
                <li key={w.id}><span className="sig wait">{L(WHITE_KINDS[w.kind])}</span> <b>{w.what}</b>{w.account && <span className="muted"> · {w.account.name}</span>}
                  {w.why && <span className="src block">{w.why}</span>}
                  {w.status === "OPEN" || w.status === "EXPLORING" ? (
                    <form action={setWhiteSpace.bind(null, w.id)} className="row">
                      <input name="note" maxLength={300} placeholder={t("Nota (opcional)", "Note (optional)")} style={{ flex: 1 }} />
                      <button type="submit" name="status" value="RESOLVED" className="link small">{t("Ya estamos ahí", "We're there now")}</button>
                      <button type="submit" name="status" value="NOT_RELEVANT" className="link small">{t("No aplica", "Not relevant")}</button>
                    </form>
                  ) : <span className="src block">{w.status === "RESOLVED" ? t("Resuelto", "Resolved") : t("No aplica", "Not relevant")}{w.note ? ` · ${w.note}` : ""}</span>}
                </li>
              ))}
            </ul>
            <details>
              <summary className="small">{t("Anotar un espacio", "Note a white space")}</summary>
              <form action={addWhiteSpace.bind(null, e.id)} className="stack">
                <div className="row">
                  <select name="kind" defaultValue="PLANT">{Object.entries(WHITE_KINDS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select>
                  <select name="accountId" defaultValue=""><option value="">{t("Empresa (opcional)", "Company (optional)")}</option>{accountOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
                </div>
                <input name="what" required maxLength={300} placeholder={t("Ej.: Planta de quesos en Cartago", "E.g.: Cheese plant in Cartago")} />
                <input name="why" maxLength={300} placeholder={t("Por qué lo creemos (fuente)", "Why we think so (source)")} />
                <button type="submit" className="secondary">{t("Anotar", "Add")}</button>
              </form>
            </details>
          </div>
        </section>
      </div>

      <section className="mk-sec">
        <h2>{t("Oportunidades futuras", "Future opportunities")}</h2>
        <div className="card">
          {e.futures.length === 0 && <p className="muted small">{t("Un CAPEX, una parada o una nueva planta que aún no es una necesidad. Guardarlo nos permite llegar a tiempo.", "A CAPEX, shutdown or new plant that isn't a need yet. Saving it lets us arrive on time.")}</p>}
          <ul className="mk-ul">
            {e.futures.map((f) => (
              <li key={f.id}><span className="sig wait">{L(FUTURE_KINDS[f.kind])}</span> <b>{f.description}</b>
                <span className="src block">{f.account?.name ?? ""}{f.plant ? ` · ${f.plant.name}` : ""}{f.process ? ` · ${f.process}` : ""} · {L(HORIZONS[horizonOf(f.expectedAt)])}{f.expectedAt ? ` (${i.day(f.expectedAt)})` : ""} · <span className={`sig ${CONFIDENCE[f.confidence]?.cls ?? "info"}`}>{L(CONFIDENCE[f.confidence])}</span> · {L(SOURCES[f.sourceType])}{f.sourceRef ? ` · ${f.sourceRef}` : ""}</span>
                {f.impact && <span className="src block">{t("Impacto", "Impact")}: {f.impact}</span>}
                {f.valueBasis && <span className="src block">{t("Base del valor", "Value basis")}: {f.valueBasis}</span>}
                {f.nextMove && <span className="src block">{t("Siguiente movimiento", "Next movement")}: {f.nextMove}</span>}
                {f.status === "OPEN" ? (
                  <details><summary className="small">{t("Ya no se espera / cerrar", "No longer expected / close")}</summary>
                    <form action={closeFuture.bind(null, f.id)} className="row"><input name="note" required maxLength={300} placeholder={t("¿Qué pasó?", "What happened?")} style={{ flex: 1 }} /><button type="submit" className="secondary">{t("Cerrar", "Close")}</button></form>
                  </details>
                ) : <span className="src block">{t("Cerrada", "Closed")}{f.closedNote ? ` · ${f.closedNote}` : ""}</span>}
              </li>
            ))}
          </ul>
          <details>
            <summary className="small">{t("Guardar una oportunidad futura", "Save a future opportunity")}</summary>
            <form action={addFuture} className="stack" style={{ maxWidth: 720 }}>
              <input type="hidden" name="explorationId" value={e.id} />
              <div className="row">
                <label>{t("Tipo", "Kind")}<select name="kind" defaultValue="SHUTDOWN">{Object.entries(FUTURE_KINDS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
                <label style={{ flex: 1 }}>{t("Empresa", "Company")}<select name="accountId" defaultValue=""><option value="">—</option>{accountOpts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                <label>{t("Fecha esperada", "Expected date")}<input name="expectedAt" type="date" /></label>
              </div>
              <label>{t("Qué va a pasar", "What will happen")}<input name="description" required maxLength={400} placeholder={t("Ej.: Parada anual de la línea UHT en junio", "E.g.: Annual UHT line shutdown in June")} /></label>
              <div className="row">
                <label style={{ flex: 1 }}>{t("Proceso o área", "Process or area")}<input name="process" maxLength={120} /></label>
                <label style={{ flex: 1 }}>{t("Base del valor (sin precio si no lo sabemos)", "Value basis (no price if unknown)")}<input name="valueBasis" maxLength={200} /></label>
              </div>
              <label>{t("Siguiente movimiento", "Next movement")}<input name="nextMove" maxLength={200} /></label>
              <div className="row">
                <label>{t("Fuente", "Source")}<select name="sourceType">{Object.entries(SOURCES).filter(([k]) => k !== "RULE").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
                <label style={{ flex: 1 }}>{t("Referencia", "Reference")}<input name="sourceRef" maxLength={300} /></label>
                <label>{t("Certeza", "Certainty")}<select name="confidence" defaultValue="REPORTED">{Object.entries(CONFIDENCE).filter(([k]) => k !== "UNKNOWN").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
              </div>
              <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
            </form>
          </details>
        </div>
      </section>

      {mine && (
        <section className="mk-sec">
          <details className="card">
            <summary>{t("Ajustar propósito y alcance", "Adjust purpose and scope")}</summary>
            <form action={updateExploration.bind(null, e.id)} className="stack" style={{ maxWidth: 720 }}>
              <label>{t("Nombre", "Name")}<input name="name" defaultValue={e.name} required maxLength={90} /></label>
              <label>{t("Propósito", "Purpose")}<textarea name="purpose" defaultValue={e.purpose} required maxLength={500} rows={2} /></label>
              <label>{t("Hipótesis (se muestra siempre como hipótesis)", "Hypothesis (always shown as a hypothesis)")}<textarea name="hypothesis" defaultValue={e.hypothesis ?? ""} maxLength={500} rows={2} /></label>
              <div className="row">
                <label>{t("Alcance", "Scope")}<select name="scope" defaultValue={e.scope}>{Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
                <label style={{ flex: 1 }}>{t("Detalle del alcance", "Scope detail")}<input name="scopeText" defaultValue={e.scopeText ?? ""} maxLength={200} /></label>
              </div>
              <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
            </form>
          </details>
          {!closed && (
            <details className="card">
              <summary>{t("Cerrar la exploración", "Close the exploration")}</summary>
              <p className="small muted">{t("Cerrar sin una necesidad es un resultado válido: lo que aprendimos queda para el equipo.", "Closing without a need is a valid result: what we learned stays for the team.")}</p>
              <form action={closeExploration.bind(null, e.id)} className="row">
                <input name="resultSummary" required maxLength={1000} placeholder={t("En una frase, ¿qué aprendimos?", "In one sentence, what did we learn?")} style={{ flex: 1 }} />
                <button type="submit" className="secondary">{t("Cerrar", "Close")}</button>
              </form>
            </details>
          )}
        </section>
      )}
    </>
  );
}
