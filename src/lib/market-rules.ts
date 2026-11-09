// Mercado (Módulo 09) — pure rules, no database: vocabulary, movement state, horizons and the
// rule-based structuring of a one-sentence exploration. AI is not connected yet; when it is, it
// proposes on top of these rules and the person still confirms (contract §16).
import { BRANDS, fold } from "./part-lexicon";
import { mulMoney, sumMoney } from "./money";

type L = { es: string; en: string };

export const SCOPES: Record<string, L> = {
  TERRITORY: { es: "Territorio", en: "Territory" },
  INDUSTRY: { es: "Industria", en: "Industry" },
  COMPANY: { es: "Empresa", en: "Company" },
  PLANT: { es: "Planta", en: "Plant" },
  TECHNOLOGY: { es: "Tecnología / fabricante", en: "Technology / manufacturer" },
  APPLICATION: { es: "Aplicación", en: "Application" },
};
export const SIGNAL_KINDS: Record<string, L> = {
  EXPANSION: { es: "Ampliación", en: "Expansion" },
  NEW_PLANT: { es: "Nueva planta o sede", en: "New plant or site" },
  INVESTMENT: { es: "Inversión", en: "Investment" },
  ACQUISITION: { es: "Adquisición", en: "Acquisition" },
  NEW_TECHNOLOGY: { es: "Nueva tecnología", en: "New technology" },
  DISCONTINUATION: { es: "Descontinuación", en: "Discontinuation" },
  REGULATORY: { es: "Cambio regulatorio", en: "Regulatory change" },
  ECONOMIC: { es: "Cambio económico", en: "Economic change" },
  PAYMENT: { es: "Cambio en cómo paga", en: "Change in how they pay" },
  SHUTDOWN: { es: "Parada programada", en: "Planned shutdown" },
  ROLE_CHANGE: { es: "Cambio de rol", en: "Role change" },
  OTHER: { es: "Otro cambio", en: "Other change" },
};
export const WHITE_KINDS: Record<string, L> = {
  PLANT: { es: "Planta", en: "Plant" },
  AREA: { es: "Área", en: "Area" },
  COUNTRY: { es: "País", en: "Country" },
  TECHNOLOGY: { es: "Tecnología", en: "Technology" },
  PERSON: { es: "Persona", en: "Person" },
  APPLICATION: { es: "Aplicación", en: "Application" },
  GROUP_COMPANY: { es: "Empresa del grupo", en: "Group company" },
  CATEGORY: { es: "Categoría", en: "Category" },
};
export const FUTURE_KINDS: Record<string, L> = {
  CAPEX: { es: "CAPEX / ampliación / nueva línea", en: "CAPEX / expansion / new line" },
  SHUTDOWN: { es: "Parada o mantenimiento", en: "Shutdown or maintenance" },
  NEW_PLANT: { es: "Nueva planta o sede", en: "New plant or site" },
  RETROFIT: { es: "Retrofit / modernización", en: "Retrofit / modernization" },
  TECH_CHANGE: { es: "Cambio de tecnología", en: "Technology change" },
  REGULATORY: { es: "Proyecto regulatorio o de calidad", en: "Regulatory or quality project" },
  STRATEGIC: { es: "White space estratégico", en: "Strategic white space" },
};
/** Truth taxonomy (§5). Never mixed visually. */
export const CONFIDENCE: Record<string, L & { cls: string }> = {
  VERIFIED: { es: "Verificado", en: "Verified", cls: "ok" },
  REPORTED: { es: "Informado", en: "Reported", cls: "info" },
  INFERRED: { es: "Inferido", en: "Inferred", cls: "attn" },
  UNKNOWN: { es: "Desconocido", en: "Unknown", cls: "dash" },
};
export const SOURCES: Record<string, L> = {
  CONVERSATION: { es: "Conversación", en: "Conversation" },
  VISIT: { es: "Visita", en: "Visit" },
  DOCUMENT: { es: "Documento", en: "Document" },
  PUBLIC_WEB: { es: "Publicación / web", en: "Publication / web" },
  NEWS: { es: "Noticia", en: "News" },
  DATASET: { es: "Base de datos", en: "Dataset" },
  INTERNAL: { es: "Historia con nosotros", en: "Our history" },
  RULE: { es: "Regla de SOLU", en: "SOLU rule" },
};
export const MOVEMENT: Record<string, L & { cls: string }> = {
  MOVE: { es: "Siguiente movimiento", en: "Next movement", cls: "info" },
  WAIT: { es: "Esperando con control", en: "Waiting with control", cls: "wait" },
  TRIGGER: { es: "Futuro con disparador", en: "Future trigger", cls: "wait" },
  CLARITY_NEEDED: { es: "Necesita claridad", en: "Needs clarity", cls: "attn" },
};

const pick = <T extends string>(map: Record<string, unknown>, v: string | null | undefined, fallback: T) => (v && v in map ? (v as T) : fallback);
export const asScope = (v?: string | null) => pick(SCOPES, v, "INDUSTRY");
export const asSignalKind = (v?: string | null) => pick(SIGNAL_KINDS, v, "OTHER");
export const asWhiteKind = (v?: string | null) => pick(WHITE_KINDS, v, "AREA");
export const asFutureKind = (v?: string | null) => pick(FUTURE_KINDS, v, "CAPEX");
export const asConfidence = (v?: string | null) => pick(CONFIDENCE, v, "REPORTED");
export const asSource = (v?: string | null) => pick(SOURCES, v, "CONVERSATION");

/** Every active exploration has exactly one: a next movement, a controlled wait, a future trigger — or it needs clarity. */
export function movementOf(e: { nextMove?: string | null; nextMoveAt?: Date | null; waitingFor?: string | null; waitingUntil?: Date | null; triggerOn?: Date | null; triggerEvent?: string | null }) {
  if (e.nextMove) return "MOVE";
  if (e.waitingFor && e.waitingUntil) return "WAIT";
  if (e.triggerOn || e.triggerEvent) return "TRIGGER";
  return "CLARITY_NEEDED";
}

/** Horizon buckets for future opportunities: 0–30, 31–90, 91–365, >365 days, or unknown. No probabilities. */
export type Horizon = "H30" | "H90" | "H365" | "LATER" | "UNKNOWN";
export const HORIZONS: Record<Horizon, L> = {
  H30: { es: "0–30 días", en: "0–30 days" },
  H90: { es: "31–90 días", en: "31–90 days" },
  H365: { es: "91–365 días", en: "91–365 days" },
  LATER: { es: "Más de un año", en: "Over a year" },
  UNKNOWN: { es: "Sin fecha aún", en: "No date yet" },
};
export function horizonOf(expectedAt: Date | null | undefined, now = new Date()): Horizon {
  if (!expectedAt) return "UNKNOWN";
  const days = Math.ceil((expectedAt.getTime() - now.getTime()) / 864e5);
  if (days <= 30) return "H30";
  if (days <= 90) return "H90";
  if (days <= 365) return "H365";
  return "LATER";
}

// ---------- One sentence → a structured exploration (rule-based; the person confirms) ----------

export const INDUSTRIES: { key: string; es: string; en: string; words: string[] }[] = [
  { key: "dairy", es: "Lácteos", en: "Dairy", words: ["lacteo", "lacteos", "leche", "dairy", "milk", "queso", "yogur"] },
  { key: "food", es: "Alimentos y bebidas", en: "Food and beverage", words: ["alimentos", "alimentos y bebidas", "bebidas", "food", "beverage", "carnicos", "panificacion", "cerveza", "gaseosas"] },
  { key: "pharma", es: "Farmacéutica", en: "Pharma", words: ["pharma", "farmaceutica", "farmaceutico", "laboratorios", "medicamentos"] },
  { key: "cement", es: "Cemento y construcción", en: "Cement and construction", words: ["cemento", "cementera", "cementeras", "concreto", "cement"] },
  { key: "mining", es: "Minería", en: "Mining", words: ["mineria", "minera", "mineras", "carbon", "oro", "mining"] },
  { key: "metals", es: "Metalurgia", en: "Metals", words: ["siderurgica", "siderurgia", "acero", "metalurgia", "steel", "fundicion"] },
  { key: "sugar", es: "Azúcar y etanol", en: "Sugar and ethanol", words: ["azucar", "ingenio", "ingenios", "etanol", "sugar"] },
  { key: "oilgas", es: "Petróleo y gas", en: "Oil and gas", words: ["petroleo", "gas", "oil", "refineria", "hidrocarburos"] },
  { key: "chemicals", es: "Química", en: "Chemicals", words: ["quimica", "quimicos", "chemical", "chemicals", "plasticos", "petroquimica"] },
  { key: "paper", es: "Papel y pulpa", en: "Paper and pulp", words: ["papel", "pulpa", "carton", "paper", "empaques"] },
  { key: "water", es: "Agua y saneamiento", en: "Water and sanitation", words: ["agua", "acueducto", "saneamiento", "water", "aguas residuales"] },
  { key: "energy", es: "Energía", en: "Energy", words: ["energia", "electrica", "hidroelectrica", "termoelectrica", "power", "energy"] },
  { key: "textile", es: "Textil", en: "Textile", words: ["textil", "textiles", "confeccion", "textile"] },
];
export const PLACES: { name: string; country: "CO" | "US"; words: string[] }[] = [
  { name: "Colombia", country: "CO", words: ["colombia", "colombiano", "colombiana", "colombianas", "colombianos"] },
  { name: "Antioquia", country: "CO", words: ["antioquia", "medellin"] },
  { name: "Valle del Cauca", country: "CO", words: ["valle", "valle del cauca", "cali", "tulua", "palmira"] },
  { name: "Bogotá / Cundinamarca", country: "CO", words: ["bogota", "cundinamarca", "sabana"] },
  { name: "Atlántico / Costa", country: "CO", words: ["barranquilla", "atlantico", "cartagena", "bolivar", "costa"] },
  { name: "Santanderes", country: "CO", words: ["santander", "bucaramanga", "barrancabermeja", "cucuta"] },
  { name: "Eje Cafetero", country: "CO", words: ["caldas", "manizales", "pereira", "risaralda", "armenia", "quindio", "eje cafetero"] },
  { name: "Estados Unidos", country: "US", words: ["estados unidos", "usa", "eeuu", "ee uu", "united states"] },
  { name: "Florida", country: "US", words: ["florida", "miami"] },
  { name: "Texas", country: "US", words: ["texas", "houston", "dallas"] },
  { name: "Puerto Rico", country: "US", words: ["puerto rico"] },
];

export type Structured = {
  name: string;
  purpose: string;
  scope: keyof typeof SCOPES;
  scopeText: string;
  industries: string[];
  places: string[];
  brands: string[];
  accounts: { id: string; name: string }[];
  /** What the rules could not tell: shown to the person, never filled with assumptions. */
  unknown: string[];
};

const has = (t: string, w: string) => ` ${t} `.includes(` ${fold(w)} `);

/** Turns "Explorar mercado lácteo colombiano para Alfa Laval, Siemens y SKF" into scope, sector, place,
 *  technologies and known companies. Only what is literally in the sentence; nothing invented. */
export function structureSentence(sentence: string, known: { accounts: { id: string; name: string }[] }): Structured {
  const raw = sentence.replace(/\s+/g, " ").trim().slice(0, 400);
  const t0 = fold(raw).replace(/[^a-z0-9ñ+ ]/g, " ").replace(/\s+/g, " ");
  const clean = (n: string) => fold(n.replace(/\s*\(ejemplo\)\s*$/i, "")).replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
  const accounts = known.accounts.filter((a) => { const n = clean(a.name); return n.length > 3 && ` ${t0} `.includes(` ${n} `); }).slice(0, 10);
  // A company's own name ("Lácteos del Valle") is not a sector or a territory: remove it before reading those.
  const t = accounts.reduce((s, a) => ` ${s} `.replace(` ${clean(a.name)} `, " ").trim(), t0);
  const industries = INDUSTRIES.filter((x) => x.words.some((w) => has(t, w))).map((x) => x.es);
  const places = PLACES.filter((p) => p.words.some((w) => has(t, w))).map((p) => p.name);
  const brands = [...new Set(BRANDS.filter((b) => [b.name, ...b.also].some((n) => fold(n).length > 2 && has(t, n))).map((b) => b.name))];

  const scope: Structured["scope"] = accounts.length === 1 && !industries.length ? "COMPANY" : industries.length ? "INDUSTRY" : brands.length ? "TECHNOLOGY" : places.length ? "TERRITORY" : accounts.length ? "COMPANY" : "APPLICATION";
  const scopeText = [industries.join(", "), places.join(", "), brands.length ? `${brands.join(", ")}` : "", accounts.map((a) => a.name).join(", ")].filter(Boolean).join(" · ");
  const unknown: string[] = [];
  if (!industries.length && !accounts.length) unknown.push("industry");
  if (!places.length && !accounts.length) unknown.push("place");
  const first = raw.charAt(0).toUpperCase() + raw.slice(1);
  const name = (scope === "COMPANY" && accounts[0] ? `Explorar ${accounts[0].name.replace(/\s*\(ejemplo\)$/, "")}` : first).replace(/[.;:]+$/, "").slice(0, 90);
  return { name, purpose: first, scope, scopeText, industries, places, brands, accounts, unknown };
}

// ---------- M2 · Company / Plant intelligence ----------

/** "How this account works" (§7): four blocks plus "what hurts". */
export const INSIGHT_BLOCKS: Record<string, L & { q: L }> = {
  OPERATE: { es: "Cómo operan", en: "How they operate", q: { es: "Qué producen, cómo y con qué ritmo", en: "What they make, how and at what pace" } },
  DECIDE: { es: "Cómo deciden", en: "How they decide", q: { es: "Quién detecta, especifica, valida, aprueba y libera", en: "Who detects, specifies, validates, approves and releases" } },
  BUY: { es: "Cómo compran", en: "How they buy", q: { es: "Portal, homologación, cotizaciones, urgencias, pago", en: "Portal, vendor approval, quotes, urgencies, payment" } },
  VALUE: { es: "Qué valoran", en: "What they value", q: { es: "Lo que han dicho o demostrado que les importa, con evidencia", en: "What they've said or shown matters to them, with evidence" } },
  HURT: { es: "Qué les duele", en: "What hurts", q: { es: "Qué afecta su continuidad", en: "What affects their continuity" } },
};
/** Functional areas (§4.6). Free text is also allowed. */
export const AREAS = ["Mantenimiento", "Compras", "Almacén", "Calidad / Laboratorio", "Ingeniería", "Proyectos", "Gerencia de planta", "Finanzas", "Producción"];
/** Decision Map steps (§4.16), in the order a need usually travels. */
export const DECIDE_STEPS: Record<string, L> = {
  DETECT: { es: "Detecta", en: "Detects" },
  SPECIFY: { es: "Especifica", en: "Specifies" },
  VALIDATE: { es: "Valida", en: "Validates" },
  REQUEST: { es: "Solicita", en: "Requests" },
  NEGOTIATE: { es: "Negocia", en: "Negotiates" },
  APPROVE: { es: "Aprueba", en: "Approves" },
  RELEASE: { es: "Libera el pago", en: "Releases payment" },
  RECEIVE: { es: "Recibe", en: "Receives" },
};
/** Buying Model topics (§4.17). */
export const BUY_TOPICS: Record<string, L> = {
  PORTAL: { es: "Portal obligatorio", en: "Mandatory portal" },
  HOMOLOGATION: { es: "Homologación de proveedores", en: "Vendor approval" },
  QUOTES: { es: "Número de cotizaciones", en: "Number of quotes" },
  URGENT: { es: "Compras urgentes", en: "Urgent purchases" },
  PAYMENT: { es: "Condiciones de pago", en: "Payment terms" },
  CURRENCY: { es: "Monedas", en: "Currencies" },
  APPROVAL: { es: "Aprobación", en: "Approval" },
  DOCS: { es: "Documentación exigida", en: "Required documents" },
  IMPORT: { es: "Local o importado", en: "Local or imported" },
  CONTRACT: { es: "Contrato marco o spot", en: "Framework or spot" },
  OTHER: { es: "Otro", en: "Other" },
};
/** Value Map topics (§4.18): expressed or demonstrated, never inferred personality. */
export const VALUE_TOPICS: Record<string, L> = {
  CONTINUITY: { es: "Continuidad", en: "Continuity" },
  SPEED: { es: "Rapidez", en: "Speed" },
  COMPATIBILITY: { es: "Compatibilidad", en: "Compatibility" },
  COMPLIANCE: { es: "Cumplimiento", en: "Delivering as promised" },
  SUPPORT: { es: "Soporte técnico", en: "Technical support" },
  WARRANTY: { es: "Garantía", en: "Warranty" },
  TRACEABILITY: { es: "Trazabilidad", en: "Traceability" },
  FINANCING: { es: "Financiación / plazo", en: "Financing / terms" },
  PRICE: { es: "Precio", en: "Price" },
  OTHER: { es: "Otro", en: "Other" },
};
export const REDUNDANCY: Record<string, L> = {
  NONE: { es: "Sin respaldo", en: "No backup" },
  PARTIAL: { es: "Respaldo parcial", en: "Partial backup" },
  FULL: { es: "Con respaldo", en: "Full backup" },
  UNKNOWN: { es: "Respaldo desconocido", en: "Backup unknown" },
};
export const STOPS_LINE: Record<string, L> = {
  YES: { es: "Para la línea", en: "Stops the line" },
  PARTIAL: { es: "Efecto parcial", en: "Partial effect" },
  NO: { es: "No para la línea", en: "Doesn't stop the line" },
  UNKNOWN: { es: "No sabemos si para la línea", en: "Unknown whether it stops the line" },
};
export const asBlock = (v?: string | null) => pick(INSIGHT_BLOCKS, v, "OPERATE");
export const asStep = (v?: string | null) => (v && v in DECIDE_STEPS ? v : null);
export const asBuyTopic = (v?: string | null) => pick(BUY_TOPICS, v, "OTHER");
export const asValueTopic = (v?: string | null) => pick(VALUE_TOPICS, v, "OTHER");
export const asRedundancy = (v?: string | null) => pick(REDUNDANCY, v, "UNKNOWN");
export const asStops = (v?: string | null) => pick(STOPS_LINE, v, "UNKNOWN");

/** Downtime cost per hour as a range (§8). REPORTED: the customer's own figures (one figure = min = max).
 *  GUIDED: min = units/h × contribution per unit (lost contribution); max = min + scrap/h + idle labor/h.
 *  Restart cost is one-time and shown apart, never spread into the hourly figure. Uses money.ts. */
export function impactRange(p: { level: string; costPerHourMin?: number | null; costPerHourMax?: number | null; unitsPerHour?: number | null; contributionUnit?: number | null; scrapPerHour?: number | null; idleLaborPerHour?: number | null }): { min: number; max: number; basis: L } | null {
  if (p.level === "GUIDED") {
    if (p.unitsPerHour == null || p.contributionUnit == null) return null;
    const min = mulMoney(p.contributionUnit, p.unitsPerHour);
    const max = sumMoney([min, p.scrapPerHour ?? 0, p.idleLaborPerHour ?? 0]);
    const extras = [p.scrapPerHour ? "desperdicio" : "", p.idleLaborPerHour ? "mano de obra parada" : ""].filter(Boolean);
    const extrasEn = [p.scrapPerHour ? "scrap" : "", p.idleLaborPerHour ? "idle labor" : ""].filter(Boolean);
    return { min, max, basis: { es: `Producción por hora × contribución por unidad${extras.length ? ` + ${extras.join(" + ")}` : ""}`, en: `Production per hour × contribution per unit${extrasEn.length ? ` + ${extrasEn.join(" + ")}` : ""}` } };
  }
  const a = p.costPerHourMin ?? p.costPerHourMax, b = p.costPerHourMax ?? p.costPerHourMin;
  if (a == null || b == null) return null;
  return { min: Math.min(a, b), max: Math.max(a, b), basis: { es: "Cifra dada por el cliente", en: "Figure given by the customer" } };
}

/** Discovery playbook (§6): Carnegie-phrased questions by what we still don't know. */
export type Discovery = { key: string; when: string; es: string; en: string };
export const PLAYBOOK: Discovery[] = [
  { key: "decide-flow", when: "DECIDE", es: "Desde que Mantenimiento identifica una necesidad hasta que se emite la orden, ¿cómo suele avanzar internamente?", en: "From the moment Maintenance spots a need until the order is issued, how does it usually move internally?" },
  { key: "decide-urgent", when: "DECIDE", es: "Cuando aparece una necesidad urgente como esta, ¿cómo suelen manejar el proceso internamente?", en: "When an urgent need like this comes up, how do you usually handle it internally?" },
  { key: "buy-portal", when: "BUY", es: "¿Hay algún paso, portal o registro que debamos cumplir para que trabajar con nosotros les resulte sencillo?", en: "Is there a step, portal or registration we should complete so working with us is easy for you?" },
  { key: "buy-quotes", when: "BUY", es: "Cuando comparan proveedores para un repuesto así, ¿qué les ayuda a decidir con tranquilidad?", en: "When you compare suppliers for a part like this, what helps you decide with confidence?" },
  { key: "value-factors", when: "VALUE", es: "¿Qué factores suelen pesar más cuando evalúan una solución de este tipo?", en: "What factors usually weigh most when you evaluate a solution like this?" },
  { key: "value-past", when: "VALUE", es: "Pensando en un proveedor con el que les haya ido muy bien, ¿qué hizo diferente?", en: "Thinking of a supplier that worked really well for you, what did they do differently?" },
  { key: "operate-lines", when: "OPERATE", es: "¿Nos cuentas cómo está organizada la planta: qué procesos y líneas tienen hoy?", en: "Could you tell us how the plant is organized: which processes and lines run today?" },
  { key: "asset-critical", when: "ASSET", es: "¿Qué equipo, si fallara mañana, les quitaría el sueño?", en: "Which piece of equipment, if it failed tomorrow, would keep you up at night?" },
  { key: "impact-stop", when: "IMPACT", es: "Cuando una línea como esta se detiene, ¿qué impacto empieza a tener en la operación?", en: "When a line like this stops, what impact does it start having on the operation?" },
  { key: "impact-time", when: "IMPACT", es: "¿Cuánto tiempo pueden sostener la producción si ese equipo falla: hay respaldo o inventario?", en: "How long can you keep producing if that equipment fails: is there a backup or stock?" },
  { key: "future-shutdown", when: "FUTURE", es: "¿Tienen prevista alguna parada o proyecto en los próximos meses en el que podamos prepararnos con tiempo?", en: "Do you have a shutdown or project coming up in the next months we could prepare for in time?" },
  { key: "people-who", when: "PEOPLE", es: "¿Con quién más sería útil conversar para entender bien esta necesidad?", en: "Who else would be useful to talk with to understand this need well?" },
];
/** Adaptive rule (§6.3): only questions about what we don't know yet, at most 5. Already-asked ones are skipped. */
export function suggestQuestions(known: { blocks: Set<string>; assets: number; impacts: number; futures: number; people: number }, asked: Set<string>, max = 5): Discovery[] {
  const missing = (w: string) => (w === "ASSET" ? known.assets === 0 : w === "IMPACT" ? known.impacts === 0 : w === "FUTURE" ? known.futures === 0 : w === "PEOPLE" ? known.people < 2 : !known.blocks.has(w));
  const out: Discovery[] = [];
  const seen = new Set<string>();
  // One question per missing topic first, then a second one if there's room.
  for (const pass of [0, 1]) for (const q of PLAYBOOK) {
    if (out.length >= max) break;
    if (!missing(q.when) || asked.has(q.es) || out.includes(q)) continue;
    if (pass === 0 && seen.has(q.when)) continue;
    seen.add(q.when); out.push(q);
  }
  return out;
}