// Operaciones O9d · warranty and customer claims (module 11 §45.1). Pure: no database.

type Txt = { es: string; en: string };
export const CLAIM_KINDS: Record<string, Txt> = { WARRANTY: { es: "Garantía", en: "Warranty" }, RETURN: { es: "Devolución", en: "Return" }, COMPLAINT: { es: "Queja", en: "Complaint" } };
export const RESPONSIBLE: Record<string, Txt> = {
  UNKNOWN: { es: "Aún no se sabe", en: "Not known yet" }, SUPPLIER: { es: "Proveedor", en: "Supplier" }, COMPANY: { es: "Nosotros", en: "Us" }, CARRIER: { es: "Transportador", en: "Carrier" }, CUSTOMER: { es: "Cliente (uso o instalación)", en: "Customer (use or installation)" },
};
export const CLAIM_STATES: Record<string, Txt & { tone: string }> = { OPEN: { es: "Abierto", en: "Open", tone: "attn" }, RESOLVED: { es: "Resuelto", en: "Resolved", tone: "ok" }, REJECTED: { es: "No procede", en: "Not accepted", tone: "wait" } };

/** Last covered day: the start plus the months, clamped to the end of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function warrantyEnd(startsOn: Date, months: number): Date {
  const y = startsOn.getUTCFullYear(), m = startsOn.getUTCMonth() + months, d = startsOn.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last)));
}
export function warrantyState(startsOn: Date, months: number, on: Date) {
  const end = warrantyEnd(startsOn, months);
  const daysLeft = Math.floor((+end - +on) / 864e5);
  return { end, active: on >= startsOn && daysLeft >= 0, notStarted: on < startsOn, daysLeft };
}
/** Was the item covered on the day the customer reported the problem? The answer is a fact, not a decision to accept. */
export const coveredOn = (startsOn: Date, months: number, reportedAt: Date) => reportedAt >= startsOn && reportedAt <= warrantyEnd(startsOn, months);
/** A claim can't be closed without saying what was done and, when resolved, who was responsible. */
export function closeProblem(c: { status: string; resolution: string | null; responsible: string }): "RESOLUTION" | "RESPONSIBLE" | null {
  if (!c.resolution?.trim()) return "RESOLUTION";
  if (c.status === "RESOLVED" && (!RESPONSIBLE[c.responsible] || c.responsible === "UNKNOWN")) return "RESPONSIBLE";
  return null;
}
