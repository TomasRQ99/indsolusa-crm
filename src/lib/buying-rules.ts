import { lineAmount, money2, subMoney, sumMoney, type MoneyIn } from "./money";

// Operaciones O3 · buying well (module 11 §12–16). Pure: no database.
// "Comprar bien no es comprar lo más barato": price, availability, scope, terms and risk are read together, and a
// scope difference is never allowed to pass as a price difference.

type Txt = { es: string; en: string };

// ---------- Supplier PO vs Supplier Confirmation (§15) ----------

export type DiffKey = "price" | "quantity" | "scope" | "date" | "payment" | "incoterm" | "documentation" | "warranty" | "packaging" | "new_condition" | "currency";
export const DIFF_LABEL: Record<DiffKey, Txt> = {
  price: { es: "Precio", en: "Price" }, quantity: { es: "Cantidad", en: "Quantity" }, scope: { es: "Alcance", en: "Scope" }, date: { es: "Fecha de listo", en: "Ready date" },
  payment: { es: "Condición de pago", en: "Payment terms" }, incoterm: { es: "Incoterm", en: "Incoterm" }, documentation: { es: "Documentos", en: "Documents" },
  warranty: { es: "Garantía", en: "Warranty" }, packaging: { es: "Empaque", en: "Packaging" }, new_condition: { es: "Condición nueva", en: "New condition" }, currency: { es: "Moneda", en: "Currency" },
};
export type ConfDiff = { key: DiffKey; expected: string; actual: string; economicImpact: number | null; customerImpact: Txt | null; material: boolean };
export const SCOPE_STATES: Record<string, Txt> = { INCLUDED: { es: "Incluido", en: "Included" }, EXCLUDED: { es: "Excluido", en: "Excluded" }, OPTIONAL: { es: "Opcional", en: "Optional" }, NOT_STATED: { es: "No lo dice", en: "Not stated" } };
export type ScopeRow = { component: string; state: string };
export const readScope = (v: unknown): ScopeRow[] => (Array.isArray(v) ? v : []).filter((x): x is ScopeRow => !!x && typeof x === "object" && typeof (x as ScopeRow).component === "string").map((x) => ({ component: x.component, state: SCOPE_STATES[x.state] ? x.state : "NOT_STATED" }));
export const readDiffs = (v: unknown): ConfDiff[] => (Array.isArray(v) ? (v as ConfDiff[]) : []);

type PoIn = { currency: string; incoterm: string | null; terms: string | null; shipBy: Date | null; lines: { position: number; qty: number; unitCost: MoneyIn; code: string | null; description: string }[] };
type ConfIn = { currency: string | null; incoterm: string | null; paymentTerms: string | null; readyDate: Date | null; packaging: string | null; documents: string | null; warranty: string | null; newConditions: string | null; lines: { position: number; qty: number; unitPrice: number }[]; scope: ScopeRow[] };
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Every difference states expected, actual, economic impact and customer impact (§15.1). */
export function compareConfirmation(po: PoIn, c: ConfIn, ctx: { promiseDependsOnShipBy: boolean }): ConfDiff[] {
  const out: ConfDiff[] = [];
  let priceDelta = 0;
  for (const l of po.lines) {
    const cl = c.lines.find((x) => x.position === l.position);
    const name = l.code ?? l.description;
    if (!cl) { out.push({ key: "quantity", expected: `${l.qty} × ${name}`, actual: "—", economicImpact: null, customerImpact: { es: "El proveedor no confirmó esta línea", en: "The supplier didn't confirm this line" }, material: true }); continue; }
    if (cl.qty !== l.qty) out.push({ key: "quantity", expected: `${l.qty} × ${name}`, actual: `${cl.qty}`, economicImpact: null, customerImpact: cl.qty < l.qty ? { es: "No alcanza para lo vendido", en: "Not enough for what was sold" } : { es: "Sobra cantidad: sería inventario", en: "Excess quantity: it would be inventory" }, material: true });
    const d = subMoney(lineAmount(cl.qty, cl.unitPrice), lineAmount(cl.qty, l.unitCost));
    if (Math.abs(d) > 0.005) { priceDelta = sumMoney([priceDelta, d]); out.push({ key: "price", expected: `${po.currency} ${money2(l.unitCost).toFixed(2)} · ${name}`, actual: `${money2(cl.unitPrice).toFixed(2)}`, economicImpact: -d, customerImpact: null, material: d > 0 }); }
  }
  // Scope on its own row: what the functional unit needs must be included, whatever the price says.
  const missing = c.scope.filter((s) => s.state !== "INCLUDED");
  if (missing.length) {
    const cheaper = priceDelta < -0.005;
    out.push({ key: "scope", expected: c.scope.map((s) => s.component).join(" + "), actual: missing.map((s) => `${s.component}: ${s.state}`).join(" · "), economicImpact: null, customerImpact: cheaper ? { es: "El precio bajó, pero el alcance no es el mismo: no es un ahorro, es otra cosa lo que se compra", en: "The price dropped, but the scope isn't the same: it isn't a saving, something else is being bought" } : { es: "La unidad podría no funcionar completa para el cliente", en: "The unit might not work complete for the customer" }, material: true });
  }
  if (c.currency && c.currency.toUpperCase() !== po.currency.toUpperCase()) out.push({ key: "currency", expected: po.currency, actual: c.currency.toUpperCase(), economicImpact: null, customerImpact: null, material: true });
  if (c.readyDate && po.shipBy && day(c.readyDate) !== day(po.shipBy)) {
    const late = c.readyDate > po.shipBy;
    out.push({ key: "date", expected: day(po.shipBy), actual: day(c.readyDate), economicImpact: null, customerImpact: late && ctx.promiseDependsOnShipBy ? { es: "Puede mover la promesa al cliente", en: "It may move the customer promise" } : null, material: late });
  }
  const text = (key: DiffKey, exp: string | null, act: string | null, material: boolean) => { if (act && norm(act) !== norm(exp)) out.push({ key, expected: exp ?? "—", actual: act, economicImpact: null, customerImpact: null, material }); };
  text("payment", po.terms, c.paymentTerms, true);
  text("incoterm", po.incoterm, c.incoterm, true);
  if (c.documents) out.push({ key: "documentation", expected: "—", actual: c.documents, economicImpact: null, customerImpact: null, material: false });
  if (c.warranty) out.push({ key: "warranty", expected: "—", actual: c.warranty, economicImpact: null, customerImpact: null, material: false });
  if (c.packaging) out.push({ key: "packaging", expected: "—", actual: c.packaging, economicImpact: null, customerImpact: null, material: false });
  if (c.newConditions) out.push({ key: "new_condition", expected: "—", actual: c.newConditions, economicImpact: null, customerImpact: null, material: true });
  return out;
}
export const materialDiffs = (d: ConfDiff[]) => d.filter((x) => x.material);

// ---------- Savings Ledger (§13) ----------

export const SAVING_KINDS: Record<string, Txt> = {
  SUPPLIER_SAVINGS: { es: "Ahorro con el proveedor", en: "Supplier saving" }, FREIGHT_SAVINGS: { es: "Ahorro en flete", en: "Freight saving" }, PAYMENT_SAVINGS: { es: "Ahorro en el pago", en: "Payment saving" },
  LEGITIMATE_DUTY_REDUCTION: { es: "Reducción legítima de arancel", en: "Legitimate duty reduction" }, CLAIM_RECOVERY: { es: "Recuperación por reclamo", en: "Claim recovery" }, ERROR_AVOIDANCE: { es: "Error evitado", en: "Error avoided" },
};
/** Gross saving = baseline − final. What was passed on to the customer is not margin; the rest is retained. */
export function savingOf(baseline: MoneyIn, final: MoneyIn, passed: MoneyIn) {
  const gross = subMoney(baseline, final);
  const p = money2(passed);
  return { gross, passed: p, retained: subMoney(gross, p), valid: gross > 0.005 && p >= 0 && p <= gross + 0.005 };
}

// ---------- Profitability gate (§12) ----------

export type Window = "OPEN" | "NARROW" | "CLOSED";
export const WINDOW_TEXT: Record<Window, Txt & { advice: Txt; tone: string }> = {
  OPEN: { es: "Abierta", en: "Open", tone: "ok", advice: { es: "Hay tiempo y alternativas: vale la pena pedir mejores condiciones.", en: "There's time and there are alternatives: it's worth asking for better terms." } },
  NARROW: { es: "Estrecha", en: "Narrow", tone: "attn", advice: { es: "Asegura primero el stock; negocia sin arriesgar la asignación.", en: "Secure the stock first; negotiate without risking the allocation." } },
  CLOSED: { es: "Cerrada", en: "Closed", tone: "risk", advice: { es: "Negociar ahora podría comprometer la solución: compra y registra lo aprendido para la próxima.", en: "Negotiating now could put the solution at risk: buy, and record what was learned for next time." } },
};
/** Room to negotiate, from the days left before the supplier must ship. Thresholds are policy, not code. */
export function negotiationWindow(shipBy: Date | null, today: Date, p: { openDays: number; narrowDays: number }): Window | null {
  if (!shipBy) return null;
  const slack = Math.round((Date.UTC(shipBy.getUTCFullYear(), shipBy.getUTCMonth(), shipBy.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 864e5);
  return slack > p.openDays ? "OPEN" : slack >= p.narrowDays ? "NARROW" : "CLOSED";
}
export const DEFAULT_WINDOW = { openDays: 7, narrowDays: 2 };

export type Opportunity = { key: string; text: Txt; evidence: Txt };
export type GateFacts = { unitNow: { code: string; cost: number }[]; lastPurchases: { code: string; cost: number; at: Date; supplier: string }[]; otherOffers: { code: string; price: number; supplier: string; at: Date }[]; pastSavings: { amount: number; at: Date; kind: string }[]; siblingDrafts: { code: string }[]; advancePct: number | null; hasTerms: boolean };
/** Opportunities with their evidence — never a generic "ask for a discount". Past results are facts, not promises. */
export function opportunities(f: GateFacts): Opportunity[] {
  const out: Opportunity[] = [];
  const d = (x: Date) => x.toISOString().slice(0, 10);
  for (const u of f.unitNow) {
    const last = f.lastPurchases.filter((x) => x.code === u.code && x.cost < u.cost - 0.005).sort((a, b) => +b.at - +a.at)[0];
    if (last) out.push({ key: `last-${u.code}`, text: { es: `${u.code}: hoy USD ${u.cost.toFixed(2)}, la última compra fue a USD ${last.cost.toFixed(2)}`, en: `${u.code}: today USD ${u.cost.toFixed(2)}, the last purchase was at USD ${last.cost.toFixed(2)}` }, evidence: { es: `${last.supplier} · ${d(last.at)}`, en: `${last.supplier} · ${d(last.at)}` } });
    const offer = f.otherOffers.filter((x) => x.code === u.code && x.price < u.cost - 0.005).sort((a, b) => a.price - b.price)[0];
    if (offer) out.push({ key: `offer-${u.code}`, text: { es: `${u.code}: hay una oferta a USD ${offer.price.toFixed(2)} de otro proveedor`, en: `${u.code}: there's an offer at USD ${offer.price.toFixed(2)} from another supplier` }, evidence: { es: `${offer.supplier} · ${d(offer.at)} · confirma que sea el mismo alcance`, en: `${offer.supplier} · ${d(offer.at)} · confirm it is the same scope` } });
  }
  if (f.pastSavings.length) { const s = f.pastSavings[0]; out.push({ key: "memory", text: { es: `Este proveedor ya mejoró condiciones antes (USD ${s.amount.toFixed(2)})`, en: `This supplier has improved terms before (USD ${s.amount.toFixed(2)})` }, evidence: { es: `${d(s.at)} · no garantiza que se repita`, en: `${d(s.at)} · no guarantee it happens again` } }); }
  if (f.siblingDrafts.length) out.push({ key: "consolidate", text: { es: `Hay ${f.siblingDrafts.length} compra(s) más sin liberar con este proveedor: consolidar puede mejorar precio o flete`, en: `There are ${f.siblingDrafts.length} more unreleased purchase(s) with this supplier: consolidating may improve price or freight` }, evidence: { es: f.siblingDrafts.map((x) => x.code).join(", "), en: f.siblingDrafts.map((x) => x.code).join(", ") } });
  if (f.advancePct === 100 && !f.hasTerms) out.push({ key: "advance", text: { es: "Pide el 100 % anticipado: pregunta por descuento por pronto pago o por un plazo", en: "It asks for 100 % in advance: ask about an early-payment discount or terms" }, evidence: { es: "Condición registrada del proveedor", en: "Supplier's recorded condition" } });
  return out;
}
