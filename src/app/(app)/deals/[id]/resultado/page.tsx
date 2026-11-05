import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { today } from "@/lib/domain";
import { basisOf, closureChecks, kindLabel, optionsOf, optionTemplates, resultInclude, resultTimeline, stanceLabel, stateLabel, whatHappened } from "@/lib/result";
import { Popovers } from "@/components/Popovers";
import { addEvidence, chooseRecoveryOption, closeJourney, confirmResult, createContinuity, openRecovery, reopenJourney, resolveRecovery } from "./actions";

export default async function ResultClosurePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; recovery?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const deal = await db.deal.findUnique({ where: { id }, include: resultInclude });
  if (!deal) notFound();
  const editable = canEdit(user, deal.ownerId);
  const now = today();
  const closed = !!deal.closedAt;
  const recovered = deal.recoveries.some((r) => r.outcome === "RECOVERED");
  const S = stateLabel(i, deal.resultState, recovered);
  const basis = basisOf(deal);
  const openRec = deal.recoveries.find((r) => !r.resolvedAt) ?? null;
  const pastRec = deal.recoveries.filter((r) => r.resolvedAt);
  const checks = closureChecks(deal, i, now);
  const blocking = checks.filter((c) => c.key !== "learning" && !c.ok);
  const timeline = resultTimeline(deal, i);
  const lastDelivery = deal.deliveries[deal.deliveries.length - 1] ?? null;
  const contradicts = deal.resultState === "ACHIEVED" && deal.resultEvidence.some((e) => e.stance === "CONTRADICTS" && deal.resultConfirmedAt && e.createdAt > deal.resultConfirmedAt);
  const contact = deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "";
  const todayStr = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);

  const okMsg: Record<string, string> = {
    "resultado-achieved": t("Resultado confirmado como logrado, con su evidencia.", "Result confirmed as achieved, with its evidence."),
    "resultado-no_longer_relevant": t("Marcado como «ya no aplica», con el motivo del cliente.", "Marked “no longer relevant”, with the customer's reason."),
    "resultado-partial": t("Resultado parcial registrado.", "Partial result recorded."),
    "resultado-not_achieved": t("Resultado no logrado registrado.", "Not-achieved result recorded."),
    "abrir-recovery": t("No se marca éxito. Abre la Recovery: qué cambió, impacto y opciones.", "No success is marked. Open the Recovery: what changed, impact and options."),
    evidencia: t("Evidencia registrada.", "Evidence recorded."),
    contradice: t("Esta evidencia contradice el resultado logrado. Si el cliente perdió el resultado, abre una Recovery.", "This evidence contradicts the achieved result. If the customer lost the result, open a Recovery."),
    recovery: t("Recovery abierta. Elige una opción con fecha de recuperación.", "Recovery opened. Choose an option with a recovery date."),
    opcion: t("Opción elegida. Quedó como siguiente movimiento del Journey.", "Option chosen. It's now the Journey's next movement."),
    "recovery-recovered": t("Recovery exitosa: el cliente confirmó el resultado.", "Recovery successful: the customer confirmed the result."),
    "recovery-not_recovered": t("Recovery cerrada sin recuperar. El resultado queda como no logrado.", "Recovery closed without recovering. The result stays not achieved."),
    "recovery-no_longer_relevant": t("Recovery cerrada: ya no aplica.", "Recovery closed: no longer relevant."),
    senal: t("Señal de continuidad registrada. No es una oportunidad ni crea un Journey.", "Continuity signal recorded. It's not an opportunity and creates no Journey."),
    cerrado: t("Journey cerrado.", "Journey closed."),
    "ya-cerrado": t("Este Journey ya estaba cerrado.", "This Journey was already closed."),
    reabierto: t("Journey reabierto.", "Journey reopened."),
  };
  const errMsg: Record<string, string> = {
    estado: t("Elige un estado.", "Pick a state."),
    evidencia: t("La evidencia es obligatoria: qué dijo o qué se vio, y quién.", "Evidence is required: what was said or seen, and by whom."),
    real: t("Escribe el resultado real.", "Write the actual result."),
    "recovery-abierta": t("Hay una Recovery abierta: resuélvela como exitosa para marcar el resultado logrado.", "A Recovery is open: resolve it as successful to mark the result achieved."),
    recovery: t("Escribe qué cambió, el impacto y al menos una opción.", "Write what changed, the impact and at least one option."),
    "ya-abierta": t("Ya hay una Recovery abierta.", "A Recovery is already open."),
    opcion: t("Esa opción ya no aplica.", "That option no longer applies."),
    nota: t("Escribe qué se acordó con el cliente.", "Write what was agreed with the customer."),
    senal: t("Una señal necesita qué y por qué es legítima.", "A signal needs what, and why it's legitimate."),
    disparador: t("Un disparador necesita una fecha o un evento.", "A trigger needs a date or an event."),
    "no-listo": t("Aún no se puede cerrar: revisa la preparación para el cierre.", "It can't be closed yet: check closure readiness."),
    cierre: t("Escribe qué pasó y una línea de aprendizaje.", "Write what happened and one line of learning."),
    "sin-senal": t("Registra una señal de continuidad o di por qué no hay una legítima.", "Record a continuity signal or say why there isn't a legitimate one."),
    cerrado: t("El Journey está cerrado.", "The Journey is closed."),
  };

  const EvKind = ({ name = "evKind" }: { name?: string }) => (
    <select name={name} defaultValue="CUSTOMER">{(["CUSTOMER", "TECHNICAL", "VISIT", "MEASURE", "DOCUMENT"] as const).map((k) => <option key={k} value={k}>{kindLabel(i, k)}</option>)}</select>
  );
  const templates = optionTemplates(i, deal.resultState);

  return (
    <div className="jw res">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${deal.id}?tab=result`}>{deal.code ?? deal.title}</Link> · <Link href={`/accounts/${deal.account.id}`}>{deal.account.name}</Link></p>
          <span className="jid">{t("Resultado y cierre", "Result & closure")}</span>
          <span className="grow" />
          {closed && <span className="sig ok">{t(`Cerrado ${i.day(deal.closedAt)}`, `Closed ${i.day(deal.closedAt)}`)}</span>}
        </div>
        <p className="jh-sub">{deal.title}{lastDelivery ? ` · ${t("última entrega", "last delivery")} ${i.day(lastDelivery.deliveredAt)}` : ""}</p>
      </header>

      {/* Desired vs actual */}
      <section className="rcmp" aria-label={t("Resultado deseado contra resultado real", "Desired result vs actual result")}>
        <div className="rc want">
          <span className="k">{t("RESULTADO DESEADO", "DESIRED RESULT")}</span>
          <b>{deal.desiredResult ?? <span className="muted">{t("No quedó escrito", "Not written down")}</span>}</b>
          <span className="src">{[deal.successMeasure ? t(`Éxito = ${deal.successMeasure}`, `Success = ${deal.successMeasure}`) : null, deal.neededBy ? t(`para ${i.day(deal.neededBy)}`, `by ${i.day(deal.neededBy)}`) : null].filter(Boolean).join(" · ") || t("original, acordado con el cliente", "original, agreed with the customer")}</span>
        </div>
        <div className="rc-vs" aria-hidden>→</div>
        <div className={`rc got ${S.cls}`}>
          <span className="k">{t("RESULTADO REAL", "ACTUAL RESULT")} <span className={`sig ${S.cls}`}>{S.text}</span></span>
          <b>{deal.actualResult ?? (deal.resultState === "PENDING" ? <span className="muted">{lastDelivery ? t("Entregado, pero el cliente aún no confirma", "Delivered, but the customer hasn't confirmed") : t("Aún no hay resultado", "No result yet")}</span> : "—")}</b>
          {basis ? (
            <span className="rc-basis"><span className="q">«{basis.text}»</span><span className="src">{basis.who ?? "—"} · {kindLabel(i, basis.kind)} · {i.day(basis.at)}</span></span>
          ) : <span className="src">{t("Sin evidencia todavía. Entregar no es el resultado.", "No evidence yet. Delivering is not the result.")}</span>}
        </div>
      </section>
      {(deal.reliefNote || deal.resultPendingNote) && (
        <section className="rrelief">
          {deal.reliefNote && <p><span className="k">{t("Qué cambió para el cliente", "What changed for the customer")}</span>{deal.reliefNote}</p>}
          {deal.resultPendingNote && <p className="attn-t"><span className="k">{t("Lo que falta", "What's still missing")}</span>{deal.resultPendingNote}</p>}
        </section>
      )}
      {deal.resultState === "PENDING" && lastDelivery && !openRec && (
        <div className="note">{t(`Entregado el ${i.day(lastDelivery.deliveredAt)}. No se marca éxito hasta que el cliente confirme que resolvió su problema.`, `Delivered on ${i.day(lastDelivery.deliveredAt)}. No success is marked until the customer confirms it solved their problem.`)}</div>
      )}
      {contradicts && <div className="note risk">{t("Hay evidencia nueva que contradice el resultado logrado. Si el cliente perdió el resultado, abre una Recovery.", "New evidence contradicts the achieved result. If the customer lost the result, open a Recovery.")}</div>}

      {closed && (
        <section className="fwd-banner ok rclosed">
          <span className="k">{t(`Journey cerrado · ${i.day(deal.closedAt)} · ${deal.closedByName ?? ""}`, `Journey closed · ${i.day(deal.closedAt)} · ${deal.closedByName ?? ""}`)}</span>
          <p><b className="small">{t("Qué pasó", "What happened")}</b> {deal.closureSummary}</p>
          <p><b className="small">{t("Qué aprendimos", "What we learned")}</b> {deal.closureLearning}</p>
          <p><b className="small">{t("Señal futura", "Future signal")}</b> {deal.continuity.length ? deal.continuity.map((c) => c.what).join(" · ") : t(`Ninguna legítima: ${deal.closureNoSignalReason ?? "—"}`, `None legitimate: ${deal.closureNoSignalReason ?? "—"}`)}</p>
          {editable && <form action={reopenJourney.bind(null, deal.id)}><button type="submit" className="linkb">{t("Reabrir", "Reopen")}</button></form>}
        </section>
      )}

      {/* Recovery */}
      {openRec ? (
        <section id="recovery" className="jblock rrec">
          <div className="jbh"><b>RECOVERY</b><span className="grow" /><span className="sig risk">{t(`Abierta ${i.day(openRec.openedAt)}`, `Open since ${i.day(openRec.openedAt)}`)}</span></div>
          <dl className="rrec-dl">
            <dt>{t("Qué cambió", "What changed")}</dt><dd>{openRec.whatChanged}</dd>
            <dt>{t("Impacto para el cliente", "Impact for the customer")}</dt><dd>{openRec.impact}</dd>
            {openRec.selectedKey && <><dt>{t("Recuperación esperada", "Expected recovery")}</dt><dd className="mono">{openRec.expectedBy ? i.day(openRec.expectedBy) : "—"}{openRec.expectedBy && openRec.expectedBy < now ? <span className="risk-t"> · {t("vencida", "overdue")}</span> : null}</dd></>}
          </dl>
          <div className="fopts">
            {optionsOf(openRec).map((o) => {
              const on = openRec.selectedKey === o.key;
              return (
                <div key={o.key} className={`fopt${on ? " on" : ""}`}>
                  <b>{o.title}</b>
                  {o.detail && <p className="small">{o.detail}</p>}
                  <div className="fopt-eff"><span className="src">{t("Recupera", "Recovers by")}</span><span className="mono">{o.eta ? i.day(new Date(`${o.eta}T00:00:00Z`)) : "—"}</span></div>
                  {on ? <span className="small ok-t">✓ {t(`Elegida por ${openRec.selectedByName} · ${i.day(openRec.selectedAt)}`, `Chosen by ${openRec.selectedByName} · ${i.day(openRec.selectedAt)}`)}{openRec.selectedNote ? ` · ${openRec.selectedNote}` : ""}</span>
                    : editable && !openRec.selectedKey && (
                      <form action={chooseRecoveryOption.bind(null, openRec.id, o.key)} className="qa-form">
                        <label>{t("Recuperación esperada", "Expected recovery")}<input name="expectedBy" type="date" defaultValue={o.eta ?? ""} /></label>
                        <input name="note" placeholder={t("Nota (opcional)", "Note (optional)")} aria-label={t("Nota", "Note")} />
                        <button type="submit" className="secondary sm">{t("Elegir", "Choose")}</button>
                      </form>
                    )}
                </div>
              );
            })}
          </div>
          {editable && (
            <details className="qa rrec-resolve"><summary className="qa-btn">{t("Resolver Recovery", "Resolve recovery")}</summary><div className="qa-pop wide">
              <form action={resolveRecovery.bind(null, openRec.id)} className="qa-form">
                <input type="hidden" name="outcome" value="RECOVERED" />
                <b className="small">{t("Exitosa: el cliente confirma el resultado", "Successful: the customer confirms the result")}</b>
                <label>{t("Qué dijo el cliente", "What the customer said")}<input name="evText" required placeholder={t("Ej.: «ya instalamos y quedó funcionando»", "E.g.: “we installed it and it's working”")} /></label>
                <label>{t("Quién", "Who")}<input name="evWho" required defaultValue={contact} /></label>
                <label>{t("Resultado real", "Actual result")}<input name="actualResult" defaultValue={deal.desiredResult ?? ""} /></label>
                <button type="submit">{t("Recovery exitosa", "Recovery successful")}</button>
              </form>
              <form action={resolveRecovery.bind(null, openRec.id)} className="qa-form" style={{ marginTop: 10 }}>
                <label>{t("Cerrar sin recuperar (qué se acordó)", "Close without recovering (what was agreed)")}<input name="note" required placeholder={t("Ej.: nota crédito emitida; el cliente compra otra solución", "E.g.: credit note issued; customer buys another solution")} /></label>
                <div className="qa-row">
                  <button type="submit" name="outcome" value="NOT_RECOVERED" className="secondary">{t("No se recuperó", "Not recovered")}</button>
                  <button type="submit" name="outcome" value="NO_LONGER_RELEVANT" className="secondary">{t("Ya no aplica", "No longer relevant")}</button>
                </div>
              </form>
            </div></details>
          )}
        </section>
      ) : editable && !closed && (deal.resultState === "NOT_ACHIEVED" || deal.resultState === "PARTIAL" || sp.recovery) && (
        <section id="recovery" className="jblock rrec">
          <div className="jbh"><b>{t("ABRIR RECOVERY", "OPEN RECOVERY")}</b><span className="grow" /><span className="src">{t("el producto llegó, pero el resultado no está", "the product arrived, but the result isn't there")}</span></div>
          <form action={openRecovery.bind(null, deal.id)} className="stack jform">
            <label>{t("Qué cambió", "What changed")}<input name="whatChanged" required placeholder={t("Ej.: el motor llegó con brida IEC y la base del cliente es NEMA", "E.g.: the motor arrived with an IEC flange and the customer's base is NEMA")} /></label>
            <label>{t("Impacto para el cliente", "Impact for the customer")}<input name="impact" required placeholder={t("Ej.: el secador sigue parado; pierden 2 turnos por día", "E.g.: the dryer is still down; they lose 2 shifts a day")} /></label>
            <div className="rrec-opts">
              {templates.map((o, n) => (
                <fieldset key={o.key} className="rrec-opt">
                  <legend>{t(`Opción ${n + 1}`, `Option ${n + 1}`)}</legend>
                  <input name={`opt${n + 1}_title`} defaultValue={o.title} aria-label={t("Opción", "Option")} />
                  <input name={`opt${n + 1}_detail`} defaultValue={o.detail} aria-label={t("Detalle", "Detail")} />
                  <label>{t("Recupera el", "Recovers by")}<input name={`opt${n + 1}_eta`} type="date" /></label>
                </fieldset>
              ))}
            </div>
            <span className="src">{t("Deja vacía la opción que no aplique.", "Leave empty any option that doesn't apply.")}</span>
            <button type="submit">{t("Abrir Recovery", "Open recovery")}</button>
          </form>
        </section>
      )}

      <div className="jbody">
        <div className="jmain">
          {/* Evidence timeline */}
          <section className="jblock">
            <div className="jbh"><b>{t("EVIDENCIA Y LÍNEA DEL RESULTADO", "RESULT EVIDENCE & TIMELINE")}</b></div>
            {timeline.length === 0 ? <p className="quiet-p">{t("Sin hechos todavía.", "No facts yet.")}</p> : (
              <ol className="rtl">
                {timeline.map((x, n) => (
                  <li key={n} className={`${x.kind} ${x.tone}`}>
                    <span className="mono">{i.day(x.at)}</span>
                    <span className="dot" aria-hidden />
                    <span><b>{x.title}</b>{x.detail && <span className="src block">{x.detail}</span>}</span>
                  </li>
                ))}
              </ol>
            )}
            {pastRec.length > 0 && <p className="src" style={{ marginTop: 8 }}>{t(`${pastRec.length} Recovery resuelta(s).`, `${pastRec.length} recovery(ies) resolved.`)}</p>}
          </section>

          {/* Closure readiness + close */}
          {!closed && (
            <section className="jblock" id="cierre">
              <div className="jbh"><b>{t("PREPARACIÓN PARA EL CIERRE", "CLOSURE READINESS")}</b><span className="grow" /><span className={`sig ${blocking.length ? "attn" : "ok"}`}>{blocking.length ? t(`Faltan ${blocking.length}`, `${blocking.length} missing`) : t("Listo para cerrar", "Ready to close")}</span></div>
              <ul className="qv-checks">
                {checks.map((c) => (
                  <li key={c.key} className={c.ok ? "ok" : c.key === "learning" ? "no info" : "no"}>
                    <span className="ic" aria-hidden>{c.ok ? "✓" : c.key === "learning" ? "…" : "!"}</span>
                    <span><b>{c.label}</b><span className="src block">{c.detail}</span></span>
                  </li>
                ))}
              </ul>
              {blocking.length === 0 && editable && (
                <form action={closeJourney.bind(null, deal.id)} className="stack jform rclose">
                  <label>{t("Qué pasó", "What happened")}<textarea name="summary" rows={3} defaultValue={whatHappened(deal, i)} required /></label>
                  <label>{t("Qué aprendimos (una línea)", "What we learned (one line)")}<input name="learning" required maxLength={300} placeholder={t("Ej.: pedir foto de la placa de la base antes de cotizar motores", "E.g.: ask for a photo of the base nameplate before quoting motors")} /></label>
                  {deal.continuity.length
                    ? <p className="small">{t("Señal futura", "Future signal")}: {deal.continuity.map((c) => c.what).join(" · ")}</p>
                    : <label>{t("¿Por qué no hay una señal futura legítima?", "Why is there no legitimate future signal?")}<input name="noSignalReason" placeholder={t("Ej.: compra única; el cliente no tiene más equipos de este tipo", "E.g.: one-off purchase; the customer has no more equipment of this type")} /></label>}
                  <span className="src">{t("Sin encuesta y sin seguimientos automáticos. Si hay una razón real para volver, regístrala como señal de continuidad.", "No survey and no automatic follow-ups. If there's a real reason to come back, record it as a continuity signal.")}</span>
                  <button type="submit">{t("Cerrar Journey", "Close Journey")}</button>
                </form>
              )}
            </section>
          )}
        </div>

        <aside className="jrail">
          {editable && !closed && (
            <div>
              <div className="jbh"><b>{t("REGISTRAR", "RECORD")}</b></div>
              <div className="qa-bar col">
                <details className="qa"><summary className="qa-btn">{t("Confirmar resultado del cliente", "Confirm customer result")}</summary><div className="qa-pop wide">
                  <form action={confirmResult.bind(null, deal.id)} className="qa-form">
                    <fieldset className="rstates">
                      <legend>{t("Resultado", "Result")}</legend>
                      {(["ACHIEVED", "PARTIAL", "NOT_ACHIEVED", "NO_LONGER_RELEVANT"] as const).map((s) => <label key={s} className="chk"><input type="radio" name="state" value={s} required defaultChecked={deal.resultState === s} /> {stateLabel(i, s).text}</label>)}
                    </fieldset>
                    <label>{t("Resultado real, en palabras del cliente", "Actual result, in the customer's words")}<input name="actualResult" defaultValue={deal.actualResult ?? ""} /></label>
                    <label>{t("Evidencia: qué dijo o qué se vio", "Evidence: what was said or seen")}<input name="evText" required placeholder={t("Ej.: «ya instalamos y quedó funcionando»", "E.g.: “we installed it and it's working”")} /></label>
                    <div className="qa-row">
                      <label>{t("Tipo", "Kind")}<EvKind /></label>
                      <label>{t("Quién", "Who")}<input name="evWho" defaultValue={contact} /></label>
                    </div>
                    <div className="qa-row">
                      <label>{t("Dónde", "Where")}<input name="evSource" placeholder={t("WhatsApp, visita…", "WhatsApp, visit…")} /></label>
                      <label>{t("Fecha", "Date")}<input name="evDate" type="date" defaultValue={todayStr} /></label>
                    </div>
                    <label>{t("Qué cambió para el cliente (alivio)", "What changed for the customer (relief)")}<input name="relief" defaultValue={deal.reliefNote ?? ""} /></label>
                    <label>{t("Si es parcial: qué falta", "If partial: what's missing")}<input name="pending" defaultValue={deal.resultPendingNote ?? ""} /></label>
                    <span className="src">{t("No logrado o parcial abre Recovery. La entrega sola nunca cuenta como logrado.", "Not achieved or partial opens a Recovery. Delivery alone never counts as achieved.")}</span>
                    <button type="submit">{t("Confirmar", "Confirm")}</button>
                  </form>
                </div></details>
                <details className="qa"><summary className="qa-btn">{t("Agregar evidencia", "Add evidence")}</summary><div className="qa-pop wide">
                  <form action={addEvidence.bind(null, deal.id)} className="qa-form">
                    <label>{t("Qué se dijo o se vio", "What was said or seen")}<input name="text" required /></label>
                    <div className="qa-row">
                      <label>{t("Tipo", "Kind")}<EvKind name="kind" /></label>
                      <label>{t("Frente al resultado", "Against the result")}<select name="stance" defaultValue="SUPPORTS">{(["SUPPORTS", "PARTIAL", "CONTRADICTS", "NEUTRAL"] as const).map((s) => <option key={s} value={s}>{stanceLabel(i, s).text}</option>)}</select></label>
                    </div>
                    <div className="qa-row">
                      <label>{t("Quién", "Who")}<input name="who" defaultValue={contact} /></label>
                      <label>{t("Fecha", "Date")}<input name="date" type="date" defaultValue={todayStr} /></label>
                    </div>
                    <label>{t("Dónde", "Where")}<input name="source" /></label>
                    <button type="submit">{t("Guardar", "Save")}</button>
                  </form>
                </div></details>
                {!openRec && deal.resultState !== "NOT_ACHIEVED" && deal.resultState !== "PARTIAL" && !sp.recovery && <Link className="qa-btn" href={`/deals/${deal.id}/resultado?recovery=1#recovery`}>{t("Abrir Recovery", "Open recovery")}</Link>}
              </div>
            </div>
          )}
          <div>
            <div className="jbh"><b>{t("SEÑALES DE CONTINUIDAD", "CONTINUITY SIGNALS")}</b></div>
            {deal.continuity.length === 0 ? <p className="quiet-p small">{t("Ninguna. Solo se registran con una razón real.", "None. Only recorded with a real reason.")}</p> : (
              <ul className="plain small rsig">
                {deal.continuity.map((c) => (
                  <li key={c.id}><span className={`sig ${c.kind === "TRIGGER" ? "info" : "dash"}`}>{c.kind === "TRIGGER" ? t("Disparador", "Trigger") : t("Señal", "Signal")}</span> <b>{c.what}</b><span className="src block">{t("Por qué", "Why")}: {c.basis}{c.triggerOn ? ` · ${t("el", "on")} ${i.day(c.triggerOn)}` : ""}{c.triggerEvent ? ` · ${t("cuando", "when")} ${c.triggerEvent}` : ""}</span></li>
                ))}
              </ul>
            )}
            {editable && (
              <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("Crear disparador de continuidad", "Create continuity trigger")}</summary><div className="qa-pop wide">
                <form action={createContinuity.bind(null, deal.id)} className="qa-form">
                  <div className="seg-r">
                    <label className="chk"><input type="radio" name="kind" value="TRIGGER" defaultChecked /> {t("Disparador (fecha o evento)", "Trigger (date or event)")}</label>
                    <label className="chk"><input type="radio" name="kind" value="SIGNAL" /> {t("Señal (algo que observamos)", "Signal (something we observed)")}</label>
                  </div>
                  <label>{t("Qué", "What")}<input name="what" required placeholder={t("Ej.: reemplazar el sello de respaldo en la parada de diciembre", "E.g.: replace the backup seal at the December shutdown")} /></label>
                  <label>{t("Por qué es legítima (evidencia)", "Why it's legitimate (evidence)")}<input name="basis" required placeholder={t("Ej.: Carlos dijo que la parada anual es el 15 de diciembre", "E.g.: Carlos said the annual shutdown is Dec 15")} /></label>
                  <div className="qa-row">
                    <label>{t("Fecha", "Date")}<input name="triggerOn" type="date" /></label>
                    <label>{t("o evento", "or event")}<input name="triggerEvent" placeholder={t("Ej.: cuando aprueben el presupuesto 2027", "E.g.: when the 2027 budget is approved")} /></label>
                  </div>
                  <span className="src">{t("No es una oportunidad: no crea Journey ni valor en el pipeline. Una fecha crea un solo recordatorio.", "Not an opportunity: it creates no Journey and no pipeline value. A date creates a single reminder.")}</span>
                  <button type="submit">{t("Guardar", "Save")}</button>
                </form>
              </div></details>
            )}
          </div>
          <p className="note ai">{t("SOLU no marca éxito por la entrega ni crea seguimientos 30/60/90 automáticos. El resultado se confirma con evidencia del cliente.", "SOLU doesn't mark success on delivery or create automatic 30/60/90 follow-ups. The result is confirmed with customer evidence.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
