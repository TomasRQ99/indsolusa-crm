// Operaciones O9b · withholdings (module 11 §42.3). Pure: no database.
// A withholding is money the customer keeps and pays to the tax authority on our behalf. It settles part of the
// invoice without ever being cash in the bank, so it is recorded apart from cash received and never mixed with it.

type Txt = { es: string; en: string };
export const WITHHOLDING_TYPES: Record<string, Txt> = {
  RETEFUENTE: { es: "Retención en la fuente", en: "Income tax withholding (retefuente)" },
  RETEICA: { es: "ReteICA", en: "Municipal tax withholding (reteICA)" },
  RETEIVA: { es: "ReteIVA", en: "VAT withholding (reteIVA)" },
  OTHER: { es: "Otra deducción autorizada", en: "Other authorised deduction" },
};
export type Applied = { amount: number; kind: string; reconciled: boolean };
/** §42.3 The four parts of an invoice, kept apart: cash in the bank, cash still to reconcile, withheld, outstanding. */
export function settlement(invoiceAmount: number, apps: Applied[]) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const sum = (f: (a: Applied) => boolean) => r(apps.filter(f).reduce((s, a) => s + a.amount, 0));
  const withheld = sum((a) => a.kind === "WITHHOLDING");
  const cash = sum((a) => a.kind !== "WITHHOLDING" && a.reconciled);
  const pending = sum((a) => a.kind !== "WITHHOLDING" && !a.reconciled);
  return { cash, pending, withheld, outstanding: Math.max(0, r(invoiceAmount - cash - pending - withheld)) };
}
/** A withholding can never exceed what the invoice still owes, and "other" must say what it is. */
export function withholdingProblem(w: { type: string; amount: number | null; note: string | null }, openBalance: number): "TYPE" | "AMOUNT" | "EXCEEDS" | "NOTE" | null {
  if (!WITHHOLDING_TYPES[w.type]) return "TYPE";
  if (w.amount == null || w.amount <= 0) return "AMOUNT";
  if (w.amount > openBalance + 0.005) return "EXCEEDS";
  if (w.type === "OTHER" && !w.note?.trim()) return "NOTE";
  return null;
}
