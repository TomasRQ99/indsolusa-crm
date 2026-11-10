import Link from "next/link";
import { readinessForSpo } from "@/lib/pr";
import { SpoBuying } from "@/components/SpoBuying";
import { SpoCommitments } from "@/components/SpoCommitments";
import { SpoFreight } from "@/components/SpoFreight";
import { fullReadiness } from "@/lib/pr-auth";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput } from "@/lib/domain";
import { paymentStateLabel } from "@/lib/labels";
import { buildSpo, spoInclude } from "@/lib/purchasing";
import { Popovers } from "@/components/Popovers";
import { newVersion, releaseSpo, requestPayment, saveDraft } from "../actions";
import { lineAmount } from "@/lib/money";

export default async function SupplierPoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const spo = await db.supplierPO.findUnique({ where: { id }, include: spoInclude });
  if (!spo) notFound();
  const B = buildSpo(spo, i);
  const prBase = await readinessForSpo(spo.id);
  const prRead = prBase ? { pr: prBase.pr, readiness: (await fullReadiness(prBase.pr)).readiness } : null;
  const d = spo.deal;
  const s = spo.supplier;
  const editable = canEditOps(user, d.ownerId);
  const cur = spo.currency;
  const m = (v: number | string | { toString(): string }) => `${cur} ${i.n2(v)}`;
  const acct = d.account.name.replace(/ \(ejemplo\)$/, "");
  const history = (spo.history as { version: number; amount: number; reason: string; releasedAt: string }[] | null) ?? [];

  const okMsg: Record<string, string> = {
    correo: t("Correo enviado al proveedor desde la cuenta de la empresa.", "Email sent to the supplier from the company account."),
    preparada: t("Supplier PO preparada desde la cotización y el requerimiento de compra. Revisa y libera.", "Supplier PO prepared from the quote and the purchase requirement. Review and release."),
    guardada: t("Borrador actualizado.", "Draft updated."),
    liberada: t("Supplier PO liberada. Sus términos ya no se editan; los pagos siguen sus hitos.", "Supplier PO released. Its terms are no longer edited; payments follow its milestones."),
    "ya-liberada": t("Ya estaba liberada; no se repitió.", "It was already released; nothing repeated."),
    version: t("Nueva versión en preparación. La anterior queda en el historial.", "New version in preparation. The previous one stays in the history."),
  };
  const errMsg: Record<string, string> = {
    precondicion: t("No se liberó: hay condiciones sin cumplir.", "Not released: conditions are not met."),
    borrador: t("Primero libera la orden.", "Release the order first."), como: t("Escribe cómo se envió.", "Write how it was sent."), "sin-enviar": t("Primero marca la orden como enviada.", "Mark the order as sent first."),
    fuente: t("Escribe de dónde sale la confirmación.", "Write where the confirmation comes from."), resolucion: t("Escribe cómo se resuelven las diferencias.", "Write how the differences are resolved."),
    cotizacion: t("Indica el valor de la primera cotización.", "Give the first quote amount."),
    tipo: t("Elige el tipo de pedido.", "Choose the kind of order."),
    "flete-primero": t("Primero guarda los datos del flete.", "Save the freight data first."), "flete-opcion": t("Una opción necesita transportador, costo y de dónde sale la tarifa.", "An option needs a carrier, a cost and where the rate comes from."),
    "flete-motivo": t("Esa opción no es la más barata o no protege la promesa: escribe por qué se elige.", "That option isn't the cheapest or doesn't protect the promise: write why it is chosen."), compromiso: t("Un compromiso necesita su fecha y de dónde sale.", "A commitment needs its date and where it comes from."),
    evidencia: t("Escribe la evidencia de que ocurrió.", "Write the evidence that it happened."), ocurrido: t("Ese hito ya ocurrió.", "That milestone already happened."),
    ahorro: t("Un ahorro necesita tipo, valor final, base y evidencia.", "A saving needs a kind, final amount, baseline and evidence."),
    "ahorro-monto": t("No hay ahorro: el valor final no es menor que la base, o lo que pasó al cliente supera el ahorro.", "There is no saving: the final amount isn't below the baseline, or what was passed to the customer exceeds the saving."),
    requerimiento: t("No se liberó: el requerimiento de compra tiene puntos por resolver (por ejemplo, una autorización pendiente).", "Not released: the purchase requirement has open points (for example, a pending authorization)."),
    liberada: t("Está liberada: para cambiarla crea una nueva versión.", "It's released: to change it create a new version."),
    "no-liberada": t("Primero se libera la Supplier PO; después se pide el pago.", "Release the supplier PO first; then request payment."),
    motivo: t("Escribe por qué cambia.", "Write why it changes."),
  };

  const QA = ({ label, children, wide, right }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; right?: boolean }) => (
    <details className="qa"><summary className="qa-btn">{label}</summary><div className={`qa-pop${wide ? " wide" : ""}${right ? " right" : ""}`}>{children}</div></details>
  );
  const stage = (st: string) => {
    const order = ["REQUIRED", "VERIFY", "APPROVE", "EXECUTE", "SENT", "UNCERTAIN", "DONE"];
    const n = order.indexOf(st);
    const steps = [
      { k: t("Requerido", "Required"), done: true },
      { k: t("Solicitado", "Requested"), done: n >= 1 },
      { k: t("Aprobado", "Approved"), done: n >= 3 },
      { k: t("Enviado al banco", "Sent to bank"), done: n >= 4, warn: st === "UNCERTAIN" },
      { k: t("Pagado (confirmado)", "Paid (confirmed)"), done: n === 6 },
    ];
    return <ol className="pay-steps">{steps.map((x, k) => <li key={k} className={`${x.done ? "done" : ""}${x.warn ? " warn" : ""}`}>{x.k}</li>)}</ol>;
  };

  return (
    <div className="jw qv spo">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=execute`}>{d.code ?? "Journey"}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{spo.code} · v{spo.version}</span>
          <span className="grow" />
          {B.released && !spo.shippedAt && <Link className="btn secondary" href={`/correo/nuevo?tpl=DELIVERY&id=${spo.id}`}>{t("Pedir fecha de despacho", "Ask for ship date")}</Link>}
        </div>
        <div className="jh-title">
          <h1>Supplier PO · {s.name}</h1>
          {B.released ? <span className="sig ok">{t(`Liberada v${spo.version} · ${i.day(spo.releasedAt)}`, `Released v${spo.version} · ${i.day(spo.releasedAt)}`)}</span> : <span className="sig dash">{t(`Borrador v${spo.version}`, `Draft v${spo.version}`)}</span>}
        </div>
        <p className="jh-sub">{m(B.total)} · {spo.terms ?? s.paymentTerms ?? "—"}{spo.proformaRef ? ` · ${spo.proformaRef}` : ""}</p>
        {prRead && <p className="small">{t("Requerimiento", "Requirement")} <Link href={`/compras/requerimientos/${prRead.pr.id}`}>{prRead.pr.code}</Link> · <span className={`sig ${prRead.readiness.result === "NEEDS_RESOLUTION" ? "attn" : "ok"}`}>{prRead.readiness.result === "NEEDS_RESOLUTION" ? t("Falta resolver", "Needs resolution") : prRead.readiness.result === "READY_WITH_APPROVED_EXCEPTION" ? t("Listo, con autorización", "Ready, with authorization") : t("Listo para comprar", "Ready to purchase")}</span>{prRead.readiness.blockers[0] && <span className="muted"> · {t(prRead.readiness.blockers[0].blocker.es, prRead.readiness.blockers[0].blocker.en)}</span>}</p>}
      </header>

      {/* Why this money must move */}
      <section className="spo-why">
        <div><span className="k">Journey</span><b><Link href={`/deals/${d.id}`}>{d.code}</Link> · {d.title}</b><span className="src">{acct}{d.customerPo ? ` · OC ${d.customerPo}` : ""}</span></div>
        <div><span className="k">{t("Se compra", "Buying")}</span><b>{spo.lines.map((l) => `${l.qty} × ${l.code ?? l.description}`).join(" · ")}</b><span className="src">{t("a", "from")} {s.name}</span></div>
        <div className="prom"><span className="k">{t("Promesa que protege", "Promise it protects")}</span><b>{d.promiseText ?? "—"}</b><span className="mono">{i.dateShort(d.promisedDate)}</span>{B.pr.atDestinationBy && <span className="src">{B.pr.clearance ? t(`Debe estar en destino el ${i.day(B.pr.atDestinationBy)} (+${B.pr.clearance} aduana +1 entrega)`, `Must be at destination by ${i.day(B.pr.atDestinationBy)} (+${B.pr.clearance} customs +1 delivery)`) : t(`Debe estar en destino el ${i.day(B.pr.atDestinationBy)} (proveedor nacional: +1 entrega)`, `Must be at destination by ${i.day(B.pr.atDestinationBy)} (domestic supplier: +1 delivery)`)}</span>}</div>
      </section>

      <div className="jbody">
        <div className="jmain">
          {/* Purchase Requirement */}
          <section className="jblock">
            <div className="jbh"><b>{t("REQUERIMIENTO DE COMPRA", "PURCHASE REQUIREMENT")}</b><span className="grow" /><span className="src">{t("Derivado del Journey; nadie lo digita", "Derived from the Journey; nobody types it")}</span></div>
            <dl className="qv-dl">
              <dt>{t("Qué", "What")}</dt><dd>{B.pr.lines.map((l, k) => <span key={k} className="block">{l.qty} × <span className="mono">{l.code ?? ""}</span> {l.description}</span>)}</dd>
              <dt>{t("Base de suministro", "Supply basis")}</dt><dd>{B.pr.supply ?? "—"}{B.pr.supplyAlt && <span className="src block">{t("Alternativa", "Alternative")}: {B.pr.supplyAlt}</span>}</dd>
              <dt>{t("Costo cotizado", "Quoted cost")}</dt><dd className="mono">{B.pr.targetCost != null ? `${B.pr.currency} ${i.n2(B.pr.targetCost)}` : "—"}{B.pr.costSource && <span className="src block">{B.pr.costSource}{B.pr.quote ? ` · Quote ${B.pr.quote.number}${B.pr.quote.rev ? ` Rev. ${B.pr.quote.rev}` : ""}` : ""}</span>}</dd>
              <dt>{t("En destino a más tardar", "At destination by")}</dt><dd>{i.date(B.pr.atDestinationBy)}</dd>
            </dl>
          </section>

          {/* Supplier PO document */}
          <section className="jblock">
            <div className="jbh"><b>SUPPLIER PO</b><span>v{spo.version}</span><span className="grow" />
              {editable && B.released && (
                <QA label={t("Crear nueva versión", "Create new version")} wide right>
                  <form action={newVersion.bind(null, spo.id)} className="qa-form">
                    <p className="src">{t("Los términos liberados no se editan. La versión actual queda en el historial y la nueva debe liberarse otra vez.", "Released terms are not edited. The current version stays in the history and the new one must be released again.")}</p>
                    <label>{t("¿Por qué cambia?", "Why does it change?")}<input name="reason" required maxLength={300} /></label>
                    <button type="submit" className="secondary">{t("Crear versión", "Create version")} {spo.version + 1}</button>
                  </form>
                </QA>
              )}
            </div>
            <form action={saveDraft.bind(null, spo.id)} id="spo-draft">
              <div className="tscroll">
                <table>
                  <thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th><th className="n">{t("Costo unit.", "Unit cost")}</th><th className="n">Total</th></tr></thead>
                  <tbody>
                    {spo.lines.map((l, n) => (
                      <tr key={l.id}>
                        <td className="val">{l.qty}</td><td className="mono small">{l.code ?? "—"}</td><td>{l.description}</td>
                        <td className="n val">{!B.released && editable ? <input name={`cost_${n}`} type="number" step="0.01" min="0" defaultValue={Number(l.unitCost)} style={{ width: 110, textAlign: "right" }} aria-label={t("Costo unitario", "Unit cost")} /> : i.n2(l.unitCost)}</td>
                        <td className="n val">{i.n2(lineAmount(l.qty, l.unitCost))}</td>
                      </tr>
                    ))}
                    <tr className="tot"><td colSpan={4}><b>Total</b></td><td className="n val"><b>{m(B.total)}</b></td></tr>
                  </tbody>
                </table>
              </div>
              <dl className="qv-dl" style={{ marginTop: 12 }}>
                <dt>{t("Despacho pedido", "Requested dispatch")}</dt>
                <dd>{!B.released && editable ? <input name="shipBy" type="date" defaultValue={dayInput(spo.shipBy)} /> : i.date(spo.shipBy)}{s.transitDays != null && <span className="src block">{t(`Tránsito ${s.transitDays} días → llega ${i.day(B.arrival)}`, `Transit ${s.transitDays} days → arrives ${i.day(B.arrival)}`)}</span>}</dd>
                <dt>{t("Términos", "Terms")}</dt><dd>{spo.terms ?? s.paymentTerms ?? "—"}</dd>
                <dt>{t("Documento del proveedor", "Supplier document")}</dt><dd>{!B.released && editable ? <input name="proformaRef" defaultValue={spo.proformaRef ?? ""} maxLength={120} /> : spo.proformaRef ?? "—"}</dd>
                {(!B.released || spo.costNote) && <><dt>{t("Nota de costo", "Cost note")}</dt><dd>{!B.released && editable ? <input name="costNote" defaultValue={spo.costNote ?? ""} maxLength={300} placeholder={t("Solo si el costo difiere de la cotización", "Only if cost differs from the quote")} /> : spo.costNote}</dd></>}
              </dl>
              {!B.released && editable && <button type="submit" className="secondary" style={{ marginTop: 10 }}>{t("Guardar borrador", "Save draft")}</button>}
            </form>
            {history.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary className="small">{t("Versiones anteriores", "Previous versions")} ({history.length})</summary>
                <ul className="plain">{history.map((h) => <li key={h.version}>v{h.version} · {m(h.amount)} · {h.reason}</li>)}</ul>
              </details>
            )}
          </section>

          {/* Payment plan */}
          <section className="jblock">
            <div className="jbh"><b>{t("PLAN DE PAGO", "PAYMENT PLAN")}</b><span className="grow" /><span className="src">{t("Pagado (confirmado)", "Paid (confirmed)")} {m(B.paidTotal)} / {m(B.total)}</span></div>
            <div className="pay-plan">
              {B.plan.map(({ r, live, st, late }) => {
                const lab = st === "REQUIRED" ? null : paymentStateLabel(i, st);
                return (
                  <div key={r.id} className={`pay-ms${st === "DONE" ? " paid" : ""}${st === "VERIFY" || st === "UNCERTAIN" ? " stop" : ""}`}>
                    <div className="h">
                      <b>{r.label}</b><span className="mono">{m(r.amount)}</span><span className="src">{r.percent} %</span><span className="grow" />
                      {lab ? <span className={`sig ${lab.cls}`}>{lab.text}</span> : <span className="sig wait">{t("Requerido · sin solicitud", "Required · no request")}</span>}
                    </div>
                    <p className="src">{r.trigger}{r.dueBy ? ` · ${t("pagar a más tardar", "pay by")} ${i.dateShort(r.dueBy)}` : ""}{late && <span className="risk-t"> · {t("vencido", "overdue")}</span>}</p>
                    {stage(st)}
                    <div className="qa-bar">
                      {live ? <Link className="qa-btn" href={`/administracion/pagos-proveedores/${live.id}`}>{t("Abrir en Tesorería", "Open in Treasury")}</Link>
                        : editable && B.released ? (
                          <form action={requestPayment.bind(null, r.id)} className="qa-row">
                            {cur !== "USD" && <input name="amountUsd" type="number" step="0.01" min="0" placeholder="≈ USD" aria-label="≈ USD" style={{ width: 110 }} />}
                            <button type="submit" className="qa-btn">{t("Solicitar este pago", "Request this payment")}</button>
                            <details className="qa">
                              <summary className="qa-btn">{t("¿La instrucción trae otro banco?", "Instruction shows another bank?")}</summary>
                              <div className="qa-pop wide">
                                <p className="src">{t("Cópialo tal como viene. SOLU lo comparará con el perfil verificado y detendrá el pago si difiere.", "Copy it exactly as written. SOLU will compare it with the verified profile and stop the payment if it differs.")}</p>
                                <label>{t("Beneficiario", "Beneficiary")}<input name="docBeneficiary" /></label>
                                <label>{t("Banco", "Bank")}<input name="docBankName" /></label>
                                <label>{t("Cuenta / IBAN", "Account / IBAN")}<input name="docAccount" /></label>
                                <label>SWIFT<input name="docSwift" /></label>
                                <label>{t("Documento de origen", "Source document")}<input name="docSource" placeholder={spo.proformaRef ?? ""} /></label>
                                <button type="submit" name="otherBank" value="1">{t("Solicitar con estos datos", "Request with this data")}</button>
                              </div>
                            </details>
                          </form>
                        ) : <span className="src">{B.released ? "" : t("Se solicita después de liberar", "Requested after release")}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="src" style={{ marginTop: 8 }}>{t("Aprobado no es pagado y enviado al banco tampoco: solo cuenta como pagado cuando el banco o el proveedor lo confirma.", "Approved isn't paid, and neither is sent to the bank: it only counts as paid once the bank or supplier confirms it.")}</p>
          </section>
          <SpoBuying spoId={spo.id} lang={i.es ? "ES" : "EN"} editable={editable} />
          <SpoCommitments spoId={spo.id} lang={i.es ? "ES" : "EN"} editable={editable} />
          <SpoFreight spoId={spo.id} lang={i.es ? "ES" : "EN"} editable={editable} />
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("LISTA PARA LIBERAR", "RELEASE READINESS")}</b><span className="grow" />{B.released ? <span className="sig ok">{t("Liberada", "Released")}</span> : B.blocking.length ? <span className="sig attn">{t(`${B.blocking.length} pendiente(s)`, `${B.blocking.length} open`)}</span> : <span className="sig ok">{t("Lista", "Ready")}</span>}</div>
            <ul className="qv-checks">
              {B.ready.map((c, k) => (
                <li key={k} className={c.ok ? "ok" : c.info ? "no info" : "no"}><span className="ic" aria-hidden>{c.ok ? "✓" : c.info ? "i" : "!"}</span><span>{c.text}{!c.ok && c.fix && <span className="src block">{c.fix}</span>}</span></li>
              ))}
            </ul>
            {!B.released && editable && (
              <form action={releaseSpo.bind(null, spo.id)} style={{ marginTop: 12 }}>
                <button type="submit" className="wide" disabled={B.blocking.length > 0}>{t("Liberar Supplier PO", "Release Supplier PO")} v{spo.version}</button>
                <span className="src block" style={{ marginTop: 6 }}>{t("Al liberarla, sus términos quedan fijos y los hitos de pago se pueden solicitar.", "Once released, its terms are fixed and payment milestones can be requested.")}</span>
              </form>
            )}
            {B.released && <p className="small" style={{ marginTop: 10 }}>{t("Liberada por", "Released by")} <b>{spo.releasedByName ?? "—"}</b> · {i.date(spo.releasedAt)}</p>}
          </div>
          <div>
            <div className="jbh"><b>{t("PROVEEDOR", "SUPPLIER")}</b></div>
            <dl className="qv-dl tight">
              <dt>{t("Banco", "Bank")}</dt><dd>{s.bankVerifiedAt ? <span className="ok-t">✓ {t("Perfil verificado", "Verified profile")} · {i.day(s.bankVerifiedAt)}</span> : <span className="attn-t">{t("Sin verificar", "Not verified")}</span>}</dd>
              <dt>{t("Teléfono", "Phone")}</dt><dd className="mono">{s.phone ?? "—"}</dd>
              <dt>{t("Términos", "Terms")}</dt><dd>{s.paymentTerms ?? "—"}</dd>
            </dl>
          </div>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
