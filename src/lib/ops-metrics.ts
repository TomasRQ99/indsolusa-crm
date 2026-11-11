import { db } from "./db";
import { addDays, today } from "./domain";
import { sumMoney } from "./money";

// Operaciones · metrics (module 11 §55–63). Every figure is counted from recorded facts and shows the count behind
// it; with fewer than MIN_SAMPLE cases it says so instead of showing a percentage. Nothing here is per person:
// these describe how the operation works, never who works how.

export const MIN_SAMPLE = 5;
type Txt = { es: string; en: string };
export type Metric = { key: string; label: Txt; kind: "RATIO" | "DAYS" | "MONEY" | "COUNT"; num?: number; den?: number; value?: number | null; n?: number; note?: Txt };
export type Group = { key: string; title: Txt; metrics: Metric[] };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const days = (a: Date, b: Date) => Math.max(0, Math.round((+b - +a) / 864e5));

export async function opsMetrics(windowDays = 365): Promise<{ since: Date; groups: Group[] }> {
  const since = addDays(today(), -windowDays);
  const [deals, orders, savings, approvals, commits, recLines, cinv, claims, customs, txs, finals, measured, exps, wClaims] = await Promise.all([
    db.deal.findMany({ where: { internal: false, deliveries: { some: { deliveredAt: { gte: since } } } }, select: { promisedDate: true, resultAchievedAt: true, items: { select: { qty: true } }, deliveries: { select: { deliveredAt: true, lines: { select: { qty: true } } } } } }),
    db.dispatchOrder.findMany({ where: { deliveredAt: { gte: since } }, select: { attempts: { select: { outcome: true } } } }),
    db.savingsEntry.findMany({ where: { at: { gte: since }, currency: "USD" }, select: { kind: true, savingsAmount: true } }),
    db.purchaseApproval.findMany({ where: { decidedAt: { gte: since } }, select: { requestedAt: true, decidedAt: true } }),
    db.supplierCommitment.findMany({ where: { status: "OCCURRED", occurredAt: { gte: since }, expectedDate: { not: null } }, select: { expectedDate: true, occurredAt: true } }),
    db.goodsReceiptLine.findMany({ where: { receipt: { receivedAt: { gte: since } } }, select: { exceptionKind: true } }),
    db.carrierInvoice.findMany({ where: { invoiceDate: { gte: since } }, select: { status: true } }),
    db.freightClaim.findMany({ where: { recoveredAt: { gte: since }, status: "RECOVERED" }, select: { recoveredAmount: true } }),
    db.customsCase.findMany({ where: { OR: [{ arrivedAt: { gte: since } }, { releasedAt: { gte: since } }] }, select: { arrivedAt: true, releasedAt: true, holdReason: true } }),
    db.bankTransaction.findMany({ where: { date: { gte: since } }, select: { amount: true, classifiedAs: true, matches: { select: { amount: true } } } }),
    db.deal.findMany({ where: { economicsState: "FINAL", economicsAt: { gte: since } }, select: { economicsFinal: true } }),
    db.logisticsObservation.count({ where: { observedAt: { gte: since }, status: { in: ["RECEIPT_MEASURED", "WAREHOUSE_MEASURED"] } } }),
    db.productExperience.findMany({ where: { createdAt: { gte: since } }, select: { eligibility: true, draft: true } }),
    db.customerClaim.findMany({ where: { reportedAt: { gte: since } }, select: { status: true } }),
  ]);
  const complete = deals.filter((d) => d.deliveries.flatMap((x) => x.lines).reduce((a, l) => a + l.qty, 0) >= d.items.reduce((a, x) => a + x.qty, 0) && d.items.length > 0);
  const withPromise = complete.filter((d) => d.promisedDate);
  const onTime = withPromise.filter((d) => Math.max(...d.deliveries.map((x) => +x.deliveredAt)) <= +d.promisedDate! + 864e5 - 1);
  const firstTime = orders.filter((o) => !o.attempts.some((a) => a.outcome === "FAILED"));
  const sv = (kinds: string[]) => sumMoney(savings.filter((s) => kinds.includes(s.kind)).map((s) => s.savingsAmount));
  const ready = commits.filter((c) => +c.occurredAt! <= +c.expectedDate! + 864e5 - 1);
  const cleared = customs.filter((c) => c.arrivedAt && c.releasedAt).map((c) => days(c.arrivedAt!, c.releasedAt!));
  const explained = txs.filter((x) => x.classifiedAs || sumMoney(x.matches.map((m) => m.amount)) >= Math.abs(Number(x.amount)) - 0.005);
  const fin = finals.map((d) => d.economicsFinal as unknown as { prot?: { esagara: number }; final?: { esagara: number } } | null).filter((x): x is { prot: { esagara: number }; final: { esagara: number } } => !!x?.prot && !!x?.final);
  const r = (key: string, es: string, en: string, num: number, den: number, note?: Txt): Metric => ({ key, label: { es, en }, kind: "RATIO", num, den, note });

  return { since, groups: [
    { key: "cumplimiento", title: { es: "Cumplimiento", en: "Fulfilment" }, metrics: [
      r("promise", "Promesa al cliente cumplida", "Customer promise achieved", onTime.length, withPromise.length, { es: "Journeys entregados completos, con fecha prometida", en: "Journeys delivered in full, with a promised date" }),
      r("complete", "Entrega completa", "Complete delivery", complete.length, deals.length, { es: "Journeys con alguna entrega en el periodo", en: "Journeys with any delivery in the period" }),
      r("first", "Entregado al primer intento", "Delivered at the first attempt", firstTime.length, orders.length, { es: "Despachos entregados", en: "Dispatch orders delivered" }),
      r("result", "Resultado del cliente confirmado", "Customer result confirmed", complete.filter((d) => d.resultAchievedAt).length, complete.length),
      r("claims", "Casos de clientes ya cerrados", "Customer cases already closed", wClaims.filter((c) => c.status !== "OPEN").length, wClaims.length),
    ] },
    { key: "compras", title: { es: "Compras", en: "Procurement" }, metrics: [
      { key: "approval", label: { es: "Tiempo de aprobación de una compra (mediana)", en: "Purchase approval time (median)" }, kind: "DAYS", value: median(approvals.map((a) => days(a.requestedAt, a.decidedAt!))), n: approvals.length },
      { key: "savings", label: { es: "Ahorros negociados con evidencia", en: "Negotiated savings with evidence" }, kind: "MONEY", value: sv(["SUPPLIER_SAVINGS", "FREIGHT_SAVINGS", "PAYMENT_SAVINGS", "LEGITIMATE_DUTY_REDUCTION", "ERROR_AVOIDANCE"]), n: savings.filter((s) => s.kind !== "CLAIM_RECOVERY").length },
    ] },
    { key: "proveedores", title: { es: "Proveedores", en: "Suppliers" }, metrics: [
      r("ready", "Compromisos del proveedor cumplidos en su fecha", "Supplier commitments met on their date", ready.length, commits.length),
      r("accuracy", "Líneas recibidas con el producto correcto", "Lines received with the right product", recLines.filter((l) => l.exceptionKind !== "IDENTITY").length, recLines.length),
      r("docs", "Líneas recibidas con documentos completos", "Lines received with complete documents", recLines.filter((l) => l.exceptionKind !== "DOCUMENTATION").length, recLines.length),
    ] },
    { key: "logistica", title: { es: "Logística", en: "Logistics" }, metrics: [
      r("billing", "Facturas de flete sin diferencia que revisar", "Freight invoices with no variance to review", cinv.filter((c) => ["MATCH", "WITHIN_TOLERANCE"].includes(c.status)).length, cinv.filter((c) => c.status !== "NOT_COMPARED").length, { es: "Solo las que se pudieron comparar", en: "Only those that could be compared" }),
      { key: "recovered", label: { es: "Recuperado de reclamos a transportadores", en: "Recovered from carrier claims" }, kind: "MONEY", value: sumMoney(claims.map((c) => c.recoveredAmount)), n: claims.length },
      r("damage", "Líneas recibidas sin daño", "Lines received undamaged", recLines.filter((l) => l.exceptionKind !== "CONDITION").length, recLines.length),
    ] },
    { key: "importacion", title: { es: "Importación", en: "Import" }, metrics: [
      { key: "clearance", label: { es: "Días en aduana (mediana)", en: "Days in customs (median)" }, kind: "DAYS", value: median(cleared), n: cleared.length },
      r("holds", "Casos de aduana sin retención", "Customs cases with no hold", customs.filter((c) => !c.holdReason).length, customs.length),
    ] },
    { key: "finanzas", title: { es: "Banco", en: "Bank" }, metrics: [
      r("matched", "Movimientos del banco ya explicados", "Bank movements already explained", explained.length, txs.length),
      { key: "unmatched", label: { es: "Movimientos por explicar", en: "Movements to explain" }, kind: "COUNT", value: txs.length - explained.length, n: txs.length },
    ] },
    { key: "rentabilidad", title: { es: "Rentabilidad", en: "Profitability" }, metrics: [
      { key: "final", label: { es: "Eságara final frente a la protegida (Journeys cerrados como final)", en: "Final Eságara vs protected (Journeys closed as final)" }, kind: "MONEY", value: fin.length ? sumMoney(fin.map((x) => x.final.esagara - x.prot.esagara)) : null, n: fin.length, note: { es: "Suma de las diferencias: positivo es mejor que lo protegido", en: "Sum of the differences: positive is better than protected" } },
    ] },
    { key: "conocimiento", title: { es: "Conocimiento", en: "Knowledge" }, metrics: [
      { key: "measured", label: { es: "Pesos y medidas reales tomados en bodega", en: "Real weights and sizes taken at the warehouse" }, kind: "COUNT", value: measured, n: measured },
      { key: "exp", label: { es: "Experiencias de producto registradas", en: "Product experiences recorded" }, kind: "COUNT", value: exps.length, n: exps.length },
      { key: "cand", label: { es: "Con borrador para la vitrina", en: "With a draft for the showcase" }, kind: "COUNT", value: exps.filter((e) => e.eligibility !== "INTERNAL_ONLY" && e.draft?.trim()).length, n: exps.length },
    ] },
  ] };
}
