import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/domain";
import { gerenciaHome } from "@/lib/gerencia-home";
import { futureBridge } from "@/lib/gerencia-home";
import { entityBreakdown } from "@/lib/gerencia-views";
import { identityInForce } from "@/lib/gerencia-store";
import { BRIDGE_STAGES, PRIORITY_STATUS } from "@/lib/gerencia-rules";
import { TileCard } from "../ui";

// Módulo 15 §13 · Board / assembly view. Read-only and curated: the direction, the pulse of the business, the
// future, where resources are exposed and what management decided. It shows no person, no commission, no customer
// record and no link into the modules; a Junta user cannot open them and cannot save anything.

type Txt = { es: string; en: string };

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const user = await requireRole("JUNTA", "GERENCIA");
  const i = makeI18n(user.lang);
  const { t } = i;
  const tt = (x: Txt) => t(x.es, x.en);
  const sp = await searchParams;
  const T = today();
  const [h, bridge, idn, priorities, decisions] = await Promise.all([
    gerenciaHome(user), futureBridge(), identityInForce(T),
    db.strategicPriority.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, title: true, status: true, horizon: true, desiredOutcome: true, narrative: true, narrativeAt: true } }),
    db.managementDecision.findMany({ where: { status: "DECIDED", supersededAt: null, decidedAt: { gte: addDays(T, -90) } }, orderBy: { decidedAt: "desc" }, take: 20, select: { id: true, code: true, question: true, decision: true, authority: true, decidedAt: true, expectedConsequence: true, reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { actualConsequence: true } } } }),
  ]);
  const entities = await entityBreakdown(h.period);

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Vista de Junta", "Board view")}</h1>
        <p>{t("La dirección, cómo va el negocio, qué viene, dónde están expuestos los recursos y qué decidió la gerencia. Es una vista de solo lectura.", "The direction, how the business is going, what is coming, where resources are exposed and what management decided. It is a read-only view.")}</p>
        <p className="small">{t("calculado", "as of")} {i.date(h.asOf)} · {t("mes", "month")} <span className="mono">{h.period}</span> ({t("en curso: provisional", "in progress: provisional")})</p>
      </div></div>
      {sp.err === "solo-lectura" && <div className="note risk">{t("Tu rol es de solo lectura: no se guardó nada.", "Your role is read-only: nothing was saved.")}</div>}
      {user.role === "GERENCIA" && <div className="note">{t("Así ve SOLU una persona con el rol «Junta o asamblea». Ese rol se asigna en EQUIPO → Personas y datos; solo abre esta vista, la identidad, las funciones y su perfil.", "This is how a person with the role \"Board or assembly\" sees SOLU. That role is assigned in TEAM → People & data; it opens only this view, the identity, the functions and their profile.")}</div>}

      {idn && <section className="card gm-idn" id="direccion"><span className="small muted">{t("Propósito", "Purpose")}</span><h2>{idn.purpose}</h2><p className="small"><Link href="/gerencia/identidad">{t("Identidad de la compañía", "Company identity")}</Link> · <Link href="/gerencia/funciones">{t("Funciones", "Functions")}</Link></p></section>}

      <section className="card" id="prioridades"><b>{t("PRIORIDADES ESTRATÉGICAS", "STRATEGIC PRIORITIES")}</b>
        {priorities.length === 0 ? <p className="small muted">{t("La gerencia aún no ha definido prioridades.", "Management hasn't set priorities yet.")}</p> : <ul className="plain">{priorities.map((p) => <li key={p.id} style={{ marginBottom: 8 }}><b>{p.title}</b> <span className={`sig ${PRIORITY_STATUS[p.status]?.tone ?? "wait"}`}>{t(PRIORITY_STATUS[p.status]?.es ?? p.status, PRIORITY_STATUS[p.status]?.en ?? p.status)}</span> <span className="small muted">· {t("horizonte", "horizon")} {p.horizon}</span><span className="small block">{t("Resultado buscado", "Desired result")}: {p.desiredOutcome}</span><span className="src block">{p.narrative ? `${t("Cómo va", "How it is going")} (${i.date(p.narrativeAt)}): ${p.narrative}` : t("Todavía nadie ha escrito cómo va.", "Nobody has written how it is going yet.")}</span></li>)}</ul>}
      </section>

      <h2 className="gm-h2" id="presente">{t("Pulso del negocio", "Business pulse")} <span className="src">{t("resultado, caja, cumplimiento, excepciones y recursos: nunca en un solo número", "result, cash, fulfilment, exceptions and resources: never in one number")}</span></h2>
      <div className="gm-tiles">{h.business.filter((x) => x.key !== "people").map((x) => <TileCard key={x.key} tile={x} i={i} plain />)}</div>

      <h2 className="gm-h2" id="futuro">{t("Lo que viene", "What is coming")} <span className="src">{t("ocho etapas, cada una con su propia certeza; no se suman y no llevan probabilidades", "eight stages, each with its own certainty; never added, no probabilities")}</span></h2>
      <div className="gm-bridge">{BRIDGE_STAGES.map((def, k) => { const s = bridge.stages.find((x) => x.key === def.key)!; return (
        <section key={def.key} className={`gm-stage${s.usd != null ? " money" : ""}`}><span className="k">{k + 1} · {t(def.es, def.en)}</span><div className="v">{s.usd != null ? i.money(s.usd) : i.n(s.n)}</div><span className="small">{s.usd != null ? t(`${s.n} en esta etapa`, `${s.n} at this stage`) : t("sin valor asignado", "no value assigned")}{s.esagara != null ? <> · Eságara <b className="mono">{i.money(s.esagara)}</b></> : null}</span><span className="src block">{tt(def.truth)}</span></section>
      ); })}</div>

      <section className="card" id="exposicion" style={{ marginTop: 16 }}><b>{t("RECURSOS Y RIESGO EXPUESTOS", "RESOURCES AND RISK EXPOSED")}</b> <span className="small muted">{t("miradas separadas; no hay una calificación que las junte", "separate views; no rating adds them up")}</span>
        <div className="tscroll"><table>
          <thead><tr><th>{t("Dónde", "Where")}</th><th className="n">{t("Cuánto", "How much")}</th><th>{t("Qué hay detrás", "What is behind it")}</th></tr></thead>
          <tbody>{h.exposure.filter((e) => e.key !== "people").map((e) => <tr key={e.key}><td><b>{tt(e.title)}</b></td><td className="n mono"><span className={e.tone === "risk" ? "risk-t" : e.tone === "attn" ? "attn-t" : ""}>{e.value}</span></td><td className="small">{tt(e.detail)}</td></tr>)}</tbody>
        </table></div>
        <p className="src">{t("Concentración", "Concentration")}: {[[t("Eságara contratada en un cliente", "contracted Eságara in one customer"), bridge.conc.customerEsagara], [t("cartera en un cliente", "receivables in one customer"), bridge.conc.customerAr], [t("órdenes abiertas en un proveedor", "open orders with one supplier"), bridge.conc.supplier]].map(([label, c], k) => { const x = c as typeof bridge.conc.supplier; return <span key={k}>{k ? " · " : ""}{label as string}: {x.shares[0] && x.shares.length > 1 ? i.pct(x.shares[0].pct) : "—"}</span>; })}. {t(`SOLU señala concentración desde ${i.n2(bridge.conc.pct)} %.`, `SOLU flags concentration from ${i.n2(bridge.conc.pct)} %.`)}</p>
      </section>

      {entities.length > 1 && (
        <section className="card" id="empresas"><b>{t("POR EMPRESA VENDEDORA", "BY SELLING COMPANY")}</b>
          <div className="tscroll"><table>
            <thead><tr><th>{t("Empresa", "Company")}</th><th className="n">{t("Venta del mes", "Sales this month")}</th><th className="n">Eságara</th><th className="n">{t("Contratado por facturar", "Contracted, to invoice")}</th><th className="n">{t("Por cobrar", "Outstanding")}</th></tr></thead>
            <tbody>{entities.map((e) => <tr key={e.key}><td>{e.name}</td><td className="n mono">{i.money(e.sale)}</td><td className="n mono">{i.money(e.esagara)}{e.pct != null ? ` · ${i.pct(e.pct)}` : ""}</td><td className="n mono">{i.money(e.toInvoice)}</td><td className="n mono">{i.money(e.outstanding)}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}

      <section className="card" id="decisiones"><b>{t("DECISIONES DE LA GERENCIA, ÚLTIMOS 90 DÍAS", "MANAGEMENT DECISIONS, LAST 90 DAYS")}</b>
        {decisions.length === 0 ? <p className="small muted">{t("Ninguna decisión registrada en 90 días.", "No decision recorded in 90 days.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Pregunta", "Question")}</th><th>{t("Qué se decidió", "What was decided")}</th><th>{t("Qué se esperaba y qué pasó", "What was expected and what happened")}</th><th>{t("Cuándo", "When")}</th></tr></thead>
            <tbody>{decisions.map((d) => <tr key={d.id}><td><b className="mono">{d.code}</b> {d.question}</td><td className="small">{d.decision}<span className="src block">{d.authority}</span></td><td className="small">{d.expectedConsequence}{d.reviews[0] ? <span className="src block">{t("Pasó", "It happened")}: {d.reviews[0].actualConsequence}</span> : <span className="src block">{t("Aún sin revisar", "Not reviewed yet")}</span>}</td><td className="small">{i.date(d.decidedAt)}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>
      <p className="src">{t("Esta vista no muestra personas, remuneración, comisiones ni la ficha de ningún cliente. Las cifras son las mismas que usa la gerencia.", "This view shows no people, pay, commissions or any customer's record. The figures are the same management uses.")}</p>
    </>
  );
}
