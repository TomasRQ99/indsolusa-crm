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
  VALUE: { es: "Por valor de venta de cada Journey", en: "By sale value of each Journey" }, EQUAL: { es: "En partes iguales", en: "In equal parts" }, UNITS: { es: "Por unidades", en: "By units" }, MANUAL: { es: "A mano, con el motivo", en: "By hand, with the reason" },
};
export type Part = { id: string; sale: number; units: number; manual?: number | null };
/** Split a shared cost. The parts always add up to the total to the cent. Returns null when the method can't apply. */
export function splitShared(total: number, parts: Part[], method: string): { id: string; amount: number }[] | null {
  if (total <= 0 || parts.length < 2) return null;
  if (method === "MANUAL") {
    if (parts.some((p) => p.manual == null || p.manual < 0)) return null;
    return Math.abs(r2(parts.reduce((s, p) => s + p.manual!, 0)) - r2(total)) <= 0.005 ? parts.map((p) => ({ id: p.id, amount: r2(p.manual!) })) : null;
  }
  const w = parts.map((p) => (method === "UNITS" ? p.units : method === "EQUAL" ? 1 : p.sale));
  const sum = w.reduce((a, b) => a + b, 0);
  if (!(method === "VALUE" || method === "UNITS" || method === "EQUAL") || sum <= 0 || w.some((x) => x <= 0)) return null;
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

// ---------- Módulo 12 R0 · Eságara policy and closure readiness (§3, §8) ----------

export const ESAGARA_POLICY_KEY = "esagaraPolicy";
/** Which cost categories count towards Eságara, and below what difference a Journey is not kept open (§8). */
export type EsagaraPolicy = { counts: Record<Cat, boolean>; materialityUsd: number };
// Starting point: every direct-cost category counts and no difference is treated as immaterial. Gerencia changes it.
export const DEFAULT_ESAGARA_POLICY: EsagaraPolicy = { counts: { SUPPLIER: true, FREIGHT: true, DUTY: true, DELIVERY: true, BANK_FEE: true, TRAVEL: true, OTHER: true }, materialityUsd: 0 };
export function cleanEsagaraPolicy(raw: Record<string, unknown>): EsagaraPolicy | null {
  const m = Number(String(raw.materialityUsd ?? "").replace(",", "."));
  if (!Number.isFinite(m) || m < 0 || m > 1e6) return null;
  const counts = Object.fromEntries(CATS.map((c) => [c, raw[`c_${c}`] === "1" || raw[`c_${c}`] === true])) as Record<Cat, boolean>;
  // The supplier cost is what was bought to sell: an Eságara that ignores it would not be an Eságara.
  if (!counts.SUPPLIER) return null;
  return { counts, materialityUsd: Math.round(m * 100) / 100 };
}

export type ReadyIn = {
  hasQuote: boolean; supplierOrders: number; supplierOrdersUnreleased: number; shipments: number; shipmentsWithoutInvoice: number; intlWithoutDuties: number;
  unitsOrdered: number; unitsDelivered: number; deliveriesNotInvoiced: number; invoiced: number; openFreightClaims: number; openCustomerClaims: number; otherCurrency: number;
};
export type Criterion = { key: string; ok: boolean; text: Txt; fix: Txt };
/** §8 What must be known before the economics can be called final. Derived from facts; a person still decides. */
export function closureReadiness(i: ReadyIn): { criteria: Criterion[]; ready: boolean } {
  const c = (key: string, ok: boolean, es: string, en: string, fes: string, fen: string): Criterion => ({ key, ok, text: { es, en }, fix: { es: fes, en: fen } });
  const criteria = [
    c("quote", i.hasQuote, "Eságara protegida al aceptar la cotización", "Eságara protected when the quote was accepted", "Falta una cotización aceptada con su Eságara protegida", "An accepted quote with its protected Eságara is missing"),
    c("supplier", i.supplierOrdersUnreleased === 0, "Costos de proveedor registrados", "Supplier costs recorded", `${i.supplierOrdersUnreleased} compra(s) aún sin liberar`, `${i.supplierOrdersUnreleased} purchase(s) not released yet`),
    c("delivered", i.unitsOrdered > 0 && i.unitsDelivered >= i.unitsOrdered, "Todo entregado", "Everything delivered", `Entregadas ${i.unitsDelivered} de ${i.unitsOrdered} unidades`, `${i.unitsDelivered} of ${i.unitsOrdered} units delivered`),
    c("freight", i.shipmentsWithoutInvoice === 0, "Flete conocido", "Freight known", `${i.shipmentsWithoutInvoice} envío(s) sin la factura del transportador`, `${i.shipmentsWithoutInvoice} shipment(s) without the carrier invoice`),
    c("customs", i.intlWithoutDuties === 0, "Tributos de aduana conocidos", "Customs duties known", `${i.intlWithoutDuties} envío(s) internacional(es) sin tributos reales en su caso de aduana (si no hubo, registra 0)`, `${i.intlWithoutDuties} international shipment(s) without actual duties on the customs case (if there were none, record 0)`),
    c("revenue", i.invoiced > 0 && i.deliveriesNotInvoiced === 0, "Venta facturada", "Sale invoiced", i.invoiced > 0 ? `${i.deliveriesNotInvoiced} entrega(s) sin facturar` : "Aún no hay factura", i.invoiced > 0 ? `${i.deliveriesNotInvoiced} delivery(ies) not invoiced` : "No invoice yet"),
    c("claims", i.openFreightClaims === 0 && i.openCustomerClaims === 0, "Reclamos resueltos", "Claims resolved", `${i.openFreightClaims} reclamo(s) a transportador y ${i.openCustomerClaims} caso(s) de cliente abiertos`, `${i.openFreightClaims} carrier claim(s) and ${i.openCustomerClaims} customer case(s) open`),
    c("currency", i.otherCurrency === 0, "Sin costos en otra moneda por convertir", "No costs in another currency left to convert", `${i.otherCurrency} registro(s) en otra moneda sin su valor en USD`, `${i.otherCurrency} record(s) in another currency without their USD value`),
  ];
  return { criteria, ready: criteria.every((x) => x.ok) };
}

export const ECON_STATES: Record<string, Txt & { tone: string }> = {
  OPEN: { es: "Economía abierta", en: "Economically open", tone: "wait" }, SUBSTANTIAL: { es: "Sustancialmente completa", en: "Substantially complete", tone: "attn" }, FINAL: { es: "Final", en: "Final", tone: "ok" },
};
