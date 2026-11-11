import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { invoiceCash, today } from "@/lib/domain";
import { sumMoney } from "@/lib/money";
import { matchState } from "@/lib/bank-csv";
import { HORIZONS, HORIZON_TEXT, futurePulse } from "@/lib/future-pulse";
import { profitSummary } from "@/lib/profit-summary";
import { HowCalc } from "@/components/HowCalc";

// Módulo 13 §4.5 · Administración: receivables by age, what is due in and out, credit exposure, what the bank shows
// that nobody has explained, Eságara and commissions. A snapshot of today; each block links to where it is worked.

export default async function AdminReportPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canManageAll(user) && !canFinance(user)) return <div className="note risk">{t("Esta vista es para Administración, Finanzas, Dirección y Gerencia.", "This view is for Administration, Finance, Direction and Management.")}</div>;
  const T = today();
  const [invoices, f, s, txs, unreconciled, accounts] = await Promise.all([
    db.invoice.findMany({ select: { dueAt: true, amount: true, accountId: true, applications: { select: { amount: true, payment: { select: { reconciledAt: true } } } } } }),
    futurePulse(), profitSummary(user.id),
    db.bankTransaction.findMany({ select: { amount: true, classifiedAs: true, matches: { select: { amount: true } } } }),
    db.customerPayment.findMany({ where: { kind: "CASH", reconciledAt: null }, select: { amount: true } }),
    db.account.findMany({ where: { internal: false, creditLimit: { not: null } }, select: { id: true, name: true, creditLimit: true } }),
  ]);
  const open = invoices.map((x) => { const c = invoiceCash(x); return { acc: x.accountId, late: Math.floor((+T - +x.dueAt) / 864e5), b: c.balance - c.pendingReconcile }; }).filter((x) => x.b > 0.005);
  const bucket = (pred: (late: number) => boolean) => { const xs = open.filter((x) => pred(x.late)); return { n: xs.length, usd: sumMoney(xs.map((x) => x.b)) }; };
  const aging = [
    { label: t("Sin vencer", "Not due"), ...bucket((d) => d <= 0) }, { label: t("1 a 30 días vencida", "1 to 30 days overdue"), ...bucket((d) => d >= 1 && d <= 30) },
    { label: t("31 a 60 días", "31 to 60 days"), ...bucket((d) => d >= 31 && d <= 60) }, { label: t("Más de 60 días", "Over 60 days"), ...bucket((d) => d > 60) },
  ];
  const byAcc = new Map<string, number>(); for (const x of open) byAcc.set(x.acc, (byAcc.get(x.acc) ?? 0) + x.b);
  const over = accounts.map((a) => ({ ...a, owed: Math.round((byAcc.get(a.id) ?? 0) * 100) / 100 })).filter((a) => a.owed > Number(a.creditLimit) + 0.005).sort((a, b) => b.owed - a.owed);
  const unexplained = txs.map((x) => matchState(Number(x.amount), sumMoney(x.matches.map((m) => m.amount)), x.classifiedAs)).filter((m) => m.state === "UNMATCHED" || m.state === "PARTIAL");
  const usd = (n: number) => `USD ${i.n2(n)}`;

  return (
    <>
      <div className="ph"><div><h1>{t("Administración: recursos y exposición", "Administration: resources and exposure")}</h1><p>{t("La cartera por edad, lo que debe entrar y salir, el crédito, lo que el banco muestra sin explicar, la Eságara y las comisiones.", "Receivables by age, what is due in and out, credit, what the bank shows unexplained, Eságara and commissions.")}</p>
        <p className="small">{t("calculado", "as of")} {i.day(new Date())} · <span className="sig wait">{t("foto de hoy", "today's snapshot")}</span></p></div></div>

      <section className="card" id="cartera">
        <b>{t("CARTERA POR EDAD", "RECEIVABLES BY AGE")}</b> <HowCalc id="OUTSTANDING" es={i.es} />
        <div className="tscroll"><table>
          <thead><tr><th>{t("Edad", "Age")}</th><th className="n">{t("Facturas", "Invoices")}</th><th className="n">USD</th></tr></thead>
          <tbody>{aging.map((a, k) => <tr key={k}><td>{a.label}</td><td className="n mono">{a.n}</td><td className={`n mono ${k > 0 && a.usd > 0 ? "risk-t" : ""}`}>{i.n2(a.usd)}</td></tr>)}
            <tr><td><b>{t("Total por cobrar", "Total outstanding")}</b></td><td className="n mono"><b>{open.length}</b></td><td className="n mono"><b>{i.n2(sumMoney(open.map((x) => x.b)))}</b></td></tr></tbody>
        </table></div>
        <p className="src"><Link href="/administracion/cobrar">{t("Abrir cuentas por cobrar", "Open receivables")}</Link> · {t(`${unreconciled.length} pago(s) recibido(s) por conciliar por ${usd(sumMoney(unreconciled.map((p) => p.amount)))}`, `${unreconciled.length} payment(s) received to reconcile for ${usd(sumMoney(unreconciled.map((p) => p.amount)))}`)}</p>
      </section>

      <section className="card" id="calendario">
        <b>{t("LO QUE DEBE ENTRAR Y SALIR", "WHAT IS DUE IN AND OUT")}</b>
        <div className="tscroll"><table>
          <thead><tr><th />{HORIZONS.map((h) => <th key={h} className="n">{t(HORIZON_TEXT[h].es, HORIZON_TEXT[h].en)}</th>)}</tr></thead>
          <tbody>
            <tr><td>{t("Por cobrar a clientes", "To collect from customers")}</td>{HORIZONS.map((h) => <td key={h} className="n mono">{f.cashIn[h].n ? i.n2(f.cashIn[h].usd) : "—"}</td>)}</tr>
            <tr><td>{t("Por pagar a proveedores", "To pay suppliers")}</td>{HORIZONS.map((h) => <td key={h} className="n mono">{f.cashOut[h].n ? i.n2(f.cashOut[h].usd) : "—"}</td>)}</tr>
            <tr><td>{t("Por facturar de lo contratado", "To invoice from what is contracted")}</td>{HORIZONS.map((h) => <td key={h} className="n mono">{f.contracted.toInvoice[h].n ? i.n2(f.contracted.toInvoice[h].usd) : "—"}</td>)}</tr>
          </tbody>
        </table></div>
        <p className="src">{t("Por fecha de vencimiento o prometida, no por cuándo se paga de verdad. El saldo en bancos, lo comprometido y la caja proyectada están en Tesorería.", "By due or promised date, not by when it is really paid. Bank balances, what is committed and projected cash are in Treasury.")} <Link href="/administracion/tesoreria">{t("Tesorería", "Treasury")}</Link> · <Link href="/informes/futuro">{t("Pulso del futuro", "Future pulse")}</Link></p>
      </section>

      <section className="card" id="credito">
        <b>{t("CRÉDITO", "CREDIT")}</b>
        {over.length === 0 ? <p className="small"><span className="sig ok">{t("Ningún cliente debe más que su cupo", "No customer owes more than its limit")}</span> <span className="muted">· {t(`${accounts.length} clientes con cupo definido`, `${accounts.length} customers with a limit set`)}</span></p> : (
          <ul className="plain small">{over.map((a) => <li key={a.id}><Link href={`/accounts/${a.id}`}><b>{a.name}</b></Link> · {t("debe", "owes")} <span className="mono risk-t">{usd(a.owed)}</span> · {t("cupo", "limit")} <span className="mono">{usd(Number(a.creditLimit))}</span></li>)}</ul>
        )}
        <p className="src"><Link href="/administracion/cupos">{t("Cupos de crédito", "Credit limits")}</Link></p>
      </section>

      <section className="card" id="banco">
        <b>{t("BANCO", "BANK")}</b>
        <p className="small">{txs.length === 0 ? <span className="muted">{t("Aún no se ha subido ningún extracto.", "No statement has been uploaded yet.")}</span> : <>{t("Movimientos sin explicar", "Movements not explained")}: <b className={`mono ${unexplained.length ? "risk-t" : ""}`}>{unexplained.length}</b> {t("por", "for")} <span className="mono">{usd(sumMoney(unexplained.map((m) => m.open)))}</span> <span className="muted">· {t(`de ${txs.length} cargados`, `of ${txs.length} loaded`)}</span></>} · <Link href="/administracion/banco">{t("Abrir banco", "Open bank")}</Link></p>
      </section>

      <section className="card" id="rentabilidad">
        <b>{t("ESÁGARA Y COMISIONES", "ESÁGARA AND COMMISSIONS")}</b>
        <dl className="qv-dl">
          <dt>{t("Eságara protegida, negocios abiertos", "Protected Eságara, open business")}</dt><dd className="mono">{usd(s.protectedOpen)}</dd>
          <dt>{t("Eságara esperada hoy", "Expected Eságara today")}<span className="block"><HowCalc id="MARGIN_VARIANCE" es={i.es} /></span></dt><dd className="mono">{usd(s.expectedOpen)} <span className={s.gapOpen < 0 ? "risk-t" : "muted"}>({s.gapOpen > 0 ? "+" : s.gapOpen < 0 ? "−" : ""}{i.n2(Math.abs(s.gapOpen))})</span></dd>
          <dt>{t("Journeys listos para cerrar", "Journeys ready to close")}</dt><dd className="mono"><Link href="/administracion/cierre">{s.readyToClose.length}</Link> <span className="muted">· {t(`${s.missing.length} con algo pendiente`, `${s.missing.length} with something pending`)}</span></dd>
          <dt>{t("Comisiones por aprobar", "Commissions to approve")}</dt><dd className="mono"><Link href="/gerencia/liquidacion">{usd(s.commission.saleReady.usd + s.commission.collectionReady.usd)}</Link></dd>
          <dt>{t("Comisiones aprobadas sin pagar", "Commissions approved, not paid")}</dt><dd className="mono">{usd(s.commission.approved.usd)}</dd>
        </dl>
        <p className="src"><Link href="/gerencia/rentabilidad">{t("Rentabilidad", "Profitability")}</Link> · <Link href="/administracion/economia">{t("Eságara real", "Real Eságara")}</Link></p>
      </section>
    </>
  );
}
