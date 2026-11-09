// Comercial C1 · Technical Discovery (§4) and Functional Assembly Check (§5). Pure rules, no database.
// Principle: what the customer literally asked, what it needs to WORK, and what we quote are three different
// things. SOLU shows the gap and asks; it never decides compatibility or equivalence by itself.
import { checkMessage, type Issue } from "./comm-policy";

type L = { es: string; en: string };
export const RULES_VERSION = "scope-v1";

/** Fold accents and case so "Válvula" and "valvula" match. */
export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Product key for relationships: P/N if there is one (no spaces/dashes/dots), otherwise the folded name. */
export const keyOf = (codeOrName: string) => { const s = codeOrName.trim(); return /\d/.test(s) && s.length <= 40 ? s.toUpperCase().replace(/[\s\-./]/g, "") : fold(s).replace(/\s+/g, " "); };
const words = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "iu");

// ---------- §4 Questions by family (no 35 generic fields) ----------
export type Field = { key: string } & L & { why: L };
export type Family = L & { rx: RegExp; fields: Field[]; assembly?: { question: L; related: L[] } };
const f = (key: string, es: string, en: string, wes: string, wen: string): Field => ({ key, es, en, why: { es: wes, en: wen } });
export const FAMILIES: Record<string, Family> = {
  MOTORREDUCTOR: {
    es: "Motorreductor", en: "Gearmotor", rx: words("motorreductor(es)?|motor ?reductor|gear ?motors?|motor con reductor"),
    fields: [f("kw", "Potencia (kW o HP)", "Power (kW or HP)", "Define el tamaño", "Sets the size"), f("ratio", "Relación de reducción", "Reduction ratio", "Define la velocidad de salida", "Sets output speed"), f("rpmOut", "RPM de salida", "Output RPM", "Lo que ve la máquina", "What the machine sees"), f("voltage", "Voltaje / frecuencia", "Voltage / frequency", "Debe coincidir con la planta", "Must match the plant"), f("mounting", "Montaje (patas, brida, eje hueco)", "Mounting (foot, flange, hollow shaft)", "Si no coincide, no se puede instalar", "If it doesn't match, it can't be installed")],
    assembly: { question: { es: "¿Necesitan el conjunto motor + reductor, o reutilizarán alguno de los dos?", en: "Do they need the motor + gearbox assembly, or will they reuse one of them?" }, related: [{ es: "Motor", en: "Motor" }, { es: "Reductor", en: "Gearbox" }, { es: "Acople", en: "Coupling" }] },
  },
  MOTOR: {
    es: "Motor", en: "Motor", rx: words("motor(es)?|motors?"),
    fields: [f("kw", "Potencia (kW o HP)", "Power (kW or HP)", "Define el tamaño", "Sets the size"), f("voltage", "Voltaje / frecuencia", "Voltage / frequency", "Debe coincidir con la planta", "Must match the plant"), f("rpm", "RPM", "RPM", "Velocidad de la máquina", "Machine speed"), f("frame", "Frame / carcasa", "Frame", "Define si encaja en la base", "Defines whether it fits the base"), f("mounting", "Montaje (B3, B5, B14…)", "Mounting (B3, B5, B14…)", "Si no coincide, no se puede instalar", "If it doesn't match, it can't be installed")],
    assembly: { question: { es: "¿Solo el motor, o motor con reductor (motorreductor)? ¿Lleva acople o base?", en: "Motor only, or motor with gearbox (gearmotor)? Does it come with coupling or base?" }, related: [{ es: "Reductor", en: "Gearbox" }, { es: "Acople", en: "Coupling" }, { es: "Base", en: "Base" }] },
  },
  REDUCTOR: {
    es: "Reductor", en: "Gearbox", rx: words("reductor(es)?|caja reductora|gear ?box(es)?|reducer"),
    fields: [f("ratio", "Relación de reducción", "Reduction ratio", "Define la velocidad de salida", "Sets output speed"), f("torque", "Torque de salida", "Output torque", "Si es menor, falla con carga", "If lower, it fails under load"), f("mounting", "Montaje y ejes", "Mounting and shafts", "Debe encajar con motor y máquina", "Must fit motor and machine")],
    assembly: { question: { es: "¿Solo el reductor, o también el motor que lo mueve?", en: "Gearbox only, or also the motor that drives it?" }, related: [{ es: "Motor", en: "Motor" }, { es: "Acople", en: "Coupling" }] },
  },
  VARIADOR: {
    es: "Variador", en: "Drive", rx: words("variador(es)?|vfd|drive|inversor|convertidor de frecuencia|sinamics|powerflex"),
    fields: [f("model", "Modelo exacto", "Exact model", "Hay muchas variantes por potencia", "Many variants by power"), f("voltage", "Voltaje de entrada", "Input voltage", "Debe coincidir con la planta", "Must match the plant"), f("firmware", "Versión / firmware", "Version / firmware", "Una versión distinta puede no aceptar la configuración", "A different version may not accept the configuration")],
  },
  RODAMIENTO: {
    es: "Rodamiento", en: "Bearing", rx: words("rodamientos?|balineras?|chumaceras?|bearings?"),
    fields: [f("dims", "Medidas (interior × exterior × ancho)", "Size (bore × OD × width)", "Define si encaja", "Defines fit"), f("seal", "Sello o blindaje (2RS, ZZ, abierto)", "Seal or shield (2RS, ZZ, open)", "Cambia la vida útil en planta", "Changes service life on site"), f("clearance", "Juego interno (C3, C4…)", "Internal clearance (C3, C4…)", "Depende de temperatura y velocidad", "Depends on temperature and speed")],
  },
  VALVULA: {
    es: "Válvula", en: "Valve", rx: words("v[aá]lvulas?|valves?"),
    fields: [f("dn", "Tamaño (DN o pulgadas)", "Size (DN or inches)", "Define si conecta", "Defines whether it connects"), f("pressure", "Presión / clase", "Pressure / class", "Seguridad del proceso", "Process safety"), f("material", "Material del cuerpo y sellos", "Body and seal material", "Compatibilidad con el fluido", "Fluid compatibility"), f("connection", "Conexión (brida, rosca, wafer)", "Connection (flange, thread, wafer)", "Si no coincide, no se instala", "If it doesn't match, it can't be installed")],
    assembly: { question: { es: "¿Solo el cuerpo de la válvula, o con actuador y accesorios?", en: "Valve body only, or with actuator and accessories?" }, related: [{ es: "Actuador", en: "Actuator" }, { es: "Posicionador", en: "Positioner" }] },
  },
  BOMBA: {
    es: "Bomba", en: "Pump", rx: words("bombas?|pumps?"),
    fields: [f("flow", "Caudal", "Flow", "Lo que debe mover", "What it must move"), f("head", "Altura / presión", "Head / pressure", "Lo que debe vencer", "What it must overcome"), f("material", "Material y sello", "Material and seal", "Compatibilidad con el fluido", "Fluid compatibility")],
    assembly: { question: { es: "¿Solo la bomba, o con motor, acople y base?", en: "Pump only, or with motor, coupling and base?" }, related: [{ es: "Motor", en: "Motor" }, { es: "Acople", en: "Coupling" }, { es: "Base", en: "Base" }] },
  },
  TALADRO: {
    es: "Taladro", en: "Drill", rx: words("taladros?|drills?"), fields: [f("model", "Modelo", "Model", "Define accesorios compatibles", "Defines compatible accessories")],
    assembly: { question: { es: "¿Solo la herramienta, o con brocas, cargador y batería?", en: "Tool only, or with bits, charger and battery?" }, related: [{ es: "Brocas", en: "Bits" }, { es: "Cargador y batería", en: "Charger and battery" }] },
  },
  PRENSA: {
    es: "Prensa", en: "Press", rx: words("prensas?|press(es)?"), fields: [f("model", "Modelo y secciones", "Model and sections", "Define el tooling", "Defines the tooling")],
    assembly: { question: { es: "¿La prensa sola, o con tooling y orugas para operar?", en: "The press alone, or with tooling and tracks to operate?" }, related: [{ es: "Tooling", en: "Tooling" }, { es: "Orugas", en: "Tracks" }] },
  },
};
/** First family whose words appear (gearmotor is checked before motor on purpose). */
export function familyOf(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [k, fam] of Object.entries(FAMILIES)) if (fam.rx.test(text)) return k;
  return null;
}

// ---------- §5 Words that can mean more than one thing ----------
export type Term = { key: string; rx: RegExp; question: L };
export const AMBIGUOUS: Term[] = [
  { key: "completo", rx: words("complet[oa]s?|complete"), question: { es: "«Completo» ¿qué incluye para ustedes? ¿Qué piezas o accesorios necesita para operar?", en: "“Complete”: what does it include for you? Which parts or accessories does it need to operate?" } },
  { key: "kit", rx: words("kits?"), question: { es: "¿Qué piezas debe traer el kit? ¿Tienen una lista o una referencia del fabricante?", en: "Which parts should the kit include? Do you have a list or a manufacturer reference?" } },
  { key: "conjunto", rx: words("conjunto|ensamble|ensamblaje|assembly|assembled"), question: { es: "¿Necesitan el conjunto armado o solo una de sus piezas?", en: "Do you need the assembled unit or just one of its parts?" } },
  { key: "listo", rx: words("listo para (usar|operar|instalar)|ready[- ]to[- ](use|run|install)|plug and play"), question: { es: "¿Qué debe traer para quedar listo para operar (cables, bases, programación)?", en: "What should it include to be ready to operate (cables, bases, programming)?" } },
  { key: "reemplazo", rx: words("reemplazo|replacement|reposici[oó]n|sustituto|igual al (actual|anterior)"), question: { es: "¿Debe ser idéntico al actual (mismo P/N), o sirve uno equivalente que cumpla la misma función?", en: "Must it be identical to the current one (same P/N), or does an equivalent that does the same job work?" } },
  { key: "llave", rx: words("llave en mano|turn[- ]?key"), question: { es: "«Llave en mano» ¿incluye instalación, puesta en marcha y capacitación?", en: "“Turnkey”: does it include installation, commissioning and training?" } },
  { key: "instalacion", rx: words("instalaci[oó]n|installation|instalad[oa]"), question: { es: "¿Instalación solamente, o también puesta en marcha (pruebas y arranque)?", en: "Installation only, or also commissioning (tests and start-up)?" } },
];
/** Spoken assemblies that need two or more components in scope (AC02). */
const ASSEMBLY_WORDS: { key: string; rx: RegExp; needs: { label: L; rx: RegExp }[] }[] = [
  { key: "motorreductor", rx: FAMILIES.MOTORREDUCTOR.rx, needs: [{ label: { es: "Motor", en: "Motor" }, rx: words("motor(es)?|motors?|motorreductor(es)?") }, { label: { es: "Reductor", en: "Gearbox" }, rx: words("reductor(es)?|gear ?box(es)?|motorreductor(es)?|reducer") }] },
];

export type Source = { where: string; text: string | null | undefined };
export type Ambiguity = { term: string; where: string; fragment: string; question: L };
const fragmentAt = (text: string, m: RegExpExecArray) => { const a = Math.max(0, m.index - 40); const b = Math.min(text.length, m.index + m[0].length + 40); return `${a > 0 ? "…" : ""}${text.slice(a, b).replace(/\s+/g, " ").trim()}${b < text.length ? "…" : ""}`; };

/** Ambiguous terms found in the Journey's own words (one per term, first place it appears). */
export function findAmbiguities(sources: Source[]): Ambiguity[] {
  const out = new Map<string, Ambiguity>();
  for (const s of sources) {
    if (!s.text) continue;
    for (const t of AMBIGUOUS) {
      if (out.has(t.key)) continue;
      const m = new RegExp(t.rx.source, "iu").exec(s.text);
      if (m) out.set(t.key, { term: t.key, where: s.where, fragment: fragmentAt(s.text, m), question: t.question });
    }
  }
  return [...out.values()];
}

// ---------- Matrix and Operational Completeness ----------
export const STATUS: Record<string, L> = {
  INCLUDED: { es: "Incluido", en: "Included" }, EXCLUDED: { es: "Excluido", en: "Excluded" }, OPTIONAL: { es: "Opcional / recomendado", en: "Optional / recommended" },
  CUSTOMER_SUPPLIED: { es: "Lo pone el cliente", en: "Customer supplies" }, TO_CONFIRM: { es: "Por confirmar", en: "To confirm" },
};
export const IDENTITY: Record<string, L> = {
  EXACT: { es: "Identidad exacta", en: "Exact identity" }, PROBABLE: { es: "Probable", en: "Probable" }, MULTIPLE: { es: "Varios candidatos", en: "Multiple candidates" }, UNKNOWN: { es: "Sin identificar", en: "Unknown" },
};
export const CONDITION: Record<string, L> = { OEM_NEW: { es: "Original nuevo", en: "OEM new" }, NEW: { es: "Nuevo", en: "New" }, REFURBISHED: { es: "Reacondicionado", en: "Refurbished" }, USED: { es: "Usado", en: "Used" }, ANY: { es: "Cualquiera que cumpla", en: "Any that works" } };
export const FACT_STATE: Record<string, L> = { CONFIRMED: { es: "Confirmado (placa o documento)", en: "Confirmed (nameplate or document)" }, REPORTED: { es: "Reportado (alguien lo dijo)", en: "Reported (someone said it)" }, HYPOTHESIS: { es: "Hipótesis", en: "Hypothesis" } };
export const REL_KINDS: Record<string, L> = {
  PART_OF: { es: "es parte de", en: "is part of" }, ASSEMBLED_WITH: { es: "se ensambla con", en: "is assembled with" }, DRIVES: { es: "mueve a", en: "drives" },
  REQUIRES: { es: "requiere", en: "requires" }, MATES_WITH: { es: "acopla con", en: "mates with" }, OPTIONAL_WITH: { es: "opcional con", en: "optional with" },
  CUSTOMER_REUSES: { es: "el cliente reutiliza", en: "customer reuses" }, SOLD_AS_ASSEMBLY: { es: "se vende en conjunto con", en: "is sold as assembly with" }, SOLD_SEPARATELY: { es: "se vende aparte de", en: "is sold separately from" },
};
export const COMPLETENESS: Record<string, L & { tone: string }> = {
  NOT_STARTED: { es: "Caso simple: sin alcance que aclarar", en: "Simple case: no scope to clarify", tone: "dash" },
  INCOMPLETE: { es: "Incompleto", en: "Incomplete", tone: "risk" },
  NEEDS_CONFIRMATION: { es: "Necesita confirmación", en: "Needs confirmation", tone: "attn" },
  CONFIRMED_WITH_CUSTOMER_SUPPLIED: { es: "Confirmado, con partes que pone el cliente", en: "Confirmed, with customer-supplied parts", tone: "ok" },
  CONFIRMED: { es: "Confirmado", en: "Confirmed", tone: "ok" },
};

export type Line = { id: string; component: string; code: string | null; requested: boolean; requiredForFunction: boolean; status: string; identity: string; confirmationId: string | null; family: string | null };
export type QuoteLine = { code: string | null; description: string };
export type Gap = { kind: string; severity: "INCOMPLETE" | "NEEDS_CONFIRMATION" | "WARN"; lineId?: string; term?: string } & L;

/** Is this component on the quote? By P/N first, otherwise by its name in a line description. */
export function inQuote(l: Pick<Line, "component" | "code">, q: QuoteLine[]) {
  if (l.code) { const k = keyOf(l.code); if (q.some((x) => x.code && keyOf(x.code) === k)) return true; }
  const name = fold(l.component).trim();
  return name.length >= 3 && q.some((x) => fold(`${x.code ?? ""} ${x.description}`).includes(name));
}

export function completeness(input: { lines: Line[]; ambiguities: Ambiguity[]; resolvedTerms: string[]; quoteLines: QuoteLine[] | null; sources: Source[] }) {
  const { lines, quoteLines } = input;
  const gaps: Gap[] = [];
  const add = (g: Gap) => gaps.push(g);
  const open = input.ambiguities.filter((a) => !input.resolvedTerms.includes(a.term));
  for (const a of open) add({ kind: "AMBIGUOUS", severity: "NEEDS_CONFIRMATION", term: a.term, es: `Aclarar qué significa «${a.fragment}»`, en: `Clarify what “${a.fragment}” means` });

  for (const l of lines) {
    const n = l.component;
    if (l.status === "TO_CONFIRM") add({ kind: "TO_CONFIRM", severity: "NEEDS_CONFIRMATION", lineId: l.id, es: `${n}: por confirmar si va incluido`, en: `${n}: to confirm whether it's included` });
    if (l.requiredForFunction && l.status === "EXCLUDED" && !l.confirmationId) add({ kind: "REQUIRED_EXCLUDED", severity: "INCOMPLETE", lineId: l.id, es: `${n} es necesario para operar y está excluido sin que el cliente lo haya confirmado`, en: `${n} is needed to operate and is excluded without the customer confirming it` });
    if (!l.requiredForFunction && l.status === "EXCLUDED" && l.requested && !l.confirmationId) add({ kind: "REQUESTED_EXCLUDED", severity: "NEEDS_CONFIRMATION", lineId: l.id, es: `${n}: el cliente lo pidió y no va incluido; confírmalo con el cliente`, en: `${n}: the customer asked for it and it isn't included; confirm with the customer` });
    if (l.status === "CUSTOMER_SUPPLIED" && !l.confirmationId) add({ kind: "CUSTOMER_SUPPLIED_UNCONFIRMED", severity: "NEEDS_CONFIRMATION", lineId: l.id, es: `${n}: falta que el cliente confirme que lo pone él`, en: `${n}: the customer still has to confirm they supply it` });
    if (l.status === "INCLUDED" && l.requiredForFunction && (l.identity === "UNKNOWN" || l.identity === "MULTIPLE")) add({ kind: "IDENTITY", severity: "NEEDS_CONFIRMATION", lineId: l.id, es: `${n}: ${l.identity === "MULTIPLE" ? "hay varios candidatos" : "falta identificarlo"}; no se puede prometer algo que no sabemos qué es`, en: `${n}: ${l.identity === "MULTIPLE" ? "multiple candidates" : "not identified yet"}; we can't promise something we don't know` });
    if (l.status === "INCLUDED" && l.identity === "PROBABLE") add({ kind: "PROBABLE", severity: "WARN", lineId: l.id, es: `${n}: identidad probable, valídala antes de comprar`, en: `${n}: probable identity, validate it before buying` });
    if (l.status === "INCLUDED" && quoteLines && quoteLines.length && !inQuote(l, quoteLines)) add({ kind: "NOT_QUOTED", severity: "INCOMPLETE", lineId: l.id, es: `${n} está incluido en el alcance pero no aparece en la cotización`, en: `${n} is in scope but isn't on the quote` });
  }
  // AC02: the customer spoke of an assembly, but the included/quoted scope covers only part of it.
  const spoken = input.sources.map((s) => s.text ?? "").join("\n");
  const covered = [...lines.filter((l) => l.status === "INCLUDED" || l.status === "CUSTOMER_SUPPLIED").map((l) => `${l.component} ${l.code ?? ""}`), ...(quoteLines ?? []).map((q) => `${q.code ?? ""} ${q.description}`)].join("\n");
  for (const a of ASSEMBLY_WORDS) {
    if (!a.rx.test(spoken) || input.resolvedTerms.includes(`assembly:${a.key}`)) continue;
    const missing = a.needs.filter((n) => !n.rx.test(covered));
    if (covered.trim() && missing.length) add({ kind: "ASSEMBLY_GAP", severity: "INCOMPLETE", term: `assembly:${a.key}`, es: `Se habló de ${a.key} pero el alcance no cubre: ${missing.map((m) => m.label.es).join(", ")}`, en: `A ${a.key} was mentioned but the scope doesn't cover: ${missing.map((m) => m.label.en).join(", ")}` });
  }
  // Family assembly questions for included components (e.g. motor → reductor?) until answered.
  for (const l of lines) {
    const fam = l.family ? FAMILIES[l.family] : null;
    if (!fam?.assembly || l.status !== "INCLUDED" || input.resolvedTerms.includes(`family:${l.id}`)) continue;
    const others = lines.filter((x) => x.id !== l.id).map((x) => fold(x.component)).join(" ");
    if (fam.assembly.related.every((r) => others.includes(fold(r.es)) || others.includes(fold(r.en)))) continue;
    add({ kind: "FAMILY_QUESTION", severity: "NEEDS_CONFIRMATION", lineId: l.id, term: `family:${l.id}`, es: `${l.component}: ${fam.assembly.question.es}`, en: `${l.component}: ${fam.assembly.question.en}` });
  }

  const state = gaps.some((g) => g.severity === "INCOMPLETE") ? "INCOMPLETE"
    : gaps.some((g) => g.severity === "NEEDS_CONFIRMATION") ? "NEEDS_CONFIRMATION"
    : !lines.length && !input.ambiguities.length ? "NOT_STARTED"
    : lines.some((l) => l.status === "CUSTOMER_SUPPLIED") ? "CONFIRMED_WITH_CUSTOMER_SUPPLIED" : "CONFIRMED";
  return { state, gaps, blocks: state === "INCOMPLETE" || state === "NEEDS_CONFIRMATION" };
}

/** Questions for the CUSTOMER from the open gaps. Internal gaps (not quoted yet, probable identity) never go out. */
export function customerQuestions(gaps: Gap[], lines: Pick<Line, "id" | "component" | "family">[], lang: "ES" | "EN") {
  const es = lang === "ES";
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: { key: string; text: string }[] = [];
  for (const g of gaps) {
    const l = g.lineId ? byId.get(g.lineId) : undefined;
    const n = l?.component ?? "";
    const q = ((): string | null => {
      switch (g.kind) {
        case "AMBIGUOUS": { const t = AMBIGUOUS.find((a) => a.key === g.term); return t ? (es ? t.question.es : t.question.en) : null; }
        case "FAMILY_QUESTION": { const f = l?.family ? FAMILIES[l.family]?.assembly : null; return f ? `${n}: ${es ? f.question.es : f.question.en}` : null; }
        case "ASSEMBLY_GAP": return es ? "¿Necesitan el motorreductor completo (motor y reductor), o reutilizarán alguno de los dos?" : "Do you need the complete gearmotor (motor and gearbox), or will you reuse one of them?";
        case "TO_CONFIRM": return es ? `${n}: ¿lo incluimos en la oferta, o ya lo tienen?` : `${n}: shall we include it in the offer, or do you already have it?`;
        case "CUSTOMER_SUPPLIED_UNCONFIRMED": return es ? `¿Me confirmas que ${n} lo ponen ustedes?` : `Could you confirm you'll supply ${n}?`;
        case "REQUESTED_EXCLUDED": return es ? `${n} no va incluido en esta oferta. ¿Les funciona así?` : `${n} isn't included in this offer. Does that work for you?`;
        case "REQUIRED_EXCLUDED": return es ? `Para que funcione se necesita ${n}. ¿Lo tienen ustedes, o lo incluimos?` : `${n} is needed for it to work. Do you have it, or shall we include it?`;
        case "IDENTITY": return es ? `¿Nos compartes una foto de la placa de ${n} (y de cómo va montado)?` : `Could you share a photo of ${n}'s nameplate (and how it's mounted)?`;
        default: return null;
      }
    })();
    if (q && !out.some((o) => o.text === q)) out.push({ key: g.term ?? g.lineId ?? g.kind, text: q });
  }
  return out;
}

// ---------- Carnegie clarification message (AC03) ----------
// \p{L}* (not \w) so accented endings like "especificó" match.
const BLAME = words(String.raw`(compras|ustedes|el cliente) no (especific\p{L}*|dijo|dijeron|aclar\p{L}*|indic\p{L}*)|pidieron mal|no nos (dijeron|informaron)|se equivocaron|mal especificad\p{L}*|purchasing (didn'?t|did not) (specify|say)|you didn'?t (say|specify)`);
export function blameIssues(text: string): Issue[] {
  return BLAME.test(text) ? [{ code: "BLAME", severity: "BLOCK", es: "Suena a que alguien del cliente (por ejemplo Compras) se equivocó. Pregunta por lo que falta, sin buscar culpables.", en: "It sounds like someone at the customer (e.g. Purchasing) got it wrong. Ask about what's missing without assigning blame." }] : [];
}

export function clarificationMessage(o: { lang: "ES" | "EN"; contactFirstName: string | null; desiredResult: string | null; questions: string[] }) {
  const es = o.lang === "ES";
  const hi = o.contactFirstName ? (es ? `Hola ${o.contactFirstName},` : `Hi ${o.contactFirstName},`) : es ? "Hola," : "Hi,";
  const goal = o.desiredResult?.trim().replace(/[.\s]+$/, "");
  const why = goal
    ? es ? `Para que ${goal.charAt(0).toLowerCase()}${goal.slice(1)} desde el primer día, quiero asegurarme de que cotizamos exactamente lo que necesitan.` : `So that ${goal.charAt(0).toLowerCase()}${goal.slice(1)} from day one, I want to make sure we quote exactly what you need.`
    : es ? "Quiero asegurarme de que cotizamos exactamente lo que necesitan para que funcione desde el primer día." : "I want to make sure we quote exactly what you need so it works from day one.";
  const qs = o.questions.slice(0, 5).map((q, n) => `${n + 1}. ${q}`).join("\n");
  const close = es ? "Si es más fácil, una foto del equipo completo y de la placa nos ayuda mucho. ¿Me confirmas cuando puedas?" : "If it's easier, a photo of the whole unit and its nameplate helps a lot. Could you confirm when you can?";
  const text = `${hi}\n\n${why}\n\n${qs}\n\n${close}`;
  const issues = [...checkMessage(text, { purpose: "FOLLOW_UP", hasHistory: true }), ...blameIssues(text)];
  return { text, issues };
}
