import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { profitSummary } from "@/lib/profit-summary";

// Módulo 12 R6 · Administración home (§28): what is ready to close, what is missing, where Eságara moved, and
// which commissions are ready. Every line leads to the place where it is resolved.

export default async function AdminCloseHome() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canManageAll(user) && !canFinance(user)) return <div className="note risk">{t("Esta vista es para Administración, Finanzas, Dirección y Gerencia.", "This view is for Administration, Finance, Direction and Management.")}</div>;
  const s = await profitSummary(user.id);
  const usd = (n: number) => `USD ${n < 0 ? "−" : ""}${i.n2(Math.abs(n))}`;
  const none = <p className="small muted">{t("Nada por ahora.", "Nothing for now.")}</p>;

  return (
    <>
      <div className="ph"><div><h1>{t("Cierre y comisiones", "Close and commissions")}</h1><p>{t("Lo que Administración puede cerrar hoy, lo que falta para cerrar lo demás, y las comisiones listas. Cada línea lleva a donde se resuelve.", "What Administration can close today, what is missing to close the rest, and the commissions that are ready. Each line leads to where it is resolved.")}</p></div></div>

      <section className="card"><b>{t("LISTOS PARA CERRAR", "READY TO CLOSE")} · {s.readyToClose.length}</b>
        {s.readyToClose.length === 0 ? none : <ul className="plain small">{s.readyToClose.map((x) => <li key={x.id}><Link href={`/deals/${x.id}/economia#cierre`}><b>{x.code}</b></Link> · {x.account} · <span className="mono">{t("Eságara", "Eságara")} {usd(x.esagara)}</span></li>)}</ul>}
      </section>

      <section className="card"><b>{t("FALTA ALGO PARA CERRAR", "SOMETHING MISSING TO CLOSE")} · {s.missing.length}</b>
        {s.missing.length === 0 ? none : <ul className="plain small">{s.missing.slice(0, 25).map((x) => <li key={x.id}><Link href={`/deals/${x.id}/economia#cierre`}><b>{x.code}</b></Link> · {x.account} · <span className="muted">{x.what.map((w) => t(w.es, w.en)).join(" · ")}</span></li>)}</ul>}
        {s.missing.length > 25 && <p className="src">{t(`y ${s.missing.length - 25} más en Eságara real.`, `and ${s.missing.length - 25} more in Real Eságara.`)}</p>}
      </section>

      <section className="card"><b>{t("DONDE MÁS CAMBIÓ LA ESÁGARA", "WHERE ESÁGARA MOVED MOST")}</b>
        {s.variances.length === 0 ? none : <ul className="plain small">{s.variances.map((x) => <li key={x.id}><Link href={`/deals/${x.id}/economia#puente`}><b>{x.code}</b></Link> · {x.account} · <span className={`mono ${x.gap < 0 ? "risk-t" : "ok-t"}`}>{x.gap > 0 ? "+" : "−"}{i.n2(Math.abs(x.gap))}</span>{x.main && <span className="muted"> · {t(x.main.es, x.main.en)}</span>}</li>)}</ul>}
      </section>

      {s.otherCurrency.length > 0 && <section className="card"><b>{t("COSTOS EN OTRA MONEDA SIN SU VALOR EN USD", "COSTS IN ANOTHER CURRENCY WITHOUT THEIR USD VALUE")} · {s.otherCurrency.length}</b>
        <ul className="plain small">{s.otherCurrency.map((x) => <li key={x.id}><Link href={`/deals/${x.id}/economia#costos`}><b>{x.code}</b></Link> · {t(`${x.n} registro(s)`, `${x.n} record(s)`)}</li>)}</ul>
      </section>}

      <section className="card"><b>{t("COMISIONES", "COMMISSIONS")}</b>
        <dl className="qv-dl">
          <dt>{t("Listas para aprobar: al facturar", "Ready to approve: at invoicing")}</dt><dd className="mono"><Link href="/gerencia/liquidacion">{usd(s.commission.saleReady.usd)}</Link><span className="muted small"> · {t(`${s.commission.saleReady.n} líneas`, `${s.commission.saleReady.n} lines`)}</span></dd>
          <dt>{t("Listas para aprobar: al recaudo", "Ready to approve: at collection")}</dt><dd className="mono"><Link href="/gerencia/liquidacion">{usd(s.commission.collectionReady.usd)}</Link><span className="muted small"> · {t(`${s.commission.collectionReady.n} líneas`, `${s.commission.collectionReady.n} lines`)}</span></dd>
          <dt>{t("Liquidaciones aprobadas sin pagar", "Settlements approved, not paid")}</dt><dd>{s.runsUnpaid.length === 0 ? <span className="muted">{t("Ninguna", "None")}</span> : s.runsUnpaid.map((r) => <span key={r.id} style={{ marginRight: 10 }}><Link href={`/gerencia/liquidacion?mes=${r.period}#corridas`}><span className="mono">{r.period} · {usd(r.total)}</span></Link></span>)}</dd>
          <dt>{t("Aprobado de más frente a las cifras de hoy", "Approved in excess of today's figures")}</dt><dd>{s.excess.length === 0 ? <span className="muted">{t("Nada", "Nothing")}</span> : <span className="mono risk-t">{usd(s.excess.reduce((a, x) => a + x.over, 0))} · {s.excess.length}</span>}</dd>
        </dl>
        <p className="src">{t("La participación mensual por rol y los ajustes por devoluciones o garantías aún no existen en SOLU.", "Monthly role participation and adjustments for returns or warranty don't exist in SOLU yet.")}</p>
      </section>
    </>
  );
}
