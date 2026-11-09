import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { scopeWorkspace } from "@/lib/scope";
import { clarificationMessage, COMPLETENESS, CONDITION, customerQuestions, FACT_STATE, FAMILIES, IDENTITY, inQuote, REL_KINDS, STATUS } from "@/lib/scope-rules";
import { CHANNELS } from "@/lib/comm-policy";
import { addFact, addRelationship, addScopeLine, addSuggested, importQuoteLines, recordConfirmation, removeScopeLine, updateScopeLine } from "./actions";

// Comercial C1 · Technical & Scope (§4–5): what was asked, what it needs to work, what we quote — and what's still unclear.
export default async function ScopePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; n?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  if (!(await db.deal.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const W = await scopeWorkspace(id);
  const { d, lines, q, state } = W;
  const editable = canEditOps(user, d.ownerId);
  const L = (x: { es: string; en: string } | undefined, fb = "—") => (x ? t(x.es, x.en) : fb);
  const st = COMPLETENESS[state.state];
  const msgLang = (q?.lang ?? user.lang) as "ES" | "EN";
  const questions = customerQuestions(state.gaps, lines, msgLang);
  const msg = questions.length ? clarificationMessage({ lang: msgLang, contactFirstName: d.contact?.firstName ?? null, desiredResult: d.desiredResult, questions: questions.map((x) => x.text) }) : null;
  const openTerms = [...new Set(state.gaps.filter((g) => g.term).map((g) => g.term!))];
  const termLabel = (term: string) => { const a = W.ambiguities.find((x) => x.term === term); if (a) return `«${a.fragment}»`; if (term.startsWith("family:")) { const l = lines.find((x) => `family:${x.id}` === term); return l ? t(`${l.component}: pregunta de conjunto`, `${l.component}: assembly question`) : term; } if (term.startsWith("assembly:")) return t(`Conjunto «${term.slice(9)}»`, `Assembly “${term.slice(9)}”`); return term; };
  const toCover = lines.filter((l) => !l.confirmationId && (l.status === "EXCLUDED" || l.status === "CUSTOMER_SUPPLIED"));

  const okMsg: Record<string, string> = {
    linea: t("Alcance actualizado. SOLU recalculó qué falta aclarar.", "Scope updated. SOLU recalculated what's left to clarify."),
    quitada: t("Componente quitado del alcance.", "Component removed from scope."),
    importadas: t(`${sp.n ?? 0} línea(s) de la cotización agregadas como «pidió + incluido». Revisa qué más necesita para operar.`, `${sp.n ?? 0} quote line(s) added as “asked + included”. Check what else it needs to operate.`),
    dato: t("Dato técnico guardado. Si había uno anterior para el mismo campo, queda en el historial.", "Technical fact saved. If there was an earlier one for the same field, it stays in history."),
    confirmado: t("Respuesta del cliente registrada. Quedó en el Journey.", "Customer's answer recorded. It's on the Journey."),
    relacion: t("Relación guardada con su evidencia.", "Relationship saved with its evidence."),
  };
  const errMsg: Record<string, string> = {
    permiso: t("Solo quien lleva el Journey, un Negociador Operativo o la dirección pueden cambiar el alcance.", "Only the Journey owner, an Operations Negotiator or management can change the scope."),
    componente: t("Escribe el nombre del componente.", "Write the component's name."),
    "sin-cotizacion": t("Este Journey aún no tiene cotización.", "This Journey has no quote yet."),
    dato: t("Campo, valor y fuente son obligatorios.", "Field, value and source are required."),
    confirmacion: t("Escribe qué dijo el cliente y quién lo dijo.", "Write what the customer said and who said it."),
    fecha: t("La fecha no puede ser futura.", "The date can't be in the future."),
    nada: t("Marca qué aclara esta respuesta (una palabra o un componente).", "Tick what this answer clarifies (a word or a component)."),
    relacion: t("Completa los dos productos y el tipo de relación.", "Fill in both products and the relationship type."),
    evidencia: t("Una relación sin evidencia no se guarda: di de dónde sale (manual, placa, proveedor, foto).", "A relationship without evidence isn't saved: say where it comes from (manual, nameplate, supplier, photo)."),
  };

  const LineForm = ({ l }: { l?: (typeof lines)[number] }) => (
    <>
      <div className="qa-row">
        <label style={{ flex: 2 }}>{t("Componente", "Component")}<input name="component" required maxLength={160} defaultValue={l?.component ?? ""} placeholder={t("Ej.: Motorreductor, Reductor, Acople", "E.g.: Gearmotor, Gearbox, Coupling")} /></label>
        <label>{t("Cant.", "Qty")}<input name="qty" type="number" min={1} defaultValue={l?.qty ?? 1} /></label>
      </div>
      <div className="qa-row">
        <label>{t("P/N", "P/N")}<input name="code" maxLength={60} defaultValue={l?.code ?? ""} /></label>
        <label>{t("Fabricante", "Manufacturer")}<input name="manufacturer" maxLength={80} defaultValue={l?.manufacturer ?? ""} /></label>
        <label>{t("Familia", "Family")}<select name="family" defaultValue={l ? (l.family ?? "-") : ""}><option value="">{t("Detectar sola", "Detect")}</option><option value="-">{t("Ninguna", "None")}</option>{Object.entries(FAMILIES).map(([k, f]) => <option key={k} value={k}>{L(f)}</option>)}</select></label>
      </div>
      <div className="qa-row">
        <label className="chk"><input type="checkbox" name="requested" value="1" defaultChecked={l?.requested ?? false} /> {t("El cliente lo pidió", "Customer asked for it")}</label>
        <label className="chk"><input type="checkbox" name="requiredForFunction" value="1" defaultChecked={l?.requiredForFunction ?? true} /> {t("Necesario para que opere", "Needed for it to operate")}</label>
      </div>
      <div className="qa-row">
        <label>{t("Estado", "Status")}<select name="status" defaultValue={l?.status ?? "TO_CONFIRM"}>{Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{L(s)}</option>)}</select></label>
        <label>{t("Identidad", "Identity")}<select name="identity" defaultValue={l?.identity ?? "UNKNOWN"}>{Object.entries(IDENTITY).map(([k, s]) => <option key={k} value={k}>{L(s)}</option>)}</select></label>
        <label>{t("Condición", "Condition")}<select name="condition" defaultValue={l?.condition ?? ""}><option value="">—</option>{Object.entries(CONDITION).map(([k, s]) => <option key={k} value={k}>{L(s)}</option>)}</select></label>
      </div>
      <label className="chk"><input type="checkbox" name="alternativesAllowed" value="1" defaultChecked={l?.alternativesAllowed ?? false} /> {t("El cliente acepta alternativas equivalentes", "Customer accepts equivalent alternatives")}</label>
      <label>{t("De dónde sale", "Where it comes from")}<input name="source" maxLength={200} defaultValue={l?.source ?? ""} placeholder={t("Foto del WhatsApp del 3 nov, placa, llamada…", "Nov 3 WhatsApp photo, nameplate, call…")} /></label>
      <label>{t("Nota", "Note")}<input name="note" maxLength={500} defaultValue={l?.note ?? ""} /></label>
    </>
  );

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=need`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{t("Técnico y alcance", "Technical & scope")}</span>
          <span className="grow" />
          {q && <Link className="qa-btn" href={`/cotizaciones/${q.id}`}>{t("Ver cotización", "View quote")}</Link>}
        </div>
        <div className="jh-title">
          <h1>{t("¿Lo que cotizamos hace que funcione?", "Does what we quote make it work?")}</h1>
          <span className={`sig ${st.tone}`}>{L(st)}</span>
        </div>
        <p className="jh-sub">{d.title}{d.desiredResult ? ` · ${t("Resultado", "Result")}: ${d.desiredResult}` : ""}</p>
      </header>

      {/* What's left to clarify */}
      <section className="jblock">
        <div className="jbh"><b>{t("QUÉ FALTA ACLARAR", "WHAT'S LEFT TO CLARIFY")}</b><span className="grow" />{state.blocks && <span className="src">{t("Impide presentar la cotización hasta aclararlo", "Blocks presenting the quote until clarified")}</span>}</div>
        {state.gaps.length === 0 ? (
          <p className="quiet-p">{state.state === "NOT_STARTED" ? t("Nada que aclarar: no hay palabras ambiguas ni componentes cargados. Si es un repuesto simple, no hace falta más.", "Nothing to clarify: no ambiguous words or components. If it's a simple spare part, nothing else is needed.") : t("Todo el alcance está claro y confirmado.", "The whole scope is clear and confirmed.")}</p>
        ) : (
          <ul className="qv-checks">{state.gaps.map((g, n) => <li key={n} className={g.severity === "WARN" ? "no info" : "no"}><span className="ic" aria-hidden>{g.severity === "WARN" ? "i" : "!"}</span><span>{L(g)}{g.severity === "INCOMPLETE" && <span className="src block">{t("Incompleto: así no funcionaría.", "Incomplete: it wouldn't work as is.")}</span>}</span></li>)}</ul>
        )}
        {W.ambiguities.length > 0 && (
          <div className="scp-amb">
            <p className="src">{t("Palabras que pueden significar más de una cosa (en las palabras del propio Journey):", "Words that can mean more than one thing (in the Journey's own words):")}</p>
            <ul>{W.ambiguities.map((a) => <li key={a.term} className={W.resolvedTerms.includes(a.term) ? "done" : ""}><b>«{a.fragment}»</b> <span className="src">· {a.where}</span>{W.resolvedTerms.includes(a.term) ? <span className="sig ok">{t("Aclarado con el cliente", "Clarified with customer")}</span> : <span className="block small">{L(a.question)}</span>}</li>)}</ul>
          </div>
        )}
      </section>

      {/* Assembly Scope Matrix */}
      <section className="jblock" id="matriz">
        <div className="jbh"><b>{t("MATRIZ DE ALCANCE", "ASSEMBLY SCOPE MATRIX")}</b><span className="grow" />
          {editable && q && q.lines.length > 0 && <form action={importQuoteLines.bind(null, d.id)}><button type="submit" className="qa-btn">{t("Traer líneas de la cotización", "Bring quote lines")}</button></form>}
        </div>
        <p className="src">{t("«Pidió» es lo que el cliente dijo literalmente. «Necesario para operar» es lo que hace falta para que funcione. Pueden ser distintos: ahí está el riesgo.", "“Asked” is what the customer literally said. “Needed to operate” is what it takes to work. They can differ — that's the risk.")}</p>
        {lines.length === 0 ? <p className="quiet-p">{t("Sin componentes todavía.", "No components yet.")}</p> : (
          <div className="tscroll"><table className="scp-mx">
            <thead><tr><th>{t("Componente", "Component")}</th><th className="n">{t("Cant.", "Qty")}</th><th>{t("Pidió", "Asked")}</th><th>{t("Para operar", "To operate")}</th><th>{t("En cotización", "On quote")}</th><th>{t("Estado", "Status")}</th><th>{t("Identidad", "Identity")}</th><th>{t("Cliente confirmó", "Customer confirmed")}</th></tr></thead>
            <tbody>{lines.map((l) => {
              const quoted = W.quoteLines ? inQuote(l, W.quoteLines) : null;
              const bad = state.gaps.some((g) => g.lineId === l.id && g.severity !== "WARN");
              return (
                <tr key={l.id} id={`l-${l.id}`} className={bad ? "gap" : ""}>
                  <td><b>{l.component}</b>{(l.code || l.manufacturer) && <span className="src block mono">{[l.manufacturer, l.code].filter(Boolean).join(" · ")}</span>}{l.family && <span className="src block">{L(FAMILIES[l.family])}</span>}</td>
                  <td className="n">{l.qty}</td>
                  <td>{l.requested ? "✓" : "—"}</td>
                  <td>{l.requiredForFunction ? "✓" : "—"}</td>
                  <td>{quoted == null ? <span className="src">{t("sin cotización", "no quote")}</span> : quoted ? "✓" : <span className={l.status === "INCLUDED" ? "risk-t" : "src"}>{t("no", "no")}</span>}</td>
                  <td><span className={`sig ${l.status === "INCLUDED" ? "ok" : l.status === "TO_CONFIRM" ? "attn" : l.status === "EXCLUDED" ? "wait" : "info"}`}>{L(STATUS[l.status])}</span></td>
                  <td className="small">{L(IDENTITY[l.identity])}</td>
                  <td className="small">{l.confirmation ? `${l.confirmation.confirmedBy} · ${i.day(l.confirmation.confirmedAt)}` : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        {editable && (
          <details className="scp-add"><summary className="qa-btn">{t("+ Componente", "+ Component")}</summary>
            <form action={addScopeLine.bind(null, d.id)} className="qa-form"><LineForm /><button type="submit">{t("Agregar al alcance", "Add to scope")}</button></form>
          </details>
        )}
        {W.suggestions.length > 0 && (
          <div className="scp-sug">
            <p className="src">{t("Según relaciones con evidencia, podría hacer falta (nunca se agrega solo):", "According to evidenced relationships, it might also need (never added on its own):")}</p>
            <ul>{W.suggestions.map((s) => (
              <li key={s.rel.id}><b>{s.other.label}</b> <span className="src">· {s.rel.fromLabel} {L(REL_KINDS[s.rel.kind])} {s.rel.toLabel} · {s.rel.evidence}</span>
                {editable && <form action={addSuggested.bind(null, d.id)} className="inline"><input type="hidden" name="label" value={s.other.label} /><input type="hidden" name="why" value={`${s.rel.fromLabel} ${REL_KINDS[s.rel.kind].es} ${s.rel.toLabel} (${s.rel.evidence})`} /><button type="submit" className="linkb">{t("Agregar como «por confirmar»", "Add as “to confirm”")}</button></form>}
              </li>
            ))}</ul>
          </div>
        )}
      </section>

      {/* Technical facts per component */}
      {lines.length > 0 && (
        <section className="jblock" id="tecnico">
          <div className="jbh"><b>{t("DATOS TÉCNICOS", "TECHNICAL FACTS")}</b><span className="grow" /><span className="src">{t("Solo lo que importa para cada familia. Se guarda si es confirmado, reportado o hipótesis.", "Only what matters for each family. Saved as confirmed, reported or hypothesis.")}</span></div>
          {lines.map((l) => {
            const fam = l.family ? FAMILIES[l.family] : null;
            const active = l.facts.filter((x) => !x.supersededAt);
            const old = l.facts.filter((x) => x.supersededAt);
            const missing = fam ? fam.fields.filter((f) => !active.some((a) => a.key === f.key)) : [];
            return (
              <div key={l.id} className="scp-tech">
                <div className="scp-tech-h"><b>{l.component}</b>{fam && <span className="src"> · {L(fam)}</span>}<span className="grow" />
                  {editable && <details className="qa"><summary className="qa-btn">{t("Editar", "Edit")}</summary><div className="qa-pop wide right">
                    <form action={updateScopeLine.bind(null, l.id)} className="qa-form"><LineForm l={l} /><button type="submit">{t("Guardar", "Save")}</button></form>
                    <form action={removeScopeLine.bind(null, l.id)} style={{ marginTop: 8 }}><button type="submit" className="linkb" data-confirm={t("¿Quitar este componente del alcance?", "Remove this component from scope?")}>{t("Quitar del alcance", "Remove from scope")}</button></form>
                  </div></details>}
                </div>
                {active.length > 0 && <dl className="qv-dl tight2">{active.map((x) => <Fragment key={x.id}><dt>{fam?.fields.find((f) => f.key === x.key) ? L(fam.fields.find((f) => f.key === x.key)) : x.key}</dt><dd><b>{x.value}</b> <span className={`sig ${x.state === "CONFIRMED" ? "ok" : x.state === "HYPOTHESIS" ? "attn" : "info"}`}>{L(FACT_STATE[x.state])}</span><span className="src block">{x.source}{x.evidence ? ` · ${x.evidence}` : ""} · {x.recordedByName} · {i.day(x.createdAt)}</span></dd></Fragment>)}</dl>}
                {missing.length > 0 && <p className="src">{t("Falta saber", "Still to find out")}: {missing.map((f) => `${L(f)} (${L(f.why)})`).join(" · ")}</p>}
                {old.length > 0 && <details className="src"><summary>{t(`${old.length} valor(es) anterior(es)`, `${old.length} earlier value(s)`)}</summary><ul>{old.map((x) => <li key={x.id}>{x.key}: {x.value} · {L(FACT_STATE[x.state])} · {x.source} · {i.day(x.createdAt)}</li>)}</ul></details>}
                {editable && (
                  <details className="qa"><summary className="qa-btn">{t("+ Dato", "+ Fact")}</summary><div className="qa-pop wide">
                    <form action={addFact.bind(null, l.id)} className="qa-form">
                      <label>{t("Campo", "Field")}<input name="key" required maxLength={40} list={`f-${l.id}`} defaultValue={missing[0]?.key ?? ""} />
                        <datalist id={`f-${l.id}`}>{(fam?.fields ?? []).map((f) => <option key={f.key} value={f.key}>{L(f)}</option>)}<option value="pn">{t("P/N exacto", "Exact P/N")}</option><option value="serial">{t("Equipo / serie", "Equipment / serial")}</option><option value="application">{t("Aplicación", "Application")}</option></datalist></label>
                      <label>{t("Valor", "Value")}<input name="value" required maxLength={200} /></label>
                      <label>{t("¿Qué tan seguro?", "How sure?")}<select name="state" defaultValue="REPORTED">{Object.entries(FACT_STATE).map(([k, s]) => <option key={k} value={k}>{L(s)}</option>)}</select></label>
                      <label>{t("Fuente", "Source")}<input name="source" required maxLength={120} placeholder={t("Placa (foto WhatsApp 3 nov), Jorge por teléfono…", "Nameplate (Nov 3 WhatsApp photo), Jorge by phone…")} /></label>
                      <label>{t("Evidencia (opcional)", "Evidence (optional)")}<input name="evidence" maxLength={400} /></label>
                      <button type="submit">{t("Guardar dato", "Save fact")}</button>
                    </form>
                  </div></details>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* Clarification message + customer's answer */}
      <section className="jblock" id="confirmar">
        <div className="jbh"><b>{t("ACLARAR CON EL CLIENTE", "CLARIFY WITH THE CUSTOMER")}</b></div>
        {msg ? (
          <>
            <p className="src">{t("Mensaje sugerido. Pregunta por lo que falta, desde el resultado del cliente, sin buscar culpables. Cópialo y ajústalo a tu estilo.", "Suggested message. It asks about what's missing, from the customer's result, without blame. Copy it and adjust it to your style.")}</p>
            <textarea className="scp-msg" readOnly rows={Math.min(14, msg.text.split("\n").length + 2)} defaultValue={msg.text} />
            {msg.issues.length > 0 && <ul className="small">{msg.issues.map((x) => <li key={x.code} className={x.severity === "BLOCK" ? "risk-t" : ""}>{L(x)}</li>)}</ul>}
          </>
        ) : <p className="quiet-p">{t("No hay preguntas abiertas para el cliente.", "No open questions for the customer.")}</p>}
        {editable && (openTerms.length > 0 || toCover.length > 0) && (
          <details className="scp-add" open={sp.err === "confirmacion" || sp.err === "nada"}><summary className="qa-btn">{t("Registrar la respuesta del cliente", "Record the customer's answer")}</summary>
            <form action={recordConfirmation.bind(null, d.id)} className="qa-form">
              <label>{t("Qué dijo, con sus palabras", "What they said, in their words")}<textarea name="text" rows={3} required maxLength={1200} /></label>
              <div className="qa-row">
                <label>{t("Quién", "Who")}<input name="confirmedBy" required maxLength={120} defaultValue={d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : ""} /></label>
                <label>{t("Por dónde", "Channel")}<select name="channel" defaultValue="EMAIL">{Object.entries(CHANNELS).filter(([k]) => k !== "INTRO").map(([k, c]) => <option key={k} value={k}>{L(c)}</option>)}</select></label>
                <label>{t("Cuándo", "When")}<input name="confirmedAt" type="date" defaultValue={dayInput(today())} /></label>
              </div>
              <fieldset className="scp-fs"><legend className="small">{t("¿Qué aclara esta respuesta?", "What does this answer clarify?")}</legend>
                {openTerms.map((term) => <label key={term} className="chk"><input type="checkbox" name="terms" value={term} /> {termLabel(term)}</label>)}
                {toCover.map((l) => <label key={l.id} className="chk"><input type="checkbox" name="lineIds" value={l.id} /> {l.component} · {L(STATUS[l.status])}</label>)}
              </fieldset>
              <span className="src">{t("Si la respuesta cambia el alcance (por ejemplo, «el reductor lo ponemos nosotros»), primero edita el componente y luego registra aquí su confirmación.", "If the answer changes the scope (e.g. “we supply the gearbox”), first edit the component, then record its confirmation here.")}</span>
              <button type="submit">{t("Registrar respuesta", "Record answer")}</button>
            </form>
          </details>
        )}
        {W.confs.length > 0 && <ul className="exc-hist">{W.confs.map((c) => <li key={c.id}><span className="src">{i.day(c.confirmedAt)} · {c.confirmedBy} · {L(CHANNELS[c.channel], c.channel)} · {t("registró", "recorded by")} {c.recordedByName}</span><span className="block">«{c.text}»</span></li>)}</ul>}
      </section>

      {/* Product relationships */}
      <section className="jblock" id="relaciones">
        <div className="jbh"><b>{t("RELACIONES ENTRE PRODUCTOS", "PRODUCT RELATIONSHIPS")}</b><span className="grow" /><span className="src">{t("Con evidencia y versionadas. Nunca equivalencias automáticas.", "Evidenced and versioned. Never automatic equivalences.")}</span></div>
        {W.rels.length === 0 ? <p className="quiet-p">{t("Ninguna conocida para estos componentes.", "None known for these components.")}</p> : (
          <ul className="mk-ul small">{W.rels.map((r) => <li key={r.id}><b>{r.fromLabel}</b> {L(REL_KINDS[r.kind])} <b>{r.toLabel}</b> <span className="src">· {r.evidence} · {r.recordedByName} · {i.day(r.createdAt)}</span></li>)}</ul>
        )}
        {editable && (
          <details className="scp-add"><summary className="qa-btn">{t("+ Relación", "+ Relationship")}</summary>
            <form action={addRelationship.bind(null, d.id)} className="qa-form">
              <div className="qa-row">
                <label>{t("Producto", "Product")}<input name="fromLabel" required maxLength={120} placeholder={t("P/N o nombre", "P/N or name")} /></label>
                <label>{t("Relación", "Relationship")}<select name="kind" required>{Object.entries(REL_KINDS).map(([k, r]) => <option key={k} value={k}>{L(r)}</option>)}</select></label>
                <label>{t("Otro producto", "Other product")}<input name="toLabel" required maxLength={120} /></label>
              </div>
              <label>{t("Evidencia", "Evidence")}<input name="evidence" required maxLength={400} placeholder={t("Manual SEW p. 12, placa, confirmación del proveedor…", "SEW manual p. 12, nameplate, supplier confirmation…")} /></label>
              <button type="submit">{t("Guardar relación", "Save relationship")}</button>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
