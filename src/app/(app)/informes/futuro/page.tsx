import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { HORIZONS, HORIZON_TEXT, futurePulse, interventionQueue } from "@/lib/future-pulse";

// Módulo 13 §6, §23 · Future Pulse and Gerencia's intervention queue. Four futures side by side, never one number;
// and a short list of matters that need a decision, each with its impact, its owner and where to decide.

export default async function FuturePulsePage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canManageAll(user) && !canFinance(user)) return <div className="note risk">{t("El pulso del futuro es para Gerencia, Dirección, Finanzas y Administración.", "The future pulse is for Management, Direction, Finance and Administration.")}</div>;
  const [f, queue] = await Promise.all([futurePulse(), interventionQueue(user.id)]);
  const usd = (n: number) => `USD ${i.n2(n)}`;
  const Row = ({ label, b, money = true }: { label: string; b: Record<string, { n: number; usd: number }>; money?: boolean }) => (
    <tr><td>{label}</td>{HORIZONS.map((h) => <td key={h} className={`n mono ${h === "OVERDUE" && b[h].n > 0 ? "risk-t" : ""}`}>{b[h].n === 0 ? "—" : money ? <>{i.n2(b[h].usd)}<span className="src block">{b[h].n}</span></> : b[h].n}</td>)}</tr>
  );
  const Head = () => <thead><tr><th />{HORIZONS.map((h) => <th key={h} className="n">{t(HORIZON_TEXT[h].es, HORIZON_TEXT[h].en)}</th>)}</tr></thead>;

  return (
    <>
      <div className="ph"><div><h1>{t("Pulso del futuro", "Future pulse")}</h1><p>{t("Lo que viene, en cuatro futuros distintos que no se suman entre sí: lo que el mercado puede traer, lo que Comercial está trabajando, lo ya contratado y el dinero en camino. Sin probabilidades: son conteos y valores en su estado real, según cuándo vencen.", "What is coming, in four different futures that are never added together: what the market may bring, what Commercial is working, what is already contracted, and the money on its way. No probabilities: these are counts and amounts in their real state, by when they are due.")}</p>
        <p className="small">{t("calculado", "as of")} {i.day(f.asOf)} · <span className="sig wait">{t("foto de hoy", "today's snapshot")}</span></p></div></div>

      <section className="card" id="cola">
        <b>{t("DÓNDE DEBE INTERVENIR GERENCIA", "WHERE MANAGEMENT SHOULD STEP IN")} · {queue.length}</b>
        {queue.length === 0 ? <p className="small muted">{t("Nada material por decidir ahora.", "Nothing material to decide right now.")}</p> : queue.map((q) => (
          <article key={q.key} className="exc-item">
            <header className="exc-head"><span className="sig attn">{t(q.kind.es, q.kind.en)}</span> <b><Link href={q.href}>{q.headline}</Link></b><span className="grow" />{q.impact && <span className="mono small">{q.impact}</span>}</header>
            <p className="small">{t("Decisión", "Decision")}: {t(q.decision.es, q.decision.en)}{q.owner && <span className="muted"> · {t("lleva", "owner")}: {q.owner}</span>}</p>
          </article>
        ))}
        <p className="src">{t("La lista es corta a propósito: lo que avanza normal no aparece aquí.", "The list is short on purpose: what is moving normally doesn't appear here.")}</p>
      </section>

      <section className="card" id="mercado">
        <b>{t("FUTURO DE MERCADO", "MARKET FUTURE")}</b> <span className="small muted">{t("oportunidades futuras identificadas: razones para volver, no ventas", "future opportunities identified: reasons to come back, not sales")}</span>
        <div className="tscroll"><table><Head /><tbody><Row label={t("Oportunidades futuras", "Future opportunities")} b={f.market} money={false} /></tbody></table></div>
        {f.marketList.length > 0 && <ul className="plain small">{f.marketList.map((x) => <li key={x.id}><span className="mono">{i.day(x.expectedAt!)}</span> · {x.description}{x.account && <> · <Link href={`/accounts/${x.account.id}`}>{x.account.name}</Link></>}</li>)}</ul>}
      </section>

      <section className="card" id="comercial">
        <b>{t("FUTURO COMERCIAL", "COMMERCIAL FUTURE")}</b> <span className="small muted">{t("lo que está vivo: una cotización perdida es aprendizaje, no futuro", "what is alive: a lost quote is learning, not future")}</span>
        <dl className="qv-dl">
          <dt>{t("Necesidades sin cotización", "Needs without a quote")}</dt><dd className="mono"><Link href="/deals">{f.commercial.needs}</Link></dd>
          <dt>{t("Cotizaciones en preparación", "Quotes being prepared")}</dt><dd className="mono">{f.commercial.drafts.n} · {t("venta", "sale")} {usd(f.commercial.drafts.sale)} · Eságara {usd(f.commercial.drafts.esagara)}</dd>
          <dt>{t("Presentadas, esperando decisión", "Presented, awaiting decision")}</dt><dd className="mono"><Link href="/cotizaciones">{f.commercial.presented.n}</Link> · {t("venta", "sale")} {usd(f.commercial.presented.sale)} · Eságara {usd(f.commercial.presented.esagara)}</dd>
        </dl>
        <div className="tscroll"><table><Head /><tbody><Row label={t("Eságara de lo presentado, por fecha de decisión", "Eságara of what is presented, by decision date")} b={f.commercial.decisions} /></tbody></table></div>
        <p className="src">{t("No es un pronóstico: es la Eságara de las cotizaciones presentadas, agrupada por cuándo el cliente dijo que decide. Ninguna está ganada.", "This is not a forecast: it is the Eságara of presented quotes, grouped by when the customer said they will decide. None is won.")}</p>
      </section>

      <section className="card" id="contratado">
        <b>{t("FUTURO CONTRATADO", "CONTRACTED FUTURE")}</b> <span className="small muted">{t("negocios aceptados que aún no se han facturado del todo", "accepted business not yet fully invoiced")}</span>
        <p className="small"><b className="mono">{usd(f.contracted.usd)}</b> {t(`por facturar en ${f.contracted.n} Journeys`, `to invoice across ${f.contracted.n} Journeys`)} · <Link href="/operaciones/compromisos">{t("ver alto valor", "see high value")}</Link></p>
        <div className="tscroll"><table><Head /><tbody><Row label={t("Por facturar, según la fecha prometida al cliente", "To invoice, by the date promised to the customer")} b={f.contracted.toInvoice} /></tbody></table></div>
      </section>

      <section className="card" id="financiero">
        <b>{t("FUTURO FINANCIERO", "FINANCIAL FUTURE")}</b> <span className="small muted">{t("dinero que debe entrar y salir, por fecha de vencimiento", "money due in and out, by due date")}</span>
        <div className="tscroll"><table><Head /><tbody>
          <Row label={t("Por cobrar a clientes", "To collect from customers")} b={f.cashIn} />
          <Row label={t("Por pagar a proveedores (solicitado, sin ejecutar)", "To pay suppliers (requested, not executed)")} b={f.cashOut} />
        </tbody></table></div>
        <p className="src">{t("La fecha de vencimiento no es la fecha en que el cliente paga de verdad; su comportamiento real está en cada cliente. No incluye el saldo en bancos.", "The due date is not when the customer really pays; their real behaviour is on each customer. Bank balances are not included.")} <Link href="/administracion/cobrar">{t("Cuentas por cobrar", "Receivables")}</Link> · <Link href="/administracion/pagos-proveedores">{t("Pagos a proveedores", "Supplier payments")}</Link></p>
      </section>
    </>
  );
}
