import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { plantExploration } from "@/lib/market";
import { AREAS, FUTURE_KINDS, INSIGHT_BLOCKS, MOVEMENT, REDUNDANCY, SIGNAL_KINDS, STOPS_LINE, movementOf } from "@/lib/market-rules";
import { addAsset, addEmployment, addImpact, addInsight, addOpenQuestion, answerQuestion, supersedeInsight } from "../../intel-actions";
import { MSG_ERR, MSG_OK, Prov, ProvFields } from "../../ui";

// Plant Exploration (Módulo 09 §13.4): how does this plant work and what could affect its continuity?

export default async function PlantExplorationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const data = await plantExploration(id);
  if (!data) notFound();
  const { p } = data;
  const i = makeI18n(user.lang);
  const { t } = i;
  const L = (x: { es: string; en: string } | undefined) => (x ? t(x.es, x.en) : "");
  const back = `/mercado/plantas/${p.id}`;
  const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();
  const money = (cur: string, v: number) => `${cur} ${i.n(v)}`;

  return (
    <>
      <datalist id="mk-areas">{AREAS.map((x) => <option key={x} value={x} />)}</datalist>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado">{t("Mercado", "Market")}</Link> · <Link href={`/mercado/empresas/${p.account.id}`}>{p.account.name}</Link></div>
          <h1>{p.name}</h1>
          <p>{t("¿Cómo funciona esta planta y qué podría afectar su continuidad?", "How does this plant work and what could affect its continuity?")}</p>
          <span className="src block">{[p.city, p.country].filter(Boolean).join(", ")}{p.operationType ? ` · ${p.operationType}` : ""}</span>
          <Prov t={t} day={i.day} x={p} />
        </div>
      </div>
      {sp.ok && MSG_OK[sp.ok] && <div className="note okn">{t(...MSG_OK[sp.ok])}</div>}
      {sp.err && MSG_ERR[sp.err] && <div className="note attn">{t(...MSG_ERR[sp.err])}</div>}

      <div className="grid cols-2">
        <section className="card mk-move">
          <b>{t("Siguiente movimiento", "Next movement")}</b>
          {data.explorations.filter((e) => e.lifecycle !== "CLOSED").length === 0 ? <p className="small muted">{t("Ninguna exploración activa incluye esta empresa.", "No active exploration includes this company.")} <Link href={`/mercado/empresas/${p.account.id}`}>{t("Ir a la empresa", "Go to the company")}</Link></p> : (
            <ul className="mk-ul">{data.explorations.filter((e) => e.lifecycle !== "CLOSED").map((e) => { const m = movementOf(e); return <li key={e.id}><Link href={`/mercado/exploraciones/${e.id}`}>{e.name}</Link> <span className={`sig ${MOVEMENT[m].cls}`}>{L(MOVEMENT[m])}</span>{m === "MOVE" && <span className="src block">{e.nextMove}{e.nextMoveAt ? ` · ${i.day(e.nextMoveAt)}` : ""}</span>}</li>; })}</ul>
          )}
        </section>
        <section className="card">
          <b>{t("Preguntas que vale la pena hacer", "Questions worth asking")}</b>
          {data.questions.length === 0 ? <p className="small muted">{t("Ya tenemos una buena base de esta planta.", "We have a good base for this plant.")}</p> : (
            <ul className="mk-ul">{data.questions.map((q) => <li key={q.key}>«{t(q.es, q.en)}»<form action={addOpenQuestion.bind(null, p.accountId)}><input type="hidden" name="back" value={back} /><input type="hidden" name="plantId" value={p.id} /><input type="hidden" name="question" value={q.es} /><button type="submit" className="link small">{t("Anotar como pregunta abierta", "Add as an open question")}</button></form></li>)}</ul>
          )}
        </section>
      </div>

      <section className="mk-sec">
        <h2>{t("Procesos, líneas y equipos", "Processes, lines and equipment")}</h2>
        {data.tree.length === 0 ? <div className="card empty small">{t("Aún no conocemos sus equipos. Una visita o una foto de la placa es un buen comienzo.", "We don't know their equipment yet. A visit or a nameplate photo is a good start.")}</div> : (
          <div className="grid cols-2">
            {data.tree.map((pr) => (
              <div key={pr.process} className="card">
                <b>{pr.process}</b>
                {pr.lines.map((ln) => (
                  <div key={ln.line} className="mk-line">
                    {ln.line !== "—" && <span className="small muted">{t("Línea", "Line")} {ln.line}</span>}
                    <ul className="mk-ul">
                      {ln.assets.map((x) => (
                        <li key={x.id}><b>{x.name}</b>{x.manufacturer ? ` · ${x.manufacturer}` : ""}{x.model ? ` ${x.model}` : ""} {x.critical && <span className="sig risk">{t("Crítico", "Critical")}</span>} <span className={`sig ${x.redundancy === "NONE" ? "attn" : x.redundancy === "UNKNOWN" ? "dash" : "wait"}`}>{L(REDUNDANCY[x.redundancy])}</span>
                          {x.operationalRole && <span className="src block">{x.operationalRole}</span>}
                          {x.criticalWhy && <span className="src block">{t("Por qué es crítico", "Why it's critical")}: {x.criticalWhy}</span>}
                          {x.knownComponents && <span className="src block">{t("Componentes conocidos", "Known components")}: {x.knownComponents}</span>}
                          {x.serial && <span className="src block">S/N {x.serial}</span>}
                          <Prov t={t} day={i.day} x={x} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <details className="card">
          <summary>{t("Registrar un equipo", "Record equipment")}</summary>
          <form action={addAsset.bind(null, p.id)} className="stack" style={{ maxWidth: 760 }}>
            <div className="row">
              <label style={{ flex: 1 }}>{t("Qué equipo es", "What equipment")}<input name="name" required maxLength={160} placeholder={t("Ej.: Bomba centrífuga de CIP", "E.g.: CIP centrifugal pump")} /></label>
              <label>{t("Proceso", "Process")}<input name="process" maxLength={120} list="mk-proc" /></label>
              <label>{t("Línea", "Line")}<input name="line" maxLength={120} /></label>
            </div>
            <div className="row">
              <label>{t("Fabricante", "Manufacturer")}<input name="manufacturer" maxLength={80} /></label>
              <label>{t("Modelo", "Model")}<input name="model" maxLength={120} /></label>
              <label>{t("Serie", "Serial")}<input name="serial" maxLength={120} /></label>
              <label>{t("Respaldo", "Backup")}<select name="redundancy" defaultValue="UNKNOWN">{Object.entries(REDUNDANCY).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
            </div>
            <label>{t("Qué hace en la operación", "Its role in the operation")}<input name="operationalRole" maxLength={200} /></label>
            <div className="row">
              <label className="loc-check"><input type="checkbox" name="critical" value="1" /> {t("El cliente lo considera crítico", "The customer considers it critical")}</label>
              <label style={{ flex: 1 }}>{t("Por qué (lo que dijeron)", "Why (what they said)")}<input name="criticalWhy" maxLength={300} /></label>
            </div>
            <label>{t("Componentes o repuestos conocidos", "Known components or parts")}<input name="knownComponents" maxLength={500} /></label>
            <ProvFields t={t} defSource="VISIT" />
            <button type="submit" className="secondary">{t("Guardar equipo", "Save equipment")}</button>
          </form>
          <datalist id="mk-proc">{data.tree.map((x) => <option key={x.process} value={x.process} />)}</datalist>
        </details>
      </section>

      <div className="grid cols-2">
        <section className="mk-sec">
          <h2>{t("Impacto de un paro", "Downtime impact")}</h2>
          <div className="card">
            {data.impacts.length === 0 && <p className="small muted">{t("No sabemos aún qué cuesta un paro aquí. Saberlo ayuda a decidir cuándo vale la pena un flete más rápido.", "We don't know yet what a stop costs here. Knowing it helps decide when faster freight is worth it.")}</p>}
            <ul className="mk-ul">
              {data.impacts.map((x) => (
                <li key={x.id}><b>{x.scope}</b>{x.asset ? ` · ${x.asset.name}` : ""} <span className={`sig ${x.stopsLine === "YES" ? "risk" : x.stopsLine === "UNKNOWN" ? "dash" : "wait"}`}>{L(STOPS_LINE[x.stopsLine])}</span>
                  {x.range ? (
                    <p className="mk-impact">{x.level === "GUIDED" ? t("Estimación de SOLU", "SOLU estimate") : t("Según el cliente", "Per the customer")}: <b>{x.range.min === x.range.max ? money(x.currency, x.range.min) : `${money(x.currency, x.range.min)} – ${i.n(x.range.max)}`}</b> {t("por hora", "per hour")}
                      <span className="src block">{t("Base", "Basis")}: {L(x.range.basis)}{x.basis ? ` · ${x.basis}` : ""}</span></p>
                  ) : <p className="small muted">{t("Sin cifra todavía.", "No figure yet.")}</p>}
                  {x.restart != null && <span className="src block">{t("Más un costo único de reinicio", "Plus a one-time restart cost")}: {money(x.currency, x.restart)}</span>}
                  {x.timeToImpact && <span className="src block">{t("Tiempo antes del impacto", "Time before impact")}: {x.timeToImpact}</span>}
                  <Prov t={t} day={i.day} x={x} />
                </li>
              ))}
            </ul>
            <details>
              <summary className="small">{t("El cliente nos dio una cifra", "The customer gave us a figure")}</summary>
              <form action={addImpact.bind(null, p.id)} className="stack">
                <input type="hidden" name="level" value="REPORTED" />
                <ImpactCommon t={t} L={L} assets={p.assets} />
                <div className="row">
                  <label>{t("Moneda", "Currency")}<select name="currency" defaultValue={p.country === "Estados Unidos" ? "USD" : "COP"}><option>COP</option><option>USD</option></select></label>
                  <label>{t("Desde (por hora)", "From (per hour)")}<input name="costPerHourMin" type="number" min="0" step="0.01" /></label>
                  <label>{t("Hasta (por hora)", "To (per hour)")}<input name="costPerHourMax" type="number" min="0" step="0.01" /></label>
                </div>
                <label>{t("Lo que dijeron", "What they said")}<input name="basis" maxLength={300} placeholder={t("Ej.: «Una hora parada nos cuesta unos 40 millones»", "E.g.: “An hour down costs us about 40 million”")} /></label>
                <ProvFields t={t} />
                <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
              </form>
            </details>
            <details>
              <summary className="small">{t("Estimarlo juntos con datos de producción", "Estimate it together from production data")}</summary>
              <form action={addImpact.bind(null, p.id)} className="stack">
                <input type="hidden" name="level" value="GUIDED" />
                <ImpactCommon t={t} L={L} assets={p.assets} />
                <div className="row">
                  <label>{t("Moneda", "Currency")}<select name="currency" defaultValue={p.country === "Estados Unidos" ? "USD" : "COP"}><option>COP</option><option>USD</option></select></label>
                  <label>{t("Producción por hora (unidades)", "Production per hour (units)")}<input name="unitsPerHour" type="number" min="0" step="0.01" required /></label>
                  <label>{t("Contribución por unidad", "Contribution per unit")}<input name="contributionUnit" type="number" min="0" step="0.01" required /></label>
                </div>
                <div className="row">
                  <label>{t("Desperdicio por hora (opcional)", "Scrap per hour (optional)")}<input name="scrapPerHour" type="number" min="0" step="0.01" /></label>
                  <label>{t("Mano de obra parada por hora (opcional)", "Idle labor per hour (optional)")}<input name="idleLaborPerHour" type="number" min="0" step="0.01" /></label>
                  <label>{t("Costo de reinicio (una vez)", "Restart cost (one-time)")}<input name="restartCost" type="number" min="0" step="0.01" /></label>
                </div>
                <span className="src block">{t("SOLU muestra un rango: lo mínimo es la contribución perdida; lo máximo suma desperdicio y mano de obra parada. El reinicio se muestra aparte.", "SOLU shows a range: the minimum is lost contribution; the maximum adds scrap and idle labor. Restart is shown apart.")}</span>
                <input type="hidden" name="sourceType" value="CONVERSATION" />
                <label>{t("Referencia", "Reference")}<input name="sourceRef" maxLength={300} placeholder={t("¿Quién nos dio los datos?", "Who gave us the data?")} /></label>
                <button type="submit" className="secondary">{t("Calcular y guardar", "Calculate and save")}</button>
              </form>
            </details>
          </div>
        </section>

        <section className="mk-sec">
          <h2>{t("Calendario de mantenimiento y proyectos", "Maintenance and project calendar")}</h2>
          <div className="card">
            {p.futures.length === 0 ? <p className="small muted">{t("Sin paradas ni proyectos conocidos.", "No known shutdowns or projects.")}</p> : (
              <ul className="mk-ul">{p.futures.map((f) => <li key={f.id}><span className="sig wait">{L(FUTURE_KINDS[f.kind])}</span> {f.description}{f.expectedAt ? ` · ${i.day(f.expectedAt)}` : ` · ${t("sin fecha aún", "no date yet")}`}<Prov t={t} day={i.day} x={f} /></li>)}</ul>
            )}
          </div>
          <h2 style={{ marginTop: 16 }}>{t("Personas en la planta", "People at the plant")}</h2>
          <div className="card">
            {p.employments.length === 0 && <p className="small muted">{t("Aún no sabemos quién trabaja aquí.", "We don't know who works here yet.")}</p>}
            <ul className="mk-ul">{p.employments.map((e) => <li key={e.id}><b>{fullName(e.contact)}</b>{e.role ? ` · ${e.role}` : ""}{e.area ? <span className="muted"> · {e.area}</span> : null}</li>)}</ul>
            <details>
              <summary className="small">{t("Anotar quién trabaja aquí", "Note who works here")}</summary>
              <form action={addEmployment.bind(null, p.accountId)} className="stack">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="plantId" value={p.id} />
                <div className="row">
                  <select name="contactId" defaultValue=""><option value="">{t("Persona nueva", "New person")}</option>{data.contacts.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}</select>
                  <input name="firstName" maxLength={60} placeholder={t("Nombre", "First name")} /><input name="lastName" maxLength={60} placeholder={t("Apellido", "Last name")} />
                </div>
                <div className="row"><input name="area" list="mk-areas" maxLength={60} placeholder={t("Área", "Area")} /><input name="role" maxLength={120} placeholder={t("Rol real", "Actual role")} style={{ flex: 1 }} /></div>
                <ProvFields t={t} />
                <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
              </form>
            </details>
          </div>
        </section>
      </div>

      <div className="grid cols-2">
        <section className="mk-sec">
          <h2>{t("Cómo opera y qué le duele", "How it operates and what hurts")}</h2>
          <div className="card">
            {p.insights.length === 0 && <p className="small muted">{t("Aún no lo sabemos.", "We don't know yet.")}</p>}
            <ul className="mk-ul">{p.insights.map((x) => (
              <li key={x.id}><span className="sig info">{L(INSIGHT_BLOCKS[x.block])}</span> {x.statement}{x.evidence && <span className="src block">«{x.evidence}»</span>}<Prov t={t} day={i.day} x={x} />
                <details><summary className="small muted">{t("Ya no es así", "No longer true")}</summary><form action={supersedeInsight.bind(null, x.id)} className="row"><input type="hidden" name="back" value={back} /><input name="note" required maxLength={300} style={{ flex: 1 }} /><button type="submit" className="secondary">{t("Guardar", "Save")}</button></form></details>
              </li>))}</ul>
            <details>
              <summary className="small">{t("Anotar lo que sabemos", "Note what we know")}</summary>
              <form action={addInsight.bind(null, p.accountId)} className="stack">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="plantId" value={p.id} />
                <select name="block" defaultValue="OPERATE"><option value="OPERATE">{L(INSIGHT_BLOCKS.OPERATE)}</option><option value="HURT">{L(INSIGHT_BLOCKS.HURT)}</option></select>
                <input name="statement" required maxLength={500} placeholder={t("Ej.: Trabajan 3 turnos, 6 días; la parada mayor es en enero", "E.g.: 3 shifts, 6 days; the major shutdown is in January")} />
                <input name="evidence" maxLength={500} placeholder={t("Evidencia (opcional)", "Evidence (optional)")} />
                <ProvFields t={t} />
                <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
              </form>
            </details>
          </div>
        </section>

        <section className="mk-sec">
          <h2>{t("Lo que no sabemos", "What we don't know")}</h2>
          <div className="card">
            {data.openGaps.length === 0 && <p className="small muted">{t("Sin preguntas abiertas en esta planta.", "No open questions at this plant.")}</p>}
            <ul className="mk-ul">{data.openGaps.map((g) => (
              <li key={g.id}><span className="sig dash">{t("Desconocido", "Unknown")}</span> <b>{g.question}</b>
                <details><summary className="small">{t("Ya lo sabemos", "We know now")}</summary>
                  <form action={answerQuestion.bind(null, g.id)} className="stack"><input type="hidden" name="back" value={back} /><input name="answer" required maxLength={1000} placeholder={t("Respuesta", "Answer")} /><input name="answerSource" maxLength={200} placeholder={t("¿Quién o qué lo confirmó?", "Who or what confirmed it?")} /><button type="submit" className="secondary">{t("Guardar respuesta", "Save answer")}</button></form>
                </details></li>))}</ul>
            <form action={addOpenQuestion.bind(null, p.accountId)} className="row"><input type="hidden" name="back" value={back} /><input type="hidden" name="plantId" value={p.id} /><input name="question" required maxLength={300} placeholder={t("Nueva pregunta abierta", "New open question")} style={{ flex: 1 }} /><button type="submit" className="secondary">{t("Anotar", "Add")}</button></form>
          </div>
          {p.signals.length > 0 && <>
            <h2 style={{ marginTop: 16 }}>{t("Señales", "Signals")}</h2>
            <div className="card"><ul className="mk-ul">{p.signals.map((s) => <li key={s.id}><span className="sig info">{L(SIGNAL_KINDS[s.kind])}</span> {s.what}<Prov t={t} day={i.day} x={s} /></li>)}</ul></div>
          </>}
          <h2 style={{ marginTop: 16 }}>{t("Journeys de la empresa", "Company Journeys")}</h2>
          <div className="card">
            {data.deals.length === 0 ? <p className="small muted">{t("Aún no hemos trabajado juntos.", "We haven't worked together yet.")}</p> : <ul className="mk-ul">{data.deals.map((d) => <li key={d.id}><Link href={`/deals/${d.id}`}>{d.title}</Link> <span className="src">{d.code} · {i.day(d.createdAt)}</span></li>)}</ul>}
          </div>
        </section>
      </div>
    </>
  );
}

function ImpactCommon({ t, L, assets }: { t: (es: string, en: string) => string; L: (x: { es: string; en: string } | undefined) => string; assets: { id: string; name: string }[] }) {
  return (
    <>
      <div className="row">
        <label style={{ flex: 1 }}>{t("Qué se detiene", "What stops")}<input name="scope" required maxLength={200} placeholder={t("Ej.: Línea UHT 1", "E.g.: UHT line 1")} /></label>
        <label>{t("Equipo (opcional)", "Equipment (optional)")}<select name="assetId" defaultValue=""><option value="">—</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>{t("¿Para la línea?", "Stops the line?")}<select name="stopsLine" defaultValue="UNKNOWN">{Object.entries(STOPS_LINE).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
      </div>
      <label>{t("Cuánto aguantan antes del impacto (respaldo, inventario)", "How long before impact (backup, stock)")}<input name="timeToImpact" maxLength={200} placeholder={t("Ej.: 4 horas con el tanque pulmón", "E.g.: 4 hours with the buffer tank")} /></label>
    </>
  );
}
