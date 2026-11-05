import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { addDays, bankDiscrepancies, paymentState, today } from "@/lib/domain";
import { loadCredit } from "@/lib/queries";

type Cause = { key: string; label: string; cls: string; detail: string; missing: string[]; href: string; cta: string; who: string; urgent: boolean };

export default async function UnshippedPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const now = today();

  const [deals, credit] = await Promise.all([
    db.deal.findMany({
      where: { stage: "WON" },
      include: {
        account: { select: { id: true, name: true } },
        owner: { select: { name: true } },
        items: { include: { deliveryLines: { select: { qty: true } } } },
        deliveries: { select: { id: true } },
        invoices: { select: { amount: true } },
        supplierPos: { include: { supplier: true, payments: true } },
      },
      orderBy: { promisedDate: { sort: "asc", nulls: "last" } },
    }),
    loadCredit(),
  ]);

  const rows = deals
    .map((d) => {
      const ordered = d.items.reduce((s, it) => s + it.qty, 0);
      const delivered = d.items.reduce((s, it) => s + it.deliveryLines.reduce((x, l) => x + l.qty, 0), 0);
      const invoicedAll = d.invoices.reduce((s, x) => s + Number(x.amount), 0) >= Number(d.amount) - 0.5;
      const pending = !invoicedAll && (ordered ? delivered < ordered : d.deliveries.length === 0);
      if (!pending) return null;
      const pendingValue = ordered
        ? d.items.reduce((s, it) => s + (it.qty - it.deliveryLines.reduce((x, l) => x + l.qty, 0)) * Number(it.unitPrice), 0)
        : Number(d.amount);

      // Cause derived from the object that originates it, in order of severity.
      let cause: Cause | null = null;
      const acc = credit.find((a) => a.id === d.account.id);
      for (const po of d.supplierPos) {
        for (const p of po.payments) {
          const disc = bankDiscrepancies(po.supplier, p);
          const st = paymentState({ ...p, discrepancies: disc.length });
          if (st === "VERIFY" || st === "APPROVE" || st === "EXECUTE") {
            cause = {
              key: "pay",
              label: st === "VERIFY" ? t("Pago al proveedor bloqueado", "Supplier payment blocked") : t("Pago al proveedor en curso", "Supplier payment in progress"),
              cls: st === "VERIFY" ? "risk" : "attn",
              detail: st === "VERIFY"
                ? t(`${disc.length} diferencias entre la instrucción y el perfil bancario verificado de ${po.supplier.name}.`, `${disc.length} differences between the instruction and ${po.supplier.name}'s verified bank profile.`)
                : t(`${po.supplier.name} despacha cuando reciba el pago.`, `${po.supplier.name} ships once paid.`),
              missing: st === "VERIFY"
                ? [t("Verificación independiente por el teléfono registrado", "Independent verification via registered phone"), t("Aprobación de gerencia", "Management approval")]
                : st === "APPROVE" ? [t("Aprobación de gerencia", "Management approval")] : [t("Ejecutar la transferencia aprobada", "Execute the approved transfer")],
              href: `/administracion/pagos-proveedores/${p.id}`,
              cta: t("Ir al pago", "Go to payment"),
              who: t("Tesorería", "Treasury"),
              urgent: true,
            };
          }
        }
      }
      if (!cause && acc && acc.limit != null && acc.blocking.some((b) => b.id === d.id)) {
        cause = {
          key: "credit",
          label: t("Excede el cupo de crédito", "Exceeds credit limit"),
          cls: "attn",
          detail: t(`Con este pedido queda ${i.money(acc.used - acc.limit)} por encima de su cupo.`, `With this order it is ${i.money(acc.used - acc.limit)} over its limit.`),
          missing: [t("Que llegue un pago pendiente, o", "A pending payment arrives, or"), t("Excepción de Gerencia, o anticipo", "Management exception, or prepayment")],
          href: `/administracion/cupos#${d.account.id}`,
          cta: t("Ver opciones de cupo", "See credit options"),
          who: t("Gerencia", "Management"),
          urgent: true,
        };
      }
      if (!cause && d.supplierPos.length === 0) {
        cause = { key: "nopo", label: t("Sin compra al proveedor", "No supplier PO"), cls: "attn", detail: t("Aún no hay Supplier PO para este Journey.", "No supplier PO for this Journey yet."), missing: [t("Crear la Supplier PO", "Create the supplier PO")], href: `/deals/${d.id}`, cta: t("Abrir Journey", "Open Journey"), who: d.owner.name, urgent: true };
      }
      const unconfirmed = d.supplierPos.find((p) => !p.confirmedAt);
      if (!cause && unconfirmed) {
        cause = { key: "src", label: t("Fuente sin confirmar", "Source not confirmed"), cls: "attn", detail: t(`${unconfirmed.supplier.name} no ha confirmado la Supplier PO ${unconfirmed.code}.`, `${unconfirmed.supplier.name} hasn't confirmed supplier PO ${unconfirmed.code}.`), missing: [t("Confirmación del proveedor", "Supplier confirmation")], href: `/deals/${d.id}`, cta: t("Abrir Journey", "Open Journey"), who: d.owner.name, urgent: true };
      }
      const transit = d.supplierPos.find((p) => p.shippedAt && !p.receivedAt);
      if (!cause && transit) {
        cause = { key: "transit", label: t("Proveedor en tránsito", "Supplier in transit"), cls: "wait", detail: t(`${transit.supplier.name} despachó el ${i.day(transit.shippedAt)}; ETA ${i.day(transit.eta)}.`, `${transit.supplier.name} shipped on ${i.day(transit.shippedAt)}; ETA ${i.day(transit.eta)}.`), missing: [t("Que llegue a bodega", "Arrival at warehouse")], href: `/deals/${d.id}`, cta: "", who: "SOLU", urgent: !!(transit.eta && transit.eta < now) };
      }
      if (!cause && d.waitingFor) {
        cause = { key: "wait", label: t("Esperando con control", "Waiting with control"), cls: "wait", detail: d.waitingFor, missing: [t(`Revisar el ${i.day(d.waitingUntil)}`, `Check on ${i.day(d.waitingUntil)}`)], href: `/deals/${d.id}`, cta: "", who: d.owner.name, urgent: !!(d.waitingUntil && d.waitingUntil < now) };
      }
      if (!cause) {
        const confirmed = d.supplierPos.find((p) => p.confirmedAt && !p.shippedAt);
        cause = confirmed
          ? { key: "prep", label: t("Proveedor preparando", "Supplier preparing"), cls: "wait", detail: t(`${confirmed.supplier.name} confirmó; falta el despacho.`, `${confirmed.supplier.name} confirmed; shipment pending.`), missing: [t("Despacho del proveedor", "Supplier shipment")], href: `/deals/${d.id}`, cta: "", who: d.owner.name, urgent: false }
          : { key: "ready", label: t("Mercancía en bodega", "Goods in warehouse"), cls: "ok", detail: t("Todo recibido: falta despachar al cliente.", "Everything received: ship to customer."), missing: [t("Crear la remisión", "Create the delivery note")], href: `/operaciones/remisiones/nueva?deal=${d.id}`, cta: t("Nueva remisión", "New delivery note"), who: d.owner.name, urgent: true };
      }
      const promiseRisk = d.promisedDate && d.promisedDate < addDays(now, 7);
      return { d, pendingValue, cause, urgent: cause.urgent || !!promiseRisk, promiseRisk };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const act = rows.filter((r) => r.urgent);
  const wait = rows.filter((r) => !r.urgent);
  const counts = new Map<string, { label: string; n: number }>();
  for (const r of rows) counts.set(r.cause.key, { label: r.cause.label, n: (counts.get(r.cause.key)?.n ?? 0) + 1 });

  const Row = ({ r }: { r: (typeof rows)[number] }) => (
    <tr>
      <td><b className="mono">{r.d.customerPo}</b><span className="src"><Link href={`/deals/${r.d.id}`}>{r.d.code}</Link></span></td>
      <td><b>{r.d.account.name}</b><span className="src">{r.d.title}</span></td>
      <td className="n val">{i.n(r.pendingValue)}</td>
      <td>{r.d.promisedDate ? <><b>{i.dateShort(r.d.promisedDate)}</b><span className={`src ${r.promiseRisk ? "attn-t" : ""}`}>{r.d.promiseText ?? ""}</span></> : "—"}</td>
      <td><span className={`sig ${r.cause.cls}`}>{r.cause.label}</span><span className="src" style={{ marginTop: 3 }}>{r.cause.detail}</span></td>
      <td><ul style={{ margin: 0, paddingLeft: 16 }}>{r.cause.missing.map((m) => <li key={m} className="small">{m}</li>)}</ul></td>
      <td className="n">{r.cause.cta ? <Link className="btn secondary sm" href={r.cause.href}>{r.cause.cta}</Link> : null}<span className="src">{r.cause.who}</span></td>
    </tr>
  );

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Operaciones", "Operations")}</div>
          <h1>{t("Órdenes sin despachar", "Unshipped orders")}</h1>
          <p>{t("OC de clientes aceptadas que aún no salen. La causa se calcula de los pagos, las Supplier PO, el cupo y los documentos; nadie la escribe a mano.", "Accepted customer POs not yet shipped. The cause is derived from payments, supplier POs, credit and documents; nobody types it.")}</p>
        </div>
      </div>
      <section className="sum">
        <div><span className="k">{t("Sin despachar", "Unshipped")}</span><span className="v">{rows.length} · {i.n(rows.reduce((s, r) => s + r.pendingValue, 0))}</span><span className="s">USD</span></div>
        {[...counts.values()].map((c) => <div key={c.label}><span className="k">{c.label}</span><span className="v">{c.n}</span></div>)}
      </section>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("OC cliente · Journey", "Customer PO · Journey")}</th><th>{t("Cliente", "Customer")}</th><th className="n">{t("Pendiente", "Pending")}</th><th>{t("Promesa al cliente", "Customer promise")}</th><th>{t("Causa derivada", "Derived cause")}</th><th>{t("Qué falta para liberar", "What's needed to release")}</th><th className="n">{t("Movimiento", "Move")}</th></tr></thead>
          <tbody>
            {act.length > 0 && <tr className="grpr"><td colSpan={7}>{t("Requiere un movimiento", "Needs a move")} <span>· {t("la promesa depende de esto", "the promise depends on it")}</span></td></tr>}
            {act.map((r) => <Row key={r.d.id} r={r} />)}
            {wait.length > 0 && <tr className="grpr"><td colSpan={7}>{t("Esperando con control", "Waiting with control")} <span>· {t("nadie tiene que hacer nada todavía", "nobody needs to act yet")}</span></td></tr>}
            {wait.map((r) => <Row key={r.d.id} r={r} />)}
            {rows.length === 0 && <tr><td colSpan={7} className="empty"><b>{t("Todo lo aceptado ya salió", "Everything accepted has shipped")}</b></td></tr>}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 12 }}>{t("No hay campo de estado para llenar. Cuando cambia el pago, la Supplier PO, el cupo o lo que dijo el cliente, la fila cambia o desaparece sola.", "There is no status field to fill in. When the payment, supplier PO, credit or customer's word changes, the row updates or disappears on its own.")}</p>
    </>
  );
}
