import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today, addDays } from "@/lib/domain";
import { opsHome, type OpsRow } from "@/lib/ops-home";
import { EXC_KINDS, IMPACT_AREAS, needsCommercial, readAreas, readOptions } from "@/lib/ops-rules";
import { openException, resolveException } from "./actions";

// Operaciones O0 · Operations Home (module 11 §46–47, AC37): exceptions first, then what is ready to move, customer
// promises at risk, healthy waits and resource exposure. Not a list of open orders.

export default async function OpsHomePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const h = await opsHome();
  const T = today();
  const [people, deals] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.deal.findMany({ where: { poAcceptedAt: { not: null }, resultAchievedAt: null, stage: { not: "LOST" } }, orderBy: { poAcceptedAt: "desc" }, take: 80, select: { id: true, code: true, title: true, account: { select: { name: true } } } }),
  ]);
  const okMsg: Record<string, string> = { "exc-abierta": t("Excepción registrada con su dueño y fecha.", "Exception recorded with its owner and date."), "exc-resuelta": t("Excepción resuelta. Quedó en el historial del Journey.", "Exception resolved. It's in the Journey's history.") };
  const errMsg: Record<string, string> = {
    "exc-campos": t("Una excepción necesita: qué pasó, qué se esperaba, qué ocurrió, el próximo paso recomendado, un dueño y una fecha.", "An exception needs: what happened, what was expected, what occurred, the recommended next step, an owner and a date."),
    "exc-permiso": t("No tienes permiso sobre ese Journey.", "You don't have permission on that Journey."),
    "exc-journey": t("Elige el Journey.", "Pick the Journey."),
    "exc-resolucion": t("Escribe cómo se resolvió.", "Write how it was resolved."),
  };
  const dealLabel = (d: OpsRow["deal"]) => <><Link href={`/deals/${d.id}`}>{d.code ?? d.title}</Link> · {d.account.name}</>;
  const List = ({ rows, empty }: { rows: OpsRow[]; empty: string }) => rows.length === 0 ? <p className="small muted">{empty}</p> : (
    <ul className="mk-ul">{rows.slice(0, 12).map((r) => (
      <li key={r.key}><Link href={r.href}>{t(r.what.es, r.what.en)}</Link>{r.amount != null && <span className="mono"> · USD {i.n2(r.amount)}</span>} · <span className="small">{dealLabel(r.deal)}</span>{r.at && <span className={`small ${r.at < T ? "risk-t" : "muted"}`}> · {i.day(r.at)}</span>}{r.note && <span className="src block">{r.note}</span>}</li>
    ))}{rows.length > 12 && <li className="muted small">{t(`y ${rows.length - 12} más`, `and ${rows.length - 12} more`)}</li>}</ul>
  );
  const tone = { BREACHED: "risk", AT_RISK: "risk", NARROW: "attn", UNKNOWN: "wait", PROTECTED: "ok" } as const;
  const word = { BREACHED: t("Incumplida", "Breached"), AT_RISK: t("En riesgo", "At risk"), NARROW: t("Justa", "Narrow"), UNKNOWN: t("Sin fecha esperada", "No expected date"), PROTECTED: t("Protegida", "Protected") };
  const x = h.exposure;

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Operaciones", "Operations")}</h1>
          <p>{t("Primero lo que se desvió, luego lo que está listo para avanzar, las promesas al cliente en riesgo, las esperas sanas y los recursos comprometidos.", "First what deviated, then what's ready to move, customer promises at risk, healthy waits and committed resources.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" data-zone="act" id="atencion">
        <div className="jbh"><b>{t("NECESITA ATENCIÓN", "NEEDS ATTENTION")}</b><span className="grow" />
          <details className="qa" id="excepcion" open={sp.err === "exc-campos" || sp.err === "exc-journey"}><summary className="qa-btn">{t("+ Registrar excepción", "+ Record exception")}</summary>
            <div className="qa-pop wide right">
              <form action={openException} className="qa-form">
                <input type="hidden" name="back" value="/operaciones" />
                <label>Journey<select name="dealId" required defaultValue=""><option value="" disabled>{t("Elige…", "Choose…")}</option>{deals.map((d) => <option key={d.id} value={d.id}>{d.code ?? d.title} · {d.account.name}</option>)}</select></label>
                <label>{t("Tipo", "Kind")}<select name="kind" defaultValue="SUPPLIER_DELAY">{Object.entries(EXC_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                <label>{t("Qué pasó", "What happened")}<input name="whatHappened" required maxLength={300} /></label>
                <div className="qa-row">
                  <label>{t("Se esperaba", "Expected")}<input name="expected" required maxLength={300} /></label>
                  <label>{t("Ocurrió", "Actual")}<input name="actual" required maxLength={300} /></label>
                </div>
                <div className="qa-row">
                  <label>{t("Impacto para el cliente", "Customer impact")}<input name="customerImpact" maxLength={300} /></label>
                  <label style={{ flex: "0 0 170px" }}>{t("Impacto en USD", "Impact in USD")}<input name="economicImpactUsd" type="number" step="0.01" /></label>
                </div>
                <label>{t("Evidencia (de dónde lo sabemos)", "Evidence (how we know)")}<input name="evidence" maxLength={300} /></label>
                <b className="small">{t("¿Toca algo del cliente? (solo entonces se avisa a Comercial)", "Does it touch the customer? (only then is Commercial told)")}</b>
                <div className="qa-row" style={{ flexWrap: "wrap" }}>{Object.entries(IMPACT_AREAS).map(([k, v]) => <label key={k} className="chk"><input type="checkbox" name={`area_${k}`} value="1" /> {t(v.es, v.en)}</label>)}</div>
                <b className="small">{t("Opciones para resolver", "Options to resolve")}</b>
                {[0, 1, 2].map((k) => <input key={k} name={`option_${k}`} maxLength={200} placeholder={t(`Opción ${k + 1} (opcional)`, `Option ${k + 1} (optional)`)} aria-label={t(`Opción ${k + 1}`, `Option ${k + 1}`)} />)}
                <label>{t("Próximo paso recomendado", "Recommended next step")}<input name="recommended" required maxLength={300} /></label>
                <div className="qa-row">
                  <label>{t("Dueño", "Owner")}<select name="ownerId" defaultValue={user.id}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label style={{ flex: "0 0 auto" }}>{t("Para cuándo", "By when")}<input name="deadline" type="date" required defaultValue={dayInput(addDays(T, 1))} /></label>
                </div>
                <button type="submit">{t("Registrar excepción", "Record exception")}</button>
              </form>
            </div>
          </details>
        </div>
        {h.exceptions.length === 0 && h.attention.length === 0 ? <p className="small muted"><span className="sig ok">{t("Nada se desvió de lo esperado.", "Nothing deviated from what was expected.")}</span></p> : (
          <>
            {h.exceptions.map((e) => {
              const areas = readAreas(e.impactAreas); const opts = readOptions(e.options);
              return (
                <article key={e.id} id={`x-${e.id}`} className="exc-item">
                  <header className="exc-head"><span className="sig risk">{t(EXC_KINDS[e.kind]?.es ?? e.kind, EXC_KINDS[e.kind]?.en ?? e.kind)}</span> <b>{e.whatHappened}</b><span className="grow" /><span className={`small ${e.deadline < T ? "risk-t" : "muted"}`}>{e.owner.name} · {i.day(e.deadline)}</span></header>
                  <p className="small">{dealLabel(e.deal)}{needsCommercial(e.impactAreas) && <span className="sig attn" style={{ marginLeft: 6 }}>{t("Comercial avisado", "Commercial informed")}: {areas.map((a) => t(IMPACT_AREAS[a].es, IMPACT_AREAS[a].en)).join(", ")}</span>}</p>
                  <dl className="qv-dl tight">
                    <dt>{t("Se esperaba", "Expected")}</dt><dd>{e.expected}</dd>
                    <dt>{t("Ocurrió", "Actual")}</dt><dd>{e.actual}</dd>
                    {(e.customerImpact || e.economicImpactUsd != null) && <><dt>{t("Impacto", "Impact")}</dt><dd>{e.customerImpact}{e.economicImpactUsd != null && <span className="mono"> · USD {i.n2(e.economicImpactUsd)}</span>}</dd></>}
                    {e.evidence && <><dt>{t("Evidencia", "Evidence")}</dt><dd>{e.evidence}</dd></>}
                    {opts.length > 0 && <><dt>{t("Opciones", "Options")}</dt><dd>{opts.join(" · ")}</dd></>}
                    <dt>{t("Próximo paso", "Next step")}</dt><dd><b>{e.recommended}</b></dd>
                  </dl>
                  <form action={resolveException.bind(null, e.id)} className="qa-row">
                    <input name="resolution" maxLength={400} placeholder={t("Cómo se resolvió", "How it was resolved")} aria-label={t("Resolución", "Resolution")} style={{ flex: "1 1 240px" }} />
                    <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Marcar resuelta", "Mark resolved")}</button>
                  </form>
                </article>
              );
            })}
            <List rows={h.attention} empty="" />
          </>
        )}
      </section>

      <section className="card" data-zone="flow" id="listo"><b>{t("LISTO PARA EL SIGUIENTE PASO", "READY FOR NEXT STEP")}</b><List rows={h.ready} empty={t("Nada esperando un paso nuestro.", "Nothing waiting on a step from us.")} /></section>

      <section className="card" data-zone="risk" id="promesas">
        <b>{t("PROMESA AL CLIENTE EN RIESGO", "CUSTOMER PROMISE AT RISK")}</b>
        <p className="src">{t(`La promesa al cliente se compara con lo que hoy se espera; la fecha del transportador informa, no reemplaza la promesa. ${h.protectedCount === 1 ? "1 promesa protegida no se lista" : `${h.protectedCount} promesas protegidas no se listan`}.`, `The customer promise is compared with what is expected today; the carrier's date informs, it doesn't replace the promise. ${h.protectedCount === 1 ? "1 protected promise is not listed" : `${h.protectedCount} protected promises are not listed`}.`)}</p>
        {h.atRisk.length === 0 ? <p className="small muted"><span className="sig ok">{t("Ninguna promesa en riesgo.", "No promise at risk.")}</span></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>Journey</th><th>{t("Promesa", "Promise")}</th><th>{t("Esperado hoy", "Expected today")}</th><th>{t("Lectura", "Reading")}</th></tr></thead>
            <tbody>{h.atRisk.map((p) => <tr key={p.deal.id}><td className="small">{dealLabel(p.deal)}<span className="src block">{p.deal.title}</span></td><td className="mono small">{i.day(p.promise)}</td><td className="mono small">{p.expected ? i.day(p.expected) : "—"}</td><td><span className={`sig ${tone[p.health]}`}>{word[p.health]}</span><span className="src block">{t(p.reason.es, p.reason.en)}</span></td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" data-zone="calm" id="espera"><b>{t("ESPERA CON CONTROL", "WAITING WITH CONTROL")}</b><p className="src">{t("Esperas sanas con fecha: no generan tareas hasta que la fecha llegue sin evidencia.", "Healthy, dated waits: they create no tasks until the date arrives without evidence.")}</p><List rows={h.waiting} empty={t("Sin esperas con fecha.", "No dated waits.")} /></section>

      <section className="card" data-zone="plan" id="recursos">
        <b>{t("RECURSOS COMPROMETIDOS", "RESOURCE EXPOSURE")}</b>
        <div className="goal-grid">
          <div className="goal-card"><span className="small muted">{t("Compras abiertas a proveedores", "Open supplier purchases")}</span><b className="tv">USD {i.n2(x.openPurchases)}</b>{x.otherCurrencyPos > 0 && <span className="small">{t(`+ ${x.otherCurrencyPos} en otra moneda`, `+ ${x.otherCurrencyPos} in another currency`)}</span>}</div>
          <div className="goal-card"><span className="small muted">{t("Anticipado, mercancía sin recibir", "Advanced, goods not received")}</span><b className="tv">USD {i.n2(x.advancedNotReceived)}</b></div>
          <div className="goal-card"><span className="small muted">{t(`Pagos a proveedores en ${x.upcomingDays} días`, `Supplier payments in ${x.upcomingDays} days`)}</span><b className="tv">USD {i.n2(x.upcomingPayments)}</b></div>
          <div className="goal-card"><span className="small muted">{t("Cartera de clientes abierta", "Open customer receivables")}</span><b className="tv">USD {i.n2(x.customerOpen)}</b>{x.customerOverdue > 0 && <span className="small risk-t">{t(`USD ${i.n2(x.customerOverdue)} vencida`, `USD ${i.n2(x.customerOverdue)} overdue`)}</span>}</div>
        </div>
        {x.topSuppliers.length > 0 && <p className="small">{t("Mayor exposición por proveedor", "Largest exposure by supplier")}: {x.topSuppliers.map((s) => `${s.name} (USD ${i.n2(s.open)}${s.advanced > 0 ? t(`, anticipado ${i.n2(s.advanced)}`, `, advanced ${i.n2(s.advanced)}`) : ""})`).join(" · ")}</p>}
        <p className="src">{t("Hechos, no puntajes. Inventario y exposición cambiaria llegan con las siguientes etapas del módulo; oportunidades de rentabilidad, con la etapa de compras.", "Facts, not scores. Inventory and FX exposure arrive with later stages of the module; profitability opportunities, with the purchasing stage.")}</p>
      </section>
    </>
  );
}
