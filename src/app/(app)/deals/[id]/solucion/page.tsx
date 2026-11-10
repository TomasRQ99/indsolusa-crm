import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput } from "@/lib/domain";
import { quoteNo } from "@/lib/quote";
import { solutionWorkspace } from "@/lib/solution";
import { ATTR_STATUS, AUDIENCE, PRESENT_LEVEL, PRESENT_POLICY, PROPOSAL_RULES, ROUTE_KIND, absoluteWords } from "@/lib/proposal-rules";
import { addClaim, addRoute, recordPresentation, removeRoute, saveCase, toggleClaim, updateClaim } from "./actions";

// Comercial C5 · Solution Case (§14), Value Bridge (§17), Quick Quote vs Solution Proposal (§18) and presentation (§19).
// SOLU recommends how to present and never forces it (decision C-13). Claims reach the customer only with evidence (C-14).
export default async function SolutionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  if (!(await db.deal.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const W = await solutionWorkspace(id);
  const { d, c, latest, advice } = W;
  const editable = canEdit(user, d.ownerId);
  const L = (x: { es: string; en: string } | undefined, fb = "—") => (x ? t(x.es, x.en) : fb);
  const lvl = PRESENT_LEVEL[advice.level];
  const mode = c?.mode ?? advice.mode;
  const modeLabel = (m: string) => (m === "QUICK" ? t("Cotización rápida", "Quick quote") : t("Propuesta de solución", "Solution proposal"));
  const usable = W.claims.filter((x) => x.state.inProposal);
  const liveAttrs = W.attributes.filter((a) => a.status !== "RETIRED");

  const okMsg: Record<string, string> = {
    caso: t("Caso de solución guardado.", "Solution Case saved."),
    ruta: t("Rutas actualizadas.", "Routes updated."),
    valor: t("Valor guardado con su evidencia: puede ir en la propuesta.", "Value saved with its evidence: it can go in the proposal."),
    hipotesis: t("Guardado como hipótesis interna: sin evidencia de este caso no sale en la propuesta.", "Saved as an internal hypothesis: without evidence for this case it stays out of the proposal."),
    "valor-editado": t("Valor actualizado.", "Value updated."),
    presentacion: t("Presentación registrada. El próximo paso acordado quedó como siguiente movimiento del Journey.", "Presentation recorded. The agreed next step is now the Journey's next movement."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Solo quien lleva el Journey o la dirección pueden cambiar el caso de solución.", "Only the Journey owner or management can change the Solution Case."),
    ruta: t("Elige el tipo de ruta y descríbela.", "Pick the route type and describe it."),
    valor: t("Completa necesidad, ventaja en este caso y beneficio para el cliente.", "Fill in need, advantage in this case and customer benefit."),
    atributo: t("Ese atributo no está disponible.", "That attribute isn't available."),
    fecha: t("La fecha no puede ser futura.", "The date can't be in the future."),
    presentacion: t("Indica la fecha y el canal de la presentación.", "Give the presentation date and channel."),
  };
  const proposalHref = (lang: string) => (latest ? `/documentos/propuesta/${latest.id}?lang=${lang}` : null);

  const scopeBy = (s: string) => d.scopeLines.filter((l) => l.status === s);
  const story = [d.needSpecs?.split("\n")[0], d.impactIfNot && t(`Si no se resuelve: ${d.impactIfNot}`, `If not solved: ${d.impactIfNot}`), latest?.solution].filter(Boolean) as string[];

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=quote`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{t("Caso de solución", "Solution Case")}</span>
          <span className="grow" />
          <Link className="qa-btn" href={`/deals/${d.id}/alcance`}>{t("Técnico y alcance", "Technical & scope")}</Link>
          <Link className="qa-btn" href={`/deals/${d.id}/abastecimiento`}>{t("Abastecimiento", "Sourcing")}</Link>
          {latest && <Link className="qa-btn" href={`/cotizaciones/${latest.id}`}>{t("Cotización", "Quote")} {quoteNo(latest)}</Link>}
        </div>
        <div className="jh-title">
          <h1>{t("¿Por qué esta solución y qué decisión necesita el cliente?", "Why this solution, and what decision does the customer need to make?")}</h1>
        </div>
        <p className="jh-sub">{d.title}{d.desiredResult ? ` · ${t("Resultado", "Result")}: ${d.desiredResult}` : ""}</p>
      </header>

      {/* 1 · How to deliver it */}
      <section className="jblock" id="recomendacion">
        <div className="jbh"><b>{t("CÓMO ENTREGARLA", "HOW TO DELIVER IT")}</b><span className="grow" /><span className="src">{t(`Recomendación de SOLU · ${PRESENT_POLICY.version} · nunca obligatoria`, `SOLU's recommendation · ${PRESENT_POLICY.version} · never mandatory`)}</span></div>
        <p className="sol-adv"><span className={`sig ${lvl.tone}`}>{L(lvl)}</span> <b>{modeLabel(advice.mode)}</b>{c?.mode && c.mode !== advice.mode && <span className="src"> · {t(`elegiste ${modeLabel(c.mode).toLowerCase()}`, `you chose ${modeLabel(c.mode).toLowerCase()}`)}</span>}</p>
        <ul className="plain small">{advice.reasons.map((r, k) => <li key={k}>· {L(r)}</li>)}</ul>
        {latest ? (
          <p className="small" style={{ marginTop: 8 }}>
            {mode === "PROPOSAL" ? <>
              <a className="qa-btn" href={proposalHref(latest.lang)!} target="_blank" rel="noopener">{t("Ver propuesta de solución", "View solution proposal")} ({latest.lang})</a>{" "}
              <a className="qa-btn" href={proposalHref(latest.lang === "EN" ? "ES" : "EN")!} target="_blank" rel="noopener">{latest.lang === "EN" ? "ES" : "EN"}</a>
              <span className="src block">{t(`Para ${quoteNo(latest)}. Sin costos, proveedores ni Eságara; solo afirmaciones con evidencia (${usable.length}). Revísala antes de enviarla: SOLU no la envía.`, `For ${quoteNo(latest)}. No costs, suppliers or Eságara; only evidenced claims (${usable.length}). Review it before sending: SOLU doesn't send it.`)}</span>
            </> : <span className="src">{t("Con la cotización basta. Si igual quieres una propuesta, cambia el formato en el caso.", "The quote is enough. If you still want a proposal, change the format in the case.")} {editable && <a href="#caso">{t("Cambiar", "Change")}</a>}</span>}
          </p>
        ) : <p className="quiet-p">{t("Todavía no hay cotización en este Journey.", "No quote on this Journey yet.")}</p>}
      </section>

      {/* 2 · Solution Case */}
      <section className="jblock" id="caso">
        <div className="jbh"><b>{t("CASO DE SOLUCIÓN", "SOLUTION CASE")}</b><span className="grow" />{c && <span className="src">{t(`Actualizado por ${c.updatedByName} · ${i.day(c.updatedAt)}`, `Updated by ${c.updatedByName} · ${i.day(c.updatedAt)}`)}</span>}</div>
        <dl className="qv-dl">
          <dt>{t("Lo que entendimos", "What we understood")}</dt><dd>{c?.understood ?? d.needSpecs ?? <span className="attn-t">{t("Sin escribir", "Not written")}</span>}</dd>
          <dt>{t("Resultado deseado", "Desired result")}</dt><dd>{d.desiredResult ?? "—"}</dd>
          <dt>{t("Impacto en la operación", "Operational impact")}</dt><dd>{c?.operationalImpact ?? d.impactIfNot ?? "—"}</dd>
          <dt>{t("Alcance", "Scope")}</dt><dd>{d.scopeLines.length ? t(`${scopeBy("INCLUDED").length} incluido(s) · ${scopeBy("EXCLUDED").length} excluido(s) · ${scopeBy("CUSTOMER_SUPPLIED").length} los pone el cliente · ${scopeBy("TO_CONFIRM").length} por confirmar`, `${scopeBy("INCLUDED").length} included · ${scopeBy("EXCLUDED").length} excluded · ${scopeBy("CUSTOMER_SUPPLIED").length} customer-supplied · ${scopeBy("TO_CONFIRM").length} to confirm`) : t("Caso simple: sin alcance detallado", "Simple case: no detailed scope")}</dd>
          <dt>{t("Base de suministro", "Supply basis")}</dt><dd>{W.basis ? <>{W.basis.primary.label}<span className="src block">{W.basis.reason}</span></> : <Link href={`/deals/${d.id}/abastecimiento`}>{t("Sin elegir", "Not chosen")}</Link>}</dd>
          <dt>{t("Riesgos", "Risks")}</dt><dd>{c?.risks ?? "—"}</dd>
          <dt>{t("Recomendación", "Recommendation")}</dt><dd>{c?.recommendation ?? "—"}</dd>
          <dt>{t("Decisión que necesitamos", "Decision we need")}</dt><dd>{c?.decisionNeeded ?? <span className="attn-t">{t("Sin escribir", "Not written")}</span>}</dd>
          <dt>{t("¿Necesita ayuda para comprar bien?", "Do they need help buying well?")}</dt><dd>{c?.helpToBuy ?? <span className="muted">{t("No se ha preguntado", "Not asked yet")}</span>}</dd>
          <dt>{t("Decide", "Decides")}</dt><dd>{W.committee ? t("Comité / varias personas", "Committee / several people") : latest?.decisionLabel ?? "—"}</dd>
        </dl>
        {editable && (
          <details className="scp-add" open={sp.err === "caso"}><summary className="qa-btn">{t("Editar el caso", "Edit the case")}</summary>
            <form action={saveCase.bind(null, d.id)} className="qa-form">
              <label>{t("Lo que entendimos (en palabras que el cliente reconozca)", "What we understood (in words the customer would recognize)")}<textarea name="understood" rows={3} maxLength={1200} defaultValue={c?.understood ?? d.needSpecs ?? ""} /></label>
              <label>{t("Impacto en la operación", "Operational impact")}<textarea name="operationalImpact" rows={2} maxLength={800} defaultValue={c?.operationalImpact ?? ""} /></label>
              <label>{t("Riesgos y supuestos", "Risks and assumptions")}<textarea name="risks" rows={2} maxLength={800} defaultValue={c?.risks ?? ""} /></label>
              <label>{t("Nuestra recomendación y por qué", "Our recommendation and why")}<textarea name="recommendation" rows={2} maxLength={800} defaultValue={c?.recommendation ?? ""} /></label>
              <label>{t("Decisión que le pedimos al cliente", "Decision we ask of the customer")}<input name="decisionNeeded" maxLength={400} defaultValue={c?.decisionNeeded ?? ""} placeholder={t("Ej.: aprobar la opción completa con controlador antes del 20 nov", "E.g.: approve the complete option with controller before Nov 20")} /></label>
              <label>{t("¿Le preguntamos si necesita ayuda para comprar bien? ¿Qué dijo?", "Did we ask whether they need help buying well? What did they say?")}<input name="helpToBuy" maxLength={400} defaultValue={c?.helpToBuy ?? ""} /></label>
              <div className="qa-row">
                <label className="chk"><input type="checkbox" name="committee" value="1" defaultChecked={!!c?.committee} /> {t("Decide un comité o varias personas", "A committee or several people decide")}</label>
                <label>{t("Formato", "Format")}<select name="mode" defaultValue={c?.mode ?? ""}><option value="">{t(`Seguir a SOLU (${modeLabel(advice.mode).toLowerCase()})`, `Follow SOLU (${modeLabel(advice.mode).toLowerCase()})`)}</option><option value="QUICK">{modeLabel("QUICK")}</option><option value="PROPOSAL">{modeLabel("PROPOSAL")}</option></select></label>
              </div>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </details>
        )}
      </section>

      {/* 3 · Routes */}
      <section className="jblock" id="rutas">
        <div className="jbh"><b>{t("RUTAS POSIBLES", "POSSIBLE ROUTES")}</b><span className="grow" /><span className="src">{t("Original, alternativa, reparación, reacondicionado, urgente, compra parcial", "OEM, alternative, repair, refurbished, expedite, partial purchase")}</span></div>
        {W.routes.length === 0 ? <p className="quiet-p">{t("Una sola ruta. Agrega otras solo si el cliente gana algo al conocerlas.", "A single route. Add others only if the customer gains something by knowing them.")}</p> : (
          <ul className="plain">{W.routes.map((r, k) => (
            <li key={k}><b>{L(ROUTE_KIND[r.kind])}</b>: {r.label}{r.note && <span className="src"> — {r.note}</span>}
              {editable && <form action={removeRoute.bind(null, d.id, k)} style={{ display: "inline" }}> <button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>}
            </li>
          ))}</ul>
        )}
        {editable && (
          <details className="scp-add" open={sp.err === "ruta"}><summary className="qa-btn">{t("+ Ruta", "+ Route")}</summary>
            <form action={addRoute.bind(null, d.id)} className="qa-form">
              <div className="qa-row">
                <label>{t("Tipo", "Kind")}<select name="kind" defaultValue="ALTERNATIVE">{Object.entries(ROUTE_KIND).map(([k, v]) => <option key={k} value={k}>{L(v)}</option>)}</select></label>
                <label style={{ flex: 2 }}>{t("Qué es", "What it is")}<input name="label" required maxLength={160} /></label>
              </div>
              <label>{t("Ventaja / límite", "Advantage / limit")}<input name="note" maxLength={300} /></label>
              <button type="submit">{t("Agregar", "Add")}</button>
            </form>
          </details>
        )}
      </section>

      {/* 4 · Value Bridge */}
      <section className="jblock" id="valor">
        <div className="jbh"><b>{t("PUENTE DE VALOR", "VALUE BRIDGE")}</b><span className="grow" /><span className="src">{t("Necesidad → impacto → ventaja → beneficio → prueba", "Need → impact → advantage → benefit → proof")} · <Link href="/comercial/valor">{t("catálogo", "catalog")}</Link></span></div>
        <p className="src" style={{ marginBottom: 8 }}>{t("No muestres los ocho atributos: elige solo los que este caso puede probar. Sin evidencia de este caso, queda como hipótesis interna.", "Don't show all eight attributes: pick only the ones this case can prove. Without evidence for this case, it stays an internal hypothesis.")}</p>
        {W.claims.length === 0 ? <p className="quiet-p">{t("Sin afirmaciones de valor todavía.", "No value claims yet.")}</p> : W.claims.map((x) => {
          const abs = absoluteWords(x.advantage, x.benefit);
          return (
            <div key={x.id} className={`sol-claim${x.state.inProposal ? " in" : " out"}`}>
              <div className="sol-claim-h">
                <b>{t(x.attribute.nameEs, x.attribute.nameEn)}</b>
                {x.audience !== "ALL" && <span className="sig dash">{L(AUDIENCE[x.audience])}</span>}
                <span className="grow" />
                {x.state.inProposal ? <span className="sig ok">{t("En la propuesta", "In the proposal")}</span> : <span className="sig wait">{t("Hipótesis interna", "Internal hypothesis")}</span>}
              </div>
              <p className="small">{x.need}{x.impact && <> → {x.impact}</>} → <b>{x.advantage}</b> → {x.benefit}</p>
              <p className="src">{x.evidence ? <>{t("Evidencia", "Evidence")}: {x.evidence}{x.evidenceAt && ` · ${i.day(x.evidenceAt)}`}{x.validUntil && ` · ${t("vigente hasta", "valid until")} ${i.day(x.validUntil)}`}</> : L(x.state.why ?? undefined)}{x.evidence && !x.state.inProposal && <> · {L(x.state.why ?? undefined)}</>}</p>
              {x.namesSupplier.length > 0 && x.state.inProposal && <p className="small risk-t">{t(`Nombra a nuestro proveedor (${x.namesSupplier.join(", ")}): la propuesta no se abrirá así. Describe la fuente sin el nombre (p. ej. «proforma del proveedor»).`, `Names our supplier (${x.namesSupplier.join(", ")}): the proposal won't open like this. Describe the source without the name (e.g. "supplier proforma").`)}</p>}
              {abs.length > 0 && <p className="small attn-t">{t(`«${abs.join("», «")}»: mejor usa el dato de este caso (p. ej. «5 días vs 3 semanas»).`, `"${abs.join('", "')}": better use this case's data (e.g. "5 days vs 3 weeks").`)}</p>}
              {editable && (
                <div className="qa-bar" style={{ borderTop: 0, paddingTop: 0 }}>
                  <details className="qa"><summary className="qa-btn">{t("Editar", "Edit")}</summary>
                    <div className="qa-pop wide"><form action={updateClaim.bind(null, d.id, x.id)} className="qa-form"><ClaimFields t={t} x={x} /><button type="submit">{t("Guardar", "Save")}</button></form></div>
                  </details>
                  <form action={toggleClaim.bind(null, d.id, x.id)}><button type="submit" className="link small">{x.hidden ? t("Volver a mostrar", "Show again") : t("Ocultar de la propuesta", "Hide from proposal")}</button></form>
                </div>
              )}
            </div>
          );
        })}
        {editable && liveAttrs.length > 0 && (
          <details className="scp-add" open={sp.err === "valor" || sp.err === "atributo"}><summary className="qa-btn">{t("+ Valor para este cliente", "+ Value for this customer")}</summary>
            <form action={addClaim.bind(null, d.id)} className="qa-form">
              <label>{t("Atributo", "Attribute")}<select name="attributeId" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...liveAttrs.map((a) => <option key={a.id} value={a.id} title={`${a.definitionEs}\n${a.restrictions ?? ""}`}>{t(a.nameEs, a.nameEn)}{a.status === "DRAFT" ? ` (${t("borrador", "draft")})` : ""}</option>)]}</select></label>
              <ClaimFields t={t} />
              <p className="src">{t("Pistas de evidencia por atributo: ", "Evidence hints per attribute: ")}{liveAttrs.map((a) => `${t(a.nameEs, a.nameEn)}: ${a.evidenceHint ?? "—"}`).join(" · ")}</p>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </details>
        )}
      </section>

      {/* 5 · Briefing */}
      <details className="jblock sol-brief" id="briefing" open={advice.level !== "SEND_DIRECTLY"}>
        <summary className="jbh"><b>{t("PREPARAR LA PRESENTACIÓN", "PREPARE THE PRESENTATION")}</b><span className="grow" /><span className="src">{advice.level === "SEND_DIRECTLY" ? t("opcional en este caso", "optional in this case") : t("guía, no guion", "a guide, not a script")}</span></summary>
        <ol className="sol-steps">
          <li><b>{t("Confirmar lo que entendimos", "Confirm what we understood")}</b><p className="small">{c?.understood ?? d.needSpecs ?? "—"}{d.desiredResult && <> · {t("Resultado", "Result")}: {d.desiredResult}</>}</p></li>
          <li><b>{t("Necesidad → impacto → solución", "Need → impact → solution")}</b><p className="small">{story.length ? story.join(" → ") : "—"}</p></li>
          <li><b>{t("Alcance", "Scope")}</b><p className="small">{d.scopeLines.length ? <>{scopeBy("INCLUDED").map((l) => l.component).join(", ") || "—"}{scopeBy("EXCLUDED").length > 0 && <span className="src block">{t("No incluye", "Excludes")}: {scopeBy("EXCLUDED").map((l) => l.component).join(", ")}</span>}{scopeBy("CUSTOMER_SUPPLIED").length > 0 && <span className="src block">{t("Lo pone el cliente", "Customer supplies")}: {scopeBy("CUSTOMER_SUPPLIED").map((l) => l.component).join(", ")}</span>}</> : t("Simple: lo que está en la cotización.", "Simple: what's on the quote.")}</p></li>
          <li><b>{t("Valor con evidencia, por audiencia", "Evidenced value, by audience")}</b>{usable.length ? <ul className="plain small">{usable.map((x) => <li key={x.id}>{L(AUDIENCE[x.audience])}: {x.advantage} → {x.benefit} <span className="src">({x.evidence})</span></li>)}</ul> : <p className="small muted">{t("Nada probado todavía: mejor no afirmar ventajas.", "Nothing proven yet: better not to claim advantages.")}</p>}</li>
          {W.alternatives >= 2 && <li><b>{t("Alternativas y trade-offs", "Alternatives and trade-offs")}</b><p className="small">{W.routes.map((r) => `${L(ROUTE_KIND[r.kind])}: ${r.label}`).join(" · ") || t("Ver escenarios en la cotización.", "See scenarios on the quote.")}</p></li>}
          <li><b>{t("Preguntas genuinas", "Genuine questions")}</b><ul className="plain small">{W.questions.map((q, k) => <li key={k}>· {L(q)}</li>)}</ul></li>
          <li><b>{t("Dudas posibles", "Possible doubts")}</b><p className="small">{[c?.risks, scopeBy("TO_CONFIRM").length ? t(`Por confirmar: ${scopeBy("TO_CONFIRM").map((l) => l.component).join(", ")}`, `To confirm: ${scopeBy("TO_CONFIRM").map((l) => l.component).join(", ")}`) : null].filter(Boolean).join(" · ") || "—"}</p></li>
          <li><b>{t("Próximo acuerdo que proponemos", "Next agreement we propose")}</b><p className="small">{c?.decisionNeeded ?? "—"}</p></li>
        </ol>
        <p className="src" style={{ marginTop: 6 }}>{t("Habla de lo que le importa al cliente, escucha antes de responder, reconoce lo que ya hicieron, admite lo que no sabemos. Sin presión ni halagos.", "Talk about what matters to the customer, listen before answering, acknowledge what they already did, admit what we don't know. No pressure, no flattery.")}</p>
      </details>

      {/* 6 · Presentations */}
      <section className="jblock" id="presentacion">
        <div className="jbh"><b>{t("DESPUÉS DE PRESENTAR", "AFTER PRESENTING")}</b><span className="grow" /><span className="src">{t("Opcional: qué cambió, qué valoraron y el próximo paso", "Optional: what changed, what they valued and the next step")}</span></div>
        {(c?.presentations.length ?? 0) === 0 ? <p className="quiet-p">{t("Sin presentaciones registradas.", "No presentations recorded.")}</p> : (
          <ul className="plain">{c!.presentations.map((p) => (
            <li key={p.id} className="sol-pres">
              <b>{i.day(p.at)}</b> · {p.channel}{p.audience && ` · ${p.audience}`}{p.quote && <span className="src"> · {quoteNo(p.quote)}</span>}
              <dl className="qv-dl tight">
                {p.changed && <><dt>{t("Qué cambió", "What changed")}</dt><dd>{p.changed}</dd></>}
                {p.valued && <><dt>{t("Qué valoraron", "What they valued")}</dt><dd>{p.valued}</dd></>}
                {p.objections && <><dt>{t("Objeciones", "Objections")}</dt><dd>{p.objections}</dd></>}
                {p.whoDecides && <><dt>{t("Quién decide", "Who decides")}</dt><dd>{p.whoDecides}</dd></>}
                {p.window && <><dt>{t("Ventana", "Window")}</dt><dd>{p.window}</dd></>}
                {p.nextMove && <><dt>{t("Próximo paso", "Next step")}</dt><dd>{p.nextMove}{p.nextMoveDate && ` · ${i.day(p.nextMoveDate)}`}</dd></>}
              </dl>
              <span className="src">{p.recordedByName}</span>
            </li>
          ))}</ul>
        )}
        {editable && (
          <details className="scp-add" open={sp.err === "presentacion"}><summary className="qa-btn">{t("Registrar presentación", "Record presentation")}</summary>
            <form action={recordPresentation.bind(null, d.id)} className="qa-form">
              <div className="qa-row">
                <label>{t("Fecha", "Date")}<input name="at" type="date" required defaultValue={dayInput(W.now)} /></label>
                <label>{t("Canal", "Channel")}<input name="channel" required maxLength={80} placeholder={t("Reunión en planta, videollamada…", "Plant meeting, video call…")} /></label>
                {d.quotes.length > 0 && <label>{t("Versión", "Version")}<select name="quoteId" defaultValue={latest?.id ?? ""}><option value="">—</option>{d.quotes.map((q) => <option key={q.id} value={q.id}>{quoteNo(q)}</option>)}</select></label>}
              </div>
              <label>{t("Quiénes estuvieron", "Who attended")}<input name="audience" maxLength={200} /></label>
              <label>{t("Qué cambió", "What changed")}<input name="changed" maxLength={600} /></label>
              <label>{t("Qué valoraron", "What they valued")}<input name="valued" maxLength={600} /></label>
              <label>{t("Objeciones o dudas", "Objections or doubts")}<input name="objections" maxLength={600} /></label>
              <div className="qa-row">
                <label>{t("Quién decide", "Who decides")}<input name="whoDecides" maxLength={300} /></label>
                <label>{t("Ventana de decisión", "Decision window")}<input name="window" maxLength={200} /></label>
              </div>
              <div className="qa-row">
                <label style={{ flex: 2 }}>{t("Próximo paso acordado", "Agreed next step")}<input name="nextMove" maxLength={200} /></label>
                <label>{t("Para el", "By")}<input name="nextMoveDate" type="date" /></label>
              </div>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </details>
        )}
        <p className="src" style={{ marginTop: 8 }}>{t(`Reglas ${PROPOSAL_RULES}. Estado del catálogo: ${W.attributes.filter((a) => a.status === "ACTIVE").length} activo(s), ${W.attributes.filter((a) => a.status === "DRAFT").length} en borrador.`, `Rules ${PROPOSAL_RULES}. Catalog: ${W.attributes.filter((a) => a.status === "ACTIVE").length} active, ${W.attributes.filter((a) => a.status === "DRAFT").length} draft.`)} {L(ATTR_STATUS.DRAFT)}: {t("se pueden usar con evidencia mientras la dirección los revisa.", "usable with evidence while management reviews them.")}</p>
      </section>
    </div>
  );
}

function ClaimFields({ t, x }: { t: (es: string, en: string) => string; x?: { need: string; impact: string | null; advantage: string; benefit: string; evidence: string | null; evidenceAt: Date | null; audience: string; validUntil: Date | null } }) {
  return (
    <>
      <label>{t("Necesidad del cliente", "Customer need")}<input name="need" required maxLength={300} defaultValue={x?.need ?? ""} /></label>
      <label>{t("Impacto si no se resuelve", "Impact if not solved")}<input name="impact" maxLength={300} defaultValue={x?.impact ?? ""} /></label>
      <label>{t("Ventaja en ESTE caso (con datos)", "Advantage in THIS case (with data)")}<input name="advantage" required maxLength={400} defaultValue={x?.advantage ?? ""} placeholder={t("Ej.: 5–7 días con stock confirmado vs 3 semanas del fabricante", "E.g.: 5–7 days with confirmed stock vs 3 weeks from the manufacturer")} /></label>
      <label>{t("Beneficio para quien lo recibe", "Benefit for the recipient")}<input name="benefit" required maxLength={400} defaultValue={x?.benefit ?? ""} /></label>
      <div className="qa-row">
        <label style={{ flex: 2 }}>{t("Evidencia de este caso", "Evidence for this case")}<input name="evidence" maxLength={400} defaultValue={x?.evidence ?? ""} placeholder={t("Correo, proforma, historial… (vacío = hipótesis)", "Email, proforma, history… (empty = hypothesis)")} /></label>
        <label>{t("Fecha de la evidencia", "Evidence date")}<input name="evidenceAt" type="date" defaultValue={x?.evidenceAt ? dayInput(x.evidenceAt) : ""} /></label>
      </div>
      <div className="qa-row">
        <label>{t("Para quién", "For whom")}<select name="audience" defaultValue={x?.audience ?? "ALL"}>{Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
        <label>{t("Vigente hasta", "Valid until")}<input name="validUntil" type="date" defaultValue={x?.validUntil ? dayInput(x.validUntil) : ""} /></label>
      </div>
    </>
  );
}
