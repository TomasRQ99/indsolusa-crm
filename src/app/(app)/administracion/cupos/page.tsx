import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { loadCredit } from "@/lib/queries";
import { grantCreditException, savePayRules, setCreditLimit } from "../actions";
import { paymentBehaviors } from "@/lib/pay-behavior";
import { DEFAULT_PAY_RULES } from "@/lib/pay-rules";

export default async function CreditLimitsPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const manager = canManageAll(user);
  const sp = await searchParams;
  const [rows, others] = await Promise.all([
    loadCredit(),
    db.account.findMany({ where: { creditLimit: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const pb = await paymentBehaviors(rows.map((r) => r.id));
  const over = rows.filter((r) => r.limit != null && r.used > r.limit);
  const near = rows.filter((r) => r.limit != null && r.used <= r.limit && r.used > r.limit * 0.8);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Administración", "Administration")}</div>
          <h1>{t("Cupos de crédito", "Credit limits")}</h1>
          <p>{t("Usado = facturas sin conciliar + OC aceptadas sin facturar. Se calcula solo; el cupo lo fija Gerencia.", "Used = unreconciled invoices + accepted POs not yet invoiced. Calculated automatically; management sets the limit.")}</p>
        </div>
      </div>
      <section className="sum">
        <div><span className="k">{t("Clientes con cupo", "Customers with a limit")}</span><span className="v">{rows.filter((r) => r.limit != null).length}</span></div>
        <div><span className="k">{t("Por encima del cupo", "Over the limit")}</span><span className="v">{over.length}</span><span className="s">{t("necesitan decisión", "need a decision")}</span></div>
        <div><span className="k">{t("Cerca del cupo (>80 %)", "Near the limit (>80 %)")}</span><span className="v">{near.length}</span></div>
        <div><span className="k">{t("Usado total", "Total used")}</span><span className="v">{i.n(rows.reduce((s, r) => s + r.used, 0))}</span><span className="s">USD</span></div>
      </section>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Cliente", "Customer")}</th><th className="n">{t("Cupo", "Limit")}</th><th className="n">{t("Usado", "Used")}</th><th style={{ width: 180 }} /><th className="n">{t("Disponible", "Available")}</th><th>{t("Señal", "Signal")}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.limit ? Math.min(100, (r.used / r.limit) * 100) : 0;
              const isOver = r.limit != null && r.used > r.limit;
              return [
                <tr key={r.id} id={r.id} className={isOver ? "sel" : undefined}>
                  <td><Link href={`/accounts/${r.id}`}><b>{r.name}</b></Link><span className="src">{r.owner.name}{r.overdueCount ? ` · ${r.overdueCount} ${t("facturas vencidas", "overdue invoices")}` : ""}</span>{(() => {
                    const b = pb.byId.get(r.id);
                    const e = b?.expected;
                    if (!b || !e || e.expectedDays == null) return null;
                    const ot = b.windows[3].onTimePct;
                    return <span className="src">{t(`paga en ~${e.expectedDays} d (plazo ${e.contractualDays})`, `pays in ~${e.expectedDays} d (${e.contractualDays}-day terms)`)}{ot != null ? t(` · a tiempo ${i.n(ot)} %`, ` · on time ${i.n(ot)} %`) : ""}{b.trend.trend === "WORSE" && <b className="attn-t">{t(" · paga más lento: conviene revisar", " · paying more slowly: worth a review")}</b>} · <Link href={`/mercado/empresas/${r.id}#pagos`}>{t("cómo paga", "how they pay")}</Link></span>;
                  })()}</td>
                  <td className="n val">{r.limit == null ? "—" : i.n(r.limit)}</td>
                  <td className="n val">{i.n(r.used)}<span className="src">{t("fact.", "inv.")} {i.n(r.openInvoices)} · {t("OC", "PO")} {i.n(r.uninvoiced)}</span></td>
                  <td style={{ verticalAlign: "middle" }}>{r.limit != null && <div className="bar"><i className={isOver ? "risk" : pct > 80 ? "attn" : ""} style={{ width: `${pct}%` }} /></div>}</td>
                  <td className={`n val ${r.available != null && r.available < 0 ? "risk-t" : ""}`}>{r.available == null ? "—" : i.n(r.available)}</td>
                  <td>{r.limit == null ? <span className="sig wait">{t("Sin cupo definido", "No limit set")}</span> : isOver ? <span className="sig risk">{t("Excede el cupo", "Over limit")}</span> : pct > 80 ? <span className="sig attn">{t("Cerca del cupo", "Near limit")}</span> : <span className="sig ok">{t("Dentro del cupo", "Within limit")}</span>}</td>
                  <td>
                    {manager && (
                      <details>
                        <summary className="small">{t("Cambiar cupo", "Change limit")}</summary>
                        <form action={setCreditLimit.bind(null, r.id)} className="inline">
                          <input name="creditLimit" type="number" min="0" step="500" defaultValue={r.limit ?? ""} style={{ width: 110 }} />
                          <button className="secondary sm" type="submit">{t("Guardar", "Save")}</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>,
                isOver && (
                  <tr key={`${r.id}-opts`}>
                    <td colSpan={7} style={{ background: "var(--surface-sunken)" }}>
                      <b>{t(`Opciones para ${r.name}`, `Options for ${r.name}`)}</b>
                      <div className="grid cols-3" style={{ marginTop: 8 }}>
                        <div className="card" style={{ margin: 0 }}>
                          <h3>{t("1 · Esperar el pago pendiente", "1 · Wait for the pending payment")}</h3>
                          <p className="small">{t(`Al conciliar sus facturas abiertas (${i.money(r.openInvoices)}) se libera el cupo.`, `Reconciling its open invoices (${i.money(r.openInvoices)}) frees the limit.`)}</p>
                          <Link className="small" href="/administracion/cobrar">{t("Ver cuentas por cobrar", "See receivables")}</Link>
                        </div>
                        <div className="card" style={{ margin: 0 }}>
                          <h3>{t("2 · Anticipo", "2 · Prepayment")}</h3>
                          <p className="small">{t(`Un anticipo de ${i.money(r.used - r.limit!)} deja la cuenta dentro del cupo.`, `A prepayment of ${i.money(r.used - r.limit!)} brings the account within the limit.`)}</p>
                        </div>
                        <div className="card" style={{ margin: 0 }}>
                          <h3>{t("3 · Excepción de Gerencia", "3 · Management exception")}</h3>
                          {r.blocking.length === 0 ? (
                            <p className="small">{t("Las órdenes ya tienen excepción aprobada.", "Orders already have an approved exception.")}</p>
                          ) : manager ? (
                            r.blocking.map((d) => (
                              <form key={d.id} action={grantCreditException.bind(null, d.id)} className="stack" style={{ marginTop: 6 }}>
                                <span className="small"><Link href={`/deals/${d.id}`}>{d.code}</Link> · {i.money(d.amount)}</span>
                                <input name="note" required placeholder={t("Por qué se aprueba", "Why it is approved")} />
                                <button type="submit" className="sm">{t("Aprobar excepción", "Approve exception")}</button>
                              </form>
                            ))
                          ) : (
                            <p className="small">{t("La decide Gerencia.", "Management decides.")}</p>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="empty"><b>{t("Aún no hay cupos definidos", "No credit limits yet")}</b></td></tr>}
          </tbody>
        </table>
      </div>
      {manager && others.length > 0 && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary>{t("Definir cupo a otro cliente", "Set a limit for another customer")}</summary>
          <div className="stack-lg" style={{ gap: 6 }}>
            {others.map((a) => (
              <form key={a.id} action={setCreditLimit.bind(null, a.id)} className="inline">
                <span style={{ width: 240 }}>{a.name}</span>
                <input name="creditLimit" type="number" min="0" step="500" required style={{ width: 120 }} />
                <button className="secondary sm" type="submit">{t("Guardar", "Save")}</button>
              </form>
            ))}
          </div>
        </details>
      )}
      {manager && (
        <details className="card" id="reglas-pago" style={{ marginTop: 16 }} open={sp.ok === "reglas"}>
          <summary><b>{t("Reglas del comportamiento de pago", "Payment behavior rules")}</b> <span className="src">{pb.rules.version ? t(`versión ${pb.rules.version} · ${pb.rules.by} · ${i.day(pb.rules.at!)}`, `version ${pb.rules.version} · ${pb.rules.by} · ${i.day(pb.rules.at!)}`) : t("valores propuestos, sin cambios todavía", "proposed values, not changed yet")}</span></summary>
          {sp.ok === "reglas" && <p className="small ok-t">{t("Reglas guardadas como una nueva versión.", "Rules saved as a new version.")}</p>}
          <p className="small">{t("Definen cómo SOLU resume la forma de pagar de cada cliente (Mercado, Comercial y esta página). Solo informan: nunca cambian un cupo ni un plazo.", "They define how SOLU summarizes how each customer pays (Market, Commercial and this page). Information only: they never change a limit or terms.")}</p>
          <form action={savePayRules} className="stack" style={{ gap: 8 }}>
            {([
              ["graceDays", t("Pagar hasta N días después del vencimiento cuenta como «a tiempo»", "Paying up to N days after due counts as “on time”"), t("días", "days")],
              ["expectedWindowMonths", t("Días esperados de pago: promedio de las facturas cobradas en los últimos", "Expected payment days: average of invoices collected in the last"), t("meses", "months")],
              ["minInvoices", t("Mínimo de facturas para que no sea solo orientativo", "Minimum invoices so it's not just indicative"), t("facturas", "invoices")],
              ["trendDays", t("Tendencia: el retraso promedio de los últimos 6 meses debe moverse al menos", "Trend: the average delay of the last 6 months must move at least"), t("días", "days")],
              ["bandSmallUsd", t("Factura «pequeña» por debajo de", "“Small” invoice below"), "USD"],
              ["bandLargeUsd", t("Factura «grande» desde", "“Large” invoice from"), "USD"],
            ] as const).map(([k, label, unit]) => (
              <label key={k} className="row small" style={{ gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>{label}</span>
                <input name={k} type="number" min="0" step="1" defaultValue={pb.rules.value[k]} style={{ width: 110 }} />
                <span className="muted" style={{ width: 60 }}>{unit}</span>
                {pb.rules.value[k] !== DEFAULT_PAY_RULES[k] && <span className="src">{t(`propuesto: ${DEFAULT_PAY_RULES[k]}`, `proposed: ${DEFAULT_PAY_RULES[k]}`)}</span>}
              </label>
            ))}
            <div><button type="submit">{t("Guardar como nueva versión", "Save as a new version")}</button></div>
          </form>
        </details>
      )}
    </>
  );
}