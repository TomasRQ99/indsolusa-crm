import Link from "next/link";
import { db } from "@/lib/db";
import { makeI18n } from "@/lib/i18n";
import { BILLING_BASIS, RESOURCES, STATES, dispatchState, remainingByItem, type Line } from "@/lib/dispatch-rules";
import { createDispatchOrder, setBillingBasis } from "@/app/(app)/operaciones/despachos/actions";

// Operaciones O8 · the physical side of a Journey's delivery: what is still owed, the dispatch orders and the
// billing basis. Shown under the Commercial instruction: Commercial defines the obligation, Operations executes it.

export async function DealDispatchOrders({ dealId, lang, canOps, canOwner }: { dealId: string; lang: "ES" | "EN"; canOps: boolean; canOwner: boolean }) {
  const i = makeI18n(lang);
  const { t } = i;
  const d = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      billingBasis: true, poAcceptedAt: true,
      account: { select: { requiresReceptionCode: true, deliveryRequirements: { where: { active: true }, select: { id: true, phase: true, text: true } } } },
      items: { select: { id: true, qty: true, code: true, description: true } },
      deliveries: { select: { lines: { select: { dealItemId: true, qty: true } } } },
      dispatches: { where: { supersededAt: null }, select: { id: true }, take: 1 },
      dispatchOrders: { orderBy: { createdAt: "asc" }, include: { delivery: { select: { code: true, receptionCode: true, invoice: { select: { id: true } } } } } },
    },
  });
  if (!d) return null;
  const openLines = d.dispatchOrders.filter((o) => !o.cancelledAt && !o.deliveredAt).flatMap((o) => o.lines as unknown as Line[]);
  const rem = remainingByItem(d.items, d.deliveries.flatMap((x) => x.lines), openLines);
  const anyLeft = rem.some((r) => r.remaining > 0);

  return (
    <section className="jblock" id="operaciones">
      <div className="jbh"><b>{t("ENTREGA FÍSICA (OPERACIONES)", "PHYSICAL DELIVERY (OPERATIONS)")}</b><span className="grow" /><span className="src">{t("Una entrega parcial es un despacho con menos unidades", "A partial delivery is a dispatch order with fewer units")}</span></div>
      {d.items.length === 0 ? <p className="small muted">{t("Este Journey aún no tiene productos definidos.", "This Journey has no products defined yet.")}</p> : (
        <div className="tscroll"><table>
          <thead><tr><th>{t("Producto", "Product")}</th><th className="n">{t("Pedido", "Ordered")}</th><th className="n">{t("Entregado", "Delivered")}</th><th className="n">{t("En despacho", "In dispatch")}</th><th className="n">{t("Falta", "Remaining")}</th></tr></thead>
          <tbody>{d.items.map((it) => { const r = rem.find((x) => x.id === it.id)!; return <tr key={it.id}><td>{it.code ? <b className="mono">{it.code}</b> : null} <span className="small">{it.description}</span></td><td className="n mono">{r.ordered}</td><td className="n mono">{r.delivered}</td><td className="n mono">{r.inOrders}</td><td className="n mono"><b>{r.remaining}</b></td></tr>; })}</tbody>
        </table></div>
      )}

      {d.dispatchOrders.length > 0 && (
        <ul className="plain small" style={{ marginTop: 8 }}>{d.dispatchOrders.map((o) => {
          const st = dispatchState({ cancelled: !!o.cancelledAt, hasInstruction: d.dispatches.length > 0, reqs: d.account.deliveryRequirements, checks: (o.checks ?? {}) as Record<string, unknown>, customerHold: !!o.customerHoldSince, scheduledFor: o.scheduledFor, dispatchedAt: o.dispatchedAt, deliveredAt: o.deliveredAt, entryRequired: d.account.requiresReceptionCode, entryRef: o.delivery?.receptionCode ?? null, invoiced: !!o.delivery?.invoice });
          const S = STATES[st.key];
          return <li key={o.id}><Link href={`/operaciones/despachos/${o.id}`}><b className="mono">{o.code}</b></Link> <span className={`sig ${S.tone}`}>{t(S.es, S.en)}</span> {(o.lines as unknown as Line[]).map((l) => `${l.qty} × ${l.code ?? l.description}`).join(" · ")}{o.delivery && <span className="muted"> · {o.delivery.code}</span>}</li>;
        })}</ul>
      )}

      {canOps && anyLeft && (
        <details className="qa" style={{ marginTop: 8 }} open={d.dispatchOrders.length === 0 && !!d.poAcceptedAt}><summary className="qa-btn">{t("+ Nuevo despacho", "+ New dispatch order")}</summary>
          <form action={createDispatchOrder.bind(null, dealId)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
            {d.items.map((it) => { const r = rem.find((x) => x.id === it.id)!; return r.remaining > 0 ? (
              <div className="qa-row" key={it.id}><label style={{ flex: "0 0 110px" }}>{t("Unidades", "Units")}<input name={`q_${it.id}`} type="number" min={0} max={r.remaining} defaultValue={r.remaining} /></label><span className="small" style={{ alignSelf: "flex-end", paddingBottom: 8 }}>{it.code ? <b className="mono">{it.code}</b> : null} {it.description} <span className="muted">· {t(`faltan ${r.remaining}`, `${r.remaining} remaining`)}</span></span></div>
            ) : null; })}
            <div className="qa-row">
              <label style={{ flex: "0 0 240px" }}>{t("Cómo se entrega", "How it is delivered")}<select name="resourceKind">{Object.entries(RESOURCES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
              <label>{t("Quién o qué empresa (opcional)", "Who or which company (optional)")}<input name="resourceName" maxLength={120} /></label>
              <label style={{ flex: "0 0 160px" }}>{t("Fecha programada", "Scheduled date")}<input name="scheduledFor" type="date" /></label>
            </div>
            <button type="submit">{t("Crear despacho", "Create dispatch order")}</button>
            {!d.dispatches.length && <span className="src block">{t("Aún no hay instrucción emitida por Comercial: el despacho se puede preparar, pero no sale sin ella.", "No instruction issued by Sales yet: the order can be prepared, but it doesn't leave without it.")}</span>}
          </form>
        </details>
      )}

      <form action={setBillingBasis.bind(null, dealId)} className="qa-row" style={{ alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
        <label style={{ flex: "0 0 260px" }}>{t("Este Journey se factura", "This Journey is invoiced")}<select name="billingBasis" defaultValue={d.billingBasis} disabled={!canOwner}>{Object.entries(BILLING_BASIS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
        {canOwner && <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar", "Save")}</button>}
        <span className="src" style={{ flex: "1 1 240px" }}>{t("Hoy es informativo: lo ven Operaciones y Administración. La factura sigue pasando por «¿Listo para facturar?».", "Informative for now: Operations and Administration see it. The invoice still goes through \"Ready to invoice?\".")}</span>
      </form>
    </section>
  );
}
