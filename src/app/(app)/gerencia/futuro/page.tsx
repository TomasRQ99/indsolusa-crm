import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { futureBridge } from "@/lib/gerencia-home";
import { BRIDGE_STAGES, type Share } from "@/lib/gerencia-rules";
import type { FocusItem } from "@/lib/focus";

// Módulo 15 §16–18 · the bridge from what may come to money in the bank. Eight stages, each with its own kind of
// truth: they are shown side by side and never added into one "pipeline" number, and nothing carries a probability
// (AC5). Below, the few high-value matters worth Gerencia's attention, each saying why it is on the list.

type Txt = { es: string; en: string };

export default async function FutureBridgePage() {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const tt = (x: Txt) => t(x.es, x.en);
  const b = await futureBridge();
  const v = b.views;
  const esBuckets = b.stages.filter((s) => s.esagara != null);

  const item = (x: FocusItem, why: string) => (
    <li key={x.dealId}><span><Link href={`/deals/${x.dealId}`}><b>{x.code ?? x.solution}</b> · {x.account}</Link><span className="src block">{x.solution} · {tt(x.position)} · {x.owner}</span><span className="src block"><b>{t("Por qué está aquí", "Why it is here")}:</b> {why}</span></span>
      <span className="mono small" style={{ textAlign: "right", flex: "none" }}>{x.esagara != null ? <>Eságara {i.money(x.esagara)}{x.pct != null ? <span className="src block">{i.pct(x.pct)}</span> : null}</> : "—"}</span></li>
  );
  const shares = (title: string, basis: string, c: { total: number; shares: Share[]; flagged: Share[] }, href: (k: string) => string) => (
    <div>
      <b className="small">{title}</b> <span className="src">{basis}</span>
      {c.shares.length === 0 ? <p className="quiet-p">{t("Nada que medir hoy.", "Nothing to measure today.")}</p> : (
        <ul className="plain small">{c.shares.slice(0, 5).map((s) => <li key={s.key}><Link href={href(s.key)}>{s.name}</Link> · <span className="mono">{i.money(s.value)}</span> · <b className={c.flagged.some((f) => f.key === s.key) ? "attn-t" : ""}>{i.pct(s.pct)}</b></li>)}</ul>
      )}
      {c.flagged.length > 0 ? <p className="small"><span className="sig attn">{t(`${c.flagged.length} por encima del ${i.n2(b.conc.pct)} %`, `${c.flagged.length} above ${i.n2(b.conc.pct)} %`)}</span></p> : c.shares.length > 1 ? <p className="small"><span className="sig ok">{t(`Ninguno llega al ${i.n2(b.conc.pct)} %`, `None reaches ${i.n2(b.conc.pct)} %`)}</span></p> : null}
    </div>
  );

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Puente al futuro", "Future bridge")}</h1>
        <p>{t("De lo que alguien vio venir hasta el dinero en el banco. Cada etapa tiene su propia clase de verdad: se leen una al lado de la otra y nunca se suman.", "From what someone saw coming to money in the bank. Each stage has its own kind of truth: they are read side by side and never added up.")}</p>
        <p className="small">{t("calculado", "as of")} {i.date(b.asOf)}</p>
      </div></div>

      <div className="gm-bridge" id="puente">
        {BRIDGE_STAGES.map((def, k) => { const s = b.stages.find((x) => x.key === def.key)!; return (
          <section key={def.key} className={`gm-stage${s.usd != null ? " money" : ""}`} id={`st-${def.key}`}>
            <span className="k">{k + 1} · {t(def.es, def.en)}</span>
            <div className="v">{s.usd != null ? i.money(s.usd) : i.n(s.n)}</div>
            <span className="small">{s.usd != null ? <>{t(`${s.n} en esta etapa`, `${s.n} at this stage`)}{s.esagara != null ? <> · Eságara <b className="mono">{i.money(s.esagara)}</b></> : null}</> : t("sin valor asignado", "no value assigned")}</span>
            <span className="src block">{tt(def.truth)}</span>
            <span className="src block">{t("Base", "Basis")}: {tt(s.basis)} <Link href={s.href}>{t("ver", "see")}</Link></span>
          </section>
        ); })}
      </div>
      <p className="src">{t("No hay un total: sumar una oportunidad con una factura por cobrar sería mezclar certezas distintas.", "There is no total: adding an opportunity to an invoice to collect would mix different certainties.")}</p>

      <section className="card" id="esagara"><b>{t("ESÁGARA FUTURA VISIBLE", "VISIBLE FUTURE ESÁGARA")}</b> <span className="small muted">{t("bolsas separadas, cada una con su base: cotizado (en preparación y presentado), contratado, en ejecución, por facturar y por cobrar", "separate buckets, each with its basis: quoted (being prepared and presented), contracted, executing, to invoice and to collect")}</span>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Bolsa", "Bucket")}</th><th className="n">Eságara</th><th className="n">{t("Venta", "Sale")}</th><th className="n">%</th><th>{t("Con qué se calcula", "How it is calculated")}</th></tr></thead>
          <tbody>{esBuckets.map((s) => { const def = BRIDGE_STAGES.find((x) => x.key === s.key)!; return (
            <tr key={s.key}><td><Link href={s.href}>{t(def.es, def.en)}</Link></td><td className="n mono"><b>{i.money(s.esagara)}</b></td><td className="n mono">{i.money(s.usd)}</td><td className="n mono">{s.usd && s.usd > 0 ? i.pct(((s.esagara ?? 0) / s.usd) * 100) : "—"}</td><td className="small">{tt(s.basis)}</td></tr>
          ); })}</tbody>
        </table></div>
      </section>

      <h2 className="gm-h2" id="foco">{t("Foco de alto valor", "High-value focus")} <span className="src">{t(`material desde Eságara ${i.money(b.focus.materialEsagaraUsd)} (política de Foco)`, `material from Eságara ${i.money(b.focus.materialEsagaraUsd)} (Focus policy)`)}</span></h2>
      <div className="gm-cols">
        <section className="card" id="top5"><b>{t("LAS CINCO MAYORES POR ESÁGARA", "TOP FIVE BY ESÁGARA")}</b>
          {v.top5.length === 0 ? <p className="quiet-p">{t("Ningún Journey abierto tiene precio todavía.", "No open Journey has a price yet.")}</p> : <ul className="rp-list">{v.top5.map((x, k) => item(x, t(`${k + 1}.ª Eságara más alta entre los Journeys abiertos`, `#${k + 1} highest Eságara among open Journeys`)))}</ul>}
        </section>
        <section className="card" id="mes"><b>{t("SE MUEVEN ESTE MES", "MOVING THIS MONTH")}</b>
          {v.monthMovers.length === 0 ? <p className="quiet-p">{t("Ninguna decisión de cliente cae este mes.", "No customer decision falls this month.")}</p> : <ul className="rp-list">{v.monthMovers.map((x) => item(x, t(`El cliente decide antes de fin de mes (${i.date(x.nextDecision)})`, `The customer decides before month end (${i.date(x.nextDecision)})`)))}</ul>}
        </section>
        <section className="card" id="proteger"><b>{t("NEGOCIOS POR PROTEGER", "DEALS TO PROTECT")}</b>
          {v.toProtect.length === 0 ? <p className="quiet-p">{t("Nada aceptado tiene un riesgo registrado.", "Nothing accepted has a recorded risk.")}</p> : <ul className="rp-list">{v.toProtect.map((x) => item(x, t(`Aceptado y con riesgo: ${x.risks.map((r) => r.es).join("; ")}`, `Accepted and at risk: ${x.risks.map((r) => r.en).join("; ")}`)))}</ul>}
        </section>
        <section className="card" id="compromisos"><b>{t("COMPROMISOS DE ALTO VALOR", "HIGH-VALUE COMMITMENTS")}</b>
          {b.hv.rows.length === 0 ? <p className="quiet-p">{t("Ningún compromiso aceptado supera el valor material.", "No accepted commitment is above the material amount.")}</p> : <ul className="rp-list">{b.hv.rows.slice(0, 8).map((r) => (
            <li key={r.deal.id}><span><Link href={`/deals/${r.deal.id}?tab=execute`}><b>{r.deal.code ?? r.deal.title}</b> · {r.deal.account}</Link><span className="src block">{tt(r.milestone.text)} · {r.deal.owner}{r.promise ? ` · ${t("promesa", "promise")} ${i.date(r.promise)}` : ""}</span><span className="src block"><b>{t("Por qué está aquí", "Why it is here")}:</b> {t(`Orden aceptada con Eságara de ${i.money(r.esagara)} o más`, `Accepted order with Eságara of ${i.money(r.esagara)} or more`)}{r.risks.length ? ` · ${r.risks.map((x) => t(x.es, x.en)).join("; ")}` : ""}</span></span>
              <span className="mono small" style={{ flex: "none" }}>{r.risks.length ? <span className="sig risk">{t("riesgo", "risk")}</span> : <span className="sig ok">{t("en curso", "on track")}</span>}</span></li>
          ))}</ul>}
        </section>
        <section className="card" id="constructores"><b>{t("CONSTRUYEN FUTURO", "FUTURE BUILDERS")}</b>
          {v.futureBuilders.length + v.futures.length === 0 ? <p className="quiet-p">{t("Ninguna necesidad nueva en 90 días ni oportunidad futura con fecha.", "No new Need in 90 days and no dated future opportunity.")}</p> : (
            <ul className="rp-list">
              {v.futureBuilders.map((x) => <li key={x.dealId}><span><Link href={`/deals/${x.dealId}`}><b>{x.code ?? x.solution}</b> · {x.account}</Link><span className="src block">{x.desiredResult}</span><span className="src block"><b>{t("Por qué está aquí", "Why it is here")}:</b> {t(`Necesidad escrita hace menos de 90 días (${i.date(x.createdAt)}), aún sin cotizar`, `Need written less than 90 days ago (${i.date(x.createdAt)}), not quoted yet`)}</span></span></li>)}
              {v.futures.map((f) => <li key={f.id}><span><Link href={f.account ? `/mercado/empresas/${f.account.id}` : "/mercado"}><b>{f.account?.name ?? t("Mercado", "Market")}</b></Link> · {f.description}<span className="src block"><b>{t("Por qué está aquí", "Why it is here")}:</b> {t(`Oportunidad futura esperada para ${i.date(f.expectedAt)}`, `Future opportunity expected for ${i.date(f.expectedAt)}`)}{f.nextMove ? ` · ${f.nextMove}` : ""}</span></span></li>)}
            </ul>
          )}
        </section>
        <section className="card" id="decisiones"><b>{t("DECISIONES DE CLIENTES QUE VIENEN", "CUSTOMER DECISIONS COMING")}</b>
          {v.decisionsComing.length === 0 ? <p className="quiet-p">{t(`Ninguna en los próximos ${b.focus.decisionsDays} días.`, `None in the next ${b.focus.decisionsDays} days.`)}</p> : <ul className="rp-list">{v.decisionsComing.slice(0, 8).map((x) => item(x, t(`El cliente decide el ${i.date(x.nextDecision)}, dentro de los próximos ${b.focus.decisionsDays} días`, `The customer decides on ${i.date(x.nextDecision)}, within the next ${b.focus.decisionsDays} days`)))}</ul>}
        </section>
      </div>

      <section className="card" id="concentracion" style={{ marginTop: 16 }}><b>{t("RIESGO DE CONCENTRACIÓN", "CONCENTRATION RISK")}</b> <span className="small muted">{t("qué parte depende de uno solo; no es una calificación", "what share depends on a single one; not a rating")}</span>
        <div className="gm-opts">
          {shares(t("Eságara contratada, por cliente", "Contracted Eságara, by customer"), t("órdenes aceptadas aún sin facturar", "accepted orders not yet invoiced"), b.conc.customerEsagara, (k) => `/accounts/${k}`)}
          {shares(t("Por cobrar, por cliente", "Receivables, by customer"), t("saldo de facturas", "invoice balances"), b.conc.customerAr, (k) => `/accounts/${k}`)}
          {shares(t("Órdenes abiertas, por proveedor", "Open orders, by supplier"), t("liberadas y sin recibir, en USD", "released and not received, in USD"), b.conc.supplier, (k) => `/suppliers/${k}`)}
        </div>
        <p className="src">{t(`SOLU señala una concentración cuando uno solo llega al ${i.n2(b.conc.pct)} % o más.`, `SOLU flags a concentration when a single one reaches ${i.n2(b.conc.pct)} % or more.`)} <Link href="/gerencia/politicas#gerencia">{t("Cambiar ese porcentaje", "Change that percentage")}</Link></p>
      </section>
    </>
  );
}
