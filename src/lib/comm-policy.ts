// Mercado M5 · Communication Policy (§11): the ONE place where SOLU drafts and checks messages.
// Pipeline (§11.12): business context → audience → purpose → known facts + open loops → value/impact →
// Carnegie rules → draft → factuality/tone/authority check → human review (always, for external messages).
// Rule-based (no AI yet): drafts only use facts handed in with their source id; nothing is invented.
// Carnegie governs tone, never weakens a control (§11.3): hard stops stay clear and firm.

export const POLICY_VERSION = "carnegie-v1";
type L = { es: string; en: string };
export type Lang = "ES" | "EN";

export type Purpose = "EXPLORE" | "RECONNECT" | "FOLLOW_UP" | "COLLECTION" | "RECOVERY" | "HARD_STOP";
export const PURPOSES: Record<Purpose, L & { material: boolean }> = {
  EXPLORE: { es: "Conocer y aprender", en: "Get to know and learn", material: false },
  RECONNECT: { es: "Retomar por algo que cambió", en: "Reconnect because something changed", material: false },
  FOLLOW_UP: { es: "Cerrar un compromiso abierto", en: "Close an open commitment", material: false },
  COLLECTION: { es: "Validar un pago", en: "Check on a payment", material: true },
  RECOVERY: { es: "Conversación difícil / recuperación", en: "Difficult conversation / recovery", material: true },
  HARD_STOP: { es: "Detener algo por control (p. ej. banco)", en: "Stop something for a control (e.g. bank)", material: true },
};
export const CHANNELS: Record<string, L> = {
  EMAIL: { es: "Correo", en: "Email" }, WHATSAPP: { es: "WhatsApp", en: "WhatsApp" }, CALL: { es: "Llamada", en: "Call" }, VISIT: { es: "Visita", en: "Visit" }, INTRO: { es: "Que alguien nos presente", en: "Ask someone to introduce us" },
};

/** A fact the draft may use. id = where it came from (e.g. "invoice:abc", "signal:xyz"). */
export type Fact = { id: string; text: L; kind: "FACT" | "INFERENCE" };

export type Ctx = {
  lang: Lang;
  purpose: Purpose;
  recipientFirstName: string | null;
  senderName: string;
  /** We have talked with this person before (activities, threads, Journeys). Without it, no closeness phrases. */
  hasHistory: boolean;
  /** Why now, as a fact with its source. Required except for EXPLORE. */
  reason?: Fact;
  /** Something they told us they care about (evidence-based), to speak in their terms. */
  theirInterest?: Fact;
  question?: L;
  loop?: { side: "OURS" | "THEIRS"; what: string; dueAt?: Date | null };
  invoice?: { number: string; dueAt: Date; promisedFor?: Date | null; brokenPromises: number };
  recovery?: { whatChanged: string; impact?: string | null; ourFault: boolean; options: string[] };
  hardStop?: { what: string };
  legitimateUrgency?: boolean;
};

const fmt = (d: Date, lang: Lang) => new Intl.DateTimeFormat(lang === "EN" ? "en-US" : "es-CO", { day: "numeric", month: "long", timeZone: "UTC" }).format(d);
const hi = (c: Ctx) => (c.lang === "EN" ? `Hi${c.recipientFirstName ? ` ${c.recipientFirstName}` : ""},` : `Hola${c.recipientFirstName ? ` ${c.recipientFirstName}` : ""}.`);
const T = (c: Ctx, x: L) => (c.lang === "EN" ? x.en : x.es);

/** Draft + the metadata §11.12 asks for. The text only uses facts from ctx. */
export function compose(c: Ctx) {
  const facts: Fact[] = [];
  const use = (f?: Fact) => { if (f) facts.push(f); return f ? T(c, f.text) : ""; };
  const lines: string[] = [hi(c)];
  const q = c.question ? T(c, c.question) : null;
  const es = c.lang !== "EN";
  switch (c.purpose) {
    case "EXPLORE": {
      // Start from them, not from us (§11.8.5); a genuine question when understanding is missing.
      const r = use(c.reason);
      lines.push(es ? `${r ? `${r} ` : ""}Me gustaría entender mejor cómo trabajan ustedes, para ver si hay algo en lo que podamos ser útiles.` : `${r ? `${r} ` : ""}I'd like to understand better how you work, to see if there's anything we could help with.`);
      if (q) lines.push(q);
      lines.push(es ? "¿Te parece si lo conversamos 15 minutos esta semana o la próxima?" : "Would 15 minutes this week or next work for a quick conversation?");
      break;
    }
    case "RECONNECT": {
      lines.push(use(c.reason));
      const i = use(c.theirInterest);
      // Their own words, quoted: no paraphrase that could change what they meant.
      if (i) lines.push(es ? `Lo tengo presente por algo que nos contaste: «${i.replace(/[.\s]+$/, "")}».` : `It's on my mind because of something you told us: “${i.replace(/[.\s]+$/, "")}”.`);
      lines.push(q ?? (es ? "¿Cómo lo están viendo ustedes?" : "How are you seeing it on your side?"));
      lines.push(es ? "Si sirve, preparo algo con tiempo para que no los tome por sorpresa." : "If useful, I can prepare something ahead of time so it doesn't catch you by surprise.");
      break;
    }
    case "FOLLOW_UP": {
      const l = c.loop!;
      const when = l.dueAt ? fmt(l.dueAt, c.lang) : null;
      if (l.side === "OURS") lines.push(es ? `Quedé de ${lowerFirst(l.what)}${when ? ` para el ${when}` : ""}. Aquí va.` : `I said I would ${lowerFirst(l.what)}${when ? ` by ${when}` : ""}. Here it is.`);
      else lines.push(es ? `Quería retomar contigo: ${lowerFirst(l.what)}${when ? ` (lo teníamos previsto para el ${when})` : ""}.` : `I wanted to pick this up with you: ${lowerFirst(l.what)}${when ? ` (we had it planned for ${when})` : ""}.`);
      if (c.reason) lines.push(use(c.reason));
      lines.push(l.side === "OURS" ? (es ? "¿Te sirve así o ajusto algo?" : "Does this work for you, or should I adjust something?") : (es ? "¿Hay algo de nuestro lado que te ayude a avanzar?" : "Is there anything on our side that would help move it forward?"));
      break;
    }
    case "COLLECTION": {
      // §11.11: validation and cooperation; firmer only after repeated broken promises, saying why.
      const inv = c.invoice!;
      const planned = inv.promisedFor ?? inv.dueAt;
      facts.push({ id: `invoice:${inv.number}`, text: { es: `Factura ${inv.number}, vence ${fmt(inv.dueAt, "ES")}`, en: `Invoice ${inv.number}, due ${fmt(inv.dueAt, "EN")}` }, kind: "FACT" });
      lines.push(es ? `Quería validar contigo la factura ${inv.number}, porque teníamos previsto el pago para el ${fmt(planned, c.lang)} y todavía no lo vemos reflejado.` : `I wanted to check invoice ${inv.number} with you, because we had the payment planned for ${fmt(planned, c.lang)} and we don't see it yet.`);
      if (inv.brokenPromises >= 2) lines.push(es ? `Es la ${inv.brokenPromises === 2 ? "segunda" : "tercera"} fecha que se mueve, y para poder planear de nuestro lado necesitamos acordar una fecha firme.` : `This is the ${inv.brokenPromises === 2 ? "second" : "third"} date that has moved, and to plan on our side we need to agree on a firm date.`);
      lines.push(es ? "¿Nos ayudas a confirmar si hubo algún cambio o si debemos revisar algo de nuestro lado?" : "Could you help us confirm whether something changed or whether we should check something on our side?");
      break;
    }
    case "RECOVERY": {
      // §11.10: situation and impact first, own error admitted, fact apart from person, concrete options.
      const r = c.recovery!;
      lines.push(es ? `Te escribo por ${lowerFirst(r.whatChanged)}${r.impact ? `, y entiendo que esto ${lowerFirst(r.impact)}` : ""}.` : `I'm writing about ${lowerFirst(r.whatChanged)}${r.impact ? `, and I understand this ${lowerFirst(r.impact)}` : ""}.`);
      if (r.ourFault) lines.push(es ? "Fue un error nuestro y lo estamos corrigiendo." : "It was our mistake and we're fixing it.");
      if (r.options.length) lines.push((es ? "Estas son las opciones que vemos:" : "These are the options we see:") + "\n" + r.options.slice(0, 3).map((o, n) => `${n + 1}. ${o}`).join("\n"));
      lines.push(es ? "¿Cuál les funciona mejor? Si prefieres, lo hablamos por teléfono hoy." : "Which works best for you? If you prefer, we can talk by phone today.");
      break;
    }
    case "HARD_STOP": {
      // §11.3: respectful, but the stop is unambiguous.
      lines.push(es ? `${c.hardStop!.what} Para protegerlos a ustedes y a nosotros, no podemos continuar hasta hacer una verificación independiente.` : `${c.hardStop!.what} To protect both of us, we can't continue until we complete an independent verification.`);
      lines.push(es ? "¿Nos confirmas por llamada al número que ya tenemos registrado?" : "Could you confirm by phone at the number we already have on file?");
      break;
    }
  }
  lines.push(c.senderName);
  const text = lines.filter(Boolean).join("\n\n");
  const meta = {
    purpose: c.purpose, tonePolicy: "carnegie", policyVersion: POLICY_VERSION,
    sourceContextIds: [...new Set(facts.map((f) => f.id))],
    factsUsed: facts.filter((f) => f.kind === "FACT").map((f) => ({ id: f.id, text: f.text.es })),
    inferencesUsed: facts.filter((f) => f.kind === "INFERENCE").map((f) => ({ id: f.id, text: f.text.es })),
    requiresHumanReview: true, // every external message (§11.12); material ones also are flagged as such
    material: PURPOSES[c.purpose].material,
    generatedAt: new Date().toISOString(),
  };
  return { text, meta };
}
const lowerFirst = (s: string) => (s && !/^[A-ZÁÉÍÓÚÑ]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export type Issue = { code: string; severity: "BLOCK" | "WARN" } & L;

/** Whole-word match that also works with accents (ñ, á…): JS \b only knows ASCII letters. */
const word = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "iu");

const RX = {
  accusatory: word(String.raw`moros[oa]s?|en mora|deudor(es)?|exigimos|último aviso|ultimo aviso|inaceptable|irresponsab\w*|culpa (suya|de ustedes)|usted(es)? est(á|a|án|an) equivocad\w*|delinquent|unacceptable|final notice|your fault|you are wrong`),
  flattery: word(String.raw`excelente empresa|empresa líder|líder indiscutible|los mejores del mercado|admiramos (mucho|profundamente)|increíble trabajo|world[- ]class company|industry leader`),
  competitor: word(String.raw`su proveedor actual (es|no)|la competencia (es|no sirve|no cumple)|mal proveedor|proveedor (malo|deficiente)|competitors? (are|is) (bad|poor)`),
  pressure: word(String.raw`urgente|solo por hoy|oferta limitada|última oportunidad|ultima oportunidad|act now|limited offer|last chance`),
  closeness: word(String.raw`como siempre|como hablamos|querid[oa] amig[oa]|nuestra gran amistad|as always|as we discussed|dear friend`),
  selfStart: /^(en industry solutions|industry solutions es|somos (una|la) empresa|we are a|at industry solutions)/i,
  // Case-sensitive on purpose: "todo" is an everyday Spanish word; only the placeholder "TODO" counts.
  unfilled: /\{\{|\}\}|\[\[|\bXXX\b|\bTODO\b|<nombre>|<name>/,
  stopWords: /(no podemos continuar|antes de continuar|verificaci[oó]n independiente|can't continue|cannot continue|independent verification)/i,
};

/** Factuality / tone / authority check (§11.12, §11.13). BLOCK = can't be recorded as sent; WARN = review. */
export function checkMessage(text: string, c: Pick<Ctx, "purpose" | "hasHistory" | "legitimateUrgency">): Issue[] {
  const out: Issue[] = [];
  const add = (code: string, severity: Issue["severity"], es: string, en: string) => out.push({ code, severity, es, en });
  const body = text.replace(/^(hola|hi|buenos días|buenas tardes)[^\n]*\n+/i, "").trim();
  if (RX.unfilled.test(text)) add("UNFILLED", "BLOCK", "Quedó un espacio sin completar.", "There's a blank left to fill in.");
  if (RX.accusatory.test(text)) add("ACCUSATORY", "BLOCK", "Suena acusatorio. Describe el hecho y pide ayuda para resolverlo, sin etiquetar a la persona.", "It sounds accusatory. Describe the fact and ask for help to solve it, without labeling the person.");
  if (RX.competitor.test(text)) add("COMPETITOR", "BLOCK", "Critica a un proveedor o competidor. Mejor hablar de lo que el cliente necesita.", "It criticizes a supplier or competitor. Better to talk about what the customer needs.");
  if (!c.hasHistory && RX.closeness.test(text)) add("CLOSENESS", "BLOCK", "Sugiere una cercanía que no tenemos registrada con esta persona.", "It suggests a closeness we have no record of with this person.");
  if (c.purpose === "HARD_STOP" && !RX.stopWords.test(text)) add("SOFT_STOP", "BLOCK", "Es un bloqueo por control: debe decir con claridad que no se puede continuar hasta verificar.", "It's a control stop: it must say clearly that we can't continue until verified.");
  if (RX.flattery.test(text)) add("FLATTERY", "WARN", "Elogio sin evidencia. Si hay un reconocimiento, que sea concreto y verdadero.", "Praise without evidence. If there's recognition, make it concrete and true.");
  if (RX.pressure.test(text) && !c.legitimateUrgency) add("PRESSURE", "WARN", "Presiona sin una razón legítima registrada.", "It pressures without a recorded legitimate reason.");
  if (c.purpose === "EXPLORE" && RX.selfStart.test(body)) add("SELF_START", "WARN", "Empieza hablando de nosotros. Mejor empezar por ellos.", "It starts talking about us. Better to start with them.");
  if ((text.match(/!/g) ?? []).length > 2 || /\b[A-ZÁÉÍÓÚÑ]{5,}\b(?:\s+\b[A-ZÁÉÍÓÚÑ]{4,}\b){2,}/.test(text)) add("SHOUTING", "WARN", "Muchos signos o mayúsculas: puede sonar a regaño.", "Many exclamation marks or capitals: it can sound like scolding.");
  if (text.split(/\s+/).length > 160) add("LONG", "WARN", "Es largo. Breve y humano funciona mejor.", "It's long. Short and human works better.");
  if (!/\?/.test(text) && c.purpose !== "HARD_STOP") add("NO_STEP", "WARN", "No propone una pregunta ni un siguiente paso.", "It doesn't offer a question or a next step.");
  return out;
}

/** Existing email templates (E1) go through the same check, as WARNINGS ONLY (user decision 2026-11-09).
 *  Anything already in the approved template text is the baseline and is never flagged; only what the person adds is. */
export const TEMPLATE_PURPOSE: Record<string, Purpose> = { PAYMENT: "COLLECTION", FOLLOWUP: "FOLLOW_UP", NEGOTIATE: "FOLLOW_UP", DELIVERY: "FOLLOW_UP", OFFER: "FOLLOW_UP", RFQ: "FOLLOW_UP" };
export function templateHints(edited: string, original: string, tpl: string): Issue[] {
  const c = { purpose: TEMPLATE_PURPOSE[tpl] ?? "FOLLOW_UP", hasHistory: true } as const;
  const base = new Set(checkMessage(original, c).map((x) => x.code));
  return checkMessage(edited, c).filter((x) => !base.has(x.code)).map((x) => ({ ...x, severity: "WARN" as const }));
}

/** §11.5: memory about a person never holds personal labels or profiling. */
const LABELS = word(String.raw`dif[ií]cil|emocional|tacañ[oa]|conflictiv[oa]|terc[oa]|hist[ée]ric[oa]|agresiv[oa]|perezos[oa]|bruto|brut[ao]|tont[oa]|loc[oa]|manipulable|inseguro|insegura|ego[ií]sta|codicios[oa]|fácil de convencer|facil de convencer|religi[oó]n|pol[ií]tic[oa]s? (de izquierda|de derecha)|embarazad[ao]|enferm[oa]|divorciad[oa]|difficult|emotional|stingy|stubborn|lazy|pushover`);
export function personNoteIssues(text: string): Issue[] {
  return LABELS.test(text) ? [{ code: "PERSONAL_LABEL", severity: "BLOCK", es: "Aquí guardamos hechos de negocio que la persona dijo o mostró, no etiquetas personales ni perfiles. Escribe qué dijo o hizo.", en: "We keep business facts the person said or showed here, not personal labels or profiles. Write what they said or did." }] : [];
}

/** Next movement if there's no answer (§11.6), by purpose. */
export function ifNoReply(p: Purpose): L & { days: number } {
  return {
    EXPLORE: { es: "Si no responde en 5 días hábiles, una llamada breve o pedir que alguien nos presente.", en: "If no answer in 5 working days, a short call or ask someone to introduce us.", days: 7 },
    RECONNECT: { es: "Si no responde en 3 días hábiles, una llamada breve.", en: "If no answer in 3 working days, a short call.", days: 4 },
    FOLLOW_UP: { es: "Si no responde en 3 días hábiles, una llamada breve.", en: "If no answer in 3 working days, a short call.", days: 4 },
    COLLECTION: { es: "Si no hay respuesta en 2 días hábiles, llamar a Tesorería del cliente.", en: "If no answer in 2 working days, call the customer's Treasury.", days: 3 },
    RECOVERY: { es: "Si no responde hoy, llamar: en una conversación difícil la voz ayuda.", en: "If no answer today, call: in a difficult conversation the voice helps.", days: 1 },
    HARD_STOP: { es: "No continuar hasta tener la verificación. Avisar a Gerencia si insisten.", en: "Don't continue until verified. Tell Management if they insist.", days: 1 },
  }[p];
}
