import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { LOT_STATES } from "@/lib/stock-rules";
import { resourceExposure } from "@/lib/admin-home";

// Módulo 14 §5 · Resource Exposure. Seven different exposures, each with its own figures and its own drill-down.
// They are never added or turned into one score (AC13): a cash gap and an uninsured truck are not the same thing.

export default async function ExposurePage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  if (!canFinance(user)) return <div className="note risk">{t("Esta vista es para Administración, Finanzas, Dirección y Gerencia.", "This view is for Administration, Finance, Direction and Management.")}</div>;
  const e = await resourceExposure(user.id);
  const usd = (n: number) => `USD ${n < 0 ? "−" : ""}${i.n2(Math.abs(n))}`;
  const lot = (s: string) => { const x = (LOT_STATES as Record<string, { es: string; en: string } | undefined>)[s]; return x ? t(x.es, x.en) : s; };

  return (
    <>
      <div className="ph"><div><h1>{t("Exposición de recursos", "Resource exposure")}</h1><p>{t("Qué tenemos, qué debemos, qué nos deben, qué hemos comprometido y cuánto riesgo estamos asumiendo. Siete exposiciones distintas, sin sumarlas en un solo número.", "What we have, what we owe, what we are owed, what we have committed and how much risk we carry. Seven different exposures, never added into one number.")}</p>
        <p className="small">{t("calculado", "as of")} {i.date(e.asOf)} · <span className="sig wait">{t("foto de hoy", "today's snapshot")}</span></p></div></div>

      <section className="card" id="caja"><b>{t("1 · CAJA", "1 · CASH")}</b>
        <dl className="qv-dl">
          <dt>{t("En bancos (confirmado)", "In banks (confirmed)")}</dt><dd className="mono">{usd(e.cash.bank)}{e.cash.missing + e.cash.stale > 0 ? <span className="sig attn"> {t(`${e.cash.missing + e.cash.stale} saldo(s) sin confirmar o viejos`, `${e.cash.missing + e.cash.stale} balance(s) unconfirmed or old`)}</span> : null}</dd>
          <dt>{t("Restringido + reservado", "Restricted + reserved")}</dt><dd className="mono">{usd(e.cash.restricted + e.cash.reserved)}</dd>
          <dt>{t("Comprometido (aprobado sin pagar)", "Committed (approved, unpaid)")}</dt><dd className="mono">{usd(e.cash.committed)}</dd>
          <dt>{t("Disponible", "Available")}</dt><dd className={`mono ${e.cash.available < 0 ? "risk-t" : ""}`}><b>{usd(e.cash.available)}</b></dd>
          <dt>{t("Faltante a 90 días", "Gap within 90 days")}</dt><dd className={`mono ${e.cash.gap > 0 ? "risk-t" : ""}`}>{e.cash.gap > 0 ? `${usd(e.cash.gap)}${e.cash.lowOn ? ` · ${i.day(e.cash.lowOn)}` : ""}` : t("ninguno", "none")}</dd>
        </dl>
        <p className="src"><Link href="/administracion/tesoreria">{t("Tesorería", "Treasury")}</Link></p>
      </section>

      <section className="card" id="clientes"><b>{t("2 · CLIENTES", "2 · CUSTOMERS")}</b>
        <dl className="qv-dl">
          <dt>{t("Nos deben (facturado)", "Owed to us (invoiced)")}</dt><dd className="mono">{usd(e.customer.ar)}</dd>
          <dt>{t("de eso, vencido", "of which overdue")}</dt><dd className={`mono ${e.customer.overdue > 0 ? "risk-t" : ""}`}>{usd(e.customer.overdue)}</dd>
          <dt>{t("Aceptado y aún sin facturar", "Accepted, not yet invoiced")}</dt><dd className="mono">{usd(e.customer.uninvoiced)}</dd>
          <dt>{t("Clientes sobre su cupo", "Customers over their limit")}</dt><dd className={`mono ${e.customer.overN ? "risk-t" : ""}`}>{e.customer.overN}{e.customer.overN ? ` · ${usd(e.customer.overUsd)}` : ""}</dd>
        </dl>
        {e.customer.top.length > 0 && <ul className="plain small">{e.customer.top.map((c) => <li key={c.id}><Link href={`/accounts/${c.id}`}>{c.name}</Link> · <span className="mono">{usd(c.used)}</span>{c.limit != null ? <span className="muted"> · {t("cupo", "limit")} {i.n2(c.limit)}</span> : <span className="muted"> · {t("sin cupo definido", "no limit set")}</span>}</li>)}</ul>}
        <p className="src">{t("El crédito a un cliente es dinero de la empresa invertido en él.", "Credit given to a customer is company money invested in it.")} <Link href="/administracion/cupos">{t("Cupos de crédito", "Credit limits")}</Link> · <Link href="/administracion/cobrar">{t("Cuentas por cobrar", "Receivables")}</Link></p>
      </section>

      <section className="card" id="proveedores"><b>{t("3 · PROVEEDORES", "3 · SUPPLIERS")}</b>
        <dl className="qv-dl">
          <dt>{t("Pagado por adelantado, mercancía sin recibir", "Paid in advance, goods not received")}</dt><dd className={`mono ${e.supplier.advanced > 0 ? "risk-t" : ""}`}>{usd(e.supplier.advanced)}</dd>
          <dt>{t("Órdenes abiertas sin recibir", "Open orders not received")}</dt><dd className="mono">{usd(e.supplier.open)} <span className="muted">· {t(`${e.supplier.n} proveedores`, `${e.supplier.n} suppliers`)}</span></dd>
        </dl>
        {e.supplier.top.length > 0 && <ul className="plain small">{e.supplier.top.map((s) => <li key={s.id}><Link href={`/suppliers/${s.id}`}>{s.name}</Link> · {t("adelantado", "advanced")} <span className="mono">{usd(s.advanced)}</span> · {t("órdenes", "orders")} <span className="mono">{usd(s.open)}</span></li>)}</ul>}
        <p className="src">{t("Solo órdenes en USD.", "USD orders only.")} <Link href="/compras">{t("Compras", "Purchasing")}</Link> · <Link href="/administracion/pagar">{t("Cuentas por pagar", "Payables")}</Link></p>
      </section>

      <section className="card" id="inventario"><b>{t("4 · INVENTARIO", "4 · STOCK")}</b>
        {e.inventory.byState.length === 0 ? <p className="small muted">{t("No hay unidades en bodega.", "No units in the warehouse.")} <Link href="/operaciones/inventario">{t("Abrir Inventario", "Open Inventory")} →</Link></p> : <ul className="plain small">{e.inventory.byState.map((s) => <li key={s.state}>{lot(s.state)}: <span className="mono">{i.n(s.qty)}</span> {t("unidades", "units")}</li>)}</ul>}
        <p className="small">{t("Compras para inventario aprobadas", "Stock purchases approved")}: <span className="mono">{usd(e.inventory.approvedUsd)}</span></p>
        <p className="src">{t("SOLU cuenta unidades por estado; todavía no les asigna un valor en libros.", "SOLU counts units by state; it doesn't give them a book value yet.")} <Link href="/operaciones/inventario">{t("Inventario", "Stock")}</Link></p>
      </section>

      <section className="card" id="moneda"><b>{t("5 · MONEDA", "5 · CURRENCY")}</b>
        {e.fx.length === 0 ? <p className="small"><span className="sig ok">{t("Todo lo registrado está en USD", "Everything recorded is in USD")}</span></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Moneda", "Currency")}</th><th className="n">{t("En bancos", "In banks")}</th><th className="n">{t("Por pagar", "To pay")}</th><th className="n">{t("Obligaciones al año", "Obligations per year")}</th></tr></thead>
            <tbody>{e.fx.map((x) => <tr key={x.currency}><td><b>{x.currency}</b></td><td className="n mono">{i.n2(x.bank)}</td><td className="n mono">{i.n2(x.toPay)}</td><td className="n mono">{i.n2(x.obligations)}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="src">{t("Cada moneda en su propia cifra, sin convertir: SOLU no supone una tasa futura.", "Each currency in its own figure, not converted: SOLU assumes no future rate.")}</p>
      </section>

      <section className="card" id="activos"><b>{t("6 · ACTIVOS", "6 · ASSETS")}</b>
        <dl className="qv-dl">
          <dt>{t("Activos", "Assets")}</dt><dd className="mono">{e.asset.n} · {usd(e.asset.valueUsd)}{e.asset.noValue ? <span className="muted"> · {t(`${e.asset.noValue} sin valor registrado`, `${e.asset.noValue} with no value recorded`)}</span> : null}</dd>
          <dt>{t("Sin seguro vigente", "Without insurance in force")}</dt><dd className={`mono ${e.asset.uninsuredN ? "risk-t" : ""}`}>{e.asset.uninsuredN} · {usd(e.asset.uninsuredUsd)}</dd>
          <dt>{t("Sin nadie a cargo", "With nobody responsible")}</dt><dd className="mono">{e.asset.unassigned}</dd>
        </dl>
        <p className="src">{t("No todo activo necesita seguro: la cifra muestra lo que hoy no lo tiene.", "Not every asset needs insurance: the figure shows what has none today.")} <Link href="/administracion/activos">{t("Activos", "Assets")}</Link></p>
      </section>

      <section className="card" id="contratos"><b>{t("7 · CONTRATOS", "7 · CONTRACTS")}</b>
        <dl className="qv-dl">
          <dt>{t("Obligaciones vigentes", "Obligations in force")}</dt><dd className="mono">{e.contractual.n}</dd>
          <dt>{t("Comprometido a pagar al año", "Committed to pay per year")}</dt><dd className="mono">{usd(e.contractual.payYear)}</dd>
          <dt>{t("Por cobrar al año", "To collect per year")}</dt><dd className="mono">{usd(e.contractual.collectYear)}</dd>
          <dt>{t("Esperan una decisión", "Awaiting a decision")}</dt><dd className={`mono ${e.contractual.decide ? "risk-t" : ""}`}>{e.contractual.decide}</dd>
          <dt>{t("Seguros y garantías", "Insurance and guarantees")}</dt><dd className="mono">{e.contractual.guarantees}</dd>
        </dl>
        <p className="src"><Link href="/administracion/obligaciones">{t("Contratos y obligaciones", "Contracts and obligations")}</Link></p>
      </section>
    </>
  );
}
