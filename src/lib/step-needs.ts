// What a Need still needs before its current step is done, item by item, each with the place where it is filled in.
// The path at the top of a Need says which step is "yours now"; this says exactly what is missing to leave it,
// so nobody has to guess (asked by the user on 2026-11-18: "it should be clear what must be done before moving to
// the next step, maybe highlight in red the info required"). The rules mirror the ones the path itself uses
// (journey.ts, rawSteps): when every item here is done, the step turns green.

import type { PathKey } from "./journey";

export type StepNeed = { ok: boolean; text: string; how: string | null; href: string | null };

type Money = number | string | { toString(): string };
export type StepNeedsInput = {
  self: string; // /deals/<id>
  step: PathKey;
  deal: {
    desiredResult: string | null; sourcingNote: string | null; supplierCost: Money; quoteSentAt: Date | null; poAcceptedAt: Date | null;
    accountId: string; account: { creditLimit: Money | null };
    items: { qty: number }[];
    supplierPos: { id: string; releasedAt: Date | null; confirmedAt: Date | null; receivedAt: Date | null; payments: { id: string; executedAt: Date | null }[] }[];
    shipments: { id: string }[];
    deliveries: { id: string }[];
  };
  quotes: { id: string; status: string; solution: string | null; supplierCost: Money; supplierSrc: string | null; leadMinDays: number | null; leadMaxDays: number | null; promiseText: string | null; lines: { unitPrice: Money }[] }[];
  customerPos: { id: string; rejectedAt: Date | null; accepted: boolean }[];
  dispatchOrders: { id: string; deliveredAt: Date | null; cancelledAt: Date | null }[];
  done: { ship: boolean; deliver: boolean; invoice: boolean; cash: boolean; result: boolean };
};

export function stepNeeds(x: StepNeedsInput, t: (es: string, en: string) => string): StepNeed[] {
  const { deal: d, self } = x;
  const it = (ok: boolean, text: string, how: string | null, href: string | null): StepNeed => ({ ok, text, how: ok ? null : how, href: ok ? null : href });
  const draft = x.quotes.find((q) => q.status === "DRAFT");
  const shown = x.quotes.find((q) => q.status === "PRESENTED") ?? x.quotes.find((q) => q.status === "ACCEPTED");
  const livePo = x.customerPos.find((p) => !p.rejectedAt && !p.accepted) ?? x.customerPos.find((p) => p.accepted);
  const spo = d.supplierPos[0];
  const pays = d.supplierPos.flatMap((p) => p.payments);

  switch (x.step) {
    case "need":
      return [it(!!d.desiredResult, t("El resultado que busca el cliente", "The result the customer wants"), t("Pestaña Necesidad → «Resultado deseado: qué quiere lograr el cliente» → Guardar necesidad", "Need tab → “Desired result: what the customer wants to achieve” → Save need"), `${self}?tab=need#resultado-deseado`)];
    case "source":
      return [it(d.supplierPos.length > 0 || Number(d.supplierCost) > 0 || !!d.sourcingNote, t("De dónde lo vamos a conseguir, o el costo del producto", "Where we will get it, or the product's cost"), t("Pestaña Fuente → escribe la fuente o el costo en «Liquidación de costos» → Guardar fuente", "Source tab → type the source or the cost under “Cost settlement” → Save source"), `${self}?tab=source#fuente`)];
    case "quote": {
      const q = draft ?? shown ?? null;
      const list: StepNeed[] = [
        it(d.items.length > 0 || x.quotes.length > 0, t("Al menos un producto en la Necesidad", "At least one product on the Need"), t("Pestaña Cotización → «Agregar producto» → Agregar", "Quote tab → “Add product” → Add"), `${self}?tab=quote`),
        it(x.quotes.length > 0, t("La cotización preparada", "The quote prepared"), t("Pestaña Cotización → Preparar cotización", "Quote tab → Prepare quote"), `${self}?tab=quote`),
      ];
      if (draft && !shown) {
        const qh = `/cotizaciones/${draft.id}`;
        list.push(
          it(!!d.desiredResult, t("El resultado que busca el cliente", "The result the customer wants"), t("Pestaña Necesidad → «Resultado deseado»", "Need tab → “Desired result”"), `${self}?tab=need#resultado-deseado`),
          it(!!draft.solution, t("La solución en una frase", "The solution in one sentence"), t("En la cotización, bloque SOLUCIÓN → Editar", "On the quote, SOLUTION block → Edit"), qh),
          it(draft.lines.length > 0 && draft.lines.every((l) => Number(l.unitPrice) > 0), t("Todos los productos con precio", "Every product with a price"), t("En la cotización, PRODUCTOS EN EL DOCUMENTO → Editar cada línea", "On the quote, PRODUCTS ON THE DOCUMENT → Edit each line"), qh),
          it(Number(draft.supplierCost) > 0 && !!draft.supplierSrc, t("El costo del producto y de dónde sale", "The product's cost and where it comes from"), t("En la cotización, hoja «Liquidación de costos», fila Producto → Guardar costos", "On the quote, “Cost settlement” sheet, Product row → Save costs"), `${qh}#costos`),
          it(draft.leadMinDays != null && draft.leadMaxDays != null, t("El tiempo de entrega (días después de la OC)", "The lead time (days after the PO)"), t("En la cotización, CONDICIONES DEL DOCUMENTO → Editar condiciones", "On the quote, DOCUMENT TERMS → Edit terms"), qh),
          it(!!draft.promiseText, t("La promesa posible y su condición", "The possible promise and its condition"), t("En la cotización, bloque SOLUCIÓN → Editar", "On the quote, SOLUTION block → Edit"), qh),
        );
      }
      list.push(it(!!d.quoteSentAt || !!shown, t("La cotización presentada al cliente", "The quote presented to the customer"), q ? t("En la cotización, cuando «LISTA PARA PRESENTAR» no tenga «!» → Presentar al cliente", "On the quote, once “READY TO PRESENT” has no “!” → Present to customer") : t("Primero prepara la cotización", "Prepare the quote first"), q ? `/cotizaciones/${q.id}` : `${self}?tab=quote`));
      return list;
    }
    case "po":
      return [
        it(x.customerPos.length > 0 || !!d.poAcceptedAt, t("La OC del cliente registrada", "The customer's PO recorded"), t("En la cotización presentada → «Llegó la PO · registrarla» → Registrar y comparar", "On the presented quote → “PO arrived · record it” → Record and compare"), shown ? `/cotizaciones/${shown.id}` : `${self}?tab=quote`),
        it(d.account.creditLimit != null || !!d.poAcceptedAt, t("El cliente con cupo de crédito aprobado", "The customer with an approved credit limit"), t("En la OC → «Pedir revisión de cupo» (lo deciden Finanzas o Gerencia)", "On the PO → “Request a credit review” (Finance or Management decide)"), livePo ? `/po/${livePo.id}` : `/administracion/cupos`),
        it(!!d.poAcceptedAt, t("La OC aceptada", "The PO accepted"), t("En la OC, cuando todas las precondiciones estén en verde → Aceptar PO", "On the PO, once every precondition is green → Accept PO"), livePo ? `/po/${livePo.id}` : null),
      ];
    case "purchase":
      return [
        it(d.supplierPos.length > 0, t("La orden de compra al proveedor preparada", "The supplier purchase order prepared"), t("Pestaña Ejecución → elige el proveedor → Preparar Supplier PO desde la cotización", "Execute tab → pick the supplier → Prepare Supplier PO from the quote"), `${self}?tab=execute`),
        it(d.supplierPos.length > 0 && d.supplierPos.every((p) => !!p.releasedAt), t("La orden liberada", "The order released"), t("En la orden, cuando «LISTA PARA LIBERAR» no tenga pendientes → Liberar Supplier PO", "On the order, once “RELEASE READINESS” has nothing open → Release Supplier PO"), spo ? `/compras/${spo.id}` : null),
        it(d.supplierPos.length > 0 && d.supplierPos.every((p) => !!p.confirmedAt), t("La orden confirmada por el proveedor", "The order confirmed by the supplier"), t("En la orden → «Marcar enviada» y después «Registrar lo que confirmó el proveedor»; si hay diferencias, «Resolver y dar por confirmada»", "On the order → “Mark sent”, then “Record what the supplier confirmed”; if there are differences, “Resolve and confirm”"), spo ? `/compras/${spo.id}` : null),
      ];
    case "pay":
      return [
        it(pays.length > 0, t("El pago al proveedor solicitado", "The supplier payment requested"), t("En la orden, PLAN DE PAGO → Solicitar este pago", "On the order, PAYMENT PLAN → Request this payment"), spo ? `/compras/${spo.id}` : null),
        it(pays.length > 0 && pays.every((p) => !!p.executedAt), t("El pago verificado, aprobado por otra persona y confirmado por el banco", "The payment verified, approved by another person and confirmed by the bank"), t("Administración → Pagos a proveedores → el pago: verificación, aprobación (nunca quien lo pidió), ejecución y «Confirmar: el dinero salió»", "Administration → Supplier payments → the payment: verification, approval (never the requester), execution and “Confirm: the money left”"), pays[0] ? `/administracion/pagos-proveedores/${pays[0].id}` : null),
      ];
    case "ship":
      return [
        it(d.shipments.length > 0 || x.done.ship, t("El envío del proveedor registrado", "The supplier's shipment recorded"), t("Pestaña Ejecución → «Registrar envío externo» (transportista, guía y fecha)", "Execute tab → “Record external shipment” (carrier, tracking and date)"), `${self}?tab=execute`),
        it(x.done.ship, t("La mercancía recibida", "The goods received"), t("Si llega a nuestra bodega: en la orden de compra, bloque RECEPCIÓN → Registrar recepción. Si va directo al cliente: en el envío → Confirmar recibo", "If it arrives at our warehouse: on the supplier order, RECEIVING block → Record receipt. If it goes straight to the customer: on the shipment → Confirm receipt"), spo ? `/compras/${spo.id}#recepcion` : d.shipments[0] ? `/logistica/${d.shipments[0].id}` : null),
      ];
    case "deliver": {
      const open = x.dispatchOrders.find((o) => !o.cancelledAt && !o.deliveredAt);
      return [
        it(x.dispatchOrders.some((o) => !o.cancelledAt) || d.deliveries.length > 0, t("La entrega al cliente creada", "The delivery to the customer created"), t("En la Necesidad → Despacho → «+ Nuevo despacho» → Crear despacho", "On the Need → Dispatch → “+ New dispatch” → Create dispatch"), `${self}/despacho`),
        it(x.done.deliver, t("Entregado al cliente, con su remisión", "Delivered to the customer, with its delivery note"), t("En la entrega → «Salió hacia el cliente» y después «Entregado: crear remisión»", "On the delivery → “Left for the customer”, then “Delivered: create delivery note”"), open ? `/operaciones/despachos/${open.id}` : `${self}/despacho`),
      ];
    }
    case "invoice":
      return [it(x.done.invoice, t("Lo entregado, facturado", "What was delivered, invoiced"), t("Finanzas → Facturación: completa «REQUISITOS PARA FACTURAR» → Emitir factura", "Finance → Billing: complete “BILLING REQUIREMENTS” → Issue invoice"), `${self}/facturacion`)];
    case "cash":
      return [it(x.done.cash, t("El pago del cliente registrado y conciliado", "The customer's payment recorded and reconciled"), t("Administración → Pagos recibidos → el cliente → Registrar (aplicado a la factura) → Conciliar", "Administration → Payments received → the customer → Record (applied to the invoice) → Reconcile"), `/administracion/pagos-recibidos?account=${d.accountId}`)];
    case "result":
      return [it(x.done.result, t("El resultado confirmado con el cliente", "The result confirmed with the customer"), t("Resultado → «Confirmar resultado del cliente», con la evidencia", "Result → “Confirm the customer's result”, with the evidence"), `${self}/resultado`)];
  }
}
