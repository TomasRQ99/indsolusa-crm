import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { today } from "@/lib/domain";
import { RESOURCES, STATES, aging, dispatchState, type Line, type StateKey } from "@/lib/dispatch-rules";

// Operaciones O8 · every open dispatch order by where it is. Dispatched, Delivered and Invoice Ready stay apart.

const ORDER: StateKey[] = ["INSTRUCTION_PENDING", "WAITING_DOCUMENTS", "READY_TO_SCHEDULE", "SCHEDULED", "DISPATCHED", "WAITING_CUSTOMER_ENTRY", "DELIVERED", "INVOICE_READY", "CUSTOMER_HOLD"];

export default async function DispatchListPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const [rows, pending] = await Promise.all([
    db.dispatchOrder.findMany({
      where: { cancelledAt: null, OR: [{ deliveredAt: null }, { delivery: { invoice: null } }] }, orderBy: { createdAt: "asc" },
      include: { deal: { select: { id: true, code: true, title: true, promisedDate: true, account: { select: { name: true, requiresReceptionCode: true, deliveryRequirements: { where: { active: true }, select: { id: true, phase: true, text: true } } } }, dispatches: { where: { supersededAt: null }, select: { id: true }, take: 1 } } }, delivery: { select: { receptionCode: true, invoice: { select: { issuedAt: true } } } } },
    }),
    // Journeys with an accepted PO, something still to deliver and no open dispatch order.
    db.deal.findMany({ where: { internal: false, poAcceptedAt: { not: null }, resultAchievedAt: null, stage: { not: "LOST" }, dispatchOrders: { none: { cancelledAt: null, deliveredAt: null } }, deliveries: { none: {} } }, orderBy: { promisedDate: "asc" }, take: 30, select: { id: true, code: true, title: true, promisedDate: true, account: { select: { name: true } }, stockLots: { where: { state: "COMMITTED", outAt: null }, select: { qty: true } } } }),
  ]);
  const T = today();
  const items = rows.map((o) => {
    const st = dispatchState({ cancelled: false, hasInstruction: o.deal.dispatches.length > 0, reqs: o.deal.account.deliveryRequirements, checks: (o.checks ?? {}) as Record<string, unknown>, customerHold: !!o.customerHoldSince, scheduledFor: o.scheduledFor, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, entryRequired: o.deal.account.requiresReceptionCode, entryRef: o.delivery?.receptionCode ?? null, invoiced: !!o.delivery?.invoice });
    return { o, st, ag: aging({ readyAt: o.createdAt, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, invoicedAt: null, customerHoldSince: o.customerHoldSince }, new Date()) };
  });
  const inWarehouse = pending.filter((d) => d.stockLots.length > 0);

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Despachos", "Dispatch")}</h1>
          <p>{t("Cada entrega al cliente, según dónde está. Despachado, entregado y listo para facturar son tres cosas distintas.", "Every delivery to a customer, by where it is. Dispatched, delivered and invoice-ready are three different things.")}</p>
        </div>
      </div>

      {inWarehouse.length > 0 && (
        <section className="card">
          <b>{t("MERCANCÍA EN BODEGA SIN DESPACHO", "GOODS IN THE WAREHOUSE WITH NO DISPATCH ORDER")}</b>
          <ul className="plain small">{inWarehouse.map((d) => <li key={d.id}><Link href={`/deals/${d.id}/despacho#operaciones`}>{d.code ?? d.title}</Link> · {d.account.name} · {t(`${d.stockLots.reduce((a, l) => a + l.qty, 0)} unidades comprometidas`, `${d.stockLots.reduce((a, l) => a + l.qty, 0)} committed units`)}{d.promisedDate && <span className={d.promisedDate < T ? "risk-t" : "muted"}> · {t("promesa", "promise")} {i.day(d.promisedDate)}</span>}</li>)}</ul>
        </section>
      )}

      {items.length === 0 ? <section className="card"><p className="small muted">{t("No hay despachos abiertos. Se crean desde la página de despacho de un Journey con PO aceptada.", "No open dispatch orders. They are created from the dispatch page of a Journey with an accepted PO.")}</p></section> : ORDER.map((key) => {
        const g = items.filter((x) => x.st.key === key);
        if (!g.length) return null;
        const S = STATES[key];
        return (
          <section className="card" key={key}>
            <b><span className={`sig ${S.tone}`}>{g.length}</span> {t(S.es, S.en).toUpperCase()}</b>
            <div className="tscroll"><table>
              <thead><tr><th>{t("Despacho", "Order")}</th><th>{t("Cliente y Journey", "Customer and Journey")}</th><th>{t("Qué", "What")}</th><th>{t("Cómo", "How")}</th><th>{t("Promesa", "Promise")}</th><th>{t("Falta", "Missing")}</th></tr></thead>
              <tbody>{g.map(({ o, st, ag }) => (
                <tr key={o.id}>
                  <td><Link href={`/operaciones/despachos/${o.id}`}><b className="mono">{o.code}</b></Link><span className="src block">{key === "DELIVERED" || key === "WAITING_CUSTOMER_ENTRY" || key === "INVOICE_READY" ? t(`${ag.deliveryToInvoice ?? 0} días desde la entrega`, `${ag.deliveryToInvoice ?? 0} days since delivery`) : t(`${ag.readyToDispatch} días abierto`, `${ag.readyToDispatch} days open`)}{ag.customerWait > 0 ? t(` · ${ag.customerWait} del cliente`, ` · ${ag.customerWait} on the customer`) : ""}</span></td>
                  <td className="small">{o.deal.account.name}<span className="src block"><Link href={`/deals/${o.deal.id}`}>{o.deal.code ?? o.deal.title}</Link></span></td>
                  <td className="small">{(o.lines as unknown as Line[]).map((l) => `${l.qty} × ${l.code ?? l.description}`).join(" · ").slice(0, 90)}</td>
                  <td className="small">{t(RESOURCES[o.resourceKind]?.es ?? o.resourceKind, RESOURCES[o.resourceKind]?.en ?? o.resourceKind)}{o.scheduledFor && !o.dispatchedAt && <span className="src block">{i.day(o.scheduledFor)}</span>}</td>
                  <td className={`mono small${o.deal.promisedDate && !o.deliveredAt && o.deal.promisedDate < T ? " risk-t" : ""}`}>{o.deal.promisedDate ? i.day(o.deal.promisedDate) : "—"}</td>
                  <td className="small">{st.missing.length ? st.missing.map((m) => m.text).join(" · ").slice(0, 90) : key === "CUSTOMER_HOLD" ? o.customerHoldReason : "—"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        );
      })}
    </>
  );
}
