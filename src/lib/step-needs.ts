// What a Need still needs before its current step is done, item by item, each with the place where it is filled in.
// The path at the top of a Need says which step is "yours now"; this says exactly what is missing to leave it,
// so nobody has to guess (asked by the user on 2026-11-18: "it should be clear what must be done before moving to
// the next step, maybe highlight in red the info required"). The rules mirror the ones the path itself uses
// (journey.ts, rawSteps): when every item here is done, the step turns green.

import type { PathKey } from "./journey";

// go = the words on the button (default "Ir a llenarlo"); act = the button does the thing itself instead of leading to it.
export type StepNeed = { ok: boolean; text: string; how: string | null; href: string | null; go?: string; act?: "createQuote" };

type Money = number | string | { toString(): string };
export type StepNeedsInput = {
  self: string; // /deals/<id>
  step: PathKey;
  deal: {
    desiredResult: string | null; sourcingNote: string | null; supplierCost: Money; quoteSentAt: Date | null; poAcceptedAt: Date | null;
    accountId: string; account: { creditLimit: Money | null };
    items: { qty: number }[];
    supplierPos: { id: string; code: string; releasedAt: Date | null; sentAt: Date | null; confirmedAt: Date | null; receivedAt: Date | null; supplier: { name: string }; payments: { id: string; amount: Money; currency: string; verifiedAt: Date | null; approvedAt: Date | null; executedAt: Date | null; executions: { id: string }[] }[] }[];
    shipments: { id: string }[];
    deliveries: { id: string }[];
  };
  quotes: { id: string; status: string; solution: string | null; supplierCost: Money; supplierSrc: string | null; leadMinDays: number | null; leadMaxDays: number | null; promiseText: string | null; lines: { unitPrice: Money }[] }[];
  customerPos: { id: string; rejectedAt: Date | null; accepted: boolean }[];
  dispatchOrders: { id: string; deliveredAt: Date | null; cancelledAt: Date | null }[];
  /** ids of supplier orders whose confirmation has differences still to resolve */
  openConfirmations?: string[];
  done: { ship: boolean; deliver: boolean; invoice: boolean; cash: boolean; result: boolean };
};

export function stepNeeds(x: StepNeedsInput, t: (es: string, en: string) => string): StepNeed[] {
  const { deal: d, self } = x;
  const it = (ok: boolean, text: string, how: string | null, href: string | null, more: { go?: string; act?: "createQuote" } = {}): StepNeed => ({ ok, text, how: ok ? null : how, href: ok ? null : href, ...(ok ? {} : more) });
  // Every link lands on the exact place: a tab of the Need scrolls down to it (#fases = the row of tabs, or the block itself).
  const tabAt = (tab: string, at = "fases") => `${self}?tab=${tab}#${at}`;
  const openQuote = t("Abrir la cotización", "Open the quote");
  // What a draft quote still needs before it can be presented (the same list the quote shows under LISTA PARA PRESENTAR).
  const draftItems = (q: StepNeedsInput["quotes"][number]): StepNeed[] => {
    const miss = [
      q.lines.length === 0 && t("al menos un producto", "at least one product"),
      q.lines.some((l) => !(Number(l.unitPrice) > 0)) && t("el precio de cada producto", "the price of every product"),
      !(Number(q.supplierCost) > 0) && t("el costo del producto", "the product's cost"),
      !(q.leadMinDays != null && q.leadMaxDays != null) && t("el tiempo de entrega", "the lead time"),
    ].filter((v): v is string => !!v);
    return [it(miss.length === 0, t("La cotización completa", "The quote complete"), t(`Falta escribir: ${miss.join(", ")}. Todo se llena en un solo formulario, arriba en la cotización: «COMPLETA PARA PRESENTAR».`, `Still to write: ${miss.join(", ")}. It is all filled in on one form, at the top of the quote: “COMPLETE TO PRESENT”.`), `/cotizaciones/${q.id}#completar`, { go: t("Completar la cotización", "Complete the quote") })];
  };
  const prepare = { go: t("Preparar cotización", "Prepare quote"), act: "createQuote" as const };
  const draft = x.quotes.find((q) => q.status === "DRAFT");
  const shown = x.quotes.find((q) => q.status === "PRESENTED") ?? x.quotes.find((q) => q.status === "ACCEPTED");
  const livePo = x.customerPos.find((p) => !p.rejectedAt && !p.accepted) ?? x.customerPos.find((p) => p.accepted);
  // The order the later steps talk about: one already released and not yet received, before any other.
  const spo = d.supplierPos.find((p) => p.releasedAt && !p.receivedAt) ?? d.supplierPos.find((p) => p.releasedAt) ?? d.supplierPos[0];
  const pays = d.supplierPos.flatMap((p) => p.payments);

  switch (x.step) {
    case "need":
      return [it(!!d.desiredResult, t("El resultado que busca el cliente", "The result the customer wants"), t("Pestaña Necesidad → «Resultado deseado: qué quiere lograr el cliente» → Guardar necesidad", "Need tab → “Desired result: what the customer wants to achieve” → Save need"), `${self}?tab=need#resultado-deseado`)];
    case "source":
      return [it(d.supplierPos.length > 0 || Number(d.supplierCost) > 0 || !!d.sourcingNote, t("De dónde lo vamos a conseguir, o el costo del producto", "Where we will get it, or the product's cost"), t("Pestaña Fuente → escribe la fuente o el costo en «Liquidación de costos» → Guardar fuente", "Source tab → type the source or the cost under “Cost settlement” → Save source"), tabAt("source", "fuente"))];
    case "quote": {
      const q = draft ?? shown ?? null;
      const list: StepNeed[] = [
        it(d.items.length > 0 || x.quotes.length > 0, t("Al menos un producto en la Necesidad", "At least one product on the Need"), t("Pestaña Cotización → bloque PRODUCTOS → «Agregar producto» → Agregar", "Quote tab → PRODUCTS block → “Add product” → Add"), tabAt("quote", "productos")),
        it(x.quotes.length > 0, t("La cotización preparada", "The quote prepared"), d.items.length > 0 ? t("Haz clic en «Preparar cotización»: SOLU crea el documento con los productos y costos de la Necesidad", "Click “Prepare quote”: SOLU creates the document with the Need's products and costs") : t("Primero agrega un producto; después «Preparar cotización»", "Add a product first; then “Prepare quote”"), tabAt("quote", "cotizaciones"), d.items.length > 0 ? prepare : {}),
      ];
      if (draft && !shown) list.push(...draftItems(draft));
      list.push(it(!!d.quoteSentAt || !!shown, t("La cotización presentada al cliente", "The quote presented to the customer"), q ? t("En la cotización, cuando «LISTA PARA PRESENTAR» no tenga «!» → Presentar al cliente", "On the quote, once “READY TO PRESENT” has no “!” → Present to customer") : t("Primero prepara la cotización", "Prepare the quote first"), q ? `/cotizaciones/${q.id}#presentar` : null, { go: openQuote }));
      return list;
    }
    case "po": {
      const list: StepNeed[] = [];
      // The customer's PO is recorded on the presented quote. A Need can reach this step with the quote only "marked
      // as sent" (or moved on the board) and no presented quote document: then that document is what is missing first.
      const noDoc = !shown && x.customerPos.length === 0 && !d.poAcceptedAt;
      if (noDoc) {
        if (!draft) list.push(it(false, t("La cotización preparada en SOLU", "The quote prepared in SOLU"), t("La OC del cliente se registra sobre la cotización. Esta Necesidad figura como cotizada, pero no tiene el documento: créalo con este botón.", "The customer's PO is recorded on the quote. This Need shows as quoted, but it has no quote document: create it with this button."), tabAt("quote", "cotizaciones"), d.items.length > 0 ? prepare : { go: t("Ir a prepararla", "Go prepare it") }));
        else list.push(...draftItems(draft));
        list.push(it(false, t("La cotización presentada al cliente en SOLU", "The quote presented to the customer in SOLU"), draft ? t("La cotización está en borrador. En ella, cuando «LISTA PARA PRESENTAR» no tenga «!» → Presentar al cliente", "The quote is a draft. On it, once “READY TO PRESENT” has no “!” → Present to customer") : t("Después de prepararla: «LISTA PARA PRESENTAR» → Presentar al cliente", "After preparing it: “READY TO PRESENT” → Present to customer"), draft ? `/cotizaciones/${draft.id}#presentar` : null, { go: openQuote }));
      }
      list.push(
        it(x.customerPos.length > 0 || !!d.poAcceptedAt, t("La OC del cliente registrada", "The customer's PO recorded"), shown ? t("En la cotización presentada, bloque «EL CLIENTE RESPONDIÓ» → «Llegó la PO · registrarla» → Registrar y comparar", "On the presented quote, block “THE CUSTOMER ANSWERED” → “PO arrived · record it” → Record and compare") : t("Se registra en la cotización, cuando ya esté presentada", "It is recorded on the quote, once it has been presented"), shown ? `/cotizaciones/${shown.id}?abrir=po#respuesta` : null, { go: t("Registrar la OC", "Record the PO") }),
        it(d.account.creditLimit != null || !!d.poAcceptedAt, t("El cliente con cupo de crédito aprobado", "The customer with an approved credit limit"), t("En la OC → «Pedir revisión de cupo» (lo deciden Finanzas o Gerencia)", "On the PO → “Request a credit review” (Finance or Management decide)"), livePo ? `/po/${livePo.id}` : `/administracion/cupos`),
        it(!!d.poAcceptedAt, t("La OC aceptada", "The PO accepted"), livePo ? t("En la OC, cuando todas las precondiciones estén en verde → Aceptar PO", "On the PO, once every precondition is green → Accept PO") : t("Después de registrar la OC: en ella, cuando todas las precondiciones estén en verde → Aceptar PO", "After recording the PO: on it, once every precondition is green → Accept PO"), livePo ? `/po/${livePo.id}` : null, { go: t("Abrir la OC", "Open the PO") }),
      );
      return list;
    }
    case "purchase": {
      const orders = d.supplierPos;
      if (orders.length === 0) return [it(false, t("La orden de compra al proveedor preparada", "The supplier purchase order prepared"), t("Pestaña Ejecución → elige el proveedor → Preparar Supplier PO desde la cotización", "Execute tab → pick the supplier → Prepare Supplier PO from the quote"), tabAt("execute"), { go: t("Ir a prepararla", "Go prepare it") })];
      const many = orders.length > 1;
      const list: StepNeed[] = [it(true, many ? t(`${orders.length} órdenes de compra al proveedor en esta Necesidad`, `${orders.length} supplier purchase orders on this Need`) : t("La orden de compra al proveedor preparada", "The supplier purchase order prepared"), null, null)];
      // One line per order and per thing it still needs: the step is done only when EVERY order is released and confirmed.
      for (const o of orders) {
        const name = `${o.code} (${o.supplier.name})`, oh = `/compras/${o.id}`;
        if (!o.releasedAt) {
          list.push(it(false, t(`La orden ${name} liberada`, `Order ${name} released`),
            t(`Está en borrador. Ábrela: a la derecha, «LISTA PARA LIBERAR» dice qué falta y cada punto es un enlace; cuando no tenga pendientes → Liberar Supplier PO.${many ? " Si es un duplicado o no se va a usar, ábrela y, debajo del botón de liberar, usa «Descartar este borrador»: mientras exista, este paso la espera." : ""}`, `It is a draft. Open it: on the right, “RELEASE READINESS” says what is missing and each point is a link; once nothing is open → Release Supplier PO.${many ? " If it is a duplicate or will not be used, open it and, under the release button, use “Discard this draft”: while it exists, this step waits for it." : ""}`),
            oh, { go: t(`Abrir ${o.code}`, `Open ${o.code}`) }));
          continue;
        }
        if (o.confirmedAt) { list.push(it(true, t(`La orden ${name} liberada y confirmada por el proveedor`, `Order ${name} released and confirmed by the supplier`), null, null)); continue; }
        list.push(it(true, t(`La orden ${name} liberada`, `Order ${name} released`), null, null));
        if ((x.openConfirmations ?? []).includes(o.id)) list.push(it(false, t(`Las diferencias de la confirmación de ${name} resueltas`, `The differences in the confirmation of ${name} resolved`), t("El proveedor confirmó algo distinto a la orden. En la orden, bloque CONFIRMACIÓN DEL PROVEEDOR → escribe cómo se resuelven → Resolver y dar por confirmada", "The supplier confirmed something different from the order. On the order, SUPPLIER CONFIRMATION block → type how they are resolved → Resolve and count as confirmed"), `${oh}#confirmacion`, { go: t("Resolver diferencias", "Resolve differences") }));
        else list.push(it(false, t(`La orden ${name} confirmada por el proveedor`, `Order ${name} confirmed by the supplier`), t("Cuando el proveedor la acepte: en la orden, bloque CONFIRMACIÓN DEL PROVEEDOR → un clic en «El proveedor confirmó la orden tal cual». Si cambió algo, usa el formulario de ese mismo bloque.", "When the supplier accepts it: on the order, SUPPLIER CONFIRMATION block → one click on “The supplier confirmed the order as it is”. If they changed something, use the form in that same block."), `${oh}#confirmacion`, { go: t("Ir a confirmar", "Go confirm") }));
      }
      return list;
    }
    case "pay": {
      if (pays.length === 0) return [it(false, t("El pago al proveedor solicitado", "The supplier payment requested"), t("En la orden al proveedor, bloque PLAN DE PAGO → Solicitar este pago", "On the supplier order, PAYMENT PLAN block → Request this payment"), spo ? `/compras/${spo.id}#plan-pago` : null, { go: t("Ir al plan de pago", "Go to the payment plan") })];
      const list: StepNeed[] = [];
      // One line per payment, saying which of its stages comes next: requested → approved → sent → confirmed by the bank.
      for (const o of d.supplierPos) for (const p of o.payments) {
        const name = `${p.currency} ${Number(p.amount).toFixed(2)} · ${o.code}`, ph = `/administracion/pagos-proveedores/${p.id}`;
        if (p.executedAt) { list.push(it(true, t(`El pago de ${name} pagado y confirmado por el banco`, `The payment of ${name} paid and confirmed by the bank`), null, null)); continue; }
        list.push(it(true, t(`El pago de ${name} solicitado`, `The payment of ${name} requested`), null, null));
        if (!p.approvedAt) list.push(it(false, t(`El pago de ${name} aprobado`, `The payment of ${name} approved`), t("En el pago, a la derecha, SIGUIENTE PASO → Aprobar solicitud. Si SOLU pide verificar el banco, primero «Registrar verificación». Lo aprueba otra persona, o Gerencia.", "On the payment, on the right, NEXT STEP → Approve request. If SOLU asks to verify the bank, first “Record verification”. Another person approves it, or Management."), ph, { go: t("Abrir y aprobar", "Open and approve") }));
        else if (p.executions.length === 0) list.push(it(false, t(`La transferencia de ${name} enviada desde el banco`, `The transfer of ${name} sent from the bank`), t("Haz la transferencia en el banco. Después, en el pago → escribe la referencia del banco → Registrar ejecución", "Make the transfer at the bank. Then, on the payment → type the bank reference → Record execution"), ph, { go: t("Registrar ejecución", "Record execution") }));
        else list.push(it(false, t(`El banco confirmó que salió el dinero de ${name}`, `The bank confirmed the money of ${name} left`), t("Cuando el banco muestre el débito: en el pago → Confirmar: el dinero salió", "When the bank shows the debit: on the payment → Confirm: the money left"), ph, { go: t("Confirmar el pago", "Confirm the payment") }));
      }
      return list;
    }
    case "ship":
      return [
        it(d.shipments.length > 0 || x.done.ship, t("El envío del proveedor registrado", "The supplier's shipment recorded"), t("Pestaña Ejecución → «Registrar envío externo» (transportista, guía y fecha)", "Execute tab → “Record external shipment” (carrier, tracking and date)"), tabAt("execute")),
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
