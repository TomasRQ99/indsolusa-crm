import Link from "next/link";
import NeedSuggestions from "../../NeedSuggestions";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { CHANNELS, PURPOSES, type Purpose } from "@/lib/comm-policy";
import { connectionBrief, NOTE_KINDS, personRelationship } from "@/lib/relationship";
import { INSIGHT_BLOCKS, SIGNAL_KINDS } from "@/lib/market-rules";
import { Prov, ProvFields } from "../../ui";
import { addLoop, addPersonNote, closeLoop, recordSent, retireNote } from "../actions";

// Mercado M5 · Person / Relationship view (§13.5) + Prepare Connection (§11.6, §13.12).
// "What do we need to remember to relate better?" Business facts only, never personal labels (§11.5).

type SP = { p?: string; lang?: string; own?: string; ok?: string; err?: string; codes?: string };

const OK: Record<string, [string, string]> = {
  nota: ["Anotado. La próxima conversación empieza desde aquí, no desde cero.", "Noted. The next conversation starts from here, not from scratch."],
  retirada: ["Marcado como ya no vigente; queda en el historial.", "Marked as no longer current; it stays in history."],
  compromiso: ["Compromiso anotado. SOLU lo tendrá presente al preparar la próxima conexión.", "Commitment noted. SOLU will keep it in mind when preparing the next connection."],
  cerrado: ["Compromiso cerrado. Gracias por mantenerlo al día.", "Commitment closed. Thanks for keeping it up to date."],
  enviado: ["Registrado. El mensaje queda en el historial con lo que se usó para prepararlo.", "Recorded. The message stays in history with what was used to prepare it."],
};
const ERR: Record<string, [string, string]> = {
  nota: ["Elige qué tipo de dato es y escríbelo.", "Pick what kind of note it is and write it."],
  evidencia: ["Para «lo que valora» necesitamos la evidencia: qué dijo o hizo. Así no suponemos.", "For “what they value” we need the evidence: what they said or did. That way we don't assume."],
  etiqueta: ["Aquí guardamos hechos de negocio que la persona dijo o mostró, no etiquetas personales. Escribe qué dijo o hizo.", "We keep business facts the person said or showed here, not personal labels. Write what they said or did."],
  compromiso: ["Escribe el compromiso en una frase.", "Write the commitment in one sentence."],
  texto: ["Falta el texto que enviaste.", "The text you sent is missing."],
  canal: ["Elige por dónde lo enviaste.", "Pick how you sent it."],
  revision: ["Marca que lo revisaste: SOLU no envía nada sin una persona.", "Tick that you reviewed it: SOLU doesn't send anything without a person."],
  razon: ["Ya no hay una razón para este tipo de mensaje; revisa la preparación.", "There's no longer a reason for this kind of message; check the preparation."],
  bloqueo: ["El texto tiene algo que conviene cambiar antes de enviarlo (ver abajo).", "The text has something worth changing before sending (see below)."],
};

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const r = await personRelationship(id);
  if (!r) notFound();
  const i = makeI18n(user.lang);
  const { t } = i;
  const c = r.c;
  const lang = sp.lang === "EN" ? "EN" : "ES";
  const own = sp.own === "1";
  const b = connectionBrief(r, { purpose: sp.p, lang, senderName: user.name, ownFault: own });
  const purpose = b.chosen?.purpose as Purpose | undefined;
  const link = (q: Partial<SP>) => { const u = new URLSearchParams(); const m = { p: purpose, lang, own: own ? "1" : undefined, ...q }; for (const [k, v] of Object.entries(m)) if (v) u.set(k, String(v)); return `?${u}#preparar`; };
  const blocked = sp.err === "bloqueo" ? (sp.codes ?? "").split(",") : [];
  const name = `${c.firstName} ${c.lastName}`.trim();
  const valueNotes = r.notes.filter((n) => n.kind === "VALUES" || n.kind === "OBJECTIVE" || n.kind === "PROBLEM");
  const desired = [...new Set(c.deals.map((d) => d.desiredResult).filter((x): x is string => !!x))].slice(0, 3);
  const openGaps = r.gaps.filter((g) => g.status === "OPEN");
  const companyDecide = r.insights.filter((x) => x.block === "DECIDE").slice(0, 3);
  const bySide = (s: string) => r.loops.filter((l) => l.side === s);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/mercado">{t("Mercado", "Market")}</Link>{c.account && <> · <Link href={`/mercado/empresas/${c.account.id}`}>{c.account.name}</Link></>}</div>
          <h1>{name}</h1>
          <p>{t("¿Qué necesitamos recordar para relacionarnos mejor?", "What do we need to remember to relate better?")}</p>
          <p className="small">{r.role ?? t("Cargo no registrado", "No job title on file")}{c.employments[0]?.area ? ` · ${c.employments[0].area}` : ""}{c.employments[0]?.plant ? ` · ${c.employments[0].plant.name}` : ""}{c.email ? ` · ${c.email}` : ""}{c.phone ? ` · ${c.phone}` : ""}</p>
          <span className="src block">{r.lastTouch ? t(`Última interacción: ${i.day(r.lastTouch)}`, `Last interaction: ${i.day(r.lastTouch)}`) : t("Aún no hemos interactuado con esta persona en SOLU.", "We haven't interacted with this person in SOLU yet.")}</span>
        </div>
        <Link href="#preparar" className="btn">{t("Preparar conexión", "Prepare connection")}</Link>
      </div>
      {sp.ok && OK[sp.ok] && <div className="note okn">{t(...OK[sp.ok])}</div>}
      {sp.err && ERR[sp.err] && <div className="note attn">{t(...ERR[sp.err])}</div>}
      <NeedSuggestions scope={{ contactId: c.id }} back={`/mercado/personas/${c.id}`} t={t} day={i.day} user={user} sp={sp} />

      <div className="grid cols-2">
        <section className="card" id="recordar">
          <b>{t("Qué recordar", "What to remember")}</b>
          <p className="small"><b>{t("Su papel real en las decisiones", "Their real role in decisions")}:</b> {r.decisionRole.length ? r.decisionRole.map((n) => n.statement).join(" · ") : <span className="muted">{t("Aún no lo sabemos. El cargo formal no siempre es el rol real.", "We don't know yet. The formal title isn't always the real role.")}</span>}</p>
          {r.notes.filter((n) => n.kind !== "DECISION_ROLE").length === 0 ? <p className="small muted">{t("Nada anotado todavía sobre lo que valora, sus objetivos o problemas.", "Nothing noted yet about what they value, their goals or problems.")}</p> : (
            <ul className="mk-ul">{r.notes.filter((n) => n.kind !== "DECISION_ROLE").map((n) => (
              <li key={n.id} className="small">
                <span className="mk-chip">{t(NOTE_KINDS[n.kind]?.es ?? n.kind, NOTE_KINDS[n.kind]?.en ?? n.kind)}</span> {n.statement}
                {n.evidence && <span className="src block">{t("Evidencia", "Evidence")}: {n.evidence}</span>}
                <Prov t={t} day={i.day} x={n} />
                <form action={retireNote.bind(null, n.id)}><button type="submit" className="link small">{t("Ya no es así", "No longer true")}</button></form>
              </li>
            ))}</ul>
          )}
          {companyDecide.length > 0 && <p className="small"><span className="src">{t("De la empresa", "About the company")} · {t(INSIGHT_BLOCKS.DECIDE.es, INSIGHT_BLOCKS.DECIDE.en)}:</span> {companyDecide.map((x) => x.statement).join(" · ")}</p>}
          <details>
            <summary className="small">{t("Anotar algo que dijo o mostró", "Note something they said or showed")}</summary>
            <form action={addPersonNote.bind(null, c.id)} className="stack">
              <label>{t("Qué es", "What it is")}<select name="kind" defaultValue="VALUES">{Object.entries(NOTE_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>{t("Qué dijo o mostró (hechos de negocio)", "What they said or showed (business facts)")}<textarea name="statement" rows={2} maxLength={400} placeholder={NOTE_KINDS.VALUES.hint} /></label>
              <label>{t("Evidencia (obligatoria para «lo que valora»)", "Evidence (required for “what they value”)")}<input name="evidence" maxLength={400} placeholder={t("Ej.: lo dijo en la visita del 3 de noviembre", "E.g.: said it during the Nov 3 visit")} /></label>
              <ProvFields t={t} />
              <span className="src">{t("No guardamos etiquetas personales, perfiles ni datos sensibles: solo lo que sirve para una relación de negocio.", "We don't store personal labels, profiles or sensitive data: only what serves a business relationship.")}</span>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </details>
        </section>

        <section className="card" id="compromisos">
          <b>{t("Compromisos abiertos", "Open commitments")}</b>
          {r.loops.length === 0 ? <p className="small muted">{t("No hay compromisos abiertos con esta persona.", "No open commitments with this person.")}</p> : (["OURS", "THEIRS"] as const).map((side) => bySide(side).length > 0 && (
            <div key={side}>
              <span className="src block">{side === "OURS" ? t("Nuestros (lo que prometimos)", "Ours (what we promised)") : t("De ellos (lo que esperamos)", "Theirs (what we're waiting for)")}</span>
              <ul className="mk-ul">{bySide(side).map((l) => (
                <li key={l.key} className="small">
                  {l.href ? <Link href={l.href}>{l.what}</Link> : l.what}
                  <span className="src"> · {l.origin}{l.dueAt ? ` · ${i.day(l.dueAt)}` : ""}{l.dueAt && l.dueAt < r.now ? ` · ${t("sigue abierto: hoy puede ser un buen momento para cerrarlo", "still open: today may be a good moment to close it")}` : ""}</span>
                  {l.explicitId && (
                    <form action={closeLoop.bind(null, l.explicitId)} className="row" style={{ gap: 6 }}>
                      <input name="note" maxLength={300} placeholder={t("Cómo se cerró (opcional)", "How it was closed (optional)")} style={{ flex: 1 }} />
                      <button type="submit" name="status" value="DONE" className="secondary small">{t("Cumplido", "Done")}</button>
                      <button type="submit" name="status" value="DROPPED" className="link small">{t("Ya no aplica", "No longer applies")}</button>
                    </form>
                  )}
                </li>
              ))}</ul>
            </div>
          ))}
          <details>
            <summary className="small">{t("Anotar un compromiso", "Note a commitment")}</summary>
            <form action={addLoop.bind(null, c.id)} className="stack">
              <label>{t("De quién", "Whose")}<select name="side" defaultValue="OURS"><option value="OURS">{t("Nuestro: lo prometimos nosotros", "Ours: we promised it")}</option><option value="THEIRS">{t("De ellos: lo esperamos de su lado", "Theirs: we're waiting on them")}</option></select></label>
              <label>{t("Qué", "What")}<input name="what" maxLength={300} placeholder={t("Ej.: enviar la ficha técnica del transmisor", "E.g.: send the transmitter datasheet")} /></label>
              <label>{t("Para cuándo", "By when")}<input name="dueAt" type="date" /></label>
              <input type="hidden" name="sourceType" value="CONVERSATION" />
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </details>
        </section>
      </div>

      <section className="mk-sec" id="preparar">
        <h2>{t("Preparar conexión", "Prepare connection")}</h2>
        {!b.chosen ? (
          <div className="card">
            <p><b>{t("Hoy no vemos una razón legítima para contactar a esta persona.", "Today we don't see a legitimate reason to contact this person.")}</b></p>
            <p className="small">{t("SOLU no sugiere contactos solo por calendario. Cuando haya un compromiso, un cambio en la empresa o algo que aprender, aparecerá aquí con un borrador.", "SOLU doesn't suggest contact just because of the calendar. When there's a commitment, a change at the company or something to learn, it will show up here with a draft.")}</p>
          </div>
        ) : (
          <div className="stack">
            {b.purposes.length > 1 && (
              <div className="row small">{t("Razón para conectar:", "Reason to connect:")} {b.purposes.map((p) => <Link key={p} href={link({ p, own: undefined })} className={`mk-chip${p === purpose ? " on" : ""}`}>{t(PURPOSES[p].es, PURPOSES[p].en)}</Link>)}</div>
            )}
            <div className="grid cols-2">
              <div className="card">
                <b>{t("Por qué ahora", "Why now")}</b>
                <p className="small">{t(b.chosen.fact.text.es, b.chosen.fact.text.en)}{b.chosen.fact.kind === "INFERENCE" && <span className="sig attn"> {t("inferido", "inferred")}</span>}</p>
                <b>{t("Con quién", "With whom")}</b>
                <p className="small">{name}{r.role ? ` · ${r.role}` : ""} · {r.decisionRole.length ? r.decisionRole[0].statement : t("rol real en la decisión aún desconocido", "real role in the decision still unknown")}</p>
                <b>{t("Qué podría importarle (según evidencia)", "What might matter to them (based on evidence)")}</b>
                {valueNotes.length || desired.length ? <ul className="mk-ul">{valueNotes.map((n) => <li key={n.id} className="small">{n.statement}{n.evidence ? <span className="src"> · {n.evidence}</span> : null}</li>)}{desired.map((d) => <li key={d} className="small">{d}<span className="src"> · {t("resultado que buscaba en una Necesidad", "result they sought in a Necessity")}</span></li>)}</ul> : <p className="small muted">{t("Sin evidencia todavía: mejor preguntar que suponer.", "No evidence yet: better to ask than assume.")}</p>}
                <b>{t("Qué cambió", "What changed")}</b>
                {r.signals.length ? <ul className="mk-ul">{r.signals.slice(0, 3).map((s) => <li key={s.id} className="small"><span className="mk-chip">{t(SIGNAL_KINDS[s.kind]?.es ?? s.kind, SIGNAL_KINDS[s.kind]?.en ?? s.kind)}</span> {s.what}<span className="src"> · {i.day(s.observedAt)}</span></li>)}</ul> : <p className="small muted">{t("Nada nuevo en los últimos 90 días.", "Nothing new in the last 90 days.")}</p>}
              </div>
              <div className="card">
                <b>{t("Qué no sabemos", "What we don't know")}</b>
                <ul className="mk-ul">
                  {!r.decisionRole.length && <li className="small">{t("Cómo participa realmente en las decisiones.", "How they really take part in decisions.")}</li>}
                  {openGaps.slice(0, 3).map((g) => <li key={g.id} className="small">{g.question}</li>)}
                </ul>
                <b>{t(`Preguntas útiles (${r.questions.length})`, `Useful questions (${r.questions.length})`)}</b>
                {r.questions.length ? <ul className="mk-ul">{r.questions.map((q) => <li key={q.key} className="small">«{t(q.es, q.en)}»</li>)}</ul> : <p className="small muted">{t("Ya conocemos lo esencial; no hace falta preguntar por preguntar.", "We already know the essentials; no need to ask for the sake of asking.")}</p>}
                <b>{t("Relación", "Relationship")}</b>
                <p className="small">{t(`${c.deals.length} Necesidad(es) con esta persona · ${c.activities.length} interacción(es) recientes`, `${c.deals.length} Necessity(ies) with this person · ${c.activities.length} recent interaction(s)`)} · {t(`${r.loops.length} compromiso(s) abierto(s)`, `${r.loops.length} open commitment(s)`)}</p>
                <b>{t("Canal sugerido", "Suggested channel")}</b>
                <p className="small">{t(CHANNELS[b.channel].es, CHANNELS[b.channel].en)}{b.channel === "INTRO" ? t(": no tenemos correo ni teléfono de esta persona.", ": we have no email or phone for this person.") : ""}</p>
                <b>{t("Si no responde", "If there's no answer")}</b>
                <p className="small">{b.noReply && t(b.noReply.es, b.noReply.en)}</p>
              </div>
            </div>

            <div className="card">
              <div className="row">
                <b style={{ flex: 1 }}>{t("Borrador", "Draft")} · {t(PURPOSES[purpose!].es, PURPOSES[purpose!].en)}</b>
                <Link href={link({ lang: lang === "ES" ? "EN" : "ES" })} className="small">{lang === "ES" ? t("Ver en inglés", "See in English") : t("Ver en español", "See in Spanish")}</Link>
                {purpose === "RECOVERY" && <Link href={link({ own: own ? undefined : "1" })} className="small">{own ? t("Quitar «fue un error nuestro»", "Remove “it was our mistake”") : t("Fue un error nuestro (confirmado)", "It was our mistake (confirmed)")}</Link>}
              </div>
              <form action={recordSent.bind(null, c.id)} className="stack">
                <input type="hidden" name="purpose" value={purpose} />
                <input type="hidden" name="lang" value={lang} />
                {own && <input type="hidden" name="own" value="1" />}
                <textarea name="finalText" rows={10} defaultValue={b.draft!.text} maxLength={4000} />
                {b.checks.length > 0 && <ul className="mk-ul">{b.checks.map((x) => <li key={x.code} className={`small ${x.severity === "BLOCK" ? "risk-t" : "attn-t"}`}>{t(x.es, x.en)}</li>)}</ul>}
                {blocked.length > 0 && <ul className="mk-ul">{blocked.map((code) => <li key={code} className="small risk-t">{t(BLOCK_TEXT[code]?.[0] ?? code, BLOCK_TEXT[code]?.[1] ?? code)}</li>)}</ul>}
                <span className="src">{t(`Hechos usados: ${b.draft!.meta.factsUsed.length} · inferencias: ${b.draft!.meta.inferencesUsed.length} · política ${b.draft!.meta.policyVersion}. SOLU no envía nada: edítalo, envíalo tú y luego regístralo aquí.`, `Facts used: ${b.draft!.meta.factsUsed.length} · inferences: ${b.draft!.meta.inferencesUsed.length} · policy ${b.draft!.meta.policyVersion}. SOLU doesn't send anything: edit it, send it yourself, then record it here.`)}</span>
                <div className="row">
                  <label>{t("Lo envié por", "I sent it by")}<select name="channel" defaultValue={b.channel === "INTRO" ? "EMAIL" : b.channel}>{Object.entries(CHANNELS).filter(([k]) => k !== "INTRO").map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                  <label className="check"><input type="checkbox" name="reviewed" value="1" /> {t("Lo revisé y lo envié yo", "I reviewed it and sent it myself")}</label>
                  <label className="check"><input type="checkbox" name="followUp" value="1" defaultChecked /> {t("Crear el siguiente movimiento si no responde", "Create the next move if there's no answer")}</label>
                </div>
                <div><button type="submit">{t("Registrar envío", "Record as sent")}</button></div>
              </form>
            </div>
          </div>
        )}
      </section>

      <div className="grid cols-2">
        <section className="card">
          <b>{t("Historia con nosotros", "History with us")}</b>
          {c.deals.length === 0 && c.activities.length === 0 ? <p className="small muted">{t("Aún sin historia registrada.", "No recorded history yet.")}</p> : (
            <ul className="mk-ul">
              {c.deals.slice(0, 5).map((d) => <li key={d.id} className="small"><Link href={`/deals/${d.id}`}>{d.code ?? ""} {d.title}</Link>{d.actualResult ? <span className="src"> · {d.actualResult}</span> : null}</li>)}
              {c.activities.slice(0, 6).map((a) => <li key={a.id} className="small">{a.subject}<span className="src"> · {i.day(a.occurredAt)} · {a.user.name}</span></li>)}
            </ul>
          )}
        </section>
        <section className="card">
          <b>{t("Mensajes preparados", "Prepared messages")}</b>
          {c.prepared.length === 0 ? <p className="small muted">{t("Ninguno todavía.", "None yet.")}</p> : (
            <ul className="mk-ul">{c.prepared.map((m) => (
              <li key={m.id} className="small">
                <details><summary>{t(PURPOSES[m.purpose as Purpose]?.es ?? m.purpose, PURPOSES[m.purpose as Purpose]?.en ?? m.purpose)} · {t(CHANNELS[m.channel]?.es ?? m.channel, CHANNELS[m.channel]?.en ?? m.channel)} · {m.reviewedByName} · {i.day(m.generatedAt)}</summary>
                  <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{m.finalText}</pre>
                  <span className="src block">{t("Construido con", "Built from")}: {m.sourceContextIds.join(", ")} · {m.policyVersion}{m.finalText !== m.draft ? ` · ${t("editado por la persona", "edited by the person")}` : ""}</span>
                </details>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </>
  );
}

const BLOCK_TEXT: Record<string, [string, string]> = {
  UNFILLED: ["Quedó un espacio sin completar.", "There's a blank left to fill in."],
  ACCUSATORY: ["Suena acusatorio. Describe el hecho y pide ayuda para resolverlo, sin etiquetar a la persona.", "It sounds accusatory. Describe the fact and ask for help to solve it, without labeling the person."],
  COMPETITOR: ["Critica a un proveedor o competidor. Mejor hablar de lo que el cliente necesita.", "It criticizes a supplier or competitor. Better to talk about what the customer needs."],
  CLOSENESS: ["Sugiere una cercanía que no tenemos registrada con esta persona.", "It suggests a closeness we have no record of with this person."],
  SOFT_STOP: ["Es un bloqueo por control: debe decir con claridad que no se puede continuar hasta verificar.", "It's a control stop: it must say clearly that we can't continue until verified."],
};
