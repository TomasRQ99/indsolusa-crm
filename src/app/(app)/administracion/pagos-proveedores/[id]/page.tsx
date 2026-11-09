import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { loadSupplierPayments } from "@/lib/queries";
import { paymentStateLabel } from "@/lib/labels";
import { authorityFor, treasuryChecks } from "@/lib/purchasing";
import { db } from "@/lib/db";
import { Popovers } from "@/components/Popovers";
import { approveSupplierPayment, markUncertain, reconcileExecution, recordExecution, verifySupplierPayment } from "../../actions";

export default async function TreasuryPaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const [p] = await loadSupplierPayments({ id });
  if (!p) notFound();
  const spo = p.supplierPo;
  const s = spo.supplier;
  const deal = spo.deal;
  const manager = canManageAll(user);
  // supplierPo already carries all its own fields (version, releasedAt, amount…): no extra query.
  const spoFull = spo;
  const { dup, usd } = await treasuryChecks(p, spoFull, i);
  const auth = authorityFor(user, p, usd, i);
  const L = paymentStateLabel(i, p.state);
  const m = (v: unknown) => `${p.currency} ${i.n2(v)}`;
  const differs = new Set(p.discrepancies.map((x) => x.field));
  const changed = !!s.bankVerifiedAt && p.discrepancies.length > 0;
  const openExec = p.executions.find((e) => e.state === "SENT" || e.state === "UNCERTAIN");
  const confirmed = p.executions.find((e) => e.state === "CONFIRMED");
  // Least privilege: full account numbers and the verification call are for Treasury (Management/Admin);
  // everyone else sees the last 4 digits. The requester can never verify their own request.
  const canVerify = p.state === "VERIFY" && p.requestedById !== user.id && manager;
  const shown = (key: string, v: string | null) => (v == null ? "—" : manager || key !== "account" ? v : `•••• ${v.replace(/[^A-Za-z0-9]/g, "").slice(-4)}`);
  const fields = [
    { key: "beneficiary", label: t("Beneficiario", "Beneficiary"), profile: s.bankBeneficiary, doc: p.docBeneficiary },
    { key: "bankName", label: t("Banco", "Bank"), profile: s.bankName, doc: p.docBankName },
    { key: "account", label: t("Cuenta / IBAN", "Account / IBAN"), profile: s.bankAccount, doc: p.docAccount },
    { key: "swift", label: "SWIFT", profile: s.bankSwift, doc: p.docSwift },
  ];

  const okMsg: Record<string, string> = {
    solicitado: t("Solicitud creada con los datos del hito, del Journey y del perfil verificado.", "Request created from the milestone, the Journey and the verified profile."),
    verificado: t("Verificación independiente registrada.", "Independent verification recorded."),
    aprobado: t("Aprobado. Todavía no está pagado: falta enviarlo desde el banco.", "Approved. It's not paid yet: it still has to be sent from the bank."),
    enviado: t("Envío registrado. No cuenta como pagado hasta que el banco o el proveedor lo confirme.", "Sending recorded. It doesn't count as paid until the bank or supplier confirms it."),
    pagado: t("Pago confirmado con evidencia.", "Payment confirmed with evidence."),
    incierto: t("Marcado como incierto. Conviene no reintentar hasta conciliarlo.", "Marked uncertain. Best not to retry until it's reconciled."),
    fallido: t("Registrado: el dinero no salió. Puedes registrar un nuevo envío.", "Recorded: the money didn't leave. You can record a new sending."),
  };
  const errMsg: Record<string, string> = {
    estado: t("Esa acción no aplica en el estado actual.", "That action doesn't apply in the current state."),
    duplicado: t("Bloqueado por duplicado: mismo documento, mismo hito o se supera el valor de la PO.", "Blocked as duplicate: same document, same milestone, or the PO value is exceeded."),
    "revisar-duplicados": t("Marca que revisaste los posibles duplicados.", "Tick that you reviewed the possible duplicates."),
    autoridad: t("No tienes autoridad para aprobar este pago.", "You don't have authority to approve this payment."),
    referencia: t("Para marcarlo pagado escribe la referencia del banco.", "To mark it paid write the bank reference."),
    evidencia: t("Escribe la evidencia.", "Write the evidence."),
    nota: t("Escribe qué pasó.", "Write what happened."),
    ruta: t("Completa la ruta de verificación: teléfono registrado y cada dato confirmado.", "Complete the verification route: registered phone and every field confirmed."),
  };

  const order = ["VERIFY", "APPROVE", "EXECUTE", "SENT", "UNCERTAIN", "DONE"];
  const n = order.indexOf(p.state);
  const steps = [
    { k: t("Requerido", "Required"), sub: p.requirement ? `${p.requirement.label}` : spo.code, done: true },
    { k: t("Solicitado", "Requested"), sub: `${p.requestedBy.name} · ${i.day(p.createdAt)}`, done: true },
    ...(p.discrepancies.length || p.verifiedAt ? [{ k: t("Banco verificado", "Bank verified"), sub: p.verifiedAt ? `${p.verifiedBy?.name} · ${i.day(p.verifiedAt)}` : t("detenido", "stopped"), done: !!p.verifiedAt, stop: p.state === "VERIFY" }] : []),
    { k: t("Aprobado", "Approved"), sub: p.approvedAt ? `${p.approvedBy?.name} · ${i.day(p.approvedAt)}` : "", done: n >= 2 },
    { k: t("Enviado al banco", "Sent to bank"), sub: openExec ? `${openExec.recordedByName} · ${i.day(openExec.sentAt)}` : confirmed ? i.day(confirmed.sentAt) : "", done: n >= 3, stop: p.state === "UNCERTAIN" },
    { k: t("Pagado (confirmado)", "Paid (confirmed)"), sub: p.executedAt ? i.day(p.executedAt) : "", done: p.state === "DONE" },
  ];

  return (
    <div className="jw qv tre">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/administracion/pagos-proveedores">{t("Tesorería · pagos a proveedores", "Treasury · supplier payments")}</Link> · <Link href={`/compras/${spo.id}`}>{spo.code}</Link></p>
          <span className="grow" />
        </div>
        <div className="jh-title">
          <h1>{m(p.amount)} · {s.name}</h1>
          <span className={`sig ${L.cls}`}>{L.text}</span>
        </div>
        <p className="jh-sub">{p.requirement ? `${p.requirement.label} (${p.requirement.percent} %) · ` : ""}{p.currency !== "USD" && usd != null ? `≈ USD ${i.n2(usd)} · ` : ""}{t("pagar a más tardar", "pay by")} {i.dateShort(p.dueBy)}</p>
        <ol className="pay-steps big">{steps.map((x, k) => <li key={k} className={`${x.done ? "done" : ""}${"stop" in x && x.stop ? " warn" : ""}`}>{x.k}{x.sub && <small>{x.sub}</small>}</li>)}</ol>
      </header>

      {/* Hard stop: bank change */}
      {p.state === "VERIFY" && (
        <section className="po-impact">
          <span className="k">HARD STOP · {changed ? t("CAMBIO DE BANCO", "BANK CHANGE") : t("PERFIL SIN VERIFICAR", "UNVERIFIED PROFILE")}</span>
          <b>{changed ? t("Los datos bancarios de la instrucción no son los del perfil verificado. Este pago no se aprueba ni se envía.", "The instruction's bank data is not the verified profile's. This payment can't be approved or sent.") : t("Este proveedor no tiene perfil bancario verificado. Se verifica una vez y queda como referencia.", "This supplier has no verified bank profile. Verify once and it becomes the reference.")}</b>
          {changed && <p>{t(`Llegó por: ${p.docSource ?? "documento sin fuente"}. Un cambio de cuenta por correo o WhatsApp es el patrón de fraude más común: nada de ese mensaje sirve para verificarlo.`, `It came via: ${p.docSource ?? "document without source"}. An account change by email or WhatsApp is the most common fraud pattern: nothing in that message can be used to verify it.`)}</p>}
          <ol className="tre-route">
            <li><b>{t("No uses ningún dato del mensaje", "Don't use any contact data from the message")}</b>{t(" (teléfono, correo, enlace).", " (phone, email, link).")}</li>
            <li><b>{t("Llama al teléfono registrado", "Call the registered phone")}</b> <span className="mono">{s.phone ?? t("— no hay teléfono registrado: pide a Gerencia", "— no registered phone: ask Management")}</span>{t(" y confirma beneficiario, banco, cuenta y SWIFT.", " and confirm beneficiary, bank, account and SWIFT.")}</li>
            <li><b>{t("Lo verifica otra persona", "Someone else verifies")}</b>{t(` distinta de quien solicitó (${p.requestedBy.name}).`, ` other than the requester (${p.requestedBy.name}).`)}</li>
            <li><b>{t("Aprueba una tercera persona", "A third person approves")}</b>{t(" con autoridad para el monto. Solo entonces se envía.", " with authority for the amount. Only then is it sent.")}</li>
          </ol>
        </section>
      )}
      {p.state === "UNCERTAIN" && openExec && (
        <section className="po-impact">
          <span className="k">{t("EJECUCIÓN INCIERTA", "UNCERTAIN EXECUTION")}</span>
          <b>{t("No sabemos si el dinero salió. No se reintenta hasta conciliarlo.", "We don't know whether the money left. No retry until it's reconciled.")}</b>
          <p>{t(`Enviado el ${i.date(openExec.sentAt)} por ${openExec.recordedByName}${openExec.bankRef ? ` · ref. ${openExec.bankRef}` : ""}. ${openExec.note ?? ""}`, `Sent on ${i.date(openExec.sentAt)} by ${openExec.recordedByName}${openExec.bankRef ? ` · ref. ${openExec.bankRef}` : ""}. ${openExec.note ?? ""}`)}</p>
        </section>
      )}

      <section className="spo-why">
        <div><span className="k">{t("Por qué se mueve este dinero", "Why this money must move")}</span><b>{p.reason}</b></div>
        <div><span className="k">Journey · Supplier PO</span><b><Link href={`/deals/${deal.id}`}>{deal.code}</Link> · <Link href={`/compras/${spo.id}`}>{spo.code} v{spoFull.version}</Link></b><span className="src">{deal.account.name} · {spoFull.releasedAt ? t(`liberada ${i.day(spoFull.releasedAt)}`, `released ${i.day(spoFull.releasedAt)}`) : t("sin liberar", "not released")} · {m(spoFull.amount)}</span></div>
        <div className="prom"><span className="k">{t("Promesa al cliente", "Customer promise")}</span><b>{deal.promiseText ?? "—"}</b><span className="mono">{i.dateShort(deal.promisedDate)}</span></div>
      </section>

      <div className="jbody">
        <div className="jmain">
          <div className="tre-checks">
            <section className={`jblock ${p.discrepancies.length && !p.verifiedAt ? "bad" : "good"}`}>
              <div className="jbh"><b>BANK PROFILE</b><span className="grow" />{!s.bankVerifiedAt ? <span className="sig attn">{t("Sin verificar", "Not verified")}</span> : p.discrepancies.length && !p.verifiedAt ? <span className="sig risk">{t("Difiere", "Differs")}</span> : <span className="sig ok">✓ {t("Verificado", "Verified")}</span>}</div>
              <table className="tre-bank">
                <thead><tr><th /><th>{t("Perfil verificado", "Verified profile")}</th><th>{t("Instrucción", "Instruction")}</th></tr></thead>
                <tbody>{fields.map((f) => <tr key={f.key} className={differs.has(f.key as never) ? "diff" : ""}><td>{f.label}</td><td className="mono">{s.bankVerifiedAt ? shown(f.key, f.profile) : "—"}</td><td className="mono">{shown(f.key, f.doc)}</td></tr>)}</tbody>
              </table>
              {!manager && <p className="src">{t("Por seguridad, el número de cuenta completo solo lo ve Tesorería.", "For security, only Treasury sees the full account number.")}</p>}
              <p className="src">{s.bankVerifiedAt ? t(`Verificado el ${i.date(s.bankVerifiedAt)}. Solo cambia por verificación independiente.`, `Verified on ${i.date(s.bankVerifiedAt)}. Only changes through independent verification.`) : t("Se verificará con este primer pago.", "Will be verified with this first payment.")}</p>
            </section>
            <section className={`jblock ${dup.hard ? "bad" : dup.hits.length ? "warn" : "good"}`}>
              <div className="jbh"><b>DUPLICATE CHECK</b><span className="grow" />{dup.hard ? <span className="sig risk">{t("Bloquea", "Blocks")}</span> : dup.hits.length ? <span className="sig attn">{t("Revisar", "Review")}</span> : <span className="sig ok">✓ {t("Limpio", "Clear")}</span>}</div>
              <p className="small">{dup.text}</p>
              {dup.hits.length > 0 && <ul className="plain">{dup.hits.map((h) => <li key={h.id}><Link href={`/administracion/pagos-proveedores/${h.id}`}>{h.text}</Link>{h.paid ? <span className="risk-t"> · {t("ya pagado", "already paid")}</span> : ""}</li>)}</ul>}
              <p className="src">{t(`En esta PO: ${m(dup.onPo)} solicitados de ${m(spoFull.amount)}.`, `On this PO: ${m(dup.onPo)} requested of ${m(spoFull.amount)}.`)}{p.dupCheckedByName ? ` · ${t("Revisó", "Reviewed by")} ${p.dupCheckedByName}` : ""}</p>
            </section>
            <section className={`jblock ${p.state === "APPROVE" && !auth.can ? "warn" : "good"}`}>
              <div className="jbh"><b>AUTHORITY</b><span className="grow" />{p.approvedAt ? <span className="sig ok">✓ {p.approvedBy?.name}</span> : auth.can ? <span className="sig ok">{t("Puedes aprobar", "You can approve")}</span> : <span className="sig wait">{t("No eres quien aprueba", "Not your approval")}</span>}</div>
              <p className="small">{auth.rule}</p>
              {!p.approvedAt && auth.reasons.length > 0 && <ul className="plain small">{auth.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>}
              <p className="src">{t("Monto para el límite", "Amount for the limit")}: {usd != null ? `USD ${i.n2(usd)}` : "—"}</p>
            </section>
          </div>

          {p.executions.length > 0 && (
            <section className="jblock">
              <div className="jbh"><b>{t("EJECUCIONES (FUERA DE SOLU)", "EXECUTIONS (OUTSIDE SOLU)")}</b></div>
              <ul className="plain">
                {p.executions.map((e) => (
                  <li key={e.id}>
                    <b className="mono">{m(e.amount)}</b> · {i.date(e.sentAt)} · {e.recordedByName}{e.bankRef ? <> · <span className="mono">{e.bankRef}</span></> : ""}{" "}
                    <span className={`sig ${e.state === "CONFIRMED" ? "ok" : e.state === "FAILED" ? "wait" : e.state === "UNCERTAIN" ? "risk" : "attn"}`}>{e.state === "CONFIRMED" ? t("Confirmado", "Confirmed") : e.state === "FAILED" ? t("No salió", "Did not leave") : e.state === "UNCERTAIN" ? t("Incierto", "Uncertain") : t("Enviado · sin confirmar", "Sent · not confirmed")}</span>
                    {e.evidence && <span className="src block">{e.resolvedByName}: {e.evidence}</span>}
                    {e.note && <span className="src block">{e.note}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("SIGUIENTE PASO", "NEXT STEP")}</b></div>
            {p.state === "VERIFY" && (canVerify ? (
              <form action={verifySupplierPayment.bind(null, p.id)} className="qa-form">
                <label className="chk"><input type="checkbox" name="calledRegistered" /> {t("Llamé al teléfono registrado", "I called the registered phone")} <span className="mono">{s.phone ?? "—"}</span></label>
                <label className="chk"><input type="checkbox" name="allFields" /> {t("Confirmé beneficiario, banco, cuenta y SWIFT", "I confirmed beneficiary, bank, account and SWIFT")}</label>
                <label>{t("Con quién hablaste", "Who you spoke with")}<input name="verificationNote" required maxLength={300} /></label>
                <label className="chk"><input type="checkbox" name="updateProfile" defaultChecked /> {t("Actualizar el perfil verificado", "Update the verified profile")}</label>
                <button type="submit" className="wide">{t("Registrar verificación", "Record verification")}</button>
              </form>
            ) : <p className="small">{!manager ? t(`Lo verifica Tesorería (Gerencia o Administración), nunca quien lo solicitó (${p.requestedBy.name}).`, `Treasury (Management or Admin) verifies it, never the requester (${p.requestedBy.name}).`) : t(`Debe verificarlo alguien distinto de ${p.requestedBy.name}.`, `Someone other than ${p.requestedBy.name} must verify it.`)}</p>)}
            {p.state === "APPROVE" && (
              <form action={approveSupplierPayment.bind(null, p.id)} className="qa-form">
                {dup.hits.length > 0 && !dup.hard && <label className="chk"><input type="checkbox" name="dupChecked" value="1" /> {t("Revisé los posibles duplicados: no lo son", "I reviewed the possible duplicates: they aren't")}</label>}
                <button type="submit" className="wide" disabled={!auth.can || dup.hard}>{t("Aprobar solicitud", "Approve request")} · {m(p.amount)}</button>
                <span className="src">{t("Aprobar no paga: autoriza a Tesorería a enviarlo.", "Approving doesn't pay: it authorizes Treasury to send it.")}</span>
              </form>
            )}
            {p.state === "EXECUTE" && (manager ? (
              <form action={recordExecution.bind(null, p.id)} className="qa-form">
                <p className="small">{t("Haz la transferencia en el portal del banco y regístrala aquí.", "Make the transfer in the bank's portal and record it here.")}</p>
                <label>{t("Referencia del banco", "Bank reference")}<input name="bankRef" maxLength={80} /></label>
                <label className="chk"><input type="radio" name="confirmed" value="yes" /> {t("El banco ya muestra el débito", "The bank already shows the debit")}</label>
                <label className="chk"><input type="radio" name="confirmed" value="no" defaultChecked /> {t("Enviado, aún sin confirmar", "Sent, not confirmed yet")}</label>
                <button type="submit" className="wide">{t("Registrar ejecución", "Record execution")}</button>
              </form>
            ) : <p className="small">{t("Lo ejecuta Tesorería (Gerencia o Administración).", "Treasury executes it (Management or Admin).")}</p>)}
            {(p.state === "SENT" || p.state === "UNCERTAIN") && openExec && (
              <div className="qa-form">
                <p className="small">{p.state === "SENT" ? t("Enviado, no pagado. Concilia con el extracto o la confirmación del proveedor.", "Sent, not paid. Reconcile with the statement or the supplier's confirmation.") : t("Concilia antes de cualquier reintento.", "Reconcile before any retry.")}</p>
                {manager && (
                  <form action={reconcileExecution.bind(null, openExec.id, "CONFIRMED")} className="qa-form">
                    <label>{t("Evidencia", "Evidence")}<input name="evidence" required maxLength={300} placeholder={t("Ej.: extracto del 5 nov, débito ref. …", "E.g.: Nov 5 statement, debit ref. …")} /></label>
                    <button type="submit" className="wide">{t("Confirmar: el dinero salió", "Confirm: the money left")}</button>
                  </form>
                )}
                <div className="qa-bar">
                  {manager && (
                    <details className="qa"><summary className="qa-btn">{t("No salió / fue devuelto", "Didn't leave / returned")}</summary><div className="qa-pop wide">
                      <form action={reconcileExecution.bind(null, openExec.id, "FAILED")} className="qa-form"><label>{t("Evidencia", "Evidence")}<input name="evidence" required maxLength={300} /></label><button type="submit" className="secondary">{t("Registrar", "Record")}</button></form>
                    </div></details>
                  )}
                  {p.state === "SENT" && (
                    <details className="qa"><summary className="qa-btn">{t("Marcar incierto", "Mark uncertain")}</summary><div className="qa-pop wide">
                      <form action={markUncertain.bind(null, openExec.id)} className="qa-form"><label>{t("¿Qué pasó?", "What happened?")}<input name="note" required maxLength={300} placeholder={t("Ej.: el proveedor dice que no le llegó", "E.g.: supplier says it hasn't arrived")} /></label><button type="submit" className="secondary">{t("Marcar", "Mark")}</button></form>
                    </div></details>
                  )}
                </div>
              </div>
            )}
            {p.state === "DONE" && confirmed && <p className="small"><span className="sig ok">✓ {t("Pagado · confirmado", "Paid · confirmed")}</span><span className="src block">{confirmed.resolvedByName} · {confirmed.evidence}</span></p>}
          </div>
          <p className="note ai">{t("SOLU compara y detiene; nunca cambia datos bancarios, aprueba ni marca pagado por su cuenta.", "SOLU compares and stops; it never changes bank data, approves or marks paid on its own.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
