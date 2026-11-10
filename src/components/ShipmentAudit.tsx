import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { makeI18n } from "@/lib/i18n";
import { STATUS_TEXT, type Audit } from "@/lib/freight-audit";
import { openClaim, recordCarrierInvoice, updateClaim } from "@/app/(app)/logistica/auditoria-actions";

// Operaciones O7 · freight invoice audit (module 11 §31, card §66.2). What the carrier billed against the quote,
// what was stated and what we measured. Our measurement is evidence to ask with, never automatic proof.

const CLAIM: Record<string, { es: string; en: string; tone: string }> = {
  OPEN: { es: "Abierto, esperando respuesta", en: "Open, awaiting answer", tone: "attn" }, ACCEPTED: { es: "Aceptado: falta recibir el crédito", en: "Accepted: credit not received yet", tone: "attn" },
  REJECTED: { es: "Rechazado por el transportador", en: "Rejected by the carrier", tone: "risk" }, RECOVERED: { es: "Recuperado", en: "Recovered", tone: "ok" },
};

export async function ShipmentAudit({ shipmentId, lang, editable, canMoney }: { shipmentId: string; lang: "ES" | "EN"; editable: boolean; canMoney: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const s = await db.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, carrierName: true, supplierPoId: true, carrierInvoices: { orderBy: { createdAt: "asc" }, include: { claim: true } } } });
  if (!s) return null;
  const [fr, rec] = await Promise.all([
    s.supplierPoId ? db.freightRequirement.findUnique({ where: { supplierPoId: s.supplierPoId }, select: { grossKg: true, dims: true, packages: true, quotes: { where: { chosen: true }, select: { cost: true, currency: true, carrier: true } } } }) : null,
    s.supplierPoId ? db.goodsReceipt.findFirst({ where: { supplierPoId: s.supplierPoId, OR: [{ grossKg: { not: null } }, { dims: { not: null } }] }, orderBy: { receivedAt: "desc" }, select: { code: true, grossKg: true, dims: true, packages: true } }) : null,
  ]);
  const q = fr?.quotes[0] ?? null;
  const kg = (x: unknown) => (x == null ? "—" : `${i.n2(Number(x))} kg`);
  const side = (x: { grossKg: unknown; dims: string | null; packages: number | null } | null | undefined) => (x && (x.grossKg != null || x.dims) ? [x.grossKg != null ? kg(x.grossKg) : null, x.dims ? `${x.dims} cm` : null, x.packages ? t(`${x.packages} bulto(s)`, `${x.packages} piece(s)`) : null].filter(Boolean).join(" · ") : null);
  const m = (cur: string, x: unknown) => `${cur} ${i.n2(Number(x))}`;

  return (
    <section className="jblock" id="auditoria">
      <div className="jbh"><b>{t("FACTURA DEL TRANSPORTADOR", "CARRIER INVOICE")}</b><span className="grow" /><span className="src">{t("cotizado · declarado · medido · facturado", "quoted · stated · measured · billed")}</span></div>
      <dl className="qv-dl tight">
        <dt>{t("Flete cotizado y elegido", "Freight quoted and chosen")}</dt><dd>{q ? <><span className="mono">{m(q.currency, q.cost)}</span><span className="muted small"> · {q.carrier}</span></> : <span className="muted">{t("Sin cotización elegida en la compra", "No quote chosen on the purchase")}</span>}</dd>
        <dt>{t("Declarado en la compra", "Stated on the purchase")}</dt><dd className="mono">{side(fr) ?? "—"}</dd>
        <dt>{t("Medido por nosotros", "Measured by us")}</dt><dd className="mono">{side(rec) ?? "—"}{rec ? <span className="muted small"> · {rec.code}</span> : <span className="muted small"> · {t("se toma de la recepción en bodega", "taken from the warehouse receipt")}</span>}</dd>
      </dl>

      {s.carrierInvoices.length === 0 && <p className="small muted">{t("Aún no se ha registrado la factura de este envío.", "The invoice for this shipment hasn't been recorded yet.")}</p>}
      {s.carrierInvoices.map((inv) => {
        const a = inv.audit as unknown as Audit;
        const st = STATUS_TEXT[inv.status] ?? STATUS_TEXT.MATCH;
        const c = inv.claim;
        const sur = (Array.isArray(inv.surcharges) ? inv.surcharges : []) as { name: string; amount: number }[];
        return (
          <article key={inv.id} className="exc-item">
            <header className="exc-head"><span className={`sig ${st.tone}`}>{t(st.es, st.en)}</span> <b>{inv.carrier} · {inv.number}</b><span className="grow" /><span className="small muted">{i.day(inv.invoiceDate)} · {inv.recordedByName}</span></header>
            <dl className="qv-dl tight">
              <dt>{t("Facturado", "Billed")}</dt><dd className="mono"><b>{m(inv.currency, inv.amount)}</b>{a.diffAmount != null && <span className={a.diffAmount > 0.005 ? "risk-t" : "muted"}> · {a.diffAmount > 0 ? "+" : ""}{i.n2(a.diffAmount)}{a.diffPct != null ? ` (${a.diffAmount > 0 ? "+" : ""}${i.n2(a.diffPct)} %)` : ""} {t("vs cotizado", "vs quoted")}</span>}</dd>
              <dt>{t("Peso volumétrico", "Volumetric weight")}</dt><dd className="mono">{kg(a.volKg)}</dd>
              <dt>{t("Peso cobrable esperado", "Expected chargeable weight")}</dt><dd className="mono">{kg(a.expectedKg)}{a.basis && <span className="muted small"> · {a.basis === "MEASURED" ? t("con nuestra medición", "from our measurement") : t("con lo declarado", "from what was stated")}</span>}</dd>
              <dt>{t("Peso cobrable facturado", "Billed chargeable weight")}</dt><dd className="mono">{kg(inv.billedKg)}{inv.billedPieces != null ? ` · ${t(`${inv.billedPieces} bulto(s)`, `${inv.billedPieces} piece(s)`)}` : ""}</dd>
              {sur.length > 0 && <><dt>{t("Recargos", "Surcharges")}</dt><dd className="small">{sur.map((x) => `${x.name} ${m(inv.currency, x.amount)}`).join(" · ")}</dd></>}
              <dt>{t("Fuente", "Source")}</dt><dd className="small">{inv.source}</dd>
            </dl>
            {a.variances.length > 0 && <ul className="plain small">{a.variances.map((v, k) => <li key={k}>• {t(v.text.es, v.text.en)}</li>)}</ul>}
            {!c && <p className="small"><b>{t("Siguiente paso", "Next move")}:</b> {t(a.nextMove.es, a.nextMove.en)}</p>}
            <p className="src">{t(`Regla de peso versión ${a.ruleVersion}${a.ruleConfirmed ? "" : " · por confirmar contra el contrato con el transportador"}. Nuestra medición sirve para preguntar con evidencia; el transportador pudo reempacar o paletizar.`, `Weight rule version ${a.ruleVersion}${a.ruleConfirmed ? "" : " · to be confirmed against the carrier contract"}. Our measurement is evidence to ask with; the carrier may have repacked or palletised.`)}</p>

            {c && (
              <div className="note" style={{ marginTop: 8 }}>
                <b>{t("Reclamo", "Claim")}</b> <span className={`sig ${CLAIM[c.status]?.tone ?? "wait"}`}>{t(CLAIM[c.status]?.es ?? c.status, CLAIM[c.status]?.en ?? c.status)}</span>
                <dl className="qv-dl tight">
                  <dt>{t("Valor en disputa", "Disputed amount")}</dt><dd className="mono">{m(inv.currency, c.disputedAmount)}</dd>
                  <dt>{t("Lo esperado", "Expected")}</dt><dd className="small">{c.expectedCalc}</dd>
                  <dt>{t("Lo facturado", "Billed")}</dt><dd className="small">{c.billedCalc}</dd>
                  <dt>{t("Evidencia", "Evidence")}</dt><dd className="small">{c.evidence}</dd>
                  <dt>{t("Fecha del reclamo", "Claim date")}</dt><dd className="mono">{i.day(c.claimDate)} <span className="muted small">· {c.openedByName}</span></dd>
                  {c.response && <><dt>{t("Respuesta", "Response")}</dt><dd className="small">{c.response}</dd></>}
                  {c.status === "RECOVERED" && <><dt>{t("Recuperado", "Recovered")}</dt><dd><b className="mono">{m(inv.currency, c.recoveredAmount)}</b><span className="small muted"> · {t("nota crédito", "credit note")} {c.creditNote} · {i.day(c.recoveredAt)}</span></dd></>}
                </dl>
                {c.status !== "RECOVERED" && <p className="src">{t("Un «sí» del transportador no es dinero recuperado: cuenta solo con la nota crédito y el valor realmente recibido.", "A carrier's \"yes\" is not recovered money: it counts only with the credit note and the amount really received.")}</p>}
                {canMoney && c.status !== "RECOVERED" && (
                  <details className="qa"><summary className="qa-btn">{t("Registrar respuesta o crédito", "Record answer or credit")}</summary>
                    <form action={updateClaim.bind(null, c.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 640 }}>
                      <label>{t("Qué respondió el transportador", "What the carrier answered")}<input name="response" maxLength={400} defaultValue={c.response ?? ""} /></label>
                      <div className="qa-row">
                        <label>{t("Nota crédito n.º", "Credit note no.")}<input name="creditNote" maxLength={120} /></label>
                        <label style={{ flex: "0 0 160px" }}>{t(`Valor recibido (${inv.currency})`, `Amount received (${inv.currency})`)}<input name="recoveredAmount" inputMode="decimal" /></label>
                        <label style={{ flex: "0 0 160px" }}>{t("Fecha del crédito", "Credit date")}<input name="recoveredAt" type="date" defaultValue={dayInput(today())} /></label>
                      </div>
                      <div className="qa-row" style={{ flexWrap: "wrap" }}>
                        <button type="submit" name="action" value="ACCEPTED" className="secondary" style={{ flex: "0 0 auto" }}>{t("Aceptó (aún sin crédito)", "Accepted (no credit yet)")}</button>
                        <button type="submit" name="action" value="REJECTED" className="secondary" style={{ flex: "0 0 auto" }}>{t("Rechazó", "Rejected")}</button>
                        <button type="submit" name="action" value="RECOVERED" style={{ flex: "0 0 auto" }}>{t("Crédito recibido", "Credit received")}</button>
                      </div>
                    </form>
                  </details>
                )}
              </div>
            )}
            {!c && editable && (inv.status === "VARIANCE_REVIEW" || inv.status === "CLAIM_RECOMMENDED") && (
              <details className="qa"><summary className="qa-btn">{t("Abrir reclamo al transportador", "Open a claim with the carrier")}</summary>
                <form action={openClaim.bind(null, inv.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 640 }}>
                  <div className="qa-row">
                    <label style={{ flex: "0 0 180px" }}>{t(`Valor en disputa (${inv.currency})`, `Disputed amount (${inv.currency})`)}<input name="disputedAmount" inputMode="decimal" required defaultValue={a.diffAmount != null && a.diffAmount > 0 ? a.diffAmount.toFixed(2) : ""} /></label>
                    <label style={{ flex: "0 0 160px" }}>{t("Fecha del reclamo", "Claim date")}<input name="claimDate" type="date" defaultValue={dayInput(today())} /></label>
                  </div>
                  <label>{t("Cálculo esperado", "Expected calculation")}<input name="expectedCalc" required maxLength={300} defaultValue={[q ? `${t("Cotizado", "Quoted")} ${m(q.currency, q.cost)}` : null, a.expectedKg != null ? `${i.n2(a.expectedKg)} kg ${t("cobrables", "chargeable")}` : null].filter(Boolean).join(" · ")} /></label>
                  <label>{t("Evidencia que respalda (fotos de recepción, cotización, guía)", "Supporting evidence (receipt photos, quote, waybill)")}<input name="evidence" required maxLength={400} defaultValue={rec ? t(`Recepción ${rec.code} con peso y medidas`, `Receipt ${rec.code} with weight and dimensions`) : ""} /></label>
                  <button type="submit">{t("Abrir reclamo", "Open claim")}</button>
                </form>
              </details>
            )}
          </article>
        );
      })}

      {editable && (
        <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Registrar factura del transportador", "+ Record carrier invoice")}</summary>
          <form action={recordCarrierInvoice.bind(null, s.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
            <div className="qa-row">
              <label>{t("Transportador", "Carrier")}<input name="carrier" required maxLength={80} defaultValue={s.carrierName ?? ""} /></label>
              <label>{t("Servicio (opcional)", "Service (optional)")}<input name="service" maxLength={80} /></label>
              <label>{t("Factura n.º", "Invoice no.")}<input name="number" required maxLength={60} /></label>
            </div>
            <div className="qa-row">
              <label style={{ flex: "0 0 150px" }}>{t("Fecha", "Date")}<input name="invoiceDate" type="date" defaultValue={dayInput(today())} /></label>
              <label style={{ flex: "0 0 90px" }}>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue={q?.currency ?? "USD"} /></label>
              <label style={{ flex: "0 0 150px" }}>{t("Total facturado", "Total billed")}<input name="amount" inputMode="decimal" required /></label>
              <label style={{ flex: "0 0 150px" }}>{t("Peso cobrable (kg)", "Chargeable weight (kg)")}<input name="billedKg" inputMode="decimal" /></label>
              <label style={{ flex: "0 0 110px" }}>{t("Bultos", "Pieces")}<input name="billedPieces" inputMode="numeric" /></label>
            </div>
            <span className="small muted">{t("Recargos que trae la factura (opcional)", "Surcharges on the invoice (optional)")}</span>
            {[0, 1, 2].map((k) => (
              <div className="qa-row" key={k}>
                <label>{t("Recargo", "Surcharge")}<input name={`sname_${k}`} maxLength={60} placeholder={k === 0 ? t("Ej.: combustible", "E.g.: fuel") : ""} /></label>
                <label style={{ flex: "0 0 150px" }}>{t("Valor", "Amount")}<input name={`samt_${k}`} inputMode="decimal" /></label>
              </div>
            ))}
            <label>{t("De dónde sale el dato (PDF de la factura, portal, correo)", "Where the figure comes from (invoice PDF, portal, email)")}<input name="source" required maxLength={200} /></label>
            <button type="submit">{t("Registrar y comparar", "Record and compare")}</button>
          </form>
        </details>
      )}
    </section>
  );
}
