import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import type { BoardExtras } from "@/lib/board";
import { CellBar } from "@/components/Viz";

// The two ends of MI TABLERO on Mi Día: above, the whole route of an order with how many open cases stand at each
// step; below, the invoiced sales of the last twelve months and the customers that bought most. Same chart rules
// as Viz.tsx: one axis from zero, the figure written next to every mark, a tooltip on every mark, a table one click away.

export function RouteStrip({ x, i }: { x: BoardExtras; i: I18n }) {
  const { t } = i;
  return (
    <div className="bd-route" role="group" aria-label={t("Dónde están tus casos abiertos", "Where your open cases stand")}>
      <p className="bd-route-t"><b>{t(`${x.openCases} ${x.openCases === 1 ? "caso abierto" : "casos abiertos"}, paso por paso`, `${x.openCases} open ${x.openCases === 1 ? "case" : "cases"}, step by step`)}</b> <span className="src">{t("cada caso cuenta una vez, en el paso que le sigue al último que ya se hizo", "each case counts once, at the step right after the last one done")}</span></p>
      <ol>
        {x.stations.map((s, k) => (
          <li key={s.key} data-on={s.n > 0 ? "1" : undefined}>
            <Link href={s.href} title={s.since ? t(`${s.label}: ${s.n} · el más antiguo se creó el ${i.date(s.since)}`, `${s.label}: ${s.n} · the oldest was created on ${i.date(s.since)}`) : t(`${s.label}: ninguno ahora`, `${s.label}: none right now`)}>
              <i aria-hidden>{k + 1}</i>
              <span className="bd-st">{s.label}</span>
              <b>{s.n}</b>
              <small>{s.since ? t(`desde ${i.day(s.since)}`, `since ${i.day(s.since)}`) : "—"}</small>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SalesBars({ x, i }: { x: BoardExtras; i: I18n }) {
  const { t } = i;
  const W = 640, H = 190, L = 44, R = 8, T = 16, B = 34;
  const max = Math.max(1, ...x.months.map((m) => m.total));
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => max / s <= 4) ?? mag * 10;
  const top = Math.ceil(max / step) * step;
  const short = (v: number) => (v >= 1e6 ? `${Math.round(v / 1e5) / 10} M` : v >= 1e3 ? `${Math.round(v / 100) / 10} k` : String(Math.round(v)));
  const col = (W - L - R) / x.months.length;
  const bw = Math.min(30, col - 8);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const best = Math.max(...x.months.map((m) => m.total));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="bd-chart" role="img" aria-label={t("Ventas facturadas por mes, últimos 12 meses, en USD", "Invoiced sales per month, last 12 months, in USD")}>
      {Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step).map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "bd-base" : "bd-grid"} /><text x={L - 6} y={y(v) + 3} textAnchor="end" className="bd-ax">{short(v)}</text></g>
      ))}
      {x.months.map((m, k) => {
        const cx = L + k * col + col / 2;
        const h = m.total > 0 ? Math.max(2, H - B - y(m.total)) : 0;
        return (
          <g key={m.key} className="bd-pt">
            {h > 0 && <path d={`M${cx - bw / 2},${H - B} v${-(h - Math.min(4, h))} q0,${-Math.min(4, h)} ${Math.min(4, h)},${-Math.min(4, h)} h${bw - 2 * Math.min(4, h)} q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)} v${h - Math.min(4, h)} z`} className="bd-bar" />}
            {m.total > 0 && (m.total === best || k === x.months.length - 1) && <text x={cx} y={y(m.total) - 4} textAnchor="middle" className="bd-v">{short(m.total)}</text>}
            <text x={cx} y={H - B + 13} textAnchor="middle" className="bd-ax">{m.label}</text>
            <text x={cx} y={H - B + 26} textAnchor="middle" className="bd-ax n">{m.n > 0 ? m.n : ""}</text>
            <rect x={L + k * col} y={T} width={col} height={H - T - B} className="bd-hit"><title>{t(`${m.label} ${m.year}: ${i.money(m.total)} en ${m.n} ${m.n === 1 ? "factura" : "facturas"}`, `${m.label} ${m.year}: ${i.money(m.total)} in ${m.n} invoice(s)`)}</title></rect>
          </g>
        );
      })}
    </svg>
  );
}

export function SalesAndCustomers({ x, i }: { x: BoardExtras; i: I18n }) {
  const { t } = i;
  const maxC = Math.max(1, ...x.customers.map((c) => c.total));
  return (
    <div className="bd-two bd-sales">
      <div className="bd-pane">
        <div className="bd-ph"><b>{t("Ventas facturadas · últimos 12 meses", "Invoiced sales · last 12 months")}</b></div>
        {x.invoiceCount === 0 ? (
          <p className="quiet-p">{t("Todavía no hay facturas emitidas en los últimos 12 meses. ", "No invoices were issued in the last 12 months yet. ")}<Link href="/operaciones/por-facturar">{t("Ver lo que está por facturar", "See what is ready to invoice")}</Link></p>
        ) : (
          <>
            <p className="bd-total"><b>{i.money(x.salesTotal)}</b> {t(`en ${x.invoiceCount} ${x.invoiceCount === 1 ? "factura" : "facturas"}`, `in ${x.invoiceCount} invoice(s)`)} <span className="src">{t("· valor de las facturas emitidas, en USD, sin IVA · debajo de cada mes, el número de facturas", "· value of the invoices issued, in USD, before VAT · under each month, the number of invoices")}</span></p>
            <SalesBars x={x} i={i} />
            <details className="bd-table">
              <summary>{t("Ver las cifras en tabla", "See the figures as a table")}</summary>
              <div className="tscroll"><table>
                <thead><tr><th>{t("Mes", "Month")}</th><th className="num">{t("Ventas facturadas", "Invoiced sales")}</th><th className="num">{t("Facturas", "Invoices")}</th></tr></thead>
                <tbody>{x.months.map((m) => <tr key={m.key}><td>{m.label} {m.year}</td><td className="num">{i.money(m.total)}</td><td className="num">{m.n}</td></tr>)}</tbody>
              </table></div>
            </details>
          </>
        )}
      </div>
      <div className="bd-pane">
        <div className="bd-ph"><b>{t("Clientes que más compraron · 12 meses", "Customers that bought most · 12 months")}</b></div>
        {x.customers.length === 0 ? (
          <p className="quiet-p">{t("Aparecen aquí cuando haya facturas emitidas.", "They appear here once invoices are issued.")}</p>
        ) : (
          <>
            <ol className="bd-top">
              {x.customers.map((c, k) => (
                <li key={c.id}>
                  <span className="bd-rank" aria-hidden>{k + 1}</span>
                  <span className="bd-cn"><Link href={`/accounts/${c.id}`}>{c.name}</Link><CellBar value={c.total} max={maxC} tone="info" tip={`${c.name}: ${i.money(c.total)}`} /></span>
                  <span className="bd-cv"><b>{i.money(c.total)}</b><small>{c.n} {c.n === 1 ? t("factura", "invoice") : t("facturas", "invoices")}</small></span>
                </li>
              ))}
            </ol>
            {x.customerCount > x.customers.length && <p className="src">{t(`y ${x.customerCount - x.customers.length} clientes más con facturas en el periodo.`, `and ${x.customerCount - x.customers.length} more customers with invoices in the period.`)}</p>}
          </>
        )}
      </div>
    </div>
  );
}
