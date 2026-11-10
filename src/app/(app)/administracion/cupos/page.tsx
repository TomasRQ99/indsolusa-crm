import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canDecideCredit, canManageAll } from "@/lib/permissions";
import { decideCreditReview } from "../../comercial/dinero/actions";
import { ALT_LABEL, kindLabel } from "@/components/CashBags";
import { makeI18n } from "@/lib/i18n";
import { loadCredit } from "@/lib/queries";
import { grantCreditException, savePayRules, setCreditLimit } from "../actions";
import { paymentBehaviors } from "@/lib/pay-behavior";
import { DEFAULT_PAY_RULES } from "@/lib/pay-rules";

export default async function CreditLimitsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const manager = canManageAll(user);
  const decider = canDecideCredit(user);
  const sp = await searchParams;
  const [rows, others, reviews] = await Promise.all([
    loadCredit(),
    db.account.findMany({ where: { creditLimit: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.creditReviewRequest.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { account: { select: { id: true, name: true, creditLimit: true, paymentTermsDays: true } }, deal: { select: { id: true, code: true } }, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } } }),
  ]);
  const openReviews = reviews.filter((r) => r.status === "OPEN");
  const pb = await paymentBehaviors(rows.map((r) => r.id));
  const over = rows.filter((r) => r.limit != null && r.used > r.limit);
  const near = rows.filter((r) => r.limit != null && r.used <= r.limit && r.used > r.limit * 0.8);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Administración", "Administration")}</div>
          <h1>{t("Cupos de crédito", "Credit limits")}</h1>
          <p>{t("Usado = facturas sin conciliar + OC aceptadas sin facturar. Se calcula solo; el cupo lo fijan Finanzas o Gerencia.", "Used = unreconciled invoices + accepted POs not yet invoiced. Calculated automatically; Finance or Management set the limit.")}</p>
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
                    {decider && (
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
                          <h3>{t("3 · Excepción de Finanzas / Gerencia", "3 · Finance / Management exception")}</h3>
                          {r.blocking.length === 0 ? (
                            <p className="small">{t("Las órdenes ya tienen excepción aprobada.", "Orders already have an approved exception.")}</p>
                          ) : decider ? (
                            r.blocking.map((d) => (
                              <form key={d.id} action={grantCreditException.bind(null, d.id)} className="stack" style={{ marginTop: 6 }}>
                                <span className="small"><Link href={`/deals/${d.id}`}>{d.code}</Link> · {i.money(d.amount)}</span>
                                <input name="note" required placeholder={t("Por qué se aprueba", "Why it is approved")} />
                                <button type="submit" className="sm">{t("Aprobar excepción", "Approve exception")}</button>
                              </form>
                            ))
                          ) : (
                            <p className="small">{t("La deciden Finanzas o Gerencia. Puedes pedirla desde Comercial · Dinero por mover.", "Finance or Management decide. You can request it from Commercial · Money to move.")} <Link href="/comercial/dinero#credito">{t("Ir", "Go")}</Link></p>
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
      {decider && others.length > 0 && (
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
      <section className="mk-sec" id="solicitudes">
        <h2>{t("Solicitudes de revisión de cupo", "Credit review requests")} <span className="src">{t("las pide Comercial; deciden Finanzas o Gerencia, nunca quien pide", "Commercial asks; Finance or Management decide, never the requester")}</span></h2>
        {sp.err && <p className="small risk-t" role="alert">{({ autoridad: t("Solo Finanzas o Gerencia deciden.", "Only Finance or Management decide."), propia: t("No puedes decidir tu propia solicitud.", "You can't decide your own request."), nota: t("Escribe la razón de la decisión.", "Write the reason for the decision."), decidida: t("Esa solicitud ya fue decidida.", "That request was already decided."), valor: t("Revisa el valor.", "Check the value.") } as Record<string, string>)[sp.err] ?? t("No se pudo guardar.", "Could not save.")}</p>}
        {sp.ok?.startsWith("cupo-") && <p className="small ok-t" role="status">{t("Decisión guardada. Queda en el historial de cambios.", "Decision saved. It stays in the change history.")}</p>}
        {reviews.length === 0 ? <div className="card empty">{t("Aún no hay solicitudes.", "No requests yet.")}</div> : (
          <>
            {openReviews.map((r) => {
              const s = r.snapshot as { limit: number | null; used: number; openInvoices: number; committed: number; available: number | null; overdue: number; overdueCount: number; termsDays: number; expectedDays: number | null; payN: number; trend: string; promisesKept: number; promisesBroken: number };
              return (
                <article key={r.id} className="card md-item move">
                  <div className="md-top"><span><b>{kindLabel(i, r.kind)} · <Link href={`/accounts/${r.account.id}`}>{r.account.name}</Link></b>{r.deal && <> · <Link href={`/deals/${r.deal.id}`}>{r.deal.code}</Link></>}</span><span className="src">{r.requestedBy.name} · {i.day(r.createdAt)}</span></div>
                  <p className="small">{r.reason}{r.info ? <span className="src block">{r.info}</span> : null}</p>
                  <p className="small">{r.requestedLimit != null && <>{t("Cupo propuesto", "Proposed limit")}: <b>{i.money(r.requestedLimit)}</b> ({t("hoy", "today")} {s.limit == null ? "—" : i.money(s.limit)}) · </>}{r.requestedTerms != null && <>{t("Plazo propuesto", "Proposed terms")}: <b>{r.requestedTerms} {t("días", "days")}</b> ({t("hoy", "today")} {s.termsDays}) · </>}{r.until && <>{t("Hasta", "Until")} {i.day(r.until)} · </>}{r.alternatives.length ? <>{t("Alternativas", "Alternatives")}: {r.alternatives.map((a) => t(...(ALT_LABEL[a] ?? [a, a]))).join(", ")}</> : t("Sin alternativas registradas", "No alternatives recorded")}</p>
                  <dl className="md-truths">
                    <div><dt>{t("Usado al pedir", "Used when asked")}</dt><dd>{i.money(s.used)}<span className="src">{t("fact.", "inv.")} {i.money(s.openInvoices)} · {t("sin facturar", "uninvoiced")} {i.money(s.committed)}</span></dd></div>
                    <div><dt>{t("Vencido", "Overdue")}</dt><dd>{i.money(s.overdue)}<span className="src">{s.overdueCount} {t("facturas", "invoices")}</span></dd></div>
                    <div><dt>{t("Cómo paga", "How they pay")}</dt><dd>{s.expectedDays == null ? t("sin historial", "no history") : t(`~${s.expectedDays} días (plazo ${s.termsDays})`, `~${s.expectedDays} days (${s.termsDays}-day terms)`)}<span className="src">{t(`${s.payN} facturas · tendencia`, `${s.payN} invoices · trend`)} {s.trend}</span></dd></div>
                    <div><dt>{t("Promesas", "Promises")}</dt><dd>{t(`${s.promisesKept} cumplidas · ${s.promisesBroken} incumplidas`, `${s.promisesKept} kept · ${s.promisesBroken} broken`)}</dd></div>
                  </dl>
                  {decider && r.requestedById !== user.id ? (
                    <form action={decideCreditReview.bind(null, r.id)} className="grid cols-3">
                      <input type="hidden" name="back" value="/administracion/cupos#solicitudes" />
                      {(r.kind === "INCREASE" || r.kind === "DECREASE") && <label className="small">{t("Cupo aprobado (USD)", "Approved limit (USD)")}<input name="approvedLimit" inputMode="decimal" defaultValue={r.requestedLimit == null ? "" : Number(r.requestedLimit)} /></label>}
                      {r.kind === "TERMS_REVIEW" && <label className="small">{t("Plazo aprobado (días)", "Approved terms (days)")}<input name="approvedTerms" inputMode="numeric" defaultValue={r.requestedTerms ?? ""} /></label>}
                      <label className="small" style={{ gridColumn: "1 / -1" }}>{t("Razón de la decisión", "Reason for the decision")}<input name="decisionNote" required /></label>
                      <div className="row" style={{ gap: 8 }}><button type="submit" name="decision" value="APPROVE" className="sm">{t("Aprobar", "Approve")}</button><button type="submit" name="decision" value="REJECT" className="secondary sm">{t("Rechazar", "Reject")}</button></div>
                      {r.kind === "TEMPORARY_EXCEPTION" && !r.deal && <span className="src" style={{ gridColumn: "1 / -1" }}>{t("Sin Journey asociado: aprobarla queda registrado, pero no marca ninguna orden.", "No Journey attached: approving is recorded but marks no order.")}</span>}
                    </form>
                  ) : <p className="src">{r.requestedById === user.id ? t("Es tu solicitud: la decide otra persona.", "It is your request: someone else decides.") : t("La deciden Finanzas o Gerencia.", "Finance or Management decide.")}</p>}
                </article>
              );
            })}
            {reviews.some((r) => r.status !== "OPEN") && (
              <details className="card"><summary className="small">{t("Decididas y retiradas", "Decided and withdrawn")}</summary>
                <ul className="mk-ul">{reviews.filter((r) => r.status !== "OPEN").map((r) => <li key={r.id} className="small">{i.day(r.createdAt)} · {kindLabel(i, r.kind)} · {r.account.name} · {r.requestedBy.name} → <span className={`sig ${r.status === "APPROVED" ? "ok" : r.status === "REJECTED" ? "risk" : "dash"}`}>{({ APPROVED: t("Aprobada", "Approved"), REJECTED: t("Rechazada", "Rejected"), WITHDRAWN: t("Retirada", "Withdrawn") } as Record<string, string>)[r.status] ?? r.status}</span>{r.decidedBy ? ` · ${r.decidedBy.name}` : ""}{r.decidedAt ? ` · ${i.day(r.decidedAt)}` : ""}{r.approvedLimit != null ? ` · ${i.money(r.approvedLimit)}` : ""}{r.approvedTerms != null ? ` · ${r.approvedTerms} ${t("días", "days")}` : ""}{r.decisionNote ? <span className="src"> · {r.decisionNote}</span> : null}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </section>
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