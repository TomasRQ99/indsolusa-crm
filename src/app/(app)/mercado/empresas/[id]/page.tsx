import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { companyExploration } from "@/lib/market";
import { AREAS, BUY_TOPICS, DECIDE_STEPS, FUTURE_KINDS, INSIGHT_BLOCKS, MOVEMENT, SIGNAL_KINDS, VALUE_TOPICS, WHITE_KINDS, movementOf } from "@/lib/market-rules";
import { addAlias, addEmployment, addInsight, addOpenQuestion, addPlantFromCompany, answerQuestion, endEmployment, exploreCompany, removeAlias, supersedeInsight } from "../../intel-actions";
import { MSG_ERR, MSG_OK, Prov, ProvFields } from "../../ui";
import { companyEconomics } from "@/lib/econ";
import { EconBlock } from "../../EconBlock";
import { PayBlock } from "../../PayBlock";
import { paymentBehavior } from "@/lib/pay-behavior";
import { canManageAll } from "@/lib/permissions";

// Company Exploration (Módulo 09 §13.3): who is this company and where could we be useful?
// What we know (with source) · what changed · what we don't know · next useful movement. No giant form:
// every block is optional and grows one observation at a time.

const STAGE: Record<string, [string, string]> = { LEAD: ["Necesidad", "Need"], QUALIFIED: ["Calificado", "Qualified"], PROPOSAL: ["Propuesta", "Proposal"], NEGOTIATION: ["Negociación", "Negotiation"], WON: ["Ganado", "Won"], LOST: ["Perdido", "Lost"] };
type Insight = { id: string; block: string; topic: string | null; area: string | null; step: string | null; condition: string | null; statement: string; evidence: string | null; sourceType: string; sourceRef: string | null; observedAt: Date; confidence: string; capturedByName: string; plant?: { name: string } | null };

export default async function CompanyExplorationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const data = await companyExploration(id);
  if (!data) notFound();
  const { a } = data;
  const [econ, pay] = await Promise.all([companyEconomics({ accountId: a.id, taxId: a.taxId }), paymentBehavior(a.id)]);
  const i = makeI18n(user.lang);
  const { t } = i;
  const L = (x: { es: string; en: string } | undefined) => (x ? t(x.es, x.en) : "");
  const back = `/mercado/empresas/${a.id}`;
  const by = (b: string) => data.insights.filter((x) => x.block === b);
  const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

  const Item = ({ x }: { x: Insight }) => (
    <li>
      {x.topic && x.block === "BUY" && <b>{L(BUY_TOPICS[x.topic])}: </b>}
      {x.topic && x.block === "VALUE" && <span className="sig ok">{L(VALUE_TOPICS[x.topic])}</span>} {x.area && x.block !== "DECIDE" && <span className="muted">{x.area} · </span>}
      {x.statement}{x.condition && <span className="muted"> ({x.condition})</span>}{x.plant && <span className="muted"> · {x.plant.name}</span>}
      {x.evidence && <span className="src block">{t("Evidencia", "Evidence")}: «{x.evidence}»</span>}
      <Prov t={t} day={i.day} x={x} />
      <details><summary className="small muted">{t("Ya no es así", "No longer true")}</summary>
        <form action={supersedeInsight.bind(null, x.id)} className="row"><input type="hidden" name="back" value={back} /><input name="note" required maxLength={300} placeholder={t("¿Qué cambió?", "What changed?")} style={{ flex: 1 }} /><button type="submit" className="secondary">{t("Guardar", "Save")}</button></form>
      </details>
    </li>
  );
  const AddInsight = ({ block }: { block: string }) => (
    <details>
      <summary className="small">{t("Anotar lo que sabemos", "Note what we know")}</summary>
      <form action={addInsight.bind(null, a.id)} className="stack">
        <input type="hidden" name="block" value={block} /><input type="hidden" name="back" value={back} />
        {block === "DECIDE" && (
          <div className="row">
            <label>{t("Área", "Area")}<input name="area" list="mk-areas" maxLength={60} required /></label>
            <label>{t("Qué hace", "What it does")}<select name="step">{Object.entries(DECIDE_STEPS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
            <label style={{ flex: 1 }}>{t("Cuándo (opcional)", "When (optional)")}<input name="condition" maxLength={120} placeholder={t("Ej.: más de USD 10.000, urgencias, CAPEX", "E.g.: over USD 10,000, urgent, CAPEX")} /></label>
          </div>
        )}
        {block === "BUY" && <label>{t("Tema", "Topic")}<select name="topic">{Object.entries(BUY_TOPICS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>}
        {block === "VALUE" && (
          <div className="row">
            <label>{t("Qué valoran", "What they value")}<select name="topic">{Object.entries(VALUE_TOPICS).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
            <label style={{ flex: 1 }}>{t("Área o persona (opcional)", "Area or person (optional)")}<input name="area" list="mk-areas" maxLength={60} /></label>
          </div>
        )}
        <input name="statement" required maxLength={500} placeholder={block === "DECIDE" ? t("Ej.: Mantenimiento detecta y especifica el repuesto", "E.g.: Maintenance detects and specifies the part") : block === "BUY" ? t("Ej.: Todo pasa por el portal Ariba; piden 3 cotizaciones", "E.g.: Everything goes through Ariba; they ask for 3 quotes") : block === "VALUE" ? t("Ej.: Prefieren pagar más si llega antes de la parada", "E.g.: They'd rather pay more if it arrives before the shutdown") : t("Lo que sabemos", "What we know")} />
        <input name="evidence" maxLength={500} required={block === "VALUE"} placeholder={block === "VALUE" ? t("Evidencia: qué dijeron o hicieron (obligatoria)", "Evidence: what they said or did (required)") : t("Evidencia (opcional)", "Evidence (optional)")} />
        <ProvFields t={t} />
        <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
      </form>
    </details>
  );

  // Decision Map: area → steps, in the order a need travels.
  const order = Object.keys(DECIDE_STEPS);
  const decide = by("DECIDE");
  const areas = [...new Set(decide.map((x) => x.area ?? t("Sin área", "No area")))];
  const firstStep = (ar: string) => Math.min(...decide.filter((x) => (x.area ?? t("Sin área", "No area")) === ar).map((x) => (x.step ? order.indexOf(x.step) : 99)));
  areas.sort((p, q) => firstStep(p) - firstStep(q));

  return (
    <>
      <datalist id="mk-areas">{AREAS.map((x) => <option key={x} value={x} />)}</datalist>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado">{t("Mercado · Explorar", "Market · Explore")}</Link></div>
          <h1>{a.name}</h1>
          <p>{t("¿Quién es esta empresa y dónde podríamos ser útiles?", "Who is this company and where could we be useful?")}</p>
        </div>
        <Link href={`/accounts/${a.id}`} className="btn secondary">{t("Ver cliente 360", "Customer 360")}</Link>
      </div>
      {sp.ok && MSG_OK[sp.ok] && <div className="note okn">{t(...MSG_OK[sp.ok])}</div>}
      {sp.err && MSG_ERR[sp.err] && <div className="note attn">{t(...MSG_ERR[sp.err])}</div>}

      <div className="grid cols-2">
        <section className="card">
          <b>{t("Quiénes son", "Who they are")}</b>
          <p className="small">{a.industry ?? t("Sector sin definir", "Sector not set")}{a.taxId ? ` · NIT ${a.taxId}` : ""}{a.address ? ` · ${a.address}` : ""}{a.website ? ` · ${a.website.replace(/^https?:\/\//, "")}` : ""}</p>
          <span className="src block">{t("Responsable de la relación", "Relationship owner")}: {a.owner.name}</span>
          {data.alsoSupplier.map((s) => <Link key={s.id} href={`/suppliers/${s.id}`} className="sig info">{t("También proveedor", "Also a supplier")}: {s.name}</Link>)}
          <div className="mk-head" style={{ marginTop: 8 }}>
            <span className="small muted">{t("También se conoce como", "Also known as")}:</span>
            {a.aliases.length === 0 && <span className="small muted">—</span>}
            {a.aliases.map((x) => <form key={x.id} action={removeAlias.bind(null, a.id, x.id)} className="mk-chip"><span>{x.name}</span><button type="submit" className="link small" aria-label={t("Quitar", "Remove")}>×</button></form>)}
          </div>
          <details><summary className="small">{t("Agregar otro nombre", "Add another name")}</summary>
            <form action={addAlias.bind(null, a.id)} className="row">
              <input name="name" required maxLength={160} placeholder={t("Razón social, nombre comercial o sigla", "Legal name, trade name or acronym")} style={{ flex: 1 }} />
              <select name="kind" defaultValue="TRADE"><option value="LEGAL">{t("Razón social", "Legal name")}</option><option value="TRADE">{t("Nombre comercial", "Trade name")}</option><option value="ACRONYM">{t("Sigla", "Acronym")}</option></select>
              <button type="submit" className="secondary">{t("Agregar", "Add")}</button>
            </form>
          </details>
        </section>

        <section className="card mk-move">
          <b>{t("Siguiente movimiento útil", "Next useful movement")}</b>
          {data.explorations.length === 0 ? (
            <>
              <p className="small muted">{t("Ninguna exploración incluye esta empresa todavía. Explorarla ayuda a que el siguiente paso no dependa de la memoria de nadie.", "No exploration includes this company yet. Exploring it means the next step doesn't depend on anyone's memory.")}</p>
              <form action={exploreCompany.bind(null, a.id)}><button type="submit">{t("Explorar esta empresa", "Explore this company")}</button></form>
            </>
          ) : (
            <ul className="mk-ul">
              {data.explorations.map((e) => {
                const m = movementOf(e);
                return (
                  <li key={e.id}><Link href={`/mercado/exploraciones/${e.id}`}><b>{e.name}</b></Link> {e.lifecycle === "CLOSED" ? <span className="sig wait">{t("Cerrada", "Closed")}</span> : <span className={`sig ${MOVEMENT[m].cls}`}>{L(MOVEMENT[m])}</span>}
                    <span className="src block">{e.lifecycle === "CLOSED" ? e.resultSummary : m === "MOVE" ? `${e.nextMove}${e.nextMoveAt ? ` · ${i.day(e.nextMoveAt)}` : ""}` : m === "WAIT" ? `${e.waitingFor} · ${i.day(e.waitingUntil!)}` : m === "TRIGGER" ? `${e.triggerEvent ?? ""}${e.triggerOn ? ` · ${i.day(e.triggerOn)}` : ""}` : t("Falta decidir el siguiente paso", "Next step still to decide")} · {e.owner.name}</span></li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="mk-sec">
        <h2>{t("Inteligencia económica", "Economic intelligence")}</h2>
        {econ ? <EconBlock d={econ} t={t} lang={user.lang} day={i.day} /> : <div className="card empty small">{a.taxId ? t("No hay cifras públicas cargadas para este NIT todavía.", "No public figures loaded for this NIT yet.") : t("Sin NIT no podemos enlazar sus cifras públicas. Agrégalo en el cliente.", "Without a NIT we can't link its public figures. Add it on the customer.")}</div>}
      </section>

      <section className="mk-sec" id="pagos">
        <h2>{t("Cómo paga", "How they pay")}</h2>
        {pay && <PayBlock b={pay.b} rules={pay.rules.value} rulesVersion={pay.rules.version} detail={canManageAll(user)} t={t} i={i} accountId={a.id} />}
      </section>

      <section className="mk-sec">
        <h2>{t("Cómo funciona esta empresa", "How this account works")}</h2>
        <div className="grid cols-2">
          {(["OPERATE", "DECIDE", "BUY", "VALUE", "HURT"] as const).map((b) => (
            <div key={b} className="card">
              <b>{L(INSIGHT_BLOCKS[b])}</b> <span className="src">{L(INSIGHT_BLOCKS[b].q)}</span>
              {b === "DECIDE" && decide.length > 0 ? (
                <ul className="mk-ul mk-map">
                  {areas.map((ar) => {
                    const rows = decide.filter((x) => (x.area ?? t("Sin área", "No area")) === ar).sort((p, q) => order.indexOf(p.step ?? "") - order.indexOf(q.step ?? ""));
                    return <li key={ar}><b>{ar}</b>: {rows.map((x) => `${x.step ? L(DECIDE_STEPS[x.step]).toLowerCase() : ""}${x.condition ? ` (${x.condition})` : ""}`).filter(Boolean).join(" + ")}
                      <ul className="mk-ul">{rows.map((x) => <Item key={x.id} x={x} />)}</ul></li>;
                  })}
                </ul>
              ) : by(b).length === 0 && !data.plantInsights.some((x) => x.block === b) ? (
                <p className="small muted">{t("Aún no lo sabemos.", "We don't know yet.")}</p>
              ) : <ul className="mk-ul">{by(b).map((x) => <Item key={x.id} x={x} />)}</ul>}
              {data.plantInsights.filter((x) => x.block === b).length > 0 && <ul className="mk-ul">{data.plantInsights.filter((x) => x.block === b).map((x) => <Item key={x.id} x={x} />)}</ul>}
              <AddInsight block={b} />
            </div>
          ))}
          <div className="card">
            <b>{t("Preguntas que vale la pena hacer", "Questions worth asking")}</b> <span className="src">{t("Solo sobre lo que aún no sabemos", "Only about what we don't know yet")}</span>
            {data.questions.length === 0 ? <p className="small muted">{t("Ya tenemos una buena base. Las preguntas abiertas están abajo.", "We have a good base. Open questions are below.")}</p> : (
              <ul className="mk-ul">
                {data.questions.map((q) => (
                  <li key={q.key}>«{t(q.es, q.en)}»
                    <form action={addOpenQuestion.bind(null, a.id)}><input type="hidden" name="back" value={back} /><input type="hidden" name="question" value={q.es} /><button type="submit" className="link small">{t("Anotar como pregunta abierta", "Add as an open question")}</button></form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="mk-sec">
        <h2>{t("Plantas y operaciones", "Plants and operations")}</h2>
        <div className="grid cols-3">
          {a.plants.map((p) => (
            <Link key={p.id} href={`/mercado/plantas/${p.id}`} className="card mk-link">
              <b>{p.name}</b><span className="src block">{[p.city, p.country].filter(Boolean).join(", ")}{p.operationType ? ` · ${p.operationType}` : ""}</span>
              <span className="small">{t(`${p._count.assets} equipo(s) conocidos`, `${p._count.assets} known equipment`)}{p.assets.some((x) => x.critical) ? ` · ${t(`${p.assets.filter((x) => x.critical).length} crítico(s)`, `${p.assets.filter((x) => x.critical).length} critical`)}` : ""}{p._count.impacts ? ` · ${t("impacto de paro conocido", "downtime impact known")}` : ""}</span>
            </Link>
          ))}
          {a.plants.length === 0 && <div className="card empty small">{t("No conocemos sus plantas todavía.", "We don't know their plants yet.")}</div>}
        </div>
        <details className="card">
          <summary>{t("Registrar una planta", "Record a plant")}</summary>
          <form action={addPlantFromCompany.bind(null, a.id)} className="stack" style={{ maxWidth: 720 }}>
            <div className="row">
              <label style={{ flex: 1 }}>{t("Nombre", "Name")}<input name="name" required maxLength={120} /></label>
              <label>{t("Ciudad", "City")}<input name="city" maxLength={80} /></label>
              <label>{t("País", "Country")}<select name="country" defaultValue="Colombia"><option>Colombia</option><option>Estados Unidos</option></select></label>
            </div>
            <label>{t("Qué opera", "What it operates")}<input name="operationType" maxLength={200} /></label>
            <ProvFields t={t} />
            <button type="submit" className="secondary">{t("Crear planta", "Create plant")}</button>
          </form>
        </details>
      </section>

      <div className="grid cols-2">
        <section className="mk-sec">
          <h2>{t("Personas y relaciones", "People and relationships")}</h2>
          <div className="card">
            <ul className="mk-ul">
              {a.employments.map((e) => (
                <li key={e.id}><b><Link href={`/mercado/personas/${e.contact.id}`}>{fullName(e.contact)}</Link></b>{e.role ? ` · ${e.role}` : e.contact.title ? ` · ${e.contact.title}` : ""}<span className="muted">{e.area ? ` · ${e.area}` : ""}{e.plant ? ` · ${e.plant.name}` : ""}</span>
                  <Prov t={t} day={i.day} x={{ ...e, observedAt: e.startedOn }} />
                  <details><summary className="small muted">{t("Ya no está en este rol", "No longer in this role")}</summary>
                    <form action={endEmployment.bind(null, e.id)} className="row"><input type="hidden" name="back" value={back} /><input name="endedOn" type="date" /><button type="submit" className="secondary">{t("Guardar", "Save")}</button></form>
                  </details>
                </li>
              ))}
              {data.otherContacts.map((c) => <li key={c.id}><Link href={`/mercado/personas/${c.id}`}>{fullName(c)}</Link>{c.title ? ` · ${c.title}` : ""} <span className="src">{t("contacto sin rol confirmado", "contact without a confirmed role")}</span></li>)}
            </ul>
            {a.employments.length + data.otherContacts.length === 0 && <p className="small muted">{t("Aún no conocemos a nadie aquí.", "We don't know anyone here yet.")}</p>}
            <details>
              <summary className="small">{t("Anotar quién trabaja aquí", "Note who works here")}</summary>
              <form action={addEmployment.bind(null, a.id)} className="stack">
                <input type="hidden" name="back" value={back} />
                <div className="row">
                  <label style={{ flex: 1 }}>{t("Contacto", "Contact")}<select name="contactId" defaultValue=""><option value="">{t("Persona nueva (escribe abajo)", "New person (type below)")}</option>{a.contacts.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}</select></label>
                  <label>{t("Nombre", "First name")}<input name="firstName" maxLength={60} /></label>
                  <label>{t("Apellido", "Last name")}<input name="lastName" maxLength={60} /></label>
                </div>
                <div className="row">
                  <label>{t("Área", "Area")}<input name="area" list="mk-areas" maxLength={60} /></label>
                  <label style={{ flex: 1 }}>{t("Rol real", "Actual role")}<input name="role" maxLength={120} placeholder={t("Ej.: Jefe de mantenimiento mecánico", "E.g.: Mechanical maintenance lead")} /></label>
                  <label>{t("Planta", "Plant")}<select name="plantId" defaultValue=""><option value="">—</option>{a.plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                </div>
                <ProvFields t={t} />
                <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
              </form>
            </details>
          </div>
        </section>

        <section className="mk-sec">
          <h2>{t("Tecnologías", "Technologies")}</h2>
          <div className="card">
            <p className="small"><span className="sig ok">{t("Instalado", "Installed")}</span> {data.installed.length ? data.installed.join(" · ") : <span className="muted">{t("Aún no hemos visto equipos instalados.", "We haven't seen installed equipment yet.")}</span>}</p>
            {data.interest.length > 0 && <p className="small"><span className="sig dash">{t("Por confirmar", "To confirm")}</span> {data.interest.join(" · ")} <span className="src block">{t("Marcas que estamos explorando aquí; no sabemos si las usan.", "Brands we're exploring here; we don't know whether they use them.")}</span></p>}
          </div>
          <h2 style={{ marginTop: 16 }}>{t("Qué cambió", "What changed")}</h2>
          <div className="card">
            {a.marketSignals.length + a.futures.length === 0 && <p className="small muted">{t("Sin señales ni proyectos registrados.", "No signals or projects recorded.")}</p>}
            <ul className="mk-ul">
              {a.marketSignals.map((s) => <li key={s.id}><span className="sig info">{L(SIGNAL_KINDS[s.kind])}</span> {s.what}<Prov t={t} day={i.day} x={s} /></li>)}
              {a.futures.map((f) => <li key={f.id}><span className="sig wait">{L(FUTURE_KINDS[f.kind])}</span> {f.description}{f.plant ? ` · ${f.plant.name}` : ""}{f.expectedAt ? ` · ${i.day(f.expectedAt)}` : ""}</li>)}
            </ul>
          </div>
        </section>
      </div>

      <div className="grid cols-2">
        <section className="mk-sec">
          <h2>{t("Lo que no sabemos", "What we don't know")}</h2>
          <div className="card">
            {data.openGaps.length === 0 && <p className="small muted">{t("Sin preguntas abiertas.", "No open questions.")}</p>}
            <ul className="mk-ul">
              {data.openGaps.map((g) => (
                <li key={g.id}><span className="sig dash">{t("Desconocido", "Unknown")}</span> <b>{g.question}</b>
                  <details><summary className="small">{t("Ya lo sabemos", "We know now")}</summary>
                    <form action={answerQuestion.bind(null, g.id)} className="stack"><input type="hidden" name="back" value={back} />
                      <input name="answer" required maxLength={1000} placeholder={t("Respuesta", "Answer")} /><input name="answerSource" maxLength={200} placeholder={t("¿Quién o qué lo confirmó?", "Who or what confirmed it?")} />
                      <button type="submit" className="secondary">{t("Guardar respuesta", "Save answer")}</button></form>
                  </details>
                </li>
              ))}
            </ul>
            <form action={addOpenQuestion.bind(null, a.id)} className="row"><input type="hidden" name="back" value={back} /><input name="question" required maxLength={300} placeholder={t("Nueva pregunta abierta", "New open question")} style={{ flex: 1 }} /><button type="submit" className="secondary">{t("Anotar", "Add")}</button></form>
            {data.learned.length > 0 && <><b className="small">{t("Lo que aprendimos", "What we learned")}</b><ul className="mk-ul">{data.learned.map((g) => <li key={g.id}><span className="sig ok">{t("Hecho", "Fact")}</span> {g.answer}<span className="src block">{g.answerSource ?? ""}{g.resolvedAt ? ` · ${i.day(g.resolvedAt)}` : ""}</span></li>)}</ul></>}
          </div>
        </section>
        <section className="mk-sec">
          <h2>{t("Espacios sin explorar", "White space")}</h2>
          <div className="card">
            {a.whiteSpaces.length === 0 ? <p className="small muted">{t("Ninguno anotado. Se anotan desde una exploración.", "None noted. They're added from an exploration.")}</p> : (
              <ul className="mk-ul">{a.whiteSpaces.map((w) => <li key={w.id}><span className="sig wait">{L(WHITE_KINDS[w.kind])}</span> {w.what}{w.status !== "OPEN" && w.status !== "EXPLORING" && <span className="muted"> · {w.status === "RESOLVED" ? t("ya estamos ahí", "we're there now") : t("no aplica", "not relevant")}</span>}{w.why && <span className="src block">{w.why}</span>}</li>)}</ul>
            )}
          </div>
        </section>
      </div>

      <section className="mk-sec">
        <h2>{t("Historia con nosotros", "History with us")}</h2>
        {a._count.deals === 0 ? <div className="card empty small">{t("Aún no hemos trabajado juntos.", "We haven't worked together yet.")}</div> : (
          <div className="card flush">
            <table>
              <thead><tr><th>Journey</th><th>{t("Estado", "Stage")}</th><th>{t("Fecha", "Date")}</th></tr></thead>
              <tbody>{a.deals.map((d) => <tr key={d.id}><td><Link href={`/deals/${d.id}`}>{d.title}</Link><span className="src">{d.code}</span></td><td className="small">{t(...(STAGE[d.stage] ?? [d.stage, d.stage]))}</td><td className="small">{i.day(d.createdAt)}</td></tr>)}</tbody>
            </table>
            <p className="src" style={{ padding: "8px 16px" }}>{t(`${a._count.deals} Journey(s) en total, ${data.won} ganado(s).`, `${a._count.deals} Journey(s) in total, ${data.won} won.`)}</p>
          </div>
        )}
      </section>
    </>
  );
}
