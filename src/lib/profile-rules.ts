// Comercial · Perfiles (user request 2026-11-12). Pure rules, shared by the server and the forms in the browser.
// A profile is the customer's diary: what each conversation taught us, in the Sandler order (pain, struggle, impact,
// what it means for the person, budget, decision, agreement) and with its ECSA moment. People write it; SOLU never
// writes or infers any of it.

type Txt = { es: string; en: string };

export const PROFILE_SOURCE = "Perfiles";

export const ECSA: Record<string, Txt & { hint: Txt }> = {
  EXPLORAR: { es: "Explorar", en: "Explore", hint: { es: "Estamos entendiendo cómo trabaja y qué le duele", en: "We are learning how they work and what hurts" } },
  CONECTAR: { es: "Conectar", en: "Connect", hint: { es: "Estamos construyendo confianza con la persona", en: "We are building trust with the person" } },
  SOLUCIONAR: { es: "Solucionar", en: "Solve", hint: { es: "Estamos armando o entregando la solución", en: "We are building or delivering the solution" } },
  ACOMPANAR: { es: "Acompañar", en: "Accompany", hint: { es: "Estamos cuidando el resultado después de entregar", en: "We are looking after the result after delivery" } },
};
export const ecsaOf = (v: unknown): string | null => { const s = String(v ?? ""); return s in ECSA ? s : null; };

export type DiaryKey = "pain" | "struggle" | "impact" | "personal" | "budget" | "decision" | "agreement" | "notes";
export type DiaryField = { key: DiaryKey; label: Txt; ask: Txt; ph: Txt; more: boolean };
/** The diary, in the order of a Sandler conversation. `more` = shown under "Presupuesto, decisión y acuerdo". */
export const DIARY_FIELDS: DiaryField[] = [
  { key: "pain", more: false, label: { es: "Dolor", en: "Pain" }, ask: { es: "¿Qué le duele? El problema, en sus palabras.", en: "What hurts? The problem, in their words." }, ph: { es: "Ej.: «Cada vez que para la línea 2 pierdo el turno completo»", en: "E.g.: “Every time line 2 stops I lose the whole shift”" } },
  { key: "struggle", more: false, label: { es: "Lucha", en: "Struggle" }, ask: { es: "¿Con qué está luchando? Qué ha intentado y qué se lo impide.", en: "What are they struggling with? What they tried and what is in the way." }, ph: { es: "Ej.: Su proveedor actual tarda 6 semanas; ya probó tener repuesto en bodega y no le aprobaron el gasto", en: "E.g.: Their supplier takes 6 weeks; they tried keeping a spare and the spend was not approved" } },
  { key: "impact", more: false, label: { es: "Impacto", en: "Impact" }, ask: { es: "¿Qué le cuesta al negocio? Dinero, tiempo, paradas, clientes.", en: "What does it cost the business? Money, time, stops, customers." }, ph: { es: "Ej.: Dice que cada parada son unos 40 millones de pesos", en: "E.g.: Says each stop is about 40 million pesos" } },
  { key: "personal", more: false, label: { es: "Lo personal", en: "The personal side" }, ask: { es: "¿Qué significa para la persona? Qué se juega, qué le preocupa, qué le quitaría un peso de encima.", en: "What does it mean for the person? What is at stake for them, what worries them, what would take a weight off." }, ph: { es: "Ej.: Dijo que su jefe le pregunta por esa línea en cada comité y que no quiere «volver a pasar esa vergüenza»", en: "E.g.: Said their boss asks about that line at every committee and they don't want “that embarrassment again”" } },
  { key: "budget", more: true, label: { es: "Presupuesto", en: "Budget" }, ask: { es: "¿Hay dinero para resolverlo? De dónde sale y cuánto.", en: "Is there money to solve it? Where from and how much." }, ph: { es: "Ej.: Sale de mantenimiento; por encima de 20 millones pasa a gerencia", en: "E.g.: Comes from maintenance; above 20 million it goes to management" } },
  { key: "decision", more: true, label: { es: "Decisión", en: "Decision" }, ask: { es: "¿Quién decide, cómo y cuándo?", en: "Who decides, how and when?" }, ph: { es: "Ej.: Él recomienda, Compras emite la orden, deciden en el comité del 15", en: "E.g.: They recommend, Purchasing issues the order, the committee decides on the 15th" } },
  { key: "agreement", more: true, label: { es: "Acuerdo", en: "Agreement" }, ask: { es: "¿Qué acordamos que pasa después? Lo que hace cada lado.", en: "What did we agree happens next? What each side does." }, ph: { es: "Ej.: Nos manda la placa del motor; le respondemos con opciones el jueves", en: "E.g.: They send the motor nameplate; we answer with options on Thursday" } },
  { key: "notes", more: false, label: { es: "Notas", en: "Notes" }, ask: { es: "Cualquier otro detalle importante.", en: "Any other important detail." }, ph: { es: "Ej.: Prefiere que lo llamen antes de las 9", en: "E.g.: Prefers calls before 9" } },
];
export const DIARY_KEYS = DIARY_FIELDS.map((f) => f.key);
export const DIARY_MAX = 1500;

// ---------- Reading of the person ----------

export const ASPECTS: Record<string, Txt & { ph: Txt }> = {
  MOVES: { es: "Qué lo mueve", en: "What moves them", ph: { es: "Ej.: Quiere que su planta sea la referencia del grupo", en: "E.g.: Wants their plant to be the group's benchmark" } },
  WORRIES: { es: "Qué le preocupa", en: "What worries them", ph: { es: "Ej.: Quedar mal con producción por una parada que él no pudo evitar", en: "E.g.: Letting production down over a stop they could not prevent" } },
  PRESSURE: { es: "Qué presión tiene encima", en: "What pressure they carry", ph: { es: "Ej.: Le recortaron el presupuesto y le subieron la meta de disponibilidad", en: "E.g.: Their budget was cut and the availability target raised" } },
  DECIDES: { es: "Cómo decide", en: "How they decide", ph: { es: "Ej.: Pide datos y los revisa solo; no decide en la reunión", en: "E.g.: Asks for data and reviews it alone; does not decide in the meeting" } },
  TRUST: { es: "Qué le da confianza", en: "What earns their trust", ph: { es: "Ej.: Que le avisemos antes si un plazo cambia", en: "E.g.: Being told early when a date changes" } },
  STYLE: { es: "Cómo le gusta que le hablen", en: "How they like to be spoken to", ph: { es: "Ej.: Directo y con números; se impacienta con presentaciones largas", en: "E.g.: Direct and with numbers; gets impatient with long presentations" } },
};

/** Who reads and writes the reading of a person: the commercial side. Not the money side, not the board. */
export const READING_ROLES = ["GERENCIA", "DIRECTOR_COMERCIAL", "NEGOCIADOR_COMERCIAL", "NEGOCIADOR_OPERATIVO", "MARKETING"];
export const canSeeReadings = (u: { role: string }) => READING_ROLES.includes(u.role);

// Sensitive personal data and name-calling stay out, even here: what a person said or did is always enough.
const SENSITIVE = /(^|[^\p{L}])(religi[oó]n|religios[oa]|cat[oó]lic[oa]|cristian[oa]|evang[eé]lic[oa]|ate[oa]|de izquierda|de derecha|partido pol[ií]tico|uribista|petrista|embaraz\p{L}*|enferm\p{L}*|diagn[oó]stic\p{L}*|depresi[oó]n|deprimid[oa]|alcoh[oó]lic[oa]|divorci\p{L}*|separad[oa] de su|amante|homosexual|gay|lesbiana|orientaci[oó]n sexual|religion|religious|pregnan\p{L}*|illness|diagnos\p{L}*|depress\p{L}*|divorc\p{L}*|left-wing|right-wing)(?=$|[^\p{L}])/iu;
const NAME_CALLING = /(^|[^\p{L}])(tont[oa]|brut[oa]|est[uú]pid[oa]|idiota|imb[eé]cil|perezos[oa]|tacañ[oa]|hist[eé]ric[oa]|manipulable|f[aá]cil de (convencer|manipular|presionar)|stupid|idiot|lazy|stingy|pushover|easy to (manipulate|pressure))(?=$|[^\p{L}])/iu;
export type ReadingIssue = "SENSITIVE" | "NAME_CALLING";
export function readingIssue(text: string): ReadingIssue | null {
  if (SENSITIVE.test(text)) return "SENSITIVE";
  if (NAME_CALLING.test(text)) return "NAME_CALLING";
  return null;
}
export const READING_ISSUE_TEXT: Record<ReadingIssue, Txt> = {
  SENSITIVE: { es: "Aquí no guardamos datos de salud, religión, política ni vida familiar de una persona. Conviene escribir lo que dijo o hizo sobre su trabajo.", en: "We don't keep a person's health, religion, politics or family life here. It works better to write what they said or did about their work." },
  NAME_CALLING: { es: "Conviene describir lo que la persona dijo o hizo, sin calificarla. Así otro compañero lo entiende igual que tú.", en: "It works better to describe what the person said or did, without labelling them. That way a colleague reads it the way you do." },
};

// ---------- A diary entry, checked the same way in the browser and on the server ----------

export type MeetingChoice = { kind: "none" } | { kind: "new"; type: "CALL" | "VIDEO" | "MEETING" } | { kind: "act"; id: string };
export function meetingOf(raw: unknown): MeetingChoice | null {
  const s = String(raw ?? "");
  if (s === "none") return { kind: "none" };
  if (s === "new:CALL" || s === "new:VIDEO" || s === "new:MEETING") return { kind: "new", type: s.slice(4) as "CALL" | "VIDEO" | "MEETING" };
  if (/^act:[a-z0-9]{1,40}$/i.test(s)) return { kind: "act", id: s.slice(4) };
  return null;
}
/** What a meeting registered from the diary is stored as (same outcomes as Línea de comunicaciones: it happened). */
export const NEW_MEETING = {
  CALL: { type: "CALL", outcome: "ANSWERED", es: "Llamada", en: "Call" },
  VIDEO: { type: "CALL", outcome: "VIDEO_DONE", es: "Videollamada", en: "Video call" },
  MEETING: { type: "MEETING", outcome: "DONE", es: "Visita", en: "Visit" },
} as const;

export type DiaryInput = Partial<Record<DiaryKey, string | null>> & { meeting: string; happenedOn: string; followUp: string | null; followUpOn: string; today: string };
export type DiaryIssue = "REUNION" | "VACIO" | "FECHA" | "PLAN_FECHA" | "PLAN_TEXTO" | "PLAN_PASADO" | ReadingIssue;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** First thing to fix in a diary entry, or null. Days are compared as YYYY-MM-DD text. */
export function diaryIssue(d: DiaryInput): DiaryIssue | null {
  const m = meetingOf(d.meeting);
  if (!m) return "REUNION";
  if (!DIARY_KEYS.some((k) => (d[k] ?? "").trim())) return "VACIO";
  if (m.kind !== "act" && (!DAY.test(d.happenedOn) || d.happenedOn > d.today)) return "FECHA";
  const plan = (d.followUp ?? "").trim();
  if (plan && !DAY.test(d.followUpOn)) return "PLAN_FECHA";
  if (!plan && d.followUpOn) return "PLAN_TEXTO";
  if (plan && d.followUpOn < d.today) return "PLAN_PASADO";
  return readingIssue(d.personal ?? "");
}
export const DIARY_ISSUE_TEXT: Record<DiaryIssue, Txt> = {
  REUNION: { es: "Elige de qué conversación sale esta entrada.", en: "Choose which conversation this entry comes from." },
  VACIO: { es: "Escribe al menos una cosa: el dolor, la lucha o una nota.", en: "Write at least one thing: the pain, the struggle or a note." },
  FECHA: { es: "La fecha de la conversación no puede ser futura.", en: "The date of the conversation can't be in the future." },
  PLAN_FECHA: { es: "Ponle fecha al seguimiento, para que SOLU te lo recuerde ese día.", en: "Give the follow-up a date, so SOLU reminds you that day." },
  PLAN_TEXTO: { es: "Escribe qué vas a hacer en el seguimiento.", en: "Write what you will do in the follow-up." },
  PLAN_PASADO: { es: "La fecha del seguimiento ya pasó. Elige hoy o un día más adelante.", en: "The follow-up date is in the past. Choose today or a later day." },
  ...READING_ISSUE_TEXT,
};

// ---------- Material: documents, products they may need, brands they use ----------

export const ITEM_KINDS: Record<string, Txt & { title: Txt; ph: Txt; add: Txt }> = {
  DOCUMENT: { es: "Documentos", en: "Documents", title: { es: "Nombre del documento", en: "Document name" }, ph: { es: "Ej.: Plano de la línea 2", en: "E.g.: Line 2 drawing" }, add: { es: "Agregar documento", en: "Add document" } },
  PRODUCT_NEED: { es: "Productos que puede necesitar", en: "Products they may need", title: { es: "Producto", en: "Product" }, ph: { es: "Ej.: Variador Siemens G120C 7.5 kW", en: "E.g.: Siemens G120C 7.5 kW drive" }, add: { es: "Agregar producto", en: "Add product" } },
  BRAND_USED: { es: "Marcas que ya usa", en: "Brands they already use", title: { es: "Marca", en: "Brand" }, ph: { es: "Ej.: SEW Eurodrive", en: "E.g.: SEW Eurodrive" }, add: { es: "Agregar marca", en: "Add brand" } },
};
export const ITEM_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
export const ITEM_FILE_MIMES = [...ITEM_IMAGE_MIMES, "application/pdf"];
export const MAX_ITEM_FILE_BYTES = 5 * 1024 * 1024;
/** Files per customer profile (photos are shrunk in the browser before uploading). Links have no limit. */
export const MAX_PROFILE_FILES = 40;

/** Only web links: http or https, with a host. Anything else (javascript:, file:, …) is refused. */
export function safeUrl(raw: unknown): string | null {
  let s = String(raw ?? "").trim();
  if (!s || s.length > 500) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".") ? u.toString() : null;
  } catch { return null; }
}
