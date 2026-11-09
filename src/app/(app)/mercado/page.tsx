import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { marketHome } from "@/lib/market";
import { CONFIDENCE, HORIZONS, MOVEMENT, SCOPES, SIGNAL_KINDS, SOURCES, FUTURE_KINDS, movementOf, type Horizon } from "@/lib/market-rules";
import { captureSignal, createExploration, dismissSignal, exploreSignal } from "./actions";

// Mercado · Explorar (Módulo 09 Home). Answers: what changed, what deserves attention, what we know,
// what we don't, and what the next useful movement is. No scores, no rankings, no "create opportunity".

const MSG: Record<string, [string, string]> = {
  senal: ["Señal guardada. Gracias por traerla: así nadie tiene que adivinar.", "Signal saved. Thanks for bringing it in: now nobody has to guess."],
  descartada: ["Señal descartada, con su motivo a la vista.", "Signal dismissed, with its reason kept."],
  white: ["Espacio actualizado.", "White space updated."],
  futuro: ["Oportunidad futura guardada.", "Future opportunity saved."],
};
const ERR: Record<string, [string, string]> = {
  frase: ["Cuéntanos en una frase qué quieres entender (por ejemplo: «Mercado lácteo en el Valle para Alfa Laval»).", "Tell us in one sentence what you want to understand (e.g. “Dairy market in Valle for Alfa Laval”)."],
  senal: ["Escribe qué cambió para poder guardar la señal.", "Write what changed so the signal can be saved."],
  descarte: ["Un motivo corto ayuda a que la próxima persona no repita el análisis.", "A short reason helps the next person not redo the thinking."],
};

export default async function MercadoHome({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const h = await marketHome();
  const L = (x: { es: string; en: string } | undefined) => (x ? t(x.es, x.en) : "");
  const nameOf = (n: string) => n;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mercado", "Market")}</div>
          <h1>{t("Explorar", "Explore")}</h1>
          <p>{t("Qué cambió, qué sabemos, qué no sabemos todavía y cuál es el siguiente movimiento útil. Explorar no es vender: es entender antes de proponer.", "What changed, what we know, what we don't know yet, and the next useful movement. Exploring isn't selling: it's understanding before proposing.")}</p>
        </div>
      </div>
      {sp.ok && MSG[sp.ok] && <div className="note okn">{t(...MSG[sp.ok])}</div>}
      {sp.err && ERR[sp.err] && <div className="note attn">{t(...ERR[sp.err])}</div>}

      <form action={createExploration} className="card mk-start">
        <label className="mk-q">{t("¿Qué quieres entender del mercado?", "What do you want to understand about the market?")}
          <input name="sentence" required minLength={6} maxLength={400} placeholder={t("Ej.: Explorar el mercado lácteo colombiano para Alfa Laval, Siemens y SKF", "E.g.: Explore the Colombian dairy market for Alfa Laval, Siemens and SKF")} />
        </label>
        <button type="submit">{t("Empezar a explorar", "Start exploring")}</button>
        <span className="src block">{t("SOLU ordena la frase (sector, territorio, tecnologías y empresas que ya conoce) y te muestra lo que no pudo deducir. Tú confirmas.", "SOLU structures the sentence (sector, territory, technologies and companies it already knows) and shows what it couldn't tell. You confirm.")}</span>
      </form>

      <section className="mk-sec">
        <h2>{t("Para explorar", "Worth exploring")} <span className="muted small">{t("señales nuevas", "new signals")}</span></h2>
        {h.cards.length === 0 && <div className="card empty"><b>{t("No hay señales nuevas", "No new signals")}</b><span className="src block">{t("Cuando alguien escuche de una ampliación, una parada o un cambio en un cliente, regístralo abajo. Una señal no es una venta: es una razón para conversar.", "When someone hears about an expansion, a shutdown or a change at a customer, record it below. A signal isn't a sale: it's a reason to talk.")}</span></div>}
        <div className="grid cols-2">
          {h.cards.map((s) => (
            <article key={s.id} className="card mk-card">
              <div className="mk-head">
                <span className="sig info">{L(SIGNAL_KINDS[s.kind])}</span>
                {s.account && <Link href={`/mercado/empresas/${s.account.id}`}><b>{nameOf(s.account.name)}</b></Link>}
                {s.plant && <span className="muted small">· {s.plant.name}{s.plant.city ? `, ${s.plant.city}` : ""}</span>}
              </div>
              <dl className="mk-dl">
                <dt>{t("Qué cambió", "What changed")}</dt><dd>{s.what}</dd>
                {s.whyMatters && <><dt>{t("Por qué importa", "Why it matters")}</dt><dd><span className="sig attn">{t("Inferido", "Inferred")}</span> {s.whyMatters}</dd></>}
                <dt>{t("Qué sabemos", "What we know")}</dt>
                <dd>{s.history ? (s.history.deals ? t(`${s.history.deals} Journey(s) con nosotros, ${s.history.won} ganado(s)${s.history.lastDealAt ? `; el último ${i.day(s.history.lastDealAt)}` : ""}.`, `${s.history.deals} Journey(s) with us, ${s.history.won} won${s.history.lastDealAt ? `; latest ${i.day(s.history.lastDealAt)}` : ""}.`) : t("Aún no hemos trabajado juntos.", "We haven't worked together yet.")) : t("La señal no nombra una empresa.", "The signal doesn't name a company.")}
                  {s.history && s.history.contacts.length > 0 && <span className="src block">{t("Contactos", "Contacts")}: {s.history.contacts.slice(0, 3).map((c) => c.name).join(", ")}</span>}
                </dd>
                <dt>{t("Qué no sabemos", "What we don't know")}</dt>
                <dd>{s.unknowns.length ? <ul className="mk-ul">{s.unknowns.map((q) => <li key={q}><span className="sig dash">{t("Desconocido", "Unknown")}</span> {q}</li>)}</ul> : <span className="muted">{t("Qué necesita la operación, quién decide y cuándo. Por eso conviene explorar.", "What the operation needs, who decides and when. That's why it's worth exploring.")}</span>}</dd>
                <dt>{t("Movimiento sugerido", "Suggested movement")}</dt><dd>{L(s.suggested)}</dd>
              </dl>
              <span className="src block">{L(SOURCES[s.sourceType])}{s.sourceRef ? ` · ${s.sourceRef}` : ""} · {t("visto", "seen")} {i.day(s.observedAt)} ({s.ageDays === 0 ? t("hoy", "today") : t(`hace ${s.ageDays} días`, `${s.ageDays} days ago`)}) · <span className={`sig ${CONFIDENCE[s.confidence]?.cls ?? "info"}`}>{L(CONFIDENCE[s.confidence])}</span> · {s.capturedByName}</span>
              <div className="row mk-actions">
                <form action={exploreSignal.bind(null, s.id)}><button type="submit">{t("Explorar esta señal", "Explore this signal")}</button></form>
                <details>
                  <summary className="small">{t("No vale la pena ahora", "Not worth it now")}</summary>
                  <form action={dismissSignal.bind(null, s.id)} className="row">
                    <input name="note" required maxLength={300} placeholder={t("¿Por qué? (una frase)", "Why? (one sentence)")} />
                    <button type="submit" className="secondary">{t("Descartar", "Dismiss")}</button>
                  </form>
                </details>
              </div>
            </article>
          ))}
        </div>
        <details className="card">
          <summary>{t("Registrar una señal", "Record a signal")}</summary>
          <form action={captureSignal} className="stack" style={{ maxWidth: 720 }}>
            <div className="row">
              <label>{t("Tipo de cambio", "Kind of change")}<select name="kind" defaultValue="EXPANSION">{Object.entries(SIGNAL_KINDS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
              <label style={{ flex: 1 }}>{t("Empresa (si aplica)", "Company (if any)")}<select name="accountId" defaultValue=""><option value="">—</option>{h.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            </div>
            <label>{t("Qué cambió", "What changed")}<input name="what" required maxLength={300} placeholder={t("Ej.: Anunció una segunda línea de pasteurización en Tuluá", "E.g.: Announced a second pasteurization line in Tuluá")} /></label>
            <label>{t("Por qué podría importar (tu lectura, se muestra como inferencia)", "Why it might matter (your reading, shown as an inference)")}<input name="whyMatters" maxLength={500} /></label>
            <div className="row">
              <label>{t("Fuente", "Source")}<select name="sourceType" defaultValue="CONVERSATION">{Object.entries(SOURCES).filter(([k]) => k !== "RULE").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
              <label style={{ flex: 1 }}>{t("Referencia (enlace, persona o documento)", "Reference (link, person or document)")}<input name="sourceRef" maxLength={300} /></label>
              <label>{t("Visto el", "Seen on")}<input name="observedAt" type="date" /></label>
              <label>{t("Certeza", "Certainty")}<select name="confidence" defaultValue="REPORTED">{Object.entries(CONFIDENCE).filter(([k]) => k !== "UNKNOWN").map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
            </div>
            <button type="submit" className="secondary">{t("Guardar señal", "Save signal")}</button>
          </form>
        </details>
      </section>

      <section className="mk-sec">
        <h2>{t("Exploraciones activas", "Active explorations")}</h2>
        {h.explorations.length === 0 ? <div className="card empty"><b>{t("Aún no hay exploraciones", "No explorations yet")}</b><span className="src block">{t("Empieza con una frase arriba.", "Start with one sentence above.")}</span></div> : (
          <div className="card flush">
            <table>
              <thead><tr><th>{t("Exploración", "Exploration")}</th><th>{t("Estado del movimiento", "Movement")}</th><th className="n">{t("Preguntas abiertas", "Open questions")}</th><th>{t("Responsable", "Owner")}</th></tr></thead>
              <tbody>
                {h.explorations.map((e) => {
                  const m = movementOf(e);
                  return (
                    <tr key={e.id}>
                      <td><Link href={`/mercado/exploraciones/${e.id}`}><b>{e.name}</b></Link><span className="src">{L(SCOPES[e.scope])}{e.scopeText ? ` · ${e.scopeText}` : ""}</span></td>
                      <td><span className={`sig ${MOVEMENT[m].cls}`}>{L(MOVEMENT[m])}</span><span className="src block">{m === "MOVE" ? `${e.nextMove}${e.nextMoveAt ? ` · ${i.day(e.nextMoveAt)}` : ""}` : m === "WAIT" ? `${e.waitingFor} · ${t("hasta", "until")} ${i.day(e.waitingUntil!)}` : m === "TRIGGER" ? `${e.triggerEvent ?? ""}${e.triggerOn ? ` · ${i.day(e.triggerOn)}` : ""}` : t("Falta decidir el siguiente paso", "Next step still to decide")}</span></td>
                      <td className="n val">{e.gaps.length}</td>
                      <td className="small">{e.owner.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid cols-2">
        <section className="mk-sec">
          <h2>{t("Espacios sin explorar", "White space")}</h2>
          {h.whites.length === 0 ? <div className="card empty small">{t("Nada pendiente. Cuando veas una planta, un área o una tecnología donde aún no estamos, anótala en una exploración.", "Nothing pending. When you see a plant, area or technology where we aren't yet, note it in an exploration.")}</div> : (
            <ul className="card mk-list">
              {h.whites.map((w) => (
                <li key={w.id}><b>{w.what}</b>{w.account && <span className="muted"> · {w.account.name}</span>}
                  <span className="src block">{w.why ?? ""}{w.exploration && <> · <Link href={`/mercado/exploraciones/${w.exploration.id}`}>{w.exploration.name}</Link></>}</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className="mk-sec">
          <h2>{t("Qué cambió", "What changed")} <span className="muted small">{t("últimos 14 días", "last 14 days")}</span></h2>
          {h.changes.length === 0 ? <div className="card empty small">{t("Sin cambios recientes.", "No recent changes.")}</div> : (
            <ul className="card mk-list">
              {h.changes.map((c, n) => <li key={n}>{c.href ? <Link href={c.href}>{t(c.es, c.en)}</Link> : t(c.es, c.en)}<span className="src block">{i.day(c.at)}{c.by ? ` · ${c.by}` : ""}</span></li>)}
            </ul>
          )}
        </section>
      </div>

      {h.grow.length > 0 && (
        <section className="mk-sec">
          <h2>{t("Relaciones que pueden crecer", "Relationships that can grow")}</h2>
          <div className="grid cols-3">
            {h.grow.map((g) => <div key={g.id} className="card"><Link href={`/mercado/empresas/${g.id}`}><b>{g.name}</b></Link><span className="src block">{t("Donde aún no estamos", "Where we aren't yet")}: {g.whites.join(" · ")}</span></div>)}
          </div>
        </section>
      )}

      <section className="mk-sec">
        <h2>{t("Oportunidades futuras", "Future opportunities")} <span className="muted small">{t("eventos que aún no son una necesidad", "events that aren't a need yet")}</span></h2>
        {h.futuresCount === 0 ? <div className="card empty small">{t("Cuando un cliente mencione una parada, un CAPEX o una nueva planta, guárdalo desde una exploración para llegar a tiempo.", "When a customer mentions a shutdown, CAPEX or a new plant, save it from an exploration to arrive on time.")}</div> : (
          <div className="grid cols-4">
            {(Object.keys(HORIZONS) as Horizon[]).filter((k) => h.byHorizon[k].length).map((k) => (
              <div key={k} className="card">
                <b>{L(HORIZONS[k])}</b>
                <ul className="mk-ul">
                  {h.byHorizon[k].map((f) => (
                    <li key={f.id}><span className="sig wait">{L(FUTURE_KINDS[f.kind])}</span> {f.description}
                      <span className="src block">{f.account?.name ?? ""}{f.plant ? ` · ${f.plant.name}` : ""}{f.expectedAt ? ` · ${i.day(f.expectedAt)}` : ""}{f.exploration && <> · <Link href={`/mercado/exploraciones/${f.exploration.id}`}>{t("ver exploración", "see exploration")}</Link></>}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
