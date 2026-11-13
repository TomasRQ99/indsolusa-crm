import { lineAmount, sumMoney, type MoneyIn } from "./money";

// Operaciones O1 · Purchase Requirement rules (module 11 §4–6). Pure: no database.
// "Se compra para vender, ingresa para cumplir y sale hacia el cliente": every unit bought for resale is assigned to a
// Journey; whatever isn't assigned is Inventory Exposure and needs its own authorization (AC2).

type Txt = { es: string; en: string };
export const PR_RULES = "pr-v1";
export const PURPOSES: Record<string, Txt> = {
  CUSTOMER_FULFILLMENT: { es: "Para cumplir a un cliente", en: "To fulfil a customer" },
  INVENTORY: { es: "Para stock", en: "For stock" },
};
export const ITEM_TYPES: Record<string, Txt> = { PRODUCT: { es: "Producto", en: "Product" }, SERVICE: { es: "Servicio", en: "Service" }, MIXED: { es: "Mixto", en: "Mixed" } };
export const STOCK_STATUS: Record<string, Txt & { tone: string }> = {
  NONE: { es: "Sin pedir", en: "Not requested", tone: "wait" },
  REQUESTED: { es: "Esperando autorización", en: "Awaiting authorization", tone: "attn" },
  APPROVED: { es: "Autorizado", en: "Authorized", tone: "ok" },
  REJECTED: { es: "No autorizado", en: "Not authorized", tone: "risk" },
};

export type PrLineIn = { qty: number; expectedUnitCost: MoneyIn; code: string | null; manufacturer: string | null; description: string; allocations: { dealId: string; qty: number }[] };
export function lineSplit(l: PrLineIn) {
  const allocated = l.allocations.reduce((s, a) => s + a.qty, 0);
  return { allocated, unallocated: Math.max(0, l.qty - allocated), over: Math.max(0, allocated - l.qty) };
}
export function prTotals(lines: PrLineIn[]) {
  const split = lines.map(lineSplit);
  return {
    total: sumMoney(lines.map((l) => lineAmount(l.qty, l.expectedUnitCost))),
    allocatedAmount: sumMoney(lines.map((l, n) => lineAmount(Math.min(l.qty, split[n].allocated), l.expectedUnitCost))),
    unallocatedQty: split.reduce((s, x) => s + x.unallocated, 0),
    unallocatedAmount: sumMoney(lines.map((l, n) => lineAmount(split[n].unallocated, l.expectedUnitCost))),
    overQty: split.reduce((s, x) => s + x.over, 0),
  };
}

/** Interim authority (decision O-02, 2026-11-10): Finanzas ("Administración") or Gerencia decide, never the requester.
 *  The configurable matrix replaces this in O2. */
export const canDecideStock = (u: { id: string; role: string }, pr: { requesterId: string }) => u.id !== pr.requesterId && (u.role === "GERENCIA" || u.role === "FINANZAS");

export type Blocker = { key: string; blocker: Txt; impact: Txt; path: Txt; owner: Txt; evidence: Txt };
export type Readiness = { result: "READY_TO_PURCHASE" | "READY_WITH_APPROVED_EXCEPTION" | "NEEDS_RESOLUTION"; blockers: Blocker[]; notes: Txt[] };
export type PrIn = { purpose: string; dealId: string | null; supplierId: string | null; justification: string | null; stockStatus: string; stockQtyApproved: number | null; stockAmount: MoneyIn; lines: PrLineIn[] };
export type PrCtx = { today: Date; supplyValidUntil: Date | null; protectedCost: number | null; credit: { limit: number | null; exposure: number } | null };

const B = (key: string, blocker: [string, string], impact: [string, string], path: [string, string], owner: [string, string], evidence: [string, string]): Blocker =>
  ({ key, blocker: { es: blocker[0], en: blocker[1] }, impact: { es: impact[0], en: impact[1] }, path: { es: path[0], en: path[1] }, owner: { es: owner[0], en: owner[1] }, evidence: { es: evidence[0], en: evidence[1] } });
const BUYER: [string, string] = ["Quien compra", "The buyer"];
const APPROVER: [string, string] = ["Finanzas o Gerencia", "Finance or Management"];

/** §6 Purchase Readiness: a derived reading, never a manual checklist. Each blocker brings its key. */
export function prReadiness(pr: PrIn, ctx: PrCtx): Readiness {
  const out: Blocker[] = [];
  const notes: Txt[] = [];
  const tot = prTotals(pr.lines);
  if (pr.purpose === "CUSTOMER_FULFILLMENT" && !pr.dealId) out.push(B("purpose", ["Compra para cliente sin Necesidad", "Customer purchase without a Necessity"], ["No se sabe para qué venta se compra", "It isn't known which sale this is bought for"], ["Vincula la compra a su Necesidad, o cámbiala a compra para stock", "Link the purchase to its Necessity, or change it to a stock purchase"], BUYER, ["Necesidad con PO del cliente aceptada", "Necessity with an accepted customer PO"]));
  if (pr.purpose === "INVENTORY" && !pr.justification?.trim()) out.push(B("justification", ["Compra para stock sin justificación", "Stock purchase without a justification"], ["Compromete capital sin recuperación asegurada", "It commits capital with no assured recovery"], ["Escribe por qué conviene tener este stock", "Write why holding this stock makes sense"], BUYER, ["Motivo: mínimo del proveedor, precio, venta futura…", "Reason: supplier minimum, price, future sale…"]));
  if (!pr.lines.length || pr.lines.some((l) => l.qty <= 0)) out.push(B("qty", ["Hay líneas sin cantidad", "There are lines without a quantity"], ["No se puede pedir al proveedor", "It can't be ordered from the supplier"], ["Indica la cantidad exacta de cada línea", "Give the exact quantity of each line"], BUYER, ["Cantidad por línea", "Quantity per line"]));
  if (pr.lines.some((l) => !l.code?.trim() && !(l.manufacturer?.trim() && l.description.trim().length >= 8))) out.push(B("identity", ["Producto sin identificar con precisión", "Product not precisely identified"], ["Riesgo de comprar algo distinto a lo vendido", "Risk of buying something different from what was sold"], ["Completa la referencia exacta, o fabricante y descripción", "Complete the exact part number, or manufacturer and description"], BUYER, ["Referencia del fabricante", "Manufacturer part number"]));
  if (tot.overQty > 0) out.push(B("over", [`Se asignaron ${tot.overQty} unidades más de las que se compran`, `${tot.overQty} more units are assigned than are bought`], ["Alguna Necesidad quedaría sin producto", "Some Necessity would be left without product"], ["Sube la cantidad a comprar o reduce una asignación", "Raise the purchase quantity or reduce an assignment"], BUYER, ["Cantidades por Necesidad", "Quantities per Necessity"]));
  if (!pr.supplierId) out.push(B("supplier", ["Sin proveedor elegido", "No supplier chosen"], ["No hay a quién emitir la orden", "There's nobody to issue the order to"], ["Elige el proveedor de la fuente de suministro", "Choose the supplier from the supply basis"], BUYER, ["Oferta o cotización del proveedor", "Supplier offer or quote"]));
  if (ctx.supplyValidUntil && ctx.supplyValidUntil < ctx.today) out.push(B("freshness", ["La oferta del proveedor está vencida", "The supplier's offer has expired"], ["Precio y disponibilidad pueden haber cambiado", "Price and availability may have changed"], ["Pide al proveedor que la revalide antes de comprar", "Ask the supplier to revalidate it before buying"], BUYER, ["Confirmación vigente del proveedor", "Current confirmation from the supplier"]));

  // Inventory Exposure: units no Journey is waiting for (MOQ excess, or a stock purchase).
  const exposureQty = pr.purpose === "INVENTORY" ? pr.lines.reduce((s, l) => s + l.qty, 0) : tot.unallocatedQty;
  const exposureAmount = pr.purpose === "INVENTORY" ? tot.total : tot.unallocatedAmount;
  let approvedException = false;
  if (exposureQty > 0) {
    const covered = pr.stockStatus === "APPROVED" && (pr.stockQtyApproved ?? 0) >= exposureQty && Number(pr.stockAmount ?? 0) + 0.005 >= exposureAmount;
    if (covered) approvedException = true;
    else if (pr.stockStatus === "APPROVED") out.push(B("stock", ["El stock autorizado ya no cubre lo que se compra", "The authorized stock no longer covers what is being bought"], [`Hoy quedan ${exposureQty} unidades sin Necesidad`, `${exposureQty} units now have no Necessity`], ["Pide de nuevo la autorización con la cantidad actual", "Request the authorization again with the current quantity"], BUYER, ["Autorización por la cantidad y el valor actuales", "Authorization for the current quantity and value"]));
    else if (pr.stockStatus === "REQUESTED") out.push(B("stock", [`${exposureQty} unidades para stock esperan autorización`, `${exposureQty} units for stock await authorization`], ["Capital comprometido sin venta que lo respalde", "Capital committed with no sale behind it"], ["La decide Finanzas o Gerencia (no quien la pidió)", "Finance or Management decides it (not the requester)"], APPROVER, ["Decisión registrada", "Recorded decision"]));
    else if (pr.stockStatus === "REJECTED") out.push(B("stock", ["El stock no fue autorizado", "The stock was not authorized"], [`${exposureQty} unidades no tienen Necesidad ni autorización`, `${exposureQty} units have neither a Necessity nor authorization`], ["Reduce la cantidad, asígnala a una Necesidad, o vuelve a pedirla con más contexto", "Reduce the quantity, assign it to a Necessity, or request again with more context"], BUYER, ["Cantidad asignada o nueva solicitud", "Assigned quantity or a new request"]));
    else out.push(B("stock", [`${exposureQty} unidades no están asignadas a ninguna Necesidad`, `${exposureQty} units aren't assigned to any Necessity`], ["Quedarían como inventario: capital sin recuperación asegurada", "They would become inventory: capital with no assured recovery"], ["Asígnalas a una Necesidad o pide autorización para stock", "Assign them to a Necessity or request authorization for stock"], BUYER, ["Asignación o autorización", "Assignment or authorization"]));
  }

  if (ctx.protectedCost != null && ctx.protectedCost > 0 && tot.allocatedAmount > ctx.protectedCost + 0.005) notes.push({ es: `El costo previsto de lo asignado supera en USD ${(tot.allocatedAmount - ctx.protectedCost).toFixed(2)} el costo protegido de la cotización: la Eságara bajaría.`, en: `The expected cost of what is assigned is USD ${(tot.allocatedAmount - ctx.protectedCost).toFixed(2)} above the quote's protected cost: Eságara would drop.` });
  if (ctx.credit?.limit != null && ctx.credit.exposure > ctx.credit.limit) notes.push({ es: "El cliente ya supera su cupo de crédito: quien autorice debe verlo.", en: "The customer is already over its credit limit: whoever authorizes should see it." });
  return { result: out.length ? "NEEDS_RESOLUTION" : approvedException ? "READY_WITH_APPROVED_EXCEPTION" : "READY_TO_PURCHASE", blockers: out, notes };
}
export const exposureOf = (pr: Pick<PrIn, "purpose" | "lines">) => { const t = prTotals(pr.lines); return pr.purpose === "INVENTORY" ? { qty: pr.lines.reduce((s, l) => s + l.qty, 0), amount: t.total } : { qty: t.unallocatedQty, amount: t.unallocatedAmount }; };
