// Operaciones O9c · protected vs expected vs final economics (module 11 §43.1, §44). Pure: no database.
// Eságara is always shown in $ and %. The bridge explains why it moved, line by line, and its lines add up exactly
// to the difference: nothing is left unexplained and nothing is invented.

type Txt = { es: string; en: string };
const r2 = (n: number) => Math.round(n * 100) / 100;

export const COST_CATS: Record<string, Txt> = {
  SUPPLIER: { es: "Proveedor", en: "Supplier" }, FREIGHT: { es: "Flete", en: "Freight" }, DUTY: { es: "Aduana y tributos", en: "Customs and duties" },
  DELIVERY: { es: "Entrega al cliente", en: "Delivery to customer" }, BANK_FEE: { es: "Cargos del banco", en: "Bank fees" }, TRAVEL: { es: "Viajes", en: "Travel" }, OTHER: { es: "Otros", en: "Other" },
};
export type Cat = "SUPPLIER" | "FREIGHT" | "DUTY" | "DELIVERY" | "BANK_FEE" | "TRAVEL" | "OTHER";
export const CATS = Object.keys(COST_CATS) as Cat[];
export type Costs = Record<Cat, number>;
export const zeroCosts = (): Costs => ({ SUPPLIER: 0, FREIGHT: 0, DUTY: 0, DELIVERY: 0, BANK_FEE: 0, TRAVEL: 0, OTHER: 0 });

// ---------- shared costs (§43.1) ----------

export const SPLIT_METHODS: Record<string, Txt> = {
  VALUE: { es: "Por valor de venta de cada Journey", en: "By sale value of each Journey" }, UNITS: { es: "Por unidades", en: "By units" }, MANUAL: { es: "A mano, con el motivo", en: "By hand, with the reason" },
};
export type Part = { id: string; sale: number; units: number; manual?: number | null };
/** Split a shared cost. The parts always add up to the total to the cent. Returns null when the method can't apply. */
export function splitShared(total: number, parts: Part[], method: string): { id: string; amount: number }[] | null {
  if (total <= 0 || parts.length < 2) return null;
  if (method === "MANUAL") {
    if (parts.some((p) => p.manual == null || p.manual < 0)) return null;
    return Math.abs(r2(parts.reduce((s, p) => s + p.manual!, 0)) - r2(total)) <= 0.005 ? parts.map((p) => ({ id: p.id, amount: r2(p.manual!) })) : null;
  }
  const w = parts.map((p) => (method === "UNITS" ? p.units : p.sale));
  const sum = w.reduce((a, b) => a + b, 0);
  if (!(method === "VALUE" || method === "UNITS") || sum <= 0 || w.some((x) => x <= 0)) return null;
  const out = parts.map((p, k) => ({ id: p.id, amount: r2((total * w[k]) / sum) }));
  // Rounding leftovers go to the largest part, so the split matches the invoice exactly.
  const diff = r2(total - out.reduce((s, x) => s + x.amount, 0));
  if (diff) { const big = out.reduce((a, b) => (b.amount > a.amount ? b : a)); big.amount = r2(big.amount + diff); }
  return out;
}

// ---------- three views and the bridge (§44) ----------

export type EconIn = {
  protSale: number; protSupplier: number; protFreight: number; protOther: number;
  invoiced: number | null;
  /** facts recorded so far, by category */
  facts: Costs;
  /** which categories already have at least one fact */
  known: Record<Cat, boolean>;
  claimRecovered: number;
};
export type View = { sale: number; cost: number; esagara: number; pct: number | null };
export type BridgeLine = { key: "REVENUE" | Cat | "CLAIM"; text: Txt; usd: number; pp: number | null };
const view = (sale: number, cost: number): View => ({ sale: r2(sale), cost: r2(cost), esagara: r2(sale - cost), pct: sale > 0 ? Math.round(((sale - cost) / sale) * 1000) / 10 : null });

export function economics(e: EconIn) {
  const protCost = r2(e.protSupplier + e.protFreight + e.protOther);
  const prot = view(e.protSale, protCost);
  // Expected today: every fact we already have replaces its estimate; what has no fact yet keeps the estimate.
  const sale = e.invoiced != null && e.invoiced > 0 ? e.invoiced : e.protSale;
  const supplier = e.known.SUPPLIER ? e.facts.SUPPLIER : e.protSupplier;
  const freight = e.known.FREIGHT ? e.facts.FREIGHT : e.protFreight;
  const otherCats: Cat[] = ["DUTY", "DELIVERY", "BANK_FEE", "TRAVEL", "OTHER"];
  const otherFacts = r2(otherCats.reduce((s, c) => s + e.facts[c], 0));
  const otherKnown = otherCats.some((c) => e.known[c]);
  // The quote has one "other costs" figure: once real ones exist, the larger of both is expected (facts never shrink an estimate still open).
  const other = otherKnown ? Math.max(otherFacts, 0) : e.protOther;
  const expected = view(sale, r2(supplier + freight + other - e.claimRecovered));
  const factsCost = r2(CATS.reduce((s, c) => s + e.facts[c], 0) - e.claimRecovered);
  const facts = e.invoiced != null && e.invoiced > 0 ? view(e.invoiced, factsCost) : null;

  const pp = (usd: number) => (e.protSale > 0 ? Math.round((usd / e.protSale) * 1000) / 10 : null);
  const lines: BridgeLine[] = [];
  const add = (key: BridgeLine["key"], es: string, en: string, usd: number) => { if (Math.abs(usd) > 0.005) lines.push({ key, text: { es, en }, usd: r2(usd), pp: pp(usd) }); };
  add("REVENUE", "Venta facturada frente a la protegida", "Invoiced sale vs protected", sale - e.protSale);
  add("SUPPLIER", "Costo del proveedor", "Supplier cost", -(supplier - e.protSupplier));
  add("FREIGHT", "Flete", "Freight", -(freight - e.protFreight));
  if (otherKnown) {
    // Each real "other" cost is its own line; the estimate they replace is given back in one line.
    for (const c of otherCats) add(c, COST_CATS[c].es, COST_CATS[c].en, -e.facts[c]);
    add("OTHER", "Otros costos estimados en la cotización (ya reemplazados por los reales)", "Other costs estimated on the quote (now replaced by the real ones)", e.protOther);
  }
  add("CLAIM", "Recuperado de reclamos a transportadores", "Recovered from carrier claims", e.claimRecovered);
  const explained = r2(lines.reduce((s, l) => s + l.usd, 0));
  return { prot, expected, facts, lines, explained, gap: r2(expected.esagara - prot.esagara) };
}

export const ECON_STATES: Record<string, Txt & { tone: string }> = {
  OPEN: { es: "Economía abierta", en: "Economically open", tone: "wait" }, SUBSTANTIAL: { es: "Sustancialmente completa", en: "Substantially complete", tone: "attn" }, FINAL: { es: "Final", en: "Final", tone: "ok" },
};
