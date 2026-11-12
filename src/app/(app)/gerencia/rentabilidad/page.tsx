import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { sharePct } from "@/lib/money";
import { profitSummary } from "@/lib/profit-summary";
import { CellBar, Split } from "@/components/Viz";

// Módulo 12 R6 · Dirección / Gerencia view (§27, §30–31): what the month and the open Journeys leave, what goes to
// commissions, what is left after them, why Eságara moved, and each customer's revenue next to its Eságara.

export default async function ProfitabilityPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canManageAll(user) && !canFinance(user)) return <div className="note risk">{t("Esta vista es para Gerencia, Dirección, Finanzas y Administración.", "This view is for Management, Direction, Finance and Administration.")}</div>;
  const s = await profitSummary(user.id);
  const usd = (n: number) => `USD ${n < 0 ? "−" : ""}${i.n2(Math.abs(n))}`;
  const maxSale = Math.max(0, ...s.byCustomer.map((c) => c.sale));
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${i.n2(Math.abs(n))}`;
  const Tile = ({ k, v, sub, href }: { k: string; v: string; sub: string; href?: string }) => <div className="ft"><span className="k">{k}</span><b className="mono">{href ? <Link href={href}>{v}</Link> : v}</b><span className="src">{sub}</span></div>;

  return (
    <>
      <div className="ph"><div><h1>{t("Rentabilidad", "Profitability")}</h1><p>{t("Lo que deja el mes y lo que dejan los negocios abiertos, cuánto va a comisiones y qué queda después. Cada cifra lleva a su detalle. USD antes de IVA.", "What the month leaves and what the open business leaves, how much goes to commissions and what remains after. Each figure leads to its detail. USD before VAT.")}</p></div></div>

      <section className="ftruths" aria-label={t("Resumen", "Summary")}>
        <Tile k={t("ESÁGARA FACTURADA ESTE MES", "ESÁGARA INVOICED THIS MONTH")} v={usd(s.month.esagara)} sub={`${s.month.invoiced > 0 ? i.pct(sharePct(s.month.esagara, s.month.invoiced)) + " · " : ""}${t(`${s.month.invoices} facturas por ${usd(s.month.invoiced)}`, `${s.month.invoices} invoices for ${usd(s.month.invoiced)}`)}`} />
        <Tile k={t("ESÁGARA ESPERADA, NEGOCIOS ABIERTOS", "EXPECTED ESÁGARA, OPEN BUSINESS")} v={usd(s.expectedOpen)} sub={t(`${s.openJourneys} Journeys · protegida ${usd(s.protectedOpen)} · cambio ${signed(s.gapOpen)}`, `${s.openJourneys} Journeys · protected ${usd(s.protectedOpen)} · change ${signed(s.gapOpen)}`)} href="/administracion/economia" />
        <Tile k={t("POR COBRAR", "TO COLLECT")} v={usd(s.outstanding)} sub={t("de facturas de estos Journeys", "from these Journeys' invoices")} href="/administracion/cobrar" />
      </section>

      <section className="card" id="variable">
        <b>{t("COMISIONES Y LO QUE QUEDA DESPUÉS", "COMMISSIONS AND WHAT REMAINS AFTER")}</b>
        <Split label={t("Comisiones por etapa", "Commissions by stage")} parts={[
          { key: "est", label: t("Estimadas", "Estimated"), value: s.commission.estimated, tone: "wait", text: usd(s.commission.estimated) },
          { key: "rdy", label: t("Por aprobar", "To approve"), value: s.commission.saleReady.usd + s.commission.collectionReady.usd, tone: "attn", text: usd(s.commission.saleReady.usd + s.commission.collectionReady.usd), href: "/gerencia/liquidacion" },
          { key: "app", label: t("Aprobadas, sin pagar", "Approved, not paid"), value: s.commission.approved.usd, tone: "info", text: usd(s.commission.approved.usd) },
          { key: "pai", label: t("Pagadas", "Paid"), value: s.commission.paid.usd, tone: "ok", text: usd(s.commission.paid.usd) },
        ]} />
        <dl className="qv-dl" style={{ marginTop: 10 }}>
          <dt>{t("Estimadas (aún no ganadas)", "Estimated (not earned yet)")}</dt><dd className="mono">{usd(s.commission.estimated)}</dd>
          <dt>{t("Por aprobar: al facturar", "To approve: at invoicing")}</dt><dd className="mono"><Link href="/gerencia/liquidacion">{usd(s.commission.saleReady.usd)}</Link><span className="muted small"> · {s.commission.saleReady.n}</span></dd>
          <dt>{t("Por aprobar: al recaudo", "To approve: at collection")}</dt><dd className="mono"><Link href="/gerencia/liquidacion">{usd(s.commission.collectionReady.usd)}</Link><span className="muted small"> · {s.commission.collectionReady.n}</span></dd>
          <dt>{t("Aprobadas, sin pagar", "Approved, not paid")}</dt><dd className="mono">{usd(s.commission.approved.usd)}</dd>
          <dt>{t("Pagadas", "Paid")}</dt><dd className="mono">{usd(s.commission.paid.usd)}</dd>
          <dt>{t("Eságara esperada de lo abierto, después de comisiones", "Expected Eságara of open business, after commissions")}</dt><dd><b className="mono">{usd(s.contributionAfterVariable)}</b></dd>
        </dl>
        <p className="src">{t("La participación mensual por rol no está activa, así que no se descuenta aquí. Comisión directa y participación se mostrarán siempre por separado.", "Monthly role participation is not active, so it is not deducted here. Direct commission and participation will always be shown separately.")}</p>
      </section>

      <section className="card" id="causas">
        <b>{t("POR QUÉ CAMBIÓ LA ESÁGARA (NEGOCIOS ABIERTOS)", "WHY ESÁGARA MOVED (OPEN BUSINESS)")}</b>
        {s.drivers.length === 0 ? <p className="small muted"><span className="sig ok">{t("Sin cambios frente a lo protegido.", "No changes against what was protected.")}</span></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Causa", "Cause")}</th><th className="n">USD</th><th className="n">{t("Journeys", "Journeys")}</th></tr></thead>
            <tbody>{s.drivers.map((d, k) => <tr key={k}><td>{t(d.text.es, d.text.en)}</td><td className={`n mono ${d.usd < 0 ? "risk-t" : "ok-t"}`}>{signed(d.usd)}</td><td className="n mono">{d.n}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="clientes">
        <b>{t("POR CLIENTE: VENTA Y LO QUE DEJA", "BY CUSTOMER: SALE AND WHAT IT LEAVES")}</b>
        {s.byCustomer.length === 0 ? <p className="small muted">{t("Aún no hay negocios aceptados.", "No accepted business yet.")} <Link href="/deals">{t("Abrir Journeys", "Open Journeys")} →</Link></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cliente", "Customer")}</th><th className="n">{t("Journeys", "Journeys")}</th><th className="n">{t("Venta", "Sale")}</th><th className="n">{t("Eságara esperada", "Expected Eságara")}</th><th className="n">%</th><th className="n">{t("Frente a la protegida", "Vs protected")}</th><th className="n">{t("Por cobrar", "To collect")}</th></tr></thead>
            <tbody>{s.byCustomer.map((c) => <tr key={c.id}><td><Link href={`/accounts/${c.id}`}>{c.name}</Link></td><td className="n mono">{c.journeys}</td><td className="n mono">{i.n2(c.sale)}<CellBar value={c.sale} max={maxSale} tone="wait" tip={`${c.name} · ${t("venta", "sale")} ${i.n2(c.sale)}`} /></td><td className="n mono">{i.n2(c.expected)}<CellBar value={c.expected} max={maxSale} tone={c.expected - c.prot < -0.005 ? "risk" : "ok"} tip={`${c.name} · ${t("Eságara esperada", "expected Eságara")} ${i.n2(c.expected)}`} /></td><td className="n mono">{c.sale > 0 ? i.pct(sharePct(c.expected, c.sale)) : "—"}</td><td className={`n mono ${c.expected - c.prot < -0.005 ? "risk-t" : ""}`}>{signed(Math.round((c.expected - c.prot) * 100) / 100)}</td><td className="n mono">{i.n2(c.outstanding)}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="small"><span className="vz-key"><i style={{ background: "#8a96a8" }} />{t("venta", "sale")}</span><span className="vz-key"><i style={{ background: "var(--ok)" }} />{t("Eságara esperada, en la misma escala (rojo si quedó por debajo de la protegida)", "expected Eságara, on the same scale (red when below the protected one)")}</span></p>
        <p className="src">{t("Ordenado por venta, no por rentabilidad: es para ver juntos el tamaño del cliente y lo que deja, con su contexto. Hasta 80 Journeys aceptados.", "Sorted by sale, not by profitability: it is meant to show a customer's size next to what it leaves, with context. Up to 80 accepted Journeys.")}</p>
      </section>
    </>
  );
}
