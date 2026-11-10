import { db } from "@/lib/db";
import { today, dayInput } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { DEFAULT_WINDOW, DIFF_LABEL, SAVING_KINDS, SCOPE_STATES, WINDOW_TEXT, materialDiffs, negotiationWindow, opportunities, readDiffs, readScope, savingOf } from "@/lib/buying-rules";
import { addSaving, markOrderFact, recordConfirmation, resolveConfirmation, setFirstQuote } from "@/app/(app)/compras/actions";

// Operaciones O3 · on the Supplier PO: opportunities before buying (with their evidence), the order's separate facts,
// the supplier's confirmation compared with the order, and the savings ledger measured against the first quote.

export async function SpoBuying({ spoId, lang, editable }: { spoId: string; lang: "ES" | "EN"; editable: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const spo = await db.supplierPO.findUnique({
    where: { id: spoId },
    include: {
      lines: { orderBy: { position: "asc" } }, supplier: { select: { id: true, name: true, advancePct: true, paymentTerms: true } },
      confirmations: { orderBy: { createdAt: "desc" } }, savings: { orderBy: { at: "desc" } },
      deal: { select: { scopeLines: { where: { requiredForFunction: true, status: { not: "EXCLUDED" } }, orderBy: { position: "asc" }, select: { component: true, qty: true } } } },
    },
  });
  if (!spo) return null;
  const T = today();
  const codes = spo.lines.map((l) => l.code).filter((c): c is string => !!c);
  const [lastLines, offers, pastSavings, siblings] = await Promise.all([
    codes.length ? db.supplierPOLine.findMany({ where: { code: { in: codes }, supplierPoId: { not: spo.id }, supplierPo: { releasedAt: { not: null } } }, orderBy: { supplierPo: { releasedAt: "desc" } }, take: 30, select: { code: true, unitCost: true, supplierPo: { select: { releasedAt: true, supplier: { select: { name: true } } } } } }) : [],
    codes.length ? db.supplierOffer.findMany({ where: { supplierId: { not: spo.supplierId }, currency: spo.currency, OR: codes.map((c) => ({ codeAsQuoted: { equals: c, mode: "insensitive" as const } })) }, take: 20, select: { codeAsQuoted: true, unitPrice: true, createdAt: true, supplier: { select: { name: true } } } }) : [],
    db.savingsEntry.findMany({ where: { supplierId: spo.supplierId, supplierPoId: { not: spo.id } }, orderBy: { at: "desc" }, take: 3, select: { savingsAmount: true, at: true, kind: true } }),
    db.supplierPO.findMany({ where: { supplierId: spo.supplierId, releasedAt: null, id: { not: spo.id } }, select: { code: true } }),
  ]);
  const win = spo.releasedAt ? null : negotiationWindow(spo.shipBy, T, DEFAULT_WINDOW);
  const opps = spo.releasedAt ? [] : opportunities({
    unitNow: spo.lines.filter((l) => l.code).map((l) => ({ code: l.code!, cost: Number(l.unitCost) })),
    lastPurchases: lastLines.filter((l) => l.code && l.supplierPo.releasedAt).map((l) => ({ code: l.code!, cost: Number(l.unitCost), at: l.supplierPo.releasedAt!, supplier: l.supplierPo.supplier.name })),
    otherOffers: offers.map((o) => ({ code: codes.find((c) => c.toLowerCase() === o.codeAsQuoted.toLowerCase()) ?? o.codeAsQuoted, price: Number(o.unitPrice), supplier: o.supplier.name, at: o.createdAt })),
    pastSavings: pastSavings.map((s) => ({ amount: Number(s.savingsAmount), at: s.at, kind: s.kind })), siblingDrafts: siblings, advancePct: spo.supplier.advancePct, hasTerms: false,
  });
  const total = spo.lines.reduce((s, l) => s + l.qty * Number(l.unitCost), 0);
  const money = (v: unknown) => `${spo.currency} ${i.n2(v)}`;
  const conf = spo.confirmations[0] ?? null;
  const diffs = conf ? readDiffs(conf.diffs) : [];
  const pending = conf && !conf.resolvedAt ? materialDiffs(diffs) : [];
  const scopeRows = spo.deal.scopeLines;
  const vsFirst = spo.firstQuoteAmount != null ? savingOf(spo.firstQuoteAmount, total, 0) : null;
  const fact = (ok: boolean, label: string, detail: string | null) => <li className={ok ? "ok" : "no info"}><span className="ic" aria-hidden>{ok ? "✓" : "·"}</span><span><b>{label}</b>{detail && <span className="muted"> · {detail}</span>}</span></li>;

  return (
    <>
      {!spo.releasedAt && (
        <section className="jblock" id="antes">
          <div className="jbh"><b>{t("ANTES DE COMPRAR", "BEFORE BUYING")}</b><span className="grow" />{win && <span className={`sig ${WINDOW_TEXT[win].tone}`}>{t("Ventana para negociar", "Negotiation window")}: {t(WINDOW_TEXT[win].es, WINDOW_TEXT[win].en)}</span>}</div>
          {win && <p className="small">{t(WINDOW_TEXT[win].advice.es, WINDOW_TEXT[win].advice.en)}</p>}
          {opps.length === 0 ? <p className="small muted">{t("SOLU no ve una oportunidad concreta de comprar mejor con lo que tiene registrado.", "SOLU sees no concrete opportunity to buy better from what it has on record.")}</p> : <ul className="mk-ul">{opps.map((o) => <li key={o.key}>{t(o.text.es, o.text.en)}<span className="src block">{t(o.evidence.es, o.evidence.en)}</span></li>)}</ul>}
          {editable && (
            <form action={setFirstQuote.bind(null, spo.id)} className="qa-form" style={{ maxWidth: 640 }}>
              <div className="qa-row">
                <label style={{ flex: "0 0 200px" }}>{t(`Primera cotización del proveedor (${spo.currency})`, `Supplier's first quote (${spo.currency})`)}<input name="firstQuoteAmount" type="number" min={0} step="0.01" required defaultValue={spo.firstQuoteAmount != null ? Number(spo.firstQuoteAmount) : total} /></label>
                <label>{t("Referencia de esa cotización", "That quote's reference")}<input name="firstQuoteRef" maxLength={120} defaultValue={spo.firstQuoteRef ?? ""} /></label>
              </div>
              <label>{t("Qué se negoció (o por qué no)", "What was negotiated (or why not)")}<input name="negotiationNote" maxLength={300} defaultValue={spo.negotiationNote ?? ""} /></label>
              <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
              <span className="src block">{t("Todo ahorro con el proveedor se mide contra su primera cotización.", "Every supplier saving is measured against its first quote.")}</span>
            </form>
          )}
        </section>
      )}

      {spo.releasedAt && (
        <section className="jblock" id="hechos">
          <div className="jbh"><b>{t("HECHOS DE LA ORDEN", "ORDER FACTS")}</b><span className="grow" /><span className="src">{t("Enviada no es aceptada", "Sent is not accepted")}</span></div>
          <ul className="qv-checks">
            {fact(true, t("Autorizada y liberada", "Authorized and released"), `${i.day(spo.releasedAt)} · ${spo.releasedByName ?? "—"}`)}
            {fact(!!spo.sentAt, t("Enviada al proveedor", "Sent to the supplier"), spo.sentAt ? `${i.day(spo.sentAt)} · ${spo.sentHow} · ${spo.sentByName}` : null)}
            {fact(!!spo.ackAt, t("Recibida por el proveedor (acuse)", "Acknowledged by the supplier"), spo.ackAt ? `${i.day(spo.ackAt)}${spo.ackNote ? ` · ${spo.ackNote}` : ""}` : null)}
            {fact(!!spo.confirmedAt, t("Confirmada por el proveedor", "Confirmed by the supplier"), spo.confirmedAt ? i.day(spo.confirmedAt) : pending.length ? t(`${pending.length} diferencia(s) por resolver`, `${pending.length} difference(s) to resolve`) : null)}
          </ul>
          {editable && !spo.sentAt && <form action={markOrderFact.bind(null, spo.id, "sent")} className="qa-row"><input name="note" required maxLength={200} placeholder={t("Cómo se envió (correo a…, portal…)", "How it was sent (email to…, portal…)")} aria-label={t("Cómo se envió", "How it was sent")} style={{ flex: "1 1 220px" }} /><input name="at" type="date" defaultValue={dayInput(T)} aria-label={t("Fecha", "Date")} /><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Marcar enviada", "Mark sent")}</button></form>}
          {editable && spo.sentAt && !spo.ackAt && <form action={markOrderFact.bind(null, spo.id, "ack")} className="qa-row"><input name="note" maxLength={200} placeholder={t("Quién acusó recibo y cómo", "Who acknowledged and how")} aria-label={t("Acuse", "Acknowledgement")} style={{ flex: "1 1 220px" }} /><input name="at" type="date" defaultValue={dayInput(T)} aria-label={t("Fecha", "Date")} /><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Marcar acuse", "Mark acknowledged")}</button></form>}
        </section>
      )}

      {spo.releasedAt && (
        <section className="jblock" id="confirmacion">
          <div className="jbh"><b>{t("CONFIRMACIÓN DEL PROVEEDOR", "SUPPLIER CONFIRMATION")}</b><span className="grow" />{conf ? (conf.resolvedAt ? <span className="sig ok">{t("Confirmada", "Confirmed")}</span> : <span className="sig attn">{t("Con diferencias", "With differences")}</span>) : <span className="sig wait">{t("Sin registrar", "Not recorded")}</span>}</div>
          {conf && (
            <>
              <p className="src">{t(`Recibida el ${i.day(conf.receivedAt)} · ${conf.source} · contra la orden v${conf.poVersion} · ${conf.recordedByName}`, `Received ${i.day(conf.receivedAt)} · ${conf.source} · against order v${conf.poVersion} · ${conf.recordedByName}`)}</p>
              {diffs.length === 0 ? <p className="small">{t("Coincide con la orden en precio, cantidad, alcance, fecha y condiciones.", "It matches the order on price, quantity, scope, date and terms.")}</p> : (
                <div className="tscroll"><table>
                  <thead><tr><th>{t("Qué", "What")}</th><th>{t("Esperado (orden)", "Expected (order)")}</th><th>{t("Confirmado", "Confirmed")}</th><th className="n">{t("Impacto económico", "Economic impact")}</th><th>{t("Impacto al cliente", "Customer impact")}</th></tr></thead>
                  <tbody>{diffs.map((d, k) => <tr key={k}><td><b>{t(DIFF_LABEL[d.key]?.es ?? d.key, DIFF_LABEL[d.key]?.en ?? d.key)}</b>{d.material && <span className="sig risk" style={{ marginLeft: 6 }}>{t("material", "material")}</span>}</td><td className="small">{d.expected}</td><td className="small">{d.actual}</td><td className={`n mono${d.economicImpact != null && d.economicImpact < 0 ? " risk-t" : ""}`}>{d.economicImpact == null ? "—" : `${d.economicImpact > 0 ? "+" : ""}${i.n2(d.economicImpact)}`}</td><td className="small">{d.customerImpact ? t(d.customerImpact.es, d.customerImpact.en) : "—"}</td></tr>)}</tbody>
                </table></div>
              )}
              {readScope(conf.scope).length > 0 && <p className="small"><b>{t("Alcance confirmado", "Confirmed scope")}:</b> {readScope(conf.scope).map((s) => `${s.component}: ${t(SCOPE_STATES[s.state].es, SCOPE_STATES[s.state].en)}`).join(" · ")}</p>}
              {conf.resolvedAt ? <p className="small"><b>{t("Resolución", "Resolution")}:</b> {conf.resolution} · {conf.resolvedByName} · {i.day(conf.resolvedAt)}</p> : editable && (
                <form action={resolveConfirmation.bind(null, conf.id)} className="qa-row">
                  <input name="resolution" required maxLength={400} placeholder={t("Cómo se resuelven las diferencias (se aceptan, se renegoció, nueva versión de la orden…)", "How the differences are resolved (accepted, renegotiated, new order version…)")} aria-label={t("Resolución", "Resolution")} style={{ flex: "1 1 260px" }} />
                  <button type="submit" style={{ flex: "0 0 auto" }}>{t("Resolver y dar por confirmada", "Resolve and count as confirmed")}</button>
                </form>
              )}
            </>
          )}
          {editable && (!conf || conf.resolvedAt) && (
            <details className="qa" open={!conf} style={{ marginTop: 8 }}><summary className="qa-btn">{conf ? t("Registrar una nueva confirmación", "Record a new confirmation") : t("Registrar lo que confirmó el proveedor", "Record what the supplier confirmed")}</summary>
              <form action={recordConfirmation.bind(null, spo.id)} className="qa-form" style={{ marginTop: 8 }}>
                <div className="qa-row">
                  <label>{t("De dónde sale (correo, proforma, llamada con…)", "Where it comes from (email, proforma, call with…)")}<input name="source" required maxLength={200} /></label>
                  <label style={{ flex: "0 0 auto" }}>{t("Recibida", "Received")}<input name="receivedAt" type="date" defaultValue={dayInput(T)} /></label>
                </div>
                <b className="small">{t("Tal como lo confirmó (viene con lo de la orden; cambia solo lo distinto)", "As confirmed (prefilled from the order; change only what differs)")}</b>
                {spo.lines.map((l) => (
                  <div key={l.id} className="qa-row">
                    <label style={{ flex: "0 0 80px" }}>{t("Cant.", "Qty")}<input name={`cqty_${l.position}`} type="number" min={0} defaultValue={l.qty} /></label>
                    <label style={{ flex: "0 0 150px" }}>{t("Precio unit.", "Unit price")}<input name={`cprice_${l.position}`} type="number" min={0} step="0.01" defaultValue={Number(l.unitCost)} /></label>
                    <span className="small" style={{ flex: "1 1 160px", alignSelf: "flex-end" }}>{l.code ?? ""} {l.description}</span>
                  </div>
                ))}
                {scopeRows.length > 0 && (
                  <>
                    <b className="small">{t("Lo que la unidad necesita para funcionar: ¿viene incluido?", "What the unit needs to work: is it included?")}</b>
                    <input type="hidden" name="scopeCount" value={scopeRows.length} />
                    {scopeRows.map((s, k) => (
                      <div key={k} className="qa-row">
                        <input type="hidden" name={`scomp_${k}`} value={s.component} />
                        <span className="small" style={{ flex: "1 1 200px", alignSelf: "center" }}>{s.qty} × {s.component}</span>
                        <select name={`sstate_${k}`} defaultValue="NOT_STATED" aria-label={s.component} style={{ flex: "0 0 170px" }}>{Object.entries(SCOPE_STATES).map(([key, v]) => <option key={key} value={key}>{t(v.es, v.en)}</option>)}</select>
                      </div>
                    ))}
                  </>
                )}
                <div className="qa-row">
                  <label>{t("Fecha de listo", "Ready date")}<input name="readyDate" type="date" defaultValue={dayInput(spo.shipBy)} /></label>
                  <label>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue={spo.currency} /></label>
                  <label>Incoterm<input name="incoterm" maxLength={80} defaultValue={spo.incoterm ?? ""} /></label>
                </div>
                <label>{t("Condición de pago", "Payment terms")}<input name="paymentTerms" maxLength={160} defaultValue={spo.terms ?? ""} /></label>
                <div className="qa-row">
                  <label>{t("Documentos que entrega", "Documents provided")}<input name="documents" maxLength={300} /></label>
                  <label>{t("Garantía", "Warranty")}<input name="warranty" maxLength={200} /></label>
                  <label>{t("Empaque", "Packaging")}<input name="packaging" maxLength={200} /></label>
                </div>
                <label>{t("Condiciones nuevas que puso el proveedor", "New conditions set by the supplier")}<input name="newConditions" maxLength={300} /></label>
                <button type="submit">{t("Comparar con la orden", "Compare with the order")}</button>
              </form>
            </details>
          )}
        </section>
      )}

      <section className="jblock" id="ahorros">
        <div className="jbh"><b>{t("AHORROS", "SAVINGS")}</b><span className="grow" />{spo.firstQuoteAmount != null && <span className="src">{t(`Primera cotización ${money(spo.firstQuoteAmount)} · hoy ${money(total)}`, `First quote ${money(spo.firstQuoteAmount)} · now ${money(total)}`)}</span>}</div>
        {spo.savings.length === 0 ? <p className="small muted">{vsFirst?.valid ? t(`La orden está ${money(vsFirst.gross)} por debajo de la primera cotización. Regístralo como ahorro con su evidencia.`, `The order is ${money(vsFirst.gross)} below the first quote. Record it as a saving with its evidence.`) : t("Sin ahorros registrados en esta orden.", "No savings recorded on this order.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Tipo", "Kind")}</th><th className="n">{t("Base", "Baseline")}</th><th className="n">{t("Final", "Final")}</th><th className="n">{t("Ahorro", "Saving")}</th><th className="n">{t("Pasó al cliente", "Passed to customer")}</th><th className="n">{t("Retenido", "Retained")}</th><th>{t("Evidencia", "Evidence")}</th></tr></thead>
            <tbody>{spo.savings.map((s) => <tr key={s.id}><td className="small">{t(SAVING_KINDS[s.kind]?.es ?? s.kind, SAVING_KINDS[s.kind]?.en ?? s.kind)}<span className="src block">{s.baselineSource}</span></td><td className="n mono">{i.n2(s.baselineAmount)}</td><td className="n mono">{i.n2(s.finalAmount)}</td><td className="n mono"><b>{i.n2(s.savingsAmount)}</b></td><td className="n mono">{i.n2(s.passedToCustomer)}</td><td className="n mono">{i.n2(Number(s.savingsAmount) - Number(s.passedToCustomer))}</td><td className="small">{s.evidence}<span className="src block">{s.responsibleName} · {i.day(s.at)}</span></td></tr>)}</tbody>
          </table></div>
        )}
        {editable && (
          <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Registrar ahorro", "+ Record saving")}</summary>
            <form action={addSaving.bind(null, spo.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
              <label>{t("Tipo", "Kind")}<select name="kind" defaultValue="SUPPLIER_SAVINGS">{Object.entries(SAVING_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <div className="qa-row">
                <label>{t("Valor final", "Final amount")}<input name="finalAmount" type="number" min={0} step="0.01" required defaultValue={total} /></label>
                <label>{t("De eso, pasó al cliente", "Of that, passed to the customer")}<input name="passedToCustomer" type="number" min={0} step="0.01" defaultValue={0} /></label>
              </div>
              <div className="qa-row">
                <label>{t("Base (solo si NO es ahorro con el proveedor)", "Baseline (only if NOT a supplier saving)")}<input name="baselineAmount" type="number" min={0} step="0.01" /></label>
                <label>{t("De dónde sale esa base", "Where that baseline comes from")}<input name="baselineSource" maxLength={160} /></label>
              </div>
              <label>{t("Evidencia (correo, proforma, nota crédito…)", "Evidence (email, proforma, credit note…)")}<input name="evidence" required maxLength={300} /></label>
              <button type="submit">{t("Registrar ahorro", "Record saving")}</button>
              <span className="src block">{t("El ahorro con el proveedor se mide contra su primera cotización. No todo ahorro es margen: lo que pasó al cliente se registra aparte.", "A supplier saving is measured against its first quote. Not every saving is margin: what was passed to the customer is recorded separately.")}</span>
            </form>
          </details>
        )}
      </section>
    </>
  );
}
