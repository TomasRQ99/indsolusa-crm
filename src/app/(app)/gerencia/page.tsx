import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { addDays, invoiceBlockers, today } from "@/lib/domain";
import { loadCredit, loadReceivables, loadSupplierPayments } from "@/lib/queries";

function monthStart(d: Date, offset = 0) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

export default async function ReportingPage() {
  const user = await requireRole("ADMIN", "MANAGER");
  const i = makeI18n(user.lang);
  const { t } = i;
  const now = today();
  const m0 = monthStart(now);
  const m1 = monthStart(now, -1);
  const q0 = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));

  const [deals, invoices, receivables, payments, credit, cashIn, undelivered, users] = await Promise.all([
    db.deal.findMany({ include: { invoices: { select: { amount: true } }, owner: { select: { id: true, name: true } } } }),
    db.invoice.findMany({ where: { issuedAt: { gte: m1 } }, include: { delivery: { select: { deliveredAt: true } } } }),
    loadReceivables(),
    loadSupplierPayments({ executedAt: null }),
    loadCredit(),
    db.customerPayment.findMany({ where: { receivedAt: { gte: addDays(now, -30) } }, select: { amount: true, reconciledAt: true } }),
    db.delivery.findMany({ where: { invoice: null }, include: { lines: { include: { dealItem: { select: { unitPrice: true } } } }, deal: { include: { account: true } } } }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);

  // ---- What is achieved ----
  const thisMonth = invoices.filter((x) => x.issuedAt >= m0);
  const lastMonth = invoices.filter((x) => x.issuedAt < m0);
  const egPct = (list: typeof invoices) => {
    const a = list.reduce((s, x) => s + Number(x.amount), 0);
    return a > 0 ? (list.reduce((s, x) => s + Number(x.esagraAtIssue), 0) / a) * 100 : null;
  };
  const delivered = deals.filter((d) => d.stage === "WON" && d.invoices.length > 0);
  const results = deals.filter((d) => d.resultAchievedAt && d.resultAchievedAt >= q0).length;
  const wonQ = deals.filter((d) => d.poAcceptedAt && d.poAcceptedAt >= q0);
  const lags = thisMonth.concat(lastMonth).filter((x) => x.delivery).map((x) => (x.issuedAt.getTime() - x.delivery!.deliveredAt.getTime()) / 864e5);

  // ---- What's coming (never summed across certainty levels) ----
  const committed = deals.filter((d) => d.stage === "WON").reduce((s, d) => s + Math.max(0, Number(d.amount) - d.invoices.reduce((x, v) => x + Number(v.amount), 0)), 0);
  const expected = deals.filter((d) => d.stage === "NEGOTIATION" || d.stage === "PROPOSAL").reduce((s, d) => s + Number(d.amount), 0);
  const possible = deals.filter((d) => d.stage === "LEAD" || d.stage === "QUALIFIED").reduce((s, d) => s + Number(d.amount), 0);
  const in14 = addDays(now, 14);
  const cashExpected = receivables.filter((r) => { const e = r.promise && r.promise.promisedFor >= now ? r.promise.promisedFor : r.dueAt; return e >= now && e <= in14; }).reduce((s, r) => s + r.cash.balance, 0);
  const received30 = cashIn.reduce((s, p) => s + Number(p.amount), 0);
  const reconciled30 = cashIn.filter((p) => p.reconciledAt).reduce((s, p) => s + Number(p.amount), 0);
  const undeliveredValue = undelivered.reduce((s, d) => s + d.lines.reduce((x, l) => x + l.qty * Number(l.dealItem.unitPrice), 0), 0);
  const readyValue = undelivered.filter((d) => invoiceBlockers(d, d.deal, d.deal.account).length === 0).reduce((s, d) => s + d.lines.reduce((x, l) => x + l.qty * Number(l.dealItem.unitPrice), 0), 0);

  // ---- Needs management ----
  const decisions: { key: string; title: string; detail: string; href: string; cta: string }[] = [];
  for (const a of credit) for (const d of a.blocking) decisions.push({ key: `c${d.id}`, title: t(`Decidir el cupo de ${a.name}`, `Decide ${a.name}'s credit limit`), detail: t(`${d.code} supera el cupo por ${i.money(a.used - (a.limit ?? 0))}`, `${d.code} exceeds the limit by ${i.money(a.used - (a.limit ?? 0))}`), href: `/administracion/cupos#${a.id}`, cta: t("Ver opciones", "See options") });
  for (const p of payments.filter((x) => x.state === "APPROVE" && x.requestedById !== user.id && x.verifiedById !== user.id)) decisions.push({ key: `p${p.id}`, title: t(`Aprobar pago a ${p.supplierPo.supplier.name}`, `Approve payment to ${p.supplierPo.supplier.name}`), detail: `${p.currency} ${i.n2(p.amount)} · ${p.reason}`, href: `/administracion/pagos-proveedores/${p.id}`, cta: t("Revisar", "Review") });
  const broken = receivables.filter((r) => r.state === "BROKEN");
  if (broken.length) decisions.push({ key: "broken", title: t(`${broken.length} compromisos de pago incumplidos`, `${broken.length} payment commitments missed`), detail: i.money(broken.reduce((s, r) => s + r.cash.balance, 0)), href: "/administracion/cobrar", cta: t("Ver", "View") });

  // ---- Where to help each person (leaders only; no activity metrics) ----
  const people = users.map((u) => {
    const mine = deals.filter((d) => d.owner.id === u.id);
    const active = mine.filter((d) => d.stage !== "LOST" && !d.resultAchievedAt);
    return {
      u,
      active: active.length,
      noMove: active.filter((d) => !d.nextMove && !d.waitingFor && d.stage !== "WON").length,
      results: mine.filter((d) => d.resultAchievedAt && d.resultAchievedAt >= q0).length,
      broken: broken.filter((r) => r.deal.ownerId === u.id).length,
      pipeline: active.filter((d) => d.stage !== "WON").reduce((s, d) => s + Number(d.amount), 0),
    };
  }).filter((p) => p.active || p.results);

  const pctThis = egPct(thisMonth);
  const pctLast = egPct(lastMonth);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Gerencia", "Management")}</div>
          <h1>Reporting</h1>
          <p>{t("Qué está pasando, qué viene y dónde la intervención de gerencia cambia el resultado.", "What's happening, what's coming and where management's intervention changes the outcome.")}</p>
        </div>
      </div>

      <section className="sum">
        <div><span className="k">{t("¿Qué está pasando?", "What's happening?")}</span><span className="v">{i.money(thisMonth.reduce((s, x) => s + Number(x.amount), 0))}</span><span className="s">{t("facturado este mes", "invoiced this month")} · {t("esagra", "esagra")} {i.pct(pctThis)}</span></div>
        <div><span className="k">{t("¿Qué viene? · 14 días", "What's coming? · 14 days")}</span><span className="v">{i.money(cashExpected)}</span><span className="s">{t("cobro esperado (promesas y vencimientos)", "expected cash (promises and due dates)")}</span></div>
        <div><span className="k">{t("¿Necesitas intervenir?", "Do you need to step in?")}</span><span className="v">{decisions.length}</span><span className="s">{t("decisiones de gerencia", "management decisions")}</span></div>
      </section>

      <div className="card">
        <div className="bhead"><h2>{t("Necesita a gerencia", "Needs management")}</h2></div>
        {decisions.length === 0 ? <p className="empty small"><b>{t("Nada espera una decisión tuya", "Nothing awaits your decision")}</b></p> : (
          <div className="items">
            {decisions.map((d) => (
              <div className="item" key={d.key}><div className="t">{d.title}</div><div className="a"><Link className="btn secondary sm" href={d.href}>{d.cta}</Link></div><div className="d">{d.detail}</div></div>
            ))}
          </div>
        )}
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>{t("Lo que se logra", "What's achieved")}</h2>
          <dl className="facts">
            <dt>{t("Resultados logrados", "Results achieved")}</dt><dd><b>{results}</b> {t("este trimestre", "this quarter")} · {delivered.length} {t("Journeys con entrega", "Journeys delivered")}</dd>
            <dt>{t("OC aceptadas", "POs accepted")}</dt><dd><b>{wonQ.length}</b> · {i.money(wonQ.reduce((s, d) => s + Number(d.amount), 0))} {t("este trimestre", "this quarter")}</dd>
            <dt title={t("Esagra = utilidad sobre la venta", "Esagra = profit on the sale")}>{t("Esagra facturada", "Invoiced esagra")}</dt><dd><b>{i.pct(pctThis)}</b> {t("este mes", "this month")} · {i.pct(pctLast)} {t("el anterior", "last month")}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>{t("Lo que viene", "What's coming")}</h2>
          <dl className="facts">
            <dt>{t("Comprometido", "Committed")}</dt><dd><b>{i.money(committed)}</b> <span className="src" style={{ display: "inline" }}>{t("OC aceptadas sin facturar", "accepted POs not invoiced")}</span></dd>
            <dt>{t("Esperado", "Expected")}</dt><dd><b>{i.money(expected)}</b> <span className="src" style={{ display: "inline" }}>{t("cotizado y en negociación", "quoted and negotiating")}</span></dd>
            <dt>{t("Posible", "Possible")}</dt><dd><b>{i.money(possible)}</b> <span className="src" style={{ display: "inline" }}>{t("necesidades sin cotizar", "needs not yet quoted")}</span></dd>
            <dt>{t("Caja · 30 días", "Cash · 30 days")}</dt><dd>{t("recibido", "received")} <b>{i.money(received30)}</b> · {t("conciliado", "reconciled")} <b>{i.money(reconciled30)}</b></dd>
            <dt>{t("Entregado sin facturar", "Delivered, not invoiced")}</dt><dd><b>{i.money(undeliveredValue)}</b> · {t("listo", "ready")} {i.money(readyValue)}</dd>
          </dl>
          <p className="src" style={{ marginTop: 8 }}>{t("Los niveles de certeza no se suman.", "Certainty levels are not added together.")}</p>
        </div>
        <div className="card">
          <h2>{t("Cómo nos movemos", "How we move")}</h2>
          <dl className="facts">
            <dt>{t("Journeys en curso", "Journeys in progress")}</dt><dd><b>{deals.filter((d) => !["WON", "LOST"].includes(d.stage)).length}</b></dd>
            <dt>{t("Sin siguiente movimiento", "No next movement")}</dt><dd><b>{deals.filter((d) => !["WON", "LOST"].includes(d.stage) && !d.nextMove && !d.waitingFor).length}</b></dd>
            <dt>{t("Entrega → factura", "Delivery → invoice")}</dt><dd><b>{lags.length ? i.n2(lags.reduce((s, x) => s + x, 0) / lags.length) : "—"}</b> {t("días promedio", "days on average")}</dd>
          </dl>
        </div>
      </div>

      <div className="card flush">
        <div style={{ padding: "12px 16px 0" }}><h2>{t("Dónde ayudar a cada persona", "Where to help each person")}</h2><p className="src">{t("Solo líderes ven esta tabla; cada persona ve su propia información en Mi Día. No mide actividad, muestra dónde ayudar.", "Only leaders see this table; each person sees their own in My Day. It doesn't measure activity; it shows where to help.")}</p></div>
        <table>
          <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Dónde ayuda gerencia", "Where management helps")}</th><th className="n">{t("Resultados logrados", "Results achieved")}</th><th className="n">{t("Journeys activos", "Active Journeys")}</th><th className="n">{t("Propuestas esperadas", "Expected proposals")}</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.u.id}>
                <td><b>{p.u.name}</b></td>
                <td className="small">
                  {p.broken > 0 && <span className="block">{t(`${p.broken} clientes con pago prometido sin llegar`, `${p.broken} customers with promised payment not received`)}</span>}
                  {p.noMove > 0 && <span className="block">{t(`${p.noMove} Journeys sin siguiente movimiento claro`, `${p.noMove} Journeys without a clear next movement`)}</span>}
                  {!p.broken && !p.noMove && <span className="muted">{t("Todo se mueve con normalidad", "Everything is moving normally")}</span>}
                </td>
                <td className="n val">{p.results}</td>
                <td className="n val">{p.active}</td>
                <td className="n val">{i.n(p.pipeline)}</td>
              </tr>
            ))}
            {people.length === 0 && <tr><td colSpan={5} className="empty"><b>{t("Sin datos todavía", "No data yet")}</b></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
