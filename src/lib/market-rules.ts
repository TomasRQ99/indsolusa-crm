// Mercado (Módulo 09) — pure rules, no database: vocabulary, movement state, horizons and the
// rule-based structuring of a one-sentence exploration. AI is not connected yet; when it is, it
// proposes on top of these rules and the person still confirms (contract §16).
import { BRANDS, fold } from "./part-lexicon";

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
