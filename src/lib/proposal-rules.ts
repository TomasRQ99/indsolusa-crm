// Comercial C5 · Solution Case & Proposal (§14–20). Pure rules: no database, no dates from the clock.
// Versioned so a screen can say which rules produced a recommendation.

export const PROPOSAL_RULES = "proposal-v1";
export type L = { es: string; en: string };

// ---------- §17 Value attributes: the 8 from the spec, pre-loaded as DRAFT (decision C-14, 2026-11-10) ----------
export const VALUE_SEED: { key: string; nameEs: string; nameEn: string; definitionEs: string; definitionEn: string; appliesWhen: string; restrictions: string; evidenceHint: string }[] = [
  { key: "SPEED", nameEs: "Rapidez", nameEn: "Speed",
    definitionEs: "Conseguimos y entregamos en menos tiempo que la ruta que el cliente tendría sin nosotros.", definitionEn: "We source and deliver in less time than the route the customer would have without us.",
    appliesWhen: "Paradas, urgencias, plazos del fabricante largos.", restrictions: "Solo con fechas verificadas de ambas rutas. Nunca «siempre más rápido».", evidenceHint: "Fecha confirmada de nuestra ruta vs fecha de la ruta del cliente (con fuente)." },
  { key: "GLOBAL_REACH", nameEs: "Cobertura mundial (red y aliados)", nameEn: "Worldwide reach (network and partners)",
    definitionEs: "Accedemos a proveedores y distribuidores en varios países a través de nuestra red y aliados.", definitionEn: "We reach suppliers and distributors in several countries through our network and partners.",
    appliesWhen: "Cuando la parte no está disponible localmente o el fabricante no atiende al cliente.", restrictions: "Nombrar solo países/aliados que intervienen en este caso.", evidenceHint: "Proveedores contactados en este caso y su país." },
  { key: "LOCAL_FINANCING", nameEs: "Financiación local bajo aprobación", nameEn: "Local financing subject to approval",
    definitionEs: "Podemos ofrecer plazo de pago local cuando Finanzas o Gerencia lo aprueban para el cliente.", definitionEn: "We can offer local payment terms when Finance or Management approve them for the customer.",
    appliesWhen: "Clientes con cupo aprobado.", restrictions: "No es una oferta de crédito: solo con cupo vigente aprobado. Nunca prometer plazo sin aprobación.", evidenceHint: "Cupo y plazo aprobados (Cupos de crédito)." },
  { key: "SOURCING_REACH", nameEs: "Universalidad de localización", nameEn: "Universal sourcing",
    definitionEs: "Localizamos partes de muchas marcas, incluidas difíciles, descontinuadas o con equivalentes.", definitionEn: "We locate parts from many brands, including hard-to-find, discontinued or with equivalents.",
    appliesWhen: "Partes obsoletas, sin distribuidor local o con equivalencias.", restrictions: "Decir qué se encontró en este caso, no «encontramos cualquier cosa».", evidenceHint: "Búsqueda guardada y opciones encontradas para este Journey." },
  { key: "WARRANTY_SUPPORT", nameEs: "Garantía y soporte según la operación", nameEn: "Warranty and support per operation",
    definitionEs: "Acompañamos la garantía del fabricante o proveedor y gestionamos el reclamo cuando aplica.", definitionEn: "We back the manufacturer's or supplier's warranty and handle the claim when it applies.",
    appliesWhen: "Equipos nuevos con garantía del proveedor.", restrictions: "Solo la garantía que el proveedor confirmó para este caso (plazo y condiciones).", evidenceHint: "Garantía confirmada por el proveedor (opción de suministro)." },
  { key: "TIMELY_INFO", nameEs: "Información oportuna", nameEn: "Timely information",
    definitionEs: "El cliente sabe dónde está su pedido y qué cambió antes de que tenga que preguntar.", definitionEn: "The customer knows where the order is and what changed before having to ask.",
    appliesWhen: "Importaciones con varios tramos o clientes con planta parada.", restrictions: "Describir lo que efectivamente se informará en este caso.", evidenceHint: "Plan de seguimiento o historial de avisos con este cliente." },
  { key: "EXPERIENCE", nameEs: "Experiencia", nameEn: "Experience",
    definitionEs: "Hemos resuelto casos parecidos antes y sabemos qué suele fallar.", definitionEn: "We've solved similar cases before and know what usually goes wrong.",
    appliesWhen: "Cuando hay un precedente real (misma parte, importación o cliente).", restrictions: "Citar el precedente con fecha; no inventar años ni cantidades.", evidenceHint: "Journey, importación o compra anterior con fecha." },
  { key: "LOGISTICS_COORD", nameEs: "Coordinación logística", nameEn: "Logistics coordination",
    definitionEs: "Coordinamos recogida, transporte, aduana y entrega para que el cliente trate con un solo responsable.", definitionEn: "We coordinate pickup, freight, customs and delivery so the customer deals with one party.",
    appliesWhen: "Importaciones o envíos con varios proveedores.", restrictions: "Decir qué tramos coordinamos en este caso (incoterm).", evidenceHint: "Incoterm y tramos de la base de suministro." },
];

export const ATTR_STATUS: Record<string, L & { tone: string }> = {
  DRAFT: { es: "Borrador", en: "Draft", tone: "wait" },
  ACTIVE: { es: "Activo", en: "Active", tone: "ok" },
  RETIRED: { es: "Retirado", en: "Retired", tone: "dash" },
};

export const AUDIENCE: Record<string, L> = {
  ALL: { es: "Todos", en: "Everyone" },
  MAINTENANCE: { es: "Mantenimiento", en: "Maintenance" },
  PURCHASING: { es: "Compras", en: "Purchasing" },
  MANAGEMENT: { es: "Gerencia", en: "Management" },
  FINANCE: { es: "Finanzas", en: "Finance" },
};

export const ROUTE_KIND: Record<string, L> = {
  OEM: { es: "Original del fabricante", en: "OEM" },
  ALTERNATIVE: { es: "Alternativa validada", en: "Validated alternative" },
  REPAIR: { es: "Reparación", en: "Repair" },
  REFURBISHED: { es: "Reacondicionado", en: "Refurbished" },
  EXPEDITE: { es: "Urgente (expedite)", en: "Expedite" },
  PARTIAL: { es: "Compra parcial", en: "Partial purchase" },
};
export type Route = { kind: string; label: string; note?: string | null };
export function readRoutes(v: unknown): Route[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r) => r && typeof r === "object" && typeof (r as Route).label === "string" && (r as Route).label.trim()).map((r) => ({ kind: ROUTE_KIND[(r as Route).kind] ? (r as Route).kind : "ALTERNATIVE", label: String((r as Route).label).slice(0, 160), note: (r as Route).note ? String((r as Route).note).slice(0, 300) : null }));
}

// ---------- AC12: a claim reaches the proposal only with evidence for THIS case ----------
export function claimState(c: { evidence: string | null; validUntil: Date | null; hidden: boolean }, attrStatus: string, now: Date): { inProposal: boolean; why: L | null } {
  if (c.hidden) return { inProposal: false, why: { es: "Oculta: no sale en la propuesta.", en: "Hidden: not in the proposal." } };
  if (attrStatus === "RETIRED") return { inProposal: false, why: { es: "El atributo fue retirado del catálogo.", en: "The attribute was retired from the catalog." } };
  if (!c.evidence || c.evidence.trim().length < 3) return { inProposal: false, why: { es: "Sin evidencia de este caso: es una hipótesis interna y no sale en la propuesta.", en: "No evidence for this case: an internal hypothesis, not in the proposal." } };
  if (c.validUntil && c.validUntil.getTime() < now.getTime()) return { inProposal: false, why: { es: "La evidencia venció: actualízala para usarla.", en: "The evidence expired: update it to use it." } };
  return { inProposal: true, why: null };
}

/** Categorical words the spec forbids without proof ("always faster"). Shown as a warning, never auto-edited. */
const ABSOLUTE = /(?<![\p{L}])(siempre|nunca|el m[aá]s|la m[aá]s|los m[aá]s|las m[aá]s|garantizad[oa]s?|always|never|fastest|cheapest|best|guaranteed|100\s?%)(?![\p{L}])/giu;
export function absoluteWords(...texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const s of texts) for (const m of (s ?? "").matchAll(ABSOLUTE)) out.add(m[1].toLowerCase());
  return [...out];
}

// ---------- §18–19 Quick Quote vs Solution Proposal · presentation recommendation (decision C-13: recommend, never force) ----------
export const PRESENT_POLICY = { version: "present-v1", bigTicketUsd: 10000, veryBigUsd: 25000 } as const;
export type PresentLevel = "SEND_DIRECTLY" | "PRESENT_RECOMMENDED" | "PRESENT_BEFORE_SENDING";
export const PRESENT_LEVEL: Record<PresentLevel, L & { tone: string }> = {
  SEND_DIRECTLY: { es: "Enviar directamente", en: "Send directly", tone: "ok" },
  PRESENT_RECOMMENDED: { es: "Se recomienda presentarla", en: "Presenting is recommended", tone: "info" },
  PRESENT_BEFORE_SENDING: { es: "Presentarla antes de enviarla", en: "Present before sending", tone: "attn" },
};
export type PresentCtx = { saleUsd: number; scopeDiffs: number; alternatives: number; committee: boolean; impactWritten: boolean; repeatPurchase: boolean };
export function presentationAdvice(c: PresentCtx): { level: PresentLevel; mode: "QUICK" | "PROPOSAL"; reasons: L[] } {
  const r: L[] = [];
  const P = PRESENT_POLICY;
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (c.committee) r.push({ es: "Decide un comité o varias personas: la propuesta debe poder leerse sin ti.", en: "A committee or several people decide: the proposal must stand on its own." });
  if (c.alternatives >= 2) r.push({ es: `Hay ${c.alternatives} alternativas con ventajas distintas que conviene explicar.`, en: `There are ${c.alternatives} alternatives with different trade-offs worth explaining.` });
  if (c.scopeDiffs > 0) r.push({ es: `${c.scopeDiffs} componente(s) excluidos, opcionales, por confirmar o que pone el cliente: conviene que lo vea antes de decidir.`, en: `${c.scopeDiffs} component(s) excluded, optional, to confirm or customer-supplied: worth showing before they decide.` });
  if (c.saleUsd >= P.bigTicketUsd) r.push({ es: `Monto significativo (≥ USD ${fmt(P.bigTicketUsd)}).`, en: `Significant amount (≥ USD ${fmt(P.bigTicketUsd)}).` });
  const strong = (c.committee && (c.alternatives >= 2 || c.scopeDiffs > 0)) || (c.saleUsd >= P.veryBigUsd && (c.scopeDiffs > 0 || c.alternatives >= 2));
  if (strong) {
    if (c.impactWritten) r.push({ es: "El cliente pierde algo si no lo resuelve: vale la pena que entienda la solución, no solo el precio.", en: "The customer loses something if it isn't solved: worth making the solution clear, not just the price." });
    return { level: "PRESENT_BEFORE_SENDING", mode: "PROPOSAL", reasons: r };
  }
  if (r.length) return { level: "PRESENT_RECOMMENDED", mode: "PROPOSAL", reasons: r };
  return { level: "SEND_DIRECTLY", mode: "QUICK", reasons: [c.repeatPurchase ? { es: "Compra repetida y simple: una cotización rápida basta.", en: "Simple repeat purchase: a quick quote is enough." } : { es: "Caso simple: alcance claro, sin alternativas ni comité. Una cotización rápida basta.", en: "Simple case: clear scope, no alternatives, no committee. A quick quote is enough." }] };
}
/** Committee from what we know of the decision (label/path) or the case flag. */
export function looksCommittee(flag: boolean, ...texts: (string | null | undefined)[]) {
  return flag || /\b(comit[eé]|committee|junta|board|gerencia general|varios aprobadores)\b/i.test(texts.filter(Boolean).join(" "));
}

// ---------- §19 briefing: 3–5 genuine questions (Carnegie: ask, listen, never manipulate) ----------
export type BriefCtx = { decisionPathKnown: boolean; toConfirm: string[]; customerSupplied: string[]; neededByKnown: boolean; successKnown: boolean; alternatives: number; committee: boolean };
export function briefingQuestions(c: BriefCtx): L[] {
  const q: L[] = [];
  q.push({ es: "¿Hay algo de lo que entendimos de su necesidad que no sea correcto o que haya cambiado?", en: "Is there anything we understood about your need that isn't right or has changed?" });
  if (c.toConfirm.length) q.push({ es: `Sobre ${c.toConfirm.slice(0, 2).join(" y ")}: ¿lo incluimos nosotros o ya lo tienen?`, en: `About ${c.toConfirm.slice(0, 2).join(" and ")}: should we include it or do you already have it?` });
  if (!c.successKnown) q.push({ es: "¿Cómo sabrán que quedó resuelto? ¿Qué tendría que pasar en la planta?", en: "How will you know it's solved? What should happen at the plant?" });
  if (!c.neededByKnown) q.push({ es: "¿Para cuándo necesitan que esté funcionando, y qué pasa si llega después?", en: "When do you need it running, and what happens if it arrives later?" });
  if (c.alternatives >= 2) q.push({ es: "Entre las alternativas, ¿qué pesa más para ustedes: el plazo, la inversión o la garantía?", en: "Among the alternatives, what matters most to you: lead time, investment or warranty?" });
  if (!c.decisionPathKnown || c.committee) q.push({ es: "¿Quién más participa en la decisión y qué necesita ver para sentirse tranquilo?", en: "Who else takes part in the decision and what do they need to see to feel comfortable?" });
  if (c.customerSupplied.length) q.push({ es: `${c.customerSupplied[0]} lo ponen ustedes: ¿ya está disponible para la fecha?`, en: `You supply ${c.customerSupplied[0]}: will it be available by the date?` });
  if (q.length < 3) q.push({ es: "¿Qué les preocupa de esta solución, aunque parezca pequeño?", en: "What worries you about this solution, even if it seems small?" });
  return q.slice(0, 5);
}

// ---------- §20 quote versions: what changed between two versions (diff, never rewriting the older one) ----------
export type QV = {
  lines: { code: string | null; description: string; qty: number; unitPrice: number }[];
  leadMinDays: number | null; leadMaxDays: number | null; incoterm: string | null; paymentTerms: string | null;
  validityDays: number; condition: string; promiseText: string | null; promiseCondition: string | null; solution: string | null; supplyPrimary: string | null;
};
export type LineChange = { key: string; kind: "ADDED" | "REMOVED" | "CHANGED"; from?: { qty: number; unitPrice: number }; to?: { qty: number; unitPrice: number } };
const r2 = (n: number) => Math.round(n * 100) / 100;
export function quoteDiff(a: QV, b: QV) {
  const key = (l: { code: string | null; description: string }) => (l.code?.trim() || l.description.trim()).toLowerCase();
  const am = new Map(a.lines.map((l) => [key(l), l]));
  const bm = new Map(b.lines.map((l) => [key(l), l]));
  const lines: LineChange[] = [];
  for (const [k, l] of bm) {
    const o = am.get(k);
    if (!o) lines.push({ key: l.code || l.description, kind: "ADDED", to: { qty: l.qty, unitPrice: r2(l.unitPrice) } });
    else if (o.qty !== l.qty || r2(o.unitPrice) !== r2(l.unitPrice)) lines.push({ key: l.code || l.description, kind: "CHANGED", from: { qty: o.qty, unitPrice: r2(o.unitPrice) }, to: { qty: l.qty, unitPrice: r2(l.unitPrice) } });
  }
  for (const [k, l] of am) if (!bm.has(k)) lines.push({ key: l.code || l.description, kind: "REMOVED", from: { qty: l.qty, unitPrice: r2(l.unitPrice) } });
  const lead = (x: QV) => (x.leadMinDays == null && x.leadMaxDays == null ? "" : `${x.leadMinDays ?? "?"}–${x.leadMaxDays ?? "?"}`);
  const F: { field: string; label: L; get: (x: QV) => string }[] = [
    { field: "lead", label: { es: "Plazo (días después de la OC)", en: "Lead time (days after PO)" }, get: lead },
    { field: "incoterm", label: { es: "Incoterm", en: "Incoterm" }, get: (x) => x.incoterm ?? "" },
    { field: "payment", label: { es: "Forma de pago", en: "Payment terms" }, get: (x) => x.paymentTerms ?? "" },
    { field: "validity", label: { es: "Vigencia (días)", en: "Validity (days)" }, get: (x) => String(x.validityDays) },
    { field: "condition", label: { es: "Condición", en: "Condition" }, get: (x) => x.condition },
    { field: "promise", label: { es: "Promesa", en: "Promise" }, get: (x) => [x.promiseText, x.promiseCondition].filter(Boolean).join(" · ") },
    { field: "solution", label: { es: "Solución", en: "Solution" }, get: (x) => x.solution ?? "" },
    { field: "supply", label: { es: "Base de suministro", en: "Supply basis" }, get: (x) => x.supplyPrimary ?? "" },
  ];
  const fields = F.map((f) => ({ field: f.field, label: f.label, from: f.get(a).trim(), to: f.get(b).trim() })).filter((f) => f.from !== f.to);
  const tot = (x: QV) => r2(x.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  return { lines, fields, totalFrom: tot(a), totalTo: tot(b), empty: lines.length === 0 && fields.length === 0 && tot(a) === tot(b) };
}

// ---------- §15 cost stack: each cost says how firm it is ----------
export const COST_STATUS: Record<string, L & { tone: string; rank: number }> = {
  CONFIRMED: { es: "Confirmado", en: "Confirmed", tone: "ok", rank: 0 },
  QUOTED: { es: "Cotizado", en: "Quoted", tone: "info", rank: 1 },
  HISTORICAL: { es: "Histórico", en: "Historical", tone: "wait", rank: 2 },
  ESTIMATED: { es: "Estimado", en: "Estimated", tone: "attn", rank: 3 },
  PENDING: { es: "Pendiente", en: "Pending", tone: "risk", rank: 4 },
};
/** Explicit status wins; otherwise derived: nothing → PENDING; supplier confirmed → CONFIRMED; with a source → QUOTED; else ESTIMATED. */
export function costStatusOf(explicit: string | null | undefined, amount: number, src: string | null | undefined, confirmed = false): string {
  if (explicit && COST_STATUS[explicit]) return explicit;
  if (!(amount > 0)) return "PENDING";
  if (confirmed) return "CONFIRMED";
  if (src && src.trim()) return "QUOTED";
  return "ESTIMATED";
}
export const weakest = (statuses: string[]) => statuses.reduce((w, s) => ((COST_STATUS[s]?.rank ?? 0) > (COST_STATUS[w]?.rank ?? 0) ? s : w), "CONFIRMED");

/** Text that must never appear in a customer-facing proposal (AC11). Used by tests and as a last guard on render. */
export const INTERNAL_MARKERS = /eságara|esagara|margen|margin|markup|costo del proveedor|supplier cost|protected|protegida|scoring/i;
