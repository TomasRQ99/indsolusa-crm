// Comercial C4 · Sourcing & Supply (§6–13). Pure rules: no database, no dates from the clock unless passed in.
// Formula/rules version shown on screen so a number can always be traced.
export const SUPPLY_RULES = "supply-v1";

type L = { es: string; en: string };
const DAY = 86_400_000;

// ---------- §7 RFQ: ask only what matters, and say why ----------

export type AskLevel = "CRITICAL_TO_SOURCE" | "NEEDED_BEFORE_QUOTE" | "NEEDED_BEFORE_PURCHASE_IMPORT" | "OPTIONAL";
export const ASK_LEVEL: Record<AskLevel, L> = {
  CRITICAL_TO_SOURCE: { es: "Necesario para cotizar la fuente", en: "Needed to source" },
  NEEDED_BEFORE_QUOTE: { es: "Antes de cotizar al cliente", en: "Before quoting the customer" },
  NEEDED_BEFORE_PURCHASE_IMPORT: { es: "Antes de comprar / importar", en: "Before buying / importing" },
  OPTIONAL: { es: "Opcional", en: "Optional" },
};

/** The company RFQ template already asks price, availability, payment options and weight/box (E1). These are extra. */
export const RFQ_ASKS = {
  STOCK: { es: "Stock físico y dónde está", en: "Physical stock and location", mail: { en: "Quantity physically in stock and where it is located", es: "Cantidad disponible físicamente y dónde está" } },
  VALIDITY: { es: "Vigencia de la oferta", en: "Offer validity", mail: { en: "Validity of your offer", es: "Vigencia de su oferta" } },
  CONDITION: { es: "Condición y garantía", en: "Condition and warranty", mail: { en: "Condition (new and original, refurbished…) and warranty", es: "Condición (nuevo y original, reacondicionado…) y garantía" } },
  SCOPE: { es: "Qué incluye y qué no", en: "What's included and what isn't", mail: { en: "Exactly what is included and excluded, and any tooling, adapters, couplings or other components required for operation that are not included", es: "Qué incluye y qué no exactamente, y cualquier herramental, adaptador, acople u otro componente necesario para operar que no esté incluido" } },
  RELEASE: { es: "Pago y liberación del stock", en: "Payment and stock release", mail: { en: "Accepted payment methods, any credit-card surcharge, how long a wire takes to be recognized, and whether the stock is reserved or released when payment is confirmed", es: "Formas de pago aceptadas, recargo por tarjeta si lo hay, cuánto tarda en reconocerse una transferencia, y si el stock se reserva o se libera al confirmar el pago" } },
  PICKUP: { es: "Incoterm y dirección de recogida", en: "Incoterm and pickup address", mail: { en: "Incoterm and pickup city, country and ZIP code", es: "Incoterm y ciudad, país y código postal de recogida" } },
  PACKAGES: { es: "Peso bruto, medidas y número de bultos", en: "Gross weight, package dimensions and count", mail: { en: "Gross weight, dimensions of each package and number of packages", es: "Peso bruto, dimensiones de cada bulto y número de bultos" } },
  ORIGIN: { es: "País de origen", en: "Country of origin", mail: { en: "Country of origin", es: "País de origen" } },
  HS: { es: "Código HS que usa el proveedor", en: "Supplier's usual HS code", mail: { en: "Your usual HS code (for reference only)", es: "El código HS que ustedes usan (solo como referencia)" } },
  DOCS: { es: "Ficha técnica y certificados", en: "Datasheet and certificates", mail: { en: "Datasheet and any applicable certificates or SDS", es: "Ficha técnica y certificados o SDS aplicables" } },
  CARGO_READY: { es: "Fecha de carga lista", en: "Cargo-ready date", mail: { en: "Date the cargo would be ready for pickup", es: "Fecha en que la carga estaría lista para recoger" } },
  MOQ: { es: "Cantidad mínima (MOQ)", en: "Minimum order quantity", mail: { en: "Minimum order quantity, if any", es: "Cantidad mínima de pedido, si aplica" } },
  EXPORT: { es: "Restricciones para enviar a Colombia", en: "Restrictions to ship to Colombia", mail: { en: "Any export restriction for shipping to Colombia", es: "Cualquier restricción de exportación para enviar a Colombia" } },
} as const;
export type AskKey = keyof typeof RFQ_ASKS;

export type AskContext = {
  /** goes into Colombia (an import); null = unknown */
  importsToColombia: boolean | null;
  importWhy?: L;
  /** the Journey has more than one component or an assembly / ambiguous word */
  assembly: boolean;
  urgent: boolean;
  /** what we already know with fresh evidence (see passportOf) */
  known: Partial<Record<"PACKAGES" | "ORIGIN" | "HS", L>>;
  /** a product that may need an SDS (lubricants, batteries, chemicals) */
  maybeHazmat: boolean;
};

export type Ask = { key: AskKey; level: AskLevel; ask: boolean; why: L };

export function rfqAsks(c: AskContext): Ask[] {
  const imp = c.importsToColombia === true;
  const unk = c.importsToColombia == null;
  const impWhy = c.importWhy ?? { es: "va a Colombia (importación)", en: "it goes into Colombia (import)" };
  const out: Ask[] = [
    { key: "STOCK", level: "CRITICAL_TO_SOURCE", ask: true, why: c.urgent ? { es: "es urgente: el plazo depende de si hay stock real", en: "it's urgent: the lead time depends on real stock" } : { es: "saber si hay stock real o solo plazo de fábrica", en: "to know if there's real stock or only factory lead time" } },
    { key: "VALIDITY", level: "NEEDED_BEFORE_QUOTE", ask: true, why: { es: "nuestra oferta al cliente no puede durar más que la del proveedor", en: "our offer to the customer can't last longer than the supplier's" } },
    { key: "CONDITION", level: "NEEDED_BEFORE_QUOTE", ask: true, why: { es: "nuevo/original vs reacondicionado cambia precio y garantía", en: "new/original vs refurbished changes price and warranty" } },
    { key: "SCOPE", level: c.assembly ? "CRITICAL_TO_SOURCE" : "OPTIONAL", ask: c.assembly, why: c.assembly ? { es: "es un conjunto: dos ofertas solo se comparan si incluyen lo mismo", en: "it's an assembly: two offers only compare if they include the same" } : { es: "repuesto simple: solo si hay duda de qué incluye", en: "simple spare: only if what's included is in doubt" } },
    { key: "RELEASE", level: c.urgent ? "CRITICAL_TO_SOURCE" : "NEEDED_BEFORE_QUOTE", ask: true, why: c.urgent ? { es: "con urgencia, tarjeta vs transferencia puede cambiar días hasta liberar el stock", en: "when urgent, card vs wire can change the days until stock is released" } : { es: "el medio de pago cambia costo y fecha de liberación", en: "the payment method changes cost and release date" } },
    { key: "PICKUP", level: imp || unk ? "NEEDED_BEFORE_PURCHASE_IMPORT" : "OPTIONAL", ask: imp, why: imp ? { es: `para cotizar el flete: ${impWhy.es}`, en: `to quote freight: ${impWhy.en}` } : { es: "envío local: normalmente no hace falta", en: "local shipment: usually not needed" } },
    { key: "PACKAGES", level: imp || unk ? "NEEDED_BEFORE_PURCHASE_IMPORT" : "OPTIONAL", ask: imp && !c.known.PACKAGES, why: c.known.PACKAGES ? { es: `ya lo sabemos: ${c.known.PACKAGES.es}`, en: `we already know it: ${c.known.PACKAGES.en}` } : { es: "el flete internacional se cobra por peso y volumen", en: "international freight is charged by weight and volume" } },
    { key: "ORIGIN", level: imp || unk ? "NEEDED_BEFORE_PURCHASE_IMPORT" : "OPTIONAL", ask: imp && !c.known.ORIGIN, why: c.known.ORIGIN ? { es: `ya lo sabemos: ${c.known.ORIGIN.es}`, en: `we already know it: ${c.known.ORIGIN.en}` } : { es: "el origen cambia aranceles y documentos", en: "origin changes duties and documents" } },
    { key: "HS", level: imp || unk ? "NEEDED_BEFORE_PURCHASE_IMPORT" : "OPTIONAL", ask: imp && !c.known.HS, why: c.known.HS ? { es: `ya hay referencia: ${c.known.HS.es}`, en: `there's a reference: ${c.known.HS.en}` } : { es: "referencia para el agente; no es la clasificación colombiana", en: "a reference for the broker; not the Colombian classification" } },
    { key: "DOCS", level: c.maybeHazmat || imp ? "NEEDED_BEFORE_PURCHASE_IMPORT" : "OPTIONAL", ask: c.maybeHazmat || imp, why: c.maybeHazmat ? { es: "puede necesitar SDS para transportarlo", en: "it may need an SDS to be shipped" } : { es: "certificados que la aduana o el cliente pueden pedir", en: "certificates customs or the customer may ask for" } },
    { key: "CARGO_READY", level: "OPTIONAL", ask: c.urgent && imp, why: { es: "útil cuando hay que coordinar recogida urgente", en: "useful when an urgent pickup must be coordinated" } },
    { key: "MOQ", level: "OPTIONAL", ask: false, why: { es: "solo si la cantidad es baja para ese producto", en: "only if the quantity is low for that product" } },
    { key: "EXPORT", level: "OPTIONAL", ask: false, why: { es: "solo para productos con control de exportación", en: "only for export-controlled products" } },
  ];
  return out;
}

/** The extra lines added to the company RFQ template, in the email's language. */
export const askLines = (keys: AskKey[], lang: "EN" | "ES") => keys.filter((k) => k in RFQ_ASKS).map((k) => RFQ_ASKS[k].mail[lang === "EN" ? "en" : "es"]);

// ---------- §13 Scope Equivalence ----------

export type ScopeNeed = { id: string; component: string };
export type OptionScope = { id: string; covers: string[]; price: number | null; currency: string };

/** What each option is missing against what the solution needs. No scope lines → equivalence unknown (said, not assumed). */
export function scopeEquivalence(needs: ScopeNeed[], options: OptionScope[]) {
  if (!needs.length) return { known: false as const, byId: new Map(options.map((o) => [o.id, { missing: [] as ScopeNeed[], complete: null as boolean | null }])) };
  const byId = new Map(options.map((o) => {
    const missing = needs.filter((n) => !o.covers.includes(n.id));
    return [o.id, { missing, complete: missing.length === 0 }];
  }));
  return { known: true as const, byId };
}

/** Price comparison only among options that include the same scope and currency. Returns the lowest price id per group. */
export function comparablePrices(options: OptionScope[], eq: ReturnType<typeof scopeEquivalence>) {
  const groups = new Map<string, OptionScope[]>();
  for (const o of options) {
    if (o.price == null) continue;
    const e = eq.byId.get(o.id);
    const key = `${o.currency}|${eq.known ? e?.missing.map((m) => m.id).sort().join(",") : "?"}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const lowest = new Set<string>();
  for (const g of groups.values()) if (g.length > 1) lowest.add(g.reduce((a, b) => (b.price! < a.price! ? b : a)).id);
  return lowest;
}

// ---------- §9 Payment Method Compare ----------

export type PayOpt = { id: string; method: string; surchargePct: number | null; fixedFee: number | null; fxSpreadPct: number | null; daysToRelease: number | null; confirmed: boolean };
export const PAY_METHOD: Record<string, L> = { WIRE: { es: "Transferencia (wire/SWIFT)", en: "Wire / SWIFT" }, ACH: { es: "ACH", en: "ACH" }, CARD: { es: "Tarjeta", en: "Card" }, OTHER: { es: "Otro", en: "Other" } };

/** Effective cost of paying `price` with this option. Unknown parts stay unknown: the cost is a floor, never a guess. */
export function payCost(price: number, o: PayOpt) {
  const unknown: ("surcharge" | "fee" | "fx" | "days")[] = [];
  if (o.surchargePct == null) unknown.push("surcharge");
  if (o.fixedFee == null) unknown.push("fee");
  if (o.fxSpreadPct == null) unknown.push("fx");
  if (o.daysToRelease == null) unknown.push("days");
  const extra = (price * ((o.surchargePct ?? 0) + (o.fxSpreadPct ?? 0))) / 100 + (o.fixedFee ?? 0);
  const total = Math.round((price + extra) * 100) / 100;
  return { total, extra: Math.round(extra * 100) / 100, floor: unknown.some((u) => u !== "days"), unknown, days: o.daysToRelease, confirmed: o.confirmed };
}

/** Trade-off in one sentence — cheaper vs faster — only from known figures. */
export function payTradeoff(price: number, opts: PayOpt[], cur: string): L | null {
  const rows = opts.map((o) => ({ o, c: payCost(price, o) })).filter((r) => !r.c.floor && r.c.days != null);
  if (rows.length < 2) return null;
  const cheap = rows.reduce((a, b) => (b.c.total < a.c.total ? b : a));
  const fast = rows.reduce((a, b) => (b.c.days! < a.c.days! ? b : a));
  const m = (o: PayOpt) => PAY_METHOD[o.method] ?? PAY_METHOD.OTHER;
  if (cheap.o.id === fast.o.id) return { es: `${m(cheap.o).es} es a la vez la más barata y la más rápida.`, en: `${m(cheap.o).en} is both the cheapest and the fastest.` };
  const dc = Math.round((fast.c.total - cheap.c.total) * 100) / 100;
  const dd = cheap.c.days! - fast.c.days!;
  return { es: `${m(fast.o).es} libera el stock ${dd} día(s) antes y cuesta ${cur} ${dc.toFixed(2).replace(".", ",")} más que ${m(cheap.o).es}.`, en: `${m(fast.o).en} releases stock ${dd} day(s) sooner and costs ${cur} ${dc.toFixed(2)} more than ${m(cheap.o).en}.` };
}

// ---------- §10 Product Logistics Passport ----------

export type Obs = { id: string; status: string; observedAt: Date; grossKg: number | null; netKg: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null; packages: number | null; origin: string | null; hsSupplier: string | null; qtyContext: number | null; packaging: string | null; dealId: string | null; source: string };
export const OBS_STATUS: Record<string, L> = {
  RECEIPT_MEASURED: { es: "Medido al recibir", en: "Measured at receipt" },
  SUPPLIER_REPORTED: { es: "Reportado por proveedor", en: "Reported by supplier" },
  HISTORICAL: { es: "Histórico", en: "Historical" },
  ESTIMATED: { es: "Estimado", en: "Estimated" },
};
const RANK: Record<string, number> = { RECEIPT_MEASURED: 0, SUPPLIER_REPORTED: 1, HISTORICAL: 2, ESTIMATED: 3 };
export const PASSPORT_STALE_DAYS = 365;

/** Best current value per field (measured beats reported beats historical beats estimated; newer wins a tie), with its age. */
export function passportOf(obs: Obs[], now: Date) {
  const sorted = [...obs].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || b.observedAt.getTime() - a.observedAt.getTime());
  const pick = <K extends keyof Obs>(k: K) => {
    const o = sorted.find((x) => x[k] != null && x[k] !== "");
    if (!o) return null;
    const ageDays = Math.floor((now.getTime() - o.observedAt.getTime()) / DAY);
    return { value: o[k], status: o.status, at: o.observedAt, ageDays, stale: ageDays > PASSPORT_STALE_DAYS, qtyContext: o.qtyContext, packaging: o.packaging, source: o.source };
  };
  const dims = sorted.find((x) => x.lengthCm != null && x.widthCm != null && x.heightCm != null);
  return {
    grossKg: pick("grossKg"), netKg: pick("netKg"), packages: pick("packages"), origin: pick("origin"), hsSupplier: pick("hsSupplier"),
    dims: dims ? { l: dims.lengthCm!, w: dims.widthCm!, h: dims.heightCm!, volM3: Math.round(((dims.lengthCm! * dims.widthCm! * dims.heightCm!) / 1e6) * 1000) / 1000, status: dims.status, at: dims.observedAt } : null,
  };
}

/** §10 learning: expected (reported/estimated) vs measured, for the same Journey (or the latest earlier one). */
export function passportLearning(obs: Obs[]) {
  const out: { measured: Obs; expected: Obs; field: "grossKg"; diffPct: number }[] = [];
  for (const m of obs.filter((o) => o.status === "RECEIPT_MEASURED" && o.grossKg != null)) {
    const prior = obs
      .filter((o) => o.id !== m.id && o.status !== "RECEIPT_MEASURED" && o.grossKg != null && o.observedAt <= m.observedAt && (m.dealId ? o.dealId === m.dealId || o.dealId == null : true))
      .sort((a, b) => Number(b.dealId === m.dealId) - Number(a.dealId === m.dealId) || b.observedAt.getTime() - a.observedAt.getTime())[0];
    if (prior && prior.grossKg! > 0) out.push({ measured: m, expected: prior, field: "grossKg", diffPct: Math.round(((m.grossKg! - prior.grossKg!) / prior.grossKg!) * 1000) / 10 });
  }
  return out;
}

// ---------- §12 Supply Basis freshness (C-12, decided 2026-11-10) ----------

/** Supplier stock/price confirmations older than this must be re-confirmed — unless the offer states its own validity date. */
export const REVALIDATE_DAYS = 7;

export function freshnessOf(o: { validUntil: Date | null; confirmedAt: Date }, now: Date, days = REVALIDATE_DAYS): { ok: boolean; why: L } {
  if (o.validUntil) {
    const ok = o.validUntil.getTime() >= now.getTime() - DAY / 2;
    return ok
      ? { ok, why: { es: `vigente según la oferta hasta ${o.validUntil.toISOString().slice(0, 10)}`, en: `valid per the offer until ${o.validUntil.toISOString().slice(0, 10)}` } }
      : { ok, why: { es: `la oferta venció el ${o.validUntil.toISOString().slice(0, 10)}`, en: `the offer expired on ${o.validUntil.toISOString().slice(0, 10)}` } };
  }
  const age = Math.floor((now.getTime() - o.confirmedAt.getTime()) / DAY);
  return age <= days
    ? { ok: true, why: { es: `confirmado hace ${age} día(s) (máx. ${days} sin fecha de vigencia)`, en: `confirmed ${age} day(s) ago (max ${days} without a validity date)` } }
    : { ok: false, why: { es: `confirmado hace ${age} días: más de ${days} sin fecha de vigencia, hay que revalidar`, en: `confirmed ${age} days ago: over ${days} without a validity date, re-confirm` } };
}

export const IMPORT_FEAS: Record<string, L & { tone: string }> = {
  CONFIRMED: { es: "Importación confirmada", en: "Import confirmed", tone: "ok" },
  CONDITIONAL: { es: "Condicional, con supuestos declarados", en: "Conditional, assumptions stated", tone: "info" },
  NEEDS_REVIEW: { es: "Por revisar", en: "Needs review", tone: "attn" },
  BLOCKED: { es: "Bloqueada", en: "Blocked", tone: "risk" },
};
export const AVAILABILITY: Record<string, L> = {
  QUOTE: { es: "Cotización (disponibilidad no verificada)", en: "Quote (availability not verified)" },
  VERIFIED_AVAILABILITY: { es: "Disponibilidad verificada", en: "Verified availability" },
  HISTORICAL: { es: "Histórico (referencia)", en: "Historical (reference)" },
};

/** A product that may need an SDS to ship. Rule of thumb from the category / words, shown as a reason, never a verdict. */
export const maybeHazmat = (text: string, category?: string | null) => category === "LUBRICACION" || /\b(bater[ií]a|battery|lithium|litio|aceite|oil|grasa|grease|qu[ií]mico|chemical|aerosol|adhesiv|resina|resin)\b/i.test(text);

/** Colombian NIT shape (9–10 digits, optional check digit) — used only to suggest "it goes into Colombia". */
export const looksColombianNit = (taxId: string | null | undefined) => !!taxId && /^\d{8,10}(-?\d)?$/.test(taxId.replace(/[.\s]/g, ""));
