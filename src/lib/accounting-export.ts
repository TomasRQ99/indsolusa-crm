import { db } from "./db";
import { csvNum } from "./report-csv";

// Módulo 14 §2J, AC19 · Accounting interface. SOLU does not replace the accounting system: it hands over reliable
// operational facts as files. Reading only: an export never changes an invoice, a payment or a cost, and it never
// marks anything as "sent to accounting" (that stays the invoice's own controlled bridge).

type Txt = { es: string; en: string };
export const EXPORT_KINDS: Record<string, Txt & { noteEs: string; noteEn: string }> = {
  CUSTOMER_INVOICES: { es: "Facturas a clientes", en: "Customer invoices", noteEs: "Por fecha de emisión. Valor en USD antes de impuestos; el total legal cuando la factura se emitió fuera de SOLU.", noteEn: "By issue date. USD value before tax; the legal total when the invoice was issued outside SOLU." },
  SUPPLIER_INVOICES: { es: "Facturas de proveedores", en: "Supplier invoices", noteEs: "Por fecha de la factura, con su orden o compra interna.", noteEn: "By invoice date, with its order or internal purchase." },
  RECEIPTS: { es: "Dinero recibido de clientes y retenciones", en: "Cash received from customers and withholdings", noteEs: "Por fecha de recibo. Una fila por cada factura a la que se aplicó.", noteEn: "By date received. One row per invoice it was applied to." },
  PAYMENTS: { es: "Pagos hechos a proveedores", en: "Payments made to suppliers", noteEs: "Solo pagos confirmados por el banco, por la fecha en que se enviaron.", noteEn: "Only payments confirmed by the bank, by the date they were sent." },
  COSTS: { es: "Costos asignados a Necesidades", en: "Costs allocated to Necessities", noteEs: "Costos reales registrados en el libro de costos, con su método de reparto.", noteEn: "Real costs recorded in the cost ledger, with their split method." },
  ASSETS: { es: "Movimientos de activos", en: "Asset movements", noteEs: "Compras, bajas y costos de mantenimiento de activos.", noteEn: "Acquisitions, disposals and maintenance costs of assets." },
};
const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
const n = (x: unknown) => (x == null ? "" : csvNum(Number(x)));
type Out = { header: string[]; rows: (string | number | null)[][] };

export async function accountingRows(kind: string, from: Date, to: Date): Promise<Out | null> {
  const range = { gte: from, lte: to };
  if (kind === "CUSTOMER_INVOICES") {
    const xs = await db.invoice.findMany({ where: { issuedAt: range }, orderBy: { issuedAt: "asc" }, select: { number: true, issuedAt: true, dueAt: true, amount: true, external: true, docCurrency: true, docTotal: true, externalSystem: true, externalId: true, syncState: true, partial: true, account: { select: { name: true, taxId: true } }, deal: { select: { code: true, sellerKey: true } } } });
    return { header: ["Número", "Emitida", "Vence", "Cliente", "NIT / Tax ID", "Necesidad", "Empresa que vende", "Valor USD antes de impuestos", "Moneda legal", "Total legal", "Emitida fuera de SOLU", "Parcial", "Sistema contable", "ID contable", "Estado del puente contable"], rows: xs.map((x) => [x.number, d(x.issuedAt), d(x.dueAt), x.account.name, x.account.taxId ?? "", x.deal.code ?? "", x.deal.sellerKey, n(x.amount), x.docCurrency ?? "", n(x.docTotal), x.external ? "sí" : "no", x.partial ? "sí" : "no", x.externalSystem ?? "", x.externalId ?? "", x.syncState]) };
  }
  if (kind === "SUPPLIER_INVOICES") {
    const xs = await db.supplierInvoice.findMany({ where: { invoiceDate: range }, orderBy: { invoiceDate: "asc" }, select: { number: true, kind: true, invoiceDate: true, dueAt: true, receivedAt: true, amount: true, currency: true, amountUsd: true, paidAt: true, paidRef: true, exceptionNote: true, supplier: { select: { name: true, taxId: true } }, supplierPo: { select: { code: true, deal: { select: { code: true } } } }, internalPurchase: { select: { code: true, purpose: true } } } });
    return { header: ["Proveedor", "NIT / Tax ID", "Número", "Tipo", "Fecha", "Vence", "Recibida", "Valor", "Moneda", "Valor USD", "Orden", "Necesidad", "Compra interna", "Propósito", "Pagada", "Referencia de pago", "Diferencia aceptada"], rows: xs.map((x) => [x.supplier.name, x.supplier.taxId ?? "", x.number, x.kind, d(x.invoiceDate), d(x.dueAt), d(x.receivedAt), n(x.amount), x.currency, n(x.amountUsd), x.supplierPo?.code ?? "", x.supplierPo?.deal.code ?? "", x.internalPurchase?.code ?? "", x.internalPurchase?.purpose ?? "", d(x.paidAt), x.paidRef ?? "", x.exceptionNote ?? ""]) };
  }
  if (kind === "RECEIPTS") {
    const xs = await db.customerPayment.findMany({ where: { receivedAt: range }, orderBy: { receivedAt: "asc" }, select: { id: true, amount: true, receivedAt: true, reference: true, reconciledAt: true, kind: true, withholdingType: true, certificate: true, residualNote: true, account: { select: { name: true, taxId: true } }, applications: { select: { amount: true, invoice: { select: { number: true } } } } } });
    const rows: Out["rows"] = [];
    for (const x of xs) {
      const base = [d(x.receivedAt), x.account.name, x.account.taxId ?? "", x.kind === "WITHHOLDING" ? "Retención" : "Dinero", x.withholdingType ?? "", x.certificate ?? "", n(x.amount), x.reference ?? "", d(x.reconciledAt)];
      if (x.applications.length === 0) rows.push([...base, "", "", x.residualNote ?? "Sin aplicar"]);
      for (const a of x.applications) rows.push([...base, a.invoice.number, n(a.amount), ""]);
    }
    return { header: ["Recibido", "Cliente", "NIT / Tax ID", "Qué es", "Tipo de retención", "Certificado", "Valor total USD", "Referencia", "Conciliado", "Factura", "Aplicado a la factura USD", "Nota"], rows };
  }
  if (kind === "PAYMENTS") {
    const [xs, own] = await Promise.all([
      db.paymentExecution.findMany({ where: { state: "CONFIRMED", sentAt: range }, orderBy: { sentAt: "asc" }, select: { amount: true, sentAt: true, bankRef: true, method: true, feeUsd: true, fxRate: true, resolvedAt: true, payment: { select: { currency: true, amountUsd: true, reason: true, supplierPo: { select: { code: true, supplier: { select: { name: true, taxId: true } }, deal: { select: { code: true } } } } } } } }),
      db.supplierInvoice.findMany({ where: { paidAt: range, supplierPoId: null }, orderBy: { paidAt: "asc" }, select: { number: true, amount: true, currency: true, amountUsd: true, paidAt: true, paidRef: true, supplier: { select: { name: true, taxId: true } }, internalPurchase: { select: { code: true } } } }),
    ]);
    return { header: ["Enviado", "Proveedor", "NIT / Tax ID", "Orden o compra", "Necesidad", "Concepto", "Valor", "Moneda", "Valor USD", "Referencia del banco", "Método", "Comisión bancaria USD", "Tasa de cambio", "Confirmado"], rows: [
      ...xs.map((x) => [d(x.sentAt), x.payment.supplierPo.supplier.name, x.payment.supplierPo.supplier.taxId ?? "", x.payment.supplierPo.code, x.payment.supplierPo.deal.code ?? "", x.payment.reason, n(x.amount), x.payment.currency, n(x.payment.amountUsd), x.bankRef ?? "", x.method ?? "", n(x.feeUsd), x.fxRate == null ? "" : String(x.fxRate), d(x.resolvedAt)]),
      ...own.map((x) => [d(x.paidAt), x.supplier.name, x.supplier.taxId ?? "", x.internalPurchase?.code ?? "", "", `Factura ${x.number}`, n(x.amount), x.currency, n(x.amountUsd), x.paidRef ?? "", "", "", "", d(x.paidAt)]),
    ] };
  }
  if (kind === "COSTS") {
    const xs = await db.dealCost.findMany({ where: { spentOn: range }, orderBy: { spentOn: "asc" }, select: { category: true, amount: true, description: true, evidence: true, spentOn: true, sharedTotal: true, splitMethod: true, splitNote: true, createdByName: true, deal: { select: { code: true, account: { select: { name: true } } } } } });
    return { header: ["Fecha", "Necesidad", "Cliente", "Categoría", "Valor USD", "Descripción", "Soporte", "Total compartido USD", "Método de reparto", "Nota del reparto", "Registró"], rows: xs.map((x) => [d(x.spentOn), x.deal.code ?? "", x.deal.account.name, x.category, n(x.amount), x.description, x.evidence ?? "", n(x.sharedTotal), x.splitMethod ?? "", x.splitNote ?? "", x.createdByName]) };
  }
  if (kind === "ASSETS") {
    const xs = await db.assetEvent.findMany({ where: { at: range, kind: { in: ["ACQUIRED", "DISPOSED", "MAINTENANCE", "INSURANCE"] } }, orderBy: { at: "asc" }, select: { kind: true, at: true, costUsd: true, note: true, evidence: true, byName: true, asset: { select: { code: true, name: true, category: true, legalOwner: true, value: true, currency: true } } } });
    return { header: ["Fecha", "Activo", "Nombre", "Tipo", "Empresa dueña", "Movimiento", "Valor del activo", "Moneda", "Costo del movimiento USD", "Nota", "Soporte", "Registró"], rows: xs.map((x) => [d(x.at), x.asset.code, x.asset.name, x.asset.category, x.asset.legalOwner, x.kind, x.kind === "ACQUIRED" || x.kind === "DISPOSED" ? n(x.asset.value) : "", x.asset.currency, n(x.costUsd), x.note ?? "", x.evidence ?? "", x.byName]) };
  }
  return null;
}
