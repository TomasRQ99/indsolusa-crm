// Módulo 16 · Equipo & Desarrollo — pure rules, no database.
// Equipo exists to know, develop and place people better. It does not classify to limit: it knows in order to
// accompany. These rules decide who may read what (privacy), what counts as character evidence, what a role
// agreement needs, when a development objective may close, who is a qualified backup and what a handover must
// move. No score is ever produced for a person.

import { FUNCTIONS, parseLines, parsePairs, roleClarity, type FunctionKey } from "./gerencia-rules";

type Txt = { es: string; en: string };
const tx = (es: string, en: string): Txt => ({ es, en });
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export const normText = norm;

// ---------- Policy (versioned; Gerencia changes it) ----------

export const TEAM_POLICY_KEY = "teamPolicy";
export type Dim = "SER" | "HACER" | "TENER";
export type TeamPolicy = {
  /** length of a development cycle in days (§5) */
  cycleDays: number;
  /** days of the cycle on which person and leader meet (§5) */
  checkpoints: number[];
  /** how many priorities a cycle holds per dimension (§5) */
  limits: Record<Dim, { min: number; max: number }>;
  /** character dimensions evidence can be recorded for (§3) */
  dimensions: string[];
};
/** The values the official document gives (§3, §5). Gerencia may change them; nothing here is invented. */
export const DEFAULT_TEAM_POLICY: TeamPolicy = {
  cycleDays: 90, checkpoints: [0, 30, 60, 90],
  limits: { SER: { min: 2, max: 3 }, HACER: { min: 2, max: 3 }, TENER: { min: 1, max: 2 } },
  dimensions: ["Verdad", "Responsabilidad", "Humildad", "Respeto", "Cristalinidad / Transparencia", "Servicio", "Trabajo en Equipo"],
};
const int = (x: unknown) => { const s = String(x ?? "").trim(); const n = Number(s); return s !== "" && Number.isInteger(n) ? n : NaN; };
export function cleanTeamPolicy(v: unknown): TeamPolicy | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const cycle = int(o.cycleDays);
  if (!(cycle >= 30 && cycle <= 365)) return null;
  const raw = Array.isArray(o.checkpoints) ? o.checkpoints : String(o.checkpoints ?? "").split(/[,;\s]+/).filter(Boolean);
  const cps = [...new Set(raw.map(int))].sort((a, b) => a - b);
  if (cps.length < 2 || cps.length > 12 || cps.some((c) => !(c >= 0 && c <= cycle))) return null;
  const limits = {} as TeamPolicy["limits"];
  for (const d of ["SER", "HACER", "TENER"] as const) {
    const src = (o.limits && typeof o.limits === "object" ? (o.limits as Record<string, { min?: unknown; max?: unknown }>)[d] : undefined) ?? { min: o[`${d}_min`], max: o[`${d}_max`] };
    const min = int(src.min), max = int(src.max);
    if (!(min >= 0 && max >= 1 && min <= max && max <= 10)) return null;
    limits[d] = { min, max };
  }
  const dims = Array.isArray(o.dimensions) ? o.dimensions.map(String).map((s) => s.trim()).filter(Boolean) : parseLines(String(o.dimensions ?? ""), 20, 80);
  const unique = dims.filter((d, k) => dims.findIndex((x) => norm(x) === norm(d)) === k).map((d) => d.slice(0, 80));
  if (unique.length < 1 || unique.length > 20) return null;
  return { cycleDays: cycle, checkpoints: cps, limits, dimensions: unique };
}
export const readTeamPolicy = (v: unknown): TeamPolicy => cleanTeamPolicy(v) ?? DEFAULT_TEAM_POLICY;

// ---------- Privacy (§12, AC3, AC8) ----------

export const PRIVACY: Record<string, Txt & { who: Txt }> = {
  PRIVATE: { ...tx("Privado", "Private"), who: tx("solo yo", "only me") },
  SHARED: { ...tx("Compartido", "Shared"), who: tx("mi líder y mi mentor", "my leader and my mentor") },
  ORG: { ...tx("Organización", "Organisation"), who: tx("mi líder, mi mentor y Gerencia; cuenta en el mapa de talentos", "my leader, my mentor and Management; counts in the talent map") },
};
/** How the viewer stands towards the person whose record it is. */
export type Relation = { self: boolean; leader: boolean; mentor: boolean; gerencia: boolean };
export const NO_RELATION: Relation = { self: false, leader: false, mentor: false, gerencia: false };
/** The privacy levels a viewer may read. Anything unknown is treated as private. Administración has no relation
 *  of its own: labour data lives in its module, and nothing here opens to it by role. */
export function readableLevels(r: Relation): string[] {
  if (r.self) return ["PRIVATE", "SHARED", "ORG"];
  if (r.leader || r.mentor) return ["SHARED", "ORG"];
  if (r.gerencia) return ["ORG"];
  return [];
}
export const mayRead = (privacy: string, r: Relation) => readableLevels(r).includes(privacy);
export const anyRelation = (r: Relation) => r.self || r.leader || r.mentor || r.gerencia;
/** Who may write development records about a person: the person, their leader or their mentor. */
export const mayGuide = (r: Relation) => r.self || r.leader || r.mentor;

// ---------- Team Member 360 (§2) ----------

export const PROFILE_BLOCKS: Record<string, Txt & { kinds: Record<string, Txt>; defaultPrivacy: string; hint: Txt }> = {
  SER: { ...tx("SER", "BE"), defaultPrivacy: "SHARED", hint: tx("Valores, principios, motivaciones y madurez que se observa.", "Values, principles, motivations and maturity that can be observed."),
    kinds: { VALUE: tx("Valor", "Value"), PRINCIPLE: tx("Principio", "Principle"), MOTIVATION: tx("Motivación", "Motivation"), MATURITY: tx("Madurez observable", "Observable maturity") } },
  TALENT: { ...tx("Talentos", "Talents"), defaultPrivacy: "ORG", hint: tx("Lo que se te da de forma natural, lo que más usas, lo que usas poco y lo que estás desarrollando.", "What comes naturally, what you use most, what you use little and what you are developing."),
    kinds: { NATURAL: tx("Natural", "Natural"), DOMINANT: tx("Dominante", "Dominant"), UNDERUSED: tx("Subutilizado", "Underused"), DEVELOPING: tx("En desarrollo", "Developing") } },
  HACER: { ...tx("HACER", "DO"), defaultPrivacy: "ORG", hint: tx("Competencias y hábitos.", "Competencies and habits."),
    kinds: { COMPETENCY: tx("Competencia", "Competency"), HABIT: tx("Hábito", "Habit") } },
  TENER: { ...tx("TENER", "HAVE"), defaultPrivacy: "ORG", hint: tx("Conocimientos, certificaciones, experiencia, herramientas, idiomas y resultados.", "Knowledge, certifications, experience, tools, languages and results."),
    kinds: { KNOWLEDGE: tx("Conocimiento", "Knowledge"), CERTIFICATION: tx("Certificación", "Certification"), EXPERIENCE: tx("Experiencia", "Experience"), TOOL: tx("Herramienta", "Tool"), LANGUAGE: tx("Idioma", "Language"), RESULT: tx("Resultado", "Result") } },
  STORY: { ...tx("Historia, intereses y aspiraciones", "Story, interests and aspirations"), defaultPrivacy: "PRIVATE", hint: tx("Voluntario. Tú decides quién lo ve.", "Voluntary. You decide who sees it."),
    kinds: { HISTORY: tx("Historia", "Story"), INTEREST: tx("Interés", "Interest"), ASPIRATION: tx("Aspiración", "Aspiration") } },
  REFLECTION: { ...tx("Reflexiones privadas", "Private reflections"), defaultPrivacy: "PRIVATE", hint: tx("Notas para ti. Nadie más las ve mientras no las compartas.", "Notes for yourself. Nobody else sees them unless you share them."),
    kinds: { REFLECTION: tx("Reflexión", "Reflection") } },
};
/** The blocks that describe capability, and so can count in the talent map when the person makes them organisational. */
export const CAPABILITY_BLOCKS = ["TALENT", "HACER", "TENER"];
export function entryIssues(e: { block: string | null; kind: string | null; text: string | null; privacy: string | null }): string[] {
  const out: string[] = [];
  const b = e.block ? PROFILE_BLOCKS[e.block] : null;
  if (!b) out.push("block");
  if (b && (!e.kind || !(e.kind in b.kinds))) out.push("kind");
  if (!e.text) out.push("text");
  if (!e.privacy || !(e.privacy in PRIVACY)) out.push("privacy");
  return out;
}

export const INSTRUMENTS: Record<string, Txt & { playful?: boolean }> = {
  CLIFTON: tx("CliftonStrengths", "CliftonStrengths"), DISC: tx("DISC", "DISC"), ENNEAGRAM: tx("Eneagrama", "Enneagram"),
  ZODIAC: { ...tx("Zodiaco (solo lúdico)", "Zodiac (for fun only)"), playful: true }, OTHER: tx("Otro", "Other"),
};
/** An assessment needs its result, where it comes from and its date. It is never organisational data. */
export function assessmentIssues(a: { instrument: string | null; result: string | null; source: string | null; takenOn: Date | null; privacy: string | null }, today: Date): string[] {
  const out: string[] = [];
  if (!a.instrument || !(a.instrument in INSTRUMENTS)) out.push("instrument");
  if (!a.result) out.push("result");
  if (!a.source) out.push("source");
  if (!a.takenOn || a.takenOn > today) out.push("takenOn");
  if (a.privacy !== "PRIVATE" && a.privacy !== "SHARED") out.push("privacy");
  return out;
}

// ---------- Character based on evidence (§3, AC2) ----------

/** How the conduct is known. A personality test is not on this list, and nothing in SOLU can add it. */
export const EVIDENCE_SOURCES: Record<string, Txt> = {
  OBSERVATION: tx("Lo vi directamente", "I saw it directly"), SELF: tx("Lo cuenta la propia persona", "The person tells it"),
  FEEDBACK: tx("Viene de un feedback recibido", "It comes from feedback received"), WORK: tx("Quedó en un registro de trabajo", "It is in a work record"),
};
const TEST_WORDS = /\b(disc|eneagrama|enneagram|eneatipo|enneatype|zodiac\w*|zodiaco|horoscopo|horoscope|signo zodiacal|clifton\w*|strengthsfinder|mbti|myers[ -]?briggs|test de personalidad|personality test)\b/;
/** True when a text leans on a personality test instead of on something the person did. */
export const citesTest = (s: string | null | undefined) => TEST_WORDS.test(norm(String(s ?? "")));
export function characterIssues(e: { dimension: string | null; behavior: string | null; context: string | null; observedOn: Date | null; sourceKind: string | null }, dimensions: string[], today: Date): string[] {
  const out: string[] = [];
  if (!e.dimension || !dimensions.includes(e.dimension)) out.push("dimension");
  if (!e.behavior) out.push("behavior");
  if (!e.context) out.push("context");
  if (!e.observedOn || e.observedOn > today) out.push("observedOn");
  if (!e.sourceKind || !(e.sourceKind in EVIDENCE_SOURCES)) out.push("sourceKind");
  // Character is shown in decisions; a test result can explain a tendency, never prove a conduct.
  if (citesTest(e.behavior) || citesTest(e.context)) out.push("test");
  return out;
}

// ---------- SER–HACER–TENER and the development cycle (§4–5) ----------

export const DIMS: Record<Dim, Txt & { question: Txt }> = {
  SER: { ...tx("SER", "BE"), question: tx("¿Quién necesito llegar a ser?", "Who do I need to become?") },
  HACER: { ...tx("HACER", "DO"), question: tx("¿Qué necesito hacer mejor?", "What do I need to do better?") },
  TENER: { ...tx("TENER", "HAVE"), question: tx("¿Qué conocimiento o experiencia necesito construir?", "What knowledge or experience do I need to build?") },
};
export const DIM_KEYS = Object.keys(DIMS) as Dim[];
export const ACTION_KINDS: Record<string, Txt> = {
  LEARNING: tx("Aprender", "Learning"), PRACTICE: tx("Practicar", "Practice"), STRETCH: tx("Reto que estira", "Stretch assignment"), SHADOWING: tx("Acompañar a alguien", "Shadowing"),
  MENTORING: tx("Mentoría", "Mentoring"), REFLECTION: tx("Reflexión", "Reflection"), FEEDBACK: tx("Pedir feedback", "Feedback"), TEACHING: tx("Enseñar a otros", "Teaching"),
};
export const MEETING_KINDS: Record<string, Txt> = {
  ONE_ON_ONE: tx("1:1", "1:1"), MENTORING: tx("Mentoría", "Mentoring"), CHECKPOINT: tx("Punto de control 30/60/90", "30/60/90 checkpoint"), PERFORMANCE: tx("Desempeño", "Performance"),
  CAREER: tx("Carrera", "Career"), SUCCESSION: tx("Sucesión", "Succession"), FEEDBACK: tx("Feedback", "Feedback"),
};
export const MENTOR_KINDS: Record<string, Txt> = { TECHNICAL: tx("Técnico", "Technical"), COMMERCIAL: tx("Comercial", "Commercial"), LEADERSHIP: tx("Liderazgo", "Leadership"), CHARACTER: tx("Carácter", "Character"), CAREER: tx("Carrera", "Career") };

const DAY = 864e5;
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const cycleEnd = (startsOn: Date, p: TeamPolicy) => plusDays(startsOn, p.cycleDays);
export const checkpointsOf = (startsOn: Date, p: TeamPolicy) => p.checkpoints.map((day) => ({ day, on: plusDays(startsOn, day) }));

export type ObjectiveIn = { dimension: string | null; title: string | null; expectedEvidence: string | null; nextMovement: string | null; reviewOn: Date | null };
/** A development agreement always has its next movement, the evidence expected and the moment of review (§15).
 *  `openInDim` = objectives of that dimension already in the cycle. */
export function objectiveIssues(o: ObjectiveIn, plan: { startsOn: Date; endsOn: Date }, openInDim: number, p: TeamPolicy): string[] {
  const out: string[] = [];
  if (!o.dimension || !(o.dimension in DIMS)) out.push("dimension");
  if (!o.title) out.push("title");
  if (!o.expectedEvidence) out.push("expectedEvidence");
  if (!o.nextMovement) out.push("nextMovement");
  if (!o.reviewOn || o.reviewOn < plan.startsOn || o.reviewOn > plan.endsOn) out.push("reviewOn");
  if (o.dimension && o.dimension in DIMS && openInDim >= p.limits[o.dimension as Dim].max) out.push("max");
  return out;
}
/** Where the cycle stands against the number of priorities the policy asks for. */
export function planBalance(objectives: { dimension: string; status: string }[], p: TeamPolicy) {
  return DIM_KEYS.map((d) => { const n = objectives.filter((o) => o.dimension === d).length; const { min, max } = p.limits[d]; return { dim: d, n, min, max, under: n < min }; });
}
/** AC7 · an objective is achieved only with evidence; closing it any other way needs an explicit reason. */
export function closeIssues(c: { outcome: string | null; evidenceCount: number; reason: string | null }): string[] {
  if (c.outcome === "ACHIEVED") return c.evidenceCount > 0 ? [] : ["evidence"];
  if (c.outcome === "CLOSED") return c.reason ? [] : ["reason"];
  return ["outcome"];
}
export function commitmentIssues(c: { kind: string | null; what: string | null; expectedEvidence: string | null; dueOn: Date | null; ownerOk: boolean }): string[] {
  const out: string[] = [];
  if (!c.kind || !(c.kind in ACTION_KINDS)) out.push("kind");
  if (!c.what) out.push("what");
  if (!c.expectedEvidence) out.push("expectedEvidence");
  if (!c.dueOn) out.push("dueOn");
  if (!c.ownerOk) out.push("owner");
  return out;
}
/** Closing a conversation asks for the next one, or for the reason there is none (§6). */
export function meetingCloseIssues(m: { heldOn: Date | null; nextOn: Date | null; noNextReason: string | null }, today: Date): string[] {
  const out: string[] = [];
  if (!m.heldOn || m.heldOn > today) out.push("heldOn");
  if (!m.nextOn && !m.noNextReason) out.push("next");
  if (m.nextOn && m.heldOn && m.nextOn <= m.heldOn) out.push("nextOn");
  return out;
}

export type DevFacts = {
  plan: { startsOn: Date; endsOn: Date; objectives: { dimension: string; status: string; reviewOn: Date }[] } | null;
  /** checkpoint days of the cycle that already have a conversation planned or held */
  checkpointsMet: number[];
  openCommitmentsDue: Date[];
  nextMeetingOn: Date | null;
};
export type DevFlag = { key: "NO_PLAN" | "CYCLE_ENDED" | "UNDER_MIN" | "CHECKPOINT_DUE" | "COMMITMENT_OVERDUE" | "REVIEW_DUE" | "NO_NEXT_MEETING"; n?: number; dim?: Dim; day?: number };
export const DEV_FLAG: Record<DevFlag["key"], Txt> = {
  NO_PLAN: tx("Sin ciclo de desarrollo activo", "No active development cycle"),
  CYCLE_ENDED: tx("El ciclo terminó: toca cerrarlo y abrir el siguiente", "The cycle ended: time to close it and open the next"),
  UNDER_MIN: tx("Faltan prioridades en el ciclo", "The cycle is short of priorities"),
  CHECKPOINT_DUE: tx("Punto de control sin conversación", "Checkpoint with no conversation"),
  COMMITMENT_OVERDUE: tx("Compromisos de desarrollo vencidos", "Development commitments overdue"),
  REVIEW_DUE: tx("Objetivos que pasaron su fecha de revisión", "Objectives past their review date"),
  NO_NEXT_MEETING: tx("Sin próxima conversación programada", "No next conversation scheduled"),
};
/** What asks for attention in the development of one person. Development that is not reviewed turns into intention (§15). */
export function devFlags(f: DevFacts, today: Date, p: TeamPolicy): DevFlag[] {
  if (!f.plan) return [{ key: "NO_PLAN" }];
  const out: DevFlag[] = [];
  if (today > f.plan.endsOn) out.push({ key: "CYCLE_ENDED" });
  const open = f.plan.objectives.filter((o) => o.status === "OPEN");
  for (const b of planBalance(f.plan.objectives, p)) if (b.under) out.push({ key: "UNDER_MIN", dim: b.dim, n: b.min - b.n });
  for (const c of checkpointsOf(f.plan.startsOn, p)) if (c.on < today && !f.checkpointsMet.includes(c.day)) out.push({ key: "CHECKPOINT_DUE", day: c.day });
  const late = f.openCommitmentsDue.filter((d) => d < today).length;
  if (late) out.push({ key: "COMMITMENT_OVERDUE", n: late });
  const review = open.filter((o) => o.reviewOn < today).length;
  if (review) out.push({ key: "REVIEW_DUE", n: review });
  if (!f.nextMeetingOn && today <= f.plan.endsOn) out.push({ key: "NO_NEXT_MEETING" });
  return out;
}

// ---------- Feedback 360 (§10) ----------

export const FEEDBACK_RELATIONS: Record<string, Txt> = { SELF: tx("Yo mismo", "Self"), LEADER: tx("Líder", "Leader"), PEER: tx("Par", "Peer"), MENTOR: tx("Mentor", "Mentor"), CROSS: tx("Otra función", "Cross-functional") };
export const FEEDBACK_PARTS = [
  { key: "continueText", ...tx("Continuar", "Continue"), hint: tx("Lo que conviene seguir haciendo", "What is worth continuing") },
  { key: "startText", ...tx("Empezar", "Start"), hint: tx("Lo que ayudaría empezar a hacer", "What it would help to start doing") },
  { key: "improveText", ...tx("Mejorar", "Improve"), hint: tx("Lo que ya hace y puede hacerse mejor", "What is already done and could be done better") },
  { key: "reduceText", ...tx("Reducir", "Reduce"), hint: tx("Lo que conviene hacer menos", "What is worth doing less") },
] as const;
export const feedbackIssues = (f: Record<(typeof FEEDBACK_PARTS)[number]["key"], string | null>) => (FEEDBACK_PARTS.some((p) => f[p.key]) ? [] : ["empty"]);

// ---------- Role Profile / Acuerdo de Rol (§20–21) ----------

export const DECISION_KINDS: Record<string, Txt> = { AUTONOMOUS: tx("Decide por sí mismo", "Decides alone"), CONDITIONED: tx("Decide si se cumple una condición", "Decides when a condition holds"), APPROVAL: tx("Necesita aprobación", "Needs approval") };
export const CUSTOMER_KINDS: Record<string, Txt> = { INTERNAL: tx("Interno", "Internal"), EXTERNAL: tx("Externo", "External") };
export const PERFORMANCE_KINDS: Record<string, Txt> = { RESULT: tx("Resultados", "Results"), PROCESS: tx("Proceso", "Process"), QUALITY: tx("Calidad", "Quality"), DEVELOPMENT: tx("Desarrollo", "Development") };
export const RHYTHM_KINDS: Record<string, Txt> = { DAILY: tx("Cada día", "Daily"), WEEKLY: tx("Cada semana", "Weekly"), MONTHLY: tx("Cada mes", "Monthly"), PERIODIC: tx("Periódico", "Periodic") };
export const COMPETENCY_KINDS: Record<string, Txt> = { TECHNICAL: tx("Técnica", "Technical"), COMMERCIAL: tx("Comercial", "Commercial"), RELATIONAL: tx("Relacional", "Relational"), MANAGEMENT: tx("Gestión", "Management"), LEADERSHIP: tx("Liderazgo", "Leadership"), OTHER: tx("Otra", "Other") };
export const COMMITMENT_KINDS: Record<string, Txt> = { TOOL: tx("Herramienta", "Tool"), INFORMATION: tx("Información", "Information"), AUTHORITY: tx("Autoridad", "Authority"), TRAINING: tx("Formación", "Training"), SUPPORT: tx("Acompañamiento", "Support"), OTHER: tx("Otro", "Other") };

export type Kinded = { kind: string; text: string };
export type RoleProfileData = {
  roleKey: string; title: string; functionKey: string; soluRole: string | null; critical: boolean; purpose: string;
  outcomes: string[]; functions: string[]; responsibilities: string[]; decisionRights: Kinded[]; authorityDomains: string[]; boundaries: string[];
  inputs: string[]; outputs: string[]; customers: { kind: string; who: string; expects: string }[]; qualityStandards: string[];
  behaviors: { principle: string; conduct: string }[]; methodologies: string[]; performance: Kinded[]; competencies: Kinded[]; risks: string[];
  rhythm: Kinded[]; successSignals: string[]; attentionSignals: string[]; careerLevels: { name: string; ser: string; hacer: string; tener: string }[];
  careerExpectations: string[]; companyCommitments: Kinded[];
};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const objs = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => (x && typeof x === "object" ? x : {}) as Record<string, unknown>);
const kinded = (v: unknown, kinds: Record<string, unknown>, fallback: string): Kinded[] => objs(v).map((x) => ({ kind: String(x.kind ?? "") in kinds ? String(x.kind) : fallback, text: String(x.text ?? "").trim() })).filter((x) => x.text);
/** A stored role profile row, read defensively into its typed shape. */
export function readRoleProfile(r: Record<string, unknown>): RoleProfileData {
  return {
    roleKey: String(r.roleKey ?? ""), title: String(r.title ?? ""), functionKey: String(r.functionKey ?? ""), soluRole: r.soluRole ? String(r.soluRole) : null, critical: !!r.critical, purpose: String(r.purpose ?? ""),
    outcomes: strs(r.outcomes), functions: strs(r.functions), responsibilities: strs(r.responsibilities), decisionRights: kinded(r.decisionRights, DECISION_KINDS, "AUTONOMOUS"), authorityDomains: strs(r.authorityDomains).filter((d) => d in AUTHORITY),
    boundaries: strs(r.boundaries), inputs: strs(r.inputs), outputs: strs(r.outputs),
    customers: objs(r.customers).map((x) => ({ kind: x.kind === "EXTERNAL" ? "EXTERNAL" : "INTERNAL", who: String(x.who ?? "").trim(), expects: String(x.expects ?? "").trim() })).filter((x) => x.who),
    qualityStandards: strs(r.qualityStandards), behaviors: objs(r.behaviors).map((x) => ({ principle: String(x.principle ?? "").trim(), conduct: String(x.conduct ?? "").trim() })).filter((x) => x.principle && x.conduct),
    methodologies: strs(r.methodologies), performance: kinded(r.performance, PERFORMANCE_KINDS, "RESULT"), competencies: kinded(r.competencies, COMPETENCY_KINDS, "OTHER"), risks: strs(r.risks),
    rhythm: kinded(r.rhythm, RHYTHM_KINDS, "PERIODIC"), successSignals: strs(r.successSignals), attentionSignals: strs(r.attentionSignals),
    careerLevels: objs(r.careerLevels).map((x) => ({ name: String(x.name ?? "").trim(), ser: String(x.ser ?? "").trim(), hacer: String(x.hacer ?? "").trim(), tener: String(x.tener ?? "").trim() })).filter((x) => x.name),
    careerExpectations: strs(r.careerExpectations), companyCommitments: kinded(r.companyCommitments, COMMITMENT_KINDS, "OTHER"),
  };
}
const kindOf = (label: string, kinds: Record<string, Txt>, fallback: string) => { const n = norm(label); return Object.keys(kinds).find((k) => k.toLowerCase() === n || norm(kinds[k].es) === n || norm(kinds[k].en) === n) ?? fallback; };
/** "Técnica: lectura de planos" → { kind: TECHNICAL, text }. A line with no known label keeps its whole text under `fallback`. */
export function parseKinded(text: string | null | undefined, kinds: Record<string, Txt>, fallback: string, max = 30): Kinded[] {
  return parseLines(text, max, 500).map((l) => { const k = l.indexOf(":"); const kind = k > 0 ? kindOf(l.slice(0, k), kinds, "") : ""; return kind ? { kind, text: l.slice(k + 1).trim() } : { kind: fallback, text: l }; }).filter((x) => x.text);
}
export const kindedText = (xs: Kinded[], kinds: Record<string, Txt>, es = true) => xs.map((x) => `${kinds[x.kind] ? (es ? kinds[x.kind].es : kinds[x.kind].en) : x.kind}: ${x.text}`).join("\n");
/** "Junior | SER … | HACER … | TENER …" per line. */
export function parseLevels(text: string | null | undefined): RoleProfileData["careerLevels"] {
  return parseLines(text, 10, 1200).map((l) => { const [name = "", ser = "", hacer = "", tener = ""] = l.split("|").map((s) => s.trim()); return { name: name.slice(0, 80), ser, hacer, tener }; }).filter((x) => x.name);
}
export const levelsText = (xs: RoleProfileData["careerLevels"]) => xs.map((x) => [x.name, x.ser, x.hacer, x.tener].join(" | ")).join("\n");
export const slugRole = (s: string) => norm(s).replace(/ /g, "-").slice(0, 60);

/** Reads the publishing form. `get` returns the trimmed text of a field, or null. */
export function roleFromForm(get: (k: string, max?: number) => string | null, all: (k: string) => string[]): RoleProfileData {
  const lines = (k: string, max = 30) => parseLines(get(k, 6000), max, 500);
  const by = (prefix: string, kinds: Record<string, Txt>) => Object.keys(kinds).flatMap((kind) => lines(`${prefix}_${kind}`, 15).map((text) => ({ kind, text })));
  const title = get("title", 120) ?? "";
  return {
    roleKey: slugRole(get("roleKey", 80) ?? title), title, functionKey: get("functionKey", 20) ?? "", soluRole: get("soluRole", 40), critical: get("critical", 5) === "1", purpose: get("purpose", 800) ?? "",
    outcomes: lines("outcomes"), functions: lines("functions"), responsibilities: lines("responsibilities"), decisionRights: by("decision", DECISION_KINDS), authorityDomains: [...new Set(all("authorityDomains").filter((d) => d in AUTHORITY))],
    boundaries: lines("boundaries"), inputs: lines("inputs"), outputs: lines("outputs"),
    customers: (["INTERNAL", "EXTERNAL"] as const).flatMap((kind) => parsePairs(get(`customers_${kind}`, 4000), 15).map((p) => ({ kind, who: p.name, expects: p.detail }))),
    qualityStandards: lines("qualityStandards"), behaviors: parsePairs(get("behaviors", 6000), 30).filter((p) => p.detail).map((p) => ({ principle: p.name, conduct: p.detail })),
    methodologies: lines("methodologies", 12), performance: by("performance", PERFORMANCE_KINDS), competencies: parseKinded(get("competencies", 6000), COMPETENCY_KINDS, "OTHER"), risks: lines("risks"),
    rhythm: by("rhythm", RHYTHM_KINDS), successSignals: lines("successSignals"), attentionSignals: lines("attentionSignals"), careerLevels: parseLevels(get("careerLevels", 6000)),
    careerExpectations: lines("careerExpectations"), companyCommitments: parseKinded(get("companyCommitments", 6000), COMMITMENT_KINDS, "OTHER"),
  };
}
/** What stops a role agreement from being published. The five parts that make a role clear (Módulo 15 §26) are
 *  required; the rest of the eighteen are reported as still to complete, never invented. */
export function roleIssues(p: RoleProfileData, meta: { effectiveFrom: Date | null; reason: string | null }, validRoles: readonly string[]): string[] {
  const out: string[] = [];
  if (!p.title) out.push("title");
  if (!p.roleKey) out.push("roleKey");
  if (!(p.functionKey in FUNCTIONS)) out.push("functionKey");
  if (p.soluRole && !validRoles.includes(p.soluRole)) out.push("soluRole");
  out.push(...roleClarity(p).missing);
  if (!meta.effectiveFrom) out.push("effectiveFrom");
  if (!meta.reason) out.push("reason");
  // Principles applied to the role are conduct someone can observe, never a rating (§21, AC5).
  if (p.behaviors.some((b) => /^\s*\d+(\s*\/\s*\d+)?\s*%?\s*$/.test(b.conduct) || citesTest(b.conduct))) out.push("behaviors");
  return [...new Set(out)];
}
/** The eighteen fields of §20, in the order of the document, each with whether this profile has it. */
export const ROLE_FIELDS: { key: string; n: number; label: Txt; has: (p: RoleProfileData) => boolean }[] = [
  { key: "purpose", n: 1, label: tx("Propósito del rol", "Role purpose"), has: (p) => !!p.purpose.trim() },
  { key: "outcomes", n: 2, label: tx("Resultados esperados", "Expected outcomes"), has: (p) => p.outcomes.length > 0 },
  { key: "functions", n: 3, label: tx("Funciones", "Functions"), has: (p) => p.functions.length > 0 },
  { key: "responsibilities", n: 4, label: tx("Responsabilidades", "Responsibilities"), has: (p) => p.responsibilities.length > 0 },
  { key: "decisionRights", n: 5, label: tx("Qué puede decidir", "Decision rights"), has: (p) => p.decisionRights.length > 0 },
  { key: "boundaries", n: 6, label: tx("Límites", "Boundaries"), has: (p) => p.boundaries.length > 0 },
  { key: "io", n: 7, label: tx("Qué recibe y qué entrega", "Inputs and outputs"), has: (p) => p.inputs.length > 0 && p.outputs.length > 0 },
  { key: "customers", n: 8, label: tx("Clientes internos y externos", "Internal and external customers"), has: (p) => p.customers.length > 0 },
  { key: "qualityStandards", n: 9, label: tx("Estándares de calidad", "Quality standards"), has: (p) => p.qualityStandards.length > 0 },
  { key: "behaviors", n: 10, label: tx("Conductas esperadas", "Expected behaviours"), has: (p) => p.behaviors.length > 0 },
  { key: "performance", n: 11, label: tx("Expectativas de desempeño", "Performance expectations"), has: (p) => p.performance.length > 0 },
  { key: "competencies", n: 12, label: tx("Competencias requeridas", "Required competencies"), has: (p) => p.competencies.length > 0 },
  { key: "risks", n: 13, label: tx("Riesgos del rol", "Role risks"), has: (p) => p.risks.length > 0 },
  { key: "rhythm", n: 14, label: tx("Ritmo del rol", "Role rhythm"), has: (p) => p.rhythm.length > 0 },
  { key: "successSignals", n: 15, label: tx("Señales de éxito", "Success signals"), has: (p) => p.successSignals.length > 0 },
  { key: "attentionSignals", n: 16, label: tx("Señales de atención", "Attention signals"), has: (p) => p.attentionSignals.length > 0 },
  { key: "career", n: 17, label: tx("Expectativas de carrera", "Career expectations"), has: (p) => p.careerExpectations.length > 0 },
  { key: "companyCommitments", n: 18, label: tx("Compromisos de la compañía", "Company commitments"), has: (p) => p.companyCommitments.length > 0 },
];
export const roleMissing = (p: RoleProfileData) => ROLE_FIELDS.filter((f) => !f.has(p));
/** The data fields compared between two versions of a role agreement. */
export const ROLE_DATA_FIELDS = ["title", "functionKey", "soluRole", "critical", "purpose", "outcomes", "functions", "responsibilities", "decisionRights", "authorityDomains", "boundaries", "inputs", "outputs", "customers", "qualityStandards", "behaviors", "methodologies", "performance", "competencies", "risks", "rhythm", "successSignals", "attentionSignals", "careerLevels", "careerExpectations", "companyCommitments"] as const;

/** Which function each access role of SOLU works in, for people who have no role agreement yet. */
export const ROLE_FUNCTION: Record<string, FunctionKey> = { GERENCIA: "GERENCIA", DIRECTOR_COMERCIAL: "COMERCIAL", NEGOCIADOR_COMERCIAL: "COMERCIAL", NEGOCIADOR_OPERATIVO: "OPERACIONES", FINANZAS: "ADMINISTRACION", ADMINISTRACION: "ADMINISTRACION", MARKETING: "MERCADEO" };

// ---------- Authority: the role agreement against the engines of SOLU (§26 AC4) ----------

/** What SOLU's own rules can grant. A role agreement names the ones the role needs; the engines stay the ones that decide. */
export const AUTHORITY: Record<string, Txt> = {
  EDIT_ALL: tx("Cambiar cualquier Journey o registro", "Change any Journey or record"),
  OPS: tx("Operar compras, envíos y remisiones en cualquier Journey", "Run purchasing, shipments and delivery notes on any Journey"),
  MONEY: tx("Facturar, cobrar, conciliar y ejecutar pagos", "Invoice, collect, reconcile and execute payments"),
  PURCHASE_APPROVAL: tx("Aprobar compras y pagos a proveedores (primer nivel)", "Approve purchases and supplier payments (first level)"),
  PURCHASE_APPROVAL_TOP: tx("Aprobar compras y pagos por encima del primer nivel", "Approve purchases and payments above the first level"),
  ESAGARA: tx("Decidir excepciones de Eságara baja", "Decide low-Eságara exceptions"),
  CREDIT: tx("Decidir cupos, plazos y excepciones de crédito", "Decide credit limits, terms and exceptions"),
  BUDGETS: tx("Asignar y cerrar presupuestos", "Assign and close budgets"),
  PEOPLE_ADMIN: tx("Administrar datos laborales y ausencias", "Administer labour data and absences"),
  PUBLISH: tx("Publicar identidad, cartas de función y acuerdos de rol", "Publish identity, function charters and role agreements"),
};
export type AuthoritySources = { level1Roles: string[]; level2Roles: string[]; esagaraRoles: string[]; publishRoles: string[] };
/** What the engines grant an access role today, read from the policies in force. */
export function grantedAuthority(role: string, s: AuthoritySources): string[] {
  const manage = role === "GERENCIA" || role === "DIRECTOR_COMERCIAL", money = role === "FINANZAS" || role === "ADMINISTRACION";
  const out: string[] = [];
  if (manage) out.push("EDIT_ALL");
  if (manage || role === "NEGOCIADOR_OPERATIVO") out.push("OPS");
  if (manage || money) out.push("MONEY");
  if (s.level1Roles.includes(role) || s.level2Roles.includes(role)) out.push("PURCHASE_APPROVAL");
  if (s.level2Roles.includes(role)) out.push("PURCHASE_APPROVAL_TOP");
  if (s.esagaraRoles.includes(role)) out.push("ESAGARA");
  if (role === "GERENCIA" || money) out.push("CREDIT");
  if (role === "GERENCIA" || role === "FINANZAS") out.push("BUDGETS");
  if (role === "GERENCIA" || role === "ADMINISTRACION") out.push("PEOPLE_ADMIN");
  if (s.publishRoles.includes(role)) out.push("PUBLISH");
  return out;
}
/** Lent authority (Módulo 14) expressed in the same words. */
export const LENT_TO_AUTHORITY: Record<string, string> = { PURCHASE_APPROVAL: "PURCHASE_APPROVAL", PAYMENT_APPROVAL: "PURCHASE_APPROVAL", CREDIT: "CREDIT" };
/** Authority the role agreement says the role needs and the engines do not grant. */
export const authorityMissing = (needs: string[], granted: string[]) => needs.filter((d) => !granted.includes(d));

// ---------- Team Role Clarity: where the structure has a hole (§25) ----------

export type RoleView = RoleProfileData & { version: number; holders: number };
export type StructureIssue = { kind: "NO_HOLDER" | "DUPLICATE" | "INSUFFICIENT_AUTHORITY" | "CONTRADICTION" | "SAME_DECISION" | "CRITICAL_NO_BACKUP" | "INCOMPLETE"; roleKey: string; other: string | null; detail: string | null };
export const STRUCTURE_TEXT: Record<StructureIssue["kind"], Txt & { tone: "risk" | "attn" }> = {
  NO_HOLDER: { ...tx("Rol sin nadie que lo tenga", "Role with nobody holding it"), tone: "attn" },
  DUPLICATE: { ...tx("Responsabilidad duplicada entre roles", "Responsibility duplicated between roles"), tone: "attn" },
  INSUFFICIENT_AUTHORITY: { ...tx("Autoridad insuficiente: el acuerdo pide algo que SOLU no le permite a ese rol", "Insufficient authority: the agreement asks for something SOLU does not allow that role"), tone: "risk" },
  CONTRADICTION: { ...tx("Expectativas contradictorias: lo mismo aparece como decisión y como límite", "Contradictory expectations: the same thing is both a decision right and a boundary"), tone: "risk" },
  SAME_DECISION: { ...tx("Dos roles dicen decidir lo mismo por sí solos", "Two roles say they decide the same thing alone"), tone: "attn" },
  CRITICAL_NO_BACKUP: { ...tx("Rol crítico sin respaldo calificado", "Critical role with no qualified backup"), tone: "risk" },
  INCOMPLETE: { ...tx("Acuerdo de rol con campos por completar", "Role agreement with fields to complete"), tone: "attn" },
};
/** Everything §25 asks to detect, read from the role agreements in force. `granted`: authority per access role;
 *  `qualifiedBackups`: how many qualified backups each role has. */
export function structureIssues(roles: RoleView[], granted: Record<string, string[]>, qualifiedBackups: Record<string, number>): StructureIssue[] {
  const out: StructureIssue[] = [];
  const seenResp = new Map<string, { key: string; text: string }>(), seenDec = new Map<string, { key: string; text: string }>();
  for (const r of roles) {
    if (r.holders === 0) out.push({ kind: "NO_HOLDER", roleKey: r.roleKey, other: null, detail: null });
    const miss = r.soluRole ? authorityMissing(r.authorityDomains, granted[r.soluRole] ?? []) : [];
    for (const d of miss) out.push({ kind: "INSUFFICIENT_AUTHORITY", roleKey: r.roleKey, other: null, detail: d });
    const bounds = new Set(r.boundaries.map(norm));
    for (const d of r.decisionRights) if (bounds.has(norm(d.text))) out.push({ kind: "CONTRADICTION", roleKey: r.roleKey, other: null, detail: d.text });
    if (r.critical && (qualifiedBackups[r.roleKey] ?? 0) === 0) out.push({ kind: "CRITICAL_NO_BACKUP", roleKey: r.roleKey, other: null, detail: null });
    const missing = roleMissing(r);
    if (missing.length) out.push({ kind: "INCOMPLETE", roleKey: r.roleKey, other: null, detail: String(missing.length) });
    for (const t of r.responsibilities) { const n = norm(t); if (!n) continue; const f = seenResp.get(n); if (f && f.key !== r.roleKey) out.push({ kind: "DUPLICATE", roleKey: f.key, other: r.roleKey, detail: f.text }); else if (!f) seenResp.set(n, { key: r.roleKey, text: t }); }
    for (const d of r.decisionRights.filter((x) => x.kind === "AUTONOMOUS")) { const n = norm(d.text); if (!n) continue; const f = seenDec.get(n); if (f && f.key !== r.roleKey) out.push({ kind: "SAME_DECISION", roleKey: f.key, other: r.roleKey, detail: f.text }); else if (!f) seenDec.set(n, { key: r.roleKey, text: d.text }); }
  }
  return out;
}

// ---------- Role Gap Analysis (§24, AC8) ----------

export const GAP_RESULTS: Record<string, Txt & { tone: string }> = {
  STRONG: { ...tx("Evidencia sólida", "Evidence strong"), tone: "ok" }, DEVELOPING: { ...tx("En desarrollo", "Developing"), tone: "info" },
  GAP: { ...tx("Brecha", "Gap"), tone: "attn" }, NOT_ENOUGH: { ...tx("Sin evidencia suficiente", "Not enough evidence"), tone: "wait" },
};
/** The dimensions of the agreement that can be compared with evidence, each with the lines it holds. */
export const GAP_DIMS: { key: string; label: Txt; lines: (p: RoleProfileData) => string[] }[] = [
  { key: "OUTCOMES", label: tx("Resultados esperados", "Expected outcomes"), lines: (p) => p.outcomes },
  { key: "RESPONSIBILITIES", label: tx("Responsabilidades", "Responsibilities"), lines: (p) => p.responsibilities },
  { key: "DECISIONS", label: tx("Uso de la autoridad y respeto de los límites", "Use of authority and respect of boundaries"), lines: (p) => [...p.decisionRights.map((d) => d.text), ...p.boundaries] },
  { key: "QUALITY", label: tx("Estándares de calidad", "Quality standards"), lines: (p) => p.qualityStandards },
  { key: "BEHAVIORS", label: tx("Conductas esperadas", "Expected behaviours"), lines: (p) => p.behaviors.map((b) => `${b.principle}: ${b.conduct}`) },
  { key: "COMPETENCIES", label: tx("Competencias", "Competencies"), lines: (p) => p.competencies.map((c) => c.text) },
  { key: "RHYTHM", label: tx("Ritmo del rol", "Role rhythm"), lines: (p) => p.rhythm.map((c) => c.text) },
];
/** AC8 · a result needs evidence. Without it, whatever was chosen, the answer is "not enough evidence". */
export const gapResult = (result: string | null, evidence: string | null) => (evidence && evidence.trim() && result && result in GAP_RESULTS ? result : "NOT_ENOUGH");
export function gapTable<R extends { dimension: string; result: string; supersededAt: Date | null }>(profile: RoleProfileData, reviews: R[]) {
  return GAP_DIMS.filter((d) => d.lines(profile).length > 0).map((d) => { const r = reviews.find((x) => x.dimension === d.key && !x.supersededAt) ?? null; return { ...d, review: r, result: r ? r.result : "NOT_ENOUGH" }; });
}

// ---------- Career, readiness and succession (§7) ----------

export const READINESS: Record<string, Txt & { tone: string }> = {
  READY_NOW: { ...tx("Listo ahora", "Ready now"), tone: "ok" }, DEVELOPING: { ...tx("En desarrollo", "Developing"), tone: "info" }, NOT_YET: { ...tx("Aún no", "Not yet ready"), tone: "wait" },
};
/** Readiness always comes with evidence; when the person is not ready yet, also with the gaps and the plan. */
export function readinessIssues(r: { roleKey: string | null; state: string | null; evidence: string | null; gaps: string | null; plan: string | null; assessedOn: Date | null }, today: Date): string[] {
  const out: string[] = [];
  if (!r.roleKey) out.push("roleKey");
  if (!r.state || !(r.state in READINESS)) out.push("state");
  if (!r.evidence) out.push("evidence");
  if (r.state && r.state !== "READY_NOW") { if (!r.gaps) out.push("gaps"); if (!r.plan) out.push("plan"); }
  if (!r.assessedOn || r.assessedOn > today) out.push("assessedOn");
  return out;
}
export const BACKUP_KINDS: Record<string, Txt> = { BACKUP: tx("Respaldo (puede entrar ya)", "Backup (can step in now)"), SUCCESSOR: tx("Sucesor (se está preparando)", "Successor (being prepared)") };

export type SuitFacts = {
  /** capability */ sameRole: boolean; readyNow: boolean; capabilityNote: string | null;
  /** authority */ needs: string[]; granted: string[]; lent: string[];
  /** access */ active: boolean; accessRole: string; expectedRole: string | null;
  /** availability */ away: boolean; coveringOthers: number;
};
export type SuitPart = { ok: boolean; why: Txt };
/** §8 · fitness of a replacement: Capability + Authority + Access + Availability. Four separate answers, each
 *  with its reason; "qualified" only when all four hold. Never a score. */
export function suitability(f: SuitFacts): { capability: SuitPart; authority: SuitPart; access: SuitPart; availability: SuitPart; qualified: boolean; missingAuthority: string[] } {
  const capability: SuitPart = f.sameRole ? { ok: true, why: tx("tiene hoy el mismo rol", "holds the same role today") }
    : f.readyNow ? { ok: true, why: tx("evaluado como listo ahora para el rol", "assessed as ready now for the role") }
    : f.capabilityNote ? { ok: true, why: tx("capacidad confirmada por quien lo nombró", "capability confirmed by whoever named them") }
    : { ok: false, why: tx("nadie ha dejado evidencia de que pueda hacer el rol", "nobody has recorded evidence that they can do the role") };
  const have = new Set([...f.granted, ...f.lent]);
  const missing = f.needs.filter((d) => !have.has(d));
  const authority: SuitPart = missing.length === 0 ? { ok: true, why: f.needs.length ? tx("tiene la autoridad que el rol necesita", "has the authority the role needs") : tx("el acuerdo de rol no pide autoridad especial", "the role agreement asks for no special authority") }
    : { ok: false, why: tx(`le falta autoridad: ${missing.map((d) => AUTHORITY[d]?.es ?? d).join("; ")}`, `lacks authority: ${missing.map((d) => AUTHORITY[d]?.en ?? d).join("; ")}`) };
  const manage = f.accessRole === "GERENCIA" || f.accessRole === "DIRECTOR_COMERCIAL";
  const access: SuitPart = !f.active ? { ok: false, why: tx("su cuenta en SOLU no está activa", "their SOLU account is not active") }
    : !f.expectedRole || f.accessRole === f.expectedRole || manage ? { ok: true, why: tx("su acceso en SOLU alcanza para el rol", "their access in SOLU is enough for the role") }
    : { ok: false, why: tx("su rol de acceso en SOLU es otro: necesitaría una cobertura o un cambio de acceso", "their access role in SOLU is different: it would need a coverage or an access change") };
  const availability: SuitPart = f.away ? { ok: false, why: tx("tiene una ausencia aprobada en esas fechas", "has an approved absence on those dates") }
    : f.coveringOthers >= 2 ? { ok: false, why: tx(`ya cubre a ${f.coveringOthers} personas`, `already covers ${f.coveringOthers} people`) }
    : { ok: true, why: f.coveringOthers === 1 ? tx("disponible; ya cubre a una persona", "available; already covers one person") : tx("disponible", "available") };
  return { capability, authority, access, availability, qualified: capability.ok && authority.ok && access.ok && availability.ok, missingAuthority: missing };
}

// ---------- Absences, coverage and continuity (§8) ----------

export type HandoverClass = "MUST_MOVE" | "DECISION_LIKELY" | "WAITING" | "SAFE" | "CAN_WAIT";
export const HANDOVER_CLASSES: Record<HandoverClass, Txt & { tone: string; hint: Txt }> = {
  MUST_MOVE: { ...tx("Debe moverse", "Must move"), tone: "risk", hint: tx("Vence durante la ausencia: quien cubre tiene que actuar.", "Due during the absence: whoever covers has to act.") },
  DECISION_LIKELY: { ...tx("Decisión probable", "Decision likely"), tone: "attn", hint: tx("El cliente puede decidir durante la ausencia: conviene estar listo para responder.", "The customer may decide during the absence: be ready to respond.") },
  WAITING: { ...tx("En espera controlada", "Waiting with control"), tone: "wait", hint: tx("Depende de un tercero: quien cubre lo vigila.", "It depends on a third party: whoever covers keeps watch.") },
  SAFE: { ...tx("Protegido", "Safe"), tone: "ok", hint: tx("Nada con fecha durante la ausencia.", "Nothing dated during the absence.") },
  CAN_WAIT: { ...tx("Puede esperar", "Can wait"), tone: "info", hint: tx("Su fecha es después del regreso.", "Its date is after the return.") },
};
export const HANDOVER_ORDER: HandoverClass[] = ["MUST_MOVE", "DECISION_LIKELY", "WAITING", "CAN_WAIT", "SAFE"];
/** Where one pending item of the absent person belongs. `end` is the first instant after the absence. */
export function classifyHandover(item: { kind: string; at: string | Date | null }, end: Date): HandoverClass {
  const at = item.at ? new Date(item.at) : null;
  if (item.kind === "CUSTOMS") return "WAITING";
  if (!at) return "SAFE";
  if (at >= end) return "CAN_WAIT";
  if (item.kind === "DECISION") return "DECISION_LIKELY";
  return "MUST_MOVE";
}
/** An open Journey with nothing due inside the absence: it can wait when its next step is dated after the return, otherwise it is safe. */
export const classifyJourney = (nextMoveDate: string | Date | null, end: Date): HandoverClass => (nextMoveDate && new Date(nextMoveDate) >= end ? "CAN_WAIT" : "SAFE");
/** An absence nobody could plan: it was recorded on or after the day it started. */
export const isUnplanned = (a: { startsOn: Date; createdAt: Date }) => a.createdAt.getTime() >= a.startsOn.getTime();

// ---------- Team Talent Map (§9) ----------

export type TalentEntry = { userId: string; name: string; block: string; kind: string; text: string };
export type TalentGroup = { key: string; label: string; block: string; people: { id: string; name: string }[] };
/** Capabilities the team said it has, grouped by what was written. It shows composition, complements and where
 *  knowledge sits with one person. It describes the team; it is not a label on anyone. */
export function talentMap(entries: TalentEntry[]): { groups: TalentGroup[]; single: TalentGroup[]; byBlock: Record<string, number> } {
  const m = new Map<string, TalentGroup>();
  for (const e of entries) {
    const key = `${e.block}|${norm(e.text)}`;
    if (!norm(e.text)) continue;
    const g = m.get(key) ?? { key, label: e.text, block: e.block, people: [] };
    if (!g.people.some((p) => p.id === e.userId)) g.people.push({ id: e.userId, name: e.name });
    m.set(key, g);
  }
  const groups = [...m.values()].sort((a, b) => b.people.length - a.people.length || a.label.localeCompare(b.label));
  const byBlock: Record<string, number> = {};
  for (const g of groups) byBlock[g.block] = (byBlock[g.block] ?? 0) + 1;
  // Knowledge held by exactly one person: if they are away, it is away with them.
  return { groups, single: groups.filter((g) => g.people.length === 1 && g.block !== "TALENT"), byBlock };
}
