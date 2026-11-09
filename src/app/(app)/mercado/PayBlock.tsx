import Link from "next/link";
import { PAY_FORMULA, type PayBehavior, type PayRules } from "@/lib/pay-rules";

type T = (es: string, en: string) => string;
type I = { n: (v: number) => string; n2: (v: number) => string; day: (d: Date) => string };

const TREND: Record<string, { es: string; en: string; tone: string }> = {
  WORSE: { es: "Paga más lento que antes", en: "Paying more slowly than before", tone: "attn" },
  BETTER: { es: "Paga más rápido que antes", en: "Paying faster than before", tone: "ok" },
  STABLE: { es: "Estable", en: "Stable", tone: "info" },
  UNKNOWN: { es: "Aún sin tendencia", en: "No trend yet", tone: "dash" },
};
const BAND: Record<string, { es: string; en: string }> = { SMALL: { es: "Pequeñas", en: "Small" }, MEDIUM: { es: "Medianas", en: "Medium" }, LARGE: { es: "Grandes", en: "Large" } };

/** How a customer actually pays (§10). Summary for everyone; detail (amounts, invoices) for Administration/Management.
 *  Facts only: never "good/bad payer", never changes credit. */
export function PayBlock({ b, rules, rulesVersion, detail, t, i, accountId }: { b: PayBehavior; rules: PayRules; rulesVersion: number; detail: boolean; t: T; i: I; accountId: string }) {
  const e = b.expected;
  const all = b.windows[3];
  const tr = TREND[b.trend.trend];
  const usd = (v: number) => `USD ${i.n2(v)}`;
  const d = (v: number | null) => (v == null ? "—" : `${i.n(v)} d`);
  if (!b.facts.length) return <div className="card empty small">{t("Aún no hay facturas con este cliente. Cuando cobremos y Tesorería concilie, aquí verás cómo paga en la práctica.", "No invoices with this customer yet. Once we collect and Treasury reconciles, you'll see how they actually pay here.")}</div>;
  return (
    <div className="stack">
      <div className="grid cols-2">
        <div className="card">
          <b>{t("Pactado frente a real", "Agreed vs actual")}</b>
          <p className="small">{t("Plazo pactado", "Agreed terms")}: <b>{e.contractualDays} {t("días", "days")}</b></p>
          {e.expectedDays == null ? <p className="small muted">{t("Todavía no hay facturas cobradas y conciliadas: se usa el plazo pactado.", "No collected and reconciled invoices yet: the agreed terms are used.")}</p> : (
            <>
              <p className="small">{t("Según su historial paga en", "Based on history they pay in")}: <b>{e.expectedDays} {t("días", "days")}</b>{e.deltaDays ? <span className={e.deltaDays > 0 ? "attn-t" : ""}> ({e.deltaDays > 0 ? "+" : ""}{e.deltaDays} {t("días", "days")})</span> : null}</p>
              <span className="src block">{t(`Promedio de ${e.n} factura(s) cobrada(s) y conciliada(s)${e.months ? ` en los últimos ${e.months} meses` : " en toda la historia"}.`, `Average of ${e.n} collected and reconciled invoice(s)${e.months ? ` in the last ${e.months} months` : " over all history"}.`)}{!e.enough && t(` Con menos de ${rules.minInvoices} es solo orientativo.`, ` With fewer than ${rules.minInvoices} it's only indicative.`)}</span>
            </>
          )}
          <span className="src block">{t("Comercial usa estos días para estimar cuánto tiempo financiamos una venta. No cambia el cupo ni el plazo: eso lo decide Administración.", "Commercial uses these days to estimate how long we finance a sale. It doesn't change the limit or terms: Administration decides that.")}</span>
        </div>
        <div className="card">
          <b>{t("Cómo viene pagando", "How they've been paying")}</b>
          <p className="small"><span className={`sig ${tr.tone}`}>{t(tr.es, tr.en)}</span>{b.trend.delta != null && <span className="src"> {t(`retraso promedio: ${b.trend.prior} d (12 meses anteriores, ${b.trend.nPrior}) → ${b.trend.recent} d (últimos 6 meses, ${b.trend.nRecent})`, `average delay: ${b.trend.prior} d (prior 12 months, ${b.trend.nPrior}) → ${b.trend.recent} d (last 6 months, ${b.trend.nRecent})`)}</span>}</p>
          <ul className="mk-ul">
            <li className="small">{t("A tiempo", "On time")}: <b>{all.onTimePct == null ? "—" : `${i.n(all.onTimePct)} %`}</b>{rules.graceDays ? <span className="src"> {t(`hasta ${rules.graceDays} d después del vencimiento`, `up to ${rules.graceDays} d after due`)}</span> : null}</li>
            <li className="small">{t("Retraso promedio / mediana", "Average / median delay")}: <b>{d(all.avgDelay)}</b> / {d(all.medianDelay)}</li>
            <li className="small">{t("Rango", "Range")}: {d(all.minDelay)} … {d(all.worstDelay)} <span className="src">{t("(negativo = pagó antes)", "(negative = paid early)")}</span></li>
            <li className="small">{t("Promesas de pago", "Payment promises")}: {b.promises.kept + b.promises.broken ? <b>{t(`${b.promises.kept} de ${b.promises.kept + b.promises.broken} cumplidas`, `${b.promises.kept} of ${b.promises.kept + b.promises.broken} kept`)}</b> : t("sin promesas vencidas", "no promises due yet")}{b.promises.pending ? <span className="src"> · {t(`${b.promises.pending} en curso`, `${b.promises.pending} pending`)}</span> : null}</li>
          </ul>
          <span className="src block">{t("Solo cuenta el dinero conciliado por Tesorería; un pago recibido sin conciliar no mejora nada todavía.", "Only cash reconciled by Treasury counts; a payment received but not reconciled doesn't improve anything yet.")} · {PAY_FORMULA} · {t("reglas", "rules")} v{rulesVersion}</span>
        </div>
      </div>

      {detail && (
        <>
          <div className="grid cols-2">
            <div className="card flush mk-scroll">
              <table>
                <thead><tr><th>{t("Ventana", "Window")}</th><th className="n">{t("Cobradas", "Collected")}</th><th className="n">{t("Días reales", "Actual days")}</th><th className="n">{t("Retraso", "Delay")}</th><th className="n">{t("Peor", "Worst")}</th><th className="n">{t("A tiempo", "On time")}</th></tr></thead>
                <tbody>{b.windows.map((w) => (
                  <tr key={String(w.months)}><td>{w.months ? t(`${w.months} meses`, `${w.months} months`) : t("Toda la historia", "All history")}</td><td className="n">{w.n}</td><td className="n">{d(w.avgActualDays)}</td><td className="n">{d(w.avgDelay)}</td><td className="n">{d(w.worstDelay)}</td><td className="n">{w.onTimePct == null ? "—" : `${i.n(w.onTimePct)} %`}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="card">
              <b>{t("Por tamaño de factura", "By invoice size")}</b>
              <ul className="mk-ul">{b.bands.map((x) => (
                <li key={x.band} className="small">{t(BAND[x.band].es, BAND[x.band].en)} <span className="src">({x.band === "SMALL" ? `< USD ${i.n(rules.bandSmallUsd)}` : x.band === "MEDIUM" ? `USD ${i.n(rules.bandSmallUsd)}–${i.n(rules.bandLargeUsd)}` : `≥ USD ${i.n(rules.bandLargeUsd)}`})</span>: {x.n ? <><b>{d(x.avgDelay)}</b> {t("de retraso promedio", "average delay")} · {x.n} {t("cobrada(s)", "collected")}</> : <span className="muted">—</span>}</li>
              ))}</ul>
              <b className="small">{t("Exposición abierta hoy", "Open exposure today")}</b>
              <p className="small">{usd(b.exposure.openTotal)} {t(`en ${b.exposure.openCount} factura(s)`, `in ${b.exposure.openCount} invoice(s)`)}{b.exposure.overdueCount ? <span className="attn-t"> · {t(`vencido ${usd(b.exposure.overdueTotal)} (${b.exposure.overdueCount}), la más antigua hace ${b.exposure.oldestOverdueDays} d`, `overdue ${usd(b.exposure.overdueTotal)} (${b.exposure.overdueCount}), oldest ${b.exposure.oldestOverdueDays} d ago`)}</span> : null}</p>
              {b.exposure.pendingReconcile > 0 && <span className="src block">{t(`${usd(b.exposure.pendingReconcile)} recibido y aplicado, pendiente de conciliar: aún no reduce la exposición.`, `${usd(b.exposure.pendingReconcile)} received and applied, awaiting reconciliation: it doesn't reduce exposure yet.`)}</span>}
              <Link href="/administracion/cobrar" className="small">{t("Ver cuentas por cobrar", "See receivables")}</Link>
            </div>
          </div>
          <details className="card">
            <summary className="small"><b>{t(`Factura por factura (${b.facts.length})`, `Invoice by invoice (${b.facts.length})`)}</b></summary>
            <div className="mk-scroll">
              <table>
                <thead><tr><th>{t("Factura", "Invoice")}</th><th>{t("Emitida", "Issued")}</th><th className="n">{t("Valor", "Amount")}</th><th className="n">{t("Plazo", "Terms")}</th><th>{t("Cobrada (conciliada)", "Collected (reconciled)")}</th><th className="n">{t("Días reales", "Actual days")}</th><th className="n">{t("Retraso", "Delay")}</th></tr></thead>
                <tbody>{b.facts.map((f) => (
                  <tr key={f.id}><td className="mono">{f.number}</td><td>{i.day(f.issuedAt)}</td><td className="n">{usd(f.amount)}</td><td className="n">{f.termDays} d</td>
                    <td>{f.paidAt ? i.day(f.paidAt) : f.open > 0 ? <span className={f.overdueDays ? "attn-t" : "muted"}>{f.overdueDays ? t(`abierta · vencida hace ${f.overdueDays} d`, `open · overdue ${f.overdueDays} d`) : t("abierta", "open")}</span> : "—"}</td>
                    <td className="n">{d(f.actualDays)}</td><td className="n">{d(f.delay)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {!detail && <span className="src">{t("El detalle de montos y facturas lo ven Administración y Gerencia.", "Amounts and invoice detail are visible to Administration and Management.")} <Link href={`/accounts/${accountId}`}>{t("Ver cliente", "See customer")}</Link></span>}
    </div>
  );
}
