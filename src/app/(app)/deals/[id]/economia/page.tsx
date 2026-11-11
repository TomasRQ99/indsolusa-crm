import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEditOps, canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { CATS, COST_CATS, ECON_STATES, SPLIT_METHODS, type View } from "@/lib/economics-rules";
import { dealEconomics } from "@/lib/economics";
import { addDealCost, addSharedCost, removeDealCost, setEconomicsState } from "./actions";

// Operaciones O9c · protected vs expected vs facts (module 11 §44): what the Eságara was when we committed, what we
// expect today, what the facts say so far, and why it moved.

export default async function DealEconomicsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const e = await dealEconomics(id);
  if (!e) notFound();
  const { d, econ } = e;
  const final = d.economicsState === "FINAL";
  const canCost = !final && (canEditOps(user, d.ownerId) || canFinance(user));
  const S = ECON_STATES[d.economicsState] ?? ECON_STATES.OPEN;
  const usd = (n: number) => `USD ${i.n2(n)}`;
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${i.n2(Math.abs(n))}`;
  const okMsg: Record<string, string> = { costo: t("Costo agregado.", "Cost added."), compartido: t("Costo compartido repartido entre los Journeys.", "Shared cost split between the Journeys."), quitado: t("Costo quitado.", "Cost removed."), estado: t("Estado de la economía actualizado.", "Economics state updated.") };
  const errMsg: Record<string, string> = {
    permiso: t("No tienes permiso para registrar costos de este Journey.", "You don't have permission to record costs on this Journey."), final: t("La economía está cerrada como final. Para cambiar costos, primero se reabre.", "Economics are closed as final. To change costs, reopen first."),
    costo: t("Indica el tipo, el valor y qué es.", "Give the type, the amount and what it is."), compartido: t("Indica el tipo, el valor total, qué es y los códigos de los otros Journeys.", "Give the type, the total, what it is and the codes of the other Journeys."),
    "compartido-motivo": t("Para repartir a mano, escribe el motivo.", "To split by hand, write the reason."), "compartido-journey": t("Algún código de Journey no existe. Revisa cómo está escrito.", "A Journey code doesn't exist. Check how it is written."),
    "compartido-final": t("Uno de esos Journeys ya tiene la economía cerrada como final.", "One of those Journeys already has economics closed as final."), "compartido-suma": t("Los valores a mano deben sumar exactamente el total, uno por cada Journey.", "The amounts typed by hand must add up exactly to the total, one per Journey."),
    "compartido-base": t("No se puede repartir así: algún Journey no tiene venta protegida (o unidades). Reparte a mano.", "It can't be split that way: a Journey has no protected sale (or units). Split by hand."),
    "permiso-cierre": t("El estado de la economía lo cambian Finanzas, Administración o Gerencia.", "The economics state is changed by Finance, Administration or Management."), estado: t("Elige un estado distinto al actual.", "Choose a state different from the current one."),
    reabrir: t("Para reabrir una economía final, escribe por qué.", "To reopen final economics, write why."), "sin-factura": t("No se puede cerrar como final sin una cotización aceptada y al menos una factura.", "It can't be closed as final without an accepted quote and at least one invoice."),
  };
  const Col = ({ title, v, sub }: { title: string; v: View | null; sub: string }) => (
    <div className="ft"><span className="k">{title}</span>{v ? <><b className="mono">{usd(v.esagara)}{v.pct != null ? ` · ${i.pct(v.pct)}` : ""}</b><span className="src">{t("venta", "sale")} {i.n2(v.sale)} − {t("costos", "costs")} {i.n2(v.cost)}</span></> : <b>—</b>}<span className="src">{sub}</span></div>
  );

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=finance`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{t("Eságara real", "Real Eságara")}</span><span className="grow" />
        </div>
        <div className="jh-title"><h1>{t("¿Cuánto dejó de verdad este Journey?", "What did this Journey really leave?")}</h1><span className={`sig ${S.tone}`}>{t(S.es, S.en)}</span></div>
        <p className="jh-sub">{t("USD antes de IVA. Cada costo se lee de donde ya está registrado; aquí solo se agrega lo que no está en ningún otro lado.", "USD before VAT. Each cost is read from where it is already recorded; only what exists nowhere else is added here.")}</p>
      </header>

      {!econ ? <section className="jblock"><p className="quiet-p">{t("Este Journey aún no tiene una cotización aceptada con su Eságara protegida.", "This Journey has no accepted quote with its protected Eságara yet.")}</p></section> : (
        <>
          <section className="ftruths" aria-label={t("Tres vistas", "Three views")}>
            <Col title={t("PROTEGIDA", "PROTECTED")} v={econ.prot} sub={t("al aceptar la cotización", "when the quote was accepted")} />
            <Col title={t("ESPERADA HOY", "EXPECTED TODAY")} v={econ.expected} sub={t("los hechos reemplazan a los estimados", "facts replace estimates")} />
            <Col title={final ? t("FINAL", "FINAL") : t("HECHOS HASTA HOY", "FACTS SO FAR")} v={econ.facts} sub={econ.facts ? t("solo lo facturado y lo ya registrado", "only what is invoiced and already recorded") : t("aún sin facturar", "not invoiced yet")} />
          </section>

          <section className="jblock" id="puente">
            <div className="jbh"><b>{t("POR QUÉ CAMBIÓ", "WHY IT CHANGED")}</b><span className="grow" /><span className="src">{t("de la protegida a la esperada hoy", "from protected to expected today")}</span></div>
            {econ.lines.length === 0 ? <p className="quiet-p">{t("Sin cambios: va como se protegió.", "No changes: it runs as protected.")}</p> : (
              <div className="tscroll"><table>
                <thead><tr><th>{t("Causa", "Cause")}</th><th className="n">USD</th><th className="n">{t("Puntos de Eságara", "Eságara points")}</th></tr></thead>
                <tbody>
                  {econ.lines.map((l, k) => <tr key={k}><td>{t(l.text.es, l.text.en)}</td><td className={`n mono ${l.usd < 0 ? "risk-t" : "ok-t"}`}>{signed(l.usd)}</td><td className={`n mono ${l.usd < 0 ? "risk-t" : "ok-t"}`}>{l.pp != null ? `${signed(l.pp)} pp` : "—"}</td></tr>)}
                  <tr><td><b>{t("Cambio total en la Eságara", "Total change in Eságara")}</b></td><td className="n mono"><b>{signed(econ.gap)}</b></td><td /></tr>
                </tbody>
              </table></div>
            )}
          </section>
        </>
      )}

      <section className="jblock" id="ingresos">
        <div className="jbh"><b>{t("EL LADO DE LA VENTA", "THE REVENUE SIDE")}</b><span className="grow" /><span className="src">{t("vender no es facturar, y facturar no es cobrar", "selling is not invoicing, and invoicing is not collecting")}</span></div>
        <dl className="qv-dl tight">
          <dt>{t("Venta protegida", "Protected sale")}</dt><dd className="mono">{e.revenue.sale != null ? usd(e.revenue.sale) : "—"}</dd>
          <dt>{t("Facturado", "Invoiced")}</dt><dd className="mono">{usd(e.revenue.invoiced)}</dd>
          <dt>{t("Cobrado y conciliado", "Collected and reconciled")}</dt><dd className="mono">{usd(e.revenue.cash)}</dd>
          <dt>{t("Recibido, por conciliar", "Received, to reconcile")}</dt><dd className="mono">{usd(e.revenue.pending)}</dd>
          <dt>{t("Retenido por el cliente", "Withheld by the customer")}</dt><dd className="mono">{usd(e.revenue.withheld)}</dd>
          <dt>{t("Por cobrar", "Outstanding")}</dt><dd className="mono"><b>{usd(e.revenue.outstanding)}</b></dd>
        </dl>
      </section>

      <section className="jblock" id="costos">
        <div className="jbh"><b>{t("COSTOS REALES", "REAL COSTS")}</b><span className="grow" /><span className="src">{e.invoiced != null ? t(`facturado ${usd(e.invoiced)}`, `invoiced ${usd(e.invoiced)}`) : t("aún sin facturar", "not invoiced yet")}</span></div>
        {e.facts.length === 0 && <p className="quiet-p">{t("Aún no hay costos reales registrados.", "No real costs recorded yet.")}</p>}
        {CATS.filter((c) => e.facts.some((f) => f.cat === c)).map((c) => (
          <div key={c} style={{ marginTop: 8 }}>
            <span className="k">{t(COST_CATS[c].es, COST_CATS[c].en)} · <span className="mono">{usd(e.sums[c])}</span></span>
            <ul className="plain small">{e.facts.filter((f) => f.cat === c).map((f, k) => (
              <li key={k} className={f.counts ? undefined : "muted"}><span className="mono">{i.n2(f.amount)}</span> · {!f.counts && <span className="sig wait">{t("no cuenta en la Eságara según la política", "not counted in Eságara per the policy")}</span>} {f.href ? <Link href={f.href}>{f.what}</Link> : f.what}{f.shared && <span className="muted"> · {t("su parte de un costo compartido", "its share of a shared cost")}{f.shared.total != null ? ` (${t("total", "total")} ${i.n2(f.shared.total)})` : ""} · {t(SPLIT_METHODS[f.shared.method]?.es ?? f.shared.method, SPLIT_METHODS[f.shared.method]?.en ?? f.shared.method)}{f.shared.note ? ` · ${f.shared.note}` : ""}</span>}{f.ledgerId && canCost && <form action={removeDealCost.bind(null, f.ledgerId)} className="inline-f"><button type="submit" className="linkb">{t("quitar", "remove")}</button></form>}</li>
            ))}</ul>
          </div>
        ))}
        {e.claimRecovered > 0 && <p className="small ok-t">{t("Recuperado de reclamos a transportadores", "Recovered from carrier claims")}: <span className="mono">{usd(e.claimRecovered)}</span></p>}
        {e.otherCurrency.length > 0 && <p className="note attn">{t("En otra moneda, sin convertir aquí: ", "In another currency, not converted here: ")}{e.otherCurrency.join(" · ")}</p>}
        <p className="src">{t("El costo de financiar el plazo de pago aún no se incluye: falta la tasa de la empresa. Los gastos de viaje se agregan aquí a mano, porque un viaje no pertenece a un solo Journey.", "The cost of financing the payment term is not included yet: the company's rate is missing. Travel expenses are added here by hand, because a trip doesn't belong to one Journey.")}</p>
        {canCost && (
          <>
            <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Agregar un costo de este Journey", "+ Add a cost of this Journey")}</summary>
              <form action={addDealCost.bind(null, d.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
                <div className="qa-row">
                  <label style={{ flex: "0 0 220px" }}>{t("Tipo", "Type")}<select name="category" defaultValue="OTHER">{CATS.map((c) => <option key={c} value={c}>{t(COST_CATS[c].es, COST_CATS[c].en)}</option>)}</select></label>
                  <label style={{ flex: "0 0 150px" }}>{t("Valor USD", "Amount USD")}<input name="amount" inputMode="decimal" required /></label>
                  <label style={{ flex: "0 0 160px" }}>{t("Fecha", "Date")}<input name="spentOn" type="date" defaultValue={dayInput(today())} /></label>
                </div>
                <label>{t("Qué es", "What it is")}<input name="description" required maxLength={200} placeholder={t("Ej.: agente de aduana, bodegaje, tiquete a la planta", "E.g.: customs broker, storage, flight to the plant")} /></label>
                <label>{t("Soporte (factura, recibo)", "Evidence (invoice, receipt)")}<input name="evidence" maxLength={200} /></label>
                <button type="submit">{t("Agregar costo", "Add cost")}</button>
              </form>
            </details>
            <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Repartir un costo compartido con otros Journeys", "+ Split a cost shared with other Journeys")}</summary>
              <form action={addSharedCost.bind(null, d.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
                <div className="qa-row">
                  <label style={{ flex: "0 0 220px" }}>{t("Tipo", "Type")}<select name="category" defaultValue="FREIGHT">{CATS.map((c) => <option key={c} value={c}>{t(COST_CATS[c].es, COST_CATS[c].en)}</option>)}</select></label>
                  <label style={{ flex: "0 0 160px" }}>{t("Valor total USD", "Total USD")}<input name="amount" inputMode="decimal" required /></label>
                  <label style={{ flex: "0 0 160px" }}>{t("Fecha", "Date")}<input name="spentOn" type="date" defaultValue={dayInput(today())} /></label>
                </div>
                <label>{t("Qué es", "What it is")}<input name="description" required maxLength={200} /></label>
                <label>{t("Códigos de los otros Journeys (separados por coma)", "Codes of the other Journeys (comma-separated)")}<input name="others" required maxLength={200} placeholder="SJ-01842, SJ-01377" /></label>
                <label>{t("Cómo se reparte", "How it is split")}<select name="method" defaultValue="VALUE">{Object.entries(SPLIT_METHODS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                <div className="qa-row">
                  <label style={{ flex: "0 0 200px" }}>{t("A mano: parte de este Journey", "By hand: this Journey's share")}<input name="manual_self" inputMode="decimal" /></label>
                  <label>{t("A mano: los otros, así: SJ-01842=120, SJ-01377=80", "By hand: the others, like: SJ-01842=120, SJ-01377=80")}<input name="manualOthers" maxLength={300} /></label>
                </div>
                <label>{t("Motivo (obligatorio si es a mano)", "Reason (required if by hand)")}<input name="splitNote" maxLength={200} /></label>
                <label>{t("Soporte (factura, recibo)", "Evidence (invoice, receipt)")}<input name="evidence" maxLength={200} /></label>
                <button type="submit">{t("Repartir costo", "Split cost")}</button>
              </form>
            </details>
          </>
        )}
      </section>

      <section className="jblock" id="cierre">
        <div className="jbh"><b>{t("CIERRE DE LA ECONOMÍA", "ECONOMICS CLOSE")}</b><span className="grow" /><span className={`sig ${S.tone}`}>{t(S.es, S.en)}</span></div>
        {d.economicsAt && <p className="small">{d.economicsByName} · {i.day(d.economicsAt)}{d.economicsNote ? ` · ${d.economicsNote}` : ""}</p>}
        <ul className="qv-checks">{e.readiness.criteria.map((c) => <li key={c.key} className={c.ok ? "ok" : "no"}><span className="ic" aria-hidden>{c.ok ? "✓" : "!"}</span><span>{t(c.text.es, c.text.en)}{!c.ok && <span className="muted small"> · {t(c.fix.es, c.fix.en)}</span>}</span></li>)}</ul>
        <p className="small">{e.readiness.ready ? <span className="sig ok">{t("Todo lo necesario está: se puede cerrar como final", "Everything needed is in: it can be closed as final")}</span> : t("Falta lo marcado arriba para un cierre final. Si lo que falta es pequeño, usa «Sustancialmente completa».", "The items marked above are missing for a final close. If what is missing is small, use \"Substantially complete\".")}</p>
        {!e.readiness.ready && econ?.facts && e.materialityUsd > 0 && Math.abs(econ.expected.esagara - econ.facts.esagara) <= e.materialityUsd && <p className="small"><span className="sig attn">{t(`Lo que falta mueve la Eságara en USD ${i.n2(Math.abs(econ.expected.esagara - econ.facts.esagara))}, menos que el umbral de USD ${i.n2(e.materialityUsd)}: se puede marcar «Sustancialmente completa»`, `What is missing moves Eságara by USD ${i.n2(Math.abs(econ.expected.esagara - econ.facts.esagara))}, below the USD ${i.n2(e.materialityUsd)} threshold: it can be marked "Substantially complete"`)}</span></p>}
        <p className="src">{t("«Sustancialmente completa» sirve para no dejar un Journey abierto por diferencias pequeñas. «Final» guarda las cifras de ese día y bloquea nuevos costos hasta reabrir.", "\"Substantially complete\" avoids keeping a Journey open over small differences. \"Final\" keeps that day's figures and blocks new costs until reopened.")}</p>
        {canFinance(user) && (
          <form action={setEconomicsState.bind(null, d.id)} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ flex: "0 0 260px" }}>{t("Estado", "State")}<select name="state" defaultValue={d.economicsState === "OPEN" ? "SUBSTANTIAL" : d.economicsState === "SUBSTANTIAL" ? "FINAL" : "OPEN"}>{Object.entries(ECON_STATES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
            <label>{t("Nota (obligatoria para reabrir un cierre final)", "Note (required to reopen a final close)")}<input name="note" maxLength={300} /></label>
            <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar estado", "Save state")}</button>
          </form>
        )}
      </section>
    </div>
  );
}
