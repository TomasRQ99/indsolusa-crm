import { db } from "./db";
import { today } from "./domain";
import { getFinanceRate } from "./financing";
import { loadCredit } from "./queries";
import { termDays } from "./pdf-docs";
import { saleOf } from "./quote";
import { confirmedAtOf } from "./supply";
import { REVALIDATE_DAYS, freshnessOf } from "./supply-rules";
import type { AcceptCtx, PoFull } from "./po";

// Comercial C6 §23 · what must be true again when the PO is accepted. Read fresh every time (page and command),
// so a check that was green yesterday can turn red today. Nothing here writes.

const DAY = 864e5;

export async function acceptCtx(po: PoFull): Promise<AcceptCtx> {
  const now = today();
  const q = po.quote;
  const [basis, credit, rate] = await Promise.all([
    db.supplyBasis.findFirst({ where: { dealId: po.dealId, supersededAt: null }, include: { primary: { select: { label: true, validUntil: true, evidence: true, createdAt: true, importFeasibility: true, importNote: true, supplier: { select: { name: true } } } } } }),
    loadCredit({ id: po.deal.accountId }),
    getFinanceRate(),
  ]);

  // ---- Stock / price (C-12: 7 days; the offer's own validity date wins) ----
  let supply: AcceptCtx["supply"];
  const reval = po.supplyRevalidatedAt && now.getTime() - po.supplyRevalidatedAt.getTime() <= REVALIDATE_DAYS * DAY ? po.supplyRevalidatedAt : null;
  if (reval) {
    supply = { ok: true, text: { es: `Stock y precio revalidados el ${reval.toISOString().slice(0, 10)} por ${po.supplyRevalidatedBy}: ${po.supplyRevalidation}`, en: `Stock and price re-confirmed on ${reval.toISOString().slice(0, 10)} by ${po.supplyRevalidatedBy}: ${po.supplyRevalidation}` } };
  } else if (basis) {
    const f = freshnessOf({ validUntil: basis.primary.validUntil, confirmedAt: confirmedAtOf(basis.primary) }, now);
    supply = { ok: f.ok, text: { es: `Stock y precio de la base de suministro: ${f.why.es}`, en: `Supply basis stock and price: ${f.why.en}` } };
  } else if (q) {
    const age = q.presentedAt ? Math.floor((now.getTime() - q.presentedAt.getTime()) / DAY) : null;
    const validOk = !q.supplierValidUntil || q.supplierValidUntil.getTime() >= now.getTime() - DAY / 2;
    const ok = q.supplyConfirmed && validOk && age != null && age <= REVALIDATE_DAYS;
    supply = { ok, text: ok
      ? { es: `Disponibilidad confirmada al presentar (hace ${age} día(s))`, en: `Availability confirmed at presenting (${age} day(s) ago)` }
      : { es: `Stock y precio sin confirmar en los últimos ${REVALIDATE_DAYS} días${!validOk ? " (la vigencia del proveedor venció)" : ""}: revalídalos con el proveedor`, en: `Stock and price not confirmed in the last ${REVALIDATE_DAYS} days${!validOk ? " (supplier validity expired)" : ""}: re-confirm with the supplier` } };
  } else supply = null;

  // ---- Credit (decided only by Finanzas / Gerencia; Comercial requests) ----
  const a = credit[0];
  const poTotal = saleOf(po.lines);
  const prepaid = termDays(po.paymentTerms, termDays(q?.paymentTerms)) === 0;
  let creditChk: AcceptCtx["credit"];
  if (prepaid) creditChk = { ok: true, text: { es: "Pago anticipado: no usa cupo de crédito", en: "Prepaid: doesn't use the credit limit" } };
  else if (po.deal.creditExceptionAt) creditChk = { ok: true, text: { es: `Excepción de crédito aprobada${po.deal.creditExceptionNote ? `: ${po.deal.creditExceptionNote}` : ""}`, en: `Credit exception approved${po.deal.creditExceptionNote ? `: ${po.deal.creditExceptionNote}` : ""}` } };
  else if (!a || a.limit == null) creditChk = { ok: false, text: { es: "El cliente no tiene cupo de crédito aprobado: pide la revisión (la deciden Finanzas o Gerencia)", en: "The customer has no approved credit limit: request a review (Finance or Management decide)" } };
  else {
    // Exposure today (open invoices + won not invoiced) plus this PO, unless this Journey is already counted.
    const counted = po.deal.stage === "WON";
    const after = a.used + (counted ? 0 : poTotal);
    const ok = after <= a.limit + 0.005;
    creditChk = { ok, text: ok
      ? { es: `Cupo suficiente: quedaría en uso USD ${after.toFixed(2)} de ${a.limit.toFixed(2)}${a.overdueCount ? ` · ${a.overdueCount} factura(s) vencida(s)` : ""}`, en: `Enough credit: USD ${after.toFixed(2)} of ${a.limit.toFixed(2)} would be in use${a.overdueCount ? ` · ${a.overdueCount} overdue invoice(s)` : ""}` }
      : { es: `Supera el cupo: USD ${after.toFixed(2)} contra ${a.limit.toFixed(2)}. Pide revisión de cupo o una excepción (Finanzas o Gerencia)`, en: `Over the limit: USD ${after.toFixed(2)} vs ${a.limit.toFixed(2)}. Request a limit review or an exception (Finance or Management)` } };
  }

  // ---- Import / compliance of the chosen supply ----
  let importFeas: AcceptCtx["importFeas"] = null;
  if (basis) {
    const f = basis.primary.importFeasibility;
    importFeas = f === "BLOCKED"
      ? { ok: false, text: { es: `Importación bloqueada para la opción elegida${basis.primary.importNote ? `: ${basis.primary.importNote}` : ""}`, en: `Import blocked for the chosen option${basis.primary.importNote ? `: ${basis.primary.importNote}` : ""}` } }
      : f === "NEEDS_REVIEW"
        ? { ok: false, text: { es: "La importación de la opción elegida está «por revisar»: confírmala en Abastecimiento", en: "The chosen option's import is “needs review”: confirm it in Sourcing" } }
        : { ok: true, text: f === "CONFIRMED" ? { es: "Importación confirmada", en: "Import confirmed" } : { es: `Importación condicional, con supuestos declarados${basis.primary.importNote ? `: ${basis.primary.importNote}` : ""}`, en: `Import conditional, assumptions stated${basis.primary.importNote ? `: ${basis.primary.importNote}` : ""}` } };
  }

  return { supply, credit: creditChk, importFeas, annualPct: rate.annualPct, accountTaxId: po.deal.account.taxId, accountName: po.deal.account.name };
}
