import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { expectedPaymentDays } from "@/lib/pay-behavior";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { addDays, dayInput, daysBetween } from "@/lib/domain";
import { buildQuote, policyFloor, quoteInclude, quoteNo, saleOf } from "@/lib/quote";
import { Popovers } from "@/components/Popovers";
import {
  createRevision, markDeclined, presentQuote, recommendScenario, removeLine, removeScenario,
  saveCosts, saveLine, saveScenario, saveSolution, saveTerms, waitWithControl,
} from "../actions";
import { registerPo } from "../../po/actions";
import { lineAmount } from "@/lib/money";

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; cmp?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const [q, policy, pos, dealInvoices] = await Promise.all([
    db.quote.findUnique({ where: { id }, include: quoteInclude }),
    policyFloor(),
    db.customerPO.findMany({ where: { quoteId: id }, orderBy: { receivedAt: "desc" }, select: { id: true, number: true, receivedAt: true, rejectedAt: true, acceptance: { select: { id: true } } } }),
    db.invoice.findMany({ where: { deal: { quotes: { some: { id } } } }, orderBy: { issuedAt: "asc" }, select: { id: true, number: true, amount: true, issuedAt: true } }),
  ]);
  if (!q) notFound();
  const B = buildQuote(q, i, policy);
  const pay = await expectedPaymentDays(q.deal.accountId);
  const d = q.deal;
  const editable = canEdit(user, d.ownerId);
  const draft = q.status === "DRAFT";
  const siblings = d.quotes.filter((x) => x.number === q.number);
  const latest = siblings[siblings.length - 1];
  const todayStr = dayInput(B.now);
  const contact = d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : null;

  const statusSig = {
    DRAFT: { c: "dash", x: t("Borrador interno", "Internal draft") },
    PRESENTED: { c: "info", x: t(`Presentada ${i.day(q.presentedAt)}`, `Presented ${i.day(q.presentedAt)}`) },
    SUPERSEDED: { c: "wait", x: t("Reemplazada por una revisión", "Replaced by a revision") },
    ACCEPTED: { c: "ok", x: t(`Aceptada ${i.day(q.decidedAt)}`, `Accepted ${i.day(q.decidedAt)}`) },
    DECLINED: { c: "wait", x: t("No aceptada", "Not accepted") },
  }[q.status];

  const okMsg: Record<string, string> = {
    correo: t("Correo enviado al cliente desde la cuenta de la empresa. Quedó registrado en el Journey.", "Email sent to the customer from the company account. It's logged on the Journey."),
    creada: t("Cotización creada con los productos y costos del Journey.", "Quote created from the Journey's products and costs."),
    abierta: t("Ya había un borrador abierto: es este.", "There was already an open draft: this one."),
    solucion: t("Solución y promesa guardadas.", "Solution and promise saved."),
    costos: t("Costos guardados. SOLU recalculó la economía esperada.", "Costs saved. SOLU recalculated the expected economics."),
    condiciones: t("Condiciones guardadas.", "Terms saved."),
    linea: t("Productos actualizados.", "Products updated."),
    escenario: t("Escenarios actualizados.", "Scenarios updated."),
    recomendado: t("Escenario recomendado: el plazo de la cotización lo sigue.", "Scenario recommended: the quote's lead time follows it."),
    presentada: t("Presentada. La economía quedó protegida y esta versión ya no cambia. Ahora el foco es cómo decide el cliente.", "Presented. Economics are protected and this version no longer changes. Now the focus is how the customer decides."),
    revision: t("Revisión creada con el mismo número. La versión presentada queda intacta.", "Revision created with the same number. The presented version stays intact."),
    aceptada: t("Aceptada. La OC quedó en el Journey; ya se puede facturar al entregar.", "Accepted. The PO is on the Journey; it can be invoiced on delivery."),
    rechazada: t("Registrado: el cliente no aceptó.", "Recorded: the customer did not accept."),
    espera: t("Esperando con control. SOLU lo devuelve a Mi Día en la fecha indicada.", "Waiting with control. SOLU brings it back to My Day on the given date."),
  };
  const errMsg: Record<string, string> = {
    presentada: t("Esta versión ya fue presentada y no cambia. Crea una revisión.", "This version was already presented and doesn't change. Create a revision."),
    bloqueada: t("Todavía hay puntos que impiden presentarla (ver «Lista para presentar»).", "There are still items that block presenting it (see “Ready to Present”)."),
    "sin-oc": t("Escribe el número de OC del cliente.", "Write the customer's PO number."),
    espera: t("Escribe qué esperas y hasta cuándo.", "Write what you're waiting for and until when."),
    estado: t("Esta acción no aplica en el estado actual.", "This action doesn't apply in the current state."),
  };

  const QA = ({ label, children, wide, right, cls = "" }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; right?: boolean; cls?: string }) => (
    <details className={`qa ${cls}`}>
      <summary className="qa-btn">{label}</summary>
      <div className={`qa-pop${wide ? " wide" : ""}${right ? " right" : ""}`}>{children}</div>
    </details>
  );
  const money = (v: number | null | undefined) => (v == null ? "—" : `USD ${i.n2(v)}`);
  const pdf = (lang: "EN" | "ES") => `/documentos/cotizacion/${q.id}?lang=${lang}`;
  const Check = ({ ok, text, fix }: { ok: boolean; text: string; fix?: string }) => (
    <li className={ok ? "ok" : "no"}>
      <span className="ic" aria-hidden>{ok ? "✓" : "!"}</span>
      <span>{text}{!ok && fix && <span className="src block">{fix}</span>}</span>
    </li>
  );

  // ---------- Header ----------
  const Header = () => (
    <header className="jh">
      <div className="jh-top">
        <p className="crumb k"><Link href={`/deals/${d.id}?tab=quote`}>{d.code ?? "Journey"}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
        <span className="jid">Quote Nº {quoteNo(q)}</span>
        <span className="grow" />
        <div className="jh-act">
          <a className="qa-btn" href={pdf(q.lang)} target="_blank" rel="noopener">{t("Ver PDF", "View PDF")} ({q.lang})</a>
          <a className="qa-btn" href={pdf(q.lang === "EN" ? "ES" : "EN")} target="_blank" rel="noopener">{q.lang === "EN" ? "ES" : "EN"}</a>
          {editable && !draft && q.status !== "SUPERSEDED" && <Link className="qa-btn" href={`/correo/nuevo?tpl=OFFER&id=${q.id}`}>{t("Enviar al cliente por correo", "Email to customer")}</Link>}
          {editable && !draft && q.status !== "SUPERSEDED" && q.status !== "ACCEPTED" && (
            <form action={createRevision.bind(null, q.id)}><button type="submit" className="qa-btn">{t("Crear revisión", "Create revision")}</button></form>
          )}
        </div>
      </div>
      <div className="jh-title">
        <h1>{d.title}</h1>
        <span className={`sig ${statusSig.c}`}>{statusSig.x}</span>
      </div>
      <p className="jh-sub">{contact ? `${contact} · ` : ""}{t("Responsable", "Owner")}: {d.owner.name}{d.desiredResult ? ` · ${t("Resultado del cliente", "Customer result")}: ${d.desiredResult}` : ""}</p>
      {siblings.length > 1 && (
        <nav className="qv-revs" aria-label={t("Versiones", "Versions")}>
          {siblings.map((s) => (
            <Link key={s.id} href={`/cotizaciones/${s.id}`} className={`qv-rev${s.id === q.id ? " on" : ""}`}>
              {s.rev === 0 ? t("Original", "Original") : `Rev. ${s.rev}`}
              <small>{s.status === "DRAFT" ? t("borrador", "draft") : s.status === "SUPERSEDED" ? t("reemplazada", "replaced") : s.status === "PRESENTED" ? t("presentada", "presented") : s.status === "ACCEPTED" ? t("aceptada", "accepted") : t("no aceptada", "declined")}</small>
            </Link>
          ))}
        </nav>
      )}
    </header>
  );

  // ---------- Solution ----------
  const Solution = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("SOLUCIÓN", "SOLUTION")}</b><span className="grow" />
        {editable && draft && (
          <QA label={t("Editar", "Edit")} wide right>
            <form action={saveSolution.bind(null, q.id)} className="qa-form">
              <label>{t("La solución en una frase (qué logra el cliente)", "The solution in one sentence (what the customer achieves)")}<textarea name="solution" rows={2} maxLength={400} defaultValue={q.solution ?? ""} /></label>
              <label>{t("Base de suministro principal", "Primary supply basis")}<input name="supplyPrimary" maxLength={300} defaultValue={q.supplyPrimary ?? ""} /></label>
              <label>{t("Alternativa", "Alternative")}<input name="supplyAlt" maxLength={300} defaultValue={q.supplyAlt ?? ""} /></label>
              <label>{t("Promesa posible", "Possible promise")}<input name="promiseText" maxLength={300} defaultValue={q.promiseText ?? ""} /></label>
              <label>{t("Condición de la promesa", "Promise condition")}<input name="promiseCondition" maxLength={300} defaultValue={q.promiseCondition ?? ""} placeholder={t("Ej.: si la OC llega antes del viernes", "E.g.: if the PO arrives before Friday")} /></label>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </QA>
        )}
      </div>
      {q.solution ? <p className="qv-sol">{q.solution}</p> : <p className="quiet-p">{t("Escribe en una frase qué logra el cliente con esta cotización. No es la lista de productos.", "Write in one sentence what the customer achieves with this quote. Not the product list.")}</p>}
      <dl className="qv-dl">
        <dt>{t("Necesidad", "Need")}</dt><dd>{d.needSpecs ? d.needSpecs.split("\n")[0] : "—"}</dd>
        <dt>{t("Resultado que protege", "Result it protects")}</dt><dd>{d.desiredResult ?? <span className="attn-t">{t("Sin escribir", "Not written")}</span>}</dd>
        <dt>{t("Suministro", "Supply basis")}</dt><dd>{q.supplyPrimary ?? "—"}{q.supplyAlt && <span className="src block">{t("Alternativa", "Alternative")}: {q.supplyAlt}</span>}</dd>
        <dt>{t("Promesa posible", "Possible promise")}</dt>
        <dd>{q.promiseText ? <><b>{q.promiseText}</b>{q.promiseCondition && <span className="qv-cond">{t("Condición", "Condition")}: {q.promiseCondition}</span>}</> : "—"}</dd>
      </dl>
    </section>
  );

  // ---------- Collection days (§10.4): agreed vs what history says ----------
  const PayLine = () => (pay ? <p className="small" style={{ marginTop: 10 }}>{t("Cobro", "Collection")}: {t(`plazo pactado ${pay.contractualDays} d`, `${pay.contractualDays}-day agreed terms`)}{pay.expectedDays != null ? <> · {t(`según historial ${pay.expectedDays} d`, `history says ${pay.expectedDays} d`)}{pay.deltaDays ? <b className={pay.deltaDays > 0 ? "attn-t" : ""}> ({pay.deltaDays > 0 ? "+" : ""}{pay.deltaDays} {t("días de financiación", "days of financing")})</b> : null}<span className="src"> · {t(`promedio de ${pay.n} factura(s) cobrada(s) y conciliada(s)${pay.enough ? "" : ", orientativo"}`, `average of ${pay.n} collected and reconciled invoice(s)${pay.enough ? "" : ", indicative"}`)} · <Link href={`/mercado/empresas/${q.deal.accountId}#pagos`}>{t("cómo paga", "how they pay")}</Link></span></> : <span className="src"> · {t("sin historial de cobro todavía", "no collection history yet")}</span>}</p> : null);

  // ---------- Economics ----------
  const Economics = () => {
    const v = B.versions;
    const showVersions = v.length > 1;
    const rows: { k: string; label: string; src: string | null; get: (x: (typeof v)[number]) => number }[] = [
      { k: "supplier", label: t("Proveedor", "Supplier"), src: q.supplierSrc, get: (x) => x.supplier },
      { k: "freight", label: t("Fletes", "Freight"), src: q.freightSrc, get: (x) => x.freight },
      { k: "other", label: t("Otros (aduana, seguro…)", "Other (customs, insurance…)"), src: q.otherSrc, get: (x) => x.other },
    ];
    const prev = v.length > 1 ? v[v.findIndex((x) => x.current) - 1] : undefined;
    const why = q.changeNote;
    return (
      <section className="jblock">
        <div className="jbh"><b>ECONOMICS</b><span className="grow" />
          {editable && draft && (
            <QA label={t("Editar costos", "Edit costs")} wide right>
              <form action={saveCosts.bind(null, q.id)} className="qa-form">
                <div className="qa-row">
                  <label>{t("Moneda del proveedor", "Supplier currency")}<input name="costCurrency" maxLength={3} defaultValue={q.costCurrency} style={{ width: 70 }} /></label>
                  <label>{t("Tasa a USD", "Rate to USD")}<input name="fxRate" type="number" step="0.000001" min="0" defaultValue={q.fxRate ? Number(q.fxRate) : ""} /></label>
                </div>
                <label>{t("Fuente de la tasa", "Rate source")}<input name="fxSource" maxLength={200} defaultValue={q.fxSource ?? ""} placeholder={t("Ej.: banco, 5 nov 10:00", "E.g.: bank, Nov 5 10:00")} /></label>
                <div className="qa-row"><label>{t("Proveedor", "Supplier")}<input name="supplierCost" type="number" step="0.01" min="0" defaultValue={Number(q.supplierCost)} /></label><label>{t("Fuente", "Source")}<input name="supplierSrc" maxLength={200} defaultValue={q.supplierSrc ?? ""} placeholder="Proforma…" /></label></div>
                <div className="qa-row"><label>{t("Fletes USD", "Freight USD")}<input name="freightCost" type="number" step="0.01" min="0" defaultValue={Number(q.freightCost)} /></label><label>{t("Fuente", "Source")}<input name="freightSrc" maxLength={200} defaultValue={q.freightSrc ?? ""} /></label></div>
                <div className="qa-row"><label>{t("Otros USD", "Other USD")}<input name="otherCosts" type="number" step="0.01" min="0" defaultValue={Number(q.otherCosts)} /></label><label>{t("Fuente", "Source")}<input name="otherSrc" maxLength={200} defaultValue={q.otherSrc ?? ""} /></label></div>
                <label>{t("¿Por qué cambió respecto a la versión anterior?", "Why did it change from the previous version?")}<input name="changeNote" maxLength={300} defaultValue={q.changeNote ?? ""} /></label>
                <button type="submit">{t("Guardar costos", "Save costs")}</button>
              </form>
            </QA>
          )}
        </div>

        <div className="qv-econ">
          <div className={`qv-box prot${q.protSale == null ? " pending" : ""}`}>
            <span className="k">{t("Economía protegida", "Protected economics")}</span>
            {q.protSale == null ? (
              <><b className="tv muted">—</b><span className="src">{t("Se fija al presentar. Después no cambia, aunque cambien los costos.", "Fixed when presenting. It doesn't change afterwards, even if costs change.")}</span></>
            ) : (
              <><b className="tv">{money(Number(q.protEsagra))}</b><span className="tsub">{i.pct((Number(q.protEsagra) / Number(q.protSale)) * 100)} {t("de", "of")} {money(Number(q.protSale))}</span><span className="src">{t(`Fijada el ${i.day(q.presentedAt)} · política v${q.protPolicy ?? "—"}`, `Fixed on ${i.day(q.presentedAt)} · policy v${q.protPolicy ?? "—"}`)}</span></>
            )}
          </div>
          <div className={`qv-box cur${B.econAlert || B.belowFloor ? " alert" : ""}`}>
            <span className="k">{t("Economía esperada actual", "Current expected economics")}</span>
            <b className="tv">{money(draft ? B.esagra : B.curEsagra)}</b>
            <span className="tsub">{i.pct(draft ? B.pct : B.curPct)} {t("de", "of")} {money(draft ? B.sale : B.curSale)}</span>
            <span className="src">{draft ? t("Se recalcula con cada cambio.", "Recalculated with every change.") : B.econChanged ? t(`Los costos cambiaron desde la presentación: ${money(B.currentCost)} hoy.`, `Costs changed since presenting: ${money(B.currentCost)} today.`) : t("Sin cambios de costo desde la presentación.", "No cost changes since presenting.")}</span>
          </div>
          <div className="qv-box pol">
            <span className="k">{t("Política comercial", "Commercial policy")}</span>
            <b className="tv">{policy.floorPct != null ? `≥ ${policy.floorPct} %` : "—"}</b>
            <span className="src">{policy.version ? t(`Piso de eságara de la política v${policy.version}. SOLU no inventa fórmulas.`, `Eságara floor of policy v${policy.version}. SOLU doesn't invent formulas.`) : t("No hay política cargada.", "No policy loaded.")}</span>
          </div>
        </div>
        <PayLine />
        {(B.econAlert || (draft && B.belowFloor)) && <p className="qv-alert">{t("La eságara queda por debajo del piso de la política. Revisa precio o costos, o pide aprobación a Gerencia.", "Eságara falls below the policy floor. Review price or costs, or ask Management to approve.")}</p>}

        <div className="tscroll" style={{ marginTop: 14 }}>
          <table className="qv-cost">
            <thead>
              <tr>
                <th>{t("Costo puesto en destino", "Landed cost")}</th>
                {showVersions ? v.map((x) => <th key={x.id} className={`n${x.current ? " cur" : ""}`}>{x.rev === 0 ? t("Original", "Original") : `Rev. ${x.rev}`}</th>) : <th className="n">USD</th>}
                <th>{t("Fuente", "Source")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td>{r.label}</td>
                  {(showVersions ? v : v.filter((x) => x.current)).map((x) => {
                    const p = prev && x.current ? r.get(prev) : null;
                    const changed = p != null && Math.abs(p - r.get(x)) > 0.5;
                    return <td key={x.id} className={`n val${x.current ? " cur" : ""}${changed ? " chg" : ""}`}>{i.n2(r.get(x))}{changed && <span className="delta">{r.get(x) > p! ? "▲" : "▼"} {i.n2(Math.abs(r.get(x) - p!))}</span>}</td>;
                  })}
                  <td className="src">{r.src ?? (r.get(v.find((x) => x.current) ?? v[0]) > 0 ? <span className="attn-t">{t("sin fuente", "no source")}</span> : "—")}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>{t("Total costo", "Total cost")}</td>
                {(showVersions ? v : v.filter((x) => x.current)).map((x) => <td key={x.id} className={`n val${x.current ? " cur" : ""}`}>{i.n2(x.supplier + x.freight + x.other)}</td>)}
                <td />
              </tr>
              <tr>
                <td>{t("Venta", "Sale")}</td>
                {(showVersions ? v : v.filter((x) => x.current)).map((x) => <td key={x.id} className={`n val${x.current ? " cur" : ""}`}>{i.n2(x.sale)}</td>)}
                <td />
              </tr>
              <tr className="tot">
                <td>Eságara</td>
                {(showVersions ? v : v.filter((x) => x.current)).map((x) => { const e = x.sale - x.supplier - x.freight - x.other; return <td key={x.id} className={`n val${x.current ? " cur" : ""}`}>{i.n2(e)}<span className="src block">{x.sale > 0 ? i.pct((e / x.sale) * 100) : "—"}</span></td>; })}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        {why && <p className="qv-why"><b>{t("Por qué cambió", "Why it changed")}:</b> {why}</p>}
        <p className="src" style={{ marginTop: 8 }}>
          {q.costCurrency === "USD" || !q.fxRate
            ? t("Sin exposición cambiaria: proveedor y cliente en USD.", "No FX exposure: supplier and customer in USD.")
            : t(`Tasa ${q.costCurrency}→USD ${Number(q.fxRate)} · ${q.fxSource ?? "fuente sin registrar"}. Si la tasa se mueve antes de pagar al proveedor, cambia la eságara.`, `Rate ${q.costCurrency}→USD ${Number(q.fxRate)} · ${q.fxSource ?? "source not recorded"}. If the rate moves before paying the supplier, eságara changes.`)}
        </p>
      </section>
    );
  };

  // ---------- Scenarios (optional) ----------
  const Scenarios = () => {
    const sc = q.scenarios;
    if (sc.length === 0 && !(editable && draft)) return null;
    const rec = sc.find((s) => s.recommended);
    return (
      <section className="jblock">
        <div className="jbh"><b>{t("ESCENARIOS", "SCENARIOS")}</b><span>{t("opcional · solo si ayudan a decidir", "optional · only if they help decide")}</span><span className="grow" />
          {editable && draft && (
            <QA label={t("+ Escenario", "+ Scenario")} wide right>
              <ScenarioForm />
            </QA>
          )}
        </div>
        {sc.length === 0 ? <p className="quiet-p">{t("Sin escenarios. Agrégalos solo si el cliente gana algo al comparar (más rápido, más barato).", "No scenarios. Add them only if the customer gains something by comparing (faster, cheaper).")}</p> : (
          <>
            <div className="qv-scen" style={{ gridTemplateColumns: `140px repeat(${sc.length}, minmax(150px, 1fr))` }}>
              <div className="h" />
              {sc.map((s) => <div key={s.id} className={`h${s.recommended ? " rec" : ""}`}><b>{s.label}</b>{s.recommended && <span className="sig info">{t("Recomendado", "Recommended")}</span>}</div>)}
              <div className="k">{t("Precio", "Price")}</div>
              {sc.map((s) => <div key={s.id} className={`v mono${s.recommended ? " rec" : ""}`}>{money(Number(s.price))}</div>)}
              <div className="k">{t("Entrega", "Delivery")}</div>
              {sc.map((s) => <div key={s.id} className={`v${s.recommended ? " rec" : ""}`}>{s.leadMinDays}–{s.leadMaxDays} {t("días", "days")}<span className="src block">{i.day(addDays(B.now, s.leadMinDays))} – {i.day(addDays(B.now, s.leadMaxDays))}</span></div>)}
              <div className="k">Eságara</div>
              {sc.map((s) => { const e = Number(s.price) - Number(s.cost); const p = Number(s.price) > 0 ? (e / Number(s.price)) * 100 : null; const low = policy.floorPct != null && p != null && p < policy.floorPct; return <div key={s.id} className={`v mono${s.recommended ? " rec" : ""}${low ? " low" : ""}`}>{i.pct(p)}{low && <span className="src block">{t("bajo el piso", "below floor")}</span>}</div>; })}
              <div className="k">{t("Riesgo", "Risk")}</div>
              {sc.map((s) => <div key={s.id} className={`v${s.recommended ? " rec" : ""}`}>{s.risk ?? "—"}</div>)}
              <div className="k">{t("Promesa", "Promise")}</div>
              {sc.map((s) => <div key={s.id} className={`v${s.recommended ? " rec" : ""}`}>{s.promise ?? "—"}</div>)}
              {editable && draft && <div className="k" />}
              {editable && draft && sc.map((s) => (
                <div key={s.id} className={`v act${s.recommended ? " rec" : ""}`}>
                  {!s.recommended && <form action={recommendScenario.bind(null, q.id, s.id)}><button type="submit" className="link small">{t("Recomendar este", "Recommend this")}</button></form>}
                  <form action={removeScenario.bind(null, q.id, s.id)}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>
                </div>
              ))}
            </div>
            {rec?.why && <p className="ai-note" style={{ marginTop: 10 }}>{t("Por qué SOLU recomienda", "Why SOLU recommends")} «{rec.label}»: {rec.why}</p>}
          </>
        )}
      </section>
    );
  };
  const ScenarioForm = () => (
    <form action={saveScenario.bind(null, q.id, null)} className="qa-form">
      <label>{t("Nombre", "Name")}<input name="label" required maxLength={60} placeholder={t("Más rápido / Recomendado / Más económico", "Faster / Recommended / Cheaper")} /></label>
      <div className="qa-row"><label>{t("Precio USD", "Price USD")}<input name="price" type="number" min="0" step="0.01" required /></label><label>{t("Costo USD", "Cost USD")}<input name="cost" type="number" min="0" step="0.01" required /></label></div>
      <div className="qa-row"><label>{t("Días mín.", "Min days")}<input name="leadMinDays" type="number" min="0" required /></label><label>{t("Días máx.", "Max days")}<input name="leadMaxDays" type="number" min="0" required /></label></div>
      <label>{t("Riesgo", "Risk")}<input name="risk" maxLength={200} /></label>
      <label>{t("Promesa posible", "Possible promise")}<input name="promise" maxLength={200} /></label>
      <label>{t("Por qué lo recomendarías (si aplica)", "Why you'd recommend it (if so)")}<input name="why" maxLength={300} /></label>
      <button type="submit">{t("Agregar escenario", "Add scenario")}</button>
    </form>
  );

  // ---------- Lines ----------
  const Lines = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("PRODUCTOS EN EL DOCUMENTO", "PRODUCTS ON THE DOCUMENT")}</b><span className="grow" /><span className="src">Total USD {i.n2(B.sale)}</span></div>
      <div className="tscroll">
        <table>
          <thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th className="n">Total</th>{editable && draft && <th />}</tr></thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.id}>
                <td className="val">{l.qty}</td><td className="mono small">{l.code ?? "—"}</td><td>{l.description}</td>
                <td className={`n val${Number(l.unitPrice) <= 0 ? " attn-t" : ""}`}>{Number(l.unitPrice) > 0 ? i.n2(l.unitPrice) : t("sin precio", "no price")}</td>
                <td className="n val">{i.n2(lineAmount(l.qty, l.unitPrice))}</td>
                {editable && draft && (
                  <td className="nowrap">
                    <QA label={t("Editar", "Edit")} right>
                      <form action={saveLine.bind(null, q.id, l.id)} className="qa-form">
                        <div className="qa-row"><label>{t("Cant.", "Qty")}<input name="qty" type="number" min="1" defaultValue={l.qty} /></label><label>{t("Código", "Code")}<input name="code" defaultValue={l.code ?? ""} /></label></div>
                        <label>{t("Descripción", "Description")}<input name="description" defaultValue={l.description} required /></label>
                        <label>{t("Precio unit. USD", "Unit price USD")}<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={Number(l.unitPrice)} /></label>
                        <button type="submit">{t("Guardar", "Save")}</button>
                      </form>
                    </QA>
                    <form action={removeLine.bind(null, q.id, l.id)} style={{ display: "inline" }}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && draft && (
        <details style={{ marginTop: 10 }}>
          <summary>{t("Agregar producto", "Add product")}</summary>
          <form action={saveLine.bind(null, q.id, null)} className="inline">
            <label>{t("Cant.", "Qty")}<input name="qty" type="number" min="1" defaultValue="1" required style={{ width: 70 }} /></label>
            <label>{t("Código", "Code")}<input name="code" style={{ width: 140 }} /></label>
            <label style={{ flex: 1 }}>{t("Descripción", "Description")}<input name="description" required /></label>
            <label>{t("Precio unit. USD", "Unit price USD")}<input name="unitPrice" type="number" min="0" step="0.01" style={{ width: 120 }} /></label>
            <button type="submit">{t("Agregar", "Add")}</button>
          </form>
        </details>
      )}
    </section>
  );

  // ---------- Terms + decision ----------
  const Terms = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("CONDICIONES DEL DOCUMENTO", "DOCUMENT TERMS")}</b><span className="grow" /><span className="src">{t("Idioma del documento", "Document language")}: {q.lang}</span></div>
      <dl className="qv-dl">
        <dt>Lead Time</dt><dd>{B.leadText ?? <span className="attn-t">{t("Sin definir", "Not set")}</span>}<span className="src block">{t("Calculado desde los días después de la OC; no se escribe a mano.", "Calculated from days after PO; never typed by hand.")}</span></dd>
        <dt>Shipping Terms</dt><dd>{q.incoterm ?? "—"}</dd>
        <dt>Payment Due</dt><dd>{q.paymentTerms ?? "—"}</dd>
        <dt>Validity</dt><dd>{t(`${q.validityDays} días`, `${q.validityDays} days`)} {draft ? <span className="src">{t("(corren desde que se presenta)", "(run from presenting)")}</span> : `(${t("hasta", "until")} ${i.date(B.offerUntil)})`}</dd>
        <dt>Condition</dt><dd>{q.condition}</dd>
        <dt>Bill to</dt><dd className="pre">{q.billTo ?? "—"}</dd>
        <dt>Ship to</dt><dd className="pre">{q.shipTo ?? "—"}</dd>
      </dl>
      {editable && draft && (
        <details style={{ marginTop: 10 }}>
          <summary>{t("Editar condiciones", "Edit terms")}</summary>
          <TermsForm />
        </details>
      )}
    </section>
  );
  const TermsForm = ({ decisionOnly = false }: { decisionOnly?: boolean }) => (
    <form action={saveTerms.bind(null, q.id)} className="stack jform">
      {!decisionOnly && (
        <>
          <div className="qa-row">
            <label>{t("Idioma del documento", "Document language")}<select name="lang" defaultValue={q.lang}><option value="EN">English</option><option value="ES">Español</option></select></label>
            <label>{t("Días mín. después de OC", "Min days after PO")}<input name="leadMinDays" type="number" min="0" defaultValue={q.leadMinDays ?? ""} /></label>
            <label>{t("Días máx.", "Max days")}<input name="leadMaxDays" type="number" min="0" defaultValue={q.leadMaxDays ?? ""} /></label>
          </div>
          <div className="qa-row">
            <label>Incoterm<input name="incoterm" defaultValue={q.incoterm ?? ""} placeholder="DAP Bogotá" /></label>
            <label>Payment terms<input name="paymentTerms" defaultValue={q.paymentTerms ?? ""} placeholder="Net 30" /></label>
            <label>{t("Vigencia (días)", "Validity (days)")}<input name="validityDays" type="number" min="1" defaultValue={q.validityDays} /></label>
            <label>Condition<input name="condition" defaultValue={q.condition} /></label>
          </div>
          <div className="qa-row">
            <label>Bill to<textarea name="billTo" rows={3} defaultValue={q.billTo ?? ""} /></label>
            <label>Ship to<textarea name="shipTo" rows={3} defaultValue={q.shipTo ?? ""} /></label>
          </div>
        </>
      )}
      <b className="small">{t("Cómo decide el cliente", "How the customer decides")}</b>
      <div className="qa-row">
        <label>{t("Momento de decisión", "Decision moment")}<input name="decisionLabel" maxLength={80} defaultValue={q.decisionLabel ?? ""} placeholder={t("Comité de compras", "Purchasing committee")} /></label>
        <label>{t("Fecha", "Date")}<input name="decisionAt" type="date" defaultValue={dayInput(q.decisionAt)} /></label>
      </div>
      <label>{t("Quién pide, quién recomienda, quién emite la OC", "Who asks, who recommends, who issues the PO")}<input name="decisionPath" maxLength={400} defaultValue={q.decisionPath ?? ""} /></label>
      <label>{t("Evidencia (quién lo dijo y cuándo)", "Evidence (who said it and when)")}<input name="decisionEvidence" maxLength={300} defaultValue={q.decisionEvidence ?? ""} /></label>
      <div className="qa-row">
        <label>{t("Vigencia del proveedor hasta", "Supplier validity until")}<input name="supplierValidUntil" type="date" defaultValue={dayInput(q.supplierValidUntil)} /></label>
        <label>{t("La promesa se sostiene si decide antes de", "Promise holds if they decide by")}<input name="promiseDecideBy" type="date" defaultValue={dayInput(q.promiseDecideBy)} /></label>
      </div>
      <label className="chk"><input type="checkbox" name="supplyConfirmed" value="1" defaultChecked={q.supplyConfirmed} /> {t("El proveedor confirmó disponibilidad y plazo", "Supplier confirmed availability and lead time")}</label>
      <button type="submit">{t("Guardar", "Save")}</button>
    </form>
  );

  // ---------- Rail before presenting ----------
  const ReadyRail = () => (
    <aside className="jrail">
      <div>
        <div className="jbh"><b>READY TO PRESENT</b><span className="grow" />{B.blocking.length === 0 ? <span className="sig ok">{t("Lista", "Ready")}</span> : <span className="sig attn">{t(`${B.blocking.length} pendiente(s)`, `${B.blocking.length} open`)}</span>}</div>
        <ul className="qv-checks">{B.ready.map((c, n) => <Check key={n} {...c} />)}</ul>
        {editable && B.blocking.length === 0 && (
          <form action={presentQuote.bind(null, q.id)} className="qa-form" style={{ marginTop: 12 }}>
            <div className="qa-row">
              <input name="presentedOn" type="date" defaultValue={todayStr} aria-label={t("Fecha", "Date")} />
              <input name="how" placeholder={t("Cómo (correo, reunión…)", "How (email, meeting…)")} maxLength={200} style={{ flex: 1 }} />
            </div>
            <button type="submit" className="wide">{t("Presentar al cliente", "Present to customer")}</button>
            <span className="src">{t("Crea la versión que ya no cambia y protege su economía. Descarga el PDF para enviarlo.", "Creates the version that no longer changes and protects its economics. Download the PDF to send it.")}</span>
          </form>
        )}
      </div>
      <div>
        <div className="jbh"><b>{t("SI EL CLIENTE DICE SÍ HOY", "READY IF CUSTOMER SAYS YES")}</b></div>
        <p className="src" style={{ marginBottom: 6 }}>{t("No impide presentar. Dice qué fallaría si aceptara ahora.", "Doesn't block presenting. Says what would fail if they accepted now.")}</p>
        <ul className="qv-checks soft">{B.ifYes.map((c, n) => <Check key={n} {...c} />)}</ul>
      </div>
      <div>
        <div className="jbh"><b>{t("CÓMO DECIDE", "HOW THEY DECIDE")}</b><span className="grow" />{editable && <QA label={t("Editar", "Edit")} wide right><TermsForm decisionOnly /></QA>}</div>
        <DecisionFacts />
      </div>
    </aside>
  );

  const DecisionFacts = () => (
    <dl className="qv-dl tight">
      <dt>{t("Decide", "Decides")}</dt><dd>{q.decisionLabel ? <b>{q.decisionLabel}</b> : "—"}{q.decisionAt && ` · ${i.dateShort(q.decisionAt)}`}</dd>
      <dt>{t("Camino", "Path")}</dt><dd>{q.decisionPath ?? <span className="muted">{t("Sin averiguar", "Not found out yet")}</span>}</dd>
      {q.decisionEvidence && <><dt>{t("Evidencia", "Evidence")}</dt><dd className="src">{q.decisionEvidence}</dd></>}
    </dl>
  );

  // ---------- Customer Decision Future ----------
  const Clocks = () => {
    const end = B.clocks.length ? B.clocks[B.clocks.length - 1].at : addDays(B.now, 14);
    const span = Math.max(7, daysBetween(B.now, end) + 2);
    const pos = (at: Date) => `${Math.min(100, Math.max(0, (daysBetween(B.now, at) / span) * 100))}%`;
    const days = Array.from({ length: span + 1 }, (_, n) => addDays(B.now, n));
    const kindLabel = { customer: t("Cliente", "Customer"), promise: t("Promesa", "Promise"), supplier: t("Proveedor", "Supplier"), offer: t("Oferta", "Offer") };
    return (
      <section className="jblock">
        <div className="jbh"><b>{t("VENTANA DE INFLUENCIA", "INFLUENCE WINDOW")}</b><span className="grow" />
          {B.windowEnd && <span className="src">{daysBetween(B.now, B.windowEnd) >= 0 ? t(`${daysBetween(B.now, B.windowEnd)} día(s) en los que una acción todavía cambia el resultado`, `${daysBetween(B.now, B.windowEnd)} day(s) where an action still changes the result`) : t("La ventana ya se cerró", "The window has closed")}</span>}
        </div>
        <div className="tl-wrap">
          <div className="qv-tl">
            <div className="qv-tl-days">
              {days.map((dd, n) => (n > 0 && n % Math.ceil(span / 10) === 0 && n / span < 0.95 ?<span key={n} style={{ left: pos(dd) }}>{i.weekday(dd)} {dd.getUTCDate()}</span> : null))}
            </div>
            <div className="qv-tl-track">
              {B.windowEnd && <span className="win" style={{ left: 0, width: pos(B.windowEnd) }} />}
              <span className="now" style={{ left: 0 }}><i>{t("Hoy", "Today")}</i></span>
              {B.clocks.map((c) => <span key={c.key} className={`mk ${c.kind}`} style={{ left: pos(c.at) }} title={`${c.label} · ${i.dateShort(c.at)}`} />)}
            </div>
          </div>
        </div>
        <div className="qv-clocks">
          {B.clocks.map((c) => {
            const left = daysBetween(B.now, c.at);
            return (
              <div key={c.key} className={`qv-clock ${c.kind}`}>
                <span className="k">{kindLabel[c.kind]}</span>
                <b>{c.label}</b>
                <span className="mono">{i.dateShort(c.at)}</span>
                <span className={`src${left < 0 ? " risk-t" : ""}`}>{left > 1 ? t(`en ${left} días`, `in ${left} days`) : left === 1 ? t("mañana", "tomorrow") : left === 0 ? t("hoy", "today") : t(`hace ${-left} días`, `${-left} days ago`)}</span>
              </div>
            );
          })}
        </div>
        <p className="src" style={{ marginTop: 8 }}>{t("Dos relojes que no se mezclan: la vigencia de la oferta (precio para el cliente) y la vigencia de la promesa (fecha de entrega que se puede sostener).", "Two clocks that never mix: offer validity (price for the customer) and promise validity (delivery date we can still hold).")}</p>
      </section>
    );
  };

  const DecisionRail = () => {
    const n = B.next;
    return (
      <aside className="jrail">
        {q.status === "PRESENTED" && n && (
          <div className="nm">
            <span className="k">{n.kind === "wait" ? t("ESPERANDO CON CONTROL", "WAITING WITH CONTROL") : t("SIGUIENTE MOVIMIENTO ÚTIL", "NEXT USEFUL MOVEMENT")}</span>
            <p className={`what${n.kind === "wait" ? " quiet" : ""}`}>{n.title}</p>
            <p className="why">{n.why}</p>
            {editable && (
              <div className="qa-bar">
                {n.kind !== "wait" && (
                  <QA label={t("Esperar con control", "Wait with control")} wide>
                    <form action={waitWithControl.bind(null, q.id)} className="qa-form">
                      <label>{t("¿Qué esperas?", "What are you waiting for?")}<input name="waitingFor" required maxLength={200} defaultValue={q.decisionLabel ? t(`Resultado de ${q.decisionLabel}`, `Outcome of ${q.decisionLabel}`) : ""} /></label>
                      <label>{t("SOLU lo devuelve el", "SOLU brings it back on")}<input name="waitingUntil" type="date" required defaultValue={dayInput(q.decisionAt ? addDays(q.decisionAt, 1) : addDays(B.now, 3))} /></label>
                      <button type="submit">{t("Guardar espera", "Save wait")}</button>
                    </form>
                  </QA>
                )}
                <Link className="qa-btn" href={`/deals/${d.id}`}>{t("Ver Journey", "Open Journey")}</Link>
              </div>
            )}
          </div>
        )}
        {q.status === "PRESENTED" && editable && (
          <div>
            <div className="jbh"><b>{t("EL CLIENTE RESPONDIÓ", "THE CUSTOMER ANSWERED")}</b></div>
            <div className="qa-bar" style={{ borderTop: 0, paddingTop: 0 }}>
              <QA label={t("Llegó la PO · registrarla", "PO arrived · record it")} wide>
                <form action={registerPo.bind(null, q.id)} className="qa-form">
                  <b>{t("Tal como viene en la PO del cliente", "Exactly as on the customer's PO")}</b>
                  <div className="qa-row"><label>{t("Número de PO", "PO number")}<input name="number" required maxLength={80} /></label><label>{t("Recibida", "Received")}<input name="receivedAt" type="date" defaultValue={todayStr} /></label></div>
                  <label>{t("Fecha de entrega que exige", "Delivery date it demands")}<input name="requiredBy" type="date" /></label>
                  {q.lines.map((l, n) => (
                    <div key={l.id} className="qa-row">
                      <label style={{ flex: "0 0 64px" }}>{t("Cant.", "Qty")}<input name={`qty_${n}`} type="number" min="0" defaultValue={l.qty} /></label>
                      <label>{l.code ?? t("Precio", "Price")}<input name={`price_${n}`} type="number" min="0" step="0.01" defaultValue={Number(l.unitPrice)} /></label>
                    </div>
                  ))}
                  <div className="qa-row"><label>Incoterm<input name="incoterm" defaultValue={q.incoterm ?? ""} /></label><label>{t("Pago", "Payment")}<input name="paymentTerms" defaultValue={q.paymentTerms ?? ""} /></label></div>
                  <label>{t("Cotización que cita", "Quote it cites")}<input name="quoteRef" defaultValue={`${quoteNo(q)}`} /></label>
                  <label>{t("Fuente", "Source")}<input name="source" maxLength={200} placeholder={t("Ej.: PDF adjunto en correo de Compras", "E.g.: PDF attached to Purchasing email")} /></label>
                  <button type="submit">{t("Registrar y comparar", "Record and compare")}</button>
                </form>
              </QA>
              <QA label={t("No aceptó", "Declined")} wide>
                <form action={markDeclined.bind(null, q.id)} className="qa-form">
                  <label>{t("¿Por qué? (lo que dijo el cliente)", "Why? (what the customer said)")}<input name="why" maxLength={300} required /></label>
                  <label>{t("Fuente", "Source")}<input name="source" maxLength={200} /></label>
                  <button type="submit" className="secondary">{t("Registrar", "Record")}</button>
                </form>
              </QA>
            </div>
            <p className="src" style={{ marginTop: 6 }}>{t("Registrar la PO no la acepta: SOLU la compara primero con esta cotización. ¿Pide un cambio? Crea una revisión (arriba).", "Recording the PO doesn't accept it: SOLU first compares it with this quote. Asking for a change? Create a revision (top).")}</p>
          </div>
        )}
        {pos.length > 0 && (
          <div>
            <div className="jbh"><b>{t("PO RECIBIDAS", "POs RECEIVED")}</b></div>
            <ul className="plain">
              {pos.map((p) => (
                <li key={p.id}><Link href={`/po/${p.id}`} className="val">PO {p.number}</Link> · {i.day(p.receivedAt)} · {p.acceptance ? <span className="sig ok">{t("Aceptada", "Accepted")}</span> : p.rejectedAt ? <span className="sig wait">{t("No aceptada", "Not accepted")}</span> : <span className="sig attn">{t("Por comparar y decidir", "To compare and decide")}</span>}</li>
              ))}
            </ul>
          </div>
        )}
        {q.status === "ACCEPTED" && (
          <div>
            <div className="jbh"><b>{t("ACEPTADA", "ACCEPTED")}</b></div>
            <p className="small">{t("OC del cliente", "Customer PO")}: <b className="mono">{d.customerPo ?? "—"}</b></p>
            {dealInvoices.length === 0 ? <p className="src">{t("La factura nace al entregar: Operaciones → Entregado sin facturar.", "The invoice is born on delivery: Operations → Delivered, not invoiced.")}</p> : (
              <ul className="plain">{dealInvoices.map((inv) => <li key={inv.id}><a href={`/documentos/factura/${inv.id}`} target="_blank" rel="noopener" className="mono">Invoice {inv.number}</a> · USD {i.n2(inv.amount)}</li>)}</ul>
            )}
          </div>
        )}
        {q.status === "SUPERSEDED" && latest && latest.id !== q.id && (
          <div><p className="small">{t("Esta versión fue reemplazada.", "This version was replaced.")} <Link href={`/cotizaciones/${latest.id}`}>{t("Ir a la versión vigente", "Go to the current version")}</Link></p></div>
        )}
        <div>
          <div className="jbh"><b>{t("CÓMO DECIDE EL CLIENTE", "HOW THE CUSTOMER DECIDES")}</b><span className="grow" />{editable && q.status === "PRESENTED" && <QA label={t("Actualizar", "Update")} wide right><TermsForm decisionOnly /></QA>}</div>
          <DecisionFacts />
        </div>
        <div>
          <div className="jbh"><b>{t("SI DICE SÍ", "IF THEY SAY YES")}</b></div>
          <ul className="qv-checks soft">{B.ifYes.map((c, k) => <Check key={k} {...c} />)}</ul>
        </div>
      </aside>
    );
  };

  const Presented = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("LO QUE SE PRESENTÓ", "WHAT WAS PRESENTED")}</b><span className="grow" /><a className="src" href={pdf(q.lang)} target="_blank" rel="noopener">PDF</a></div>
      {q.solution && <p className="qv-sol sm">{q.solution}</p>}
      <dl className="qv-dl">
        <dt>{t("Total", "Total")}</dt><dd className="mono">USD {i.n2(saleOf(q.lines))} · {q.lines.length} {t("línea(s)", "line(s)")}</dd>
        <dt>{t("Promesa", "Promise")}</dt><dd>{q.promiseText ?? "—"}{q.promiseCondition && <span className="qv-cond">{t("Condición", "Condition")}: {q.promiseCondition}</span>}</dd>
        <dt>Lead Time</dt><dd>{B.leadText ?? "—"}</dd>
        <dt>{t("Oferta vigente hasta", "Offer valid until")}</dt><dd>{i.date(B.offerUntil)}</dd>
      </dl>
    </section>
  );

  const EconCompact = () => (
    <section className="jblock">
      <div className="jbh"><b>ECONOMICS</b><span className="grow" />{B.econAlert ? <span className="sig risk">{t("Cruzó el piso de la política", "Crossed the policy floor")}</span> : <span className="sig ok">{t("Dentro de la política", "Within policy")}</span>}</div>
      <div className="qv-econ two">
        <div className="qv-box prot"><span className="k">{t("Protegida al presentar", "Protected at presenting")}</span><b className="tv">{money(Number(q.protEsagra ?? 0))}</b><span className="tsub">{i.pct(q.protSale ? (Number(q.protEsagra) / Number(q.protSale)) * 100 : null)}</span><span className="src">{t(`Política v${q.protPolicy ?? "—"} · ${i.day(q.presentedAt)}`, `Policy v${q.protPolicy ?? "—"} · ${i.day(q.presentedAt)}`)}</span></div>
        <div className={`qv-box cur${B.econAlert ? " alert" : ""}`}><span className="k">{t("Esperada hoy", "Expected today")}</span><b className="tv">{money(B.curEsagra)}</b><span className="tsub">{i.pct(B.curPct)}</span><span className="src">{B.econChanged ? t("Los costos cambiaron después de presentar.", "Costs changed after presenting.") : t("Sin cambios de costo.", "No cost changes.")}</span></div>
      </div>
      <PayLine />
      <p className="src" style={{ marginTop: 8 }}>{t("SOLU solo avisa si se cruza el piso de la política o si cambia la promesa.", "SOLU only warns if the policy floor is crossed or the promise changes.")}</p>
    </section>
  );

  // ---------- Focus strip (top) for presented quotes ----------
  const Focus = () => {
    const n = B.next;
    if (!n || q.status !== "PRESENTED") return null;
    const cls = n.kind === "wait" ? "wait" : n.kind === "risk" ? "risk" : n.kind === "clarity" ? "clarity" : "move";
    return (
      <section className={`qv-focus ${cls}`}>
        <span className="k">{t("FUTURO DE LA DECISIÓN DEL CLIENTE", "CUSTOMER DECISION FUTURE")}</span>
        <div className="row">
          <b>{n.title}</b>
          <div className="chips">
            {B.clocks.filter((c) => c.kind !== "offer").map((c) => <span key={c.key} className={`qv-chip ${c.kind}`}>{c.kind === "customer" ? c.label : c.kind === "supplier" ? t("Vigencia proveedor", "Supplier validity") : t("Promesa", "Promise")} · {i.weekday(c.at)} {i.day(c.at)}</span>)}
          </div>
        </div>
        <p>{n.why}</p>
      </section>
    );
  };

  return (
    <div className="jw qv">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <Header />
      {draft ? (
        <div className="jbody">
          <div className="jmain">
            <Solution />
            <Economics />
            <Scenarios />
            <Lines />
            <Terms />
          </div>
          <ReadyRail />
        </div>
      ) : (
        <>
          <Focus />
          <div className="jbody">
            <div className="jmain">
              {q.status === "PRESENTED" && <Clocks />}
              <EconCompact />
              <Presented />
            </div>
            <DecisionRail />
          </div>
        </>
      )}
      <Popovers />
    </div>
  );
}
