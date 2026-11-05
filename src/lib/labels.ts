import type { DealStage } from "@prisma/client";
import type { I18n } from "./i18n";
import type { PaymentState } from "./domain";
import type { ReceivableState } from "./queries";
import type { HalfState } from "./commission";

export const STAGES: DealStage[] = ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

export function stageLabel(i: I18n, s: DealStage) {
  const map: Record<DealStage, [string, string]> = {
    LEAD: ["Necesidad", "Need"],
    QUALIFIED: ["Fuente encontrada", "Source found"],
    PROPOSAL: ["Cotizado", "Quoted"],
    NEGOTIATION: ["En negociación", "Negotiating"],
    WON: ["OC aceptada", "PO accepted"],
    LOST: ["No se dio", "Lost"],
  };
  return i.t(...map[s]);
}

export function receivableLabel(i: I18n, s: ReceivableState): { text: string; cls: string } {
  switch (s) {
    case "BROKEN": return { text: i.t("Compromiso incumplido", "Commitment missed"), cls: "missed" };
    case "NEEDS_ACTION": return { text: i.t("Requiere gestión", "Needs follow-up"), cls: "attn" };
    case "RECEIVED_PENDING": return { text: i.t("Pago recibido, por conciliar", "Payment received, to reconcile"), cls: "info" };
    case "WAITING": return { text: i.t("Esperando con control", "Waiting with control"), cls: "wait" };
    case "UPCOMING": return { text: i.t("Por vencer", "Not yet due"), cls: "ok" };
    default: return { text: i.t("Pagada", "Paid"), cls: "ok" };
  }
}

export function paymentStateLabel(i: I18n, s: PaymentState): { text: string; cls: string } {
  switch (s) {
    case "VERIFY": return { text: i.t("Requiere verificación independiente", "Needs independent verification"), cls: "risk" };
    case "APPROVE": return { text: i.t("Espera aprobación", "Awaiting approval"), cls: "attn" };
    case "EXECUTE": return { text: i.t("Aprobado · no enviado", "Approved · not sent"), cls: "info" };
    case "SENT": return { text: i.t("Enviado al banco · sin confirmar", "Sent to bank · not confirmed"), cls: "attn" };
    case "UNCERTAIN": return { text: i.t("Ejecución incierta", "Uncertain execution"), cls: "risk" };
    case "DONE": return { text: i.t("Pagado · confirmado", "Paid · confirmed"), cls: "ok" };
  }
}

export function blockerLabel(i: I18n, b: "RECEPTION_CODE" | "PO" | "PORTAL" | "POD" | "TAX") {
  const map = {
    RECEPTION_CODE: [i.t("Código de recepción", "Receipt code"), i.t("El cliente exige un código de recepción de mercancía para radicar la factura.", "The customer requires a goods-receipt code to accept the invoice.")],
    PO: [i.t("OC del cliente", "Customer PO"), i.t("Falta el número de OC del cliente en el Journey.", "The customer PO number is missing on the Journey.")],
    PORTAL: [i.t("Portal de proveedores", "Supplier portal"), i.t("La inscripción en el portal del cliente no está vigente.", "The registration on the customer's portal has expired.")],
    POD: [i.t("Prueba de entrega", "Proof of delivery"), i.t("Falta la remisión firmada (prueba de entrega).", "The signed delivery note (POD) is missing.")],
    TAX: [i.t("Datos tributarios", "Tax data"), i.t("Faltan datos tributarios del cliente para facturar.", "Customer tax data is incomplete.")],
  } as const;
  return { label: map[b][0], why: map[b][1] };
}

export function halfLabel(i: I18n, s: HalfState): { text: string; cls: string } {
  switch (s) {
    case "ESTIMATED": return { text: i.t("Estimada", "Estimated"), cls: "dash" };
    case "EARNED": return { text: i.t("Ganada", "Earned"), cls: "info" };
    case "APPROVED": return { text: i.t("Aprobada", "Approved"), cls: "ok" };
    case "PAID": return { text: i.t("Pagada", "Paid"), cls: "ok" };
    case "AT_RISK": return { text: i.t("En riesgo", "At risk"), cls: "attn" };
    default: return { text: i.t("No se gana", "Not earned"), cls: "wait" };
  }
}
