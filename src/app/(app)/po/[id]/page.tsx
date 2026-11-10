import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { addDays, daysBetween } from "@/lib/domain";
import { quoteNo } from "@/lib/quote";
import { quoteFloor } from "@/lib/esagara-gate";
import { buildPo, poInclude } from "@/lib/po";
import { Popovers } from "@/components/Popovers";
import { acceptPo, ackCondition, addAllocation, chooseResolution, confirmResolution, rejectPo, removeAllocation, revalidateSupply, savePoTerms, withdrawResolution } from "../actions";
import { acceptCtx } from "@/lib/po-accept";
import { saleOf } from "@/lib/quote";
import { lineAmount } from "@/lib/money";

export default async function PoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const po = await db.customerPO.findUnique({ where: { id }, include: poInclude });
  if (!po) notFound();
  const policy = await quoteFloor(po.quoteId);
  const ctx = await acceptCtx(po);
  const B = buildPo(po, i, policy.floorPct, ctx);
  const [allocs, siblings, dispatch] = await Promise.all([
    db.poAllocation.findMany({ where: { poId: po.id }, orderBy: { createdAt: "asc" }, include: { deal: { select: { id: true, code: true, title: true } } } }),
    db.deal.findMany({ where: { accountId: po.deal.accountId, id: { not: po.dealId }, stage: { not: "LOST" } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, code: true, title: true } }),
    db.dispatchInstruction.findFirst({ where: { poId: po.id, supersededAt: null }, select: { version: true, issuedAt: true } }),
  ]);
  const poTotal = saleOf(po.lines);
  const allocated = allocs.reduce((x, a) => x + Number(a.amount), 0);
  const IMPACT: Record<string, [string, string]> = { TECHNICAL: ["Técnico", "Technical"], COMMERCIAL: ["Comercial", "Commercial"], ECONOMIC: ["Económico", "Economic"], OPERATIONAL: ["Operativo", "Operational"], LEGAL: ["Legal", "Legal"] };
  const KIND: Record<string, [string, string]> = { MATCH: ["Coincide", "Match"], DIFFERENCE: ["Diferencia", "Difference"], MISSING: ["Falta", "Missing"], NEW_CONDITION: ["Condición nueva", "New condition"] };
  const IVA_L: Record<string, [string, string]> = { NOT_STATED: ["No indica", "Not stated"], INCLUDED: ["Precio con IVA incluido", "Price includes VAT"], ADDED: ["IVA se suma", "VAT added"], EXEMPT: ["Exento", "Exempt"] };
  const d = po.deal;
  const q = po.quote;
  const editable = canEdit(user, d.ownerId);
  const open = !B.accepted && !B.rejected;
  const money = (v: number) => `USD ${i.n2(v)}`;
  const acc = po.acceptance;
  const snap = acc?.snapshot as { effects?: string[] } | undefined;

  const okMsg: Record<string, string> = {
    registrada: t("PO registrada tal como llegó. SOLU la comparó con la cotización.", "PO recorded as received. SOLU compared it with the quote."),
    elegida: t("Opción elegida. Falta su confirmación para habilitar «Aceptar PO».", "Option chosen. It needs its confirmation to enable “Accept PO”."),
    confirmada: t("Resolución confirmada con evidencia.", "Resolution confirmed with evidence."),
    retirada: t("Opción retirada.", "Option withdrawn."),
    aceptada: t("Command ejecutado: PO aceptada. La promesa quedó protegida en el Journey.", "Command executed: PO accepted. The promise is protected on the Journey."),
    "ya-aceptada": t("Esta PO ya había sido aceptada; no se repitió nada.", "This PO was already accepted; nothing was repeated."),
    duplicada: t("Esta PO ya estaba registrada: es la misma, no se creó otra.", "This PO was already recorded: it's the same one, no other was created."),
    terminos: t("Condiciones de la PO guardadas. SOLU volvió a comparar.", "PO terms saved. SOLU compared again."),
    condicion: t("Condición revisada y aceptada con su nota.", "Condition reviewed and accepted with its note."),
    revalidado: t("Stock y precio revalidados con su evidencia (válido 7 días).", "Stock and price re-confirmed with evidence (valid 7 days)."),
    asignada: t("Asignaciones actualizadas.", "Allocations updated."),
    rechazada: t("Registrado: esta PO no se acepta.", "Recorded: this PO is not accepted."),
  };
  const errMsg: Record<string, string> = {
    precondicion: t("El command no se ejecutó: hay precondiciones sin cumplir.", "The command did not run: preconditions are not met."),
    evidencia: t("Escribe la evidencia: quién confirmó qué y dónde.", "Write the evidence: who confirmed what, and where."),
    motivo: t("Escribe el motivo.", "Write the reason."),
    cerrada: t("Esta PO ya fue decidida.", "This PO was already decided."),
    opcion: t("Esa opción ya no aplica.", "That option no longer applies."),
    nota: t("Escribe por qué se acepta esa condición.", "Write why that condition is accepted."),
    asignacion: t("Elige otro Journey del mismo cliente y un monto mayor que cero.", "Pick another Journey of the same customer and an amount above zero."),
    excede: t("Las asignaciones superarían el total de la PO.", "Allocations would exceed the PO total."),
  };

  const QA = ({ label, children, wide, right }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; right?: boolean }) => (
    <details className="qa">
      <summary className="qa-btn">{label}</summary>
      <div className={`qa-pop${wide ? " wide" : ""}${right ? " right" : ""}`}>{children}</div>
    </details>
  );
  const stateSig = (s: "match" | "minor" | "material") =>
    s === "material" ? <span className="sig risk">{t("Diferencia material", "Material difference")}</span> : s === "minor" ? <span className="sig wait">{t("No material", "Not material")}</span> : <span className="sig ok">✓ {t("Coincide", "Matches")}</span>;

  // Date strip: PO received → PO demands → quote protects.
  const DateStrip = () => {
    if (!B.protectedDate || !po.requiredBy) return null;
    const end = addDays(B.protectedDate, 2);
    const span = Math.max(4, daysBetween(B.base, end));
    const pos = (x: Date) => `${(daysBetween(B.base, x) / span) * 100}%`;
    const fast = B.options.find((o) => o.meetsPo);
    return (
      <div className="po-strip">
        <div className="po-track">
          <span className="gap" style={{ left: pos(po.requiredBy), width: `calc(${pos(B.protectedDate)} - ${pos(po.requiredBy)})` }} />
          <span className="mk rec" style={{ left: 0 }}><i>{t("PO recibida", "PO received")}<br /><b>{i.day(B.base)}</b></i></span>
          <span className="mk req" style={{ left: pos(po.requiredBy) }}><i>{t("La PO exige", "PO demands")}<br /><b>{i.day(po.requiredBy)}</b></i></span>
          <span className="mk prot" style={{ left: pos(B.protectedDate) }}><i>{t("La cotización protege", "Quote protects")}<br /><b>{i.day(B.protectedDate)}</b></i></span>
          {fast && <span className="mk fast" style={{ left: pos(fast.promiseDate) }} title={`${fast.scenarioLabel} · ${i.day(fast.promiseDate)}`} />}
        </div>
        <p className="src">{t(`Brecha de ${B.dateGap} día(s) sin respaldo de proveedor ni de plazo.`, `${B.dateGap}-day gap with no supplier or lead-time backing.`)}{fast ? t(` Con «${fast.scenarioLabel}» llegaría el ${i.day(fast.promiseDate)} (rombo).`, ` With "${fast.scenarioLabel}" it would arrive ${i.day(fast.promiseDate)} (diamond).`) : ""}</p>
      </div>
    );
  };

  return (
    <div className="jw qv po">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}`}>{d.code ?? "Journey"}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">PO {po.number}</span>
          <span className="grow" />
          {q && <div className="jh-act"><Link className="qa-btn" href={`/cotizaciones/${q.id}`}>{t("Ver cotización", "View quote")} {quoteNo(q)}</Link></div>}
        </div>
        <div className="jh-title">
          <h1>{t("PO recibida", "PO received")} · {d.title}</h1>
          {B.accepted ? <span className="sig ok">{t(`Aceptada ${i.day(acc!.acceptedAt)}`, `Accepted ${i.day(acc!.acceptedAt)}`)}</span>
            : B.rejected ? <span className="sig wait">{t("No aceptada", "Not accepted")}</span>
            : <span className="sig attn">{t("Sin aceptar", "Not accepted yet")}</span>}
        </div>
        <p className="jh-sub">{t("Recibida", "Received")} {i.date(B.base)}{po.source ? ` · ${po.source}` : ""} · {t("comparada con", "compared with")} {q ? `Quote Nº ${quoteNo(q)}` : t("ninguna cotización", "no quote")}{q?.presentedAt ? ` (${t("presentada", "presented")} ${i.day(q.presentedAt)})` : ""}</p>
      </header>

      {/* Impact first: what accepting would do today */}
      {open && B.material.length > 0 && (
        <section className="po-impact">
          <span className="k">{t(`${B.material.length} DIFERENCIA(S) MATERIAL(ES)`, `${B.material.length} MATERIAL DIFFERENCE(S)`)}</span>
          <b>{t("Aceptar hoy crearía un compromiso que no podemos proteger.", "Accepting today would create a commitment we cannot protect.")}</b>
          {B.dateMaterial && B.protectedDate && po.requiredBy && (
            <p>{t(
              `La PO exige entrega el ${i.date(po.requiredBy)}. La cotización ${quoteNo(q!)} protegía el ${i.date(B.protectedDate)} (${q!.leadMinDays}–${q!.leadMaxDays} días después de la PO, con ${q!.supplyPrimary ?? "el suministro cotizado"}). Si aceptamos así, prometemos ${B.dateGap} día(s) que ni el proveedor ni el transporte respaldan, y el incumplimiento cae sobre la línea de ${d.account.name.replace(/ \(ejemplo\)$/, "")}.`,
              `The PO demands delivery on ${i.date(po.requiredBy)}. Quote ${quoteNo(q!)} protected ${i.date(B.protectedDate)} (${q!.leadMinDays}–${q!.leadMaxDays} days after PO, with ${q!.supplyPrimary ?? "the quoted supply"}). Accepting as is promises ${B.dateGap} day(s) that neither supplier nor transport back, and the miss lands on ${d.account.name.replace(/ \(ejemplo\)$/, "")}'s line.`,
            )}</p>
          )}
          <DateStrip />
        </section>
      )}
      {open && B.material.length === 0 && (
        <section className="po-impact okk"><span className="k">{t("SIN DIFERENCIAS MATERIALES", "NO MATERIAL DIFFERENCES")}</span><b>{t("La PO pide lo que la cotización puede proteger.", "The PO asks for what the quote can protect.")}</b></section>
      )}
      {B.accepted && acc && (
        <section className="po-impact okk">
          <span className="k">{t("COMMAND EJECUTADO · ACEPTAR PO", "COMMAND EXECUTED · ACCEPT PO")}</span>
          <b>{t(`Promesa protegida: entrega el ${i.date(acc.promiseDate)}`, `Protected promise: delivery on ${i.date(acc.promiseDate)}`)}</b>
          <p>{t(`Ejecutado por ${acc.acceptedByName} el ${i.date(acc.acceptedAt)}. Este registro no se edita.`, `Executed by ${acc.acceptedByName} on ${i.date(acc.acceptedAt)}. This record is not edited.`)}</p>
          {snap?.effects && <ul className="po-effects">{snap.effects.map((e, k) => <li key={k}>{e}</li>)}</ul>}
        </section>
      )}
      {B.rejected && <section className="po-impact"><span className="k">{t("NO ACEPTADA", "NOT ACCEPTED")}</span><b>{po.rejectReason}</b><p>{po.rejectedByName} · {i.date(po.rejectedAt)}</p></section>}

      <div className="jbody">
        <div className="jmain">
          {/* Comparison */}
          <section className="jblock">
            <div className="jbh"><b>{t("PO VS COTIZACIÓN", "PO VS QUOTE")}</b><span className="grow" /><span className="src">{t("Material = cambia lo que prometemos, cuesta o cobramos", "Material = changes what we promise, spend or collect")}</span></div>
            <div className="tscroll">
              <table className="po-cmp">
                <thead><tr><th>{t("Campo", "Field")}</th><th>{q ? `Quote ${quoteNo(q)}` : t("Cotización", "Quote")}</th><th>PO {po.number}</th><th>{t("Estado", "State")}</th><th>{t("Impacto", "Impact")}</th></tr></thead>
                <tbody>
                  {[...B.diffs].sort((a, b) => ({ material: 0, minor: 1, match: 2 })[a.state] - ({ material: 0, minor: 1, match: 2 })[b.state]).map((x) => (
                    <tr key={x.key} className={x.state}>
                      <td><b>{x.label}</b>{x.note && <span className="src block">{x.note}</span>}</td>
                      <td>{x.quote}</td>
                      <td className="pov">{x.po}</td>
                      <td>{stateSig(x.state)}{x.kind && x.kind !== "MATCH" && <span className="src block">{t(KIND[x.kind][0], KIND[x.kind][1])}</span>}
                        {open && editable && x.ackable && (
                          <QA label={t("Aceptar con nota", "Accept with note")} wide right>
                            <form action={ackCondition.bind(null, po.id, x.key)} className="qa-form">
                              <label>{t("Por qué se acepta (queda en el registro)", "Why it's accepted (stays on record)")}<input name="note" required maxLength={300} placeholder={t("Ej.: certificado de origen lo emite el proveedor sin costo", "E.g.: the supplier issues the certificate of origin at no cost")} /></label>
                              <button type="submit">{t("Aceptar condición", "Accept condition")}</button>
                            </form>
                          </QA>
                        )}
                      </td>
                      <td className="small">{x.impact ? t(IMPACT[x.impact][0], IMPACT[x.impact][1]) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Resolution options */}
          {open && B.options.length > 0 && (
            <section className="jblock">
              <div className="jbh"><b>{t("OPCIONES PARA RESOLVER LA FECHA", "OPTIONS TO RESOLVE THE DATE")}</b><span className="grow" /><span className="src">{t("Elige una; «Aceptar PO» se habilita cuando esté confirmada", "Pick one; “Accept PO” is enabled once it's confirmed")}</span></div>
              <div className="po-opts">
                {B.options.map((o) => {
                  const mine = B.chosen?.option === o.option ? B.chosen : null;
                  return (
                    <div key={o.option} className={`po-opt${mine ? " on" : ""}${o.belowFloor ? " low" : ""}`}>
                      <div className="h">
                        <b>{o.title}</b>
                        {o.recommended && !mine && <span className="sig info">{t("SOLU recomienda", "SOLU recommends")}</span>}
                        {mine && <span className={`sig ${mine.state === "CONFIRMED" ? "ok" : "attn"}`}>{mine.state === "CONFIRMED" ? t("Confirmada", "Confirmed") : t("Elegida · falta confirmación", "Chosen · needs confirmation")}</span>}
                      </div>
                      <p>{o.what}</p>
                      <dl className="qv-dl tight2">
                        <dt>{t("Promesa", "Promise")}</dt><dd className="mono">{i.date(o.promiseDate)} {o.meetsPo ? <span className="ok-t">· {t("cumple la PO", "meets the PO")}</span> : <span className="attn-t">· {t("no cumple la PO", "doesn't meet the PO")}</span>}</dd>
                        <dt>Eságara</dt><dd className="mono">{money(o.esagra)} · {i.pct(o.pct)}{o.costDelta > 0 && o.priceDelta === 0 ? ` (−${money(o.costDelta)})` : ""}{o.belowFloor && <span className="risk-t"> · {t("bajo el umbral", "below threshold")}</span>}</dd>
                        <dt>{t("Quién actúa", "Who acts")}</dt><dd>{o.whoActs}</dd>
                        <dt>{t("Riesgo", "Risk")}</dt><dd>{o.risk}</dd>
                        <dt>{t("Para confirmarla", "To confirm it")}</dt><dd>{o.needs}</dd>
                      </dl>
                      {editable && !mine && (
                        <form action={chooseResolution.bind(null, po.id, o.option)}><button type="submit" className={o.recommended ? "" : "secondary"}>{t("Elegir esta opción", "Choose this option")}</button></form>
                      )}
                      {mine && (
                        <div className="po-steps">
                          {mine.message && mine.state === "REQUESTED" && (
                            <label className="small">{t("Mensaje para el cliente (cópialo y envíalo)", "Message for the customer (copy and send)")}<textarea readOnly rows={5} defaultValue={mine.message} /></label>
                          )}
                          {mine.state === "REQUESTED" && editable && (
                            <form action={confirmResolution.bind(null, po.id, mine.id)} className="qa-form">
                              <label>{t("Evidencia de la confirmación", "Confirmation evidence")}<input name="evidence" required maxLength={300} placeholder={o.option === "EXPEDITE_ABSORB" ? t("Ej.: Siemens Miami confirma aéreo hoy, correo 10:40", "E.g.: Siemens Miami confirms air today, email 10:40") : t("Ej.: Juan confirma por WhatsApp la nueva fecha", "E.g.: Juan confirms the new date on WhatsApp")} /></label>
                              <div className="qa-row">
                                <button type="submit">{t("Registrar confirmación", "Record confirmation")}</button>
                                <button type="submit" formAction={withdrawResolution.bind(null, po.id, mine.id)} formNoValidate className="link small">{t("Retirar", "Withdraw")}</button>
                              </div>
                            </form>
                          )}
                          {mine.state === "CONFIRMED" && <p className="src">{t("Confirmada por", "Confirmed by")} {mine.confirmedByName} · {mine.evidence}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="jblock">
            <div className="jbh"><b>{t("LA PO TAL COMO LLEGÓ", "THE PO AS RECEIVED")}</b><span className="grow" /><span className="src">{t("Registrada por", "Recorded by")} {po.createdByName}</span></div>
            <div className="tscroll">
              <table>
                <thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th className="n">Total</th></tr></thead>
                <tbody>{po.lines.map((l) => <tr key={l.id}><td className="val">{l.qty}</td><td className="mono small">{l.code ?? "—"}</td><td>{l.description}</td><td className="n val">{i.n2(l.unitPrice)}</td><td className="n val">{i.n2(lineAmount(l.qty, l.unitPrice))}</td></tr>)}</tbody>
              </table>
            </div>
            <dl className="qv-dl" style={{ marginTop: 10 }}>
              <dt>{t("Entrega exigida", "Required delivery")}</dt><dd>{i.date(po.requiredBy)}</dd>
              <dt>Incoterm</dt><dd>{po.incoterm ?? "—"}</dd>
              <dt>{t("Pago", "Payment")}</dt><dd>{po.paymentTerms ?? "—"}</dd>
              <dt>{t("Cita", "Cites")}</dt><dd>{po.quoteRef ?? "—"}</dd>
              <dt>{t("Razón social", "Legal entity")}</dt><dd>{po.legalEntity ?? "—"}{po.taxIdOnPo && <span className="src"> · {po.taxIdOnPo}</span>}</dd>
              <dt>IVA</dt><dd>{t(IVA_L[po.ivaMode ?? "NOT_STATED"][0], IVA_L[po.ivaMode ?? "NOT_STATED"][1])}</dd>
              {po.billTo && <><dt>{t("Facturar a", "Bill to")}</dt><dd className="pre">{po.billTo}</dd></>}
              {po.warranty && <><dt>{t("Garantía", "Warranty")}</dt><dd>{po.warranty}</dd></>}
              {po.documents && <><dt>{t("Documentos", "Documents")}</dt><dd>{po.documents}</dd></>}
              {po.penalties && <><dt>{t("Penalidades", "Penalties")}</dt><dd>{po.penalties}</dd></>}
              {po.otherConditions && <><dt>{t("Otras condiciones", "Other conditions")}</dt><dd>{po.otherConditions}</dd></>}
            </dl>
            {open && editable && (
              <details className="scp-add"><summary className="qa-btn">{t("Completar lo que dice la PO", "Complete what the PO says")}</summary>
                <form action={savePoTerms.bind(null, po.id)} className="qa-form">
                  <div className="qa-row"><label>{t("Razón social en la PO", "Legal entity on PO")}<input name="legalEntity" maxLength={160} defaultValue={po.legalEntity ?? ""} /></label><label>{t("NIT / Tax ID en la PO", "Tax ID on PO")}<input name="taxIdOnPo" maxLength={40} defaultValue={po.taxIdOnPo ?? ""} /></label></div>
                  <div className="qa-row"><label>IVA<select name="ivaMode" defaultValue={po.ivaMode ?? "NOT_STATED"}>{Object.entries(IVA_L).map(([k, v]) => <option key={k} value={k}>{t(v[0], v[1])}</option>)}</select></label><label>{t("Garantía exigida", "Warranty required")}<input name="warranty" maxLength={300} defaultValue={po.warranty ?? ""} /></label></div>
                  <label>{t("Facturar a", "Bill to")}<textarea name="billTo" rows={2} maxLength={300} defaultValue={po.billTo ?? ""} /></label>
                  <label>{t("Documentos exigidos (certificados, entrada de mercancía…)", "Documents required (certificates, goods receipt…)")}<input name="documents" maxLength={400} defaultValue={po.documents ?? ""} /></label>
                  <label>{t("Penalidades", "Penalties")}<input name="penalties" maxLength={400} defaultValue={po.penalties ?? ""} /></label>
                  <label>{t("Otras condiciones", "Other conditions")}<input name="otherConditions" maxLength={400} defaultValue={po.otherConditions ?? ""} /></label>
                  <button type="submit">{t("Guardar y comparar", "Save and compare")}</button>
                </form>
              </details>
            )}
          </section>
        </div>

        {/* Command panel */}
        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("COMMAND · ACEPTAR PO", "COMMAND · ACCEPT PO")}</b></div>
            <ul className="qv-checks">
              {B.pre.map((p, k) => (
                <li key={k} className={p.ok ? "ok" : "no"}><span className="ic" aria-hidden>{p.ok ? "✓" : "!"}</span><span>{p.text}</span></li>
              ))}
            </ul>
            {open && (
              <>
                <div className="po-will">
                  <span className="k">{t("Al ejecutarlo, SOLU", "When executed, SOLU")}</span>
                  <ul>
                    <li>{t("registra la aceptación (no se edita ni se repite)", "records the acceptance (not edited, not repeated)")}</li>
                    <li>{t(`acepta la cotización ${q ? quoteNo(q) : ""}`, `accepts quote ${q ? quoteNo(q) : ""}`)}</li>
                    <li>{t(`pone la OC ${po.number} en el Journey`, `puts PO ${po.number} on the Journey`)}</li>
                    <li>{B.canAccept && B.promiseDate ? t(`promete entrega el ${i.date(B.promiseDate)}`, `promises delivery on ${i.date(B.promiseDate)}`) : t("promete solo una fecha protegida", "promises only a protected date")}</li>
                    {B.chosen?.state === "CONFIRMED" && Number(B.chosen.costDelta) > 0 && <li>{t(`suma ${money(Number(B.chosen.costDelta))} al costo esperado`, `adds ${money(Number(B.chosen.costDelta))} to expected cost`)}</li>}
                    {B.chosen?.state === "CONFIRMED" && B.chosen.option === "EXPEDITE_CHARGE" && <li>{t(`suma ${money(Number(B.chosen.priceDelta))} a la venta`, `adds ${money(Number(B.chosen.priceDelta))} to the sale`)}</li>}
                  </ul>
                </div>
                {editable && (
                  <form action={acceptPo.bind(null, po.id)}>
                    <button type="submit" className="wide" disabled={!B.canAccept} aria-disabled={!B.canAccept}>{t("Aceptar PO", "Accept PO")}</button>
                  </form>
                )}
                {!B.canAccept && <p className="src" style={{ marginTop: 6 }}>{t("Se habilita cuando todas las precondiciones estén en verde.", "Enabled when every precondition is green.")}</p>}
              </>
            )}
            {B.accepted && acc && <p className="small">{t("Aceptada por", "Accepted by")} <b>{acc.acceptedByName}</b> · {i.date(acc.acceptedAt)}</p>}
            {open && editable && ctx.supply && !ctx.supply.ok && (
              <details className="scp-add" open><summary className="qa-btn">{t("Registrar que revalidé stock y precio", "Record that I re-confirmed stock and price")}</summary>
                <form action={revalidateSupply.bind(null, po.id)} className="qa-form">
                  <label>{t("Evidencia (quién confirmó y dónde)", "Evidence (who confirmed and where)")}<input name="evidence" required maxLength={300} placeholder={t("Ej.: Ana (distribuidor) confirma 3 en stock y mismo precio, correo de hoy 9:10", "E.g.: Ana (distributor) confirms 3 in stock, same price, email today 9:10")} /></label>
                  <button type="submit">{t("Registrar", "Record")}</button>
                </form>
              </details>
            )}
            {open && ctx.credit && !ctx.credit.ok && <p className="src" style={{ marginTop: 6 }}><Link href="/comercial/dinero">{t("Pedir revisión de cupo", "Request a credit review")}</Link> · {t("la deciden Finanzas o Gerencia", "Finance or Management decide")}</p>}
            {B.accepted && (
              <p style={{ marginTop: 10 }}><Link className="qa-btn" href={`/deals/${d.id}/despacho?po=${po.id}`}>{dispatch ? t(`Instrucción de despacho v${dispatch.version}`, `Dispatch instruction v${dispatch.version}`) : t("Emitir instrucción de despacho", "Issue dispatch instruction")}</Link></p>
            )}
          </div>
          <div>
            <div className="jbh"><b>{t("JOURNEYS QUE CUBRE", "JOURNEYS IT COVERS")}</b></div>
            <ul className="plain small">
              <li><b>{d.code ?? d.title}</b> · USD {i.n2(poTotal - allocated)} <span className="src">{t("(este Journey: lo no asignado)", "(this Journey: what isn't allocated)")}</span></li>
              {allocs.map((a) => (
                <li key={a.id}><Link href={`/deals/${a.deal.id}`}>{a.deal.code ?? a.deal.title}</Link> · USD {i.n2(Number(a.amount))}{a.lineRef && <span className="src"> · {a.lineRef}</span>}{a.note && <span className="src"> · {a.note}</span>}
                  {editable && <form action={removeAllocation.bind(null, po.id, a.id)} style={{ display: "inline" }}> <button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>}
                </li>
              ))}
            </ul>
            {editable && siblings.length > 0 && (
              <QA label={t("Asignar parte a otro Journey", "Allocate part to another Journey")} wide>
                <form action={addAllocation.bind(null, po.id)} className="qa-form">
                  <label>Journey<select name="dealId" required defaultValue="">{[<option key="" value="" disabled>—</option>, ...siblings.map((s) => <option key={s.id} value={s.id}>{s.code ? `${s.code} · ` : ""}{s.title}</option>)]}</select></label>
                  <div className="qa-row"><label>{t("Monto USD", "Amount USD")}<input name="amount" inputMode="decimal" required /></label><label>{t("Líneas", "Lines")}<input name="lineRef" maxLength={120} placeholder="DDA-30 × 1" /></label></div>
                  <label>{t("Por qué", "Why")}<input name="note" maxLength={300} /></label>
                  <button type="submit">{t("Asignar", "Allocate")}</button>
                </form>
              </QA>
            )}
          </div>
          {open && editable && (
            <div>
              <div className="jbh"><b>{t("SI NO SE PUEDE RESOLVER", "IF IT CAN'T BE RESOLVED")}</b></div>
              <QA label={t("No aceptar esta PO", "Don't accept this PO")} wide>
                <form action={rejectPo.bind(null, po.id)} className="qa-form">
                  <label>{t("Motivo (lo que se le dirá al cliente)", "Reason (what the customer will be told)")}<input name="reason" required maxLength={300} /></label>
                  <button type="submit" className="secondary">{t("Registrar", "Record")}</button>
                </form>
              </QA>
            </div>
          )}
          <div>
            <div className="jbh"><b>{t("QUIÉN DECIDE EN EL CLIENTE", "WHO DECIDES AT THE CUSTOMER")}</b></div>
            <p className="small">{q?.decisionPath ?? "—"}</p>
          </div>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
