// Operaciones O8b · High-Value Commitment Protection (module 11 v1.2 §45). Pure: no database.
// A high-value accepted Journey stays visible, with its promise, what is exposed, the next milestone, the risks in
// words and its owner, until it is closed both operationally and financially. No score.

type Txt = { es: string; en: string };
export type HvFacts = {
  purchases: number; unreleased: number; notReceived: number; nextSupplierEta: Date | null; hasStock: boolean;
  unitsOrdered: number; unitsDelivered: number; openDispatch: number; dispatchedNotDelivered: number;
  deliveries: number; deliveriesNotInvoiced: number; waitingEntry: number;
  invoiced: number; openBalance: number; overdueBalance: number;
  promise: Date | null; openExceptions: number;
};
export type Milestone = { key: "BUY" | "RELEASE" | "RECEIVE" | "DISPATCH" | "DELIVER" | "ENTRY" | "INVOICE" | "COLLECT" | "CLOSED"; text: Txt; due: Date | null };

export function hvClosure(f: HvFacts) {
  const operational = f.unitsOrdered > 0 && f.unitsDelivered >= f.unitsOrdered && f.openDispatch === 0;
  const financial = operational && f.deliveries > 0 && f.deliveriesNotInvoiced === 0 && f.invoiced > 0 && f.openBalance <= 0.005;
  return { operational, financial, closed: operational && financial };
}

/** The first thing that has not happened yet, in the order the work really flows. */
export function hvMilestone(f: HvFacts): Milestone {
  const m = (key: Milestone["key"], es: string, en: string, due: Date | null = null): Milestone => ({ key, text: { es, en }, due });
  const left = f.unitsOrdered - f.unitsDelivered;
  if (left > 0) {
    if (f.dispatchedNotDelivered > 0) return m("DELIVER", "Entregar al cliente lo que ya salió", "Deliver to the customer what already left", f.promise);
    if (f.openDispatch > 0) return m("DISPATCH", "Despachar al cliente", "Dispatch to the customer", f.promise);
    if (f.purchases === 0 && !f.hasStock) return m("BUY", "Comprar al proveedor", "Buy from the supplier");
    if (f.unreleased > 0) return m("RELEASE", "Liberar la compra al proveedor", "Release the purchase to the supplier");
    if (f.notReceived > 0) return m("RECEIVE", "Recibir del proveedor", "Receive from the supplier", f.nextSupplierEta);
    return m("DISPATCH", "Crear el despacho al cliente", "Create the dispatch to the customer", f.promise);
  }
  if (f.waitingEntry > 0) return m("ENTRY", "Conseguir la entrada de mercancía del cliente", "Get the customer's goods entry");
  if (f.deliveriesNotInvoiced > 0 || f.invoiced <= 0) return m("INVOICE", "Facturar lo entregado", "Invoice what was delivered");
  if (f.openBalance > 0.005) return m("COLLECT", "Cobrar la factura", "Collect the invoice");
  return m("CLOSED", "Cerrado", "Closed");
}

/** Risks as plain facts. An empty list means nothing material is known, not that nothing can happen. */
export function hvRisks(f: HvFacts, today: Date): Txt[] {
  const r: Txt[] = [];
  const left = f.unitsOrdered - f.unitsDelivered;
  if (f.promise && left > 0 && f.promise < today) r.push({ es: "La promesa al cliente ya pasó y falta entregar", en: "The customer promise has passed and delivery is pending" });
  else if (f.promise && left > 0 && f.nextSupplierEta && f.nextSupplierEta > f.promise) r.push({ es: "El proveedor entrega después de la promesa al cliente", en: "The supplier delivers after the customer promise" });
  if (!f.promise && left > 0) r.push({ es: "Sin fecha prometida al cliente", en: "No date promised to the customer" });
  if (f.openExceptions > 0) r.push({ es: `${f.openExceptions} excepción(es) abierta(s)`, en: `${f.openExceptions} open exception(s)` });
  if (f.overdueBalance > 0.005) r.push({ es: "Factura vencida sin cobrar", en: "Invoice overdue and unpaid" });
  if (f.waitingEntry > 0) r.push({ es: "Entregado sin entrada de mercancía del cliente: no se puede facturar", en: "Delivered without the customer's goods entry: can't invoice" });
  return r;
}
