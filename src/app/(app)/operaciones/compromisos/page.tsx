import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { sharePct } from "@/lib/money";
import { highValueCommitments } from "@/lib/hv";

// Operaciones O8b · High-Value Commitment Protection (module 11 v1.2 §45): each big accepted Journey with its promise,
// what is exposed, the next milestone, the risks and its owner, until it closes operationally and financially.

export default async function HighValuePage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { rows, threshold } = await highValueCommitments();
  const withRisk = rows.filter((r) => r.risks.length > 0);
  const calm = rows.filter((r) => r.risks.length === 0);
  const usd = (n: number | null) => (n == null ? "—" : `USD ${i.n2(n)}`);

  const Card = ({ r }: { r: (typeof rows)[number] }) => (
    <article className="exc-item">
      <header className="exc-head">
        <span className={`sig ${r.risks.length ? "risk" : "ok"}`}>{r.risks.length ? t("Con riesgo", "At risk") : t("Sin riesgo conocido", "No known risk")}</span>
        <b><Link href={`/deals/${r.deal.id}?tab=execute`}>{r.deal.code ?? r.deal.title}</Link> · {r.deal.account}</b>
        <span className="grow" /><span className="small muted">{t("Lleva", "Owner")}: {r.deal.owner}</span>
      </header>
      <p className="small">{r.deal.title}</p>
      <dl className="qv-dl tight">
        <dt>{t("Promesa al cliente", "Customer promise")}</dt><dd><b className="mono">{r.promise ? i.day(r.promise) : "—"}</b>{r.promiseText && <span className="muted small"> · {r.promiseText}</span>}</dd>
        <dt>{t("En juego", "At stake")}</dt><dd className="mono">{t("venta", "sale")} {usd(r.sale)} · Eságara {usd(r.esagara)}{r.sale && r.esagara != null ? ` (${i.pct(sharePct(r.esagara, r.sale))})` : ""}</dd>
        <dt>{t("Dinero ya comprometido", "Money already out")}</dt><dd className="mono">{t("pagado a proveedores", "paid to suppliers")} {usd(r.advanced)} · {t("por cobrar", "receivable")} {usd(r.facts.openBalance)}{r.facts.overdueBalance > 0.005 && <span className="risk-t"> · {t("vencido", "overdue")} {usd(r.facts.overdueBalance)}</span>}</dd>
        <dt>{t("Avance", "Progress")}</dt><dd className="small">{t(`${r.facts.unitsDelivered} de ${r.facts.unitsOrdered} unidades entregadas`, `${r.facts.unitsDelivered} of ${r.facts.unitsOrdered} units delivered`)}{r.inDispatch > 0 && ` · ${t(`${r.inDispatch} en despacho`, `${r.inDispatch} in dispatch`)}`} · {r.closure.operational ? t("operación cerrada", "operations closed") : t("operación abierta", "operations open")} · {t("dinero abierto", "money open")}</dd>
        <dt>{t("Siguiente hito", "Next milestone")}</dt><dd><b>{t(r.milestone.text.es, r.milestone.text.en)}</b>{r.milestone.due && <span className="mono small"> · {i.day(r.milestone.due)}</span>}</dd>
      </dl>
      {r.risks.length > 0 && <ul className="plain small">{r.risks.map((x, k) => <li key={k} className="risk-t">• {t(x.es, x.en)}</li>)}</ul>}
      <p className="small"><Link href={`/deals/${r.deal.id}/handoff`}>{t("Ver entrega a Operaciones", "See the handoff to Operations")}</Link> · <Link href={`/deals/${r.deal.id}/despacho#operaciones`}>{t("Despachos", "Dispatch")}</Link> · <Link href={`/deals/${r.deal.id}/facturacion`}>{t("Facturación", "Billing")}</Link> · <Link href={`/deals/${r.deal.id}/economia`}>{t("Eságara real", "Real Eságara")}</Link></p>
    </article>
  );

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Compromisos de alto valor", "High-value commitments")}</h1>
          <p>{t(`Cada Journey aceptado con Eságara de USD ${i.n2(threshold)} o más, visible hasta que se entrega todo y se cobra todo. El mismo umbral que usa Comercial en Foco de alto valor.`, `Every accepted Journey with Eságara of USD ${i.n2(threshold)} or more, visible until everything is delivered and everything is collected. The same threshold Sales uses in High-Value Focus.`)}</p>
        </div>
      </div>
      {rows.length === 0 && <section className="card"><p className="small muted">{t("No hay compromisos de alto valor abiertos.", "No open high-value commitments.")}</p></section>}
      {withRisk.length > 0 && <section className="card"><b>{t("CON RIESGO", "AT RISK")} · {withRisk.length}</b>{withRisk.map((r) => <Card key={r.deal.id} r={r} />)}</section>}
      {calm.length > 0 && <section className="card"><b>{t("AVANZANDO", "MOVING")} · {calm.length}</b>{calm.map((r) => <Card key={r.deal.id} r={r} />)}<p className="src">{t("«Sin riesgo conocido» significa que SOLU no ve nada material con lo registrado; no que nada pueda pasar.", "\"No known risk\" means SOLU sees nothing material in what is recorded; not that nothing can happen.")}</p></section>}
    </>
  );
}
