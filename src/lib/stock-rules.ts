// Operaciones O6 · goods receipt and stock (module 11 §34). Pure: no database.
// A receipt checks identity, condition and completeness, not only quantity. Anything in doubt is physically here but
// never available until someone resolves it.

type Txt = { es: string; en: string };
export const MAX_RECEIPT_PHOTOS = 8;
export const EXC_TEXT: Record<string, Txt> = {
  QUANTITY: { es: "Cantidad", en: "Quantity" }, IDENTITY: { es: "No es la referencia pedida", en: "Not the part ordered" }, CONDITION: { es: "Condición / daño", en: "Condition / damage" },
  COMPLETENESS: { es: "Incompleto (faltan componentes)", en: "Incomplete (components missing)" }, DOCUMENTATION: { es: "Faltan documentos", en: "Documents missing" },
};
export const LOT_STATES: Record<string, Txt & { tone: string; blocked: boolean }> = {
  COMMITTED: { es: "Comprometido a un Journey", en: "Committed to a Journey", tone: "info", blocked: false },
  AVAILABLE: { es: "Disponible", en: "Available", tone: "ok", blocked: false },
  RESERVED: { es: "Reservado", en: "Reserved", tone: "info", blocked: false },
  QUARANTINE: { es: "En cuarentena", en: "Quarantine", tone: "risk", blocked: true },
  DAMAGED: { es: "Dañado", en: "Damaged", tone: "risk", blocked: true },
  RETURN_PENDING: { es: "Por devolver al proveedor", en: "Return pending", tone: "attn", blocked: true },
};

export type LineIn = { qtyRemaining: number; qtyReceived: number; identityOk: boolean; conditionOk: boolean; completeOk: boolean; docsOk: boolean; lastDelivery: boolean };
/** First thing that failed, in order of how much it matters. A short quantity is only an exception when the
 *  supplier says nothing more is coming; otherwise it is a partial delivery with a balance. */
export function lineException(l: LineIn): string | null {
  if (!l.identityOk) return "IDENTITY";
  if (!l.conditionOk) return "CONDITION";
  if (!l.completeOk) return "COMPLETENESS";
  if (l.qtyReceived > l.qtyRemaining || (l.lastDelivery && l.qtyReceived < l.qtyRemaining)) return "QUANTITY";
  if (!l.docsOk) return "DOCUMENTATION";
  return null;
}
/** Product in doubt (identity, condition, completeness) goes to quarantine. A quantity or paperwork issue doesn't
 *  make the units themselves doubtful. */
export const quarantines = (kind: string | null) => kind === "IDENTITY" || kind === "CONDITION" || kind === "COMPLETENESS";

export type Alloc = { dealId: string; open: number };
/** Units received → lots. Clean units go first to the Journeys waiting for them, then to available stock. */
export function lotsFor(qtyReceived: number, kind: string | null, allocs: Alloc[]): { state: string; qty: number; dealId: string | null }[] {
  if (qtyReceived <= 0) return [];
  if (quarantines(kind)) return [{ state: "QUARANTINE", qty: qtyReceived, dealId: null }];
  const out: { state: string; qty: number; dealId: string | null }[] = [];
  let left = qtyReceived;
  for (const a of allocs) { const q = Math.min(left, Math.max(0, a.open)); if (q > 0) { out.push({ state: "COMMITTED", qty: q, dealId: a.dealId }); left -= q; } }
  if (left > 0) out.push({ state: "AVAILABLE", qty: left, dealId: null });
  return out;
}

export type LotIn = { code: string | null; description: string; locationId: string; qty: number; state: string; outAt: Date | null };
/** §34.3: physical, allocated and available are three different numbers. */
export function stockSummary(lots: LotIn[]) {
  const m = new Map<string, { code: string | null; description: string; locationId: string; physical: number; allocated: number; available: number; blocked: number }>();
  for (const l of lots.filter((x) => !x.outAt)) {
    const k = `${l.locationId}|${(l.code ?? l.description).toLowerCase()}`;
    const g = m.get(k) ?? { code: l.code, description: l.description, locationId: l.locationId, physical: 0, allocated: 0, available: 0, blocked: 0 };
    g.physical += l.qty;
    if (l.state === "COMMITTED" || l.state === "RESERVED") g.allocated += l.qty;
    else if (l.state === "AVAILABLE") g.available += l.qty;
    else g.blocked += l.qty;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => (a.code ?? a.description).localeCompare(b.code ?? b.description));
}
/** What a lot in doubt can become, always with a written reason. */
export const RESOLUTIONS = ["RELEASE", "DAMAGED", "RETURN_PENDING"] as const;
