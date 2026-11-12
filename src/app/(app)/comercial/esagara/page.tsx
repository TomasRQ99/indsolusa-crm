import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { addDays } from "@/lib/domain";
import { costOf, saleOf, quoteNo } from "@/lib/quote";
import { APPROVER_ROLES, canApprove, COM_POLICY_KEY, getComPolicy, type ApproverContext } from "@/lib/esagara-gate";
import { gateOf, REASONS, SCOPES, type Gate } from "@/lib/esagara-rules";
import { decideException, saveComPolicy } from "./actions";
import { EXC_ERR, EXC_OK, History, actionText } from "./ExceptionCard";

// Comercial C2 · Eságara exceptions (module 10 v1.1 §43–49): the approver decides in seconds with the full context,
// the requester follows their own requests, and Management sees where low Eságara is being approved, by account.

type Snap = ApproverContext & { gate: Gate };

export default async function EsagaraPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const approver = APPROVER_ROLES.includes(user.role);
  const money = (v: unknown) => `USD ${i.n2(v)}`;
  const inc = { quote: { include: { lines: true, deal: { select: { id: true, code: true, title: true, account: { select: { id: true, name: true } } } } } } } as const;

  const [pol, versions, open, mine, approved] = await Promise.all([
    getComPolicy(),
    db.marketSetting.findMany({ where: { key: COM_POLICY_KEY }, orderBy: { version: "desc" }, take: 6 }),
    // Non-approvers get an empty result from the same query (keeps one row type).
    db.esagaraException.findMany({ where: approver ? { status: { in: ["REQUESTED", "RETURNED"] } } : { id: "" }, orderBy: { requestedAt: "asc" }, include: inc }),
    db.esagaraException.findMany({ where: { requestedById: user.id }, orderBy: { requestedAt: "desc" }, take: 20, include: inc }),
    db.esagaraException.findMany({ where: approver ? { status: "APPROVED", decidedAt: { gte: addDays(new Date(), -90) } } : { id: "" }, orderBy: { decidedAt: "desc" }, include: inc }),
  ]);
  const okMsg = EXC_OK(t);
  const errMsg = EXC_ERR(t);
  const reason = (k: string) => (REASONS[k] ? t(REASONS[k].es, REASONS[k].en) : k);
  const scope = (k: string) => (SCOPES[k] ? t(SCOPES[k].es, SCOPES[k].en) : k);
  const trendTxt = (x: string | null) => (x === "BETTER" ? t("mejorando", "improving") : x === "WORSE" ? t("empeorando", "worsening") : x === "STABLE" ? t("estable", "stable") : null);

  // LOW_ESAGARA_APPROVED pattern: same account approved more than once in 90 days is something to look at, not a ranking.
  const byAccount = new Map<string, { name: string; rows: typeof approved }>();
  for (const e of approved) {
    const a = e.quote.deal.account;
    const g = byAccount.get(a.id) ?? { name: a.name, rows: [] as typeof approved };
    g.rows.push(e);
    byAccount.set(a.id, g);
  }

  const waiting = open.filter((e) => e.status === "REQUESTED");
  const returned = open.filter((e) => e.status === "RETURNED");

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Excepciones de Eságara", "Eságara exceptions")}</h1>
          <p>{t(`Por debajo de ${i.pct2(pol.value.minEsagaraPct)} de Eságara una cotización se presenta solo con una excepción aprobada. No es una prohibición: es una decisión consciente, con razón y con quien la aprueba.`, `Below ${i.pct2(pol.value.minEsagaraPct)} Eságara a quote is presented only with an approved exception. It isn't a ban: it's a conscious decision, with a reason and an approver.`)}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note attn">{errMsg[sp.err]}</div>}

      {approver && (
        <section className="card" id="cola">
          <b>{t("Esperando tu decisión", "Waiting for your decision")}</b>
          {waiting.length === 0 ? <p className="small muted"><span className="sig ok">{t("No hay solicitudes esperando.", "No requests waiting.")}</span></p> : waiting.map((e) => {
            const s = e.snapshot as unknown as Snap;
            const now = gateOf(saleOf(e.quote.lines), costOf(e.quote), pol.value);
            const moved = Math.abs(now.sale - Number(e.saleAmount)) > 0.005 || Math.abs((now.pct ?? 0) - Number(e.esagaraPct)) > 0.005;
            const mineReq = !canApprove(user, e);
            const c = s.customer;
            const overCredit = c.creditLimit != null && c.openAR + c.committedNotInvoiced + Number(e.saleAmount) > c.creditLimit;
            return (
              <article key={e.id} id={`e-${e.id}`} className="exc-item">
                <header className="exc-head">
                  <b>{e.quote.deal.account.name}</b> · <Link href={`/cotizaciones/${e.quote.id}#esagara`}>Quote Nº {quoteNo(e.quote)}</Link> · <Link href={`/deals/${e.quote.deal.id}`}>{e.quote.deal.code ?? e.quote.deal.title}</Link>
                  <span className="grow" /><span className="src">{t(`Pidió ${e.requestedByName} · ${i.day(e.requestedAt)}`, `Requested by ${e.requestedByName} · ${i.day(e.requestedAt)}`)}</span>
                </header>
                <div className="exc-grid">
                  <dl className="qv-dl tight">
                    <dt>{t("Venta neta", "Net sale")}</dt><dd className="mono">{money(e.saleAmount)}</dd>
                    <dt>Eságara</dt><dd className="mono"><b>{money(e.esagaraAmount)} · {i.pct2(Number(e.esagaraPct))}</b></dd>
                    <dt>{t("Umbral", "Threshold")}</dt><dd className="mono">{i.pct2(Number(e.thresholdPct))} · {t("política", "policy")} v{e.policyVersion}</dd>
                    <dt>{t("Se deja de ganar", "Given up")}</dt><dd className="mono">{money(s.gate?.sacrificed ?? 0)} {t("frente al umbral", "vs the threshold")}</dd>
                    <dt>{t("Costos", "Costs")}</dt><dd className="mono small">{t("Proveedor", "Supplier")} {money(s.quote.supplierCost)} · {t("Flete", "Freight")} {money(s.quote.freightCost)} · {t("Otros", "Other")} {money(s.quote.otherCosts)}{s.quote.fxRate ? ` · FX ${s.quote.fxRate} ${s.quote.costCurrency ?? ""}` : ""}</dd>
                    <dt>{t("Suministro", "Supply")}</dt><dd className="small">{s.quote.supplyPrimary ?? "—"}{s.quote.supplyAlt ? ` · ${t("alterno", "alt.")} ${s.quote.supplyAlt}` : ""}</dd>
                    <dt>{t("Condiciones", "Terms")}</dt><dd className="small">{s.quote.paymentTerms ?? "—"}{s.quote.incoterm ? ` · ${s.quote.incoterm}` : ""}</dd>
                  </dl>
                  <dl className="qv-dl tight">
                    <dt>{t("Cupo de crédito", "Credit limit")}</dt><dd className="mono">{c.creditLimit != null ? money(c.creditLimit) : t("Sin cupo definido", "No limit set")}</dd>
                    <dt>{t("Cartera abierta", "Open receivables")}</dt><dd className="mono">{money(c.openAR)}</dd>
                    <dt>{t("Ganado sin facturar", "Won, not invoiced")}</dt><dd className="mono">{money(c.committedNotInvoiced)}</dd>
                    {overCredit && <><dt /><dd className="risk-t small">{t("Con esta venta supera el cupo.", "With this sale it goes over the limit.")}</dd></>}
                    <dt>{t("Paga en", "Pays in")}</dt><dd>{c.expectedPayDays != null ? t(`~${c.expectedPayDays} días`, `~${c.expectedPayDays} days`) : t("Sin historial", "No history")}{c.termsDays != null ? ` · ${t("plazo", "terms")} ${c.termsDays}` : ""}{trendTxt(c.trend) ? ` · ${trendTxt(c.trend)}` : ""}</dd>
                    <dt>{t("Otras cotizaciones (60 días)", "Other quotes (60 days)")}</dt>
                    <dd className="small">{s.related.length === 0 ? t("Ninguna", "None") : s.related.map((r) => <span key={r.id} className="block">{`Nº ${r.number}${r.rev ? `-R${r.rev}` : ""}`} · {r.deal} · {money(r.sale)} · {i.pct2(r.pct)}</span>)}</dd>
                  </dl>
                </div>
                {s.related.length > 0 && <p className="src">{t("Mira si la venta se partió en varias cotizaciones para quedar por debajo del radar.", "Check whether the sale was split into several quotes to stay under the radar.")}</p>}
                <div className="exc-req">
                  <p><b>{reason(e.reasonCode)}</b> · {scope(e.scope)}</p>
                  <p>«{e.narrative}»</p>
                  <p className="src">{t("Beneficio esperado", "Expected benefit")}: {e.expectedBenefit}</p>
                  {e.alternatives && <p className="src">{t("Alternativas consideradas", "Alternatives considered")}: {e.alternatives}</p>}
                  <History h={e.history} i={i} />
                </div>
                {moved && <p className="qv-alert">{t(`La cotización cambió desde la solicitud: hoy ${money(now.sale)} · ${i.pct2(now.pct)}. Devuélvela para que se actualice; se aprueba exactamente lo que verá el cliente.`, `The quote changed since the request: today ${money(now.sale)} · ${i.pct2(now.pct)}. Return it so it gets refreshed; you approve exactly what the customer will see.`)}</p>}
                {mineReq ? <p className="src">{t("La pediste tú: la decide el Director Comercial o Gerencia (otra persona).", "You requested it: the Commercial Director or Management (someone else) decides it.")}</p> : (
                  <form action={decideException.bind(null, e.id)} className="qa-form exc-decide">
                    <label>{t("Comentario (obligatorio para devolver o rechazar)", "Comment (required to return or reject)")}<textarea name="comments" rows={2} maxLength={800} /></label>
                    <div className="qa-row">
                      <button type="submit" name="action" value="APPROVE" disabled={moved}>{t("Aprobar esta economía", "Approve these economics")}</button>
                      <button type="submit" name="action" value="RETURN" className="secondary">{t("Devolver con pregunta", "Return with a question")}</button>
                      <button type="submit" name="action" value="REJECT" className="secondary">{t("Rechazar", "Reject")}</button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
          {returned.length > 0 && <p className="src">{t(`${returned.length} devuelta(s) esperando respuesta de quien pidió.`, `${returned.length} returned, waiting for the requester's answer.`)}</p>}
        </section>
      )}

      <section className="card" id="mias">
        <b>{t("Mis solicitudes", "My requests")}</b>
        {mine.length === 0 ? <p className="small muted">{t("No has pedido excepciones. Se piden desde la cotización, cuando la Eságara queda por debajo del umbral.", "You haven't requested exceptions. They're requested from the quote, when Eságara falls below the threshold.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cliente", "Customer")}</th><th>Quote</th><th className="n">Eságara</th><th>{t("Razón", "Reason")}</th><th>{t("Estado", "Status")}</th></tr></thead>
            <tbody>{mine.map((e) => {
              const last = (Array.isArray(e.history) ? (e.history as { action: string }[]) : []).at(-1);
              return <tr key={e.id}><td>{e.quote.deal.account.name}</td><td><Link href={`/cotizaciones/${e.quote.id}#esagara`}>Nº {quoteNo(e.quote)}</Link></td><td className="n mono">{i.pct2(Number(e.esagaraPct))}</td><td className="small">{reason(e.reasonCode)}</td><td className="small">{last ? actionText(t, last.action) : e.status}{e.decidedByName ? ` · ${e.decidedByName}` : ""}{e.comments ? <span className="src block">«{e.comments}»</span> : null}</td></tr>;
            })}</tbody>
          </table></div>
        )}
      </section>

      {approver && (
        <section className="card" id="patron">
          <b>{t("Aprobadas en los últimos 90 días, por cliente", "Approved in the last 90 days, by customer")}</b>
          <p className="src">{t("Para ver dónde se está regalando Eságara de forma repetida. Es un patrón de la empresa, no una calificación de personas.", "To see where Eságara is being given away repeatedly. It's a company pattern, not a rating of people.")}</p>
          {byAccount.size === 0 ? <p className="small muted"><span className="sig ok">{t("Ninguna en este periodo.", "None in this period.")}</span></p> : (
            <div className="tscroll"><table>
              <thead><tr><th>{t("Cliente", "Customer")}</th><th className="n">{t("Excepciones", "Exceptions")}</th><th className="n">{t("Venta", "Sale")}</th><th className="n">{t("Eságara media", "Average Eságara")}</th><th>{t("Razones", "Reasons")}</th></tr></thead>
              <tbody>{[...byAccount.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length).map(([id, g]) => {
                const sale = g.rows.reduce((s, e) => s + Number(e.saleAmount), 0);
                const es = g.rows.reduce((s, e) => s + Number(e.esagaraAmount), 0);
                return <tr key={id}><td>{g.name}{g.rows.length > 1 && <span className="sig attn" style={{ marginLeft: 6 }}>{t("se repite", "repeats")}</span>}</td><td className="n">{g.rows.length}</td><td className="n mono">{money(sale)}</td><td className="n mono">{sale > 0 ? i.pct2((es / sale) * 100) : "—"}</td><td className="small">{[...new Set(g.rows.map((e) => reason(e.reasonCode)))].join(" · ")}</td></tr>;
              })}</tbody>
            </table></div>
          )}
        </section>
      )}

      <section className="card" id="politica">
        <b>{t("Política comercial", "Commercial policy")} · v{pol.version}</b>
        <p className="src">{pol.version ? t(`Guardada por ${pol.by ?? "—"} el ${i.day(pol.at)}.`, `Saved by ${pol.by ?? "—"} on ${i.day(pol.at)}.`) : t("Valores iniciales del módulo (20 % · 1 punto · 5 %). Aún nadie los ha cambiado.", "The module's starting values (20 % · 1 point · 5 %). Nobody has changed them yet.")}</p>
        {approver ? (
          <form action={saveComPolicy} className="stack" style={{ maxWidth: 520 }}>
            <label>{t("Umbral mínimo de Eságara (% de la venta neta)", "Minimum Eságara threshold (% of net sale)")}<input name="minEsagaraPct" type="number" step="0.01" min="0" max="90" required defaultValue={pol.value.minEsagaraPct} /></label>
            <label>{t("Una aprobación sigue valiendo si la Eságara baja menos de (puntos)", "An approval still holds if Eságara drops less than (points)")}<input name="reapproveDropPts" type="number" step="0.01" min="0" max="20" required defaultValue={pol.value.reapproveDropPts} /></label>
            <label>{t("…y la venta cambia menos de (%)", "…and the sale moves less than (%)")}<input name="reapproveAmountPct" type="number" step="0.01" min="0" max="50" required defaultValue={pol.value.reapproveAmountPct} /></label>
            <button type="submit">{t("Guardar como nueva versión", "Save as new version")}</button>
            <span className="src block">{t("Las cotizaciones y excepciones ya decididas conservan la versión con la que se decidieron.", "Quotes and exceptions already decided keep the version they were decided with.")}</span>
          </form>
        ) : (
          <p className="small">{t(`Umbral ${i.pct2(pol.value.minEsagaraPct)}. Lo cambia el Director Comercial o Gerencia.`, `Threshold ${i.pct2(pol.value.minEsagaraPct)}. The Commercial Director or Management changes it.`)}</p>
        )}
        {versions.length > 1 && (
          <ul className="mk-ul small">{versions.map((v) => { const x = v.value as { minEsagaraPct?: number }; return <li key={v.id}>v{v.version} · {i.pct2(x.minEsagaraPct ?? null)} · {v.updatedByName ?? "—"} · {i.day(v.createdAt)}</li>; })}</ul>
        )}
      </section>
    </>
  );
}
