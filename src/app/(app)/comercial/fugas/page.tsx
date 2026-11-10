import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canDecideCredit, canFinance, canManageAll } from "@/lib/permissions";
import { loadCashJourney, LEAK_STAGES } from "@/lib/cash-journey";
import { CLASS_LABEL, DEFAULT_CASH_POLICY, ROOT_CAUSE_LABEL, type RootCause } from "@/lib/cash-rules";
import { causeText, INTERVAL_LABEL, LEAK_LABEL } from "@/components/CashBags";
import { saveCashPolicy } from "../dinero/actions";

// Comercial C3 · Revenue leakage (§64), cash conversion delay (§65) and cash-journey indicators (§68).
// It answers how much money is trapped, where and why — to find system bottlenecks, never to rank people.

type SP = { scope?: string; ok?: string; err?: string };
const CLASSES = ["COMPANY", "CUSTOMER", "EXTERNAL", "UNSET"] as const;

export default async function Leakage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const wide = canManageAll(user) || canFinance(user);
  const team = sp.scope === "team" || (sp.scope !== "mine" && wide);
  const j = await loadCashJourney(i, team ? {} : { ownerId: user.id });
  const P = j.policy.value;
  const classTxt = (k: (typeof CLASSES)[number]) => (k === "UNSET" ? t("Sin causa registrada", "No cause recorded") : t(...CLASS_LABEL[k]));
  const byClass = Object.fromEntries(CLASSES.map((k) => [k, j.leak.reduce((s, r) => s + r.byClass[k], 0)])) as Record<(typeof CLASSES)[number], number>;
  const Bar = ({ parts, total }: { parts: Record<string, number>; total: number }) => (
    <span className="lk-bar" role="img" aria-label={CLASSES.filter((k) => parts[k] > 0).map((k) => `${classTxt(k)} ${Math.round((parts[k] / total) * 100)} %`).join(", ")}>
      {total > 0 && CLASSES.filter((k) => parts[k] > 0).map((k) => <i key={k} className={`c-${k}`} style={{ width: `${(parts[k] / total) * 100}%` }} title={`${classTxt(k)} · ${Math.round((parts[k] / total) * 100)} %`} />)}
    </span>
  );
  const Legend = () => <p className="src">{CLASSES.map((k) => <span key={k} style={{ marginRight: 12 }}><i className={`lk-key c-${k}`} />{classTxt(k)}</span>)}</p>;
  const ind = j.indicators;
  const d = (v: number | null) => (v == null ? "—" : v === 1 ? t("1 día", "1 day") : t(`${i.n(v)} días`, `${i.n(v)} days`));

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/comercial/dinero">{t("Comercial · Dinero por mover", "Commercial · Money to move")}</Link></div>
          <h1>{t("Fugas de caja", "Cash leakage")}</h1>
          <p>{t("Cuánto dinero está atrapado antes de convertirse en caja, dónde y por qué. Sirve para encontrar cuellos de botella del sistema; no para castigar a nadie por lo que no controla.", "How much money is trapped before becoming cash, where and why. It is for finding system bottlenecks; never for blaming anyone for what they don't control.")}</p>
        </div>
        <div className="seg">
          <Link href="/comercial/fugas?scope=mine" className={!team ? "on" : ""}>{t("Lo mío", "Mine")}</Link>
          <Link href="/comercial/fugas?scope=team" className={team ? "on" : ""}>{t("Todo el equipo", "Whole team")}</Link>
        </div>
      </div>
      {sp.ok === "politica" && <p className="card small ok-t" role="status">{t("Política guardada como una nueva versión.", "Policy saved as a new version.")}</p>}
      {sp.err === "autoridad" && <p className="card small risk-t" role="alert">{t("Solo Finanzas o Gerencia cambian esta política.", "Only Finance or Management change this policy.")}</p>}

      <section className="sum">
        <div><span className="k">{t("Dinero atrapado", "Money trapped")}</span><span className="v">{i.money(j.leakTotal)}</span><span className="s">{t(`${j.leak.reduce((s, r) => s + r.n, 0)} casos`, `${j.leak.reduce((s, r) => s + r.n, 0)} cases`)}</span></div>
        {CLASSES.map((k) => <div key={k}><span className="k"><i className={`lk-key c-${k}`} />{classTxt(k)}</span><span className="v">{i.money(byClass[k])}</span></div>)}
      </section>

      <section className="mk-sec">
        <h2>{t("Dónde está detenido", "Where it is stopped")}</h2>
        <div className="card flush mk-scroll">
          <table>
            <thead><tr><th>{t("Etapa", "Stage")}</th><th className="n">{t("Valor", "Value")}</th><th className="n">{t("Casos", "Cases")}</th><th className="n">{t("Más antiguo", "Oldest")}</th><th style={{ width: 160 }}>{t("Quién controla el tiempo", "Who controls the time")}</th><th>{t("Causas (registradas o por evidencia que falta)", "Causes (recorded or from missing evidence)")}</th></tr></thead>
            <tbody>
              {LEAK_STAGES.map((st) => {
                const r = j.leak.find((x) => x.stage === st)!;
                return [
                  <tr key={st}>
                    <td><b>{t(...LEAK_LABEL[st])}</b></td>
                    <td className="n val">{r.n ? i.money(r.value) : "—"}</td>
                    <td className="n">{r.n || "—"}</td>
                    <td className="n">{r.n ? d(r.oldest) : "—"}</td>
                    <td style={{ verticalAlign: "middle" }}>{r.n > 0 && <Bar parts={r.byClass} total={r.value} />}</td>
                    <td className="small">{Object.entries(r.byCause).map(([c, v]) => `${t(...ROOT_CAUSE_LABEL[c as RootCause])} ${i.money(v)}`).join(" · ") || (r.n ? <span className="muted">{t("ninguna registrada", "none recorded")}</span> : "")}</td>
                  </tr>,
                  r.n > 0 && (
                    <tr key={`${st}-x`}><td colSpan={6} style={{ paddingTop: 0 }}>
                      <details><summary className="small">{t(`Ver los ${r.n}`, `See the ${r.n}`)}</summary>
                        <ul className="mk-ul">{r.items.map((x, k) => <li key={k} className="small">{x.dealId ? <Link href={`/deals/${x.dealId}`}>{x.label}</Link> : x.label} · <span className="val">{i.money(x.value)}</span> · {d(x.days)} · {causeText(i, x.cause)}{x.next ? ` · ${t("próximo", "next")}: ${x.next}` : ""}</li>)}</ul>
                      </details>
                    </td></tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
        <Legend />
        <p className="src">{t(
          `Reglas: listo sin entregar más de ${P.readyAlertDays} días calendario; entregado sin facturar más de ${P.deliveredAlertWorkingDays} días hábiles; factura emitida sin radicación registrada más de ${P.deliveredAlertWorkingDays} días hábiles; radicada sin aceptar más de ${P.acceptAlertWorkingDays} días hábiles; vencida sin dinero en el banco ni promesa vigente. Cada factura cuenta en una sola etapa. Sin causa registrada no se le asigna a nadie.`,
          `Rules: ready not delivered over ${P.readyAlertDays} calendar days; delivered not invoiced over ${P.deliveredAlertWorkingDays} working days; invoice issued with no submission recorded over ${P.deliveredAlertWorkingDays} working days; submitted not accepted over ${P.acceptAlertWorkingDays} working days; past due with no cash in the bank and no open promise. Each invoice counts in one stage only. Without a recorded cause it is assigned to no one.`)}</p>
      </section>

      <section className="mk-sec">
        <h2>{t("Cuánto tarda cada paso", "How long each step takes")} <span className="src">{t("últimos 180 días · días calendario", "last 180 days · calendar days")}</span></h2>
        <div className="card flush mk-scroll">
          <table>
            <thead><tr><th>{t("Intervalo", "Interval")}</th><th className="n">{t("Casos", "Cases")}</th><th className="n">{t("Mediana", "Median")}</th><th className="n">{t("Promedio", "Average")}</th><th style={{ width: 160 }}>{t("Días por causa", "Days by cause")}</th><th className="small">{t("Detalle", "Detail")}</th></tr></thead>
            <tbody>{j.intervals.map((x) => (
              <tr key={x.key}>
                <td><b>{t(...INTERVAL_LABEL[x.key])}</b></td>
                <td className="n">{x.n || "—"}</td>
                <td className="n">{d(x.median)}</td>
                <td className="n">{x.avg == null ? "—" : i.n2(x.avg)}</td>
                <td style={{ verticalAlign: "middle" }}>{x.split.total > 0 && <Bar parts={{ COMPANY: x.split.COMPANY, CUSTOMER: x.split.CUSTOMER, EXTERNAL: x.split.EXTERNAL, UNSET: x.split.UNEXPLAINED }} total={x.split.total} />}</td>
                <td className="small">{x.split.total > 0 ? CLASSES.map((k) => [k, k === "UNSET" ? x.split.UNEXPLAINED : x.split[k]] as const).filter(([, v]) => v > 0).map(([k, v]) => `${classTxt(k)} ${v}`).join(" · ") : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="src">{t("Vencimiento → dinero puede ser negativo (pagó antes). Los días se atribuyen solo con bloqueos registrados con su causa; el resto queda «sin causa registrada».", "Due → cash can be negative (paid early). Days are attributed only through blockers recorded with their cause; the rest stays “no cause recorded”.")}</p>
      </section>

      <section className="mk-sec">
        <h2>{t("Indicadores del camino al dinero", "Cash journey indicators")} <span className="src">{t("valores en dinero y reglas declaradas; no se cuentan llamadas", "money values and declared rules; calls are never counted")}</span></h2>
        <div className="ind-grid">
          <div className="card"><span className="small">{t("Efectividad de recaudo", "Collection effectiveness")}</span><span className="v">{i.pct(ind.collectionEffectiveness.value)}</span><span className="src">{t(`Conciliado ${i.money(ind.collectionEffectiveness.got)} de ${i.money(ind.collectionEffectiveness.due)} que vencieron en los últimos 90 días (${ind.collectionEffectiveness.n} facturas).`, `Reconciled ${i.money(ind.collectionEffectiveness.got)} of ${i.money(ind.collectionEffectiveness.due)} that fell due in the last 90 days (${ind.collectionEffectiveness.n} invoices).`)}</span></div>
          <div className="card"><span className="small">{t("Facturas confirmadas", "Invoices confirmed")}</span><span className="v">{i.pct(ind.confirmationRate.value)}</span><span className="src">{t(`${ind.confirmationRate.confirmed} de ${ind.confirmationRate.n} emitidas en 90 días tienen aceptación o aprobación para pago registrada.`, `${ind.confirmationRate.confirmed} of ${ind.confirmationRate.n} issued in 90 days have acceptance or payment approval recorded.`)}</span></div>
          <div className="card"><span className="small">{t("Entregado → facturado", "Delivered → invoiced")}</span><span className="v">{d(ind.deliveredToInvoiced.value)}</span><span className="src">{t(`Mediana de ${ind.deliveredToInvoiced.n} facturas en 180 días.`, `Median of ${ind.deliveredToInvoiced.n} invoices in 180 days.`)}</span></div>
          <div className="card"><span className="small">{t("Mercancía lista esperando", "Ready goods waiting")}</span><span className="v">{d(ind.readyAging.value)}</span><span className="src">{ind.readyAging.n ? t(`Mediana de ${ind.readyAging.n} hoy; la más antigua lleva ${ind.readyAging.oldest} días.`, `Median of ${ind.readyAging.n} today; the oldest has waited ${ind.readyAging.oldest} days.`) : t("Nada listo esperando hoy.", "Nothing ready waiting today.")}</span></div>
          <div className="card"><span className="small">{t("Promesas cumplidas", "Promises kept")}</span><span className="v">{i.pct(ind.promiseKept.value)}</span><span className="src">{t(`${ind.promiseKept.kept} de ${ind.promiseKept.n} promesas con fecha en 180 días (solo dinero conciliado; las reemplazadas a tiempo no cuentan).`, `${ind.promiseKept.kept} of ${ind.promiseKept.n} promises due in 180 days (reconciled cash only; promises replaced in time don't count).`)}</span></div>
          <div className="card"><span className="small">{t("Decisión de cupo", "Credit decision time")}</span><span className="v">{d(ind.creditResolution.value)}</span><span className="src">{t(`Mediana de ${ind.creditResolution.n} solicitudes decididas en 180 días.`, `Median of ${ind.creditResolution.n} requests decided in 180 days.`)}</span></div>
          <div className="card"><span className="small">{t("Entrega → dinero conciliado", "Delivery → reconciled cash")}</span><span className="v">{d(ind.cashConversion.value)}</span><span className="src">{t(`Mediana de ${ind.cashConversion.n} facturas cobradas en 180 días.`, `Median of ${ind.cashConversion.n} invoices collected in 180 days.`)}</span></div>
          <div className="card"><span className="small">{t("Dinero atrapado", "Money trapped")}</span><span className="v">{i.money(ind.leakage.value)}</span><span className="src">{t("Suma de la tabla de arriba.", "Sum of the table above.")}</span></div>
        </div>
      </section>

      <details className="card" id="politica" style={{ marginTop: 16 }} open={sp.ok === "politica"}>
        <summary><b>{t("Política de alertas de caja", "Cash alert policy")}</b> <span className="src">{j.policy.version ? t(`versión ${j.policy.version} · ${j.policy.by} · ${i.day(j.policy.at!)}`, `version ${j.policy.version} · ${j.policy.by} · ${i.day(j.policy.at!)}`) : t("valores acordados el 10-nov-2026, sin cambios todavía", "values agreed on Nov 10, 2026, not changed yet")}</span></summary>
        {canDecideCredit(user) ? (
          <form action={saveCashPolicy} className="stack" style={{ gap: 8, marginTop: 8 }}>
            {([
              ["readyAlertDays", t("Listo sin entregar: alerta después de", "Ready not delivered: alert after"), t("días calendario", "calendar days")],
              ["deliveredAlertWorkingDays", t("Entregado sin facturar (y factura sin radicar): alerta después de", "Delivered not invoiced (and invoice not submitted): alert after"), t("días hábiles", "working days")],
              ["acceptAlertWorkingDays", t("Radicada sin aceptar: alerta después de", "Submitted not accepted: alert after"), t("días hábiles", "working days")],
            ] as const).map(([k, label, unit]) => (
              <label key={k} className="row small" style={{ gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>{label}</span>
                <input name={k} type="number" min="0" max="60" step="1" defaultValue={P[k]} style={{ width: 90 }} />
                <span className="muted" style={{ width: 110 }}>{unit}</span>
                {P[k] !== DEFAULT_CASH_POLICY[k] && <span className="src">{t(`acordado: ${DEFAULT_CASH_POLICY[k]}`, `agreed: ${DEFAULT_CASH_POLICY[k]}`)}</span>}
              </label>
            ))}
            <label className="row small" style={{ gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1 }}>{t("Rangos de cartera vencida (límites en días, separados por coma)", "Overdue aging buckets (edges in days, comma separated)")}</span>
              <input name="aging" defaultValue={P.aging.join(", ")} style={{ width: 140 }} />
            </label>
            <span className="src">{t("Días hábiles = lunes a viernes; los festivos no se descuentan todavía.", "Working days = Monday to Friday; holidays are not deducted yet.")}</span>
            <div><button type="submit">{t("Guardar como nueva versión", "Save as a new version")}</button></div>
          </form>
        ) : <p className="small">{t(`Listo sin entregar > ${P.readyAlertDays} días · entregado sin facturar > ${P.deliveredAlertWorkingDays} días hábiles · radicada sin aceptar > ${P.acceptAlertWorkingDays} días hábiles · cartera: ${P.aging.join(" / ")} días. La cambian Finanzas o Gerencia.`, `Ready not delivered > ${P.readyAlertDays} days · delivered not invoiced > ${P.deliveredAlertWorkingDays} working days · submitted not accepted > ${P.acceptAlertWorkingDays} working days · aging: ${P.aging.join(" / ")} days. Finance or Management change it.`)}</p>}
      </details>
    </>
  );
}
