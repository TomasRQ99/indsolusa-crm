// Módulo 15 · Gerencia — pure rules, no database.
// Gerencia coordinates the present and takes the company towards the direction it chose. These rules decide what
// counts as a complete decision, what a scenario must keep apart, where a function has a gap, when exceptions repeat
// enough to question a policy and when a figure moved enough to be worth saying. No score is ever produced.

type Txt = { es: string; en: string };
const tx = (es: string, en: string): Txt => ({ es, en });

// ---------- Functions (§23; purposes frozen by the official documents) ----------

export const FUNCTIONS = {
  MERCADEO: { ...tx("Mercadeo", "Marketing"), purpose: "Explora el mercado." },
  COMERCIAL: { ...tx("Comercial", "Commercial"), purpose: "Transa soluciones." },
  OPERACIONES: { ...tx("Operaciones", "Operations"), purpose: "Cumple con las soluciones." },
  ADMINISTRACION: { ...tx("Administración", "Administration"), purpose: "Administra los recursos de la empresa." },
  GERENCIA: { ...tx("Gerencia", "Management"), purpose: "Coordina el presente y nos lleva hacia la dirección elegida para el futuro." },
} as const;
export type FunctionKey = keyof typeof FUNCTIONS;
export const FUNCTION_KEYS = Object.keys(FUNCTIONS) as FunctionKey[];
/** A decision or a review belongs to a function, or to the team as a whole. */
export const AREAS: Record<string, Txt> = { ...FUNCTIONS, EQUIPO: tx("Equipo", "Team") };

// ---------- Policy (versioned; Gerencia changes it) ----------

export const GERENCIA_POLICY_KEY = "gerenciaPolicy";
export type GerenciaPolicy = {
  /** an automatic matter enters Decisions Needed only from this impact in USD. 0 = every one. Requests made by a person always enter. */
  decisionMaterialUsd: number;
  /** most matters shown at once on the Home; the rest stay one click away */
  queueMax: number;
  /** share (%) of one customer or supplier from which SOLU says "concentration" */
  concentrationPct: number;
  /** the same kind of exception this many times… */
  patternCount: number;
  /** …inside this many days suggests reviewing the policy */
  patternDays: number;
  /** a function charter older than this many days asks to be reviewed */
  charterReviewDays: number;
  /** change (%) of a watched figure between two daily pictures that counts as material */
  changePct: number;
  /** roles that may publish the company identity and the function charters */
  publishRoles: string[];
};
/** Starting values, to be confirmed by Gerencia (decision G-04). */
export const DEFAULT_GERENCIA_POLICY: GerenciaPolicy = { decisionMaterialUsd: 0, queueMax: 9, concentrationPct: 30, patternCount: 3, patternDays: 90, charterReviewDays: 365, changePct: 20, publishRoles: ["GERENCIA"] };
const num = (x: unknown) => { const s = String(x ?? "").trim().replace(",", "."); const n = Number(s); return s !== "" && Number.isFinite(n) ? n : NaN; };
export function cleanGerenciaPolicy(v: unknown, validRoles: readonly string[]): GerenciaPolicy | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const mat = num(o.decisionMaterialUsd), max = Math.round(num(o.queueMax)), conc = num(o.concentrationPct), pc = Math.round(num(o.patternCount)), pd = Math.round(num(o.patternDays)), rev = Math.round(num(o.charterReviewDays)), chg = num(o.changePct);
  const roles = [...new Set((Array.isArray(o.publishRoles) ? o.publishRoles : []).map(String).filter((r) => validRoles.includes(r)))];
  // Gerencia can never be left out of its own authority: otherwise nobody could put it back.
  if (!roles.includes("GERENCIA")) return null;
  if (!(mat >= 0 && mat <= 1e9) || !(max >= 3 && max <= 30) || !(conc >= 5 && conc <= 100) || !(pc >= 2 && pc <= 50) || !(pd >= 7 && pd <= 730) || !(rev >= 30 && rev <= 1825) || !(chg >= 1 && chg <= 500)) return null;
  return { decisionMaterialUsd: Math.round(mat * 100) / 100, queueMax: max, concentrationPct: Math.round(conc * 10) / 10, patternCount: pc, patternDays: pd, charterReviewDays: rev, changePct: Math.round(chg * 10) / 10, publishRoles: roles };
}
export const readGerenciaPolicy = (v: unknown): GerenciaPolicy => {
  const o = (v && typeof v === "object" ? v : {}) as Partial<GerenciaPolicy>;
  const p = { ...DEFAULT_GERENCIA_POLICY, ...o };
  return { ...p, publishRoles: Array.isArray(p.publishRoles) && p.publishRoles.includes("GERENCIA") ? p.publishRoles : DEFAULT_GERENCIA_POLICY.publishRoles };
};
/** §26: only the configured authority publishes an identity or a charter. */
export const canPublish = (role: string, p: GerenciaPolicy) => p.publishRoles.includes(role);

// ---------- Text helpers for forms ----------

/** One item per line; empty lines and repeated items are dropped. */
export function parseLines(text: string | null | undefined, max = 30, maxLen = 300): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const s = raw.replace(/^\s*[-•*]\s*/, "").trim().slice(0, maxLen);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
/** "Name: detail" per line. A line without a colon is a name with no detail. */
export function parsePairs(text: string | null | undefined, max = 12): { name: string; detail: string }[] {
  return parseLines(text, max, 700).map((l) => { const k = l.indexOf(":"); return k > 0 ? { name: l.slice(0, k).trim().slice(0, 120), detail: l.slice(k + 1).trim() } : { name: l.slice(0, 120), detail: "" }; }).filter((p) => p.name);
}
export const pairsText = (xs: { name: string; detail?: string | null }[]) => xs.map((x) => (x.detail ? `${x.name}: ${x.detail}` : x.name)).join("\n");
export const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
export const asPairs = (v: unknown, a = "name", b = "detail"): { name: string; detail: string }[] =>
  (Array.isArray(v) ? v : []).map((x) => (x && typeof x === "object" ? x : {}) as Record<string, unknown>).map((x) => ({ name: String(x[a] ?? "").trim(), detail: String(x[b] ?? "").trim() })).filter((x) => x.name);

// ---------- Management Decision Record (§4, AC7, AC16, AC20) ----------

export const DECISION_KINDS: Record<string, Txt> = {
  GENERAL: tx("Decisión de dirección", "Direction decision"),
  RESOURCE_ALLOCATION: tx("Asignación de recursos", "Resource allocation"),
  POLICY_EXCEPTION: tx("Excepción a una política", "Exception to a policy"),
};
export const VERDICTS: Record<string, Txt & { tone: string }> = {
  AS_EXPECTED: { ...tx("Pasó lo esperado", "It went as expected"), tone: "ok" },
  BETTER: { ...tx("Resultó mejor de lo esperado", "It went better than expected"), tone: "ok" },
  WORSE: { ...tx("Resultó peor de lo esperado", "It went worse than expected"), tone: "risk" },
  MIXED: { ...tx("Parte sí, parte no", "Partly yes, partly no"), tone: "attn" },
  TOO_EARLY: { ...tx("Todavía es pronto para saberlo", "Too early to tell"), tone: "wait" },
};
export type DecisionRequest = { area: string | null; question: string | null; context: string | null; impact: string | null; facts: string | null; alternatives: { name: string; detail: string }[] };
/** What a request must carry before it may interrupt Gerencia. Returns the missing parts (empty = complete). */
export function requestIssues(r: DecisionRequest): string[] {
  const out: string[] = [];
  if (!r.area || !(r.area in AREAS)) out.push("area");
  if (!r.question) out.push("question");
  if (!r.context) out.push("context");
  if (!r.impact) out.push("impact");
  if (!r.facts) out.push("facts");
  // One option is not a decision: at least two, and "do nothing" counts as one.
  if (r.alternatives.length < 2) out.push("alternatives");
  return out;
}
export type DecisionOutcome = { decision: string | null; rationale: string | null; authority: string | null; expectedConsequence: string | null; followUpOn: Date | null; decidedOn: Date };
/** A decision keeps what was decided, why, under which authority, what is expected of it and when to look again. */
export function decideIssues(o: DecisionOutcome): string[] {
  const out: string[] = [];
  if (!o.decision) out.push("decision");
  if (!o.rationale) out.push("rationale");
  if (!o.authority) out.push("authority");
  if (!o.expectedConsequence) out.push("expectedConsequence");
  if (!o.followUpOn) out.push("followUpOn");
  else if (o.followUpOn < o.decidedOn) out.push("followUpPast");
  return out;
}
export type DecisionFacts = { status: string; supersededAt: Date | null; deadline: Date | null; followUpOn: Date | null; reviews: { verdict: string; nextFollowUpOn: Date | null; createdAt: Date }[] };
export type DecisionStage = "REPLACED" | "WITHDRAWN" | "WAITING" | "OVERDUE" | "DECIDED" | "REVIEW_DUE" | "REVIEWED";
/** Where a decision stands today. A review marked "too early" moves the follow-up to its new date. */
export function decisionStage(d: DecisionFacts, now: Date): { stage: DecisionStage; reviewOn: Date | null } {
  if (d.supersededAt) return { stage: "REPLACED", reviewOn: null };
  if (d.status === "WITHDRAWN") return { stage: "WITHDRAWN", reviewOn: null };
  if (d.status !== "DECIDED") return { stage: d.deadline && d.deadline < now ? "OVERDUE" : "WAITING", reviewOn: null };
  const last = [...d.reviews].sort((a, b) => +b.createdAt - +a.createdAt)[0];
  if (last && last.verdict !== "TOO_EARLY") return { stage: "REVIEWED", reviewOn: null };
  const reviewOn = last ? last.nextFollowUpOn : d.followUpOn;
  return { stage: reviewOn && reviewOn <= now ? "REVIEW_DUE" : "DECIDED", reviewOn };
}
export const DECISION_STAGE: Record<DecisionStage, Txt & { tone: string }> = {
  WAITING: { ...tx("Espera decisión", "Awaiting decision"), tone: "attn" },
  OVERDUE: { ...tx("Pasó su fecha sin decisión", "Past its date with no decision"), tone: "risk" },
  DECIDED: { ...tx("Decidida", "Decided"), tone: "ok" },
  REVIEW_DUE: { ...tx("Toca revisar qué pasó", "Time to review what happened"), tone: "attn" },
  REVIEWED: { ...tx("Revisada contra lo que pasó", "Reviewed against what happened"), tone: "wait" },
  REPLACED: { ...tx("Reemplazada por una versión nueva", "Replaced by a newer version"), tone: "wait" },
  WITHDRAWN: { ...tx("Retirada", "Withdrawn"), tone: "wait" },
};
/** DG-2611-0007 */
export const decisionCode = (now: Date, lastCode: string | null) => {
  const start = `DG-${String(now.getUTCFullYear()).slice(2)}${String(now.getUTCMonth() + 1).padStart(2, "0")}-`;
  const n = lastCode && lastCode.startsWith(start) ? Number(lastCode.slice(start.length)) || 0 : 0;
  return `${start}${String(n + 1).padStart(4, "0")}`;
};

// ---------- Decisions Needed: what may interrupt Gerencia (§2C, AC2, AC3) ----------

export type QueueEntry = { key: string; requested: boolean; impactUsd: number | null; deadline: Date | null };
/** People's requests always enter. Automatic matters enter from the policy's impact (one with no amount is kept:
 *  SOLU cannot call it small). Order: past its date, then nearest date, then bigger impact. Never more than `max`. */
export function rankQueue<T extends QueueEntry>(items: T[], p: Pick<GerenciaPolicy, "decisionMaterialUsd" | "queueMax">, now: Date): { shown: T[]; later: T[]; belowMateriality: number } {
  const material = items.filter((x) => x.requested || x.impactUsd == null || Math.abs(x.impactUsd) >= p.decisionMaterialUsd);
  const late = (x: T) => (x.deadline && x.deadline < now ? 0 : 1);
  const sorted = [...material].sort((a, b) => late(a) - late(b) || (a.deadline ? +a.deadline : 9e15) - (b.deadline ? +b.deadline : 9e15) || Math.abs(b.impactUsd ?? 0) - Math.abs(a.impactUsd ?? 0) || a.key.localeCompare(b.key));
  return { shown: sorted.slice(0, p.queueMax), later: sorted.slice(p.queueMax), belowMateriality: items.length - material.length };
}

// ---------- Scenarios (§7, AC8) ----------

export const SCENARIO_KINDS: Record<string, Txt> = {
  LOW_ESAGARA_ENTRY: tx("Aceptar un negocio de Eságara baja para entrar a una cuenta", "Accept a low-Eságara deal to enter an account"),
  CREDIT_INCREASE: tx("Aumentar un cupo de crédito", "Raise a credit limit"),
  FINANCE_PURCHASE: tx("Financiar una compra", "Finance a purchase"),
  BUY_STOCK: tx("Comprar inventario", "Buy stock"),
  ASSIGN_PEOPLE: tx("Asignar una persona o dupla a una cuenta", "Assign a person or pair to an account"),
  EXPEDITE_IMPORT: tx("Acelerar una importación", "Expedite an import"),
  OTHER: tx("Otro", "Other"),
};
export type ScenarioOption = { name: string; description: string; assumptions: string; low: number | null; high: number | null; risks: string };
/** Reads the options of a form: option fields arrive as name_0, assumptions_0, low_0… Rows with no name are skipped. */
export function readOptions(get: (k: string) => string, rows = 4): ScenarioOption[] {
  const out: ScenarioOption[] = [];
  for (let k = 0; k < rows; k++) {
    const name = get(`name_${k}`).trim().slice(0, 120);
    if (!name) continue;
    const n = (s: string) => { const v = num(s); return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; };
    out.push({ name, description: get(`description_${k}`).trim().slice(0, 600), assumptions: get(`assumptions_${k}`).trim().slice(0, 800), low: n(get(`low_${k}`)), high: n(get(`high_${k}`)), risks: get(`risks_${k}`).trim().slice(0, 600) });
  }
  return out;
}
export const asOptions = (v: unknown): ScenarioOption[] =>
  (Array.isArray(v) ? v : []).map((x) => (x && typeof x === "object" ? x : {}) as Record<string, unknown>).map((x) => ({ name: String(x.name ?? ""), description: String(x.description ?? ""), assumptions: String(x.assumptions ?? ""), low: typeof x.low === "number" ? x.low : null, high: typeof x.high === "number" ? x.high : null, risks: String(x.risks ?? "") })).filter((x) => x.name);
/** A scenario is not a forecast: it needs facts, a named measure, two options or more, and for every option its
 *  assumptions and a range (low ≤ high). A single number is refused: that would be a certain forecast. */
export function scenarioIssues(s: { title: string | null; question: string | null; facts: string | null; measure: string | null; options: ScenarioOption[] }): string[] {
  const out: string[] = [];
  if (!s.title) out.push("title");
  if (!s.question) out.push("question");
  if (!s.facts) out.push("facts");
  if (!s.measure) out.push("measure");
  if (s.options.length < 2) out.push("options");
  if (new Set(s.options.map((o) => o.name.toLowerCase())).size !== s.options.length) out.push("optionNames");
  if (s.options.some((o) => !o.assumptions)) out.push("assumptions");
  if (s.options.some((o) => o.low == null || o.high == null)) out.push("range");
  else if (s.options.some((o) => o.low! > o.high!)) out.push("rangeOrder");
  return out;
}
/** Do two options' ranges overlap? When they do, the scenario cannot say one is better: it depends on the assumptions. */
export const rangesOverlap = (a: ScenarioOption, b: ScenarioOption) => a.low != null && a.high != null && b.low != null && b.high != null && a.low <= b.high && b.low <= a.high;

// ---------- Strategic priorities (§3, AC9) ----------

export const LINK_KINDS: Record<string, Txt> = {
  ACCOUNT: tx("Cliente", "Customer"), JOURNEY: tx("Journey", "Journey"), EXPLORATION: tx("Exploración de mercado", "Market exploration"),
  DECISION: tx("Decisión de Gerencia", "Management decision"), SCENARIO: tx("Escenario", "Scenario"),
};
export const PRIORITY_STATUS: Record<string, Txt & { tone: string }> = {
  ACTIVE: { ...tx("Vigente", "Active"), tone: "info" }, ACHIEVED: { ...tx("Lograda", "Achieved"), tone: "ok" }, DROPPED: { ...tx("Abandonada", "Dropped"), tone: "wait" },
};
export function priorityIssues(p: { title: string | null; rationale: string | null; desiredOutcome: string | null; horizon: string | null; ownerOk: boolean; indicators: unknown[] }): string[] {
  const out: string[] = [];
  if (!p.title) out.push("title");
  if (!p.rationale) out.push("rationale");
  if (!p.desiredOutcome) out.push("desiredOutcome");
  if (!p.horizon) out.push("horizon");
  if (!p.ownerOk) out.push("owner");
  if (p.indicators.length === 0) out.push("indicators");
  return out;
}
/** What a priority is missing to connect direction with real work (shown, never blocking). */
export function priorityHealth(p: { status: string; links: number; nextReviewOn: Date | null; narrativeAt: Date | null }, now: Date): ("NO_LINKS" | "REVIEW_DUE" | "NO_NARRATIVE")[] {
  if (p.status !== "ACTIVE") return [];
  const out: ("NO_LINKS" | "REVIEW_DUE" | "NO_NARRATIVE")[] = [];
  if (p.links === 0) out.push("NO_LINKS");
  if (p.nextReviewOn && p.nextReviewOn <= now) out.push("REVIEW_DUE");
  if (!p.narrativeAt) out.push("NO_NARRATIVE");
  return out;
}

// ---------- Company identity (§22, §26) ----------

export type IdentityInput = { purpose: string | null; slogan: string | null; valueProposition: string | null; attributes: string[]; principles: { name: string; detail: string }[]; methodologies: { name: string; detail: string }[]; effectiveFrom: Date | null; reason: string | null };
export function identityIssues(i: IdentityInput): string[] {
  const out: string[] = [];
  if (!i.purpose) out.push("purpose");
  if (!i.slogan) out.push("slogan");
  if (!i.valueProposition) out.push("valueProposition");
  if (i.attributes.length === 0) out.push("attributes");
  if (i.principles.length === 0) out.push("principles");
  if (!i.effectiveFrom) out.push("effectiveFrom");
  if (!i.reason) out.push("reason");
  return out;
}
/** The version in force on a day: the highest version whose date has arrived. */
export function inForce<V extends { version: number; effectiveFrom: Date }>(versions: V[], on: Date): V | null {
  return [...versions].filter((v) => v.effectiveFrom <= on).sort((a, b) => b.version - a.version)[0] ?? null;
}
/** Which parts differ between two versions of the same thing (identity or charter). Order of list items is ignored. */
export function changedFields(a: Record<string, unknown>, b: Record<string, unknown>, fields: readonly string[]): string[] {
  // The database may hand an object's keys back in another order: compare with the keys sorted.
  const canon = (x: unknown): string => (x && typeof x === "object" && !Array.isArray(x) ? JSON.stringify(Object.keys(x as object).sort().map((k) => [k, String((x as Record<string, unknown>)[k] ?? "").trim()])) : String(x ?? "").trim());
  const norm = (v: unknown): string => (Array.isArray(v) ? JSON.stringify(v.map(canon).sort()) : v == null ? "" : canon(v));
  return fields.filter((f) => norm(a[f]) !== norm(b[f]));
}

// ---------- Function governance (§23) ----------

export type CharterView = { functionKey: string; version: number; purpose: string; outputs: string[]; responsibilities: string[]; decisionRights: string[]; interfaces: { name: string; detail: string }[]; resources: string | null; ownerId: string | null; ownerActive: boolean; effectiveFrom: Date };
export type GapKind = "NO_CHARTER" | "NO_OWNER" | "OWNER_INACTIVE" | "DUPLICATE" | "INTERFACE_ONE_SIDED" | "INTERFACE_VAGUE" | "NO_AUTHORITY" | "NO_RESOURCES" | "NO_OUTPUTS" | "REVIEW_DUE";
export const GAP_TEXT: Record<GapKind, Txt & { tone: "risk" | "attn" }> = {
  NO_CHARTER: { ...tx("Función sin carta publicada", "Function with no published charter"), tone: "risk" },
  NO_OWNER: { ...tx("Función sin dueño", "Function with no owner"), tone: "risk" },
  OWNER_INACTIVE: { ...tx("El dueño ya no está activo en SOLU", "The owner is no longer active in SOLU"), tone: "risk" },
  DUPLICATE: { ...tx("Responsabilidad duplicada", "Duplicated responsibility"), tone: "attn" },
  INTERFACE_ONE_SIDED: { ...tx("Interfaz ambigua: solo un lado la nombra", "Ambiguous interface: only one side names it"), tone: "attn" },
  INTERFACE_VAGUE: { ...tx("Interfaz ambigua: no dice qué se entrega", "Ambiguous interface: it doesn't say what is handed over"), tone: "attn" },
  NO_AUTHORITY: { ...tx("Autoridad insuficiente: responde por algo y no decide nada", "Insufficient authority: it answers for something and decides nothing"), tone: "risk" },
  NO_RESOURCES: { ...tx("Responsabilidades sin recursos o capacidad declarados", "Responsibilities with no resources or capacity stated"), tone: "attn" },
  NO_OUTPUTS: { ...tx("No dice qué entrega", "It doesn't say what it delivers"), tone: "attn" },
  REVIEW_DUE: { ...tx("Carta sin revisar hace más de lo que pide la política", "Charter not reviewed for longer than the policy asks"), tone: "attn" },
};
export type CharterGap = { functionKey: string; kind: GapKind; detail: string | null; other: string | null };
const normText = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Every gap of §23 that can be read from the charters in force. `charters` holds one (the one in force) per function. */
export function charterGaps(charters: CharterView[], now: Date, reviewDays: number): CharterGap[] {
  const out: CharterGap[] = [];
  const by = new Map(charters.map((c) => [c.functionKey, c]));
  for (const key of FUNCTION_KEYS) {
    const c = by.get(key);
    if (!c) { out.push({ functionKey: key, kind: "NO_CHARTER", detail: null, other: null }); continue; }
    if (!c.ownerId) out.push({ functionKey: key, kind: "NO_OWNER", detail: null, other: null });
    else if (!c.ownerActive) out.push({ functionKey: key, kind: "OWNER_INACTIVE", detail: null, other: null });
    if (c.outputs.length === 0) out.push({ functionKey: key, kind: "NO_OUTPUTS", detail: null, other: null });
    if (c.responsibilities.length > 0 && c.decisionRights.length === 0) out.push({ functionKey: key, kind: "NO_AUTHORITY", detail: null, other: null });
    if (c.responsibilities.length > 0 && !(c.resources ?? "").trim()) out.push({ functionKey: key, kind: "NO_RESOURCES", detail: null, other: null });
    if ((+now - +c.effectiveFrom) / 864e5 > reviewDays) out.push({ functionKey: key, kind: "REVIEW_DUE", detail: null, other: null });
    for (const i of c.interfaces) {
      if (!i.detail.trim()) out.push({ functionKey: key, kind: "INTERFACE_VAGUE", detail: i.name, other: i.name in FUNCTIONS ? i.name : null });
      const other = by.get(i.name);
      // An interface has two ends. When the other function's charter doesn't name this one back, nobody agreed it.
      if (other && !other.interfaces.some((x) => x.name === key)) out.push({ functionKey: key, kind: "INTERFACE_ONE_SIDED", detail: i.detail || null, other: i.name });
    }
  }
  // The same responsibility written in two charters: reported once, on the first function, naming the other.
  const seen = new Map<string, { key: string; text: string }>();
  for (const key of FUNCTION_KEYS) for (const r of by.get(key)?.responsibilities ?? []) {
    const n = normText(r);
    if (!n) continue;
    const first = seen.get(n);
    if (first && first.key !== key) out.push({ functionKey: first.key, kind: "DUPLICATE", detail: first.text, other: key });
    else if (!first) seen.set(n, { key, text: r });
  }
  return out;
}
export function charterIssues(c: { functionKey: string | null; purpose: string | null; effectiveFrom: Date | null; reason: string | null; interfaces: { name: string }[] }): string[] {
  const out: string[] = [];
  if (!c.functionKey || !(c.functionKey in FUNCTIONS)) out.push("functionKey");
  if (!c.purpose) out.push("purpose");
  if (!c.effectiveFrom) out.push("effectiveFrom");
  if (!c.reason) out.push("reason");
  if (c.interfaces.some((i) => !(i.name in FUNCTIONS) || i.name === c.functionKey)) out.push("interfaces");
  return out;
}
/** Form helper: "Comercial: entrega la necesidad escrita" → { name: "COMERCIAL", detail }. Accepts the key or the Spanish / English name. */
export function parseInterfaces(text: string | null | undefined): { name: string; detail: string }[] {
  const find = (s: string) => { const n = normText(s); return FUNCTION_KEYS.find((k) => k.toLowerCase() === n || normText(FUNCTIONS[k].es) === n || normText(FUNCTIONS[k].en) === n) ?? s.trim().toUpperCase(); };
  return parsePairs(text, 8).map((p) => ({ name: find(p.name), detail: p.detail }));
}

// ---------- Role clarity (§24, §26) ----------

export type RoleProfileLike = { purpose?: string | null; outcomes?: unknown[] | null; responsibilities?: unknown[] | null; decisionRights?: unknown[] | null; boundaries?: unknown[] | null };
export const ROLE_PARTS: Record<string, Txt> = { purpose: tx("propósito", "purpose"), outcomes: tx("resultados esperados", "expected outcomes"), responsibilities: tx("responsabilidades", "responsibilities"), decisionRights: tx("qué puede decidir", "decision rights"), boundaries: tx("límites", "boundaries") };
/** A role is "clear" only with purpose, outcomes, responsibilities, decision rights and boundaries. No profile = not clear. */
export function roleClarity(p: RoleProfileLike | null | undefined): { clear: boolean; missing: string[] } {
  if (!p) return { clear: false, missing: Object.keys(ROLE_PARTS) };
  const missing: string[] = [];
  if (!(p.purpose ?? "").trim()) missing.push("purpose");
  for (const k of ["outcomes", "responsibilities", "decisionRights", "boundaries"] as const) if (!Array.isArray(p[k]) || p[k]!.length === 0) missing.push(k);
  return { clear: missing.length === 0, missing };
}

// ---------- Concentration and recurring exceptions (§8, §18, AC12, AC14) ----------

export type Share = { key: string; name: string; value: number; pct: number };
/** Each item's share of the total, biggest first, and those at or above the policy's percentage. Not a score:
 *  the answer is "this customer is 42 % of that", with the amounts behind it. */
export function concentration(items: { key: string; name: string; value: number }[], thresholdPct: number): { total: number; shares: Share[]; flagged: Share[] } {
  const pos = items.filter((x) => x.value > 0.005);
  const total = Math.round(pos.reduce((s, x) => s + x.value, 0) * 100) / 100;
  const shares = pos.map((x) => ({ ...x, value: Math.round(x.value * 100) / 100, pct: total > 0 ? Math.round((x.value / total) * 1000) / 10 : 0 })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  // One item alone is 100 % of itself: that says nothing about concentration.
  return { total, shares, flagged: shares.length > 1 ? shares.filter((s) => s.pct >= thresholdPct) : [] };
}
export type ExceptionRow = { policy: string; group: string; label: string; at: Date; href: string; usd?: number | null };
export type ExceptionPattern = { policy: string; group: string; label: string; n: number; usd: number; first: Date; last: Date; rows: ExceptionRow[] };
/** The same exception to the same policy, repeated: `count` times or more inside `days`. That is a question about the
 *  policy, not about the people who asked. */
export function recurring(rows: ExceptionRow[], p: Pick<GerenciaPolicy, "patternCount" | "patternDays">, now: Date): ExceptionPattern[] {
  const from = +now - p.patternDays * 864e5;
  const g = new Map<string, ExceptionRow[]>();
  for (const r of rows) { if (+r.at < from || +r.at > +now + 864e5) continue; const k = `${r.policy}|${r.group}`; g.set(k, [...(g.get(k) ?? []), r]); }
  return [...g.values()].filter((xs) => xs.length >= p.patternCount).map((xs) => {
    const s = [...xs].sort((a, b) => +a.at - +b.at);
    return { policy: s[0].policy, group: s[0].group, label: s[0].label, n: s.length, usd: Math.round(s.reduce((t, x) => t + (x.usd ?? 0), 0) * 100) / 100, first: s[0].at, last: s[s.length - 1].at, rows: s };
  }).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

// ---------- What changed between two daily pictures (§14) ----------

export type Watched = Record<string, number>;
export type Change = { key: string; from: number; to: number; pct: number | null };
/** Figures that moved by the policy's percentage or more. From zero to something is a change with no percentage. */
export function materialChanges(prev: Watched | null, cur: Watched, changePct: number): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  for (const k of Object.keys(cur)) {
    if (!(k in prev)) continue;
    const a = prev[k], b = cur[k];
    if (Math.abs(b - a) < 0.005) continue;
    if (Math.abs(a) < 0.005) { out.push({ key: k, from: a, to: b, pct: null }); continue; }
    const pct = Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
    if (Math.abs(pct) >= changePct) out.push({ key: k, from: a, to: b, pct });
  }
  return out;
}

// ---------- Future Bridge (§16–17): each stage has its own truth; they are never added together ----------

export const BRIDGE_STAGES = [
  { key: "OPPORTUNITY", ...tx("Oportunidad futura", "Future opportunity"), truth: tx("Algo que alguien vio venir. No tiene valor asignado.", "Something someone saw coming. It carries no value.") },
  { key: "NEED", ...tx("Necesidad", "Need"), truth: tx("El cliente dijo qué resultado busca. Sin cotización todavía.", "The customer said what result they want. No quote yet.") },
  { key: "QUOTE", ...tx("Cotización", "Quote"), truth: tx("Hay precio y costo calculados, aún sin presentar.", "Price and cost are calculated, not presented yet.") },
  { key: "DECISION", ...tx("Decisión del cliente", "Customer decision"), truth: tx("Presentada: el cliente decide. Puede ser sí o no.", "Presented: the customer decides. It may be yes or no.") },
  { key: "CONTRACTED", ...tx("Orden aceptada", "Order accepted"), truth: tx("Hay orden de compra aceptada: es un compromiso de las dos partes.", "There is an accepted purchase order: a commitment on both sides.") },
  { key: "EXECUTION", ...tx("En ejecución", "In execution"), truth: tx("Comprado o en camino: la Eságara depende de costos reales.", "Bought or on its way: Eságara depends on real costs.") },
  { key: "INVOICE", ...tx("Por facturar", "To invoice"), truth: tx("Entregado sin factura todavía.", "Delivered, no invoice yet.") },
  { key: "COLLECTION", ...tx("Por cobrar", "To collect"), truth: tx("Facturado: falta que el dinero llegue y se concilie.", "Invoiced: the money still has to arrive and be reconciled.") },
] as const;
export type BridgeKey = (typeof BRIDGE_STAGES)[number]["key"];

/** One accepted order, split by where its value stands. Each part carries its share of the protected Eságara.
 *  `started` = something was already bought, committed from stock or dispatched for it. */
export function bridgeSplit(d: { sale: number; esagara: number; invoiced: number; deliveredNotInvoiced: number; started: boolean }) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const toInvoice = r2(Math.max(0, Math.min(d.deliveredNotInvoiced, d.sale - d.invoiced)));
  const rest = r2(Math.max(0, d.sale - d.invoiced - toInvoice));
  const share = (part: number) => (d.sale > 0 ? r2((d.esagara * part) / d.sale) : 0);
  return {
    contracted: d.started ? 0 : rest, executing: d.started ? rest : 0, toInvoice,
    esagara: { contracted: d.started ? 0 : share(rest), executing: d.started ? share(rest) : 0, toInvoice: share(toInvoice) },
  };
}

// ---------- Reading a rate against its own past (§20): learning, not grading ----------

export type Trend = "UP" | "DOWN" | "SAME" | "THIN";
/** Compares a share now with the same share before. Under `minSample` cases on either side it says "too little data". */
export function trendOf(cur: { num: number; den: number }, base: { num: number; den: number }, minSample = 5, minPts = 5): { cur: number | null; base: number | null; trend: Trend } {
  const c = cur.den > 0 ? (cur.num / cur.den) * 100 : null, b = base.den > 0 ? (base.num / base.den) * 100 : null;
  if (c == null || b == null || cur.den < minSample || base.den < minSample) return { cur: c, base: b, trend: "THIN" };
  const d = c - b;
  return { cur: c, base: b, trend: Math.abs(d) < minPts ? "SAME" : d > 0 ? "UP" : "DOWN" };
}
